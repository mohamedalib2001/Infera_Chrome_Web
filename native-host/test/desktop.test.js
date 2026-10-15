'use strict';
// The extension -> native host -> Infera Agent Desktop path: a desktop_request is passed to
// the desktop's local bridge (address and token from the bridge file) and its answer comes back.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const HOST = path.join(__dirname, '..', 'infera-native-host.js');
const frame = (obj) => { const b = Buffer.from(JSON.stringify(obj)); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const seen = [];
  const desk = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, token: req.headers['x-infera-bridge-token'], body: body ? JSON.parse(body) : null });
      res.writeHead(req.headers['x-infera-bridge-token'] === 'tok-123' ? 200 : 403, { 'content-type': 'application/json' });
      if (req.url === '/bridge/ping') return res.end(JSON.stringify({ ok: true, product: 'infera-agents-desktop', signedIn: true }));
      res.end(JSON.stringify({ ok: true, status: 'done', result: 'Saved report.xlsx to Documents.' }));
    });
  });
  await new Promise((r) => desk.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infera-bridge-'));
  const file = path.join(dir, 'bridge.json');

  const host = spawn(process.execPath, [HOST], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, INFERA_BRIDGE_FILE: file } });
  const got = [];
  let buf = Buffer.alloc(0);
  host.stdout.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 4) { const n = buf.readUInt32LE(0); if (buf.length < 4 + n) break; got.push(JSON.parse(buf.subarray(4, 4 + n).toString())); buf = buf.subarray(4 + n); }
  });
  const ask = async (msg) => { host.stdin.write(frame(msg)); for (let i = 0; i < 50; i++) { const r = got.find((m) => m.id === msg.id); if (r) return r; await sleep(50); } return null; };

  const none = await ask({ type: 'desktop_request', id: 'd1', action: 'ping' });
  assert(none && none.ok === false && /not running/.test(none.error), 'no bridge file: the desktop is reported as not running');

  fs.writeFileSync(file, JSON.stringify({ port: desk.address().port, token: 'tok-123' }));
  const ping = await ask({ type: 'desktop_request', id: 'd2', action: 'ping' });
  assert(ping && ping.ok === true && ping.product === 'infera-agents-desktop', 'ping reaches the desktop with its token');
  const task = await ask({ type: 'desktop_request', id: 'd3', action: 'task', prompt: 'Save the table to Documents', context: 'Laptop prices' });
  assert(task && task.ok === true && task.result.includes('report.xlsx'), 'the desktop answer comes back');
  const sent = seen.find((s) => s.url === '/bridge/desktop-task');
  assert(sent && sent.token === 'tok-123' && sent.body.prompt === 'Save the table to Documents' && sent.body.from === 'chrome', 'the task is sent with the token and the prompt');

  host.kill();
  desk.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('desktop link test: OK');
})().catch((e) => { console.error(e); process.exit(1); });
