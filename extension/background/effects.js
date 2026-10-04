// What an action actually did to the page. A click that "succeeded" says nothing about the goal: the page may
// have navigated, opened a dialog, shown a validation error, added a success message — or not changed at all
// (the click missed, an overlay caught it, the page is still loading). Before an interactive action a small
// observer is placed in the page; after it, the page is given a moment to settle and the difference is put
// into one or two short lines for the model. No screenshot and no site-specific rules: it reads what any page
// exposes (URL, title, added/removed nodes and their text, dialogs, alerts and live regions, invalid fields,
// busy indicators, the focused element), so the agent knows what happened without spending a screenshot.
import { cdp } from './cdp.js';

// Installed in the page before the action: counts what is added/removed and keeps the new visible text.
const ARM = `(() => {
  const w = window;
  if (w.__inferaFx) w.__inferaFx.obs.disconnect();
  const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width && !r.height) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const msgs = () => [...document.querySelectorAll('[role=alert], [role=status], [aria-live=assertive], [aria-live=polite], .toast, .alert, .error, .notification')].filter(vis).map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200)).filter(Boolean);
  const bad = () => [...document.querySelectorAll('[aria-invalid=true], input, select, textarea')].filter((el) => { if (!vis(el)) return false; if (el.getAttribute('aria-invalid') === 'true') return true; try { return el.matches(':user-invalid'); } catch { return false; } }).map((el) => (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.name || el.id || el.tagName.toLowerCase()).replace(/\\s+/g, ' ').trim().slice(0, 60) + (el.validationMessage ? ': ' + el.validationMessage : ''));
  // What was already on the page before the action is not news afterwards.
  const fx = { added: 0, removed: 0, text: [], last: Date.now(), url: location.href, title: document.title, msgs: msgs(), bad: bad() };
  const visible = (el) => { const r = el.getBoundingClientRect?.(); if (!r || (!r.width && !r.height)) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  // The extension's own indicator (shown and hidden around every action) is not the page changing.
  const ours = (n) => { for (let e = n && (n.nodeType === 1 ? n : n.parentElement); e; e = e.parentElement) if (/^INFERA-/.test(e.tagName)) return true; return false; };
  fx.obs = new MutationObserver((list) => {
    list = list.filter((m) => !ours(m.target) && ![...m.addedNodes, ...m.removedNodes].some(ours));
    if (!list.length) return;
    fx.last = Date.now(); fx.changed = true;
    for (const m of list) {
      fx.removed += m.removedNodes.length;
      for (const n of m.addedNodes) {
        fx.added++;
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el || !visible(el) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
        const t = (n.nodeType === 1 ? n.innerText : n.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t.length > 1 && fx.text.length < 12 && !fx.text.includes(t)) fx.text.push(t.slice(0, 160));
      }
      if (m.type === 'characterData' && m.target.parentElement && visible(m.target.parentElement)) {
        const t = (m.target.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t.length > 1 && fx.text.length < 12 && !fx.text.includes(t)) fx.text.push(t.slice(0, 160));
      }
      if (m.type === 'attributes') fx.attrs = (fx.attrs || 0) + 1;
    }
  });
  fx.obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open', 'aria-expanded', 'aria-hidden', 'aria-invalid', 'hidden', 'disabled', 'aria-selected', 'aria-checked', 'aria-pressed'] });
  w.__inferaFx = fx;
  return true;
})()`;

