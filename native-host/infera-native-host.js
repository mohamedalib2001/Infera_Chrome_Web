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
const { socketDir, socketPathFor, lineReader, log } = require('./lib/common');

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
    default: log('ext ->', msg.type);
  }
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
