// Infera Agent — side panel UI. The agent loop runs in the service worker; this
// page renders the conversation, approvals, shortcuts, schedules and recording.
import { t, setLanguage, applyI18n, MODE_LABEL, currentLang } from '../lib/i18n.js';
import { renderMarkdown } from '../lib/markdown.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

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
    case 'tool_start': curText = null; addToolCard(ev.id, ev.name, ev.input); break;
    case 'tool_result': finishToolCard(ev.id, ev.content, ev.isError); break;
    case 'permission_request': addApproval(ev.request); break;
    case 'plan_request': addPlan(ev.request); break;
    case 'error': addBanner(ev.message); break;
    case 'info': addBanner(ev.message, true); break;
    case 'compacted': break;
    case 'session_switched': call('state').then(loadState); break;
    case 'turn_end': curText = null; curThinking = null; refreshConversations(); break;
    default:
  }
}

// ---------------- state ----------------
function loadState(s) {
  state = s;
  setLanguage(s.settings.language);
  applyI18n();
  fillSelectors();
  renderAuth();
  renderHistory(s.messages || []);
  setStatus(s.session.status);
}

async function refreshConversations() {
  try { const s = await call('state'); state.conversations = s.conversations; state.shortcuts = s.shortcuts; state.tasks = s.tasks; } catch { /* ignore */ }
}

function renderAuth() {
  const a = state.auth || {};
  const ready = !!a.ready;
  $('#signIn').hidden = ready;
  $('#examples').hidden = !ready;
  $('#input').disabled = !ready;
  $('#account').hidden = !a.infera;
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

function fillSelectors() {
  const ms = $('#modelSel');
  ms.replaceChildren(...state.models.map((m) => el('option', { value: m.id }, m.label)));
  ms.value = state.settings.model;
  const md = $('#modeSel');
  md.replaceChildren(...state.modes.map((m) => el('option', { value: m }, t(MODE_LABEL[m]))));
  md.value = state.settings.permissionMode;
}

function setStatus(s) {
  const running = s === 'running' || s === 'waiting';
  $('#btnSend').hidden = running;
  $('#btnStop').hidden = !running;
  const st = $('#status');
  st.className = 'status' + (running ? ' running' : '');
  st.textContent = s === 'running' ? t('working') : s === 'waiting' ? t('waiting') : s === 'done' ? t('done') : s === 'stopped' ? t('stopped') : s === 'error' ? t('error') : '';
  if (state) state.session.status = s;
  updateEmpty();
}

function updateEmpty() {
  $('#empty').hidden = $('#messages').children.length > 0;
}

// ---------------- rendering ----------------
const scroll = () => { const m = $('#messages'); m.scrollTop = m.scrollHeight; };

function renderHistory(messages) {
  const m = $('#messages');
  m.replaceChildren();
  toolCards.clear();
  curText = null;
  const results = new Map();
  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) for (const b of msg.content) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
  }
  for (const msg of messages) {
    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }];
    if (msg.role === 'user') {
      const texts = blocks.filter((b) => b.type === 'text' && !b.text.startsWith('<tab_context>') && !b.text.startsWith('<system-reminder>'));
      const imgs = blocks.filter((b) => b.type === 'image');
      if (!texts.length && !imgs.length) continue;
      if (blocks.some((b) => b.type === 'tool_result')) continue;
      addUser(texts.map((b) => b.text).join('\n'), imgs.map((b) => `data:${b.source.media_type};base64,${b.source.data}`));
    } else {
      for (const b of blocks) {
        if (b.type === 'text' && b.text) { const d = el('div', { class: 'msg assistant', html: renderMarkdown(b.text) }); m.append(d); }
        else if (b.type === 'thinking' && b.thinking) m.append(thinkingEl(b.thinking));
        else if (b.type === 'tool_use') {
          addToolCard(b.id, b.name, b.input);
          const r = results.get(b.id);
          if (r) finishToolCard(b.id, Array.isArray(r.content) ? r.content.map((c) => (c.type === 'image' ? { type: 'image', src: `data:${c.source.media_type};base64,${c.source.data}` } : c)) : [{ type: 'text', text: String(r.content) }], r.is_error);
        }
      }
    }
  }
  updateEmpty();
  scroll();
}

