// Agent-loop test against a mock Anthropic Messages API (SSE). Verifies:
// streaming (thinking + signature, text, tool_use via input_json_delta),
// tool execution, tool_result round-trip (single user message, images),
// thinking blocks echoed unchanged, headers, Quick Mode command language,
// and that the side panel / settings pages render.
//   node scripts/e2e-agent.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
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
  if (req.url.startsWith('/api/browser-agent/conversations')) {
    const convs = (globalThis.CONVS ||= new Map());
    const id = decodeURIComponent(req.url.split('/')[4] || '');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'PUT') { convs.set(id, JSON.parse(body)); return res.end('{"ok":true}'); }
      if (req.method === 'DELETE') { convs.delete(id); return res.end('{"ok":true}'); }
      if (id) return res.end(JSON.stringify(convs.get(id) || null));
      const q = new URL(req.url, 'http://x').searchParams.get('q')?.toLowerCase() || '';
      res.end(JSON.stringify([...convs.values()].filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q)).map(({ id: cid, title, status, cost, currency, updatedAt }) => ({ id: cid, title, status, cost, currency, updatedAt }))));
    });
    return;
  }
  if (req.url.startsWith('/api/browser-agent/memory')) {
    const mem = (globalThis.MEM ||= new Map());
    const id = decodeURIComponent(req.url.split('/')[4] || '');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'PUT') { const m = { ...JSON.parse(body), id, updatedAt: Date.now() }; mem.set(id, m); return res.end(JSON.stringify(m)); }
      if (req.method === 'DELETE') { if (id === 'all') mem.clear(); else mem.delete(id); return res.end('{"ok":true}'); }
      res.end(JSON.stringify([...mem.values()]));
    });
    return;
  }
  if (req.url.startsWith('/api/browser-agent/policy')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(globalThis.ORG || { orgs: [], blocked: false, blockedBy: '', blocklist: [], memberDailyCap: null }));
    return;
  }
  if (req.url.startsWith('/api/browser-agent/tasks')) {
    const tasks = (globalThis.TASKS ||= []);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      const id = Number(req.url.split('?')[0].split('/')[4] || 0);
      if (req.method === 'PATCH') {
        const t = tasks.find((x) => x.id === id);
        const b = JSON.parse(body || '{}');
        (globalThis.TASK_LOG ||= []).push(`${id}:${b.status}`);
        if (!t || (b.status === 'running' && t.status !== 'queued')) { res.writeHead(409); return res.end('{}'); }
        Object.assign(t, b);
        return res.end(JSON.stringify(t));
      }
      res.end(JSON.stringify(tasks.filter((t) => t.status === 'queued')));
    });
    return;
  }
  if (req.url.startsWith('/api/browser-agent/limits')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'PUT') globalThis.LIMIT = JSON.parse(body).daily;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ owner: false, daily: globalThis.LIMIT ?? 2, currency: 'SAR', spentToday: 1.25, source: 'account' }));
    });
    return;
  }
  if (req.url.startsWith('/api/browser-agent/usage')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    const at = new Date().toISOString();
    res.end(JSON.stringify({ currency: 'SAR', owner: false, balance: 27.5, today: 1.25, month: 8.4, rows: [
      { id: 3, at, kind: 'model', task: 'Compare prices', model: 'claude-opus-5-5', searches: 0, input: 1200, output: 900, cacheRead: 40000, cacheWrite: 2000, amount: 0.31, charged: true },
      { id: 2, at, kind: 'search', task: 'Compare prices', model: null, searches: 2, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, amount: 0.08, charged: true },
      { id: 1, at, kind: 'model', task: 'Summarize this page', model: 'claude-opus-5-5', searches: 0, input: 8000, output: 600, cacheRead: 0, cacheWrite: 8000, amount: 0.22, charged: true },
    ] }));
    return;
  }
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
      if (phase === 'queue') {
        // One step, then an answer; the user writes while the first step runs.
        const k = j.messages.filter((m) => m.role === 'assistant').length;
        if (k === 0) {
          return setTimeout(() => sse(res, [start('qq1'),
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'qw1', name: 'computer', input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ action: 'wait', duration: 0, tabId: globalThis.TAB }) } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]), 300);
        }
        return sse(res, [start('qq2'),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done, including your extra request.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
      }
      if (phase === 'steps') {
        // A planned task: the step list, one browser action, a verified step, then the answer.
        const k = j.messages.filter((m) => m.role === 'assistant').length;
        const tu = (index, id, name, input) => [
          { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
          { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
          { type: 'content_block_stop', index },
        ];
        if (k === 0) {
          return setTimeout(() => sse(res, [start('st1'),
            ...tu(0, 'st_plan', 'task_steps', { action: 'plan', steps: ['Open the site', 'Fill in the form', 'Submit and verify'] }),
            ...tu(1, 'st_go', 'task_steps', { action: 'start', step: 1 }),
            ...tu(2, 'st_wait', 'computer', { action: 'wait', duration: 0, tabId: globalThis.TAB }),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }, { type: 'message_stop' }]), 150);
        }
        if (k === 1) {
          return sse(res, [start('st2'),
            ...tu(0, 'st_done', 'task_steps', { action: 'done', step: 1, note: 'Order form open' }),
            ...tu(1, 'st_replan', 'task_steps', { action: 'plan', steps: ['Open the site', 'Fill in the form', 'Upload the file', 'Submit and verify'] }),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } }, { type: 'message_stop' }]);
        }
        return sse(res, [start('st3'),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'All done. Verified: confirmation shown.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
      }
      if (phase === 'overload' && j.model === 'claude-opus-5-5') {
        res.writeHead(529, { 'content-type': 'application/json', 'retry-after': '0.01' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
      }
      if (phase === 'overload') return sse(res, [start('ov1'),
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answered by the next model.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
      if (phase === 'budget') {
        // Every call costs 0.40 SAR (reported by the gateway after message_stop) and asks for one more step.
        return sse(res, [start('bg' + n),
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'w' + n, name: 'computer', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ action: 'wait', duration: 0, tabId: globalThis.TAB }) } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' },
          { type: 'infera_usage', amount: 0.4, currency: 'SAR', balance: 20, charged: true }]);
      }
      if (phase === 'delegate') {
        const first = JSON.stringify(j.messages[0] || {});
        const k = j.messages.filter((m) => m.role === 'assistant').length;
        const say = (id, text) => sse(res, [start(id),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' },
          { type: 'infera_usage', amount: 0.1, currency: 'SAR', balance: 20, charged: true }]);
        if (first.includes('You are a helper')) {
          globalThis.HELPER_TOOLS = (j.tools || []).map((t) => t.name || t.type);
          return say('h1', first.includes('shop A') ? 'Shop A: 10 SAR (https://a.example)' : 'Shop B: 12 SAR (https://b.example)');
        }
        if (k === 0) {
          return sse(res, [start('d1'),
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'dl_1', name: 'delegate_tasks', input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ tasks: [{ task: 'Price at shop A' }, { task: 'Price at shop B' }] }) } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
        }
        return say('d2', 'Shop A is cheaper.');
      }
      if (phase === 'compact') {
        // A long task: a note, then the server summarizes the history, then the end.
        const tu = (index, id, name, input) => [
          { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
          { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
          { type: 'content_block_stop', index },
        ];
        const k = j.messages.filter((m) => m.role === 'assistant').length;
        const summarized = j.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'compaction'));
        if (!summarized && k === 0) {
          return sse(res, [start('c1'), ...tu(0, 'tn_1', 'task_notes', { action: 'append', text: 'Price at shop A: 10 SAR' }),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
        }
        if (!summarized) {
          return sse(res, [start('c2'),
            { type: 'content_block_start', index: 0, content_block: { type: 'compaction', content: null } },
            { type: 'content_block_delta', index: 0, delta: { type: 'compaction_delta', content: '<summary>Goal: compare prices. Shop A done.</summary>' } },
            { type: 'content_block_stop', index: 0 },
            ...tu(1, 'tn_2', 'task_notes', { action: 'read' }),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5, iterations: [{ type: 'compaction', input_tokens: 260000, output_tokens: 900 }] } }, { type: 'message_stop' }]);
        }
        return sse(res, [start('c3'),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Shop A is cheapest.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
      }
      if (phase === 'web' || phase === 'plain') {
        const tu = (index, id, name, input, toolset = false) => [
          { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, ...(toolset ? { toolset_name: 'browser' } : {}), input: {} } },
          { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
          { type: 'content_block_stop', index },
        ];
        const end = (id, text) => sse(res, [start(id),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
        if (phase === 'plain') return end('p1', 'Hello again.');
        const k = j.messages.filter((m) => m.role === 'assistant').length;
        if (k === 0) {
          // A web search on Anthropic's side, a cited answer, then two memory saves.
          return sse(res, [start('w1'),
            { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"aisle seats"}' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://example.com/seats', title: 'Seat guide', encrypted_content: 'ENC123', page_age: 'today' }] } },
            { type: 'content_block_stop', index: 1 },
            { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '', citations: [] } },
            { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Aisle seats are easier to leave.' } },
            { type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://example.com/seats', title: 'Seat guide', encrypted_index: 'EI1', cited_text: 'aisle' } } },
            { type: 'content_block_stop', index: 2 },
            ...tu(3, 'mem_1', 'memory_save', { text: 'Prefers aisle seats' }),
            ...tu(4, 'mem_2', 'memory_save', { text: 'My password is hunter2' }),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30, server_tool_use: { web_search_requests: 1 } } }, { type: 'message_stop' }]);
        }
        if (k === 1) {
          return sse(res, [start('w2'), ...tu(0, 'rp_1', 'read_page', { filter: 'interactive' }, true),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
        }
        if (k === 2) {
          const tree = JSON.stringify(j.messages.at(-1).content);
          const ref = (tree.match(/Attachment\\" \[(ref_\d+)\]/) || [])[1] || 'ref_missing';
          return sse(res, [start('w3'), ...tu(0, 'fu_1', 'file_upload', { target: { type: 'ref', ref }, paths: ['/attachments/notes.txt'] }, true),
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
        }
        return end('w4', 'Uploaded your notes.');
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
// A fresh install starts on the Auto operating mode (existing installs keep their model).
const installMode = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.operatingMode);

const run = (model, { classic = true } = {}) => sw.evaluate(async ({ base, tabId, model, classic }) => {
  const I = self.__infera;
  // Signed in with an INFERA Agent session against the local mock gateway.
  await chrome.storage.local.set({ auth: { kind: 'infera', server: base, accessToken: 'inf_test', clientId: 'c1' } });
  await I.updateSettings({ apiKey: 'sk-ignored', apiBaseUrl: 'https://api.anthropic.com', inferaUrl: base, model, permissionMode: 'skip_all_permission_checks', safetyChecker: false, sound: false, notifications: false, operatingMode: 'manual' });
  const s = new I.AgentSession({ kind: 'panel' });
  s.classicTools = classic; // our own browsing tools instead of Anthropic's browser toolset
  const events = [];
  s.subscribe((e) => events.push(e.type));
  await s.run('What is on this page?', { startTabId: tabId });
  return { status: s.status, events: [...new Set(events)], messages: s.messages.map((m) => ({ role: m.role, types: m.content.map((b) => b.type + (b.type === 'tool_result' ? `:${b.is_error ? 'err' : 'ok'}:${(b.content || []).map((c) => c.type).join('+')}` : '')) })) };
}, { base, tabId, model, classic });

const checks = [];
const check = (name, ok, info = '') => checks.push({ name, ok, info });
// A crash part-way still reports what passed and failed before it.
process.on('uncaughtException', (e) => { for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `  (${c.info})`}`); console.error(e); process.exit(1); });

const r1 = await run('claude-opus-5');
check('agent status done', r1.status === 'done', r1.status);
check('events streamed', ['thinking_delta', 'text_delta', 'tool_start', 'tool_result', 'turn_end'].every((e) => r1.events.includes(e)), r1.events.join(','));
const req2 = requests[1]?.body;
check('two API requests', requests.length === 2, String(requests.length));
check('headers: version + INFERA session token, no API key', requests[0].headers['anthropic-version'] === '2023-06-01' && requests[0].headers.authorization === 'Bearer inf_test' && !requests[0].headers['x-api-key'] && !requests[0].headers['anthropic-dangerous-direct-browser-access']);
check('adaptive thinking + effort (medium by default)', requests[0].body.thinking?.type === 'adaptive' && requests[0].body.output_config?.effort === 'medium');
const lastBlock = (b) => b.messages.at(-1).content.at(-1);
check('history cached: breakpoint on the newest message only', !!lastBlock(requests[1].body).cache_control && !requests[1].body.messages[0].content.some((c) => c.cache_control));
const cm = requests[0].body.context_management?.edits?.[0];
check('long history: summarized on the server at 250k tokens (compaction), output up to 128k', cm?.type === 'compact_20260112' && cm?.trigger?.value === 250000 && /Do not call any tools/.test(cm?.instructions || '')
  && String(requests[0].headers['anthropic-beta']).includes('compact-2026-01-12') && requests[0].body.max_tokens === 128000, JSON.stringify(cm).slice(0, 200));
check('task named for the cost log', decodeURIComponent(requests[0].headers['x-infera-task'] || '') === 'What is on this page?');
const t0 = requests[0].body.tools;
check('tools: web search/fetch first, own tools w/ eager streaming, memory, cache_control',
  t0.length === 34 && t0.some((t) => t.name === 'task_steps') && t0.some((t) => t.name === 'export_file') && t0.some((t) => t.name === 'delegate_tasks') && t0.some((t) => t.name === 'task_notes') && t0.some((t) => t.name === 'memory_search') && t0[0].type === 'web_search_20260318' && t0[0].response_inclusion === 'excluded' && t0[1].type === 'web_fetch_20260318'
  && !t0[0].eager_input_streaming && t0[2].eager_input_streaming === true && t0.some((t) => t.name === 'memory_save') && t0.some((t) => t.name === 'all_tabs') && !!t0.at(-1).cache_control,
  t0.map((t) => t.name || t.type).join(','));
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
  q1.thinking?.block_binding?.prefix_mismatch_behavior === 'drop_block' && requests[0].headers['anthropic-beta'].includes('thinking-binding-controls-2026-08-01') && q1.fallbacks === 'default' && q1.output_config?.effort === 'medium');
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
// The moving cache marker is not part of the conversation (it doesn't invalidate thinking).
const noMarks = (msgs) => JSON.stringify(msgs, (k, v) => (k === 'cache_control' ? undefined : v));
check('history is append-only', noMarks(q3.messages.slice(0, q2.messages.length)) === noMarks(q2.messages));
await sw.evaluate(async () => { // close the tab the toolset opened
  const tabs = await chrome.tabs.query({ url: 'about:blank' });
  for (const t of tabs) await chrome.tabs.remove(t.id).catch(() => {});
});
phase = 'normal';

// Web research, citations, memory and file attachments (Claude Opus 5.5).
requests.length = 0;
phase = 'web';
const web = await sw.evaluate(async ({ tabId }) => {
  const I = self.__infera;
  await I.updateSettings({ userBlocklist: ['blocked.example'] });
  const s = new I.AgentSession({ kind: 'panel' });
  const cites = [];
  s.subscribe((e) => { if (e.type === 'citations') cites.push(...e.sources); });
  await s.run('Which seat should I pick? Remember I like aisle seats. Then upload my notes.', {
    startTabId: tabId,
    attachments: [{ kind: 'file', name: 'notes.txt', mediaType: 'text/plain', base64: btoa('hello file') }],
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const uploaded = (await chrome.scripting.executeScript({ target: { tabId }, func: () => document.getElementById('file').files[0]?.name || null }))[0].result;
  const mem = (await chrome.storage.local.get('userMemory')).userMemory || [];
  return { status: s.status, cites, uploaded, mem: mem.map((m) => m.text), tab: tab?.id };
}, { tabId });
const [w1, w2, , w4] = requests.map((r) => r.body);
check('web: task done', web.status === 'done', web.status);
check('web: search + fetch offered with the blocklist', w1.tools.some((t) => t.type === 'web_search_20260318' && t.blocked_domains?.includes('blocked.example')) && w1.tools.some((t) => t.type === 'web_fetch_20260318'));
check('web: citations shown as sources', web.cites.some((c) => c.url === 'https://example.com/seats'), JSON.stringify(web.cites));
const replay = w2.messages[1].content;
check('web: server blocks replayed unchanged', replay.some((b) => b.type === 'server_tool_use' && b.input.query === 'aisle seats') && replay.some((b) => b.type === 'web_search_tool_result' && b.content[0].encrypted_content === 'ENC123') && replay.some((b) => b.citations?.[0]?.encrypted_index === 'EI1'));
check('files: attached file listed and given to the model', JSON.stringify(w1.messages[0]).includes('/attachments/notes.txt') && w1.messages[0].content.some((b) => b.type === 'document' && b.source.data === 'hello file'));
const memResults = w2.messages.at(-1).content.filter((b) => b.type === 'tool_result');
check('memory: saved, secrets refused', web.mem.includes('Prefers aisle seats') && !web.mem.some((m) => /hunter2/.test(m)) && memResults[1]?.is_error === true, JSON.stringify(web.mem));
check('files: file_upload put the attachment into the page', web.uploaded === 'notes.txt', JSON.stringify({ uploaded: web.uploaded, last: w4?.messages.at(-1) }).slice(0, 400));
requests.length = 0;
phase = 'plain';
await run('claude-opus-5-5', { classic: false });
check('memory: shown at the start of a new conversation', JSON.stringify(requests[0].body.messages[0]).includes('<user_memory>') && JSON.stringify(requests[0].body.messages[0]).includes('Prefers aisle seats'));
// A message that is only an attachment (no text), in a conversation that already
// holds an empty text block from an older version: no empty text block is sent.
requests.length = 0;
const fileOnly = await sw.evaluate(async ({ tabId }) => {
  const s = new self.__infera.AgentSession({ kind: 'panel' });
  s.classicTools = false;
  s.messages.push({ role: 'user', content: [{ type: 'text', text: 'old' }, { type: 'text', text: '' }] }, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] });
  await s.run('', { startTabId: tabId, attachments: [{ kind: 'file', name: 'pkg.zip', mediaType: 'application/zip', base64: btoa('PK') }] });
  return { status: s.status, title: s.title };
}, { tabId });
const sent = requests[0]?.body.messages || [];
check('files: attachment-only message sends no empty text block', fileOnly.status === 'done' && sent.length > 0 && sent.every((m) => !Array.isArray(m.content) || m.content.every((b) => b.type !== 'text' || b.text.trim())) && JSON.stringify(sent).includes('/attachments/pkg.zip') && fileOnly.title === 'pkg.zip', JSON.stringify({ fileOnly, sent }).slice(0, 400));
// A history with a turn resumed after pause_turn (two assistant messages) and a
// server tool call whose result never came (the step was stopped): both are
// repaired before sending.
requests.length = 0;
const repaired = await sw.evaluate(async ({ tabId }) => {
  const s = new self.__infera.AgentSession({ kind: 'panel' });
  s.classicTools = false;
  s.messages.push(
    { role: 'user', content: [{ type: 'text', text: 'search' }] },
    { role: 'assistant', content: [{ type: 'server_tool_use', id: 'srvtoolu_a', name: 'web_search', input: { query: 'x' } }, { type: 'server_tool_use', id: 'srvtoolu_b', name: 'bash_code_execution', input: { command: 'ls' } }] },
    { role: 'assistant', content: [{ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_a', content: [] }, { type: 'text', text: 'found' }] },
    { role: 'user', content: [{ type: 'text', text: 'more' }] },
    { role: 'assistant', content: [{ type: 'server_tool_use', id: 'srvtoolu_c', name: 'bash_code_execution', input: { command: 'ls' } }] },
  );
  await s.run('next', { startTabId: tabId });
  return s.status;
}, { tabId });
const sent2 = requests[0]?.body.messages || [];
const flat2 = JSON.stringify(sent2);
check('history: paused turn merged, unanswered server tool calls dropped', repaired === 'done' && sent2[1]?.role === 'assistant' && sent2[2]?.role === 'user' && flat2.includes('srvtoolu_a') && !flat2.includes('srvtoolu_b') && !flat2.includes('srvtoolu_c'), flat2.slice(0, 600));
await sw.evaluate(() => self.__infera.updateSettings({ userBlocklist: [] }));
phase = 'normal';

// Conversations are saved in the account and come back on another device.
await new Promise((r) => setTimeout(r, 300));
const saved = [...(globalThis.CONVS || new Map()).values()];
check('history: conversations saved in the account, without screenshots', saved.length >= 3 && saved.every((c) => !JSON.stringify(c.messages).includes('"type":"image"')) && saved.some((c) => c.model === 'claude-opus-5-5'), String(saved.length));
globalThis.CONVS.set('remote-conv-1', { id: 'remote-conv-1', title: 'From my other laptop', status: 'done', kind: 'panel', createdAt: Date.now(), updatedAt: Date.now() + 1000, cost: 0.5, currency: 'SAR', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello from the laptop' }] }, { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }] });
const remoteHist = await sw.evaluate(async () => {
  const win = (await chrome.windows.getCurrent()).id;
  const list = await self.__infera.panelCall(win, { type: 'history_list' });
  const loaded = await self.__infera.panelCall(win, { type: 'load_conversation', id: 'remote-conv-1' });
  return { first: list[0], text: loaded?.messages?.[0]?.content?.[0]?.text };
});
check('history: a conversation from another device is listed and opens', remoteHist.first?.id === 'remote-conv-1' && remoteHist.first.remote && remoteHist.text === 'hello from the laptop', JSON.stringify(remoteHist));

// The whole browser: list, take and close any tab (not only the agent's group).
const tabsRes = await sw.evaluate(async ({ base }) => {
  const I = self.__infera;
  const extra = [await chrome.tabs.create({ url: `${base}/test.html?dup`, active: false }), await chrome.tabs.create({ url: `${base}/test.html?dup`, active: false }), await chrome.tabs.create({ url: `${base}/test.html?other`, active: false })];
  await new Promise((r) => setTimeout(r, 500));
  const s = new I.AgentSession({ kind: 'panel' });
  const ctx = { sessionId: s.id, kind: 'panel', mode: 'auto', allTabsAccess: true, requestApproval: async () => 'once', signal: new AbortController().signal, toolUseId: 'x' };
  const list = await I.executeTool('all_tabs', { action: 'list' }, ctx);
  const take = await I.executeTool('all_tabs', { action: 'take', tab_ids: [extra[2].id] }, ctx);
  const inGroup = await I.tabGroups.isInGroup(s.id, extra[2].id);
  const dup = await I.executeTool('all_tabs', { action: 'close', duplicates: true }, ctx);
  const left = (await chrome.tabs.query({})).filter((t) => t.url.includes('?dup')).length;
  const off = await I.executeTool('all_tabs', { action: 'list' }, { ...ctx, allTabsAccess: false });
  await I.executeTool('all_tabs', { action: 'close', match: '?other' }, ctx);
  return { list: list.content[0].text, inGroup, dup: dup.content[0].text, left, off: off.isError, otherGone: !(await chrome.tabs.query({})).some((t) => t.url.includes('?other')) };
}, { base });
check('all tabs: lists every tab, takes one into the group, closes duplicates and by match', /tab\(s\) in \d+ window/.test(tabsRes.list) && tabsRes.list.includes('?dup') && tabsRes.inGroup && tabsRes.left === 1 && tabsRes.otherGone && tabsRes.off, JSON.stringify({ ...tabsRes, list: tabsRes.list.slice(0, 120) }));

// A message sent while a task runs joins it at the next step.
requests.length = 0;
phase = 'queue';
const queued = await sw.evaluate(async ({ tabId }) => {
  const s = new self.__infera.AgentSession({ kind: 'panel' });
  const p = s.run('Wait a moment', { startTabId: tabId });
  await new Promise((r) => setTimeout(r, 100));
  s.enqueue('Also tell me the page title');
  await p;
  return { status: s.status, last: s.messages.at(-1).content.map((b) => b.text || '').join('') };
}, { tabId });
check('queue: a message sent mid-task reaches the next step', requests.length === 2 && JSON.stringify(requests[1].body.messages.at(-1)).includes('Also tell me the page title') && queued.status === 'done', `${requests.length} ${queued.status}`);

// The side panel comes back to its conversation after the service worker restarts.
const restored = await sw.evaluate(async () => {
  const I = self.__infera;
  const win = (await chrome.windows.getCurrent()).id;
  const s = await I.sessionForWindow(win);
  s.title = 'Restore me';
  s.messages = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }, { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }];
  const all = (await chrome.storage.local.get('conversations')).conversations || [];
  await chrome.storage.local.set({ conversations: [{ id: s.id, title: s.title, kind: 'panel', createdAt: Date.now(), updatedAt: Date.now(), status: 'done', messages: s.messages, usage: s.usage }, ...all] });
  await new Promise((r) => setTimeout(r, 100));
  I.sessions.clear(); // what a service worker restart does to memory
  const back = await I.sessionForWindow(win);
  return { same: back.id === s.id, msgs: back.messages.length, title: back.title };
});
check('panel returns to the same conversation after a restart', restored.same && restored.msgs === 2 && restored.title === 'Restore me', JSON.stringify(restored));

// Live steps, pause and take over: the plan is shown and kept on replanning; taking over
// holds the next step and skips the browser action planned before it; giving control
// back tells the model to look at the page again.
requests.length = 0;
phase = 'steps';
const steps = await sw.evaluate(async ({ tabId }) => {
  const fresh = (await chrome.storage.local.get('settings')).settings?.operatingMode;
  const s = new self.__infera.AgentSession({ kind: 'panel' });
  s.classicTools = true;
  s.modelOverride = 'claude-opus-5-5';
  const statuses = [];
  const stepEvents = [];
  let held = null;
  let turns = 0;
  s.subscribe((e) => {
    if (e.type === 'assistant_start') turns++;
    if (e.type === 'status') statuses.push(e.status);
    if (e.type === 'steps') {
      stepEvents.push(e.steps.map((x) => `${x.title}:${x.status}`).join('|'));
      if (stepEvents.length === 1) s.pause({ takeOver: true });
    }
  });
  const run = s.run('Place the order', { startTabId: tabId });
  await new Promise((r) => setTimeout(r, 700));
  held = { status: s.status, turns };
  const resumed = s.resume();
  await run;
  return { status: s.status, statuses, stepEvents, held, resumed, steps: s.steps, summary: s.summary(), fresh };
}, { tabId });
const sReq = requests.map((r) => JSON.stringify(r.body.messages.at(-1)));
check('steps: plan shown live, replan keeps the verified step', steps.stepEvents[0] === 'Open the site:pending|Fill in the form:pending|Submit and verify:pending'
  && steps.steps.length === 4 && steps.steps[0].status === 'done' && steps.steps[0].note === 'Order form open' && steps.steps[2].title === 'Upload the file' && steps.summary.steps.length === 4, JSON.stringify(steps.steps));
check('new installs start on the Auto operating mode', installMode === 'auto', String(installMode));
check('take over: holds the next step while the user works', steps.held.status === 'paused' && steps.held.turns === 1 && steps.statuses.includes('paused') && steps.resumed, JSON.stringify({ held: steps.held, n: requests.length, st: steps.statuses }));
check('take over: the browser action planned before it is not run; the model is told to look again',
  /Not run: the user took over the browser/.test(sReq[1] || '') && /took over the browser for a while and has now given control back/.test(sReq[1] || ''), (sReq[1] || '').slice(0, 400));
check('steps: task completes after resume', steps.status === 'done' && requests.length === 3, `${steps.status} ${requests.length}`);
check('prompt: verify before done, never submit twice', /Verify, don't assume/.test(JSON.stringify(requests[0].body.system)) && /Never submit the same form or request twice/.test(JSON.stringify(requests[0].body.system)));

// Operating modes: Auto picks the model and effort from the request; Power and Fast are fixed; a busy
// model fails over before the first answer.
phase = 'plain';
const routed = await sw.evaluate(async ({ tabId }) => {
  const I = self.__infera;
  const out = {};
  for (const [mode, text] of [['auto', 'What is on this page?'], ['auto', 'Open the CRM, sign in, and for each lead in the list fill in the follow-up form and submit it'], ['power', 'hi'], ['fast', 'hi']]) {
    await I.updateSettings({ operatingMode: mode });
    const s = new I.AgentSession({ kind: 'panel' });
    s.classicTools = true;
    let route = null;
    s.subscribe((e) => { if (e.type === 'routed') route = e; });
    await s.run(text, { startTabId: tabId });
    out[`${mode}:${text.slice(0, 12)}`] = { route, status: s.status, model: s.lastModel };
  }
  out.stats = await chrome.storage.local.get('routeStats');
  return out;
}, { tabId });
const rq = requests.slice(-4).map((r) => `${r.body.model}/${r.body.output_config?.effort || '-'}`);
check('auto: a quick question goes to Fast (Sonnet 5, low effort)', rq[0] === 'claude-sonnet-5/low' && routed['auto:What is on t'].route?.mode === 'fast', `${rq[0]} ${JSON.stringify(routed['auto:What is on t'].route)}`);
check('auto: a multi-step form task goes to Power (Opus 5.5, high effort)', rq[1] === 'claude-opus-5-5/high' && routed['auto:Open the CRM'].route?.reason === 'multi-step actions', `${rq[1]}`);
check('modes: Power and Fast are fixed choices', rq[2] === 'claude-opus-5-5/high' && rq[3] === 'claude-sonnet-5/low', rq.join(' '));
check('auto: outcomes recorded per mode', routed.stats.routeStats?.fast?.length >= 2 && routed.stats.routeStats?.power?.length >= 2, JSON.stringify(routed.stats));
requests.length = 0;
phase = 'overload';
const over = await sw.evaluate(async ({ tabId }) => {
  const I = self.__infera;
  await I.updateSettings({ operatingMode: 'power' });
  const s = new I.AgentSession({ kind: 'panel' });
  s.classicTools = true;
  const infos = [];
  s.subscribe((e) => { if (e.type === 'info') infos.push(e.message); });
  await s.run('hi', { startTabId: tabId });
  await I.updateSettings({ operatingMode: 'manual' });
  return { status: s.status, model: s.lastModel, infos };
}, { tabId });
check('failover: a busy model hands the new task to the next one', over.status === 'done' && over.model === 'claude-opus-5' && requests.at(-1).body.model === 'claude-opus-5' && /busy right now/.test(over.infos.join(' ')), JSON.stringify({ ...over, n: requests.length }));
phase = 'normal';

// Costs: each call's charge is reported; the task limit asks; the daily limit stops.
requests.length = 0;
phase = 'budget';
const budget = await sw.evaluate(async ({ tabId }) => {
  const I = self.__infera;
  await chrome.storage.local.remove('spendByDay');
  await I.updateSettings({ taskBudget: 1 });
  const s = new I.AgentSession({ kind: 'panel' });
  const costs = [];
  let asked = null;
  s.subscribe((e) => {
    if (e.type === 'cost') costs.push(e.task);
    if (e.type === 'permission_request') { asked = e.request; s.answer(e.request.id, 'deny'); }
  });
  await s.run('Keep waiting', { startTabId: tabId });
  const today = (await chrome.storage.local.get('spendByDay')).spendByDay;
  await I.updateSettings({ taskBudget: 3 });
  return { status: s.status, costs, asked, cost: s.summary().cost, currency: s.currency, today };
}, { tabId });
check('costs: each call reported live', budget.costs.length === 3 && Math.abs(budget.costs[2] - 1.2) < 1e-9 && budget.currency === 'SAR', JSON.stringify(budget.costs));
check('costs: task limit asks before spending more, and stops on "Stop"', requests.length === 3 && budget.asked?.permissionType === 'BUDGET' && budget.status === 'stopped', `${requests.length} ${budget.status} ${budget.asked?.description}`);
check('costs: spending kept per day', Math.abs(Object.values(budget.today || {})[0] - 1.2) < 1e-9);
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
await sp.locator('#btnNew').click();
await sp.waitForTimeout(400);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-empty.png') });
check('home: quick actions and quick tasks', (await sp.locator('#examples .qa').count()) === 9 && (await sp.locator('#quickTasks .qt').count()) === 6);
await sp.locator('#examples .qa[data-qa="extract"]').click();
check('home: a quick action prefills the request', /table|الجدول/.test(await sp.locator('#input').inputValue()));
await sp.locator('#input').fill('');
await sp.locator('#btnHistory').click();
await sp.waitForTimeout(400);
const historyCount = await sp.locator('.drawer-body .hcard').count();
check('history lists saved conversations as task cards with filters', historyCount >= 2 && (await sp.locator('#historyStatus option').count()) === 6 && (await sp.locator('#historySite').count()) === 1, String(historyCount));
await sp.screenshot({ path: path.join(outDir, 'sidepanel-history.png') });
await sp.locator('#historyStatus').selectOption('done');
await sp.waitForTimeout(100);
const doneOnly = await sp.locator('.drawer-body .hcard').count();
check('history: status filter', doneOnly >= 1 && doneOnly <= historyCount, `${doneOnly}/${historyCount}`);
await sp.locator('#historyStatus').selectOption('');
await sp.locator('#historySearch').fill('Place the order');
await sp.waitForTimeout(700);
await sp.locator('.drawer-body .hcard').first().click();
await sp.waitForTimeout(500);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-conversation.png') });
check('conversation renders tool cards', (await sp.locator('.tool').count()) > 0);
await sp.locator('#btnLive').click();
await sp.waitForTimeout(300);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-live.png') });
check('execution center: the saved steps with their status, and the finished-task actions',
  (await sp.locator('#liveSteps .step').count()) === 4 && (await sp.locator('#liveSteps .step.done').count()) === 1 && (await sp.locator('#liveExport').count()) === 1 && (await sp.locator('#livePill').innerText()).length > 0);
await sp.locator('#liveClose').click();
await sp.locator('#btnStudio').click();
await sp.waitForTimeout(300);
await sp.locator('#wfNew').click();
await sp.waitForTimeout(200);
await sp.locator('#wfCommand').fill('weekly-report');
await sp.locator('#wfSteps textarea').first().fill('Open {{site}} and sign in');
await sp.locator('#drawerBody button', { hasText: /Add step|إضافة خطوة/ }).click();
await sp.locator('#wfSteps .wfe-step').nth(1).locator('select').selectOption('each');
await sp.locator('#wfSteps textarea').nth(1).fill('row in the report table, copy its total');
await sp.screenshot({ path: path.join(outDir, 'sidepanel-workflow-editor.png') });
await sp.locator('#wfSave').click();
await sp.waitForTimeout(400);
const savedWf = await sw.evaluate(async () => ((await chrome.storage.local.get('shortcuts')).shortcuts || []).find((x) => x.command === 'weekly-report'));
check('workflow studio: steps with kinds and variables are saved and compiled', savedWf?.steps?.length === 2 && savedWf.steps[1].kind === 'each'
  && savedWf.prompt === '1. Open {{site}} and sign in\n2. For each row in the report table, copy its total' && savedWf.params?.[0]?.name === 'site', JSON.stringify(savedWf));
await sp.locator('#studio_templates').click();
await sp.waitForTimeout(200);
check('workflow studio: ready-made templates', (await sp.locator('#drawerBody .wf').count()) === 6);
await sp.locator('#drawerBody .wf .btn.primary').first().click();
await sp.waitForTimeout(200);
check('workflow studio: a template opens in the editor', (await sp.locator('#wfSteps .wfe-step').count()) === 5);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-studio.png') });
await sp.locator('#btnCosts').click();
await sp.waitForSelector('.cost-stats', { timeout: 5000 }).catch(() => {});
await sp.waitForTimeout(300);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-costs-top.png') });
check('usage: total for the period, chart and the split by model', /0\.61/.test(await sp.locator('#costTotal .v').innerText()) && (await sp.locator('#costTotal .bars .b').count()) === 24
  && (await sp.locator('#costModels .mrow').count()) === 2, await sp.locator('#costTotal').innerText().catch(() => ''));
await sp.locator('#costPeriod button').nth(2).click();
check('usage: month view has a bar per day', (await sp.locator('#costTotal .bars .b').count()) === 30);
await sp.locator('.ops summary').click().catch(() => {});
await sp.screenshot({ path: path.join(outDir, 'sidepanel-costs.png'), fullPage: true });
check('Costs tab: totals, limits, tasks and the operations log', (await sp.locator('.cost-stats .stat').count()) === 3 && (await sp.locator('.ops-table tr').count()) === 3 && (await sp.locator('#drawerBody .card.item').count()) === 2);
const dayField = sp.locator('#drawerBody input[type=number]').nth(1);
const shownDaily = await dayField.inputValue();
await dayField.fill('7');
await sp.locator('#saveLimits').click();
await sp.waitForTimeout(500);
check('Costs tab: the daily limit is the account\'s, saved on the server', shownDaily === '2' && globalThis.LIMIT === 7, `${shownDaily} ${globalThis.LIMIT}`);
// Arabic, right to left
await sw.evaluate(() => self.__infera.updateSettings({ language: 'ar' }));
await sp.reload();
await sp.waitForTimeout(800);
check('arabic: right-to-left with translated home', (await sp.evaluate(() => document.documentElement.dir)) === 'rtl' && /اكتب ما تريد/.test(await sp.locator('#empty h2').innerText()));
await sp.screenshot({ path: path.join(outDir, 'sidepanel-ar.png') });
await sp.locator('#btnCosts').click();
await sp.waitForTimeout(500);
await sp.screenshot({ path: path.join(outDir, 'sidepanel-costs-ar.png') });
await sw.evaluate(() => self.__infera.updateSettings({ language: 'auto' }));
check('side panel has no page errors', pageErrors.length === 0, pageErrors.join('; '));
// Microphone refused: one settings tab, no restart loop (it used to open a tab per retry).
const mic = await ctx.newPage();
await mic.addInitScript(() => {
  globalThis.__starts = 0;
  class FakeSR { start() { globalThis.__starts++; setTimeout(() => { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); }, 20); } stop() {} abort() {} }
  globalThis.webkitSpeechRecognition = FakeSR;
  globalThis.SpeechRecognition = FakeSR;
});
await mic.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
await mic.waitForTimeout(800);
await mic.goto(`${base}/test.html`);
await mic.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
await mic.waitForTimeout(600);
await mic.locator('#btnStudio').click();
await mic.waitForTimeout(300);
await mic.locator('#studio_record').click();
await mic.waitForTimeout(300);
await mic.locator('#recStart').click();
await mic.waitForTimeout(2500);
const micTabs = ctx.pages().filter((pg) => pg.url().includes('options/options.html')).length;
const starts = await mic.evaluate(() => globalThis.__starts);
check('microphone refused: one settings tab, no restart loop', micTabs === 1 && starts === 1, `tabs=${micTabs} starts=${starts}`);
for (const pg of ctx.pages()) if (pg.url().includes('options/options.html')) await pg.close();
await mic.close();
// A long task: the history is summarized on the server, the notebook comes back
// word for word, and only the summary onward is sent.
requests.length = 0;
phase = 'compact';
const long = await sw.evaluate(async ({ tabId }) => {
  const s = new self.__infera.AgentSession({ kind: 'panel' });
  s.classicTools = true;
  s.modelOverride = 'claude-opus-5-5';
  const events = [];
  s.subscribe((e) => { if (e.type === 'compacted') events.push(e); });
  await s.run('Compare the prices', { startTabId: tabId });
  return { status: s.status, notes: s.notes, compactions: s.compactions, events: events.length, last: s.messages.at(-1)?.content?.[0]?.text };
}, { tabId });
const c3 = requests.at(-1)?.body;
check('long task: summarized and goes on', long.status === 'done' && long.compactions === 1 && long.events === 1 && long.last === 'Shop A is cheapest.', JSON.stringify(long));
check('long task: only the summary onward is sent, notebook handed back', c3?.messages[0]?.role === 'assistant' && c3.messages[0].content[0].type === 'compaction'
  && JSON.stringify(c3.messages.at(-1)).includes('<task_notes>') && JSON.stringify(c3.messages.at(-1)).includes('Price at shop A: 10 SAR'), JSON.stringify(c3?.messages || []).slice(0, 500));

// Helpers: delegate_tasks runs two helpers at once, in windows of their own, and
// returns both answers; helpers can't delegate and aren't saved as conversations.
requests.length = 0;
phase = 'delegate';
const windowsBefore = await sw.evaluate(async () => (await chrome.windows.getAll()).length);
const del = await sw.evaluate(async ({ tabId }) => {
  const s = new self.__infera.AgentSession({ kind: 'panel' });
  s.classicTools = true;
  s.modelOverride = 'claude-opus-5-5';
  await s.run('Which shop is cheaper?', { startTabId: tabId });
  const result = s.messages.find((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.tool_use_id === 'dl_1'))?.content.find((b) => b.tool_use_id === 'dl_1');
  const saved = ((await chrome.storage.local.get('conversations')).conversations || []).map((c) => c.title);
  return { status: s.status, result: JSON.stringify(result?.content), cost: s.cost, windows: (await chrome.windows.getAll()).length, saved };
}, { tabId });
check('helpers: two at once, both answers back, their cost counted', del.status === 'done' && del.result.includes('Shop A: 10 SAR') && del.result.includes('Shop B: 12 SAR') && del.cost >= 0.29, JSON.stringify(del).slice(0, 400));
check('helpers: windows closed, not saved, cannot delegate further', del.windows === windowsBefore && !del.saved.some((t) => /^Helper/.test(t || '')) && Array.isArray(globalThis.HELPER_TOOLS) && !globalThis.HELPER_TOOLS.includes('delegate_tasks') && globalThis.HELPER_TOOLS.includes('export_file'), JSON.stringify({ w: [windowsBefore, del.windows], tools: globalThis.HELPER_TOOLS?.slice(-6) }));

// The advisor: Sonnet 5 does the work and may consult Opus 5.5.
requests.length = 0;
phase = 'plain';
await run('claude-sonnet-5[advisor]', { classic: false });
const adv = requests[0]?.body;
check('advisor: Sonnet 5 executor, Opus 5.5 advisor tool, beta and prompt note', adv?.model === 'claude-sonnet-5' && adv.tools[0]?.type === 'advisor_20260301' && adv.tools[0].model === 'claude-opus-5-5'
  && String(requests[0].headers['anthropic-beta']).includes('advisor-tool-2026-03-01') && JSON.stringify(adv.system).includes('You have an advisor'), JSON.stringify(adv?.tools?.[0]));

// Files: spreadsheets, Word documents, PDFs and CSVs built in the browser; skills saved.
const files = await sw.evaluate(async () => {
  const I = self.__infera;
  const ctx = { sessionId: 'f', mode: 'skip_all_permission_checks' };
  const x = await I.buildFile({ format: 'xlsx', filename: 'Prices', rows: [['المتجر', 'السعر'], ['A', 10], ['B', '12.5']] });
  const d = await I.buildFile({ format: 'docx', title: 'Report', content: '# تقرير\n\nالنص **مهم**.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two' });
  const c = await I.buildFile({ format: 'csv', content: '| a | b |\n|---|---|\n| 1 | "x" |' });
  const p = await I.buildFile({ format: 'pdf', title: 'PDF', content: '# Hello\n\nA table:\n\n| a | b |\n|---|---|\n| 1 | 2 |' });
  const saved = await I.executeTool('export_file', { format: 'md', filename: 'notes', content: '# Notes' }, ctx, { internal: true });
  const skill = await I.executeTool('skill_save', { command: 'daily-prices', prompt: 'Check the price of {{product}} at shop A', schedule: { frequency: 'daily', time: '08:30' } }, ctx, { internal: true });
  const all = await chrome.storage.local.get(null);
  const sc = Object.values(all).flat().find((v) => v && v.command === 'daily-prices');
  const sch = Object.values(all).flat().find((v) => v && v.name === '/daily-prices' && v.frequency);
  return { x: x.base64, d: d.base64, c: new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(atob(c.base64), (ch) => ch.charCodeAt(0))), p: p.base64.slice(0, 12), names: [x.filename, d.filename, p.filename], saved: saved.content[0].text, savedErr: !!saved.isError, skill: skill.content[0].text, sc, sch: !!sch?.nextRun };
});
const unzip = (b64) => {
  const r = spawnSync('python3', ['-I', '-c', 'import sys,zipfile,io,base64,json; z=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))); print(json.dumps({n: z.read(n).decode() for n in z.namelist()}))'], { input: b64, encoding: 'utf8' });
  return r.status === 0 ? JSON.parse(r.stdout) : { error: r.stderr };
};
const xz = unzip(files.x);
const dz = unzip(files.d);
const sheet = xz['xl/worksheets/sheet1.xml'] || '';
const docXml = dz['word/document.xml'] || '';
check('files: xlsx is a valid workbook, numbers as numbers, Arabic right to left', sheet.includes('rightToLeft="1"') && sheet.includes('<v>12.5</v>') && sheet.includes('المتجر'), JSON.stringify(xz).slice(0, 300));
check('files: docx with headings, bold, table, right to left', /Heading1/.test(docXml) && docXml.includes('<w:b/>') && docXml.includes('<w:tbl>') && docXml.includes('<w:bidi/>'), JSON.stringify(Object.keys(dz)));
check('files: pdf printed by Chrome, csv from a Markdown table', files.p.startsWith('JVBERi') && files.c.startsWith('﻿a,b') && files.c.includes('"""x"""') && files.names.join() === 'Prices.xlsx,Report.docx,PDF.pdf', JSON.stringify({ p: files.p, c: files.c, n: files.names }));
check('files: export_file saves to Downloads/Infera', !files.savedErr && /Saved notes.*\.md/.test(files.saved), files.saved);
check('skills: saved as /daily-prices with its {{product}} parameter and a daily schedule', files.sc?.params?.[0]?.name === 'product' && files.sch && /daily-prices/.test(files.skill), JSON.stringify(files.sc));

// History: searching conversations (this browser and the account).
const hist = await sw.evaluate(() => self.__infera.panelCall(null, { type: 'history_list', q: 'cheaper', paged: true }));
check('history: search finds a conversation by its content', Array.isArray(hist.items) && hist.items.length > 0 && hist.items.every((c) => /cheaper|shop/i.test(c.title || '')), JSON.stringify(hist).slice(0, 300));

// The account: the team's blocked sites apply here, and a task sent from the app is
// picked up, run in its own window, and its result reported back.
globalThis.ORG = { orgs: ['Acme Owner'], blocked: false, blockedBy: '', blocklist: ['crm.example'], memberDailyCap: 5 };
globalThis.TASKS = [{ id: 7, prompt: 'Say hello from the account', startUrl: '', status: 'queued' }];
requests.length = 0;
phase = 'plain';
const acct = await sw.evaluate(async () => {
  const I = self.__infera;
  await I.updateSettings({ model: 'claude-opus-5-5', permissionMode: 'skip_all_permission_checks' });
  await I.optionsCall({ type: 'org_policy' }); // the settings page refreshes the team's rules at once
  await I.accountTick();
  const c = await I.classifyUrl('https://app.crm.example/deals');
  const all = (await chrome.storage.local.get('conversations')).conversations || [];
  return { category: c.category, reason: c.reason, saved: all.some((x) => /^📱/.test(x.title || '')) };
});
check('team rules: a site the team blocked is blocked here, named after the team', acct.category === 'category_org_blocked' && /Acme Owner/.test(acct.reason), JSON.stringify(acct));
check('tasks from the account: taken, run in its own window, result reported', globalThis.TASK_LOG?.join() === '7:running,7:done' && /Hello again/.test(globalThis.TASKS[0].result || '') && globalThis.TASKS[0].conversationId && acct.saved, JSON.stringify({ log: globalThis.TASK_LOG, t: globalThis.TASKS[0] }).slice(0, 300));
const again = await sw.evaluate(() => self.__infera.accountTick());
check('tasks from the account: nothing new, nothing run', globalThis.TASK_LOG.length === 2, JSON.stringify(globalThis.TASK_LOG));
phase = 'normal';

// A task cut off mid-step (browser closed) continues cleanly from the history.
const resumed = await sw.evaluate(() => {
  const s = self.__infera.AgentSession.fromHistory({ id: 'cut-1', title: 'cut', messages: [
    { role: 'user', content: [{ type: 'text', text: 'do it' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_cut', name: 'computer', input: { action: 'screenshot' } }] }] }, null);
  return { status: s.status, last: s.messages.at(-1) };
});
check('interrupted task: open step closed, ready to continue', resumed.status === 'stopped' && resumed.last.role === 'user' && resumed.last.content[0].tool_use_id === 'tu_cut' && resumed.last.content[0].is_error === true, JSON.stringify(resumed).slice(0, 300));

// Long-term memory lives in the account: saved there, searched, and the newest
// and pinned are shown first; the rest are announced for memory_search.
const memo = await sw.evaluate(async () => {
  const I = self.__infera;
  const ctx = { memoryEnabled: true, sessionId: 'mem', mode: 'skip_all_permission_checks' };
  const saved = await I.executeTool('memory_save', { text: 'Company: Infera Engine Ltd, London', topic: 'work', pinned: true }, ctx, { internal: true });
  const found = await I.executeTool('memory_search', { query: 'infera london' }, ctx, { internal: true });
  return { saved: saved.content[0].text, found: found.content[0].text, isError: !!found.isError };
});
const inAccount = [...(globalThis.MEM?.values() || [])];
check('memory: saved in the account with topic and pin', inAccount.some((m) => m.text === 'Company: Infera Engine Ltd, London' && m.topic === 'work' && m.pinned === true), JSON.stringify(inAccount).slice(0, 300));
check('memory: memory_search finds it', !memo.isError && memo.found.includes('Infera Engine Ltd'), JSON.stringify(memo));
for (let i = 0; i < 40; i++) globalThis.MEM.set(`m_bulk${i}`, { id: `m_bulk${i}`, text: `Note ${i} ${'x'.repeat(1500)}`, topic: '', pinned: false, createdAt: i, updatedAt: i });
const memList = await sw.evaluate(() => self.__infera.optionsCall({ type: 'list_memory' }));
requests.length = 0;
phase = 'plain';
await run('claude-opus-5-5', { classic: false });
const firstMsg = JSON.stringify(requests[0]?.body.messages[0] || {});
check('memory: pinned first, older ones left to memory_search', memList.length >= 41 && memList[0].pinned === true && firstMsg.includes('Infera Engine Ltd') && firstMsg.includes('older memories are not shown'), `${memList.length} ${firstMsg.length}`);
phase = 'normal';

const op = await ctx.newPage();
await op.setViewportSize({ width: 900, height: 1200 });
op.on('pageerror', (e) => pageErrors.push(e.message));
await op.goto(`chrome-extension://${extId}/options/options.html`);
await op.waitForTimeout(800);
await op.screenshot({ path: path.join(outDir, 'options.png'), fullPage: true });
check('options page renders', (await op.locator('section.card').count()) >= 5);
check('settings: models & performance with the four operating modes and the section navigation',
  (await op.locator('#models .op-card').count()) === 4 && (await op.locator('#models .model-row').count()) >= 6 && (await op.locator('#nav .nav-link').count()) >= 8);
await op.locator('#models .op-card[data-op="balanced"]').click();
await op.waitForTimeout(500);
const opSet = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.operatingMode);
check('settings: choosing an operating mode saves it', opSet === 'balanced' && (await op.locator('#models .op-card.on').getAttribute('data-op')) === 'balanced', opSet);
await op.screenshot({ path: path.join(outDir, 'options-models.png') });
await sw.evaluate(() => self.__infera.updateSettings({ operatingMode: 'manual' }));
const about = await op.locator('#about').innerText().catch(() => '');
check('settings: the team applying its rules is shown', /Acme Owner/.test(await op.locator('#teamPolicy').innerText().catch(() => '')));
check('settings: the registered company (UK trading disclosure) and legal links', /Infera Engine Ltd/.test(about) && /17520775/.test(about) && /128 City Road/.test(about) && /ZC275369/.test(about) && /privacy@inferaengine\.com/.test(about)
  && (await op.locator('#about a[href="https://inferaagent.com/privacy"]').count()) === 1, about.slice(0, 300));
check('settings: no empty organization-policy card; version shown under About', (await op.locator('#policy').count()) === 0 && /v\d+\.\d+\.\d+/.test(about), about.slice(-120));
const sys0 = JSON.stringify(requests.length ? requests[0].body.system : '');
check('agent knows its company: Infera Engine Ltd, England and Wales, no. 17520775', /Infera Engine Ltd/.test(sys0) && /17520775/.test(sys0), sys0.slice(0, 200));

let fails = 0;
for (const c of checks) { if (!c.ok) fails++; console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.info ? `  (${c.info})` : ''}`); }
await ctx.close();
server.close();
console.log(fails ? `\n${fails} failure(s)` : '\nAll agent checks passed');
process.exit(fails ? 1 : 0);
