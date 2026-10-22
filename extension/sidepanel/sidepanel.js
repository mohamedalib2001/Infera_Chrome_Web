// Infera Agent Web — side panel UI. The agent loop runs in the service worker; this
// page renders the conversation, the live execution center, approvals, history, the
// workflow studio (saved workflows, templates, schedules, recording) and usage.
import { t, setLanguage, applyI18n, MODE_LABEL, currentLang } from '../lib/i18n.js';
import { renderMarkdown } from '../lib/markdown.js';
import { icon } from '../lib/icons.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const ic = (name, size) => icon(name, { size });
// replaceChildren() would print null as text: drop empty slots first.
const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

let port;
let state = null;
let windowId;
let reqSeq = 0;
const waiters = new Map();
const toolCards = new Map();
let curText = null;      // {el, buf}
let curThinking = null;
let attachments = [];
let renderTimer = null;
let lastUserText = '';

// What the execution center shows, kept up to date from the agent's events.
const live = {
  status: 'idle', steps: [], startedAt: 0, endedAt: 0, site: '', url: '', tabTitle: '', shot: '', now: '',
  actions: [], takenOver: false, runCost: 0, currency: '', model: '', route: null,
};
const busy = (s = live.status) => s === 'running' || s === 'waiting' || s === 'paused';

// ---------------- connection ----------------
async function connect() {
  windowId = (await chrome.windows.getCurrent()).id;
  port = chrome.runtime.connect({ name: 'sidepanel' });
  port.onMessage.addListener(onEvent);
  port.onDisconnect.addListener(() => setTimeout(connect, 500)); // service worker restarted
  port.postMessage({ type: 'init', windowId });
  // Keep the account (and the provider status) fresh; a revoked session signs the panel out.
  setTimeout(() => call('refresh_account').then(loadState).catch(() => {}), 1500);
}

function call(type, payload = {}) {
  const requestId = ++reqSeq;
  return new Promise((resolve, reject) => {
    waiters.set(requestId, { resolve, reject });
    port.postMessage({ type, requestId, ...payload });
  });
}

function onEvent(ev) {
  switch (ev.type) {
    case 'init': loadState(ev); break;
    case 'reply': {
      const w = waiters.get(ev.requestId);
      if (w) { waiters.delete(ev.requestId); ev.error ? w.reject(new Error(ev.error)) : w.resolve(ev.data); }
      break;
    }
    case 'status': setStatus(ev.status); break;
    case 'assistant_start': curText = null; curThinking = null; break;
    case 'text_block_start': curText = null; break;
    case 'text_delta': appendText(ev.text); break;
    case 'thinking_delta': appendThinking(ev.text); break;
    case 'tool_start': curText = null; addToolCard(ev.id, ev.name, ev.input); trackTool(ev.name, ev.input); break;
    case 'tool_result': finishToolCard(ev.id, ev.content, ev.isError); trackResult(ev.content); break;
    case 'citations': addSources(ev.sources); break;
    case 'cost': showCost(ev.conversation, ev.currency, ev.balance); live.runCost = ev.task || live.runCost; live.currency = ev.currency || live.currency; refreshLive(); break;
    case 'permission_request': addApproval(ev.request); break;
    case 'plan_request': addPlan(ev.request); break;
    case 'error': addBanner(ev.message); break;
    case 'info': addBanner(ev.message, true); break;
    case 'compacted': if (ev.summarized) addBanner(t('compacted'), true); break;
    case 'steps': live.steps = ev.steps || []; refreshLive(); break;
    case 'where': Object.assign(live, { site: ev.site, url: ev.url, tabTitle: ev.title }); refreshLive(); break;
    case 'routed': live.route = ev; live.model = ev.model; showRoute(ev); break;
    case 'paused': live.takenOver = !!ev.takenOver; refreshLive(); break;
    case 'resumed': live.takenOver = false; refreshLive(); break;
    case 'session_switched': call('state').then(loadState); break;
    case 'turn_end': curText = null; curThinking = null; refreshConversations(); break;
    default:
  }
}

// ---------------- state ----------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = ['dark', 'light', 'auto'].includes(theme) ? theme : 'dark';
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach((b) => { if (!b.querySelector(':scope > svg')) b.prepend(ic(b.dataset.ic)); });
}

function loadState(s) {
  state = s;
  setLanguage(s.settings.language);
  applyTheme(s.settings.theme);
  applyI18n();
  hydrateIcons();
  fillSelectors();
  renderAuth();
  buildHome();
  const ss = s.session;
  Object.assign(live, {
    status: ss.status, steps: ss.steps || [], startedAt: ss.runStartedAt || 0, site: ss.site || '', takenOver: !!ss.takenOver,
    runCost: ss.runCost || 0, currency: ss.currency || '', model: ss.model || '', route: s.route || null, shot: '', now: '', actions: [], lastStatus: ss.lastStatus || '',
    endedAt: busy(ss.status) ? 0 : (live.endedAt || 0),
  });
  renderHistory(s.messages || []);
  setStatus(ss.status);
  showCost(ss.cost, ss.currency);
  $('#routeChip').hidden = true;
}

async function refreshConversations() {
  try { const s = await call('state'); state.conversations = s.conversations; state.shortcuts = s.shortcuts; state.tasks = s.tasks; } catch { /* ignore */ }
}

function renderAuth() {
  const a = state.auth || {};
  const ready = !!a.ready;
  $('#signIn').hidden = ready;
  $('#examples').hidden = !ready;
  $('#quickTasks').hidden = !ready;
  $('#input').disabled = !ready;
  $('#account').hidden = !a.infera;
  $('#conn').hidden = !ready;
  if (a.infera) {
    const acc = a.account || {};
    const credits = a.credits === null || a.credits === undefined ? '' : ` · ${t('credits')}: ${Number(a.credits).toFixed(2)} ${a.currency || ''}`;
    $('#accountText').textContent = `${t('signedInAs')} ${acc.displayName || acc.email || ''}${credits}`;
  }
  $('#noProvider').hidden = !(a.infera && a.block);
  if (a.infera && a.block) $('#noProvider').querySelector('span').textContent = t(a.block === 'monthly_cap' ? 'blockCap' : a.block === 'consent_required' ? 'blockConsent' : 'blockCredits');
}

$('#signIn').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#siError');
  err.hidden = true;
  $('#siSubmit').disabled = true;
  try {
    loadState(await call('infera_sign_in'));
  } catch (x) {
    err.textContent = x.message;
    err.hidden = false;
  } finally {
    $('#siSubmit').disabled = false;
  }
});
$('#siCreateAccount').addEventListener('click', () => chrome.tabs.create({ url: `${state.auth?.server || 'https://inferaagent.com'}/` }));
$('#btnSignOut').addEventListener('click', async () => loadState(await call('sign_out')));

// One selector for how much power to use: an operating mode, or a specific model.
const OP_MODES = ['auto', 'fast', 'balanced', 'power'];
function fillSelectors() {
  const ms = $('#modelSel');
  put(ms, 
    el('optgroup', { label: t('opModes') }, ...OP_MODES.map((m) => el('option', { value: `op:${m}` }, `${t(`op_${m}`)} — ${t(`op_${m}_d`)}`))),
    el('optgroup', { label: t('model') }, ...state.models.map((m) => el('option', { value: m.id }, m.label))),
  );
  const op = state.settings.operatingMode;
  ms.value = OP_MODES.includes(op) ? `op:${op}` : state.settings.model;
  const md = $('#modeSel');
  put(md, ...state.modes.map((m) => el('option', { value: m }, t(MODE_LABEL[m]))));
  md.value = state.settings.permissionMode;
}

const REASON_AR = { 'multi-step actions': 'إجراءات متعددة الخطوات', 'a quick question': 'سؤال سريع', 'a general task': 'مهمة عامة', 'long instructions': 'تعليمات طويلة', 'attached files': 'ملفات مرفقة', 'recent tasks needed more power': 'احتاجت المهام الأخيرة قوة أكبر' };
function showRoute(r) {
  const chip = $('#routeChip');
  if (!r?.auto) { chip.hidden = true; return; }
  const reason = currentLang() === 'ar' ? (REASON_AR[r.reason] || r.reason) : r.reason;
  put(chip, ic('sparkle', 13), el('span', {}, `${t('routedTo')} `), el('b', {}, t(`op_${r.mode}`)), reason ? el('span', {}, ` · ${t('because')} ${reason}`) : null);
  chip.hidden = false;
}

function setStatus(s) {
  const was = live.status;
  live.status = s;
  if (busy(s) && !busy(was)) { live.startedAt = Date.now(); live.endedAt = 0; live.actions = []; live.runCost = 0; live.now = ''; }
  if (!busy(s) && busy(was)) { live.endedAt = Date.now(); live.takenOver = false; }
  if (s !== 'idle') live.lastStatus = s;
  const running = busy(s);
  $('#btnStop').hidden = !running;
  const st = $('#status');
  st.className = 'status' + (s === 'running' || s === 'waiting' ? ' running' : s === 'paused' ? ' paused' : '');
  st.textContent = s === 'running' ? t('working') : s === 'waiting' ? t('waiting') : s === 'paused' ? t('st_paused') : s === 'done' ? t('done') : s === 'stopped' ? t('stopped') : s === 'error' ? t('error') : '';
  if (state) state.session.status = s;
  updateEmpty();
  refreshLive();
}

function updateEmpty() {
  $('#empty').hidden = $('#messages').children.length > 0;
}

// ---------------- rendering ----------------
const scroll = () => { const m = $('#messages'); m.scrollTop = m.scrollHeight; };

