// The extension inside the person's Infera Agent account:
// - the rules of the teams they work in (sites the browser agent never opens),
//   refreshed every 15 minutes and applied by domain-safety.js;
// - tasks sent from the app or a phone to this browser: picked up every minute,
//   run in a window of their own, and their result reported back to the account.
import { getLocal, setLocal, getSettings } from './storage.js';
import { inferaApi } from './auth.js';

const POLICY_KEY = 'orgPolicy';
const POLICY_EVERY_MS = 15 * 60_000;
export const ACCOUNT_ALARM = 'infera-account';
let policyCache = null;
let running = false; // one task from the account at a time

/** The team rules this browser applies: { orgs, blocked, blockedBy, blocklist, memberDailyCap, at }. */
export async function orgPolicy() {
  if (!policyCache) policyCache = await getLocal(POLICY_KEY, null);
  return policyCache || { orgs: [], blocklist: [] };
}

export async function refreshOrgPolicy({ force = false } = {}) {
  const cur = await orgPolicy();
  if (!force && cur.at && Date.now() - cur.at < POLICY_EVERY_MS) return cur;
  try {
    const p = await inferaApi('policy');
    policyCache = { orgs: p.orgs || [], blocked: !!p.blocked, blockedBy: p.blockedBy || '', blocklist: p.blocklist || [], memberDailyCap: p.memberDailyCap ?? null, at: Date.now() };
    await setLocal(POLICY_KEY, policyCache);
  } catch { /* offline, or an older server: keep the last known rules */ }
  return orgPolicy();
}

/** Takes the next task sent from the account, if any, and runs it with runTask(task) → {status, result, conversationId}. */
export async function pollAccountTasks(runTask) {
  if (running) return null;
  const settings = await getSettings();
  if (settings.remoteTasks === false) return null;
  let queued = [];
  try { queued = await inferaApi('tasks?status=queued'); } catch { return null; }
  const task = Array.isArray(queued) ? queued[0] : null;
  if (!task) return null;
  // Taking it is atomic on the server: another browser of the same account may have it already.
  try { await inferaApi(`tasks/${task.id}`, { method: 'PATCH', body: { status: 'running' } }); } catch { return null; }
  running = true;
  let out = { status: 'error', result: '' };
  try {
    out = await runTask(task);
  } catch (e) {
    out = { status: 'error', result: e.message };
  } finally {
    running = false;
  }
  const status = out.status === 'done' ? 'done' : out.status === 'stopped' ? 'stopped' : 'error';
  await inferaApi(`tasks/${task.id}`, { method: 'PATCH', body: { status, result: String(out.result || '').slice(0, 20_000), conversationId: out.conversationId } }).catch(() => {});
  return { id: task.id, status };
}