// Read after the action: what the observer saw, and the page's state that matters for "did it work".
const READ = `(() => {
  const fx = window.__inferaFx || { added: 0, removed: 0, text: [], last: 0, url: '', title: '', msgs: [], bad: [] };
  const visible = (el) => { const r = el.getBoundingClientRect(); if (!r.width && !r.height) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.name || el.id || el.tagName.toLowerCase()).replace(/\\s+/g, ' ').trim().slice(0, 60);
  const txt = (el) => (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  const dialogs = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]')].filter(visible).map((d) => (d.getAttribute('aria-label') || d.querySelector('h1,h2,h3,[role=heading]')?.innerText || txt(d)).replace(/\\s+/g, ' ').trim().slice(0, 120));
  const alerts = [...document.querySelectorAll('[role=alert], [role=status], [aria-live=assertive], [aria-live=polite], .toast, .alert, .error, .notification')].filter(visible).map(txt).filter(Boolean);
  const userInvalid = (el) => { try { return el.matches(':user-invalid'); } catch { return false; } };
  const invalid = [...document.querySelectorAll('[aria-invalid=true], input, select, textarea')].filter((el) => visible(el) && (el.getAttribute('aria-invalid') === 'true' || userInvalid(el)))
    .map((el) => label(el) + (el.validationMessage ? ': ' + el.validationMessage : '')).slice(0, 6);
  const a = document.activeElement;
  const focus = a && a !== document.body ? (a.getAttribute('aria-label') || a.innerText || a.name || a.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60) : '';
  const busy = document.querySelectorAll('[aria-busy=true], [role=progressbar], .spinner, .loading').length;
  const before = new Set([...(fx.msgs || []), ...(fx.bad || [])]);
  return { added: fx.added, removed: fx.removed, attrs: fx.attrs || 0, text: fx.text, changed: !!fx.changed, quietFor: Date.now() - fx.last, startUrl: fx.url, startTitle: fx.title,
    url: location.href, title: document.title, ready: document.readyState, dialogs: [...new Set(dialogs)].slice(0, 3), alerts: [...new Set(alerts)].filter((a) => !before.has(a)).slice(0, 4), invalid: invalid.filter((x) => !before.has(x)), focus, busy };
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const value = (r) => r?.value;

/** Puts the observer in place. Returns false when the page can't be observed (a chrome:// page, no debugger). */
export async function armEffects(tabId) {
  try { return !!value(await cdp.evaluate(tabId, ARM)); } catch { return false; }
}

/** Waits for the page to settle (or navigate) and reads what changed. */
export async function readEffects(tabId, { maxMs = 3000 } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < maxMs) {
    await sleep(last ? 200 : 150);
    let r = null;
    try { r = value(await cdp.evaluate(tabId, READ)); } catch { r = null; }
    if (!r) {
      // Mid-navigation the old document is gone: wait for the new one.
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      last = { navigated: true, url: tab?.url || '', title: tab?.title || '', loading: tab?.status === 'loading' };
      if (tab?.status === 'complete') break;
      continue;
    }
    last = r;
    if (r.url !== r.startUrl) break; // a client-side route change counts as navigation
    // Once something changed, stop when the page has been quiet a moment; until then keep waiting (a slow
    // request answers late), so "nothing changed" is only said after the whole wait.
    if (r.changed && r.quietFor >= 400 && r.ready === 'complete' && !r.busy) break;
  }
  if (last && !last.navigated && last.url !== last.startUrl) last.navigated = true;
  return last;
}

/** The difference in a few words for the model; flags an action that changed nothing. */
export function describeEffects(fx) {
  if (!fx) return '';
  const out = [];
  if (fx.navigated) out.push(`Page changed to ${fx.url}${fx.title ? ` ("${fx.title.slice(0, 80)}")` : ''}${fx.loading ? ' — still loading' : ''}.`);
  if (fx.dialogs?.length) out.push(`Open dialog: ${fx.dialogs.map((d) => `"${d}"`).join(', ')}.`);
  if (fx.invalid?.length) out.push(`Form errors: ${fx.invalid.join('; ')}.`);
  if (fx.alerts?.length) out.push(`Messages on the page: ${fx.alerts.map((a) => `"${a}"`).join(', ')}.`);
  if (!fx.navigated && fx.text?.length) out.push(`New text: ${fx.text.slice(0, 5).map((t) => `"${t}"`).join(', ')}.`);
  if (!fx.navigated && (fx.added || fx.removed) && !fx.text?.length) out.push(`The page changed (${fx.added} elements added, ${fx.removed} removed).`);
  if (fx.busy) out.push('The page still shows a loading indicator — wait before judging the result.');
  if (!fx.navigated && !fx.added && !fx.removed && !fx.attrs && !fx.dialogs?.length && !fx.alerts?.length && !fx.invalid?.length && !fx.busy) {
    out.push('NO VISIBLE CHANGE after this action. It may have missed (stale ref or wrong spot, something covering the element, a disabled control) or the page needs more time — look before repeating it.');
  }
  return out.length ? `Effect: ${out.join(' ')}` : '';
}

/** A change to state the agent can't see from the result alone (the effect line is how it knows). */
export const NO_EFFECT = /NO VISIBLE CHANGE/;
