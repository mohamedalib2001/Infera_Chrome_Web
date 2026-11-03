// Real-site benchmark: runs the tasks in bench/tasks.json with the real agent and the real
// model through an Infera Agent account, checks each result against ground truth computed
// at run time, and writes a report. Nothing is simulated: the success rate it prints is
// what the agent achieved.
//
//   INFERA_TOKEN=inf_… [INFERA_SERVER=https://inferaagent.com] node scripts/bench.mjs
//     [--mode auto|fast|balanced|power] [--only id,id] [--headed] [--dry]
//
// INFERA_TOKEN is the access token of a signed-in extension (chrome.storage.local "auth"
// → accessToken). Each task is charged to that account. --dry checks the task file and the
// ground-truth sources without running the agent.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry');
const mode = opt('mode', 'auto');
const only = (opt('only', '') || '').split(',').filter(Boolean);
const TIMEOUT_MS = Number(opt('timeout', 300)) * 1000;
const server = process.env.INFERA_SERVER || 'https://inferaagent.com';
const token = process.env.INFERA_TOKEN || '';

const spec = JSON.parse(fs.readFileSync(path.join(root, 'bench', 'tasks.json'), 'utf8'));
const tasks = spec.tasks.filter((t) => !only.length || only.includes(t.id));
const KNOWN = ['answerIncludes', 'answerRegex', 'fetch', 'regex', 'countRegex', 'page', 'equals', 'includesAll', 'answerOrPage', 'includesAny', 'fetchHeader', 'header', 'yesNo', 'toolUsed', 'noToolUsed'];
for (const t of tasks) {
  if (!t.id || !t.prompt || !/^https:\/\//.test(t.startUrl || '') || !t.check) throw new Error(`Task ${t.id || '?'} is incomplete.`);
  const bad = Object.keys(t.check).filter((k) => !KNOWN.includes(k));
  if (bad.length) throw new Error(`Task ${t.id}: unknown check keys ${bad.join(', ')}`);
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#163;/g, '£').trim();
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s ]+/g, ' ').trim();

// The expected value for a task, computed now from the live site.
async function groundTruth(c) {
  if (c.fetch) {
    const html = await (await fetch(c.fetch, { headers: { 'user-agent': 'InferaAgentWeb-bench/1.0' } })).text();
    if (c.countRegex) return String((html.match(new RegExp(c.countRegex, 'g')) || []).length);
    const m = html.match(new RegExp(c.regex));
    if (!m) throw new Error(`ground truth not found at ${c.fetch}`);
    return decode(m[1]);
  }
  if (c.fetchHeader) {
    const r = await fetch(c.fetchHeader, { method: 'GET' });
    return r.headers.get(c.header) ? 'yes' : 'no';
  }
  return null;
}

if (dry) {
  for (const t of tasks) {
    let gt = '—';
    const kind = t.check.page || t.check.answerOrPage ? '(read from the page after the task)' : t.check.answerIncludes ? `(answer must include "${t.check.answerIncludes}")` : t.check.toolUsed ? `(must use ${t.check.toolUsed})` : '(answer pattern)';
    try { gt = (await groundTruth(t.check)) ?? kind; } catch (e) { gt = `ERROR ${e.message}`; }
    console.log(`${t.id.padEnd(20)} ${t.area.padEnd(11)} ${gt}`);
  }
  process.exit(0);
}
if (!token) { console.error('Set INFERA_TOKEN (the extension\'s access token). Each task is charged to that account.'); process.exit(2); }

const extPath = path.join(root, 'extension');
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infera-bench-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: !args.includes('--headed'),
  executablePath: process.env.CHROME_PATH || undefined,
  viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const ours = (w) => w.url().endsWith('/background/service-worker.js');
