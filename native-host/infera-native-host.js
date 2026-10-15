#!/usr/bin/env node
'use strict';
// Infera Agent native messaging host. Chrome launches this process when the
// extension calls chrome.runtime.connectNative(). It:
//   1. speaks Chrome's native messaging protocol on stdin/stdout
//      (4-byte little-endian length prefix + UTF-8 JSON);
//   2. opens a local bridge endpoint for MCP servers on this machine:
//      Unix socket /tmp/infera-mcp-browser-bridge-$USER/<pid>.sock (0700 dir, 0600 socket)
//      or Windows named pipe \\.\pipe\infera-mcp-browser-bridge-<user>-<pid>;
//   3. routes tool_request / tool_response between MCP clients and the extension.
const net = require('net');
const fs = require('fs');
const http = require('http');
const { socketDir, socketPathFor, lineReader, log, BRIDGE_FILE } = require('./lib/common');

const MAX_MESSAGE = 64 * 1024 * 1024; // extension -> host limit
const CHUNK = 768 * 1024;             // host -> extension messages are limited to 1 MB: larger ones are chunked

// ---------- Chrome native messaging (stdio) ----------
let inBuf = Buffer.alloc(0);
let chunkSeq = 0;
function writeFrame(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([len, json]));
}
const toExtension = (msg) => {
  const text = JSON.stringify(msg);
  if (Buffer.byteLength(text, 'utf8') <= CHUNK) return writeFrame(msg);
  const id = `c${++chunkSeq}`;
  const per = 128 * 1024; // chars per chunk: worst-case JSON escaping (6x) stays under the 1 MB limit
  const total = Math.ceil(text.length / per);
  for (let i = 0; i < total; i++) writeFrame({ type: 'chunk', id, seq: i, total, data: text.slice(i * per, (i + 1) * per) });
};

process.stdin.on('data', (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (inBuf.length >= 4) {
    const n = inBuf.readUInt32LE(0);
    if (n > MAX_MESSAGE) { log('message too large'); process.exit(1); }
    if (inBuf.length < 4 + n) break;
    const body = inBuf.subarray(4, 4 + n).toString('utf8');
    inBuf = inBuf.subarray(4 + n);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    onExtensionMessage(msg);
  }
});
process.stdin.on('end', shutdown);

// ---------- bridge endpoint for MCP servers ----------
const clients = new Map(); // socket -> {clientId}
const inflight = new Map(); // routed id -> {socket, id}
let seq = 0;
let extensionInfo = null;

function onExtensionMessage(msg) {
  switch (msg.type) {
    case 'ping': toExtension({ type: 'pong' }); break;
    case 'status':
      extensionInfo = msg;
      if (msg.id && inflight.has(msg.id)) route(msg);
      break;
    case 'tool_response':
    case 'tools':
      route(msg);
      break;
    case 'desktop_request':
      desktopRequest(msg).then((r) => toExtension({ type: 'desktop_response', id: msg.id, ...r }));
      break;
    default: log('ext ->', msg.type);
  }
}

// ---------- requests from the extension to Infera Agent Desktop ----------
// The desktop app writes its local bridge's port and per-launch token to BRIDGE_FILE;
// this host (started by Chrome for the extension, whose origin Chrome has already
// checked) passes the request on. The desktop asks the person before it acts.
function bridgeInfo() {
  try {
    const b = JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
    return b && b.port && b.token ? b : null;
  } catch { return null; }
}

function bridgeCall(b, method, path, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port: b.port, method, path, timeout: timeoutMs,
      headers: { 'x-infera-bridge-token': b.token, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(text); } catch { /* not JSON */ }
        resolve(j && typeof j === 'object' ? { status: res.statusCode, ...j } : { ok: false, error: `Desktop answered ${res.statusCode}` });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Infera Agent Desktop did not answer in time.' }); });
    req.on('error', () => resolve({ ok: false, error: 'Infera Agent Desktop is not running.' }));
    if (data) req.write(data);
    req.end();
  });
}

async function desktopRequest(msg) {
  const b = bridgeInfo();
  if (!b) return { ok: false, error: 'Infera Agent Desktop is not running (or is an older version without the Chrome link).' };
  if (msg.action === 'ping') return bridgeCall(b, 'GET', '/bridge/ping', null, 5000);
  if (msg.action === 'task') {
    const prompt = String(msg.prompt || '').slice(0, 8000);
    if (!prompt.trim()) return { ok: false, error: 'No task given.' };
    return bridgeCall(b, 'POST', '/bridge/desktop-task', { prompt, from: 'chrome', context: String(msg.context || '').slice(0, 4000) }, 30 * 60_000);
  }
  return { ok: false, error: `Unknown desktop action ${msg.action}` };
}

function route(msg) {
  const r = inflight.get(msg.id);
  if (!r) return;
  inflight.delete(msg.id);
  send(r.socket, { ...msg, id: r.id });
}

function send(socket, obj) {
  try { socket.write(JSON.stringify(obj) + '\n'); } catch { /* closed */ }
}

function onClientMessage(socket, msg) {
  const c = clients.get(socket);
  switch (msg.type) {
    case 'hello':
      c.clientId = String(msg.client_id || `client-${socket.remotePort || Date.now()}`);
      toExtension({ type: 'mcp_connected', client_id: c.clientId });
      send(socket, { type: 'hello', pid: process.pid, extension: extensionInfo ? { id: extensionInfo.extensionId, version: extensionInfo.version } : null });
      break;
    case 'tool_request':
    case 'list_tools':
    case 'get_status': {
      const rid = `r${++seq}`;
      inflight.set(rid, { socket, id: msg.id });
      if (msg.type === 'tool_request') {
        toExtension({ type: 'tool_request', id: rid, method: 'execute_tool', params: { ...msg.params, client_id: c.clientId || msg.params?.client_id } });
      } else {
        toExtension({ type: msg.type, id: rid });
      }
      break;
    }
    default:
  }
}

const endpoint = socketPathFor(process.pid);
if (process.platform !== 'win32') {
  const dir = socketDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  // Remove stale sockets of dead hosts.
  for (const f of fs.readdirSync(dir)) {
    const pid = Number(f.replace(/\.sock$/, ''));
    if (!pid) continue;
    try { process.kill(pid, 0); } catch { try { fs.unlinkSync(`${dir}/${f}`); } catch { /* ignore */ } }
  }
}

const server = net.createServer((socket) => {
  clients.set(socket, { clientId: null });
  socket.on('data', lineReader((m) => onClientMessage(socket, m)));
  const bye = () => {
    const c = clients.get(socket);
    clients.delete(socket);
    for (const [k, v] of inflight) if (v.socket === socket) inflight.delete(k);
    if (c?.clientId) toExtension({ type: 'mcp_disconnected', client_id: c.clientId });
  };
  socket.on('close', bye);
  socket.on('error', bye);
});

server.on('error', (e) => {
  log('bridge error', e.message); // e.g. EADDRINUSE on Windows when two hosts collide
  process.exit(2);
});

server.listen(endpoint, () => {
  if (process.platform !== 'win32') fs.chmodSync(endpoint, 0o600);
  log('listening on', endpoint);
});

function shutdown() {
  try { server.close(); } catch { /* ignore */ }
  if (process.platform !== 'win32') { try { fs.unlinkSync(endpoint); } catch { /* ignore */ } }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
