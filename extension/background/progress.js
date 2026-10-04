// How a task is going, step by step, judged from what happened rather than from what was sent: the same action
// failing or doing nothing again, whether the page changed after the agent last looked at it, and a task that was
// cut off (the browser closed or restarted) marked as such instead of looking finished or lost.
import { getLocal, setLocal } from './storage.js';
import { STORAGE_KEYS } from './constants.js';

// Actions that change a page, and the ones that look at it.
const CHANGE = new Set(['left_click', 'double_click', 'triple_click', 'middle_click', 'type', 'key', 'form_input', 'file_upload', 'left_click_drag', 'navigate', 'javascript_exec', 'left_mouse_up']);
const LOOK = new Set(['screenshot', 'read_page', 'get_page_text', 'find', 'zoom']);
const CLASSIC_LOOK = new Set(['read_page', 'get_page_text', 'find']);

const memberOf = (u) => (u.name === 'computer' ? u.input?.action : u.name === 'javascript_tool' ? 'javascript_exec' : u.name);

export function changesPage(u) { return CHANGE.has(memberOf(u)); }
export function looksAtPage(u) { const m = memberOf(u); return LOOK.has(m) || CLASSIC_LOOK.has(u.name); }

/** The same action on the same target (the tab doesn't matter). */
export function actionKey(u) {
  const { tabId, tab_id, ...rest } = u.input || {}; // eslint-disable-line no-unused-vars
  return `${u.name}:${JSON.stringify(rest).slice(0, 400)}`;
}

/** Said with the result when the very same action has failed or done nothing again. */
export function repeatNote(times, failed) {
  return `This exact action has now ${failed ? 'failed' : 'had no visible effect'} ${times} times. Don't repeat it unchanged. Work out why from what you can see: is the element still there and visible (read_page or find for a fresh ref, scroll it into view)? Is something covering it (a dialog, a cookie banner, a menu)? Is it disabled until another field is filled? Is the page still loading? Then try a different way — another element or ref, the keyboard, a direct URL — or tell the user what is blocking you.`;
}

/** Before finishing, when the page changed after the agent last looked at it. */
export const VERIFY_NOTE = `<system-reminder>Before you finish: the page changed after you last looked at it. Check that it really shows the goal reached (a screenshot, or read the relevant part) — a click going through is not the same as the task being done. If it isn't done, keep working; if it is, give your answer.</system-reminder>`;

/** At start-up: a task that was running when the browser stopped is marked stopped, with its steps kept. */
export async function markInterrupted() {
  const all = await getLocal(STORAGE_KEYS.CONVERSATIONS, []);
  let changed = false;
  for (const c of all) {
    if (c.status === 'running' || c.status === 'waiting') { c.status = 'stopped'; c.interrupted = true; changed = true; }
  }
  if (changed) await setLocal(STORAGE_KEYS.CONVERSATIONS, all);
  return changed;
}
