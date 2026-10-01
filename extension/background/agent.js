// Agent loop. Runs in the service worker so tasks keep going while the user
// switches tabs or closes the side panel (with notifications on completion).
//
// Normal mode:  stream -> tool_use -> permission check -> execute -> tool_result -> repeat
// Quick Mode:   no tool definitions; the model answers in a compact command
//               language, we execute the batch, then send a fresh screenshot.
import { streamMessage, modelInfo } from './llm.js';
import { executeTool } from './tools/executor.js';
import { PANEL_TOOLS, MEMORY_TOOLS, ALL_TABS_TOOLS, TOOL_BY_NAME } from './tools/definitions.js';
import { webTools, SERVER_RESULT_TYPES, summarizeServerResult, citedSources } from './tools/web-tools.js';
import { listMemory, memoryBlock } from './memory.js';
import { inferaConversations } from './auth.js';
import { addSpend, lastCurrency, money } from './spend.js';

// Raised to stop a task at the person's budget (not an error).
class BudgetStop extends Error {}
import {
  BROWSER_TOOLSET, REPLACED_TOOLS, isToolsetUse, executeMember, toolsetResult, notExecuted,
} from './tools/browser-toolset.js';
import { buildSystem, tabContextBlock, domainSkills, MODE_NOTES } from './prompts.js';
import { tabGroups } from './tab-groups.js';
import { permissions } from './permissions.js';
import { cdp } from './cdp.js';
import { overlay } from './page.js';
import { isRestrictedUrl } from './domain-safety.js';
import { getSettings, getLocal, setLocal, uuid } from './storage.js';
import { COMPACT_THRESHOLD_BYTES, STORAGE_KEYS, PERMISSION_MODES, PERMISSION_TYPES } from './constants.js';
import { playSound } from './offscreen-client.js';
import { popupApproval } from './approvals.js';
import { remoteTools, callRemoteTool } from './remote-mcp.js';

const MAX_TURNS = 200;
const HISTORY_LIMIT = 50;

export class AgentSession {
  constructor({ id = uuid(), kind = 'panel', windowId = null, title = '' } = {}) {
    this.id = id;
    this.kind = kind;            // 'panel' | 'scheduled'
    this.windowId = windowId;
    this.title = title;
    this.messages = [];
    this.status = 'idle';        // idle | running | waiting | done | error | stopped
    this.abort = null;
    this.listeners = new Set();
    this.pending = new Map();    // approval id -> resolve
    this.task = '';
    this.tokensSaved = 0;
    this.usage = { input_tokens: 0, output_tokens: 0 };
    this.createdAt = Date.now();
    this.runShortcut = null;     // injected by service worker
    this.modelOverride = null;
    this.modeOverride = null;
    this.files = new Map();      // name -> file the user attached (for file_upload)
    this.queue = [];             // messages the user sent while a task was running
    this.cost = 0;               // what this conversation has cost, in the account currency
    this.currency = '';
  }

