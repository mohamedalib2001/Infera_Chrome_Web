// Performance budget check: loads the unpacked extension in Chromium and measures the
// side panel's time to interactive (state loaded, home rendered), its JS heap and DOM
// size, and the size of the extension package. Prints medians over several loads.
//   node scripts/perf.mjs [path/to/extension] [--runs 12] [--json]
// Budgets (fail the run when exceeded): time to interactive 600 ms, JS heap 12 MB,
// DOM nodes 1500, package 600 KB.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const extPath = path.resolve(args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || path.join(root, 'extension'));
const runs = Number(args[args.indexOf('--runs') + 1]) || 12;
const BUDGET = { ttiMs: 600, heapMB: 12, domNodes: 1500, packageKB: 600 };

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// Package size: what the store build would zip (the extension folder, compressed).
const tmpZip = path.join(os.tmpdir(), `infera-perf-${process.pid}.zip`);
execFileSync('zip', ['-qr9', tmpZip, '.', '-x', '*.DS_Store'], { cwd: extPath });
const packageKB = Math.round(fs.statSync(tmpZip).size / 1024);
fs.rmSync(tmpZip, { force: true });

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infera-perf-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const ours = (w) => w.url().endsWith('/background/service-worker.js');
let sw = ctx.serviceWorkers().find(ours);
while (!sw) sw = ours(await ctx.waitForEvent('serviceworker')) ? ctx.serviceWorkers().find(ours) : null;
for (let i = 0; i < 100 && !(await sw.evaluate(() => !!globalThis.chrome?.storage?.local).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
const extId = new URL(sw.url()).host;
// Signed in, so the panel renders its full home screen (no network is needed for that).
await sw.evaluate(() => chrome.storage.local.set({ auth: { kind: 'infera', server: 'http://127.0.0.1:9', accessToken: 'inf_perf', clientId: 'c1' } }));

const tti = [];
const heap = [];
const nodes = [];
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
for (let i = 0; i < runs; i++) {
  const t0 = Date.now();
  await page.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  // Interactive: the account state came back from the service worker and the input is enabled.
  await page.waitForFunction(() => {
    const input = document.querySelector('#input');
    return input && !input.disabled && document.documentElement.lang;
  }, null, { timeout: 10_000 });
  tti.push(Date.now() - t0);
  await page.waitForTimeout(150);
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  heap.push(m.JSHeapUsedSize / 1024 / 1024);
  nodes.push(await page.evaluate(() => document.getElementsByTagName('*').length));
}
await ctx.close();
fs.rmSync(userDir, { recursive: true, force: true });

const out = { extension: path.relative(root, extPath) || '.', runs, ttiMs: Math.round(median(tti)), ttiP90Ms: Math.round([...tti].sort((a, b) => a - b)[Math.floor(runs * 0.9) - 1] ?? median(tti)), heapMB: +median(heap).toFixed(2), domNodes: median(nodes), packageKB };
if (args.includes('--json')) console.log(JSON.stringify(out));
else {
  console.log(`Side panel, ${runs} loads (median): time to interactive ${out.ttiMs} ms (p90 ${out.ttiP90Ms} ms), JS heap ${out.heapMB} MB, DOM nodes ${out.domNodes}`);
  console.log(`Package: ${packageKB} KB`);
}
const over = Object.entries(BUDGET).filter(([k, v]) => out[k] > v).map(([k, v]) => `${k} ${out[k]} > ${v}`);
if (over.length) { console.error(`Over budget: ${over.join(', ')}`); process.exit(1); }
