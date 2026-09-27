'use strict';
// End-to-end test: fake extension <-> native host <-> MCP server <-> fake MCP client.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const HOST = path.join(__dirname, '..', 'infera-native-host.js');
const MCP = path.join(__dirname, '..', 'infera-mcp-server.js');

function frame(obj) {
  const b = Buffer.from(JSON.stringify(obj));
  const l = Buffer.alloc(4); l.writeUInt32LE(b.length);
  return Buffer.concat([l, b]);
}

function readFrames(stream, onMsg) {
  let buf = Buffer.alloc(0);
  stream.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (buf.length < 4 + n) break;
      onMsg(JSON.parse(buf.subarray(4, 4 + n).toString()));
      buf = buf.subarray(4 + n);
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const host = spawn(process.execPath, [HOST], { stdio: ['pipe', 'pipe', 'inherit'] });
  const fromHost = [];
  const chunks = new Map();
  const tools = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools.json'), 'utf8'));
  readFrames(host.stdout, (m) => {
    if (m.type === 'chunk') {
      const c = chunks.get(m.id) || [];
      c[m.seq] = m.data; chunks.set(m.id, c);
      if (c.filter((x) => x !== undefined).length < m.total) return;
      m = JSON.parse(c.join(''));
    }
    fromHost.push(m);
    if (m.type === 'list_tools') host.stdin.write(frame({ type: 'tools', id: m.id, tools }));
    if (m.type === 'tool_request') {
      const a = m.params.args;
      const text = m.params.tool === 'file_upload'
        ? `got ${a.files.length} file(s): ${a.files.map((f) => `${f.name}:${Buffer.from(f.base64, 'base64').toString()}`).join(',')}`
        : `ran ${m.params.tool} for ${m.params.client_id}`;
      host.stdin.write(frame({ type: 'tool_response', id: m.id, result: { content: [{ type: 'text', text }] } }));
    }
  });
  host.stdin.write(frame({ type: 'ping' }));
  await sleep(400);
  assert(fromHost.some((m) => m.type === 'pong'), 'host answers ping with pong');

  if (process.platform !== 'win32') {
    const dir = `/tmp/infera-mcp-browser-bridge-${os.userInfo().username.replace(/[^\w.-]/g, '_')}`;
    const mode = fs.statSync(dir).mode & 0o777;
    assert.strictEqual(mode, 0o700, 'socket dir is 0700');
    const sockMode = fs.statSync(path.join(dir, `${host.pid}.sock`)).mode & 0o777;
    assert.strictEqual(sockMode, 0o600, 'socket is 0600');
  }

  const mcp = spawn(process.execPath, [MCP, '--client-id', 'test-client'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const responses = new Map();
  let buf = '';
  mcp.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); responses.set(m.id, m); }
  });
  const rpc = async (id, method, params) => {
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (let k = 0; k < 100 && !responses.has(id); k++) await sleep(50);
    return responses.get(id);
  };

  const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.strictEqual(init.result.serverInfo.name, 'infera-in-chrome');
  const list = await rpc(2, 'tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  assert(names.includes('computer') && names.includes('browser_batch') && names.includes('switch_browser'), 'tool list');
  assert.strictEqual(names.length, 19, '17 extension tools + 2 bridge tools');

  const call = await rpc(3, 'tools/call', { name: 'tabs_context_mcp', arguments: { createIfEmpty: true } });
  assert.match(call.result.content[0].text, /ran tabs_context_mcp for test-client/);
  assert(fromHost.some((m) => m.type === 'mcp_connected' && m.client_id === 'test-client'), 'mcp_connected sent to extension');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'infera-'));
  const f = path.join(tmp, 'hello.txt');
  fs.writeFileSync(f, 'hi there');
  const up = await rpc(4, 'tools/call', { name: 'file_upload', arguments: { ref: 'ref_1', tabId: 1, paths: [f] } });
  assert.match(up.result.content[0].text, /hello.txt:hi there/, 'file contents read by the MCP server');

  // Large payload -> chunked host->extension messages.
  const big = path.join(tmp, 'big.bin');
  fs.writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 65));
  const up2 = await rpc(5, 'tools/call', { name: 'file_upload', arguments: { ref: 'ref_1', tabId: 1, paths: [big] } });
  assert.match(up2.result.content[0].text, /got 1 file/, 'chunked 3 MB upload reassembled');

  mcp.kill();
  host.kill();
  console.log('bridge test: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
