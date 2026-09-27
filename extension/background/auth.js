// Authentication, in order of preference:
//   1. Infera Agent account — email + password against the Infera Agent API
//      (POST /v1/sessions). Model calls then go through the Infera gateway
//      (/v1/browser-agent), so no provider key ever reaches the browser.
//   2. OAuth 2.0 PKCE against a configured authorization server.
//   3. A personal API key (developer mode, Settings -> Advanced).
import { STORAGE_KEYS } from './constants.js';
import { getLocal, setLocal, getSettings, getManagedPolicy } from './storage.js';
import { INFERA_API_URL } from '../config.js';

// ---------------- Infera Agent account ----------------
export async function inferaServer() {
  const s = await getSettings();
  const policy = await getManagedPolicy();
  return String(policy.inferaUrl || s.inferaUrl || INFERA_API_URL || '').replace(/\/+$/, '');
}

async function inferaFetch(base, path, { method = 'GET', token, body } = {}) {
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`Cannot reach the Infera Agent server at ${base}.`);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Infera Agent server returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function inferaSignIn({ email, password, server }) {
  if (server) {
    const clean = String(server).trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(clean) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(clean)) {
      throw new Error('The Infera Agent server address must start with https://');
    }
    const cur = await getLocal(STORAGE_KEYS.SETTINGS, {});
    await setLocal(STORAGE_KEYS.SETTINGS, { ...cur, inferaUrl: clean });
  }
  const base = await inferaServer();
  if (!base) throw new Error('Enter your Infera Agent server address.');
  if (!email || !password) throw new Error('Enter your email and password.');
  const session = await inferaFetch(base, '/v1/sessions', { method: 'POST', body: { email: String(email).trim(), password } });
  const me = await inferaFetch(base, '/v1/browser-agent/me', { token: session.token }).catch(() => null);
  await setLocal(STORAGE_KEYS.AUTH, {
    kind: 'infera',
    server: base,
    accessToken: session.token,
    expiresAt: session.expiresAt ? Date.parse(session.expiresAt) : null,
    organizationId: session.organizationId,
    account: me ? { email: me.email, displayName: me.displayName, organizationName: me.organizationName } : { email: String(email).trim() },
    providerConfigured: me?.providerConfigured ?? null,
  });
  return authStatus();
}

export async function refreshInferaAccount() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (a?.kind !== 'infera') return null;
  try {
    const me = await inferaFetch(a.server, '/v1/browser-agent/me', { token: a.accessToken });
    await setLocal(STORAGE_KEYS.AUTH, { ...a, providerConfigured: me.providerConfigured, account: { email: me.email, displayName: me.displayName, organizationName: me.organizationName } });
  } catch (e) {
    if (e.status === 401) await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
  }
  return authStatus();
}

// What the model client should use for this request.
export async function getModelAuth() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (a?.kind === 'infera' && a.accessToken) {
    if (a.expiresAt && Date.now() > a.expiresAt) {
      await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
      throw new Error('Your Infera Agent session has expired. Sign in again from the side panel.');
    }
    return { mode: 'infera', baseUrl: `${a.server}/v1/browser-agent`, token: a.accessToken };
  }
  const token = await getAccessToken();
  if (token) return { mode: 'oauth', token };
  return { mode: 'apikey' };
}

export async function handleInferaUnauthorized() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  if (a?.kind === 'infera') await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
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
  if (a.kind === 'infera') return a.expiresAt && Date.now() > a.expiresAt ? null : a.accessToken;
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
  if (a?.kind === 'infera') {
    await inferaFetch(a.server, '/v1/sessions/current', { method: 'DELETE', token: a.accessToken }).catch(() => {});
  }
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
    providerConfigured: infera ? a.providerConfigured : null,
    server: await inferaServer(),
    apiKey: !!s.apiKey,
    ready: infera || !!a?.accessToken || !!s.apiKey,
  };
}