function addUser(text, imgs = []) {
  $('#messages').append(el('div', { class: 'msg user' }, text, ...imgs.map((src) => el('img', { src, alt: '' }))));
  updateEmpty();
  scroll();
}

function appendText(delta) {
  if (!curText) {
    curText = { el: el('div', { class: 'msg assistant' }), buf: '' };
    $('#messages').append(curText.el);
    updateEmpty();
  }
  curText.buf += delta;
  const target = curText;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { target.el.innerHTML = renderMarkdown(target.buf); scroll(); }, 40);
}

function thinkingEl(text) {
  const d = el('details', { class: 'thinking' }, el('summary', {}, t('thinking')), el('div', {}, text));
  return d;
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
};

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
    default: return '';
  }
}

function addToolCard(id, name, input) {
  if (name === 'turn_answer_start') return;
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
  st.className = 'st muted';
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
  const answer = (a) => {
    port.postMessage({ type: 'permission_response', id: r.id, answer: a });
    box.classList.add('done');
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  };
  box.append(
    el('div', { class: 'head' }, el('img', { src: '../icons/icon32.png', width: 18, height: 18, alt: '' }), t('wantsTo'), el('span', { class: 'badge' }, r.permissionType || '')),
    el('div', { class: 'desc' }, r.description || ''),
    el('div', { class: 'site' }, r.netloc || r.url || ''),
    r.reason ? el('div', { class: 'reason' }, r.reason) : null,
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary small', onclick: () => answer('once') }, t('allowOnce')),
      r.allowAlways ? el('button', { class: 'btn small', onclick: () => answer('always') }, t('allowAlways')) : null,
      el('button', { class: 'btn danger small', onclick: () => answer('deny') }, t('decline'))),
  );
  $('#messages').append(box);
  updateEmpty();
  scroll();
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
  addUser(text, atts.map((a) => `data:${a.mediaType};base64,${a.base64}`));
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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if ($('#btnSend').hidden) return; send(); }
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
  menu.replaceChildren(...list.map((s, i) => el('button', { class: i === 0 ? 'active' : '', onclick: () => { input.value = `/${s.command} `; hideSlash(); input.focus(); } },
    el('b', {}, `/${s.command}`), ' ', el('span', { class: 'muted' }, s.description || s.prompt.slice(0, 60)))));
  menu.hidden = false;
}
function hideSlash() { $('#slashMenu').hidden = true; }

document.querySelectorAll('.examples .chip').forEach((c) => c.addEventListener('click', () => send(c.textContent)));

$('#modelSel').addEventListener('change', (e) => call('set_model', { model: e.target.value }));
$('#modeSel').addEventListener('change', (e) => call('set_mode', { mode: e.target.value }));
$('#btnNew').addEventListener('click', async () => loadState(await call('new_chat')));
$('#btnSettings').addEventListener('click', () => call('open_settings'));

// ---------------- attachments & region capture ----------------
function fileToB64(file) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
}

function renderAttachments() {
  $('#attachments').replaceChildren(...attachments.map((a, i) => el('div', { class: 'att' },
    el('img', { src: `data:${a.mediaType};base64,${a.base64}`, alt: '' }),
    el('button', { onclick: () => { attachments.splice(i, 1); renderAttachments(); }, 'aria-label': 'remove' }, '×'))));
}

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

// ---------------- drawers ----------------
function openDrawer(title, body) {
  $('#drawerTitle').textContent = title;
  $('#drawerBody').replaceChildren(...[].concat(body).filter(Boolean));
  $('#drawer').hidden = false;
}
function closeDrawer() { $('#drawer').hidden = true; }
$('#drawerClose').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });

