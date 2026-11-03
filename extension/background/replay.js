// Fast replay: a recorded workflow is run again from its recorded steps, with no model
// calls — each element is found again on the page (its CSS path first, then its role and
// accessible name), waited for, acted on and checked. When a step cannot be done the
// replay stops and says where, so the agent can take over from that point.
import { cdp } from './cdp.js';
import { waitForLoad, overlay } from './page.js';
import { classifyUrl, isBlockedCategory, isRestrictedUrl } from './domain-safety.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_STEPS = 300;

// Finds the recorded element again and scrolls it into view; returns its centre.
function locateInPage(target, opts) {
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // The names an element can be known by: aria-label, its <label>, its text, placeholder,
  // title, alt, a button's value. A recorded name matches any of them (recorders differ).
  const namesOf = (el) => [el.getAttribute('aria-label'), [...(el.labels || [])].map((l) => l.innerText).join(' '), el.innerText, el.placeholder, el.title, el.alt,
    ['button', 'submit'].includes(el.type) ? el.value : ''].map(norm).filter(Boolean);
  const want = norm(target.name);
  const named = (el) => !want || namesOf(el).some((n) => n === want || n.includes(want.slice(0, 40)) || want.includes(n.slice(0, 40)));
  let el = null;
  try { el = target.selector ? document.querySelector(target.selector) : null; } catch { el = null; }
  if (el && (!visible(el) || !named(el))) el = null;
  if (!el && want) {
    const pool = [...document.querySelectorAll(target.tag || '*')].filter(visible);
    el = pool.find((e) => namesOf(e).includes(want)) || pool.find((e) => namesOf(e).some((n) => n.startsWith(want.slice(0, 40)))) || null;
  }
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const out = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase() };
  if (opts?.select !== undefined && el.tagName === 'SELECT') {
    const o = [...el.options].find((x) => norm(x.textContent) === norm(opts.select));
    if (!o) return { ...out, error: `The option "${opts.select}" is not in the list.` };
    el.value = o.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    out.selected = true;
  }
  if (opts?.checked !== undefined && 'checked' in el) out.checked = el.checked;
  if (opts?.clear && 'value' in el) { el.focus(); el.select?.(); }
  return out;
}
const locate = (target, opts = {}) => `(${locateInPage.toString()})(${JSON.stringify(target || {})}, ${JSON.stringify(opts)})`;

/** A short, human title for a recorded step (shown as the live plan). */
export function stepTitle(s, ar = false) {
  const name = s.target?.name ? `"${s.target.name.slice(0, 40)}"` : (s.target?.tag || '');
  let host = '';
  try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* none */ }
  switch (s.action) {
    case 'navigate': return ar ? `فتح ${host}` : `Open ${host}`;
    case 'click': return ar ? `النقر على ${name}` : `Click ${name}`;
    case 'type': return ar ? `كتابة في ${name}` : `Type into ${name}`;
    case 'select': return ar ? `اختيار "${s.value}" في ${name}` : `Choose "${s.value}" in ${name}`;
    case 'toggle': return ar ? `${s.value ? 'تفعيل' : 'إلغاء'} ${name}` : `${s.value ? 'Check' : 'Uncheck'} ${name}`;
    case 'key': return ar ? `ضغط ${s.value}` : `Press ${s.value}`;
    default: return s.action;
  }
}

/** The recorded steps a replay will run: navigations caused by a click or a key are dropped. */
export function replayPlan(recorded = []) {
  const out = [];
  for (const s of recorded.slice(0, MAX_STEPS)) {
    const prev = out[out.length - 1];
    if (s.action === 'navigate' && prev && ['click', 'key', 'type', 'select', 'toggle'].includes(prev.action)) continue;
    if (s.action === 'navigate' && prev?.action === 'navigate') { out[out.length - 1] = s; continue; }
    out.push(s);
  }
  return out;
}

/**
 * Runs the recorded steps in a tab. values replaces recorded inputs: a typed value equal
 * to a parameter's default is replaced by values[param]. onStep(i, status, note) reports
 * progress. Returns { ok, done, failedAt?, reason? }.
 */
export async function replay(sc, { tabId, values = {}, signal, onStep = () => {} }) {
  const plan = replayPlan(sc.recorded);
  if (!plan.length) return { ok: false, done: 0, failedAt: 0, reason: 'This workflow has no recorded steps.' };
  const subst = (v) => {
    if (typeof v !== 'string') return v;
    let out = v;
    for (const p of sc.params || []) {
      if (values[p.name] === undefined) continue;
      if (p.default && out === String(p.default)) return String(values[p.name]);
      out = out.split(`{{${p.name}}}`).join(String(values[p.name]));
    }
    return out;
  };
  overlay.show(tabId);
  try {
    for (let i = 0; i < plan.length; i++) {
      if (signal?.aborted) return { ok: false, done: i, failedAt: i, reason: 'Stopped by the user.' };
      const s = plan[i];
      onStep(i, 'start');
      const fault = await runStep(tabId, s, subst, i === 0).catch((e) => e.message);
      if (fault) { onStep(i, 'fail', fault); return { ok: false, done: i, failedAt: i, reason: fault }; }
      onStep(i, 'done');
      await sleep(350); // let the page react before the next step
    }
    return { ok: true, done: plan.length };
  } finally {
    overlay.done(tabId);
    await cdp.detach(tabId).catch(() => {});
  }
}