let sw = ctx.serviceWorkers().find(ours);
while (!sw) sw = ours(await ctx.waitForEvent('serviceworker')) ? ctx.serviceWorkers().find(ours) : null;
for (let i = 0; i < 100 && !(await sw.evaluate(() => !!self.__infera).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
await sw.evaluate(async ({ server, token, mode }) => {
  await chrome.storage.local.set({ auth: { kind: 'infera', server, accessToken: token, clientId: 'bench' } });
  await self.__infera.updateSettings({ operatingMode: mode, permissionMode: 'skip_all_permission_checks', safetyChecker: false, sound: false, notifications: false, syncHistory: false, memory: false });
}, { server, token, mode });

const results = [];
for (const t of tasks) {
  const page = await ctx.newPage();
  await page.goto(t.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const started = Date.now();
  let run;
  try {
    run = await sw.evaluate(async ({ prompt, url, timeout }) => {
      const I = self.__infera;
      const [tab] = await chrome.tabs.query({ url: `${url.split('#')[0]}*` });
      const s = new I.AgentSession({ kind: 'panel' });
      const tools = [];
      s.subscribe((e) => { if (e.type === 'tool_start') tools.push(e.name); });
      const timer = setTimeout(() => s.stop(), timeout);
      await s.run(prompt, { startTabId: tab?.id });
      clearTimeout(timer);
      const last = [...s.messages].reverse().find((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b) => b.type === 'text' && b.text.trim()));
      const answer = (last?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const tabs = await I.tabGroups.tabs(s.id).catch(() => []);
      const active = tabs.find((x) => x.active) || tabs[0];
      return { status: s.status, answer, tools, cost: s.cost, currency: s.currency, model: s.lastModel, tabId: active?.tabId ?? tab?.id, steps: s.steps.length };
    }, { prompt: t.prompt, url: t.startUrl, timeout: TIMEOUT_MS });
  } catch (e) { run = { status: 'error', answer: e.message, tools: [] }; }
  const c = t.check;
  let pass = run.status === 'done';
  let expected = null;
  let why = run.status === 'done' ? '' : `status ${run.status}`;
  try {
    expected = await groundTruth(c);
    const a = norm(run.answer);
    if (pass && c.answerIncludes) pass = a.includes(norm(c.answerIncludes));
    if (pass && expected !== null && c.yesNo) pass = new RegExp(`^\\W*(${expected === 'yes' ? 'yes|نعم' : 'no|لا'})\\b`, 'i').test(run.answer.trim());
    else if (pass && expected !== null) pass = a.includes(norm(expected));
    if (pass && c.answerRegex) pass = new RegExp(c.answerRegex, 'i').test(run.answer);
    if (pass && (c.page || c.answerOrPage)) {
      const value = await sw.evaluate(async ({ tabId, expr }) => (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (e) => { try { return (0, eval)(e); } catch (x) { return `ERR ${x.message}`; } }, args: [expr] }))[0].result, { tabId: run.tabId, expr: c.page || c.answerOrPage });
      if ('equals' in c) pass = value === c.equals;
      if (c.includesAll) pass = c.includesAll.every((s) => norm(value).includes(norm(s)));
      if (c.includesAny) pass = c.includesAny.some((s) => norm(`${value} ${run.answer}`).includes(norm(s)));
      if (!pass) why = `page: ${JSON.stringify(value).slice(0, 120)}`;
    }
    if (pass && c.toolUsed) pass = run.tools.includes(c.toolUsed);
    if (pass && c.noToolUsed) pass = !c.noToolUsed.some((x) => run.tools.includes(x));
    if (!pass && !why) why = `expected ${expected ?? JSON.stringify(c)}, answer: ${run.answer.slice(0, 120)}`;
  } catch (e) { pass = false; why = e.message; }
  results.push({ id: t.id, area: t.area, pass, why, seconds: Math.round((Date.now() - started) / 1000), cost: run.cost || 0, currency: run.currency || '', model: run.model || '', tools: run.tools.length, steps: run.steps || 0 });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${t.id.padEnd(20)} ${String(results.at(-1).seconds).padStart(4)} s  ${(run.cost || 0).toFixed(3)} ${run.currency || ''}  ${pass ? '' : why}`);
  await page.close().catch(() => {});
}
await ctx.close();

const passed = results.filter((r) => r.pass).length;
const cost = results.reduce((a, r) => a + r.cost, 0);
const byArea = {};
for (const r of results) { byArea[r.area] ||= { pass: 0, total: 0 }; byArea[r.area].total++; if (r.pass) byArea[r.area].pass++; }
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const out = path.join(root, 'bench', `results-${stamp}.json`);
fs.writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), version: JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8')).version, mode, passed, total: results.length, cost, byArea, results }, null, 2));
console.log(`\n${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%) · cost ${cost.toFixed(2)} ${results[0]?.currency || ''} · mode ${mode}`);
for (const [a, v] of Object.entries(byArea)) console.log(`  ${a.padEnd(11)} ${v.pass}/${v.total}`);
console.log(`Report: ${path.relative(root, out)}`);
