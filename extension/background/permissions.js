// PermissionManager (singleton). Decides, per tool action, whether the agent may
// proceed, must ask the user, or is denied.
//
// Stored site permissions live in chrome.storage.local under "permissionStorage":
//   { action:"allow", createdAt, duration:"always", id, scope:{netloc,type:"netloc"}, mac }
// Unlike a plain JSON list, every entry carries an HMAC-SHA256 computed with a
// non-extractable key kept in IndexedDB, so entries injected by editing the
// profile's LevelDB files are rejected (they would need the key to forge a MAC).
import { PERMISSION_MODES, PERMISSION_TYPES, STORAGE_KEYS } from './constants.js';
import { getLocal, setLocal, uuid } from './storage.js';

const MUTATING = new Set([PERMISSION_TYPES.CLICK, PERMISSION_TYPES.TYPE, PERMISSION_TYPES.UPLOAD_IMAGE, PERMISSION_TYPES.NAVIGATE, PERMISSION_TYPES.DOMAIN_TRANSITION]);

// ---------- integrity key ----------
let keyPromise = null;
function integrityKey() {
  if (keyPromise) return keyPromise;
  keyPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('infera-integrity', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('keys').objectStore('keys').get('permissions');
      get.onsuccess = async () => {
        if (get.result) return resolve(get.result);
        const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
        const put = db.transaction('keys', 'readwrite').objectStore('keys').put(key, 'permissions');
        put.onsuccess = () => resolve(key);
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    };
  });
  return keyPromise;
}

function canonical(e) {
  return JSON.stringify([e.id, e.action, e.duration, e.createdAt, e.scope.type, e.scope.netloc, e.permissionType || '*']);
}
async function sign(e) {
  const sig = await crypto.subtle.sign('HMAC', await integrityKey(), new TextEncoder().encode(canonical(e)));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function verify(e) {
  if (!e?.mac) return false;
  try {
    const bytes = Uint8Array.from(atob(e.mac), (c) => c.charCodeAt(0));
    return crypto.subtle.verify('HMAC', await integrityKey(), bytes, new TextEncoder().encode(canonical(e)));
  } catch {
    return false;
  }
}

class PermissionManager {
  constructor() {
    this.once = new Map(); // toolUseId -> Set("TYPE|netloc")
    this.plans = new Map(); // sessionId -> {domains:Set, approach}
  }

  async list() {
    const raw = await getLocal(STORAGE_KEYS.PERMISSIONS, []);
    const out = [];
    for (const e of raw) out.push({ ...e, valid: await verify(e) });
    return out;
  }

  async #validEntries() {
    return (await this.list()).filter((e) => e.valid);
  }

  async grantAlways(netloc, permissionType = null) {
    const raw = await getLocal(STORAGE_KEYS.PERMISSIONS, []);
    if (raw.some((e) => e.scope?.netloc === netloc && (e.permissionType || null) === permissionType)) return;
    const e = { action: 'allow', createdAt: Date.now(), duration: 'always', id: uuid(), scope: { netloc, type: 'netloc' } };
    if (permissionType) e.permissionType = permissionType;
    e.mac = await sign(e);
    raw.push(e);
    await setLocal(STORAGE_KEYS.PERMISSIONS, raw);
  }

  async revoke(id) {
    const raw = await getLocal(STORAGE_KEYS.PERMISSIONS, []);
    await setLocal(STORAGE_KEYS.PERMISSIONS, raw.filter((e) => e.id !== id));
  }

  async revokeAll() {
    await setLocal(STORAGE_KEYS.PERMISSIONS, []);
  }

  async hasAlways(netloc, type) {
    const entries = await this.#validEntries();
    return entries.some((e) => e.action === 'allow' && e.duration === 'always' && e.scope.netloc === netloc && (!e.permissionType || e.permissionType === type));
  }

  grantOnce(toolUseId, type, netloc) {
    if (!toolUseId) return;
    if (!this.once.has(toolUseId)) this.once.set(toolUseId, new Set());
    this.once.get(toolUseId).add(`${type}|${netloc}`);
  }

  consumeOnce(toolUseId) { this.once.delete(toolUseId); }

  hasOnce(toolUseId, type, netloc) {
    return !!this.once.get(toolUseId)?.has(`${type}|${netloc}`);
  }

  setPlan(sessionId, domains, approach) {
    this.plans.set(sessionId, { domains: new Set(domains.map((d) => d.toLowerCase().replace(/^www\./, ''))), approach });
  }
  clearPlan(sessionId) { this.plans.delete(sessionId); }
  planCovers(sessionId, netloc) {
    const p = this.plans.get(sessionId);
    if (!p) return false;
    const h = netloc.toLowerCase().replace(/^www\./, '');
    return [...p.domains].some((d) => h === d || h.endsWith('.' + d));
  }

  /**
   * @param ctx  { sessionId, mode, requestApproval(req) -> 'once'|'always'|'deny', safetyCheck(req) -> {verdict, reason} }
   * @param req  { type, netloc, url, toolUseId, description, category, forcePrompt, forceReason }
   * @returns {Promise<{allowed:boolean, reason?:string}>}
   */
  async check(ctx, req) {
    const { type, netloc, toolUseId } = req;
    const forced = req.forcePrompt || req.category === 'category3';
    const allowAlways = req.category !== 'category3' && !req.forcePrompt;

    if (!forced) {
      if (ctx.mode === PERMISSION_MODES.SKIP_ALL) return { allowed: true };
      if (this.hasOnce(toolUseId, type, netloc)) return { allowed: true };
      if (await this.hasAlways(netloc, type)) return { allowed: true };

      if (ctx.mode === PERMISSION_MODES.AUTO) {
        if (!MUTATING.has(type) || !ctx.safetyCheck) return { allowed: true };
        const v = await ctx.safetyCheck(req);
        if (v.verdict === 'allow') return { allowed: true };
        if (v.verdict === 'block') return { allowed: false, reason: `Blocked by the safety checker: ${v.reason}` };
        req.description = `${req.description}\n\nSafety check: ${v.reason}`;
      } else if (ctx.mode === PERMISSION_MODES.PLAN) {
        if (this.planCovers(ctx.sessionId, netloc)) return { allowed: true };
      } else if (ctx.mode === PERMISSION_MODES.ASK && type === PERMISSION_TYPES.READ_PAGE_CONTENT) {
        // Manual mode still lets the agent look at pages the user already approved once this session.
        if (this.hasOnce(`session:${ctx.sessionId}`, type, netloc)) return { allowed: true };
      }
    }

    const answer = await ctx.requestApproval({ ...req, allowAlways, reason: req.forceReason || '' });
    if (answer === 'always' && allowAlways) {
      await this.grantAlways(netloc);
      return { allowed: true };
    }
    if (answer === 'once' || (answer === 'always' && !allowAlways)) {
      this.grantOnce(toolUseId, type, netloc);
      if (type === PERMISSION_TYPES.READ_PAGE_CONTENT) this.grantOnce(`session:${ctx.sessionId}`, type, netloc);
      return { allowed: true };
    }
    return { allowed: false, reason: 'The user declined this action.' };
  }
}

export const permissions = new PermissionManager();
