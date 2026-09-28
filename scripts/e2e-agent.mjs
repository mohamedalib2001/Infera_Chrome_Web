// Agent-loop test against a mock Anthropic Messages API (SSE). Verifies:
// streaming (thinking + signature, text, tool_use via input_json_delta),
// tool execution, tool_result round-trip (single user message, images),
// thinking blocks echoed unchanged, headers, Quick Mode command language,
// and that the side panel / settings pages render.
//   node scripts/e2e-agent.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const extPath = process.env.EXT_PATH || path.join(root, '..', 'extension');
const html = fs.readFileSync(path.join(root, 'fixtures', 'test.html'));
const outDir = process.env.OUT_DIR || os.tmpdir();

const requests = [];
const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};
const start = (id) => ({ type: 'message_start', message: { id, model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 0 } } });

let phase = 'normal';
const mcpCalls = [];
const server = http.createServer((req, res) => {
  if (req.url === '/mcp' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const m = JSON.parse(body);
      mcpCalls.push(m.method);
      if (!('id' in m)) { res.writeHead(202); res.end(); return; }
      const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'crm', version: '1' } }
        : m.method === 'tools/list' ? { tools: [{ name: 'lookup', description: 'Look up a customer', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }] }
          : { content: [{ type: 'text', text: `customer ${m.params.arguments.q}: VIP` }] };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`);
    });
    return;
  }
  if (req.url === '/api/browser-agent/v1/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      requests.push({ headers: req.headers, body: j });
      const n = requests.length;
      if (j.stop_sequences) {
        // Quick Mode
        if (!j.messages.some((m) => m.role === 'assistant')) {
          return sse(res, [start('q1'),
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Filling the name.\nC 100 100\nJ document.title\n' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'stop_sequence' }, usage: { output_tokens: 20 } }, { type: 'message_stop' }]);
        }
        return sse(res, [start('q2'),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'DONE The page title is Infera Test Page.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }, { type: 'message_stop' }]);
      }
      if (phase === 'toolset') {
        // Anthropic browser toolset: member tool_use blocks carry toolset_name "browser".
        const tu = (index, id, name, input) => [
          { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, toolset_name: 'browser', input: {} } },
          { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
          { type: 'content_block_stop', index },
        ];
        const k = j.messages.filter((m) => m.role === 'assistant').length;
        if (k === 0) {
          return sse(res, [start('b1'),
            ...tu(0, 'b_1', 'get_page_text', {}),
            ...tu(1, 'b_2', 'screenshot', { tab_id: String(globalThis.TAB) }),
            ...tu(2, 'b_3', 'left_click', { target: { type: 'ref', ref: 'ref_99999' } }),
            ...tu(3, 'b_4', 'key', { text: 'Enter' }),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }, { type: 'message_stop' }]);
        }
        if (k === 1) {
          return sse(res, [start('b2'), ...tu(0, 'b_5', 'new_tab', {}),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
        }
        return sse(res, [start('b3'),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done with the browser toolset.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
      }
      if (phase === 'remote') {
        if (j.messages.length === 1) {
          return sse(res, [start('r1'),
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_r', name: 'mcp__crm__lookup', input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":"Acme"}' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
        }
        return sse(res, [start('r2'),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Acme is a VIP.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
      }
      if (n === 1) {
        return sse(res, [start('m1'),
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I should look at the page.' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG123' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me read the page.' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu_1', name: 'get_page_text', input: {} } },
          { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"tab' } },
          { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: `Id": ${globalThis.TAB || 0}}` } },
          { type: 'content_block_stop', index: 2 },
          { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'tu_2', name: 'computer', input: {} } },
          { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"action":"screenshot","tabId":' + (globalThis.TAB || 0) + '}' } },
          { type: 'content_block_stop', index: 3 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 50 } }, { type: 'message_stop' }]);
      }
      return sse(res, [start('m2'),
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The page is an **order form**.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } }, { type: 'message_stop' }]);
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'infera-agent-')), {
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  viewport: { width: 420, height: 800 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
for (let i = 0; i < 100 && !(await sw.evaluate(() => !!self.__infera)); i++) await new Promise((r) => setTimeout(r, 100));
const extId = sw.url().split('/')[2];

const page = await ctx.newPage();
await page.goto(`${base}/test.html`);
const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, `${base}/test.html`);
globalThis.TAB = tabId;

const run = (model, { classic = true } = {}) => sw.evaluate(async ({ base, tabId, model, classic }) => {
  const I = self.__infera;
  // Signed in with an INFERA Agent session against the local mock gateway.
  await chrome.storage.local.set({ auth: { kind: 'infera', server: base, accessToken: 'inf_test', clientId: 'c1' } });
  await I.updateSettings({ apiKey: 'sk-ignored', apiBaseUrl: 'https://api.anthropic.com', inferaUrl: base, model, permissionMode: 'skip_all_permission_checks', safetyChecker: false, sound: false, notifications: false });
  const s = new I.AgentSession({ kind: 'panel' });
  s.classicTools = classic; // our own browsing tools instead of Anthropic's browser toolset
  const events = [];
  s.subscribe((e) => events.push(e.type));
  await s.run('What is on this page?', { startTabId: tabId });
  return { status: s.status, events: [...new Set(events)], messages: s.messages.map((m) => ({ role: m.role, types: m.content.map((b) => b.type + (b.type === 'tool_result' ? `:${b.is_error ? 'err' : 'ok'}:${(b.content || []).map((c) => c.type).join('+')}` : '')) })) };
}, { base, tabId, model, classic });

const checks = [];
const check = (name, ok, info = '') => checks.push({ name, ok, info });

const r1 = await run('claude-opus-5');
check('agent status done', r1.status === 'done', r1.status);
check('events streamed', ['thinking_delta', 'text_delta', 'tool_start', 'tool_result', 'turn_end'].every((e) => r1.events.includes(e)), r1.events.join(','));
const req2 = requests[1]?.body;
check('two API requests', requests.length === 2, String(requests.length));
check('headers: version + INFERA session token, no API key', requests[0].headers['anthropic-version'] === '2023-06-01' && requests[0].headers.authorization === 'Bearer inf_test' && !requests[0].headers['x-api-key'] && !requests[0].headers['anthropic-dangerous-direct-browser-access']);
check('adaptive thinking + effort', requests[0].body.thinking?.type === 'adaptive' && requests[0].body.output_config?.effort === 'high');
check('tools sent w/ eager streaming + cache_control', requests[0].body.tools.length === 23 && requests[0].body.tools[0].eager_input_streaming === true && !!requests[0].body.tools.at(-1).cache_control);
check('tab context in first user msg', JSON.stringify(requests[0].body.messages[0]).includes('<tab_context>'));
const asst = req2.messages[1];
check('thinking block echoed with signature', asst.content[0].type === 'thinking' && asst.content[0].signature === 'SIG123');
check('tool inputs parsed from partial JSON', asst.content[2].input.tabId === tabId && asst.content[3].input.action === 'screenshot');
const toolMsg = req2.messages[2];
check('all tool_results in ONE user message', toolMsg.role === 'user' && toolMsg.content.length === 2 && toolMsg.content.every((b) => b.type === 'tool_result'));
check('screenshot image inside tool_result', toolMsg.content[1].content.some((c) => c.type === 'image'));
check('no internal fields leaked', !JSON.stringify(req2).includes('_invalidJson'));

requests.length = 0;
const r2 = await run('claude-opus-5[fast]');
check('quick mode done', r2.status === 'done', r2.status);
check('quick mode: speed fast + stop sequence + no tools', requests[0].body.speed === 'fast' && requests[0].body.stop_sequences[0] === '\n<<END>>' && !requests[0].body.tools, JSON.stringify(Object.keys(requests[0].body)));
check('quick mode: model id stripped of [fast]', requests[0].body.model === 'claude-opus-5');
check('quick mode: results + screenshot sent back', JSON.stringify(requests[1].body.messages.at(-1)).includes('Infera Test Page') && requests[1].body.messages.at(-1).content.some((c) => c.type === 'image'));

requests.length = 0;
phase = 'remote';
await sw.evaluate(async (base) => {
  await chrome.storage.local.set({ mcpServers: [{ id: 's1', name: 'crm', url: `${base}/mcp`, headers: {}, enabled: true }] });
}, base);
const r3 = await run('claude-opus-5');
check('remote MCP: tool offered to model', requests[0].body.tools.some((t) => t.name === 'mcp__crm__lookup'));
check('remote MCP: initialize -> tools/list -> tools/call', ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'].every((m) => mcpCalls.includes(m)), mcpCalls.join(','));
check('remote MCP: result returned to model', JSON.stringify(requests[1].body.messages.at(-1)).includes('customer Acme: VIP') && r3.status === 'done');

// Anthropic browser toolset (Claude Opus 5.5): mapping, browser_state, batch stop, preserved thinking.
requests.length = 0;
phase = 'toolset';
const rt = await run('claude-opus-5-5', { classic: false });
const [q1, q2, q3] = requests.map((r) => r.body);
check('toolset: task done', rt.status === 'done', rt.status);
check('toolset: browser_toolset_20260801 offered, replaced tools removed',
  q1.tools[0].type === 'browser_toolset_20260801' && !q1.tools[0].eager_input_streaming && q1.tools[0].configs.javascript_exec.enabled
  && !q1.tools.some((t) => ['computer', 'navigate', 'read_page', 'find', 'tabs_create', 'browser_batch'].includes(t.name))
  && q1.tools.some((t) => t.name === 'update_plan') && q1.tools.some((t) => t.name === 'gif_creator'), q1.tools.map((t) => t.name || t.type).join(','));
check('toolset: preserved thinking drop_block + fallbacks',
  q1.thinking?.block_binding?.prefix_mismatch_behavior === 'drop_block' && requests[0].headers['anthropic-beta'].includes('thinking-binding-controls-2026-08-01') && q1.fallbacks === 'default' && q1.output_config?.effort === 'high');
const tr1 = q2.messages.at(-1).content.filter((b) => b.type === 'tool_result');
check('toolset: every result echoes toolset_name', tr1.length === 4 && tr1.every((b) => b.toolset_name === 'browser'));
const state1 = tr1[0].content.find((c) => c.type === 'browser_state');
check('toolset: get_page_text ok with browser_state', !tr1[0].is_error && tr1[0].content[0].text.includes('Infera Test Page') && state1?.tabs.filter((t) => t.active).length === 1 && state1.tabs.some((t) => t.tab_id === String(tabId)), JSON.stringify(state1));
check('toolset: screenshot returns an image', !tr1[1].is_error && tr1[1].content.some((c) => c.type === 'image'));
check('toolset: failed action stops the batch', tr1[2].is_error && tr1[3].is_error && /Not executed: an earlier action in this turn failed/.test(JSON.stringify(tr1[3].content)));
const tr2 = q3.messages.at(-1).content.filter((b) => b.type === 'tool_result');
check('toolset: new_tab returns exactly one browser_state with tab_opened', tr2.length === 1 && tr2[0].content.length === 1 && tr2[0].content[0].type === 'browser_state' && tr2[0].content[0].state_changes?.[0]?.type === 'tab_opened', JSON.stringify(tr2[0]?.content));
check('toolset: tool_use blocks sent back with toolset_name', q2.messages[1].content.filter((b) => b.type === 'tool_use').every((b) => b.toolset_name === 'browser'));
check('system prompt frozen across turns', JSON.stringify(q1.system) === JSON.stringify(q3.system) && JSON.stringify(q1.tools) === JSON.stringify(q3.tools));
check('history is append-only', JSON.stringify(q3.messages.slice(0, q2.messages.length)) === JSON.stringify(q2.messages));
await sw.evaluate(async () => { // close the tab the toolset opened
  const tabs = await chrome.tabs.query({ url: 'about:blank' });
  for (const t of tabs) await chrome.tabs.remove(t.id).catch(() => {});
});
phase = 'normal';

// Without an INFERA Agent session nothing is sent, even with an API key in storage.
requests.length = 0;
const noAuth = await sw.evaluate(async () => {
  await chrome.storage.local.remove('auth');
  await self.__infera.updateSettings({ apiKey: 'sk-ant-personal' });
  const s = new self.__infera.AgentSession({ kind: 'panel' });
  try { await s.run('hello'); } catch (e) { return { err: e.message, status: s.status }; }
  return { status: s.status, auth: await self.__infera.authStatus?.() };
});
check('API key alone cannot be used', requests.length === 0, JSON.stringify(noAuth));
await sw.evaluate(async () => {
  const cur = (await chrome.storage.local.get('settings')).settings || {};
  await chrome.storage.local.set({ auth: { kind: 'infera', server: cur.inferaUrl, accessToken: 'inf_test', clientId: 'c1' } });
});

// UI pages render
const sp = await ctx.newPage();
const pageErrors = [];
sp.on('pageerror', (e) => pageErrors.push(e.message));
await sp.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
await sp.waitForTimeout(800);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-empty.png') });
await sp.locator('#btnHistory').click();
await sp.waitForTimeout(300);
const historyCount = await sp.locator('.drawer-body .item').count();
check('history lists saved conversations', historyCount >= 2, String(historyCount));
await sp.locator('.drawer-body .item').last().click(); // the tool-calling (non-Quick-Mode) conversation
await sp.waitForTimeout(500);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-conversation.png') });
check('conversation renders tool cards', (await sp.locator('.tool').count()) > 0);
await sp.locator('#btnShortcuts').click();
await sp.waitForTimeout(200);
await sp.locator('.drawer-body .btn.primary').first().click();
await sp.waitForTimeout(200);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-shortcut.png') });
check('side panel has no page errors', pageErrors.length === 0, pageErrors.join('; '));
const op = await ctx.newPage();
await op.setViewportSize({ width: 900, height: 1200 });
op.on('pageerror', (e) => pageErrors.push(e.message));
await op.goto(`chrome-extension://${extId}/options/options.html`);
await op.waitForTimeout(800);
await op.screenshot({ path: path.join(outDir, 'options.png'), fullPage: true });
check('options page renders', (await op.locator('section.card').count()) >= 5);

let fails = 0;
for (const c of checks) { if (!c.ok) fails++; console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.info ? `  (${c.info})` : ''}`); }
await ctx.close();
server.close();
console.log(fails ? `\n${fails} failure(s)` : '\nAll agent checks passed');
process.exit(fails ? 1 : 0);
