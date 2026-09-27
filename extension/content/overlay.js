// Infera Agent — floating control indicator shown while the agent controls a tab.
// Hidden before every tool action (HIDE_FOR_TOOL_USE) so it never appears in
// screenshots, and restored afterwards (SHOW_AFTER_TOOL_USE).
(() => {
  if (window.__inferaOverlay) return;
  window.__inferaOverlay = true;

  const isAr = (navigator.language || '').startsWith('ar');
  const T = isAr
    ? { working: 'إنفرا يعمل على هذه الصفحة…', stop: 'إيقاف', take: 'تولَّ التحكم', done: 'اكتملت المهمة' }
    : { working: 'Infera is working on this page…', stop: 'Stop', take: 'Take control', done: 'Task complete' };

  const host = document.createElement('infera-agent-overlay');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .glow { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;
        box-shadow: inset 0 0 0 3px rgba(124, 77, 255, .85), inset 0 0 28px rgba(64, 120, 255, .55);
        animation: pulse 2.4s ease-in-out infinite; }
      @keyframes pulse { 50% { box-shadow: inset 0 0 0 3px rgba(64,120,255,.85), inset 0 0 40px rgba(170,90,255,.5); } }
      .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
        display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; border-radius: 999px;
        font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; color: #fff;
        background: linear-gradient(135deg, #2a3cff, #7b3fe4); box-shadow: 0 8px 30px rgba(40, 20, 120, .35);
        direction: ${isAr ? 'rtl' : 'ltr'}; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ef; animation: blink 1s infinite; }
      @keyframes blink { 50% { opacity: .25; } }
      img { width: 18px; height: 18px; }
      button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 999px; background: rgba(255,255,255,.18); font-weight: 600; }
      button:hover { background: rgba(255,255,255,.3); }
      .hidden { display: none !important; }
    </style>
    <div class="glow"></div>
    <div class="bar">
      <img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="">
      <span class="dot"></span><span class="label">${T.working}</span>
      <button class="take">${T.take}</button>
      <button class="stop">${T.stop}</button>
    </div>`;
  const root = document.documentElement;
  const label = shadow.querySelector('.label');
  const dot = shadow.querySelector('.dot');
  let visible = false;
  let hiddenForTool = false;

  function render() {
    const on = visible && !hiddenForTool;
    if (on && !host.isConnected) root.appendChild(host);
    if (!on && host.isConnected) host.remove();
  }

  shadow.querySelector('.stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OVERLAY_STOP' }));
  shadow.querySelector('.take').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OVERLAY_TAKE_CONTROL' }));

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    switch (msg?.type) {
      case 'SHOW_AGENT_INDICATOR':
        visible = true; label.textContent = msg.text || T.working; dot.classList.remove('hidden'); render(); break;
      case 'HIDE_AGENT_INDICATOR':
        visible = false; render(); break;
      case 'AGENT_DONE_INDICATOR':
        label.textContent = T.done; dot.classList.add('hidden');
        setTimeout(() => { visible = false; render(); }, 2500); break;
      case 'HIDE_FOR_TOOL_USE':
        hiddenForTool = true; render(); sendResponse({ ok: true }); return false;
      case 'SHOW_AFTER_TOOL_USE':
        hiddenForTool = false; render(); sendResponse({ ok: true }); return false;
      default:
        return false;
    }
    sendResponse({ ok: true });
    return false;
  });
})();
