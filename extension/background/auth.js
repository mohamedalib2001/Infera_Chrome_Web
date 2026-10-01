// Authentication: an INFERA Agent account is the only way to use the extension.
// The person signs in on inferaagent.com (OAuth 2.1 + PKCE); model calls then go
// through the INFERA Agent gateway (/api/browser-agent), which checks the account
// and its credits and charges the usage. There is no personal API key option, no
// other sign-in provider, and store builds cannot be pointed at another server.
import { STORAGE_KEYS } from './constants.js';
import { getLocal, setLocal, getSettings } from './storage.js';
import { INFERA_API_URL } from '../config.js';

// ---------------- Infera Agent account (OAuth 2.1 + PKCE) ----------------
// inferaagent.com is an OAuth authorization server (the same one MCP apps use):
// the extension registers itself as a public client, the person approves it
// on inferaagent.com (password, Google or SSO — whatever they sign in with),
// and the access token authorises the model gateway /api/browser-agent.

// Store builds (installed from the Web Store, so they have an update_url) always
// use inferaagent.com. Only an unpacked developer build may use a local test server.
export function isDevBuild() {
  return !chrome.runtime.getManifest().update_url;
}

const LOCAL_SERVER = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export async function inferaServer() {
  const fixed = String(INFERA_API_URL || 'https://inferaagent.com').replace(/\/+$/, '');
  if (!isDevBuild()) return fixed;
  const s = await getSettings();
  const dev = String(s.inferaUrl || '').replace(/\/+$/, '');
  return LOCAL_SERVER.test(dev) ? dev : fixed;
}

