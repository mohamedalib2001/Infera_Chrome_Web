// Authentication, in order of preference:
//   1. INFERA Agent account — OAuth sign-in on inferaagent.com. Model calls then
//      go through the INFERA Agent gateway (/api/browser-agent) and are paid from
//      the person's credits; no provider key ever reaches the browser.
//   2. OAuth 2.0 PKCE against a configured authorization server.
//   3. A personal API key (developer mode, Settings -> Advanced).
import { STORAGE_KEYS } from './constants.js';
import { getLocal, setLocal, getSettings, getManagedPolicy } from './storage.js';
import { INFERA_API_URL } from '../config.js';

// ---------------- Infera Agent account (OAuth 2.1 + PKCE) ----------------
// inferaagent.com is an OAuth authorization server (the same one MCP apps use):
// the extension registers itself as a public client, the person approves it
// on inferaagent.com (password, Google or SSO — whatever they sign in with),
// and the access token authorises the model gateway /api/browser-agent.
export async function inferaServer() {
  const s = await getSettings();
  const policy = await getManagedPolicy();
  return String(policy.inferaUrl || s.inferaUrl || INFERA_API_URL || '').replace(/\/+$/, '');
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

export async function inferaSignIn({ server } = {}) {
  if (server) {
    const clean = String(server).trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(clean) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(clean)) {
      throw new Error('The INFERA Agent address must start with https://');
    }
    const cur = await getLocal(STORAGE_KEYS.SETTINGS, {});
    await setLocal(STORAGE_KEYS.SETTINGS, { ...cur, inferaUrl: clean });
  }
  const base = await inferaServer();
  if (!base) throw new Error('Enter the INFERA Agent address.');
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

async function currentInfera() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (a?.kind !== 'infera' || !a.accessToken) return null;
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
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (a?.kind === 'infera') {
    const cur = await currentInfera();
    if (!cur) throw new Error('Your INFERA Agent session has ended. Sign in again from the side panel.');
    return { mode: 'infera', baseUrl: `${cur.server}/api/browser-agent`, token: cur.accessToken };
  }
  const token = await getAccessToken();
  if (token) return { mode: 'oauth', token };
  return { mode: 'apikey' };
}

// The gateway said 401: try the refresh token once; true means "retry".
export async function handleInferaUnauthorized() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (a?.kind !== 'infera') return false;
  return !!(await refreshInferaToken(a));
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}

export async function signIn() {
  const s = await getSettings();
  const o = s.oauth;
  if (!o.authorizeUrl || !o.tokenUrl || !o.clientId) throw new Error('OAuth is not configured (authorize URL, token URL and client ID are required).');
  const redirectUri = o.redirectUri || 'https://infera.ai/oauth/callback';
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = new URL(o.authorizeUrl);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: o.clientId, redirect_uri: redirectUri, scope: o.scopes,
    code_challenge: challenge, code_challenge_method: 'S256', state,
  }).toString();

  const tab = await chrome.tabs.create({ url: url.toString(), active: true });
  const code = await new Promise((resolve, reject) => {
    const onNav = (d) => {
      if (d.tabId !== tab.id || !d.url.startsWith(redirectUri)) return;
      cleanup();
      const u = new URL(d.url);
      chrome.tabs.remove(tab.id).catch(() => {});
      if (u.searchParams.get('state') !== state) return reject(new Error('OAuth state mismatch'));
      if (u.searchParams.get('error')) return reject(new Error(u.searchParams.get('error_description') || u.searchParams.get('error')));
      resolve(u.searchParams.get('code'));
    };
    const onRemoved = (id) => { if (id === tab.id) { cleanup(); reject(new Error('Sign-in window closed')); } };
    const cleanup = () => {
      chrome.webNavigation.onBeforeNavigate.removeListener(onNav);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    chrome.webNavigation.onBeforeNavigate.addListener(onNav);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });

  const tokens = await tokenRequest(o.tokenUrl, {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: o.clientId, code_verifier: verifier,
  });
  const policy = await getManagedPolicy();
  if (policy.forceLoginOrgUUID && tokens.organization?.uuid && tokens.organization.uuid !== policy.forceLoginOrgUUID) {
    throw new Error('Your organization requires signing in with a specific organization account.');
  }
  await saveTokens(tokens);
  return { signedIn: true };
}

async function tokenRequest(tokenUrl, params) {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Token endpoint returned ${res.status}`);
  return res.json();
}

async function saveTokens(t) {
  await setLocal(STORAGE_KEYS.AUTH, {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || null,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 - 60_000 : null,
    scope: t.scope || '',
    account: t.account || null,
  });
}

export async function getAccessToken() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (!a?.accessToken) return null;
  if (a.kind === 'infera') return (await currentInfera())?.accessToken ?? null;
  if (a.expiresAt && Date.now() > a.expiresAt) {
    if (!a.refreshToken) return null;
    const s = await getSettings();
    try {
      const t = await tokenRequest(s.oauth.tokenUrl, { grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: s.oauth.clientId });
      await saveTokens({ refresh_token: a.refreshToken, ...t });
      return t.access_token;
    } catch {
      return null;
    }
  }
  return a.accessToken;
}

export async function signOut() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  // The token is dropped here; the person can also revoke "INFERA Agent for Chrome"
  // under Settings → Connect on inferaagent.com.
  void a;
  await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
}

export async function authStatus() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  const s = await getSettings();
  const infera = a?.kind === 'infera' && !!a.accessToken && !(a.expiresAt && Date.now() > a.expiresAt);
  return {
    infera,
    oauth: !infera && !!a?.accessToken,
    signedIn: !!a?.accessToken,
    account: a?.account || null,
    credits: infera ? a.credits ?? null : null,
    currency: infera ? a.currency ?? null : null,
    block: infera ? a.block ?? null : null,
    server: await inferaServer(),
    apiKey: !!s.apiKey,
    ready: infera || !!a?.accessToken || !!s.apiKey,
  };
}
