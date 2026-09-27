// Native Messaging bridge to Infera Desktop / Infera Code (or any MCP client
// using the bundled infera-mcp-server). Hosts are tried in a fixed order; the
// first to answer ping with pong inside 10 s is kept.
//
// Envelope (JSON over Chrome native messaging):
//   ext  -> host : {type:"ping"} | {type:"tool_response", id, result|error} | {type:"status", ...}
//   host -> ext  : {type:"pong"} | {type:"get_status", id}
//                  {type:"tool_request", id, method:"execute_tool", params:{tool,args,tabGroupId,tabId,client_id}}
//                  {type:"list_tools", id}
//                  {type:"mcp_connected", client_id} | {type:"mcp_disconnected", client_id}
import { NATIVE_HOSTS, NATIVE_PING_TIMEOUT_MS, NATIVE_RECONNECT_BASE_MS, NATIVE_RECONNECT_MAX_MS, VERSION } from './constants.js';
import { handleToolRequest, listMcpTools, mcpClients } from './mcp-host.js';

class NativeBridge {
  constructor() {
    this.port = null;
    this.host = null;
    this.state = 'disconnected'; // disconnected | connecting | connected | unavailable
    this.backoff = NATIVE_RECONNECT_BASE_MS;
    this.timer = null;
    this.lastError = '';
    this.preferred = null; // user-selected host name, else fixed order
  }

  status() {
    return { state: this.state, host: this.host, lastError: this.lastError, clients: [...mcpClients.entries()].map(([id, c]) => ({ id, ...c })) };
  }

  async connect() {
    if (this.state === 'connecting' || this.state === 'connected') return;
    this.state = 'connecting';
    const order = this.preferred ? [this.preferred, ...NATIVE_HOSTS.filter((h) => h !== this.preferred)] : NATIVE_HOSTS;
    for (const name of order) {
      const port = await this.#tryHost(name);
      if (port) {
        this.port = port;
        this.host = name;
        this.state = 'connected';
        this.lastError = '';
        this.backoff = NATIVE_RECONNECT_BASE_MS;
        port.onMessage.addListener((m) => this.#onMessage(m));
        port.onDisconnect.addListener(() => this.#onDisconnect());
        this.#send({ type: 'status', extensionId: chrome.runtime.id, version: VERSION, tools: listMcpTools().map((t) => t.name) });
        return;
      }
    }
    this.state = 'unavailable';
    this.#scheduleReconnect();
  }

  #tryHost(name) {
    return new Promise((resolve) => {
      let port;
      try { port = chrome.runtime.connectNative(name); } catch (e) { this.lastError = e.message; return resolve(null); }
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        port.onMessage.removeListener(onMsg);
        port.onDisconnect.removeListener(onDisc);
        if (!ok) { try { port.disconnect(); } catch { /* ignore */ } }
        resolve(ok ? port : null);
      };
      const onMsg = (m) => { if (m?.type === 'pong') finish(true); };
      const onDisc = () => { this.lastError = chrome.runtime.lastError?.message || 'disconnected'; finish(false); };
      const t = setTimeout(() => { this.lastError = `${name}: no pong within ${NATIVE_PING_TIMEOUT_MS / 1000}s`; finish(false); }, NATIVE_PING_TIMEOUT_MS);
      port.onMessage.addListener(onMsg);
      port.onDisconnect.addListener(onDisc);
      try { port.postMessage({ type: 'ping' }); } catch { finish(false); }
    });
  }

  #onDisconnect() {
    this.lastError = chrome.runtime.lastError?.message || 'Native host disconnected';
    this.port = null;
    this.state = 'disconnected';
    mcpClients.clear();
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, NATIVE_RECONNECT_MAX_MS);
  }

  reconnect() {
    clearTimeout(this.timer);
    try { this.port?.disconnect(); } catch { /* ignore */ }
    this.port = null;
    this.state = 'disconnected';
    this.backoff = NATIVE_RECONNECT_BASE_MS;
    return this.connect();
  }

  #send(m) {
    try { this.port?.postMessage(m); } catch { /* port closed */ }
  }

  async #onMessage(m) {
    if (m?.type === 'chunk') {
      // Host -> extension messages are limited to 1 MB, so large requests
      // (e.g. file_upload contents) arrive in ordered chunks.
      this.chunks ||= new Map();
      const c = this.chunks.get(m.id) || { parts: new Array(m.total), got: 0 };
      if (c.parts[m.seq] === undefined) { c.parts[m.seq] = m.data; c.got++; }
      this.chunks.set(m.id, c);
      if (c.got < m.total) return;
      this.chunks.delete(m.id);
      try { m = JSON.parse(c.parts.join('')); } catch { return; }
    }
    switch (m?.type) {
      case 'ping': this.#send({ type: 'pong' }); break;
      case 'get_status': this.#send({ type: 'status', id: m.id, extensionId: chrome.runtime.id, version: VERSION, ...this.status() }); break;
      case 'list_tools': this.#send({ type: 'tools', id: m.id, tools: listMcpTools() }); break;
      case 'mcp_connected': mcpClients.set(m.client_id, { connectedAt: Date.now(), lastSeen: Date.now(), via: 'native' }); break;
      case 'mcp_disconnected': mcpClients.delete(m.client_id); break;
      case 'tool_request': {
        if (m.method && m.method !== 'execute_tool') { this.#send({ type: 'tool_response', id: m.id, error: { content: [{ type: 'text', text: `Unknown method ${m.method}` }] } }); break; }
        const res = await handleToolRequest(m.params || {}, 'native').catch((e) => ({ error: { content: [{ type: 'text', text: e.message }] } }));
        this.#send({ type: 'tool_response', id: m.id, ...res });
        break;
      }
      default:
    }
  }
}

export const nativeBridge = new NativeBridge();
