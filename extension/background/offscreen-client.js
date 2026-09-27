// Offscreen document: plays notification sounds (service workers have no Audio
// API) and encodes GIF recordings off the service worker's thread.
let creating = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen/offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
      justification: 'Play task-completion sounds and encode GIF recordings.',
    }).finally(() => { creating = null; });
  }
  await creating;
}

export async function offscreenCall(type, payload = {}) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload });
  if (res?.error) throw new Error(res.error);
  return res;
}

export async function playSound(kind = 'done') {
  try { await offscreenCall('PLAY_SOUND', { kind }); } catch { /* best effort */ }
}
