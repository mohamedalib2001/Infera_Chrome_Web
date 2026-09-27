// Agent loop. Runs in the service worker so tasks keep going while the user
// switches tabs or closes the side panel (with notifications on completion).
//
// Normal mode:  stream -> tool_use -> permission check -> execute -> tool_result -> repeat
// Quick Mode:   no tool definitions; the model answers in a compact command
//               language, we execute the batch, then send a fresh screenshot.
import { streamMessage, modelInfo } from './llm.js';
import { executeTool } from './tools/executor.js';
import { PANEL_TOOLS, TOOL_BY_NAME } from './tools/definitions.js';
import { buildSystem, tabContextBlock } from './prompts.js';
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
  }

  // ---------- UI plumbing ----------
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) { try { fn({ sessionId: this.id, ...ev }); } catch { /* port gone */ } } }
  hasUi() { return this.listeners.size > 0; }

  summary() {
    return { id: this.id, kind: this.kind, title: this.title, status: this.status, createdAt: this.createdAt, usage: this.usage, tokensSaved: this.tokensSaved };
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

  stop() {
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
    const mode = this.modeOverride || settings.permissionMode;
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
        const content = [tabContextBlock(tabs, initialTabId)];
        for (const a of attachments) content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.base64 } });
        content.push({ type: 'text', text: userText });
        this.messages.push({ role: 'user', content });
        await this.#loop({ model, mode, settings });
      }
      if (this.status === 'running') this.setStatus('done');
    } catch (e) {
      if (this.abort.signal.aborted) {
        this.#closeDanglingToolUses('The user stopped the task.');
        this.setStatus('stopped');
        this.emit({ type: 'info', message: 'Stopped.' });
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
    this.messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: reason, is_error: true })) });
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
    };
  }

  async #loop({ model, mode, settings }) {
    // Remote MCP tools are resolved once per run so the tool list (and the
    // prompt cache prefix) stays stable across turns.
    const remote = await remoteTools().catch(() => []);
    const remoteByName = new Map(remote.map((t) => [t.name, t]));
    const tools = [...PANEL_TOOLS, ...remote.map(({ _server, _tool, ...t }) => t)]; // eslint-disable-line no-unused-vars
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (this.abort.signal.aborted) throw new DOMException('aborted', 'AbortError');
      this.#compact();
      const tabs = await tabGroups.tabs(this.id);
      const system = await buildSystem({ mode, tabs });
      this.emit({ type: 'assistant_start' });
      const msg = await streamMessage(
        { model, system, messages: this.messages, tools, effort: settings.effort },
        { signal: this.abort.signal, onEvent: (ev) => this.#forward(ev) },
      );
      this.usage.input_tokens += msg.usage.input_tokens || 0;
      this.usage.output_tokens += msg.usage.output_tokens || 0;
      this.emit({ type: 'usage', usage: this.usage });

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
      if (!uses.length) return; // end_turn / max_tokens without tools

      const results = [];
      for (const u of uses) {
        if (this.abort.signal.aborted) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: 'The user stopped the task.', is_error: true });
          continue;
        }
        this.emit({ type: 'tool_start', id: u.id, name: u.name, input: redactInput(u.input) });
        let r;
        if (msg.stop_reason === 'max_tokens' && u === uses[uses.length - 1]) {
          r = { content: [{ type: 'text', text: 'Tool call was truncated (max_tokens). Retry with a smaller input.' }], isError: true };
        } else if (u._invalidJson !== undefined) {
          r = { content: [{ type: 'text', text: 'INVALID_JSON: the tool input was not valid JSON. Please retry the call.' }], isError: true };
        } else if (remoteByName.has(u.name)) {
          r = await this.#runRemote(remoteByName.get(u.name), u, mode, settings);
        } else if (!TOOL_BY_NAME[u.name]) {
          r = { content: [{ type: 'text', text: `Unknown tool ${u.name}` }], isError: true };
        } else {
          r = await executeTool(u.name, u.input, this.#toolCtx(mode, settings, u.id));
        }
        this.emit({ type: 'tool_result', id: u.id, name: u.name, isError: !!r.isError, content: r.content.map(uiBlock) });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
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
    if (ev.type === 'text') this.emit({ type: 'text_delta', text: ev.text });
    else if (ev.type === 'thinking') this.emit({ type: 'thinking_delta', text: ev.text });
    else if (ev.type === 'block_start' && ev.block.type === 'text') this.emit({ type: 'text_block_start' });
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
      this.#compact();
      const system = await buildSystem({ mode, tabs: await tabGroups.tabs(this.id), quick: true });
      this.emit({ type: 'assistant_start' });
      const msg = await streamMessage(
        { model, system, messages: this.messages, quick: true, effort: settings.effort, maxTokens: 4096 },
        { signal: this.abort.signal, onEvent: (ev) => this.#forward(ev) },
      );
      this.usage.input_tokens += msg.usage.input_tokens || 0;
      this.usage.output_tokens += msg.usage.output_tokens || 0;
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
    const entry = { id: this.id, title: this.title, kind: this.kind, createdAt: this.createdAt, updatedAt: Date.now(), status: this.status, messages: stripped, usage: this.usage };
    const next = [entry, ...all.filter((c) => c.id !== this.id)].slice(0, HISTORY_LIMIT);
    await setLocal(STORAGE_KEYS.CONVERSATIONS, next);
  }

  static fromHistory(entry, windowId) {
    const s = new AgentSession({ id: entry.id, kind: 'panel', windowId, title: entry.title });
    s.messages = entry.messages || [];
    s.createdAt = entry.createdAt;
    s.usage = entry.usage || s.usage;
    s.task = entry.title;
    s.status = 'idle';
    return s;
  }
}

function stripForHistory(b) {
  if (b.type === 'image') return { type: 'text', text: '[screenshot]' };
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