function renderHistory(messages) {
  const m = $('#messages');
  put(m, );
  toolCards.clear();
  curText = null;
  const results = new Map();
  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) for (const b of msg.content) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
  }
  for (const msg of messages) {
    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }];
    if (msg.role === 'user') {
      const texts = blocks.filter((b) => b.type === 'text' && !/^<(tab_context|system-reminder|user_memory|attached_files)>/.test(b.text) && !/^New message from the user/.test(b.text));
      const imgs = blocks.filter((b) => b.type === 'image');
      if (!texts.length && !imgs.length) continue;
      if (blocks.some((b) => b.type === 'tool_result')) continue;
      lastUserText = texts.map((b) => b.text).join('\n');
      addUser(lastUserText, imgs.map((b) => `data:${b.source.media_type};base64,${b.source.data}`));
    } else {
      for (const b of blocks) {
        if (b.type === 'text' && b.text) {
          m.append(el('div', { class: 'msg assistant', dir: 'auto', html: renderMarkdown(b.text) }));
          if (b.citations?.length) addSources(b.citations.map((c) => ({ url: c.url, title: c.title })).filter((c) => c.url));
        } else if (b.type === 'server_tool_use') addToolCard(b.id, b.name, b.input);
        else if (/_tool_result$/.test(b.type) && b.tool_use_id) finishToolCard(b.tool_use_id, [], /error/.test(b.content?.type || ''));
        else if (b.type === 'thinking' && b.thinking) m.append(thinkingEl(b.thinking));
        else if (b.type === 'tool_use') {
          addToolCard(b.id, b.name, b.input);
          trackTool(b.name, b.input, true);
          const r = results.get(b.id);
          if (r) {
            const content = Array.isArray(r.content) ? r.content.map((c) => (c.type === 'image' ? { type: 'image', src: `data:${c.source.media_type};base64,${c.source.data}` } : c)) : [{ type: 'text', text: String(r.content) }];
            finishToolCard(b.id, content, r.is_error);
            trackResult(content, true);
          }
        }
      }
    }
  }
  updateEmpty();
  scroll();
}

function addUser(text, imgs = [], files = []) {
  $('#messages').append(el('div', { class: 'msg user', dir: 'auto' }, text, ...imgs.map((src) => el('img', { src, alt: '' })),
    ...files.map((name) => el('div', { class: 'file-chip' }, `📎 ${name}`))));
  updateEmpty();
  scroll();
}

function appendText(delta) {
  if (!curText) {
    curText = { el: el('div', { class: 'msg assistant', dir: 'auto' }), buf: '' };
    $('#messages').append(curText.el);
    updateEmpty();
  }
  curText.buf += delta;
  const target = curText;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { target.el.innerHTML = renderMarkdown(target.buf); scroll(); }, 40);
}

// Sources the answer cites (web search results), shown under the message.
function addSources(sources = []) {
  const seen = new Set();
  const list = sources.filter((s) => s.url && !seen.has(s.url) && seen.add(s.url));
  if (!list.length) return;
  const box = el('div', { class: 'sources' }, el('span', { class: 'muted' }, t('sources')),
    ...list.slice(0, 8).map((s) => {
      let host = s.url;
      try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* keep */ }
      return el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.title || s.url }, host);
    }));
  $('#messages').append(box);
  scroll();
}

function thinkingEl(text) {
  return el('details', { class: 'thinking' }, el('summary', {}, t('thinking')), el('div', {}, text));
}

function appendThinking(delta) {
  if (!curThinking) {
    curThinking = thinkingEl('');
    $('#messages').append(curThinking);
    updateEmpty();
  }
  curThinking.querySelector('div').textContent += delta;
  scroll();
}

const TOOL_ICON = {
  computer: '⌖', navigate: '↗', read_page: '☰', find: '⌕', form_input: '✎', get_page_text: '¶', javascript_tool: 'JS',
  read_console_messages: '>_', read_network_requests: '⇅', upload_image: '⤒', file_upload: '⤒', resize_window: '⤢',
  gif_creator: 'GIF', browser_batch: '⋯', tabs_context_mcp: '▭', tabs_create_mcp: '+', tabs_close_mcp: '×', tabs_context: '▭',
  tabs_create: '+', update_plan: '✓', shortcuts_list: '/', shortcuts_execute: '/', turn_answer_start: '·',
  // Anthropic browser toolset members
  screenshot: '⌖', zoom: '⌕', left_click: '⌖', right_click: '⌖', middle_click: '⌖', double_click: '⌖', triple_click: '⌖',
  hover: '⌖', mouse_move: '⌖', left_click_drag: '⇢', left_mouse_down: '⌖', left_mouse_up: '⌖', scroll: '↕', scroll_to: '↕',
  type: '✎', key: '⌨', hold_key: '⌨', wait: '…', read_console: '>_', read_network: '⇅', javascript_exec: 'JS',
  new_tab: '+', list_tabs: '▭', switch_tab: '▭', close_tab: '×',
  // Server tools and memory
  web_search: '🔎', web_fetch: '↓', code_execution: '⚙', bash_code_execution: '⚙', text_editor_code_execution: '⚙',
  memory_save: '★', memory_forget: '☆', memory_search: '⌕', task_notes: '✎', task_steps: '☰', all_tabs: '▦',
  export_file: '⤓', skill_save: '⚡', delegate_tasks: '⫶', advisor: '✦', advisor_tool_result: '✦', desktop_task: '🖥',
};

function targetText(tg) {
  if (!tg) return '';
  return tg.type === 'ref' ? tg.ref : tg.type === 'coordinate' ? `(${tg.x}, ${tg.y})` : '';
}

function toolSummary(name, i = {}) {
  switch (name) {
    case 'computer': {
      const a = i.action;
      if (a === 'type') return `type “${String(i.text || '').slice(0, 50)}”`;
      if (a === 'key') return `key ${i.text}`;
      if (a === 'scroll') return `scroll ${i.scroll_direction || 'down'}`;
      if (a === 'wait') return `wait ${i.duration ?? 1}s`;
      return `${a}${i.ref ? ' ' + i.ref : i.coordinate ? ` (${i.coordinate.join(', ')})` : ''}`;
    }
    case 'navigate': return String(i.url || '');
    case 'find': return `“${i.query}”`;
    case 'form_input': return `${i.ref} = ${JSON.stringify(i.value).slice(0, 40)}`;
    case 'javascript_tool': return String(i.text || '').slice(0, 60);
    case 'browser_batch': return `${i.actions?.length || 0} actions`;
    case 'gif_creator': return i.action;
    case 'update_plan': return (i.domains || []).join(', ');
    case 'left_click': case 'right_click': case 'middle_click': case 'double_click': case 'triple_click':
    case 'hover': case 'mouse_move': case 'scroll_to': case 'left_mouse_down': case 'left_mouse_up':
      return targetText(i.target);
    case 'scroll': return `${i.scroll_direction || 'down'} ${targetText(i.target)}`;
    case 'type': return `“${String(i.text || '').slice(0, 50)}”`;
    case 'key': case 'hold_key': return String(i.text || '');
    case 'wait': return `${i.duration ?? 1}s`;
    case 'read_page': return i.filter || '';
    case 'switch_tab': case 'close_tab': return String(i.tab_id || '');
    case 'javascript_exec': return String(i.text || '').slice(0, 60);
    case 'web_search': return `“${i.query || ''}”`;
    case 'web_fetch': return String(i.url || '');
    case 'memory_save': return `“${String(i.text || '').slice(0, 60)}”`;
    case 'memory_forget': return String(i.id || '');
    case 'memory_search': return `“${String(i.query || '').slice(0, 60)}”`;
    case 'task_notes': return i.action || '';
    case 'task_steps': return i.action === 'plan' ? `${i.steps?.length || 0} steps` : `${i.action} ${i.step || ''}`;
    case 'export_file': return `${i.filename || i.title || ''}.${i.format || ''}`.replace(/^\./, '');
    case 'skill_save': return `/${String(i.command || '').replace(/^\//, '')}${i.schedule?.frequency ? ` · ${i.schedule.frequency}` : ''}`;
    case 'delegate_tasks': return `${i.tasks?.length || 0} helpers`;
    case 'desktop_task': return String(i.task || '').slice(0, 60);
    case 'all_tabs': return `${i.action}${i.match ? ` “${i.match}”` : i.duplicates ? ' duplicates' : i.tab_ids?.length ? ` ${i.tab_ids.length} tab(s)` : ''}`;
    default: return '';
  }
}

function addToolCard(id, name, input) {
  if (name === 'turn_answer_start' || name === 'task_steps') return;
  const card = el('details', { class: 'tool' },
    el('summary', {},
      el('span', { class: 'ico' }, TOOL_ICON[name] || '•'),
      el('span', { class: 'label' }, el('b', {}, name), ' ', toolSummary(name, input)),
      el('span', { class: 'st run muted' })),
    el('div', { class: 'body' }, el('pre', {}, JSON.stringify(input, null, 1))));
  toolCards.set(id, card);
  $('#messages').append(card);
  updateEmpty();
  scroll();
}

function finishToolCard(id, content = [], isError) {
  const card = toolCards.get(id);
  if (!card) return;
  const st = card.querySelector('.st');
  st.className = `st ${isError ? 'muted' : 'ok'}`;
  st.textContent = isError ? '✕' : '✓';
  if (isError) card.classList.add('err');
  const body = card.querySelector('.body');
  for (const c of content) {
    if (c.type === 'image' && c.src) {
      const img = el('img', { class: 'thumb', src: c.src, alt: '', onclick: () => window.open(c.src) });
      body.append(img);
      if (!isError && card.querySelector('.label b')?.textContent === 'computer') card.open = false;
    } else if (c.type === 'text' && c.text) {
      body.append(el('pre', {}, c.text.length > 4000 ? c.text.slice(0, 4000) + '…' : c.text));
    }
  }
  if (isError) card.open = true;
  scroll();
}

