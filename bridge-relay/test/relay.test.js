'use strict';
// Relay test: fake browser <-> relay <-> MCP server (--relay) <-> fake MCP client.
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const PORT = 18787;
  const relay = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, RELAY_AGENT_TOKEN: 'secret' }, stdio: 'inherit' });
  await sleep(500);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'pair_request') ws.send(JSON.stringify({ type: 'pair_response', sessionId: m.sessionId, accept: true }));
    if (m.type === 'tool_request') ws.send(JSON.stringify({ type: 'tool_response', id: m.id, result: { content: [{ type: 'text', text: `cloud ran ${m.params.tool}` }] } }));
  };
  ws.send(JSON.stringify({ type: 'register', browserId: 'b1', name: 'Test Chrome', tools: [{ name: 'navigate', description: 'x', inputSchema: { type: 'object' } }] }));
  await sleep(200);

  const mcp = spawn(process.execPath, [path.join(__dirname, '..', '..', 'native-host', 'infera-mcp-server.js'), '--relay', `ws://127.0.0.1:${PORT}/agent`, '--token', 'secret'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const res = new Map(); let buf = '';
  mcp.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); res.set(m.id, m); } });
  const rpc = async (id, method, params) => { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); for (let k = 0; k < 100 && !res.has(id); k++) await sleep(50); return res.get(id); };

  await rpc(1, 'initialize', { protocolVersion: '2025-06-18' });
  const list = await rpc(2, 'tools/call', { name: 'list_connected_browsers', arguments: {} });
  assert.match(list.result.content[0].text, /Test Chrome/);
  const sw = await rpc(3, 'tools/call', { name: 'switch_browser', arguments: { browserId: 'b1' } });
  assert.match(sw.result.content[0].text, /Connected to browser b1/);
  const call = await rpc(4, 'tools/call', { name: 'navigate', arguments: { url: 'example.com', tabId: 1 } });
  assert.match(call.result.content[0].text, /cloud ran navigate/);
  mcp.kill(); ws.close(); relay.kill();
  console.log('relay test: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