  // ---------- UI plumbing ----------
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) { try { fn({ sessionId: this.id, ...ev }); } catch { /* port gone */ } } }
  hasUi() { return this.listeners.size > 0; }

  summary() {
    return { id: this.id, kind: this.kind, title: this.title, status: this.status, createdAt: this.createdAt, usage: this.usage, tokensSaved: this.tokensSaved, cost: this.cost, currency: this.currency };
  }

  setStatus(s) {
    this.status = s;
    this.emit({ type: 'status', status: s });
    tabGroups.setStatus(this.id, s === 'running' || s === 'waiting' ? 'working' : s === 'done' ? 'done' : s === 'error' ? 'error' : 'idle');
  }

  // ---------- approvals ----------
  requestApproval(req) {
    const id = uuid();
    this.setStatus('waiting');
    return new Promise((resolve) => {
      const done = (answer) => { this.pending.delete(id); this.setStatus('running'); resolve(answer); };
      this.pending.set(id, done);
      const payload = {
        id, permissionType: req.type, netloc: req.netloc, url: req.url, description: req.description,
        allowAlways: req.allowAlways, reason: req.reason, tabTitle: req.tabTitle,
      };
      this.emit({ type: 'permission_request', request: payload });
      if (!this.hasUi()) notifyApproval(this, id, payload);
    });
  }

  approvePlan(plan) {
    const id = uuid();
    this.setStatus('waiting');
    return new Promise((resolve) => {
      this.pending.set(id, (answer) => { this.pending.delete(id); this.setStatus('running'); resolve(answer === 'approve' || answer === 'once' || answer === 'always'); });
      this.emit({ type: 'plan_request', request: { id, ...plan } });
      if (!this.hasUi()) notifyApproval(this, id, { description: `Plan: ${plan.approach.join(' → ')}\nSites: ${plan.domains.join(', ')}`, allowAlways: false, isPlan: true });
    });
  }

  answer(id, answer) {
    const fn = this.pending.get(id);
    if (fn) fn(answer);
  }

  // A message sent while the task runs; it goes into the next step.
  enqueue(text, attachments = []) {
    if (!String(text || '').trim() && !attachments.length) return;
    this.queue.push({ text: String(text || ''), attachments });
    this.task += `\n\nFollow-up: ${text}`;
    this.emit({ type: 'queued', count: this.queue.length });
  }

  #drainQueue() {
    const items = this.queue.splice(0);
    const blocks = [];
    for (const q of items) {
      blocks.push(...this.#attachmentBlocks(q.attachments));
      if (q.text) blocks.push({ type: 'text', text: `New message from the user, sent while you were working:\n${q.text}` });
    }
    return blocks;
  }

  stop() {
    this.queue = [];
    this.abort?.abort();
    for (const fn of [...this.pending.values()]) fn('deny');
  }

  // ---------- main entry ----------
  async run(userText, { attachments = [], startTabId = null } = {}) {
    if (this.status === 'running' || this.status === 'waiting') throw new Error('A task is already running in this conversation.');
    const settings = await getSettings();
    const policy = await chrome.storage.managed.get(null).catch(() => ({}));
    if (policy.enabled === false) throw new Error('Infera Agent is disabled by your organization.');
    this.abort = new AbortController();
    this.task = this.task ? `${this.task}\n\nFollow-up: ${userText}` : userText;
    if (!this.title) this.title = userText.slice(0, 80);
    const model = this.modelOverride || settings.model;
    this.lastModel = model;
    const mode = this.modeOverride || settings.permissionMode;
    this.runCost = 0;
    this.budgetLimit = Number(settings.taskBudget) || 0;
    this.setStatus('running');
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);

    try {
      if (startTabId != null) {
        const tab = await chrome.tabs.get(startTabId).catch(() => null);
        if (tab && !(await tabGroups.isInGroup(this.id, tab.id))) await tabGroups.adoptTab(this.id, tab.id, this.kind);
      }
      let { tabs } = await tabGroups.context(this.id, { createIfEmpty: true, kind: this.kind });
      const initialTabId = startTabId ?? tabs.find((t) => t.active)?.tabId ?? tabs[0]?.tabId;
      for (const t of tabs) if (!isRestrictedUrl(t.url)) overlay.show(t.tabId);

      if (modelInfo(model).quick) {
        await this.#runQuick({ userText, model, mode, settings, tabs, initialTabId, attachments });
      } else {
        const toolset = this.#useToolset(model);
        const flags = { web: !!modelInfo(model).browser && settings.webResearch !== false && !this.noWebTools, memory: settings.memory !== false };
        await this.#ensureSystem({ mode, tabs, toolset, ...flags });
        const content = [tabContextBlock(tabs, initialTabId)];
        const note = this.#contextNote(mode, tabs);
        if (note) content.push({ type: 'text', text: note });
        // Long-term memory goes into the first message of a new conversation.
        if (!this.messages.length && settings.memory !== false) {
          const mem = memoryBlock(await listMemory().catch(() => []));
          if (mem) content.push(mem);
        }
        content.push(...this.#attachmentBlocks(attachments));
        content.push({ type: 'text', text: userText });
        this.messages.push({ role: 'user', content });
        await this.#loop({ model, mode, settings, toolset, policy });
      }
      if (this.status === 'running') this.setStatus('done');
    } catch (e) {
      if (this.abort.signal.aborted) {
        this.#closeDanglingToolUses('The user stopped the task.');
        this.setStatus('stopped');
        this.emit({ type: 'info', message: 'Stopped.' });
      } else if (e instanceof BudgetStop) {
        this.#closeDanglingToolUses('Stopped at the spending limit set by the user.');
        this.setStatus('stopped');
        this.emit({ type: 'info', message: e.message });
      } else {
        this.#closeDanglingToolUses(`Error: ${e.message}`);
        this.setStatus('error');
        this.emit({ type: 'error', message: e.message });
      }
    } finally {
      clearInterval(keepAlive);
      permissions.clearPlan(this.id);
      await this.#finishTabs();
      await this.#persist();
      this.emit({ type: 'turn_end', status: this.status });
      // Messages that arrived too late for this task (Quick Mode, or the last step) start the next one.
      const late = this.queue.splice(0);
      if (late.length && this.status === 'done') {
        setTimeout(() => this.run(late.map((q) => q.text).filter(Boolean).join('\n\n'), { attachments: late.flatMap((q) => q.attachments) }).catch(() => {}), 0);
      }
      if (this.status === 'done' || this.status === 'error') await this.#notifyDone(settings);
    }
  }

  async #finishTabs() {
    const tabs = await tabGroups.tabs(this.id).catch(() => []);
    for (const t of tabs) {
      if (this.status === 'done') overlay.done(t.tabId); else overlay.hide(t.tabId);
      await cdp.detach(t.tabId); // end of turn: release the debugger
    }
  }

  async #notifyDone(settings) {
    const last = [...this.messages].reverse().find((m) => m.role === 'assistant');
    const txt = (last?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 180);
    if (settings.sound) playSound(this.status === 'done' ? 'done' : 'error');
    if (settings.notifications && (!this.hasUi() || this.kind === 'scheduled')) {
      chrome.notifications.create(`infera-done:${this.id}`, {
        type: 'basic', iconUrl: 'icons/icon128.png',
        title: this.status === 'done' ? 'Infera Agent — task complete' : 'Infera Agent — task failed',
        message: txt || this.title || 'Task finished.',
        priority: 1,
      });
    }
  }

  #closeDanglingToolUses(reason) {
    const last = this.messages[this.messages.length - 1];
    if (last?.role !== 'assistant') return;
    const uses = last.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) return;
    this.messages.push({ role: 'user', content: uses.map((u) => errorResult(u, reason)) });
  }

  // Screenshots are shown to the model; files the user attached are also kept for
  // file_upload, and PDFs / text files are given to the model to read.
  #attachmentBlocks(attachments) {
    const blocks = [];
    const listed = [];
    for (const a of attachments) {
      if (a.kind !== 'file') {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.base64 } });
        continue;
      }
      let name = String(a.name || 'file').replace(/[\\/]/g, '_');
      for (let i = 2; this.files.has(name) && this.files.get(name).base64 !== a.base64; i++) name = name.replace(/(\.[^.]*)?$/, `-${i}$1`);
      this.files.set(name, { ...a, name });
      const kb = Math.max(1, Math.round((a.base64.length * 0.75) / 1024));
      listed.push(`- /attachments/${name} (${a.mediaType || 'file'}, ${kb} KB)`);
      if (/^image\/(png|jpeg|gif|webp)$/.test(a.mediaType)) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.base64 } });
      } else if (a.mediaType === 'application/pdf') {
        blocks.push({ type: 'document', title: name, source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } });
      } else if (/^text\/|json|xml|csv/.test(a.mediaType || '') && a.base64.length < 400_000) {
        const txt = new TextDecoder().decode(Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0)));
        blocks.push({ type: 'document', title: name, source: { type: 'text', media_type: 'text/plain', data: txt } });
      }
    }
    if (listed.length) {
      blocks.unshift({ type: 'text', text: `<attached_files>\nThe user attached these files. To put one into a page's file input, use file_upload with its path.\n${listed.join('\n')}\n</attached_files>` });
    }
    return blocks;
  }

  // ---------- costs ----------
  // The gateway reports what each call cost (infera_usage); keep the task's and
  // the day's totals and show them live.
  async #account(msg) {
    const c = msg.charge;
    if (!c) return;
    this.cost += c.amount;
    this.runCost += c.amount;
    if (c.currency) this.currency = c.currency;
    if (c.charged) await addSpend(c.amount, this.currency);
    this.emit({ type: 'cost', task: this.runCost, conversation: this.cost, call: c.amount, currency: this.currency, balance: c.balance });
  }

  // Before each model call: the task limit asks the person whether to continue.
  async #checkBudget(settings) {
    if (!this.currency) this.currency = await lastCurrency();
    // The daily limit is enforced by the INFERA Agent server (shared with the app).
    const step = Number(settings.taskBudget) || 0;
    if (step > 0 && this.budgetLimit > 0 && this.runCost >= this.budgetLimit) {
      const answer = await this.requestApproval({
        type: 'BUDGET',
        description: `This task has cost ${money(this.runCost, this.currency)} so far (your limit per task is ${money(step, this.currency)}). Continue and allow up to ${money(this.budgetLimit + step, this.currency)}?`,
        allowAlways: false,
      });
      if (answer !== 'once' && answer !== 'always') throw new BudgetStop(`Stopped at your task limit — this task cost ${money(this.runCost, this.currency)}.`);
      this.budgetLimit += step;
    }
  }

  // ---------- tools & system prompt ----------
  // Anthropic's browser toolset when the model supports it (models are trained
  // on it), our own browsing tools otherwise. A conversation that already used
  // the toolset has to stay on a model that supports it.
  #usedToolset() {
    return this.messages.some((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some(isToolsetUse));
  }

  #container() {
    const c = this.containerRef;
    return c && (!c.expiresAt || c.expiresAt > Date.now() + 30_000) ? c.id : undefined;
  }

  #usedServerTools() {
    return this.messages.some((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b) => b.type === 'server_tool_use'));
  }

  #useToolset(model) {
    const supported = !!modelInfo(model).browser;
    if (this.#usedToolset()) {
      if (!supported) throw new Error('This conversation used browser actions that this model does not support. Choose another model or start a new chat.');
      return true;
    }
    return supported && !this.classicTools;
  }

  // The system prompt is written once per conversation and never rebuilt, so
  // the prompt cache stays warm and thinking blocks stay valid; later changes
  // (another permission mode, a site with extra know-how) are appended to the
  // conversation as notes instead.
  async #ensureSystem({ mode, tabs, toolset, web = false, memory = false }) {
    const key = `${toolset}|${web}|${memory}`;
    if (this.system && this.systemKey === key) return;
    this.system = await buildSystem({ mode, tabs, toolset, web, memory });
    this.systemKey = key;
    this.notedMode = mode;
    this.notedSkills = new Set(domainSkills(tabs.map((t) => t.url)).map((s) => s.name));
  }

  #contextNote(mode, tabs) {
    const notes = [];
    if (mode !== this.notedMode) { notes.push(`The permission mode changed. ${MODE_NOTES[mode] || ''}`); this.notedMode = mode; }
    for (const s of domainSkills(tabs.map((t) => t.url))) {
      if (this.notedSkills.has(s.name)) continue;
      this.notedSkills.add(s.name);
      notes.push(`Site knowledge — ${s.name}: ${s.text}`);
    }
    return notes.length ? `<system-reminder>${notes.join('\n\n')}</system-reminder>` : '';
  }

  #compact() {
    let size = JSON.stringify(this.messages).length;
    if (size < COMPACT_THRESHOLD_BYTES) return;
    // Replace images in older messages with placeholders (keep the last 3 user turns intact).
    const userIdx = this.messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
    const keepFrom = userIdx[Math.max(0, userIdx.length - 3)] ?? 0;
    for (let i = 0; i < keepFrom && size > COMPACT_THRESHOLD_BYTES * 0.6; i++) {
      const m = this.messages[i];
      if (!Array.isArray(m.content)) continue;
      const walk = (arr) => arr.map((b) => {
        if (b.type === 'image') { this.tokensSaved += 1500; return { type: 'text', text: '[earlier screenshot removed to save space]' }; }
        if (b.type === 'tool_result' && Array.isArray(b.content)) return { ...b, content: walk(b.content) };
        return b;
      });
      m.content = walk(m.content);
      size = JSON.stringify(this.messages).length;
    }
    this.emit({ type: 'compacted', tokensSaved: this.tokensSaved });
  }

  #toolCtx(mode, settings, toolUseId) {
    return {
      sessionId: this.id,
      kind: this.kind,
      mode,
      task: this.task,
      toolUseId,
      signal: this.abort.signal,
      safetyChecker: settings.safetyChecker,
      requestApproval: (req) => this.requestApproval(req),
      approvePlan: (plan) => this.approvePlan(plan),
      runShortcut: this.runShortcut,
      attachments: this.files,
      memoryEnabled: settings.memory !== false,
      allTabsAccess: settings.allTabsAccess !== false,
    };
  }

  async #loop({ model, mode, settings, toolset, policy = {} }) {
    // Remote MCP tools are resolved once per run so the tool list (and the
    // prompt cache prefix) stays stable across turns.
    const remote = await remoteTools().catch(() => []);
    const remoteByName = new Map(remote.map((t) => [t.name, t]));
    const remoteDefs = remote.map(({ _server, _tool, ...t }) => t); // eslint-disable-line no-unused-vars
    const useWeb = () => !!modelInfo(model).browser && settings.webResearch !== false && !this.noWebTools;
    const extras = () => [...(settings.allTabsAccess !== false ? ALL_TABS_TOOLS : []), ...(settings.memory !== false ? MEMORY_TOOLS : []), ...remoteDefs];
    const toolList = (ts) => [
      ...(ts ? [BROWSER_TOOLSET] : []),
      ...(useWeb() ? webTools(settings, policy) : []),
      ...(ts ? PANEL_TOOLS.filter((t) => !REPLACED_TOOLS.has(t.name)) : PANEL_TOOLS),
      ...extras(),
    ];
    let tools = toolList(toolset);
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (this.abort.signal.aborted) throw new DOMException('aborted', 'AbortError');
      await this.#checkBudget(settings);
      this.#compact();
      this.emit({ type: 'assistant_start' });
      let msg;
      try {
        msg = await streamMessage(
          { model, system: this.system, messages: this.messages, tools, effort: settings.effort, container: this.#container(), task: this.title },
          { signal: this.abort.signal, onEvent: (ev) => this.#forward(ev) },
        );
      } catch (e) {
        // The endpoint does not offer the web tools: continue without them.
        if (e.status === 400 && /web_search|web_fetch/.test(e.message) && useWeb() && !this.#usedServerTools()) {
          this.noWebTools = true;
          tools = toolList(toolset);
          await this.#ensureSystem({ mode, tabs: await tabGroups.tabs(this.id), toolset, web: false, memory: settings.memory !== false });
          turn--;
          continue;
        }
        // The endpoint does not offer the browser toolset: continue with our own tools.
        if (toolset && e.status === 400 && /browser_toolset/.test(e.message) && !this.#usedToolset()) {
          this.classicTools = true;
          toolset = false;
          tools = toolList(false);
          await this.#ensureSystem({ mode, tabs: await tabGroups.tabs(this.id), toolset: false, web: useWeb(), memory: settings.memory !== false });
          turn--;
          continue;
        }
        throw e;
      }
      this.usage.input_tokens += msg.usage.input_tokens || 0;
      this.usage.output_tokens += msg.usage.output_tokens || 0;
      this.emit({ type: 'usage', usage: this.usage });
      await this.#account(msg);
      if (msg.container?.id) this.containerRef = { id: msg.container.id, expiresAt: Date.parse(msg.container.expires_at) || 0 };

      const clean = msg.content.map(({ _invalidJson, ...b }) => b); // eslint-disable-line no-unused-vars
      this.messages.push({ role: 'assistant', content: clean });

      if (msg.stop_reason === 'refusal') {
        this.emit({ type: 'error', message: `The model declined this request${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'}` });
        this.messages.pop(); // a refused turn is not continued
        this.setStatus('error');
        return;
      }
      if (msg.stop_reason === 'pause_turn') continue;

      const uses = msg.content.filter((b) => b.type === 'tool_use');
      if (!uses.length) {
        // The user wrote while this step was running: answer that too.
        if (this.queue.length) { this.messages.push({ role: 'user', content: this.#drainQueue() }); continue; }
        return; // end_turn / max_tokens without tools
      }

      const results = [];
      let browserFailed = false; // browser actions run in order and stop at the first failure
      for (const u of uses) {
        if (this.abort.signal.aborted) {
          results.push(errorResult(u, 'The user stopped the task.'));
          continue;
        }
        if (isToolsetUse(u) && browserFailed) {
          results.push(notExecuted(u));
          continue;
        }
        this.emit({ type: 'tool_start', id: u.id, name: u.name, input: redactInput(u.input) });
        let r;
        if (msg.stop_reason === 'max_tokens' && u === uses[uses.length - 1]) {
          r = { content: [{ type: 'text', text: 'Tool call was truncated (max_tokens). Retry with a smaller input.' }], isError: true };
        } else if (u._invalidJson !== undefined) {
          r = { content: [{ type: 'text', text: 'INVALID_JSON: the tool input was not valid JSON. Please retry the call.' }], isError: true };
        } else if (isToolsetUse(u)) {
          r = await executeMember(u, this.#toolCtx(mode, settings, u.id));
          if (r.isError) browserFailed = true;
        } else if (remoteByName.has(u.name)) {
          r = await this.#runRemote(remoteByName.get(u.name), u, mode, settings);
        } else if (!TOOL_BY_NAME[u.name]) {
          r = { content: [{ type: 'text', text: `Unknown tool ${u.name}` }], isError: true };
        } else {
          r = await executeTool(u.name, u.input, this.#toolCtx(mode, settings, u.id));
        }
        this.emit({ type: 'tool_result', id: u.id, name: u.name, isError: !!r.isError, content: r.content.filter((b) => b.type !== 'browser_state').map(uiBlock) });
        results.push(isToolsetUse(u) ? toolsetResult(u, r) : { type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
      // New site know-how is appended after the results (never edits the system prompt).
      const note = this.#contextNote(mode, await tabGroups.tabs(this.id).catch(() => []));
      if (note) results.push({ type: 'text', text: note });
      if (this.queue.length) results.push(...this.#drainQueue());
      // All results in ONE user message.
      this.messages.push({ role: 'user', content: results });
      if (this.abort.signal.aborted) throw new DOMException('aborted', 'AbortError');
    }
    this.emit({ type: 'error', message: `Stopped after ${MAX_TURNS} steps.` });
  }

  async #runRemote(def, u, mode, settings) {
    const netloc = new URL(def._server.url).host;
    const ctx = this.#toolCtx(mode, settings, u.id);
    const verdict = await permissions.check({ sessionId: this.id, mode, requestApproval: ctx.requestApproval, safetyCheck: null }, {
      type: PERMISSION_TYPES.REMOTE_MCP, netloc, url: def._server.url, toolUseId: u.id, category: 'category0',
      description: `Call tool "${def._tool}" on remote MCP server "${def._server.name}" with ${JSON.stringify(u.input).slice(0, 300)}`,
    });
    permissions.consumeOnce(u.id);
    if (!verdict.allowed) return { content: [{ type: 'text', text: verdict.reason }], isError: true };
    try { return await callRemoteTool(def, u.input); }
    catch (e) { return { content: [{ type: 'text', text: `Remote MCP error: ${e.message}` }], isError: true }; }
  }

  #forward(ev) {
    const b = ev.block;
    if (ev.type === 'text') this.emit({ type: 'text_delta', text: ev.text });
    else if (ev.type === 'thinking') this.emit({ type: 'thinking_delta', text: ev.text });
    else if (ev.type === 'block_start' && b.type === 'text') this.emit({ type: 'text_block_start' });
    // Server tools (web search / fetch, and the code that filters their results)
    // run on Anthropic's side; show them as tool cards.
    else if (ev.type === 'block_stop' && b.type === 'server_tool_use') this.emit({ type: 'tool_start', id: b.id, name: b.name, input: b.input });
    else if (ev.type === 'block_start' && SERVER_RESULT_TYPES.has(b.type)) {
      const s = summarizeServerResult(b);
      this.emit({ type: 'tool_result', id: b.tool_use_id, name: b.type, isError: s.isError, content: [{ type: 'text', text: s.text }] });
    } else if (ev.type === 'block_stop' && b.type === 'text' && b.citations?.length) {
      const sources = citedSources(b);
      if (sources.length) this.emit({ type: 'citations', sources });
    }
  }

  // ---------- Quick Mode ----------
  async #runQuick({ userText, model, mode, settings, tabs, initialTabId }) {
    let current = initialTabId;
    const shoot = async () => {
      const r = await executeTool('computer', { action: 'screenshot', tabId: current }, this.#toolCtx(mode, settings, uuid()));
      return r;
    };
    let shot = await shoot();
    const first = [tabContextBlock(tabs, initialTabId)];
    for (const c of shot.content) first.push(c);
    first.push({ type: 'text', text: userText });
    this.messages.push({ role: 'user', content: first });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (this.abort.signal.aborted) throw new DOMException('aborted', 'AbortError');
      await this.#checkBudget(settings);
      this.#compact();
      const system = await buildSystem({ mode, tabs: await tabGroups.tabs(this.id), quick: true });
      this.emit({ type: 'assistant_start' });
      const msg = await streamMessage(
        { model, system, messages: this.messages, quick: true, effort: settings.effort, maxTokens: 4096, task: this.title },
        { signal: this.abort.signal, onEvent: (ev) => this.#forward(ev) },
      );
      this.usage.input_tokens += msg.usage.input_tokens || 0;
      this.usage.output_tokens += msg.usage.output_tokens || 0;
      await this.#account(msg);
      this.messages.push({ role: 'assistant', content: msg.content.length ? msg.content : [{ type: 'text', text: '(no output)' }] });
      if (msg.stop_reason === 'refusal') { this.messages.pop(); this.emit({ type: 'error', message: 'The model declined this request.' }); this.setStatus('error'); return; }

      const textOut = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const cmds = parseQuick(textOut);
      if (!cmds.length || cmds.some((c) => c.op === 'DONE')) return;

      const log = [];
      const extraImages = [];
      for (const c of cmds) {
        if (this.abort.signal.aborted) break;
        const ctx = this.#toolCtx(mode, settings, uuid());
        const call = quickToTool(c, current);
        if (c.op === 'ST') {
          const id = Number(c.args[0]);
          if (await tabGroups.isInGroup(this.id, id)) { current = id; await chrome.tabs.update(id, { active: true }); log.push(`ST ${id}: ok`); }
          else { log.push(`ST ${id}: error — tab not in group`); break; }
          continue;
        }
        if (!call) { log.push(`${c.raw}: error — unknown command`); break; }
        this.emit({ type: 'tool_start', id: ctx.toolUseId, name: call.name, input: call.input });
        const r = await executeTool(call.name, call.input, ctx);
        this.emit({ type: 'tool_result', id: ctx.toolUseId, name: call.name, isError: !!r.isError, content: r.content.map(uiBlock) });
        const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
        log.push(`${c.raw.slice(0, 60)}: ${r.isError ? 'error — ' : ''}${t.slice(0, 1500)}`);
        for (const b of r.content) if (b.type === 'image') extraImages.push(b);
        if (c.op === 'NT') {
          const m = t.match(/tab (\d+)/i);
          if (m) current = Number(m[1]);
        }
        if (r.isError) break;
      }
      shot = await shoot();
      this.messages.push({ role: 'user', content: [{ type: 'text', text: log.join('\n') }, ...extraImages, ...shot.content] });
    }
  }

  // ---------- persistence ----------
  async #persist() {
    const all = await getLocal(STORAGE_KEYS.CONVERSATIONS, []);
    const stripped = this.messages.map((m) => ({
      role: m.role,
      content: Array.isArray(m.content) ? m.content.map(stripForHistory) : m.content,
    }));
    const entry = { id: this.id, title: this.title, kind: this.kind, createdAt: this.createdAt, updatedAt: Date.now(), status: this.status, messages: stripped, usage: this.usage, cost: this.cost, currency: this.currency };
    const next = [entry, ...all.filter((c) => c.id !== this.id)].slice(0, HISTORY_LIMIT);
    await setLocal(STORAGE_KEYS.CONVERSATIONS, next);
    // And in the person's INFERA Agent account, so the history follows them to every device.
    const settings = await getSettings();
    if (settings.syncHistory !== false) {
      inferaConversations('put', this.id, { ...entry, model: this.lastModel || '', messages: capText(stripped) })
        .catch((e) => console.warn('Infera: conversation not saved to the account:', e.message));
    }
  }

  static fromHistory(entry, windowId) {
    const s = new AgentSession({ id: entry.id, kind: 'panel', windowId, title: entry.title });
    s.messages = entry.messages || [];
    s.createdAt = entry.createdAt;
    s.usage = entry.usage || s.usage;
    s.cost = entry.cost || 0;
    s.lastModel = entry.model || '';
    s.currency = entry.currency || '';
    s.task = entry.title;
    s.status = 'idle';
    return s;
  }
}

// Very long page texts are shortened in the account copy (the steps stay complete).
function capText(messages) {
  const cap = (b) => {
    if (b?.type === 'text' && b.text?.length > 20_000) return { ...b, text: `${b.text.slice(0, 20_000)}\n[… shortened]` };
    if (b?.type === 'tool_result' && Array.isArray(b.content)) return { ...b, content: b.content.map(cap) };
    return b;
  };
  return messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map(cap) } : m));
}

function errorResult(u, reason) {
  if (isToolsetUse(u)) return toolsetResult(u, { content: [{ type: 'text', text: reason }], isError: true });
  return { type: 'tool_result', tool_use_id: u.id, content: reason, is_error: true };
}

function stripForHistory(b) {
  if (b.type === 'image') return { type: 'text', text: '[screenshot]' };
  if (b.type === 'document') return { type: 'text', text: `[attached file: ${b.title || 'document'}]` };
  if (b.type === 'tool_result' && Array.isArray(b.content)) return { ...b, content: b.content.map(stripForHistory) };
  return b;
}

function uiBlock(b) {
  // Screenshots are sent to the UI as data URLs for thumbnails.
  if (b.type === 'image') return { type: 'image', src: `data:${b.source.media_type};base64,${b.source.data}` };
  return b;
}

function redactInput(input) {
  if (!input) return input;
  const c = { ...input };
  if (c.files) c.files = c.files.map((f) => ({ name: f.name, mimeType: f.mimeType, bytes: Math.floor((f.base64?.length || 0) * 0.75) }));
  return c;
}

// ---------- Quick Mode command language ----------
export function parseQuick(text) {
  const out = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line === '<<END>>') break;
    const m = line.match(/^(RC|DC|TC|ST|NT|LT|PL|DONE|C|H|T|K|S|D|Z|N|J|W)(?:\s+([\s\S]*))?$/);
    if (!m) continue;
    const op = m[1];
    const rest = m[2] ?? '';
    const nums = rest.split(/\s+/).map(Number);
    out.push({ op, rest, args: nums, raw: line });
  }
  return out;
}