async function safeTarget(url) {
  if (isRestrictedUrl(url)) return 'This is a browser page that extensions cannot control.';
  const c = await classifyUrl(url);
  return isBlockedCategory(c.category) ? `${c.host} is blocked (${c.reason || c.category}).` : '';
}

// Waits up to ~6 s for the element (pages render late), then returns where it is.
async function find(tabId, target, opts) {
  for (let k = 0; k < 20; k++) {
    const r = (await cdp.evaluate(tabId, locate(target, opts)).catch(() => ({ value: null }))).value;
    if (r) return r;
    await sleep(300);
  }
  return null;
}

async function runStep(tabId, s, subst, first) {
  const tab = await chrome.tabs.get(tabId);
  if (s.action === 'navigate') {
    const blocked = await safeTarget(s.url);
    if (blocked) return blocked;
    if (first || tab.url.split('#')[0] !== s.url.split('#')[0]) {
      await chrome.tabs.update(tabId, { url: s.url });
      await waitForLoad(tabId);
    }
    return '';
  }
  const blocked = await safeTarget(tab.url);
  if (blocked) return blocked;
  if (s.action === 'key') {
    await cdp.pressCombo(tabId, String(s.value).replace(/^cmd\+/, 'meta+'));
    return '';
  }
  const value = subst(s.value);
  if (s.action === 'type' && value === '<redacted>') return 'This step types a password or card number, which a replay never does. Enter it yourself.';
  const at = await find(tabId, s.target, s.action === 'select' ? { select: value } : s.action === 'toggle' ? { checked: true } : s.action === 'type' ? { clear: true } : {});
  if (!at) return `Could not find ${s.target?.name ? `"${s.target.name}"` : 'the element'} on the page.`;
  if (at.error) return at.error;
  if (s.action === 'click') await cdp.click(tabId, at.x, at.y);
  else if (s.action === 'toggle') { if (at.checked !== !!value) await cdp.click(tabId, at.x, at.y); }
  else if (s.action === 'type') {
    await cdp.click(tabId, at.x, at.y);
    const mac = (await chrome.runtime.getPlatformInfo()).os === 'mac';
    await cdp.pressCombo(tabId, mac ? 'meta+a' : 'ctrl+a');
    await cdp.send(tabId, 'Input.insertText', { text: String(value ?? '') });
  } else if (s.action === 'select') {
    if (!at.selected) await cdp.click(tabId, at.x, at.y);
  }
  // A click may start a navigation: give it time to begin and finish.
  if (s.action === 'click' || s.action === 'key') {
    await sleep(250);
    const now = await chrome.tabs.get(tabId);
    if (now.status === 'loading') await waitForLoad(tabId);
  }
  return '';
}

/** The recorded steps as a Playwright test, to run in CI or from a terminal. */
export function toPlaywright(sc) {
  const q = (s) => JSON.stringify(String(s ?? ''));
  const loc = (t = {}) => {
    const role = { a: 'link', button: 'button', select: 'combobox', textarea: 'textbox' }[t.tag] || (t.tag === 'input' ? ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button' }[t.type] || 'textbox') : t.role || '');
    if (t.name && role) return `page.getByRole(${q(role)}, { name: ${q(t.name.slice(0, 80))} })`;
    if (t.selector) return `page.locator(${q(t.selector)})`;
    return `page.getByText(${q(t.name || '')})`;
  };
  const lines = [];
  for (const s of replayPlan(sc.recorded)) {
    if (s.action === 'navigate') lines.push(`  await page.goto(${q(s.url)});`);
    else if (s.action === 'click') lines.push(`  await ${loc(s.target)}.click();`);
    else if (s.action === 'type') lines.push(s.value === '<redacted>' ? `  await ${loc(s.target)}.fill(process.env.SECRET_VALUE ?? ''); // recorded as hidden` : `  await ${loc(s.target)}.fill(${q(s.value)});`);
    else if (s.action === 'select') lines.push(`  await ${loc(s.target)}.selectOption({ label: ${q(s.value)} });`);
    else if (s.action === 'toggle') lines.push(`  await ${loc(s.target)}.setChecked(${s.value ? 'true' : 'false'});`);
    else if (s.action === 'key') lines.push(`  await page.keyboard.press(${q(String(s.value).split('+').map((k) => ({ ctrl: 'Control', cmd: 'Meta', alt: 'Alt', shift: 'Shift' }[k] || k)).join('+'))});`);
  }
  return `// ${sc.description || sc.command} — exported from Infera Agent Web (recorded workflow /${sc.command}).
// Run: npx playwright test ${sc.command}.spec.js
import { test, expect } from '@playwright/test';

test(${q(sc.description || sc.command)}, async ({ page }) => {
${lines.join('\n')}
  await expect(page).not.toHaveURL('about:blank');
});
`;
}
