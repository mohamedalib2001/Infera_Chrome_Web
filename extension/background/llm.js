// Model client — Anthropic Messages API over raw HTTPS (fetch + SSE).
// The extension ships without a bundler, so the wire protocol is used directly.
// All requests go to the INFERA Agent gateway with the person's account token.
import { MODELS } from './constants.js';
import { getSettings } from './storage.js';
import { getModelAuth, handleInferaUnauthorized } from './auth.js';

const API_VERSION = '2023-06-01';
// Optional request features; each is dropped automatically (and remembered for
// this worker lifetime) if the endpoint rejects it with a 400.
const disabledFeatures = new Set();

export function modelInfo(id) {
  return MODELS.find((m) => m.id === id) || { id, label: id, thinking: 'adaptive' };
}

export function baseModelId(id) {
  return id.replace(/\[fast\]$/, '');
}

async function authHeaders(settings) {
  const h = {
    'content-type': 'application/json',
    'anthropic-version': API_VERSION,
  };
  // INFERA Agent gateway only: the session token authenticates the person, the
  // gateway checks their credits and adds the provider key server-side.
  const auth = await getModelAuth();
  h.authorization = `Bearer ${auth.token}`;
  return { headers: h, betas: [], baseUrl: auth.baseUrl, mode: 'infera' };
}

function buildBody({ model, system, messages, tools, maxTokens, effort, quick, stream = true }) {
  const info = modelInfo(model);
  const id = baseModelId(model);
  const betas = [];
  const body = { model: id, max_tokens: maxTokens ?? (stream ? 64000 : 16000), messages, stream };
  if (system) body.system = system;

  if (quick) {
    // Quick Mode: compact command language, no tool definitions.
    body.stop_sequences = ['\n<<END>>'];
    if (info.fast && !disabledFeatures.has('speed')) { body.speed = 'fast'; betas.push('fast-mode-2026-02-01'); }
  } else if (tools?.length) {
    body.tools = tools.map((t, i) => ({
      ...t,
      ...(stream && !disabledFeatures.has('eager_input_streaming') ? { eager_input_streaming: true } : {}),
      ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    }));
  }

  if (info.thinking === 'adaptive' || info.thinking === 'always') {
    body.thinking = { type: 'adaptive', display: 'summarized' };
  }
  if (info.thinking !== 'none' && effort && !disabledFeatures.has('output_config')) {
    body.output_config = { effort };
  }
  if ((id === 'claude-opus-5' || id === 'claude-fable-5-1') && !disabledFeatures.has('fallbacks')) {
    body.fallbacks = 'default';
    betas.push('server-side-fallback-2026-07-01');
  }
  if (!quick && !disabledFeatures.has('context_management')) {
    body.context_management = { edits: [{ type: 'clear_tool_uses_20250919' }] };
    betas.push('context-management-2025-06-27');
  }
  return { body, betas };
}

function featureFromError(msg) {
  for (const f of ['fallbacks', 'context_management', 'eager_input_streaming', 'speed', 'output_config']) {
    if (msg.includes(f)) return f;
  }
  return null;
}

async function post(path, reqBody, betas, signal) {
  const settings = await getSettings();
  const { headers, betas: authBetas, baseUrl, mode } = await authHeaders(settings);
  const allBetas = [...new Set([...authBetas, ...betas])];
  if (allBetas.length) headers['anthropic-beta'] = allBetas.join(',');
  const url = baseUrl.replace(/\/+$/, '') + path;
  let res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(reqBody), signal });
  if (mode === 'infera' && res.status === 401) {
    // Expired access token: refresh once and retry, otherwise ask to sign in again.
    if (await handleInferaUnauthorized()) return post(path, reqBody, betas, signal);
    throw new ApiError(401, 'authentication_error', 'Your INFERA Agent session has ended. Sign in again from the side panel.');
  }
  return res;
}

class ApiError extends Error {
  constructor(status, type, message) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

async function request(params, signal) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { body, betas } = buildBody(params);
    const res = await post('/v1/messages', body, betas, signal);
    if (res.ok) return res;
    let err = {};
    try { err = (await res.json()).error || {}; } catch { /* non-JSON */ }
    const msg = err.message || res.statusText;
    if (res.status === 402) throw new ApiError(402, 'billing_error', msg);
    if (res.status === 400) {
      const f = featureFromError(msg);
      if (f && !disabledFeatures.has(f)) { disabledFeatures.add(f); continue; }
    }
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (retryable && attempt < 3) {
      const ra = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, (ra > 0 ? ra * 1000 : 1500 * 2 ** attempt)));
      continue;
    }
    throw new ApiError(res.status, err.type || 'api_error', `API ${res.status}: ${msg}`);
  }
  throw new ApiError(0, 'api_error', 'Request failed after retries');
}