function quickToTool(c, tabId) {
  const n = c.args;
  switch (c.op) {
    case 'C': return { name: 'computer', input: { action: 'left_click', coordinate: [n[0], n[1]], tabId } };
    case 'RC': return { name: 'computer', input: { action: 'right_click', coordinate: [n[0], n[1]], tabId } };
    case 'DC': return { name: 'computer', input: { action: 'double_click', coordinate: [n[0], n[1]], tabId } };
    case 'TC': return { name: 'computer', input: { action: 'triple_click', coordinate: [n[0], n[1]], tabId } };
    case 'H': return { name: 'computer', input: { action: 'hover', coordinate: [n[0], n[1]], tabId } };
    case 'T': return { name: 'computer', input: { action: 'type', text: c.rest, tabId } };
    case 'K': return { name: 'computer', input: { action: 'key', text: c.rest, tabId } };
    case 'S': {
      const [dir, amt, x, y] = c.rest.split(/\s+/);
      return { name: 'computer', input: { action: 'scroll', scroll_direction: dir, scroll_amount: Number(amt) || 3, ...(x ? { coordinate: [Number(x), Number(y)] } : {}), tabId } };
    }
    case 'D': return { name: 'computer', input: { action: 'left_click_drag', start_coordinate: [n[0], n[1]], coordinate: [n[2], n[3]], tabId } };
    case 'Z': return { name: 'computer', input: { action: 'zoom', region: [n[0], n[1], n[2], n[3]], tabId } };
    case 'N': return { name: 'navigate', input: { url: c.rest, tabId } };
    case 'J': return { name: 'javascript_tool', input: { action: 'javascript_exec', text: c.rest, tabId } };
    case 'W': return { name: 'computer', input: { action: 'wait', duration: 1, tabId } };
    case 'NT': return { name: 'tabs_create', input: c.rest ? { url: c.rest } : {} };
    case 'LT': return { name: 'tabs_context', input: {} };
    case 'PL': {
      let plan = {};
      try { plan = JSON.parse(c.rest); } catch { /* invalid */ }
      return { name: 'update_plan', input: { domains: plan.domains || [], approach: plan.approach || [] } };
    }
    default: return null;
  }
}

// ---------- approvals without an open side panel (scheduled tasks) ----------
function notifyApproval(session, id, req) {
  popupApproval(req).then((answer) => session.answer(id, answer));
}

export { PERMISSION_MODES };
