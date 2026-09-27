'use strict';
// Shared helpers for the native host and the MCP server.
const os = require('os');
const path = require('path');
const fs = require('fs');

const HOST_CODE = 'com.infera.agent_code_browser_extension';
const HOST_DESKTOP = 'com.infera.agent_browser_extension';
const DEFAULT_EXTENSION_ID = 'cginklpeajfbmijnfoegocimhaagbbll';
const MCP_SERVER_NAME = 'infera-in-chrome';

function userName() {
  try { return os.userInfo().username.replace(/[^\w.-]/g, '_'); } catch { return 'user'; }
}

// macOS/Linux: /tmp/infera-mcp-browser-bridge-$USER/<pid>.sock (dir 0700, socket 0600)
// Windows:     \\.\pipe\infera-mcp-browser-bridge-<user>-<pid>
function socketDir() {
  return path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', `infera-mcp-browser-bridge-${userName()}`);
}

function socketPathFor(pid) {
  if (process.platform === 'win32') return `\\\\.\\pipe\\infera-mcp-browser-bridge-${userName()}-${pid}`;
  return path.join(socketDir(), `${pid}.sock`);
}

function listSockets() {
  if (process.platform === 'win32') {
    try {
      const prefix = `infera-mcp-browser-bridge-${userName()}-`;
      return fs.readdirSync('\\\\.\\pipe\\').filter((n) => n.startsWith(prefix)).map((n) => `\\\\.\\pipe\\${n}`);
    } catch { return []; }
  }
  try {
    return fs.readdirSync(socketDir()).filter((f) => f.endsWith('.sock')).map((f) => path.join(socketDir(), f));
  } catch { return []; }
}

// Newline-delimited JSON framing over a net.Socket.
function lineReader(onMessage) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try { onMessage(JSON.parse(line)); } catch { /* ignore malformed */ }
    }
  };
}

function log(...a) {
  if (process.env.INFERA_DEBUG) process.stderr.write(`[infera] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
}

module.exports = { HOST_CODE, HOST_DESKTOP, DEFAULT_EXTENSION_ID, MCP_SERVER_NAME, socketDir, socketPathFor, listSockets, lineReader, log };