// Streams a message. onEvent receives {type:'text'|'thinking'|'tool_use_start'|'block_stop', ...}.
export async function streamMessage(params, { signal, onEvent = () => {} } = {}) {
  const res = await request({ ...params, stream: true }, signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const blocks = [];
  const partialJson = [];
  const msg = { content: blocks, stop_reason: null, stop_details: null, usage: {} };

  const handle = (event, data) => {
    switch (data.type) {
      case 'message_start':
        Object.assign(msg.usage, data.message.usage || {});
        msg.id = data.message.id;
        msg.model = data.message.model;
        break;
      case 'content_block_start': {
        const b = structuredClone(data.content_block);
        if (b.type === 'tool_use' || b.type === 'server_tool_use') { partialJson[data.index] = ''; b.input = {}; }
        blocks[data.index] = b;
        onEvent({ type: 'block_start', index: data.index, block: b });
        break;
      }
      case 'content_block_delta': {
        const b = blocks[data.index];
        const d = data.delta;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; onEvent({ type: 'text', index: data.index, text: d.text }); }
        else if (d.type === 'thinking_delta') { b.thinking = (b.thinking || '') + d.thinking; onEvent({ type: 'thinking', index: data.index, text: d.thinking }); }
        else if (d.type === 'signature_delta') { b.signature = (b.signature || '') + d.signature; }
        else if (d.type === 'input_json_delta') { partialJson[data.index] += d.partial_json; }
        else if (d.type === 'citations_delta') { (b.citations ||= []).push(d.citation); }
        break;
      }
      case 'content_block_stop': {
        const b = blocks[data.index];
        if (partialJson[data.index] !== undefined) {
          const raw = partialJson[data.index];
          try { b.input = raw ? JSON.parse(raw) : {}; }
          catch { b.input = {}; b._invalidJson = raw; }
        }
        onEvent({ type: 'block_stop', index: data.index, block: b });
        break;
      }
      case 'message_delta':
        if (data.delta?.stop_reason) msg.stop_reason = data.delta.stop_reason;
        if (data.delta?.stop_details) msg.stop_details = data.delta.stop_details;
        Object.assign(msg.usage, data.usage || {});
        break;
      case 'error':
        throw new ApiError(0, data.error?.type || 'stream_error', data.error?.message || 'Stream error');
      default:
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      const dataLines = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      let data;
      try { data = JSON.parse(dataLines.join('\n')); } catch { continue; }
      handle(event, data);
    }
  }
  // Drop empty placeholders (sparse indices) but keep block order.
  msg.content = blocks.filter(Boolean);
  return msg;
}

// Small non-streaming helper call (find tool, safety checker, step descriptions).
export async function completeText({ model, system, prompt, maxTokens = 800, signal }) {
  const res = await request({
    model, system, messages: [{ role: 'user', content: prompt }], maxTokens, stream: false,
  }, signal);
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('The helper model declined this request.');
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Minimal JSON-schema validation of tool inputs (eager input streaming means the
// API no longer validates for us).
export function validateInput(schema, input) {
  if (!schema || schema.type !== 'object') return null;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'input must be an object';
  for (const r of schema.required || []) if (input[r] === undefined) return `missing required property "${r}"`;
  for (const [k, v] of Object.entries(input)) {
    const p = schema.properties?.[k];
    if (!p) continue;
    const types = Array.isArray(p.type) ? p.type : p.type ? [p.type] : null;
    if (types) {
      const actual = Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v;
      const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
      if (!ok) return `property "${k}" must be ${types.join('|')}`;
    }
    if (p.enum && !p.enum.includes(v)) return `property "${k}" must be one of ${p.enum.join(', ')}`;
    if (typeof v === 'number') {
      if (p.minimum !== undefined && v < p.minimum) return `property "${k}" must be >= ${p.minimum}`;
      if (p.maximum !== undefined && v > p.maximum) return `property "${k}" must be <= ${p.maximum}`;
    }
  }
  return null;
}

export { ApiError };
