// Remote MCP servers (Streamable HTTP transport). Tools of user-added servers
// are offered to the side-panel agent as "mcp__<server>__<tool>" and every
// call goes through the REMOTE_MCP permission.
//
// Stored under "mcpServers": [{ id, name, url, headers: {k: v}, enabled }]
import { STORAGE_KEYS } from './constants.js';
import { getLocal, setLocal, uuid } from './storage.js';

const PROTOCOL = '2025-06-18';
const sessions = new Map(); // serverId -> {sessionId, tools, at}
const TOOL_CACHE_MS = 5 * 60_000;

export async function listServers() {
  return getLocal(STORAGE_KEYS.MCP_SERVERS, []);
}

export async function saveServer(s) {
  if (!/^https:\/\//i.test(s.url || '') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(s.url || '')) throw new Error('MCP server URL must use https:// (or http://localhost).');
  const name = String(s.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 30);
  if (!name) throw new Error('Server name is required');
  const all = await listServers();
  const entry = { id: s.id || uuid(), name, url: s.url.trim(), headers: s.headers || {}, enabled: s.enabled !== false };
  const i = all.findIndex((x) => x.id === entry.id);
  if (i >= 0) all[i] = entry; else all.push(entry);
  await setLocal(STORAGE_KEYS.MCP_SERVERS, all);
  sessions.delete(entry.id);
  return entry;
}

export async function deleteServer(id) {
  await setLocal(STORAGE_KEYS.MCP_SERVERS, (await listServers()).filter((s) => s.id !== id));
  sessions.delete(id);
}

async function rpc(server, method, params, { notify = false } = {}) {
  const st = sessions.get(server.id) || {};
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, ...server.headers };
  if (st.sessionId) headers['mcp-session-id'] = st.sessionId;
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: uuid(), method, params };
  const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessions.set(server.id, { ...st, sessionId: sid });
  if (notify) return null;
  if (!res.ok) throw new Error(`${server.name}: HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  let msg;
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    for (const chunk of text.split('\n\n')) {
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data) continue;
      try { const j = JSON.parse(data); if (j.id === body.id) msg = j; } catch { /* skip */ }
    }
  } else {
    msg = await res.json();
  }
  if (!msg) throw new Error(`${server.name}: empty response`);
  if (msg.error) throw new Error(`${server.name}: ${msg.error.message}`);
  return msg.result;
}

async function ensureSession(server) {
  const st = sessions.get(server.id);
  if (st?.initialized) return;
  await rpc(server, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'infera-agent-chrome', version: chrome.runtime.getManifest().version } });
  await rpc(server, 'notifications/initialized', {}, { notify: true });
  sessions.set(server.id, { ...(sessions.get(server.id) || {}), initialized: true });
}

// Returns Anthropic-format tool definitions for all enabled servers.
export async function remoteTools() {
  const out = [];
  for (const s of (await listServers()).filter((x) => x.enabled)) {
    try {
      const st = sessions.get(s.id);
      let tools = st?.tools && Date.now() - st.at < TOOL_CACHE_MS ? st.tools : null;
      if (!tools) {
        await ensureSession(s);
        tools = (await rpc(s, 'tools/list', {})).tools || [];
        sessions.set(s.id, { ...(sessions.get(s.id) || {}), tools, at: Date.now() });
      }
      for (const t of tools) {
        out.push({
          name: `mcp__${s.name}__${t.name}`.slice(0, 64),
          description: `[Remote MCP server "${s.name}"] ${t.description || ''}`.slice(0, 1024),
          input_schema: t.inputSchema || { type: 'object', properties: {} },
          _server: s,
          _tool: t.name,
        });
      }
    } catch (e) {
      console.warn('Remote MCP', s.name, e.message);
    }
  }
  return out;
}

export async function callRemoteTool(def, input) {
  const s = def._server;
  await ensureSession(s);
  const r = await rpc(s, 'tools/call', { name: def._tool, arguments: input || {} });
  const content = (r.content || []).map((c) => {
    if (c.type === 'image') return { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } };
    if (c.type === 'text') return { type: 'text', text: c.text };
    return { type: 'text', text: JSON.stringify(c) };
  });
  if (!content.length && r.structuredContent) content.push({ type: 'text', text: JSON.stringify(r.structuredContent) });
  return { content: content.length ? content : [{ type: 'text', text: '(empty result)' }], isError: !!r.isError };
}
