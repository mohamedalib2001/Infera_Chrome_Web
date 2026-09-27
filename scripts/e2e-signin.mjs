// Sign-in end-to-end test: OAuth on INFERA Agent, a task through the model
// gateway, credit charging, token refresh, sign-out. Needs the local stand-in
// for inferaagent.com from the INFERA Agent repo (branch with the gateway):
//   DATABASE_URL=postgres://... pnpm --filter server exec tsx test/oauthHarness.ts   # port 18990
//   node scripts/e2e-signin.mjs
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';
const ext = new URL('../extension', import.meta.url).pathname;
const html = fs.readFileSync(new URL('./fixtures/test.html', import.meta.url));
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${srv.address().port}/test.html`;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'oa-')), { headless: true, viewport: { width: 420, height: 820 }, executablePath: process.env.CHROME_PATH || undefined, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
for (let i = 0; i < 100 && !(await sw.evaluate(() => !!self.__infera)); i++) await new Promise((r) => setTimeout(r, 100));
const check = (n, ok, info = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${info}`);
check('built-in server is inferaagent.com', fs.readFileSync(ext + '/config.js', 'utf8').includes("'https://inferaagent.com'"));
await sw.evaluate(() => self.__infera.updateSettings({ inferaUrl: 'http://127.0.0.1:18990', permissionMode: 'skip_all_permission_checks', safetyChecker: false, sound: false, notifications: false }));
const id = sw.url().split('/')[2];
const web = await ctx.newPage(); await web.goto(pageUrl);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`chrome-extension://${id}/sidepanel/sidepanel.html`); await p.waitForTimeout(800);
await p.screenshot({ path: path.join(os.tmpdir(), 'oauth-signin.png') });
check('sign-in button shown', await p.locator('#siSubmit').isVisible(), await p.locator('#siSubmit').textContent());
const popupP = ctx.waitForEvent('page', { timeout: 15000 });
await p.click('#siSubmit');
const popup = await popupP;
await popup.waitForSelector('#approve', { timeout: 10000 });
await popup.waitForFunction(() => document.getElementById('who').textContent !== 'loading');
check('consent page shows the extension', /INFERA Agent for Chrome/.test(await popup.locator('#who').textContent()), await popup.locator('#who').textContent());
await popup.click('#approve');
await p.waitForSelector('#account:not([hidden])', { timeout: 15000 });
check('signed in with OAuth', true, await p.locator('#accountText').textContent());
await p.screenshot({ path: path.join(os.tmpdir(), 'oauth-signed-in.png') });
const auth = await sw.evaluate(async () => (await chrome.storage.local.get('auth')).auth);
check('token stored, no provider key', auth.kind === 'infera' && /^inf_/.test(auth.accessToken) && /^infr_/.test(auth.refreshToken) && !JSON.stringify(auth).includes('sk-platform-key'));
const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, pageUrl);
const res = await sw.evaluate(async (tabId) => {
  const s = new self.__infera.AgentSession({ kind: 'panel' });
  await s.run('ماذا في هذه الصفحة؟', { startTabId: tabId });
  return { status: s.status, text: s.messages.at(-1).content.map((b) => b.text || '').join('') };
}, tabId);
check('task ran through inferaagent.com gateway', res.status === 'done' && res.text.includes('inferaagent.com'), JSON.stringify(res));
// token refresh: expire the access token locally and run again
await sw.evaluate(async () => { const a = (await chrome.storage.local.get('auth')).auth; a.expiresAt = Date.now() - 1000; await chrome.storage.local.set({ auth: a }); });
const res2 = await sw.evaluate(async (tabId) => { const s = new self.__infera.AgentSession({ kind: 'panel' }); await s.run('مرة أخرى', { startTabId: tabId }); return s.status; }, tabId);
const auth2 = await sw.evaluate(async () => (await chrome.storage.local.get('auth')).auth);
check('expired token refreshed automatically', res2 === 'done' && auth2.accessToken !== auth.accessToken);
await p.reload(); await p.waitForTimeout(1500);
check('credits shown after charging', /Credits|الرصيد/.test(await p.locator('#accountText').textContent()), await p.locator('#accountText').textContent());
await p.click('#btnSignOut'); await p.waitForTimeout(600);
check('sign out', await p.locator('#signIn').isVisible());
check('no page errors', !errs.length, errs.join('; '));
await ctx.close(); srv.close();
