// chrome.storage helpers + settings with defaults + managed (enterprise) policy.
import { STORAGE_KEYS, DEFAULT_MODEL, PERMISSION_MODES } from './constants.js';

export const DEFAULT_SETTINGS = {
  inferaUrl: '',   // Infera Agent server; defaults to config.js INFERA_API_URL
  apiKey: '',      // developer mode only
  apiBaseUrl: 'https://api.anthropic.com',
  model: DEFAULT_MODEL,
  effort: 'high',
  permissionMode: PERMISSION_MODES.AUTO,
  safetyChecker: true,
  language: 'auto',
  notifications: true,
  sound: true,
  userBlocklist: [],
  relayUrl: '',
  relayEnabled: false,
  remoteDomainClassifier: '', // optional URL template, e.g. https://api.infera.ai/domain_info?domain={domain}
  oauth: { authorizeUrl: '', tokenUrl: '', clientId: '', scopes: 'user:profile user:inference' },
  defaultKeepTabs: false,
};

export async function getLocal(key, fallback) {
  const r = await chrome.storage.local.get(key);
  return r[key] === undefined ? fallback : r[key];
}

export async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function getSettings() {
  const s = await getLocal(STORAGE_KEYS.SETTINGS, {});
  const managed = await getManagedPolicy();
  const merged = { ...DEFAULT_SETTINGS, ...s, oauth: { ...DEFAULT_SETTINGS.oauth, ...(s.oauth || {}) } };
  if (!s.permissionMode && managed.defaultPermissionMode) merged.permissionMode = managed.defaultPermissionMode;
  if (managed.apiBaseUrl) merged.apiBaseUrl = managed.apiBaseUrl;
  if (managed.relayUrl) merged.relayUrl = managed.relayUrl;
  if (managed.disableSkipAllApprovals && merged.permissionMode === PERMISSION_MODES.SKIP_ALL) {
    merged.permissionMode = PERMISSION_MODES.AUTO;
  }
  return merged;
}

export async function updateSettings(patch) {
  const cur = await getLocal(STORAGE_KEYS.SETTINGS, {});
  const next = { ...cur, ...patch };
  await setLocal(STORAGE_KEYS.SETTINGS, next);
  return getSettings();
}

let managedCache = null;
export async function getManagedPolicy() {
  if (managedCache) return managedCache;
  try {
    managedCache = (await chrome.storage.managed.get(null)) || {};
  } catch {
    managedCache = {};
  }
  return managedCache;
}
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'managed') managedCache = null;
});

export function uuid() {
  return crypto.randomUUID();
}
