#!/usr/bin/env node
'use strict';
// Reference cloud relay for Infera Agent ("bridge"). Lets agent sessions that
// run in the cloud discover and drive a user's browser.
//
//   Extensions connect to  ws(s)://<host>/ws      and send {type:"register", browserId, name, token?, tools}
//   Agent sessions connect ws(s)://<host>/agent?token=<RELAY_AGENT_TOKEN>
//     -> {type:"list_connected_browsers", id}
//     -> {type:"switch_browser", id, browserId?}   (pairing; the user accepts in the browser, 2 min timeout)
//     -> {type:"list_tools", id}
//     -> {type:"tool_request", id, params:{tool,args,client_id}}
//
// Env: PORT (default 8787), RELAY_AGENT_TOKEN (required for /agent), RELAY_BROWSER_TOKEN (optional, checked on register).
// Run behind TLS (wss://) in production.
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8787);
const AGENT_TOKEN = process.env.RELAY_AGENT_TOKEN || '';
const BROWSER_TOKEN = process.env.RELAY_BROWSER_TOKEN || '';
const PAIR_TIMEOUT_MS = 2 * 60_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

const browsers = new Map(); // browserId -> {ws, name, tools, lastSeen, paired:Set<sessionId>}
const sessions = new Map(); // sessionId -> {ws, browserId}
const pending = new Map();  // routed id -> {session ws, id}
const pairWaits = new Map(); // sessionId -> {resolve, timer}

const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const send = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch { /* closed */ } };

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/agent') {
    const token = url.searchParams.get('token') || '';
    if (!AGENT_TOKEN || !safeEq(token, AGENT_TOKEN)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onAgent(ws));
  } else if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => onBrowser(ws));
  } else {
    socket.destroy();
  }
});

function onBrowser(ws) {
  let id = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'register') {
      if (BROWSER_TOKEN && !safeEq(String(m.token || ''), BROWSER_TOKEN)) { send(ws, { type: 'error', message: 'invalid token' }); ws.close(); return; }
      id = String(m.browserId || crypto.randomUUID());
      const prev = browsers.get(id);
      browsers.set(id, { ws, name: m.name || 'Browser', version: m.extensionVersion, tools: m.tools || [], lastSeen: Date.now(), paired: prev?.paired || new Set() });
      send(ws, { type: 'registered', browserId: id });
    } else if (m.type === 'heartbeat') {
      const b = browsers.get(id); if (b) b.lastSeen = Date.now();
    } else if (m.type === 'tool_response') {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); send(p.ws, { ...m, id: p.id }); }
    } else if (m.type === 'pair_response') {
      const w = pairWaits.get(m.sessionId);
      if (w) { clearTimeout(w.timer); pairWaits.delete(m.sessionId); w.resolve(!!m.accept); }
    }
  });
  ws.on('close', () => { if (id && browsers.get(id)?.ws === ws) browsers.delete(id); });
}

function onAgent(ws) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { ws, browserId: null });
  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const s = sessions.get(sessionId);
    switch (m.type) {
      case 'list_connected_browsers':
        send(ws, { id: m.id, browsers: [...browsers.entries()].map(([browserId, b]) => ({ browserId, name: b.name, version: b.version, lastSeen: b.lastSeen, paired: b.paired.has(sessionId) })) });
        break;
      case 'switch_browser': {
        const deadline = Date.now() + PAIR_TIMEOUT_MS;
        let bid = m.browserId;
        while (!bid && browsers.size === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
        if (!bid) bid = browsers.size === 1 ? [...browsers.keys()][0] : null;
        const b = bid && browsers.get(bid);
        if (!b) { send(ws, { id: m.id, error: bid ? 'Browser not connected' : 'Several browsers are connected; pass browserId (see list_connected_browsers).' }); break; }
        if (!b.paired.has(sessionId)) {
          const code = String(crypto.randomInt(100000, 999999));
          send(b.ws, { type: 'pair_request', sessionId, code });
          const ok = await new Promise((resolve) => pairWaits.set(sessionId, { resolve, timer: setTimeout(() => { pairWaits.delete(sessionId); resolve(false); }, PAIR_TIMEOUT_MS) }));
          if (!ok) { send(ws, { id: m.id, error: 'Pairing was rejected or timed out.' }); break; }
          b.paired.add(sessionId);
        }
        s.browserId = bid;
        send(ws, { id: m.id, browserId: bid, name: b.name });
        break;
      }
      case 'list_tools': {
        const b = browsers.get(m.browserId || s.browserId);
        send(ws, { id: m.id, tools: b?.tools || [] });
        break;
      }
      case 'tool_request': {
        const bid = m.browserId || s.browserId;
        const b = bid && browsers.get(bid);
        if (!b || !b.paired.has(sessionId)) { send(ws, { id: m.id, error: { content: [{ type: 'text', text: 'Browser extension is not connected (or not paired). Call switch_browser.' }] } }); break; }
        const rid = crypto.randomUUID();
        pending.set(rid, { ws, id: m.id });
        send(b.ws, { type: 'tool_request', id: rid, params: { ...m.params, client_id: `cloud:${sessionId.slice(0, 8)}` } });
        break;
      }
      default:
    }
  });
  ws.on('close', () => {
    sessions.delete(sessionId);
    for (const b of browsers.values()) b.paired.delete(sessionId);
    for (const [k, p] of pending) if (p.ws === ws) pending.delete(k);
  });
}

setInterval(() => {
  for (const [id, b] of browsers) if (Date.now() - b.lastSeen > HEARTBEAT_TIMEOUT_MS) { try { b.ws.terminate(); } catch { /* ignore */ } browsers.delete(id); }
}, 30_000).unref();

server.listen(PORT, () => console.log(`Infera relay listening on :${PORT}`));