function addBanner(message, info = false) {
  $('#messages').append(el('div', { class: `banner${info ? ' info' : ''}` }, message));
  updateEmpty();
  scroll();
}

function addApproval(r) {
  const box = el('div', { class: 'approval', role: 'alertdialog' });
  const budget = r.permissionType === 'BUDGET';
  const answer = (a) => {
    port.postMessage({ type: 'permission_response', id: r.id, answer: a });
    box.classList.add('done');
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  };
  box.append(
    el('div', { class: 'head' }, el('img', { src: '../icons/icon32.png', width: 18, height: 18, alt: '' }), budget ? t('budgetTitle') : t('wantsTo'), budget ? null : el('span', { class: 'badge' }, r.permissionType || '')),
    el('div', { class: 'desc' }, r.description || ''),
    el('div', { class: 'site' }, r.netloc || r.url || ''),
    r.reason ? el('div', { class: 'reason' }, r.reason) : null,
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary small', onclick: () => answer('once') }, budget ? t('budgetContinue') : t('allowOnce')),
      r.allowAlways ? el('button', { class: 'btn small', onclick: () => answer('always') }, t('allowAlways')) : null,
      el('button', { class: 'btn danger small', onclick: () => answer('deny') }, budget ? t('budgetStop') : t('decline'))),
  );
  $('#messages').append(box);
  updateEmpty();
  scroll();
  closeViews(); // an approval needs the person's eyes on the conversation
  box.querySelector('.btn.primary').focus();
}

function addPlan(r) {
  const box = el('div', { class: 'approval', role: 'alertdialog' });
  const answer = (a) => {
    port.postMessage({ type: 'plan_response', id: r.id, answer: a });
    box.classList.add('done');
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  };
  box.append(
    el('div', { class: 'head' }, '✓ ', t('planTitle')),
    el('ol', {}, ...(r.approach || []).map((s) => el('li', {}, s))),
    el('div', { class: 'site' }, `${t('planSites')}: ${(r.domains || []).join(', ')}`),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary small', onclick: () => answer('approve') }, t('approvePlan')),
      el('button', { class: 'btn small', onclick: () => answer('deny') }, t('rejectPlan'))),
  );
  $('#messages').append(box);
  updateEmpty();
  scroll();
  closeViews();
}

// ---------------- the live execution center ----------------
function trackTool(name, input = {}, replay = false) {
  if (['turn_answer_start', 'task_steps', 'task_notes'].includes(name)) return;
  const line = `${name}${toolSummary(name, input) ? ` · ${toolSummary(name, input)}` : ''}`;
  live.now = line;
  live.actions = [...live.actions, line].slice(-8);
  if (!replay) refreshLive();
}

function trackResult(content = [], replay = false) {
  const img = (content || []).find((c) => c.type === 'image' && c.src);
  if (img) { live.shot = img.src; if (!replay) refreshLive(); }
}

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const elapsed = () => (live.startedAt ? (live.endedAt || Date.now()) - live.startedAt : 0);
const doneCount = () => live.steps.filter((x) => x.status === 'done').length;
const activeIndex = () => live.steps.findIndex((x) => x.status === 'active');

let tick = null;
function refreshLive() {
  // The strip above the conversation while a task runs.
  const strip = $('#liveStrip');
  const show = busy() && !$('#messages').hidden;
  strip.hidden = !show;
  strip.classList.toggle('paused', live.status === 'paused');
  const dot = $('#btnLive .dot');
  dot.hidden = !busy();
  dot.classList.toggle('paused', live.status === 'paused');
  if (show) {
    const ai = activeIndex();
    const total = live.steps.length;
    $('#lsStep').textContent = live.status === 'paused' ? (live.takenOver ? t('takeOver') : t('st_paused'))
      : ai >= 0 ? live.steps[ai].title : (live.now || t('st_running'));
    $('#lsMeta').textContent = [total ? t('stepOf', { n: ai >= 0 ? ai + 1 : doneCount(), m: total }) : '', mmss(elapsed()), live.site].filter(Boolean).join(' · ');
    $('#lsBar').style.width = total ? `${Math.round((doneCount() / total) * 100)}%` : '0%';
  }
  if (!$('#live').hidden) renderLive();
  // One timer for the elapsed time, only while something shows it.
  const need = busy() && (show || !$('#live').hidden);
  if (need && !tick) tick = setInterval(refreshLive, 1000);
  if (!need && tick) { clearInterval(tick); tick = null; }
}

function stepMark(x, i) {
  if (x.status === 'done') return ic('check', 15);
  if (x.status === 'failed') return ic('x', 15);
  return String(i + 1);
}

function renderLive() {
  const s = live.status;
  const pill = $('#livePill');
  const shown = s === 'idle' && live.lastStatus ? live.lastStatus : s;
  pill.className = `pill ${shown}`;
  pill.textContent = t(`st_${shown}`) || shown;
  const title = state?.session?.title || '';
  const body = $('#liveBody');
  if (!title && !busy()) {
    put(body, el('p', { class: 'empty-note' }, t('liveIdle')));
    put($('#liveFoot'), );
    return;
  }
  const meta = el('div', { class: 'live-meta' },
    live.site ? el('span', { title: live.url }, ic('globe', 12), live.site) : null,
    live.model ? el('span', {}, ic('sparkle', 12), shortModel(live.model)) : null,
    live.runCost > 0 ? el('span', {}, money(live.runCost, live.currency)) : null);
  const steps = live.steps.length
    ? el('ol', { class: 'steps', id: 'liveSteps' }, ...live.steps.map((x, i) => el('li', { class: `step ${x.status}` },
      el('span', { class: 'mark' }, stepMark(x, i)),
      el('div', {}, el('div', { class: 'st-t' }, x.title),
        el('div', { class: 'st-n' }, x.note || (x.status === 'active' ? t('st_running') : x.status === 'pending' ? '…' : t(`st_${x.status === 'failed' ? 'error' : x.status === 'skipped' ? 'stopped' : 'done'}`)))))))
    : el('div', { class: 'card item' }, el('p', { class: 'muted small', style: 'margin:0' }, t('noSteps')),
      live.actions.length ? el('ol', { class: 'small', style: 'margin:4px 0 0;padding-inline-start:18px' }, ...live.actions.map((a) => el('li', { dir: 'auto' }, a))) : null);
  const notes = live.takenOver ? el('div', { class: 'notice' }, ic('hand', 15), t('takenOverNote'))
    : s === 'paused' ? el('div', { class: 'notice' }, ic('pause', 15), t('pausedNote')) : null;
  put(body, 
    el('h3', { class: 'objective', dir: 'auto' }, title),
    meta,
    notes,
    live.shot ? el('div', { class: 'live-shot' }, el('img', { src: live.shot, alt: '' }), el('div', { class: 'cap', dir: 'auto' }, live.tabTitle || live.url || '')) : null,
    steps,
    busy() && live.now ? el('div', { class: 'live-now' }, ic('live', 15), el('b', {}, `${t('nowDoing')}:`), el('span', { dir: 'auto' }, live.now)) : null,
  );
  const total = live.steps.length;
  const ai = activeIndex();
  const stats = el('div', { class: 'foot-stats' },
    live.startedAt ? el('span', {}, `${t('elapsed')}: ${mmss(elapsed())}`) : el('span'),
    total ? el('span', {}, t('stepOf', { n: ai >= 0 ? ai + 1 : doneCount(), m: total })) : el('span'));
  let actions;
  if (busy()) {
    actions = el('div', { class: 'foot-actions' },
      live.takenOver
        ? el('button', { class: 'btn primary', id: 'liveGiveBack', onclick: () => call('resume') }, ic('play'), t('giveBack'))
        : el('button', { class: 'btn', id: 'liveTakeOver', onclick: () => call('take_over') }, ic('hand'), t('takeOver')),
      s === 'paused'
        ? (live.takenOver ? el('span') : el('button', { class: 'btn primary', id: 'liveResume', onclick: () => call('resume') }, ic('play'), t('resume')))
        : el('button', { class: 'btn', id: 'livePause', onclick: () => call('pause') }, ic('pause'), t('pause')),
      el('button', { class: 'btn danger', id: 'liveStop', onclick: () => call('stop') }, ic('stop'), t('stop')));
  } else {
    actions = el('div', { class: 'foot-actions' },
      el('button', { class: 'btn', id: 'liveRetry', onclick: () => { closeViews(); send(s === 'stopped' || s === 'error' ? (currentLang() === 'ar' ? 'تابع المهمة من حيث توقفت.' : 'Continue the task from where you stopped.') : lastUserText); }, disabled: !lastUserText }, ic('refresh'), s === 'stopped' || s === 'error' ? t('continueTask') : t('retry')),
      el('button', { class: 'btn', id: 'liveExport', onclick: exportResults }, ic('download'), t('exportResults')),
      el('button', { class: 'btn primary', onclick: closeViews }, ic('eye'), t('details')));
  }
  put($('#liveFoot'), stats, actions);
}

function openLive() {
  closeDrawer();
  $('#live').hidden = false;
  setRail('btnLive');
  renderLive();
  refreshLive();
}
function closeLive() { $('#live').hidden = true; refreshLive(); }
$('#liveClose').addEventListener('click', () => { closeLive(); setRail('btnHome'); });
$('#liveStrip').addEventListener('click', openLive);
$('#btnLive').addEventListener('click', openLive);

