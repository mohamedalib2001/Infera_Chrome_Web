// Infera Agent — workflow recorder. Captures the user's own clicks, typing,
// selections and key presses as semantic steps (element role/name/selector),
// which the service worker combines with screenshots and voice narration and
// turns into a reusable, parameterised shortcut prompt.
(() => {
  if (window.__inferaRecorder) return;
  window.__inferaRecorder = { active: false };
  const state = window.__inferaRecorder;

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      let p = el.tagName.toLowerCase();
      const testId = el.getAttribute('data-testid') || el.getAttribute('name');
      if (testId) { parts.unshift(`${p}[${el.getAttribute('data-testid') ? 'data-testid' : 'name'}="${testId}"]`); break; }
      const sib = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(el) + 1})`;
      parts.unshift(p);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function label(el) {
    const t = el.closest('a,button,input,select,textarea,[role],label') || el;
    const name = t.getAttribute('aria-label') || t.innerText || t.value || t.placeholder || t.title || t.alt || '';
    return { tag: t.tagName.toLowerCase(), role: t.getAttribute('role') || '', name: String(name).replace(/\s+/g, ' ').trim().slice(0, 100), selector: cssPath(t), type: t.type || '' };
  }

  function send(step) {
    if (!state.active) return;
    chrome.runtime.sendMessage({ type: 'RECORDER_STEP', step: { ...step, url: location.href, title: document.title, ts: Date.now() } }).catch(() => {});
  }

  const inputTimers = new WeakMap();
  const handlers = {
    click: (e) => send({ action: 'click', x: e.clientX, y: e.clientY, target: label(e.target) }),
    change: (e) => {
      const t = e.target;
      if (t.tagName === 'SELECT') send({ action: 'select', value: t.selectedOptions[0]?.textContent.trim(), target: label(t) });
      else if (t.type === 'checkbox' || t.type === 'radio') send({ action: 'toggle', value: t.checked, target: label(t) });
    },
    input: (e) => {
      const t = e.target;
      if (!('value' in t) || t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT') return;
      clearTimeout(inputTimers.get(t));
      inputTimers.set(t, setTimeout(() => {
        const sensitive = t.type === 'password' || /cc-/.test(t.autocomplete || '');
        send({ action: 'type', value: sensitive ? '<redacted>' : String(t.value).slice(0, 500), target: label(t) });
      }, 600));
    },
    keydown: (e) => {
      if (['Enter', 'Escape', 'Tab'].includes(e.key) || e.ctrlKey || e.metaKey) {
        const combo = [e.ctrlKey && 'ctrl', e.metaKey && 'cmd', e.altKey && 'alt', e.shiftKey && 'shift', e.key].filter(Boolean).join('+');
        send({ action: 'key', value: combo, target: label(e.target) });
      }
    },
  };

  function start() {
    if (state.active) return;
    state.active = true;
    for (const [t, h] of Object.entries(handlers)) window.addEventListener(t, h, true);
  }
  function stop() {
    state.active = false;
    for (const [t, h] of Object.entries(handlers)) window.removeEventListener(t, h, true);
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'RECORDER_START') { start(); sendResponse({ ok: true }); }
    else if (msg?.type === 'RECORDER_STOP') { stop(); sendResponse({ ok: true }); }
    return false;
  });
  start();
})();
