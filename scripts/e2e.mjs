// End-to-end smoke test: loads the unpacked extension in Chromium and drives
// every MCP tool through the service worker against a local fixture page.
//   npm i -D playwright && node scripts/e2e.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.join(root, '..', 'extension');
const html = fs.readFileSync(path.join(root, 'fixtures', 'test.html'));

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/test.html`;

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infera-e2e-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
for (let i = 0; i < 100 && !(await sw.evaluate(() => !!self.__infera)); i++) await new Promise((r) => setTimeout(r, 100));
const errors = [];
sw.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const results = await sw.evaluate(async (pageUrl) => {
  const I = self.__infera;
  const out = [];
  const ctx = {
    sessionId: 'mcp:e2e', kind: 'mcp', mode: 'skip_all_permission_checks', task: 'e2e', safetyChecker: false,
    requestApproval: async () => 'once', approvePlan: async () => true,
  };
  let n = 0;
  const run = async (name, input, label = name) => {
    const r = await I.executeTool(name, input, { ...ctx, toolUseId: `t${++n}` });
    const textOut = r.content.filter((c) => c.type === 'text').map((c) => c.text).join(' | ');
    const images = r.content.filter((c) => c.type === 'image').length;
    out.push({ label, ok: !r.isError, images, text: textOut.slice(0, 300) });
    return { r, text: textOut };
  };
  const tc = await run('tabs_context_mcp', { createIfEmpty: true });
  const tabId = JSON.parse(tc.text.split(' | ')[0]).availableTabs[0].tabId;
  await run('navigate', { url: pageUrl, tabId });
  const tree = await run('read_page', { tabId, filter: 'interactive' });
  const ref = (re) => (tree.text.match(re) || [])[1];
  const nameRef = ref(/textbox "Full name" \[(ref_\d+)\]/);
  const colorRef = ref(/combobox "Color" \[(ref_\d+)\]/);
  const agreeRef = ref(/checkbox "I agree" \[(ref_\d+)\]/);
  const goRef = ref(/button "Submit order" \[(ref_\d+)\]/);
  const buyRef = ref(/button "Buy now" \[(ref_\d+)\]/);
  const fileRef = ref(/button "Attachment" \[(ref_\d+)\]/);
  const notesRef = ref(/textbox "Notes" \[(ref_\d+)\]/);
  await run('read_page', { tabId, filter: 'all' }, 'read_page(all)');
  await run('find', { tabId, query: 'submit order button' });
  await run('form_input', { tabId, ref: nameRef, value: 'Mohamed Ali' });
  await run('form_input', { tabId, ref: colorRef, value: 'Blue' }, 'form_input(select)');
  await run('form_input', { tabId, ref: agreeRef, value: true }, 'form_input(checkbox)');
  await run('computer', { tabId, action: 'left_click', ref: goRef }, 'computer.left_click(ref)');
  await run('javascript_tool', { tabId, action: 'javascript_exec', text: 'await new Promise(r => setTimeout(r, 50)); document.getElementById("out").textContent' }, 'javascript_tool(check submit)');
  await run('computer', { tabId, action: 'left_click', ref: buyRef }, 'computer.left_click(Buy now) [expect block]');
  await run('computer', { tabId, action: 'left_click', ref: notesRef }, 'focus notes');
  await run('computer', { tabId, action: 'type', text: 'hello world' });
  await run('computer', { tabId, action: 'key', text: 'ctrl+a Backspace', repeat: 1 });
  await run('computer', { tabId, action: 'key', text: 'x', repeat: 3 }, 'key repeat');
  await run('javascript_tool', { tabId, action: 'javascript_exec', text: 'document.getElementById("notes").value + " / keys=" + document.getElementById("keys").textContent' }, 'javascript_tool(check typing)');
  await run('computer', { tabId, action: 'key', text: 'ctrl+=' }, 'zoom shortcut [expect error]');
  const shot = await run('computer', { tabId, action: 'screenshot' });
  const ssId = (shot.text.match(/(ss_[a-z0-9]+)/) || [])[1];
  await run('computer', { tabId, action: 'screenshot', scale: 0.5 }, 'screenshot(scale 0.5)');
  await run('computer', { tabId, action: 'zoom', region: [0, 0, 300, 150] });
  await run('computer', { tabId, action: 'hover', coordinate: [50, 50] });
  await run('computer', { tabId, action: 'scroll', scroll_direction: 'down', scroll_amount: 5 });
  await run('javascript_tool', { tabId, action: 'javascript_exec', text: 'scrollY' }, 'scrollY after scroll');
  await run('computer', { tabId, action: 'scroll_to', ref: goRef });
  await run('computer', { tabId, action: 'left_click_drag', start_coordinate: [10, 10], coordinate: [100, 100] });
  await run('computer', { tabId, action: 'wait', duration: 0.2 });
  await run('upload_image', { tabId, imageId: ssId, ref: fileRef, filename: 'shot.png' });
  await run('javascript_tool', { tabId, action: 'javascript_exec', text: 'document.getElementById("out").textContent' }, 'check upload');
  await run('file_upload', { tabId, ref: fileRef, files: [{ name: 'a.txt', mimeType: 'text/plain', base64: btoa('abc') }] });
  await run('get_page_text', { tabId });
  await run('read_console_messages', { tabId, pattern: '.' });
  await run('navigate', { url: pageUrl, tabId }, 'reload for logs');
  await run('read_console_messages', { tabId, pattern: 'error|loaded' }, 'console after reload');
  await run('read_console_messages', { tabId, pattern: 'error', onlyErrors: true }, 'console onlyErrors');
  await run('read_network_requests', { tabId, urlPattern: '/api/' });
  await run('gif_creator', { tabId, action: 'start_recording' });
  await run('computer', { tabId, action: 'screenshot' }, 'gif frame 1');
  await run('computer', { tabId, action: 'left_click', coordinate: [100, 100] }, 'gif click');
  await run('computer', { tabId, action: 'screenshot' }, 'gif frame 3');
  await run('gif_creator', { tabId, action: 'stop_recording' });
  await run('gif_creator', { tabId, action: 'export', download: true, filename: 'e2e.gif' });
  await run('browser_batch', { actions: [
    { name: 'computer', input: { action: 'scroll', scroll_direction: 'up', scroll_amount: 10, tabId } },
    { name: 'computer', input: { action: 'screenshot', tabId, scale: 0.3 } },
    { name: 'navigate', input: { url: 'https://www.coinbase.com', tabId } },
    { name: 'computer', input: { action: 'screenshot', tabId } },
  ] }, 'browser_batch [expect stop at blocked nav]');
  await run('browser_batch', { actions: [{ name: 'browser_batch', input: { actions: [] } }] }, 'nested batch [expect error]');
  await run('resize_window', { tabId, width: 800, height: 600 });
  await run('navigate', { url: 'back', tabId }, 'navigate back');
  const created = await run('tabs_create_mcp', {});
  const newTab = Number((created.text.match(/tab (\d+)/) || [])[1]);
  await run('navigate', { url: 'chrome://settings', tabId: newTab }, 'navigate chrome:// [expect error]');
  await run('read_page', { tabId: newTab }, 'read_page on chrome:// [expect error]');
  await run('tabs_close_mcp', { tabId: newTab });
  await run('read_page', { tabId: 999999 }, 'foreign tab [expect error]');
  await run('computer', { tabId, action: 'left_click' }, 'missing coordinate [expect error]');
  // Manual-approval mode: decline, then "always allow", then no prompt.
  let asked = 0;
  let answer = 'deny';
  const askCtx = { ...ctx, sessionId: 'mcp:e2e', mode: 'ask', requestApproval: async (req) => { asked++; out.push({ label: `approval prompt (${req.type})`, ok: true, text: `${req.description} | allowAlways=${req.allowAlways}` }); return answer; } };
  let r = await I.executeTool('computer', { action: 'screenshot', tabId }, { ...askCtx, toolUseId: 'a1' });
  out.push({ label: 'ask mode: declined [expect error]', ok: !r.isError, text: r.content[0].text });
  answer = 'always';
  r = await I.executeTool('computer', { action: 'screenshot', tabId }, { ...askCtx, toolUseId: 'a2' });
  out.push({ label: 'ask mode: always allow', ok: !r.isError, text: r.content[0].text });
  const before = asked;
  r = await I.executeTool('get_page_text', { tabId }, { ...askCtx, toolUseId: 'a3' });
  out.push({ label: 'ask mode: no prompt after always-allow', ok: !r.isError && asked === before, text: `prompts=${asked}` });
  await I.permissions.revokeAll();
  out.push({ label: 'classify coinbase', ok: true, text: JSON.stringify(await I.classifyUrl('https://www.coinbase.com')) });
  out.push({ label: 'classify gemini.google.com', ok: true, text: JSON.stringify(await I.classifyUrl('https://gemini.google.com')) });
  await I.permissions.grantAlways('example.com');
  out.push({ label: 'permission HMAC verify', ok: (await I.permissions.list()).every((p) => p.valid), text: JSON.stringify((await I.permissions.list()).map((p) => [p.scope.netloc, p.valid])) });
  const raw = (await chrome.storage.local.get('permissionStorage')).permissionStorage;
  raw.push({ action: 'allow', createdAt: Date.now(), duration: 'always', id: 'forged', scope: { netloc: 'evil.com', type: 'netloc' } });
  await chrome.storage.local.set({ permissionStorage: raw });
  out.push({ label: 'forged entry rejected', ok: !(await I.permissions.hasAlways('evil.com', 'CLICK')), text: '' });
  return out;
}, url);

let failures = 0;
const expectFail = (label) => /\[expect (error|block|stop)/.test(label);
for (const r of results) {
  const pass = expectFail(r.label) ? !r.ok : r.ok;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${r.label.padEnd(44)} ${r.images ? `[${r.images} img] ` : ''}${r.text.replace(/\n/g, ' ⏎ ').slice(0, 170)}`);
}
if (errors.length) console.log('SW console errors:', errors);
await ctx.close();
server.close();
console.log(failures ? `\n${failures} failure(s)` : '\nAll e2e checks passed');
process.exit(failures ? 1 : 0);