// The task's results as a Markdown file: the objective, every step with its evidence, and the answer.
function exportResults() {
  const msgs = state?.messages || [];
  const lastAnswer = [...msgs].reverse().find((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b) => b.type === 'text' && b.text.trim()));
  const answer = (lastAnswer?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n\n') || [...$('#messages').querySelectorAll('.msg.assistant')].map((e) => e.innerText).pop() || '';
  const mark = { done: '✅', failed: '❌', active: '▶️', pending: '⬜', skipped: '⏭️' };
  const lines = [
    `# ${state?.session?.title || 'Infera Agent Web task'}`, '',
    `- ${t('st_' + live.status) || live.status} · ${new Date().toLocaleString()}`,
    live.site ? `- ${t('site')}: ${live.url || live.site}` : '',
    live.startedAt ? `- ${t('elapsed')}: ${mmss(elapsed())}` : '',
    live.runCost > 0 ? `- ${t('cost')}: ${money(live.runCost, live.currency)}` : '', '',
    live.steps.length ? `## ${t('wfSteps')}\n\n${live.steps.map((x, i) => `${i + 1}. ${mark[x.status] || ''} ${x.title}${x.note ? ` — ${x.note}` : ''}`).join('\n')}\n` : '',
    answer ? `## ${currentLang() === 'ar' ? 'النتيجة' : 'Result'}\n\n${answer}\n` : '',
    '---', 'Infera Agent Web · Infera Engine Ltd, London',
  ].filter((x) => x !== '');
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${(state?.session?.title || 'task').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60).trim() || 'task'}.md` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------- home ----------------
const QUICK_ACTIONS = [['open', 'globe'], ['login', 'login'], ['form', 'form'], ['upload', 'upload'], ['extract', 'table'], ['track', 'track'], ['compare', 'compare'], ['report', 'report'], ['more', 'more']];
const QUICK_TASKS = [['submit', 'form'], ['status', 'track'], ['collect', 'globe'], ['table', 'table'], ['prices', 'compare'], ['saved', 'workflow']];

function prefill(text) {
  input.value = text;
  autosize();
  input.focus();
  // Put the cursor on the first [placeholder] to fill in.
  const i = text.indexOf('[');
  const j = i >= 0 ? text.indexOf(']', i) : -1;
  if (i >= 0 && j > i) input.setSelectionRange(i, j + 1); else input.setSelectionRange(text.length, text.length);
}

function buildHome() {
  put($('#examples'), ...QUICK_ACTIONS.map(([k, i]) => el('button', { class: 'qa', type: 'button', 'data-qa': k, onclick: () => (k === 'more' ? openStudio('templates') : prefill(t(`qa_${k}_p`))) }, ic(i), t(`qa_${k}`))));
  put($('#quickTasks'), el('h3', {}, t('quickTasks')), ...QUICK_TASKS.map(([k, i]) => el('button', { class: 'qt', type: 'button', onclick: () => (k === 'saved' ? openStudio('saved') : prefill(t(`qt_${k}_p`))) },
    el('span', { class: 'qt-ic' }, ic(i)), el('span', { class: 'grow' }, el('b', {}, t(`qt_${k}`)), k === 'saved' ? el('div', { class: 'muted small' }, t('qt_saved_s')) : null), icon('chevron', { cls: 'chev' }))));
}

// ---------------- composer ----------------
const input = $('#input');

function autosize() { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; }

async function send(textOverride) {
  let text = (textOverride ?? input.value).trim();
  if (!text && !attachments.length) return;
  const m = text.match(/^\/([\w-]+)\s*([\s\S]*)$/);
  if (m) {
    const sc = (state.shortcuts || []).find((s) => s.command === m[1].toLowerCase());
    if (sc) {
      let p = sc.prompt;
      const params = sc.params || [];
      params.forEach((prm, idx) => { p = p.split(`{{${prm.name}}}`).join(idx === 0 && m[2] ? m[2] : (prm.default ?? '')); });
      if (m[2] && !params.length) p += `\n\nAdditional details: ${m[2]}`;
      if (sc.startUrl) p = `Start at ${sc.startUrl}.\n\n${p}`;
      text = p;
    }
  }
  const atts = attachments;
  attachments = [];
  renderAttachments();
  input.value = '';
  autosize();
  hideSlash();
  lastUserText = text;
  addUser(text, atts.filter((a) => a.kind !== 'file' || a.mediaType.startsWith('image/')).map((a) => `data:${a.mediaType};base64,${a.base64}`),
    atts.filter((a) => a.kind === 'file').map((a) => a.name));
  try { await call('send', { text, attachments: atts }); } catch (e) { addBanner(e.message); }
}

$('#btnSend').addEventListener('click', () => send());
$('#btnStop').addEventListener('click', () => call('stop'));
input.addEventListener('input', () => { autosize(); updateSlash(); });
input.addEventListener('keydown', (e) => {
  const menu = $('#slashMenu');
  if (!menu.hidden) {
    const items = [...menu.querySelectorAll('button')];
    const idx = items.findIndex((b) => b.classList.contains('active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length ? (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : -1;
      items.forEach((b, i) => b.classList.toggle('active', i === n));
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && items.length) { e.preventDefault(); (items[idx] || items[0]).click(); return; }
    if (e.key === 'Escape') { hideSlash(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
input.addEventListener('paste', async (e) => {
  for (const item of e.clipboardData?.items || []) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile();
      const b64 = await fileToB64(f);
      attachments.push({ mediaType: f.type, base64: b64 });
      renderAttachments();
    }
  }
});

function updateSlash() {
  const v = input.value;
  const m = v.match(/^\/([\w-]*)$/);
  if (!m) return hideSlash();
  const list = (state.shortcuts || []).filter((s) => s.command.startsWith(m[1].toLowerCase()));
  const menu = $('#slashMenu');
  if (!list.length) return hideSlash();
  put(menu, ...list.map((s, i) => el('button', { class: i === 0 ? 'active' : '', onclick: () => { input.value = `/${s.command} `; hideSlash(); input.focus(); } },
    el('b', {}, `/${s.command}`), ' ', el('span', { class: 'muted' }, s.description || s.prompt.slice(0, 60)))));
  menu.hidden = false;
}
function hideSlash() { $('#slashMenu').hidden = true; }

$('#modelSel').addEventListener('change', async (e) => {
  const v = e.target.value;
  if (v.startsWith('op:')) { await call('set_operating_mode', { mode: v.slice(3) }); state.settings.operatingMode = v.slice(3); } else { await call('set_model', { model: v }); state.settings.operatingMode = 'manual'; state.settings.model = v; }
});
$('#modeSel').addEventListener('change', (e) => call('set_mode', { mode: e.target.value }));
$('#btnNew').addEventListener('click', async () => { closeViews(); loadState(await call('new_chat')); });
$('#btnSettings').addEventListener('click', () => call('open_settings'));
$('#btnHome').addEventListener('click', () => { closeViews(); setRail('btnHome'); input.focus(); });

// ---------------- attachments & region capture ----------------
function fileToB64(file) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
}

function renderAttachments() {
  put($('#attachments'), ...attachments.map((a, i) => el('div', { class: `att${a.kind === 'file' && !a.mediaType.startsWith('image/') ? ' file' : ''}`, title: a.name || '' },
    a.kind === 'file' && !a.mediaType.startsWith('image/')
      ? el('span', { class: 'fname' }, `📎 ${a.name}`)
      : el('img', { src: `data:${a.mediaType};base64,${a.base64}`, alt: '' }),
    el('button', { onclick: () => { attachments.splice(i, 1); renderAttachments(); }, 'aria-label': 'remove' }, '×'))));
}

// Files from the device: the agent can read PDFs/text/images and upload them to pages.
const FILE_LIMIT = 10 * 1024 * 1024;
$('#btnFile').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (e) => {
  let total = attachments.reduce((n, a) => n + (a.size || 0), 0);
  for (const f of e.target.files) {
    if (total + f.size > FILE_LIMIT) { addBanner(t('fileTooBig')); break; }
    total += f.size;
    attachments.push({ kind: 'file', name: f.name, mediaType: f.type || 'application/octet-stream', size: f.size, base64: await fileToB64(f) });
  }
  e.target.value = '';
  renderAttachments();
});

$('#btnAttach').addEventListener('click', async () => {
  let dataUrl;
  try { dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }); } catch (e) { addBanner(e.message); return; }
  const dlg = $('#captureDlg');
  const img = $('#captureImg');
  const sel = $('#captureSel');
  img.src = dataUrl;
  sel.hidden = true;
  let start = null;
  let rect = null;
  const stage = img.parentElement;
  stage.onpointerdown = (e) => { const b = img.getBoundingClientRect(); start = [e.clientX - b.left, e.clientY - b.top]; stage.setPointerCapture(e.pointerId); };
  stage.onpointermove = (e) => {
    if (!start) return;
    const b = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(b.width, e.clientX - b.left));
    const y = Math.max(0, Math.min(b.height, e.clientY - b.top));
    rect = [Math.min(start[0], x), Math.min(start[1], y), Math.abs(x - start[0]), Math.abs(y - start[1])];
    Object.assign(sel.style, { left: rect[0] + 'px', top: rect[1] + 'px', width: rect[2] + 'px', height: rect[3] + 'px' });
    sel.hidden = false;
  };
  stage.onpointerup = () => { start = null; };
  const finish = async (useRegion) => {
    dlg.close();
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    let [sx, sy, sw, sh] = [0, 0, bmp.width, bmp.height];
    if (useRegion && rect && rect[2] > 8 && rect[3] > 8) {
      const k = bmp.width / img.getBoundingClientRect().width;
      [sx, sy, sw, sh] = rect.map((v) => Math.round(v * k));
    }
    const scale = Math.min(1, 1568 / Math.max(sw, sh));
    const c = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    attachments.push({ mediaType: 'image/jpeg', base64: await fileToB64(blob) });
    renderAttachments();
  };
  $('#capCancel').onclick = () => dlg.close();
  $('#capFull').onclick = () => finish(false);
  $('#capRegion').onclick = () => finish(true);
  dlg.showModal();
});

// ---------------- navigation, drawers ----------------
function setRail(id) { document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('on', b.id === id)); }
function openDrawer(title, body, railId) {
  $('#live').hidden = true;
  $('#drawerTitle').textContent = title;
  put($('#drawerBody'), ...[].concat(body).filter(Boolean));
  $('#drawer').hidden = false;
  if (railId) setRail(railId);
  refreshLive();
}
function closeDrawer() { $('#drawer').hidden = true; }
function closeViews() { closeDrawer(); $('#live').hidden = true; setRail('btnHome'); refreshLive(); }
$('#drawerClose').addEventListener('click', closeViews);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (!$('#drawer').hidden || !$('#live').hidden)) closeViews(); });

const fmt = (ts) => (ts ? new Date(ts).toLocaleString(currentLang() === 'ar' ? 'ar' : undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const money = (n, cur = '') => { const v = Number(n) || 0; return `${v > 0 && v < 0.01 ? v.toFixed(4) : v.toFixed(2)}${cur ? ` ${cur}` : ''}`; };
const shortModel = (m) => String(m || '').replace(/^claude-/, 'Claude ').replace(/-(\d)-(\d)/, ' $1.$2').replace(/-(\d)\b/, ' $1').replace(/\[advisor\]/, ' + advisor').replace(/\[fast\]/, ' fast').replace(/(^| )(\w)/g, (x) => x.toUpperCase());

// ---------------- task history ----------------
const STATUS_IC = { done: 'check', error: 'x', running: 'live', waiting: 'clock', paused: 'pause', stopped: 'stop', idle: 'clock' };
const statusBadge = (s) => el('span', { class: `badge ${s === 'done' ? 'ok' : s === 'error' ? 'danger' : busy(s) ? 'warn' : ''}` }, t(`st_${s}`) || s || '');

const historyItem = (c) => el('div', { class: 'card hcard item click', onclick: async () => { closeViews(); loadState(await call('load_conversation', { id: c.id })); } },
  el('div', { class: 'grow', style: 'display:grid;gap:4px;min-width:0' },
    el('div', { class: 'h-top' }, el('span', { class: `status-ic ${c.status || 'idle'}` }, ic(STATUS_IC[c.status] || 'clock')), el('span', { class: 'grow' }), statusBadge(c.status || 'idle')),
    el('div', { class: 'h-title t', dir: 'auto' }, c.kind === 'scheduled' ? `⏰ ${c.title}` : c.title || t('untitled')),
    el('div', { class: 'h-sub s' },
      c.site ? el('span', { class: 'h-site' }, c.site) : null,
      el('span', {}, `${fmt(c.updatedAt)}${c.steps ? ` · ${t('stepsDone', { n: c.stepsDone || 0, m: c.steps })}` : ''}${c.cost > 0 ? ` · ${money(c.cost, c.currency)}` : ''}${c.remote ? ` · ${t('fromAccount')}` : ''}`)),
    el('div', { class: 'h-actions' },
      el('button', { class: 'btn small', onclick: async (e) => { e.stopPropagation(); closeViews(); loadState(await call('load_conversation', { id: c.id })); } }, t('view')),
      el('button', { class: 'icon-btn', 'aria-label': t('delete'), title: t('delete'), onclick: async (e) => { e.stopPropagation(); loadState(await call('delete_conversation', { id: c.id })); $('#btnHistory').click(); } }, ic('trash', 16)))),
  c.thumb ? el('img', { class: 'h-thumb', src: c.thumb, alt: '' }) : el('div', { class: 'h-ph' }, ic('globe', 18)));

$('#btnHistory').addEventListener('click', async () => {
  const list = el('div', { id: 'historyList', style: 'display:grid;gap:8px' }, el('p', { class: 'muted' }, '…'));
  const more = el('button', { class: 'btn', hidden: true }, t('loadMore'));
  const search = el('input', { type: 'search', id: 'historySearch', placeholder: t('searchHistory') });
  const fStatus = el('select', { id: 'historyStatus' }, el('option', { value: '' }, t('allStatuses')),
    ...['done', 'running', 'paused', 'error', 'stopped'].map((s) => el('option', { value: s }, t(`st_${s}`))));
  const fSite = el('select', { id: 'historySite' }, el('option', { value: '' }, t('allSites')));
  let q = '';
  let next = 0;
  let seen = new Set();
  let all = [];
  const paint = () => {
    const shown = all.filter((c) => (!fStatus.value || (fStatus.value === 'running' ? busy(c.status) && c.status !== 'paused' : c.status === fStatus.value)) && (!fSite.value || c.site === fSite.value));
    put(list, ...(shown.length ? shown.map(historyItem) : [el('p', { class: 'empty-note' }, q || fStatus.value || fSite.value ? t('noMatches') : t('noHistory'))]));
    const sites = [...new Set(all.map((c) => c.site).filter(Boolean))].sort();
    const cur = fSite.value;
    put(fSite, el('option', { value: '' }, t('allSites')), ...sites.map((s) => el('option', { value: s }, s)));
    fSite.value = sites.includes(cur) ? cur : '';
  };
  const load = async (reset) => {
    if (reset) { next = 0; seen = new Set(); all = []; }
    let page = { items: [], more: false, next: 0 };
    try { page = await call('history_list', { q, offset: next, paged: true }); } catch { await refreshConversations(); page.items = state.conversations || []; }
    const fresh = page.items.filter((c) => !seen.has(c.id));
    fresh.forEach((c) => seen.add(c.id));
    all = [...all, ...fresh];
    paint();
    next = page.next;
    more.hidden = !page.more;
  };
  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(true); }, 300); });
  fStatus.addEventListener('change', paint);
  fSite.addEventListener('change', paint);
  more.addEventListener('click', () => load(false));
  openDrawer(t('taskHistory'), [search, el('div', { class: 'filters' }, fStatus, fSite), list, more], 'btnHistory');
  search.focus();
  await load(true);
});

// ---------------- usage & costs ----------------
// What the open conversation has cost so far, next to the status.
function showCost(amount, currency) {
  const c = $('#taskCost');
  c.hidden = !(amount > 0);
  if (amount > 0) { c.textContent = `· ${money(amount, currency)}`; c.title = t('thisTask'); }
}

function stat(label, value) { return el('div', { class: 'stat' }, el('span', { class: 'muted' }, label), el('b', {}, value)); }

let costPeriod = 'today';
async function openCosts() {
  openDrawer(t('usageTitle'), el('p', { class: 'muted' }, '…'), 'btnCosts');
  let d;
  try { d = await call('cost_log', { days: 60 }); } catch (e) { return openDrawer(t('usageTitle'), el('p', { class: 'si-error' }, e.message), 'btnCosts'); }
  renderCosts(d);
}

const MODEL_COLORS = ['#6a7bff', '#8b3dff', '#2f9bff', '#2fd27f', '#ffb547', '#ff5c7a'];
const DAY = 86_400_000;
function periodRange(p, now = Date.now()) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  if (p === 'today') return { from: midnight.getTime(), to: now, len: now - midnight.getTime() || 1, buckets: 24, unit: 3_600_000, label: (i) => `${i}:00` };
  const days = p === 'week' ? 7 : 30;
  const from = midnight.getTime() - (days - 1) * DAY;
  return { from, to: now, len: now - from, buckets: days, unit: DAY, label: (i) => new Date(from + i * DAY).toLocaleDateString(currentLang() === 'ar' ? 'ar' : undefined, { day: 'numeric', month: 'short' }) };
}

function renderCosts(d) {
  const srv = d.server;
  const cur = srv?.currency || state?.auth?.currency || '';
  const rows = (srv?.rows || []).map((r) => ({ ...r, ts: typeof r.at === 'number' ? r.at : Date.parse(r.at) }));
  const parts = [];

  // Period, total and the change against the period before.
  const seg = el('div', { class: 'seg', id: 'costPeriod' }, ...['today', 'week', 'month'].map((p) => el('button', { class: p === costPeriod ? 'on' : '', onclick: () => { costPeriod = p; renderCosts(d); } }, t(`period_${p}`))));
  parts.push(seg);
  const R = periodRange(costPeriod);
  const inP = rows.filter((r) => r.ts >= R.from && r.ts <= R.to);
  const prev = rows.filter((r) => r.ts >= R.from - R.len && r.ts < R.from);
  const total = inP.reduce((a, r) => a + r.amount, 0);
  const prevTotal = prev.reduce((a, r) => a + r.amount, 0);
  const delta = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  const buckets = Array.from({ length: R.buckets }, () => 0);
  for (const r of inP) {
    const i = costPeriod === 'today' ? new Date(r.ts).getHours() : Math.floor((r.ts - R.from) / DAY);
    if (i >= 0 && i < buckets.length) buckets[i] += r.amount;
  }
  const max = Math.max(...buckets, 0);
  parts.push(el('div', { class: 'card kpi', id: 'costTotal' },
    el('span', { class: 'k' }, t('totalCost')),
    el('span', { class: 'v' }, money(total, cur), delta !== null ? el('span', { class: `delta ${delta > 0 ? 'up' : 'down'}`, title: t('vsPrev') }, `${delta > 0 ? '+' : ''}${delta}%`) : null),
    el('div', { class: 'bars', role: 'img', 'aria-label': t('perDay') }, ...buckets.map((v, i) => el('span', { class: `b${v ? '' : ' zero'}`, style: `height:${v ? Math.max(6, Math.round((v / (max || 1)) * 100)) : 4}%`, title: `${R.label(i)} · ${money(v, cur)}` }))),
    el('div', { class: 'bars-x' }, el('span', {}, R.label(0)), el('span', {}, R.label(Math.floor((R.buckets - 1) / 2))), el('span', {}, R.label(R.buckets - 1)))));

  // By model.
  const byModel = new Map();
  for (const r of inP) { const k = r.kind === 'search' ? (currentLang() === 'ar' ? 'بحث الويب' : 'Web search') : shortModel(r.model); byModel.set(k, (byModel.get(k) || 0) + r.amount); }
  const ms = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
  if (ms.length) {
    parts.push(el('b', { class: 'section-title' }, t('byModel')));
    parts.push(el('div', { class: 'card models', id: 'costModels' }, ...ms.map(([name, v], i) => {
      const pct = total > 0 ? Math.round((v / total) * 100) : 0;
      const color = MODEL_COLORS[i % MODEL_COLORS.length];
      return el('div', { class: 'mrow' }, el('span', { class: 'mname' }, el('i', { style: `background:${color}` }), name),
        el('span', { class: 'mbar' }, el('span', { style: `width:${pct}%;background:${color}` })), el('span', { class: 'mval' }, `${pct}% · ${money(v, cur)}`));
    })));
  }

  // Totals
  parts.push(el('div', { class: 'card cost-stats' },
    srv?.balance !== null && srv?.balance !== undefined ? stat(t('balance'), money(srv.balance, cur)) : null,
    stat(t('today'), money(srv ? srv.today : d.spentToday, cur)),
    srv ? stat(t('thisMonth'), money(srv.month, cur)) : null));
  if (d.error) parts.push(el('p', { class: 'muted small' }, `${t('costsLocalOnly')} (${d.error})`));

  // How much of the history came from the prompt cache (a tenth of the price).
  const tok = rows.reduce((a, r) => ({ input: a.input + r.input, read: a.read + r.cacheRead, write: a.write + r.cacheWrite }), { input: 0, read: 0, write: 0 });
  const totalIn = tok.input + tok.read + tok.write;
  if (totalIn > 0) parts.push(el('p', { class: 'muted small' }, `${t('cacheSaved')}: ${Math.round((tok.read / totalIn) * 100)}%`));

  // Limits and cost settings
  const s = d.settings;
  const taskIn = el('input', { type: 'number', min: '0', step: '0.5', value: s.taskBudget ?? 0 });
  const lim = d.limits;
  const dayIn = el('input', { type: 'number', min: '0', step: '0.5', value: lim?.daily ?? 0, disabled: lim ? undefined : true });
  const effortSel = el('select', {}, ...['low', 'medium', 'high', 'xhigh'].map((e) => el('option', { value: e, selected: s.effort === e ? true : undefined }, t(`effort_${e}`))));
  const webChk = el('input', { type: 'checkbox', checked: s.webResearch ? true : undefined });
  const saved = el('span', { class: 'muted small' });
  parts.push(el('div', { class: 'card form' },
    el('b', {}, t('limits')),
    el('label', {}, `${t('taskLimit')} (${cur})`, taskIn), el('p', { class: 'muted small', style: 'margin:0' }, t('taskLimitHint')),
    el('label', {}, `${t('dailyLimit')} (${lim?.currency || cur})`, dayIn),
    el('p', { class: 'muted small', style: 'margin:0' }, `${t(lim?.owner ? 'dailyLimitOwnerHint' : 'dailyLimitHint')}${lim ? ` ${t('spentToday')}: ${money(lim.spentToday, lim.currency)}.` : ''}`),
    el('label', {}, t('effortLabel'), effortSel), el('p', { class: 'muted small', style: 'margin:0' }, t('effortHint')),
    el('div', { class: 'check-row' }, webChk, el('span', {}, t('webResearchLabel'))),
    el('div', { class: 'row' }, el('button', { class: 'btn primary small', id: 'saveLimits', onclick: async () => {
      const nd = await call('set_budgets', { taskBudget: taskIn.value, ...(lim ? { dailyBudget: dayIn.value } : {}), effort: effortSel.value, webResearch: webChk.checked, days: 60 });
      renderCosts(nd);
    } }, t('save')), saved)));

  // By task
  const byTask = new Map();
  for (const r of rows.filter((x) => x.ts >= Date.now() - 30 * DAY)) {
    const k = r.task || t('untitled');
    const g = byTask.get(k) || { task: k, amount: 0, calls: 0, searches: 0, last: r.at };
    g.amount += r.amount; g.calls += r.kind === 'model' ? 1 : 0; g.searches += r.searches;
    byTask.set(k, g);
  }
  if (byTask.size) {
    parts.push(el('b', { class: 'section-title' }, t('byTask')));
    parts.push(...[...byTask.values()].slice(0, 30).map((g) => el('div', { class: 'card item' },
      el('div', { class: 'row' }, el('div', { class: 't grow', dir: 'auto' }, g.task), el('b', {}, money(g.amount, cur))),
      el('div', { class: 's' }, `${fmt(g.last)} · ${g.calls} ${t('calls')}${g.searches ? ` · ${g.searches} ${t('searches')}` : ''}`))));
  } else if (d.conversations?.length) {
    parts.push(el('b', { class: 'section-title' }, t('byTask')));
    parts.push(...d.conversations.slice(0, 30).map((c) => el('div', { class: 'card item' },
      el('div', { class: 'row' }, el('div', { class: 't grow' }, c.title), el('b', {}, money(c.cost, c.currency))),
      el('div', { class: 's' }, fmt(c.updatedAt)))));
  } else {
    parts.push(el('p', { class: 'muted' }, t('noCosts')));
  }

  // Operations log
  if (rows.length) {
    const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
    parts.push(el('details', { class: 'ops' }, el('summary', {}, `${t('operations')} (${rows.length})`),
      el('table', { class: 'ops-table' }, el('tbody', {}, ...rows.slice(0, 200).map((r) => el('tr', {},
        el('td', { class: 'muted' }, new Date(r.ts).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
        el('td', {}, r.kind === 'search' ? `🔎 ${r.searches} ${t('searches')}` : shortModel(r.model), el('div', { class: 'muted small' }, r.task || '')),
        el('td', { class: 'muted small' }, r.kind === 'search' ? '' : `${k(r.input + r.cacheRead + r.cacheWrite)} → ${k(r.output)}`),
        el('td', {}, money(r.amount, ''))))))));
  }
  openDrawer(t('usageTitle'), parts, 'btnCosts');
}

$('#btnCosts').addEventListener('click', openCosts);

// ---------------- workflow studio ----------------
// Saved workflows (the "/" shortcuts), ready-made templates, schedules and recording.
const KIND_PREFIX = { do: '', if: 'If ', each: 'For each ', wait: 'Wait until ', check: 'Verify that ' };
const KIND_ICON = { do: 'play', if: 'branch', each: 'loop', wait: 'clock', check: 'check' };

function compileSteps(steps) {
  return steps.filter((s) => s.text.trim()).map((s, i) => `${i + 1}. ${KIND_PREFIX[s.kind] || ''}${s.text.trim()}`).join('\n');
}
function stepsFromPrompt(prompt = '') {
  const lines = String(prompt).split('\n');
  const steps = [];
  for (const line of lines) {
    const m = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) {
      let text = m[1];
      let kind = 'do';
      for (const [k, p] of Object.entries(KIND_PREFIX)) if (p && text.startsWith(p)) { kind = k; text = text.slice(p.length); break; }
      steps.push({ kind, text });
    } else if (line.trim() && steps.length) steps[steps.length - 1].text += `\n${line}`;
  }
  return steps.length ? steps : [{ kind: 'do', text: String(prompt).trim() }];
}

const TEMPLATES = () => [
  { key: 'submit', icon: 'form', command: currentLang() === 'ar' ? 'تقديم-طلب' : 'submit-request', steps: currentLang() === 'ar'
    ? ['افتح {{site}} وسجّل الدخول (إن طُلب منك تسجيل الدخول أو رمز تحقق، أوقف التنفيذ واطلب مني إكماله)', 'ابدأ طلبًا جديدًا من نوع {{request_type}}', 'املأ الحقول بالبيانات: {{details}}', 'ارفع المستندات المرفقة في الحقول المناسبة', 'راجع كل الحقول وتوقف قبل الإرسال النهائي واعرض عليّ ملخصًا']
    : ['Open {{site}} and sign in (if a login or verification code is needed, pause and ask me to complete it)', 'Start a new {{request_type}} request', 'Fill in the fields with: {{details}}', 'Upload the attached documents to the matching fields', 'Review every field and stop before the final submit; show me a summary'] },
  { key: 'status', icon: 'track', command: currentLang() === 'ar' ? 'متابعة-طلب' : 'track-request', steps: currentLang() === 'ar'
    ? ['افتح {{site}} وسجّل الدخول', 'اذهب إلى قائمة الطلبات وابحث عن الطلب رقم {{number}}', 'اقرأ حالته الحالية وآخر تحديث وأي إجراء مطلوب', 'أخبرني بالنتيجة باختصار مع رابط الطلب']
    : ['Open {{site}} and sign in', 'Go to the requests list and find request {{number}}', 'Read its current status, last update and any action needed', 'Tell me the result briefly with the link to the request'] },
  { key: 'collect', icon: 'table', command: currentLang() === 'ar' ? 'جمع-بيانات' : 'collect-data', steps: currentLang() === 'ar'
    ? ['افتح {{site}} وابحث عن {{query}}', 'لكل صفحة من صفحات النتائج: اجمع {{fields}}', 'تحقّق من عدم وجود صفوف مكررة', 'صدّر النتائج إلى ملف Excel']
    : ['Open {{site}} and search for {{query}}', 'For each page of results: collect {{fields}}', 'Verify there are no duplicate rows', 'Export the results to an Excel file'] },
  { key: 'prices', icon: 'compare', command: currentLang() === 'ar' ? 'مقارنة-أسعار' : 'compare-prices', steps: currentLang() === 'ar'
    ? ['ابحث عن {{product}} في {{sites}}', 'لكل موقع: سجّل السعر وتكلفة التوصيل والتوفر', 'اعرض جدول مقارنة وحدد الأرخص']
    : ['Search for {{product}} on {{sites}}', 'For each site: note the price, delivery cost and availability', 'Show a comparison table and point out the cheapest'] },
  { key: 'monitor', icon: 'eye', command: currentLang() === 'ar' ? 'مراقبة-صفحة' : 'monitor-page', steps: currentLang() === 'ar'
    ? ['افتح {{url}}', 'إذا تغيّر {{what}} عن آخر مرة في ملاحظاتك، أخبرني بالتغيير', 'احفظ القيمة الحالية في الذاكرة للمقارنة القادمة']
    : ['Open {{url}}', 'If {{what}} changed since the last time in your notes, tell me what changed', 'Save the current value to memory for the next comparison'] },
  { key: 'invoices', icon: 'download', command: currentLang() === 'ar' ? 'تنزيل-فواتير' : 'download-invoices', steps: currentLang() === 'ar'
    ? ['افتح {{site}} وسجّل الدخول', 'اذهب إلى صفحة الفواتير لشهر {{month}}', 'لكل فاتورة: نزّلها بصيغة PDF', 'أعطني قائمة بالفواتير والمبالغ']
    : ['Open {{site}} and sign in', 'Go to the invoices page for {{month}}', 'For each invoice: download it as PDF', 'Give me a list of the invoices and amounts'] },
];
const tplTitle = (k) => ({ submit: t('qt_submit'), status: t('qt_status'), collect: t('qt_collect'), prices: t('qt_prices'), monitor: currentLang() === 'ar' ? 'مراقبة تغيّر صفحة' : 'Monitor a page for changes', invoices: currentLang() === 'ar' ? 'تنزيل الفواتير الشهرية' : 'Download monthly invoices' })[k];

let studioTab = 'saved';
function openStudio(tab = studioTab) {
  studioTab = tab;
  const tabs = el('div', { class: 'seg studio-tabs' }, ...[['saved', 'wfSaved'], ['templates', 'wfTemplates'], ['schedules', 'wfSchedules'], ['record', 'wfRecord']]
    .map(([k, label]) => el('button', { class: k === tab ? 'on' : '', id: `studio_${k}`, onclick: () => openStudio(k) }, t(label))));
  const body = el('div', { style: 'display:grid;gap:8px' }, el('p', { class: 'muted' }, '…'));
  openDrawer(t('studio'), [tabs, body], 'btnStudio');
  const fill = { saved: savedTab, templates: templatesTab, schedules: schedulesTab, record: recordTab }[tab];
  Promise.resolve(fill()).then((kids) => put(body, ...[].concat(kids).filter(Boolean))).catch((e) => put(body, el('p', { class: 'si-error' }, e.message)));
}
$('#btnStudio').addEventListener('click', () => openStudio());

async function savedTab() {
  state.shortcuts = await call('list_shortcuts');
  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => importWorkflows(e.target.files[0]) });
  const items = state.shortcuts.map((s) => el('div', { class: 'card wf' },
    el('div', { class: 'wf-head' }, el('span', { class: 'wf-ic' }, ic(s.isWorkflow ? 'record' : 'workflow')),
      el('div', { class: 'grow' }, el('div', { class: 't' }, `/${s.command}`), el('div', { class: 's', dir: 'auto' }, s.description || s.prompt.slice(0, 120))),
      s.isWorkflow ? el('span', { class: 'badge' }, 'workflow') : null),
    el('div', { class: 'wf-actions' },
      el('button', { class: 'btn small primary', onclick: () => { closeViews(); send(`/${s.command}`); } }, ic('play'), t('run')),
      el('button', { class: 'btn small', onclick: () => openEditor(s) }, ic('edit'), t('edit')),
      el('button', { class: 'btn small', onclick: () => showTaskForm({ name: s.command, prompt: s.prompt, startUrl: s.startUrl }) }, ic('calendar'), t('schedule')),
      el('button', { class: 'btn small', onclick: () => exportWorkflows([s]) }, ic('download'), t('wfExport')),
      el('button', { class: 'btn small danger', onclick: async () => { await call('delete_shortcut', { id: s.id }); openStudio('saved'); } }, ic('trash'), t('delete')))));
  return [
    el('div', { class: 'row' },
      el('button', { class: 'btn primary grow', id: 'wfNew', onclick: () => openEditor({}) }, ic('plus'), t('wfNew')),
      el('button', { class: 'btn', onclick: () => importInput.click() }, ic('upload'), t('wfImport')),
      state.shortcuts.length ? el('button', { class: 'btn', onclick: () => exportWorkflows(state.shortcuts) }, ic('download'), t('wfExport')) : null),
    importInput,
    ...(items.length ? items : [el('p', { class: 'empty-note' }, t('noShortcuts'))]),
  ];
}

function templatesTab() {
  return TEMPLATES().map((tp) => el('div', { class: 'card wf' },
    el('div', { class: 'wf-head' }, el('span', { class: 'wf-ic' }, ic(tp.icon)),
      el('div', { class: 'grow' }, el('div', { class: 't' }, tplTitle(tp.key)), el('div', { class: 's' }, `${tp.steps.length} ${t('steps')}`))),
    el('div', { class: 'wf-actions' }, el('button', { class: 'btn small primary', onclick: () => openEditor({ command: tp.command, description: tplTitle(tp.key), steps: tp.steps.map((text) => ({ kind: /^(لكل|For each)/.test(text) ? 'each' : /^(إذا|If )/.test(text) ? 'if' : /^(تحقّق|Verify)/.test(text) ? 'check' : 'do', text: text.replace(/^(For each |If |Verify that )/, '') })) }) }, t('useTemplate')))));
}

function exportWorkflows(list) {
  const data = { format: 'infera-workflows', version: 1, exportedAt: new Date().toISOString(), workflows: list.map(({ id, createdAt, updatedAt, ...w }) => w) }; // eslint-disable-line no-unused-vars
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: list.length === 1 ? `${list[0].command}.infera-workflow.json` : 'infera-workflows.json' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function importWorkflows(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  const list = data?.format === 'infera-workflows' && Array.isArray(data.workflows) ? data.workflows : null;
  if (!list) { alert(t('wfBadFile')); return; }
  const taken = new Set((state.shortcuts || []).map((s) => s.command));
  let n = 0;
  for (const w of list.slice(0, 200)) {
    let command = String(w.command || 'workflow').toLowerCase();
    for (let i = 2; taken.has(command); i++) command = `${String(w.command).toLowerCase()}-${i}`;
    try { await call('save_shortcut', { shortcut: { ...w, id: undefined, command } }); taken.add(command); n++; } catch { /* skip a bad entry */ }
  }
  await refreshConversations();
  openStudio('saved');
  addBanner(t('wfImported', { n }), true);
}

// The workflow editor: steps with a kind (do / if / for each / wait until / verify), the
// variables they use, a test run and save. The agent receives the compiled numbered steps.
function openEditor(sc = {}) {
  let steps = Array.isArray(sc.steps) && sc.steps.length ? sc.steps.map((x) => ({ ...x })) : sc.prompt ? stepsFromPrompt(sc.prompt) : [{ kind: 'do', text: '' }];
  const cmd = el('input', { value: sc.command || '', placeholder: 'daily-report', id: 'wfCommand' });
  const desc = el('input', { value: sc.description || '', id: 'wfDesc' });
  const url = el('input', { value: sc.startUrl || '', placeholder: 'https://…', dir: 'ltr' });
  const list = el('div', { class: 'wfe-steps', id: 'wfSteps' });
  const varsBox = el('div', { class: 'card form' });
  const defaults = Object.fromEntries((sc.params || []).map((p) => [p.name, p.default ?? '']));
  const varsOf = () => [...new Set(steps.flatMap((s) => [...s.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])))];
  const paintVars = () => {
    const names = varsOf();
    varsBox.hidden = !names.length;
    put(varsBox, el('b', {}, t('wfVars')), ...names.map((n) => el('label', { class: 'field' }, el('span', {}, `{{${n}}}`),
      el('input', { value: defaults[n] ?? '', oninput: (e) => { defaults[n] = e.target.value; } }))));
  };
  const paint = () => {
    put(list, ...steps.map((s, i) => el('div', { class: 'wfe-step' },
      el('span', { class: 'n' }, String(i + 1)),
      el('div', {},
        el('div', { class: 'kind' }, ic(KIND_ICON[s.kind] || 'play', 14), el('select', { onchange: (e) => { s.kind = e.target.value; paint(); } },
          ...Object.keys(KIND_PREFIX).map((k) => el('option', { value: k, selected: s.kind === k ? true : undefined }, t(`wfKind_${k}`))))),
        el('textarea', { rows: 2, dir: 'auto', oninput: (e) => { s.text = e.target.value; paintVars(); } }, s.text)),
      el('div', { class: 'tools' },
        el('button', { class: 'icon-btn', title: '↑', disabled: i === 0, onclick: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; paint(); } }, ic('up')),
        el('button', { class: 'icon-btn', title: '↓', disabled: i === steps.length - 1, onclick: () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; paint(); } }, ic('down')),
        el('button', { class: 'icon-btn', title: t('delete'), onclick: () => { steps.splice(i, 1); if (!steps.length) steps.push({ kind: 'do', text: '' }); paint(); } }, ic('trash'))))));
    paintVars();
  };
  paint();
  const params = () => varsOf().map((name) => ({ ...((sc.params || []).find((p) => p.name === name) || {}), name, default: defaults[name] ?? '' }));
  const build = () => ({ ...sc, command: cmd.value, description: desc.value, prompt: compileSteps(steps), startUrl: url.value, params: params(), steps: steps.filter((s) => s.text.trim()) });
  openDrawer(t('wfEditor'), [
    el('div', { class: 'card form' },
      el('label', { class: 'field' }, el('span', {}, `${t('wfName')} (/…)`), cmd),
      el('label', { class: 'field' }, el('span', {}, t('description')), desc),
      el('label', { class: 'field' }, el('span', {}, t('startUrl')), url)),
    el('b', { class: 'section-title' }, t('wfSteps')),
    list,
    el('button', { class: 'btn', onclick: () => { steps.push({ kind: 'do', text: '' }); paint(); list.lastChild?.querySelector('textarea')?.focus(); } }, ic('plus'), t('wfAddStep')),
    varsBox,
    el('div', { class: 'grid2' },
      el('button', { class: 'btn', id: 'wfTest', onclick: () => {
        const w = build();
        let p = w.prompt;
        for (const prm of w.params) p = p.split(`{{${prm.name}}}`).join(prm.default || `[${prm.name}]`);
        if (w.startUrl) p = `Start at ${w.startUrl}.\n\n${p}`;
        closeViews();
        send(p);
      } }, ic('play'), t('wfTest')),
      el('button', { class: 'btn primary', id: 'wfSave', onclick: async () => {
        try { await call('save_shortcut', { shortcut: build() }); await refreshConversations(); openStudio('saved'); } catch (e) { alert(e.message); }
      } }, ic('check'), t('wfSave'))),
  ], 'btnStudio');
}

// Scheduled tasks
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function showTaskForm(task = {}) {
  const f = el('div', { class: 'card form' });
  const name = el('input', { value: task.name || '' });
  const prompt = el('textarea', { rows: 5, dir: 'auto' }, task.prompt || '');
  const url = el('input', { value: task.startUrl || '', placeholder: 'https://…', dir: 'ltr' });
  const freq = el('select', {}, ...['once', 'daily', 'weekly', 'monthly', 'annually'].map((v) => el('option', { value: v }, t(v))));
  freq.value = task.frequency || 'daily';
  const time = el('input', { type: 'time', value: task.time || '09:00' });
  const date = el('input', { type: 'date', value: task.date || '' });
  const dow = el('select', {}, ...(currentLang() === 'ar' ? DAYS_AR : DAYS_EN).map((d, i) => el('option', { value: i }, d)));
  dow.value = task.dayOfWeek ?? 1;
  const dom = el('input', { type: 'number', min: 1, max: 31, value: task.dayOfMonth ?? 1 });
  const month = el('select', {}, ...Array.from({ length: 12 }, (_, i) => el('option', { value: i }, new Date(2026, i, 1).toLocaleString(currentLang(), { month: 'long' }))));
  month.value = task.month ?? 0;
  const model = el('select', {}, el('option', { value: '' }, '—'), ...state.models.map((m) => el('option', { value: m.id }, m.label)));
  model.value = task.model || '';
  const extra = el('div', { class: 'grid2' });
  const sync = () => {
    const v = freq.value;
    put(extra, ...[
      el('label', { class: 'field' }, el('span', {}, t('time')), time),
      v === 'once' ? el('label', { class: 'field' }, el('span', {}, t('date')), date) : null,
      v === 'weekly' ? el('label', { class: 'field' }, el('span', {}, t('dayOfWeek')), dow) : null,
      v === 'monthly' || v === 'annually' ? el('label', { class: 'field' }, el('span', {}, t('dayOfMonth')), dom) : null,
      v === 'annually' ? el('label', { class: 'field' }, el('span', {}, t('month')), month) : null,
    ].filter(Boolean));
  };
  freq.addEventListener('change', sync);
  sync();
  f.append(
    el('label', { class: 'field' }, el('span', {}, t('name')), name),
    el('label', { class: 'field' }, el('span', {}, t('prompt')), prompt),
    el('label', { class: 'field' }, el('span', {}, t('startUrl')), url),
    el('label', { class: 'field' }, el('span', {}, t('frequency')), freq),
    extra,
    el('label', { class: 'field' }, el('span', {}, t('model')), model),
    el('div', { class: 'row', style: 'justify-content:flex-end' },
      el('button', { class: 'btn', onclick: () => openStudio('schedules') }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          await call('save_task', { task: { ...task, name: name.value, prompt: prompt.value, startUrl: url.value, frequency: freq.value, time: time.value, date: date.value, dayOfWeek: Number(dow.value), dayOfMonth: Number(dom.value), month: Number(month.value), model: model.value } });
          openStudio('schedules');
        } catch (e) { alert(e.message); }
      } }, t('save'))),
  );
  openDrawer(task.id ? t('edit') : t('newTask'), f, 'btnStudio');
}

async function schedulesTab() {
  state.tasks = await call('list_tasks');
  const items = state.tasks.map((k) => el('div', { class: 'card wf' },
    el('div', { class: 'wf-head' }, el('span', { class: 'wf-ic' }, ic('calendar')),
      el('div', { class: 'grow' }, el('div', { class: 't' }, k.name), el('div', { class: 's' }, `${t('nextRun')}: ${fmt(k.nextRun)} · ${t('lastRun')}: ${fmt(k.lastRun)}${k.lastStatus ? ` (${t(k.lastStatus) || k.lastStatus})` : ''}`)),
      el('span', { class: `badge${k.enabled ? '' : ' warn'}` }, t(k.frequency))),
    el('div', { class: 'wf-actions' },
      el('button', { class: 'btn small primary', onclick: () => call('run_task_now', { id: k.id }) }, ic('play'), t('runNow')),
      el('button', { class: 'btn small', onclick: () => showTaskForm(k) }, ic('edit'), t('edit')),
      el('button', { class: 'btn small danger', onclick: async () => { await call('delete_task', { id: k.id }); openStudio('schedules'); } }, ic('trash'), t('delete')))));
  return [
    el('button', { class: 'btn primary', onclick: () => showTaskForm() }, ic('plus'), t('newTask')),
    ...(items.length ? items : [el('p', { class: 'empty-note' }, t('noTasks'))]),
  ];
}

// Workflow recording with voice narration
let recog = null;
let transcript = '';
const recPref = (k, d = true) => { try { const v = localStorage.getItem(`rec.${k}`); return v === null ? d : v === '1'; } catch { return d; } };
const setRecPref = (k, v) => { try { localStorage.setItem(`rec.${k}`, v ? '1' : '0'); } catch { /* private mode */ } };
const toggle = (k, label) => el('label', { class: 'opt-row' }, el('span', {}, label),
  el('span', { class: 'switch' }, el('input', { type: 'checkbox', checked: recPref(k) ? true : undefined, onchange: (e) => setRecPref(k, e.target.checked) }), el('span')));

async function recordTab() {
  const st = await call('recording_state');
  const said = el('div', { class: 's', dir: 'auto' }, transcript);
  const wave = el('div', { class: `wave${st.active && recog ? ' on' : ''}` }, ...Array.from({ length: 28 }, () => el('i')));
  if (!st.active) {
    return [
      el('div', { class: 'card rec-card' },
        el('button', { class: 'rec-btn', id: 'recStart', onclick: startRec }, el('i'), t('recStart')),
        el('p', { class: 'muted', style: 'margin:0' }, t('recSub')), wave),
      el('div', { class: 'card form' }, el('b', {}, t('recSettings')), toggle('voice', t('recVoice')), toggle('shots', t('recShots')), toggle('fields', t('recFields'))),
      el('p', { class: 'muted small' }, t('recHint')),
      el('button', { class: 'btn primary block', onclick: startRec }, ic('record'), t('recNow')),
    ];
  }
  return [
    el('div', { class: 'card rec-card' },
      el('div', { class: 'rec-live' }, `${t('recording')} ${st.steps} ${t('steps')}`), wave, said,
      el('button', { class: 'btn primary block', id: 'recStop', onclick: async () => {
        recog?.stop();
        recog = null;
        const draft = await call('stop_recording', { transcript, params: recPref('fields') });
        openEditor(draft);
      } }, ic('stop'), t('recStop'))),
  ];
}
async function startRec() {
  try { await call('start_recording', { shots: recPref('shots') }); } catch (e) { alert(e.message); return; }
  transcript = '';
  if (recPref('voice')) startMic();
  openStudio('record');
}

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recog = new SR();
  recog.continuous = true;
  recog.interimResults = false;
  recog.lang = currentLang() === 'ar' ? 'ar-SA' : navigator.language || 'en-US';
  recog.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) transcript += e.results[i][0].transcript + ' ';
    const liveEl = document.querySelector('.rec-card .s');
    if (liveEl) liveEl.textContent = transcript;
  };
  const me = recog;
  let restarts = 0;
  recog.onerror = (e) => {
    // No microphone permission (or no microphone): stop for good — restarting would fail
    // again at once — and open the settings page once to grant it.
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
      if (recog === me) recog = null;
      try { me.abort(); } catch { /* ignore */ }
      addBanner(t('micDenied'));
      if (e.error !== 'audio-capture') openMicSettings();
    }
  };
  recog.onresult = ((orig) => (e) => { restarts = 0; orig(e); })(recog.onresult);
  // Speech recognition ends on silence; keep it going while recording, but never in a tight loop.
  recog.onend = () => {
    if (recog !== me) return;
    if (++restarts > 5) { recog = null; return; }
    setTimeout(() => { if (recog === me) try { me.start(); } catch { /* ignore */ } }, 300);
  };
  try { recog.start(); } catch { /* ignore */ }
}

// One settings tab for the microphone permission: focus it if it's already open.
async function openMicSettings() {
  const url = chrome.runtime.getURL('options/options.html');
  const [open] = await chrome.tabs.query({ url: `${url}*` });
  if (open) {
    await chrome.tabs.update(open.id, { active: true, url: `${url}#mic` });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: `${url}#mic` });
  }
}

// Old entry points kept for keyboard users and saved links.
window.__inferaPanel = { openStudio, openLive, openCosts };

connect();
