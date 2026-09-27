// Chrome DevTools Protocol layer (chrome.debugger). All input produced here is
// "trusted" input: the page cannot distinguish it from a real user.
import {
  CDP_PROTOCOL_VERSION, CLICK_MOVE_DELAY_MS, SCROLL_PX_PER_TICK, MODIFIER_BITS,
  PX_PER_TOKEN, MAX_TARGET_PX, SCREENSHOT_QUALITY, LOG_BUFFER_MAX,
} from './constants.js';
import { describeKey, MODIFIER_NAMES } from './keys.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TabState {
  constructor() {
    this.attached = false;
    this.console = [];
    this.network = new Map();
    this.networkOrder = [];
    this.host = '';
    this.dialog = null;
    this.refFrame = null; // {width,height} of the reference screenshot frame
  }
}

class CDPManager {
  constructor() {
    this.tabs = new Map();
    this.detachListeners = new Set();
    chrome.debugger.onEvent.addListener((src, method, params) => this.#onEvent(src, method, params));
    chrome.debugger.onDetach.addListener((src, reason) => {
      const st = this.tabs.get(src.tabId);
      if (st) st.attached = false;
      for (const fn of this.detachListeners) fn(src.tabId, reason);
    });
    chrome.tabs.onRemoved.addListener((tabId) => this.tabs.delete(tabId));
  }

  state(tabId) {
    if (!this.tabs.has(tabId)) this.tabs.set(tabId, new TabState());
    return this.tabs.get(tabId);
  }

  onDetach(fn) { this.detachListeners.add(fn); }

  isAttached(tabId) { return !!this.tabs.get(tabId)?.attached; }

  async attach(tabId) {
    const st = this.state(tabId);
    if (st.attached) return;
    try {
      await chrome.debugger.attach({ tabId }, CDP_PROTOCOL_VERSION);
    } catch (e) {
      if (!/already attached/i.test(String(e?.message))) throw e;
    }
    st.attached = true;
    try {
      const tab = await chrome.tabs.get(tabId);
      st.host = safeHost(tab.url);
    } catch { /* ignore */ }
    await Promise.allSettled([
      this.send(tabId, 'Page.enable'),
      this.send(tabId, 'Runtime.enable'),
      this.send(tabId, 'Log.enable'),
      this.send(tabId, 'Network.enable', { maxPostDataSize: 0 }),
    ]);
  }

  async detach(tabId) {
    const st = this.tabs.get(tabId);
    if (!st?.attached) return;
    st.attached = false;
    try { await chrome.debugger.detach({ tabId }); } catch { /* already gone */ }
  }

  async detachAll() {
    await Promise.allSettled([...this.tabs.keys()].map((id) => this.detach(id)));
  }

  async send(tabId, method, params = {}) {
    if (!this.isAttached(tabId)) await this.attach(tabId);
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }

  #onEvent(src, method, p) {
    const st = this.tabs.get(src.tabId);
    if (!st) return;
    switch (method) {
      case 'Runtime.consoleAPICalled':
        this.#pushConsole(st, {
          level: p.type,
          text: (p.args || []).map(remoteObjToString).join(' '),
          ts: p.timestamp,
          source: p.stackTrace?.callFrames?.[0]?.url || '',
        });
        break;
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails || {};
        this.#pushConsole(st, {
          level: 'error',
          text: d.exception?.description || d.text || 'Uncaught exception',
          ts: p.timestamp,
          source: d.url || '',
        });
        break;
      }
      case 'Log.entryAdded':
        this.#pushConsole(st, { level: p.entry.level, text: p.entry.text, ts: p.entry.timestamp, source: p.entry.url || '' });
        break;
      case 'Network.requestWillBeSent': {
        const e = {
          id: p.requestId, url: redactUrl(p.request.url), method: p.request.method, type: p.type || 'Other',
          requestHeaders: redactHeaders(p.request.headers), ts: p.wallTime ? p.wallTime * 1000 : Date.now(),
          status: null, mimeType: '', responseHeaders: {}, error: null,
        };
        if (!st.network.has(p.requestId)) st.networkOrder.push(p.requestId);
        st.network.set(p.requestId, e);
        if (st.networkOrder.length > LOG_BUFFER_MAX) st.network.delete(st.networkOrder.shift());
        break;
      }
      case 'Network.responseReceived': {
        const e = st.network.get(p.requestId);
        if (e) {
          e.status = p.response.status;
          e.mimeType = p.response.mimeType;
          e.responseHeaders = redactHeaders(p.response.headers);
          e.type = p.type || e.type;
        }
        break;
      }
      case 'Network.loadingFailed': {
        const e = st.network.get(p.requestId);
        if (e) e.error = p.errorText || 'failed';
        break;
      }
      case 'Page.frameNavigated':
        if (!p.frame.parentId) {
          const host = safeHost(p.frame.url);
          if (host && host !== st.host) {
            // Network list is cleared automatically on cross-domain navigation.
            st.network.clear();
            st.networkOrder = [];
          }
          st.host = host;
        }
        break;
      case 'Page.javascriptDialogOpening':
        st.dialog = { type: p.type, message: p.message };
        break;
      case 'Page.javascriptDialogClosed':
        st.dialog = null;
        break;
      default:
    }
  }

  #pushConsole(st, entry) {
    entry.host = st.host;
    st.console.push(entry);
    if (st.console.length > LOG_BUFFER_MAX) st.console.shift();
  }

  // ---------- page geometry ----------
  async viewport(tabId) {
    const r = await this.send(tabId, 'Runtime.evaluate', {
      expression: '({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, sx: scrollX, sy: scrollY})',
      returnByValue: true,
    });
    return r.result.value;
  }

  static targetSize(w, h) {
    const maxPixels = MAX_TARGET_PX * PX_PER_TOKEN * PX_PER_TOKEN;
    const s = Math.min(1, MAX_TARGET_PX / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
  }

  // Maps a coordinate in the reference screenshot frame to CSS pixels.
  async toCss(tabId, [x, y]) {
    const vp = await this.viewport(tabId);
    const ref = this.state(tabId).refFrame || CDPManager.targetSize(vp.w, vp.h);
    return [(x * vp.w) / ref.width, (y * vp.h) / ref.height];
  }

  async toRef(tabId, [cx, cy]) {
    const vp = await this.viewport(tabId);
    const ref = this.state(tabId).refFrame || CDPManager.targetSize(vp.w, vp.h);
    return [Math.round((cx * ref.width) / vp.w), Math.round((cy * ref.height) / vp.h)];
  }

  // ---------- screenshots ----------
  async screenshot(tabId, { scale = 1 } = {}) {
    const vp = await this.viewport(tabId);
    const ref = CDPManager.targetSize(vp.w, vp.h);
    this.state(tabId).refFrame = ref;
    const shot = await this.send(tabId, 'Page.captureScreenshot', {
      format: 'jpeg', quality: SCREENSHOT_QUALITY, captureBeyondViewport: false, fromSurface: true,
    });
    const s = Math.min(1, Math.max(0.1, Number(scale) || 1));
    const out = { width: Math.round(ref.width * s), height: Math.round(ref.height * s) };
    const base64 = await resizeJpeg(shot.data, out.width, out.height);
    return { base64, mediaType: 'image/jpeg', width: out.width, height: out.height, refFrame: ref, viewport: vp };
  }

  // Full-resolution crop of a region expressed in the reference frame.
  async zoom(tabId, [x0, y0, x1, y1]) {
    const [cx0, cy0] = await this.toCss(tabId, [x0, y0]);
    const [cx1, cy1] = await this.toCss(tabId, [x1, y1]);
    const vp = await this.viewport(tabId);
    const shot = await this.send(tabId, 'Page.captureScreenshot', {
      format: 'jpeg', quality: 90, fromSurface: true,
      clip: { x: cx0 + vp.sx, y: cy0 + vp.sy, width: Math.max(1, cx1 - cx0), height: Math.max(1, cy1 - cy0), scale: 1 },
    });
    const w = Math.round((cx1 - cx0) * vp.dpr);
    const h = Math.round((cy1 - cy0) * vp.dpr);
    const t = CDPManager.targetSize(w, h);
    const base64 = await resizeJpeg(shot.data, t.width, t.height);
    return { base64, mediaType: 'image/jpeg', width: t.width, height: t.height };
  }

  // ---------- input ----------
  static modifierMask(mods = []) {
    let mask = 0;
    for (const m of mods) {
      const n = MODIFIER_NAMES[String(m).toLowerCase()];
      if (n) mask |= MODIFIER_BITS[n];
    }
    return mask;
  }

  async mouseMove(tabId, x, y, modifiers = 0) {
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers, button: 'none' });
  }

  async click(tabId, x, y, { button = 'left', clickCount = 1, modifiers = 0 } = {}) {
    await this.mouseMove(tabId, x, y, modifiers);
    await sleep(CLICK_MOVE_DELAY_MS);
    for (let i = 1; i <= clickCount; i++) {
      await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: i, modifiers });
      await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: i, modifiers });
    }
  }

  async drag(tabId, [sx, sy], [ex, ey], modifiers = 0) {
    await this.mouseMove(tabId, sx, sy, modifiers);
    await sleep(CLICK_MOVE_DELAY_MS);
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1, modifiers });
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = sx + ((ex - sx) * i) / steps;
      const y = sy + ((ey - sy) * i) / steps;
      await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, modifiers });
      await sleep(16);
    }
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', clickCount: 1, modifiers });
  }

  async scroll(tabId, x, y, direction, amount) {
    const d = amount * SCROLL_PX_PER_TICK;
    const deltaX = direction === 'left' ? -d : direction === 'right' ? d : 0;
    const deltaY = direction === 'up' ? -d : direction === 'down' ? d : 0;
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, button: 'none' });
  }

  async insertText(tabId, text) {
    // Character-by-character so per-keystroke listeners (autocomplete, React) react.
    const chars = [...text];
    if (chars.length > 500) {
      for (let i = 0; i < chars.length; i += 50) {
        await this.send(tabId, 'Input.insertText', { text: chars.slice(i, i + 50).join('') });
      }
      return;
    }
    for (const ch of chars) {
      if (ch === '\n') await this.pressCombo(tabId, 'Enter');
      else await this.send(tabId, 'Input.insertText', { text: ch });
    }
  }

  // "ctrl+a", "Enter", "shift+Tab" ...
  async pressCombo(tabId, combo, extraModifiers = 0) {
    const parts = combo.split('+').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Empty key combination');
    const main = parts.pop();
    const mods = parts.map((m) => {
      const n = MODIFIER_NAMES[m.toLowerCase()];
      if (!n) throw new Error(`Unknown modifier: "${m}"`);
      return n;
    });
    let mask = CDPManager.modifierMask(mods) | extraModifiers;
    let held = extraModifiers;
    for (const m of mods) {
      const d = describeKey(m);
      held |= MODIFIER_BITS[m];
      await this.send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: d.key, code: d.code, windowsVirtualKeyCode: d.keyCode, modifiers: held });
    }
    const d = describeKey(main);
    if (!d) throw new Error(`Unknown key: "${main}"`);
    const printable = !!d.text && !(mask & (MODIFIER_BITS.ctrl | MODIFIER_BITS.meta | MODIFIER_BITS.alt));
    let text = d.text;
    if (printable && (mask & MODIFIER_BITS.shift) && text.length === 1) text = text.toUpperCase();
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      type: printable ? 'keyDown' : 'rawKeyDown', key: d.key, code: d.code,
      windowsVirtualKeyCode: d.keyCode, nativeVirtualKeyCode: d.keyCode, modifiers: mask,
      ...(printable ? { text, unmodifiedText: d.text } : {}),
    });
    await this.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: d.key, code: d.code, windowsVirtualKeyCode: d.keyCode, modifiers: mask });
    for (const m of mods.reverse()) {
      const md = describeKey(m);
      held &= ~MODIFIER_BITS[m];
      await this.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: md.key, code: md.code, windowsVirtualKeyCode: md.keyCode, modifiers: held });
    }
  }

  async evaluate(tabId, expression) {
    const r = await this.send(tabId, 'Runtime.evaluate', {
      expression, replMode: true, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 30_000,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'JavaScript error');
    }
    return r.result;
  }
}

export const cdp = new CDPManager();
export { CDPManager };

// ---------- helpers ----------
export function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function remoteObjToString(o) {
  if (!o) return '';
  if ('value' in o) return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
  if (o.unserializableValue) return o.unserializableValue;
  return o.description || o.type;
}

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token|api-key)$/i;
const SENSITIVE_PARAM = /^(access_token|id_token|refresh_token|token|api_key|apikey|key|code|password|secret|session|sig|signature)$/i;

export function redactHeaders(h = {}) {
  const out = {};
  for (const [k, v] of Object.entries(h)) out[k] = SENSITIVE_HEADER.test(k) ? 'REDACTED' : v;
  return out;
}

export function redactUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (SENSITIVE_PARAM.test(k)) url.searchParams.set(k, 'REDACTED');
    if (url.password) url.password = 'REDACTED';
    return url.toString();
  } catch {
    return u;
  }
}

async function resizeJpeg(b64, width, height) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  if (bmp.width === width && bmp.height === height) { bmp.close(); return b64; }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: SCREENSHOT_QUALITY / 100 });
  return blobToBase64(blob);
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
