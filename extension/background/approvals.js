// Approval dialogs shown in a small popup window when no side panel is open
// (MCP clients such as Infera Code, scheduled tasks). Title: "Infera Agent wants to …".
const pending = new Map(); // id -> {req, resolve, windowId}

export function popupApproval(req) {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    pending.set(id, { req, resolve, windowId: null });
    chrome.windows.create({
      url: chrome.runtime.getURL(`approval/approval.html?id=${id}`),
      type: 'popup', width: 460, height: 440, focused: true,
    }).then((w) => { const p = pending.get(id); if (p) p.windowId = w.id; })
      .catch(() => { pending.delete(id); resolve('deny'); });
  });
}

export function getApproval(id) {
  return pending.get(id)?.req || null;
}

export function answerApproval(id, answer) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p.resolve(answer);
  if (p.windowId) chrome.windows.remove(p.windowId).catch(() => {});
}

chrome.windows.onRemoved.addListener((wid) => {
  for (const [id, p] of pending) if (p.windowId === wid) { pending.delete(id); p.resolve('deny'); }
});
