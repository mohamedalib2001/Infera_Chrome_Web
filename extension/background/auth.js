// Optional OAuth 2.0 PKCE sign-in against an Infera (or other) authorization
// server. Configured in Settings -> Account. When no OAuth server is set, the
// agent uses the API key from settings instead.
import { STORAGE_KEYS } from './constants.js';
import { getLocal, setLocal, getSettings, getManagedPolicy } from './storage.js';

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
  await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
}

export async function authStatus() {
  const a = await getLocal(STORAGE_KEYS.AUTH, null);
  const s = await getSettings();
  return { oauth: !!a?.accessToken, account: a?.account || null, apiKey: !!s.apiKey };
}
