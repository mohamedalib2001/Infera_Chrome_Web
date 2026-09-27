// Offscreen document: notification sounds (Web Audio) and GIF encoding with
// overlays (click indicators, drag paths, action labels, progress bar, watermark).
import { encodeGif, quantize } from '../lib/gif-encoder.js';

let audioCtx = null;
function playSound(kind) {
  audioCtx ||= new AudioContext();
  const notes = kind === 'error' ? [440, 330] : [660, 880, 1320];
  const t0 = audioCtx.currentTime;
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + i * 0.12);
    o.stop(t0 + i * 0.12 + 0.3);
  });
}

async function loadImage(b64) {
  const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
  return createImageBitmap(blob);
}

let logo = null;
async function getLogo() {
  if (!logo) logo = await createImageBitmap(await (await fetch(chrome.runtime.getURL('icons/icon48.png'))).blob());
  return logo;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function encode(frames, opts) {
  const W = frames[0].width;
  const H = frames[0].height;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const out = [];
  const lg = opts.showWatermark ? await getLogo() : null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const img = await loadImage(f.base64);
    ctx.drawImage(img, 0, 0, W, H);
    img.close();
    const k = W / (f.refWidth || f.width);
    const a = f.action;
    if (a) {
      if (opts.showClickIndicators && a.coordinate && (a.type === 'click' || a.type === 'hover')) {
        const [x, y] = [a.coordinate[0] * k, a.coordinate[1] * k];
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(124,77,255,0.95)';
        ctx.fillStyle = 'rgba(64,120,255,0.25)';
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(124,77,255,1)'; ctx.fill();
      }
      if (opts.showDragPaths && a.type === 'drag' && a.start && a.coordinate) {
        const [x1, y1, x2, y2] = [a.start[0] * k, a.start[1] * k, a.coordinate[0] * k, a.coordinate[1] * k];
        ctx.strokeStyle = 'rgba(124,77,255,0.95)'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 14 * Math.cos(ang - 0.4), y2 - 14 * Math.sin(ang - 0.4));
        ctx.lineTo(x2 - 14 * Math.cos(ang + 0.4), y2 - 14 * Math.sin(ang + 0.4));
        ctx.closePath(); ctx.fillStyle = 'rgba(124,77,255,0.95)'; ctx.fill();
      }
      if (opts.showActionLabels && a.label) {
        ctx.font = '600 15px system-ui, sans-serif';
        const tw = Math.min(W - 40, ctx.measureText(a.label).width + 24);
        roundRect(ctx, (W - tw) / 2, H - 58, tw, 30, 15);
        ctx.fillStyle = 'rgba(20,20,40,0.82)'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(a.label, W / 2, H - 43, W - 60);
        ctx.textAlign = 'start';
      }
    }
    if (opts.showProgressBar) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, H - 6, W, 6);
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#2a3cff'); grad.addColorStop(1, '#a24bff');
      ctx.fillStyle = grad; ctx.fillRect(0, H - 6, W * ((i + 1) / frames.length), 6);
    }
    if (lg) {
      ctx.globalAlpha = 0.85;
      roundRect(ctx, W - 132, 10, 122, 28, 14); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
      ctx.drawImage(lg, W - 128, 13, 22, 22);
      ctx.font = '600 13px system-ui, sans-serif'; ctx.fillStyle = '#3a2bd6'; ctx.textBaseline = 'middle';
      ctx.fillText('Infera Agent', W - 102, 24);
      ctx.globalAlpha = 1;
    }
    const { data } = ctx.getImageData(0, 0, W, H);
    const q = quantize(data, opts.quality ?? 10);
    const next = frames[i + 1];
    const delayMs = next ? Math.min(2000, Math.max(400, next.ts - f.ts)) : 2500;
    out.push({ ...q, delayMs });
  }
  const bytes = encodeGif(out, { width: W, height: H });
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { base64: btoa(s), bytes: bytes.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  (async () => {
    if (msg.type === 'PLAY_SOUND') { playSound(msg.kind); return { ok: true }; }
    if (msg.type === 'ENCODE_GIF') return encode(msg.frames, msg.options || {});
    throw new Error(`Unknown offscreen message ${msg.type}`);
  })().then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true;
});