async function inferaFetch(url, { method = 'GET', token, body, form } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`Cannot reach INFERA Agent at ${new URL(url).origin}.`);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || `INFERA Agent returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function discover(server) {
  const meta = await inferaFetch(`${server}/.well-known/oauth-authorization-server`);
  if (!meta?.authorization_endpoint || !meta?.token_endpoint) throw new Error('This server does not offer INFERA Agent sign-in.');
  return meta;
}

// One public client per server and redirect URI, registered on first sign-in.
async function clientFor(server, meta, redirectUri) {
  const key = `oauthClient:${server}`;
  const saved = await getLocal(key, null);
  if (saved?.client_id && saved.redirect_uri === redirectUri) return saved.client_id;
  if (!meta.registration_endpoint) throw new Error('This server does not allow app registration.');
  const reg = await inferaFetch(meta.registration_endpoint, {
    method: 'POST',
    body: { client_name: 'INFERA Agent for Chrome', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
  });
  await setLocal(key, { client_id: reg.client_id, redirect_uri: redirectUri });
  return reg.client_id;
}

export async function inferaSignIn() {
  const base = await inferaServer();
  const meta = await discover(base);
  const redirectUri = chrome.identity.getRedirectURL('infera');
  const clientId = await clientFor(base, meta, redirectUri);
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state,
    code_challenge: challenge, code_challenge_method: 'S256', scope: (meta.scopes_supported || []).join(' '),
  }).toString();

  let returned;
  try {
    returned = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  } catch (e) {
    throw new Error(/did not approve|canceled|closed/i.test(String(e?.message)) ? 'Sign-in was cancelled.' : `Sign-in failed: ${e?.message || e}`);
  }
  const back = new URL(returned);
  if (back.searchParams.get('state') !== state) throw new Error('Sign-in failed (state mismatch). Try again.');
  if (back.searchParams.get('error')) throw new Error(back.searchParams.get('error') === 'access_denied' ? 'Access was not approved.' : back.searchParams.get('error'));
  const code = back.searchParams.get('code');
  if (!code) throw new Error('Sign-in failed: no authorization code.');

  const t = await inferaFetch(meta.token_endpoint, {
    method: 'POST',
    form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier },
  });
  await saveInfera({ server: base, clientId, tokenEndpoint: meta.token_endpoint }, t);
  await refreshInferaAccount();
  return authStatus();
}

async function saveInfera(ctx, t, prev = {}) {
  await setLocal(STORAGE_KEYS.AUTH, {
    ...prev,
    kind: 'infera',
    server: ctx.server,
    clientId: ctx.clientId,
    tokenEndpoint: ctx.tokenEndpoint,
    accessToken: t.access_token,
    refreshToken: t.refresh_token || prev.refreshToken || null,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 - 60_000 : null,
  });
}

// Exchanges the refresh token for a new access token; signs out if that fails.
async function refreshInferaToken(a) {
  if (!a?.refreshToken) return null;
  try {
    const t = await inferaFetch(a.tokenEndpoint || `${a.server}/oauth/token`, {
      method: 'POST', form: { grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: a.clientId },
    });
    await saveInfera({ server: a.server, clientId: a.clientId, tokenEndpoint: a.tokenEndpoint }, t, a);
    return t.access_token;
  } catch {
    await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
    return null;
  }
}

// The stored INFERA Agent session, refreshed if expired. Anything else stored
// under the auth key (another server, or an older version's key/OAuth data) is
// not a valid session and is dropped.
async function currentInfera() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (!a) return null;
  if (a.kind !== 'infera' || !a.accessToken || a.server !== (await inferaServer())) {
    await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
    return null;
  }
  if (a.expiresAt && Date.now() > a.expiresAt) {
    const tok = await refreshInferaToken(a);
    return tok ? getLocal(STORAGE_KEYS.AUTH, null) : null;
  }
  return a;
}

export async function refreshInferaAccount() {
  const a = await currentInfera();
  if (!a) return authStatus();
  try {
    const me = await inferaFetch(`${a.server}/api/browser-agent/me`, { token: a.accessToken });
    await setLocal(STORAGE_KEYS.AUTH, { ...a, account: { email: me.email, displayName: me.name, avatar: me.avatar }, credits: me.credits, currency: me.currency, block: me.block });
  } catch (e) {
    if (e.status === 401) {
      if (!(await refreshInferaToken(a))) return authStatus();
      return refreshInferaAccount();
    }
  }
  return authStatus();
}

// What the model client should use for this request.
export async function getModelAuth() {
  const cur = await currentInfera();
  if (!cur) throw new Error('Sign in with your INFERA Agent account to start (side panel → Sign in).');
  return { mode: 'infera', baseUrl: `${cur.server}/api/browser-agent`, token: cur.accessToken };
}

// The gateway said 401: try the refresh token once; true means "retry".
export async function handleInferaUnauthorized() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (a?.kind !== 'infera') return false;
  return !!(await refreshInferaToken(a));
}

// The person's browser-agent cost log from inferaagent.com (all their devices).
export async function inferaUsage(days = 30, retried = false) {
  const a = await currentInfera();
  if (!a) throw new Error('Sign in to see your costs.');
  try {
    return await inferaFetch(`${a.server}/api/browser-agent/usage?days=${Number(days) || 30}`, { token: a.accessToken });
  } catch (e) {
    if (e.status === 401 && !retried && await refreshInferaToken(a)) return inferaUsage(days, true);
    if (e.status === 404) throw new Error('The cost log is not available on the server yet.');
    throw e;
  }
}

// Access token for other INFERA Agent services (the cloud relay).
export async function getAccessToken() {
  return (await currentInfera())?.accessToken ?? null;
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}

export async function signOut() {
  // The token is dropped here; the person can also revoke "INFERA Agent for Chrome"
  // under Settings → Connect on inferaagent.com.
  await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
}

export async function authStatus() {
  const a = await currentInfera();
  const infera = !!a && !(a.expiresAt && Date.now() > a.expiresAt);
  return {
    infera,
    signedIn: infera,
    account: infera ? a.account || null : null,
    credits: infera ? a.credits ?? null : null,
    currency: infera ? a.currency ?? null : null,
    block: infera ? a.block ?? null : null,
    server: await inferaServer(),
    ready: infera,
  };
}