const fmt = (ts) => (ts ? new Date(ts).toLocaleString(currentLang() === 'ar' ? 'ar' : undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// History
$('#btnHistory').addEventListener('click', async () => {
  await refreshConversations();
  const list = state.conversations || [];
  if (!list.length) return openDrawer(t('history'), el('p', { class: 'muted' }, t('noHistory')));
  openDrawer(t('history'), list.map((c) => el('div', { class: 'card item click', onclick: async () => { closeDrawer(); loadState(await call('load_conversation', { id: c.id })); } },
    el('div', { class: 'row' }, el('div', { class: 't grow' }, c.kind === 'scheduled' ? `⏰ ${c.title}` : c.title),
      el('button', { class: 'icon-btn', 'aria-label': t('delete'), onclick: async (e) => { e.stopPropagation(); loadState(await call('delete_conversation', { id: c.id })); $('#btnHistory').click(); } }, '×')),
    el('div', { class: 's' }, `${fmt(c.updatedAt)} · ${t(c.status) || c.status}`))));
});

// Shortcuts
function shortcutForm(sc = {}) {
  const f = el('div', { class: 'card form' });
  const cmd = el('input', { value: sc.command || '', placeholder: 'daily-report' });
  const desc = el('input', { value: sc.description || '' });
  const prompt = el('textarea', { rows: 6 }, sc.prompt || '');
  const url = el('input', { value: sc.startUrl || '', placeholder: 'https://…' });
  f.append(
    el('label', { class: 'field' }, el('span', {}, `${t('command')} (/…)`), cmd),
    el('label', { class: 'field' }, el('span', {}, t('description')), desc),
    el('label', { class: 'field' }, el('span', {}, `${t('prompt')} — {{param}}`), prompt),
    el('label', { class: 'field' }, el('span', {}, t('startUrl')), url),
    el('div', { class: 'row', style: 'justify-content:flex-end' },
      el('button', { class: 'btn', onclick: () => showShortcuts() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async () => {
        const params = [...new Set([...prompt.value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].map((name) => (sc.params || []).find((p) => p.name === name) || { name, default: '' });
        try { await call('save_shortcut', { shortcut: { ...sc, command: cmd.value, description: desc.value, prompt: prompt.value, startUrl: url.value, params } }); await refreshConversations(); showShortcuts(); } catch (e) { alert(e.message); }
      } }, t('save'))),
  );
  return f;
}

async function showShortcuts() {
  state.shortcuts = await call('list_shortcuts');
  const items = state.shortcuts.map((s) => el('div', { class: 'card item' },
    el('div', { class: 'row' }, el('div', { class: 't grow' }, `/${s.command}`), s.isWorkflow ? el('span', { class: 'badge' }, 'workflow') : null),
    el('div', { class: 's' }, s.description || s.prompt.slice(0, 120)),
    el('div', { class: 'row' },
      el('button', { class: 'btn small primary', onclick: () => { closeDrawer(); send(`/${s.command}`); } }, t('run')),
      el('button', { class: 'btn small', onclick: () => openDrawer(t('edit'), shortcutForm(s)) }, t('edit')),
      el('button', { class: 'btn small', onclick: () => showTaskForm({ name: s.command, prompt: s.prompt, startUrl: s.startUrl }) }, t('schedule')),
      el('button', { class: 'btn small danger', onclick: async () => { await call('delete_shortcut', { id: s.id }); showShortcuts(); } }, t('delete')))));
  openDrawer(t('shortcuts'), [
    el('button', { class: 'btn primary', onclick: () => openDrawer(t('newShortcut'), shortcutForm()) }, '+ ' + t('newShortcut')),
    ...(items.length ? items : [el('p', { class: 'muted' }, t('noShortcuts'))]),
  ]);
}
$('#btnShortcuts').addEventListener('click', showShortcuts);

// Scheduled tasks
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function showTaskForm(task = {}) {
  const f = el('div', { class: 'card form' });
  const name = el('input', { value: task.name || '' });
  const prompt = el('textarea', { rows: 5 }, task.prompt || '');
  const url = el('input', { value: task.startUrl || '', placeholder: 'https://…' });
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
    extra.replaceChildren(...[
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
      el('button', { class: 'btn', onclick: showTasks }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          await call('save_task', { task: { ...task, name: name.value, prompt: prompt.value, startUrl: url.value, frequency: freq.value, time: time.value, date: date.value, dayOfWeek: Number(dow.value), dayOfMonth: Number(dom.value), month: Number(month.value), model: model.value } });
          showTasks();
        } catch (e) { alert(e.message); }
      } }, t('save'))),
  );
  openDrawer(task.id ? t('edit') : t('newTask'), f);
}

async function showTasks() {
  state.tasks = await call('list_tasks');
  const items = state.tasks.map((k) => el('div', { class: 'card item' },
    el('div', { class: 'row' }, el('div', { class: 't grow' }, k.name), el('span', { class: `badge${k.enabled ? '' : ' warn'}` }, t(k.frequency))),
    el('div', { class: 's' }, `${t('nextRun')}: ${fmt(k.nextRun)} · ${t('lastRun')}: ${fmt(k.lastRun)}${k.lastStatus ? ` (${t(k.lastStatus) || k.lastStatus})` : ''}`),
    el('div', { class: 'row' },
      el('button', { class: 'btn small primary', onclick: () => call('run_task_now', { id: k.id }) }, t('runNow')),
      el('button', { class: 'btn small', onclick: () => showTaskForm(k) }, t('edit')),
      el('button', { class: 'btn small danger', onclick: async () => { await call('delete_task', { id: k.id }); showTasks(); } }, t('delete')))));
  openDrawer(t('scheduled'), [
    el('button', { class: 'btn primary', onclick: () => showTaskForm() }, '+ ' + t('newTask')),
    ...(items.length ? items : [el('p', { class: 'muted' }, t('noTasks'))]),
  ]);
}
$('#btnTasks').addEventListener('click', showTasks);

// Workflow recording with voice narration
let recog = null;
let transcript = '';
async function showRecorder() {
  const st = await call('recording_state');
  const micToggle = el('input', { type: 'checkbox', checked: true });
  const live = el('div', { class: 's' }, transcript);
  if (!st.active) {
    openDrawer(t('record'), [
      el('p', { class: 'muted' }, t('recHint')),
      el('label', { class: 'row' }, micToggle, t('mic')),
      el('button', { class: 'btn primary', onclick: async () => {
        try { await call('start_recording'); } catch (e) { alert(e.message); return; }
        transcript = '';
        if (micToggle.checked) startMic(live);
        showRecorder();
      } }, t('recStart')),
    ]);
  } else {
    openDrawer(t('record'), [
      el('div', { class: 'rec-live' }, `${t('recording')} ${st.steps} ${t('steps')}`),
      live,
      el('button', { class: 'btn primary', onclick: async () => {
        recog?.stop();
        recog = null;
        const draft = await call('stop_recording', { transcript });
        openDrawer(t('recDraft'), shortcutForm(draft));
      } }, t('recStop')),
    ]);
  }
}
function startMic(liveEl) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recog = new SR();
  recog.continuous = true;
  recog.interimResults = false;
  recog.lang = currentLang() === 'ar' ? 'ar-SA' : navigator.language || 'en-US';
  recog.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) transcript += e.results[i][0].transcript + ' ';
    liveEl.textContent = transcript;
  };
  recog.onerror = (e) => {
    if (e.error === 'not-allowed') chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#mic') });
  };
  recog.onend = () => { if (recog) try { recog.start(); } catch { /* ignore */ } };
  try { recog.start(); } catch { /* ignore */ }
}
$('#btnRecord').addEventListener('click', showRecorder);

connect();
