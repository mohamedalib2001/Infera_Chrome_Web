// Cloud bridge: lets cloud-hosted agent sessions (Infera Cowork-style sessions
// running in a remote sandbox) drive this browser. The extension registers
// itself with a relay over WebSocket; the relay forwards tool requests from
// paired sessions. See bridge-relay/ for the reference relay server.
//
// Protocol (JSON text frames):
//   ext -> relay: {type:"register", browserId, name, extensionVersion, token?, tools:[...]}
//                 {type:"tool_response", id, result|error} | {type:"heartbeat"}
//   relay -> ext: {type:"registered"} | {type:"tool_request", id, params:{tool,args,client_id,tabId}}
//                 {type:"pair_request", sessionId, code} | {type:"error", message}
import { RELAY_HEARTBEAT_MS, VERSION } from './constants.js';
import { getSettings, getLocal, setLocal } from './storage.js';
import { getAccessToken } from './auth.js';
import { handleToolRequest, listMcpTools } from './mcp-host.js';

class RelayClient {
  constructor() {
    this.ws = null;
    this.state = 'off';
    this.heartbeat = null;
    this.retry = 2000;
    this.lastError = '';
  }

  async browserId() {
    let id = await getLocal('browserId', null);
    if (!id) { id = crypto.randomUUID(); await setLocal('browserId', id); }
    return id;
  }

  status() { return { state: this.state, lastError: this.lastError }; }

  async start() {
    const s = await getSettings();
    if (!s.relayEnabled || !s.relayUrl) { this.stop(); return; }
    if (this.ws && this.ws.readyState <= 1) return;
    this.state = 'connecting';
    let ws;
    try { ws = new WebSocket(s.relayUrl); } catch (e) { this.lastError = e.message; this.state = 'error'; return this.#later(); }
    this.ws = ws;
    ws.onopen = async () => {
      const info = await chrome.runtime.getPlatformInfo();
      ws.send(JSON.stringify({
        type: 'register', browserId: await this.browserId(), name: `Chrome on ${info.os}`, extensionVersion: VERSION,
        token: (await getAccessToken()) || undefined, tools: listMcpTools(),
      }));
      this.heartbeat = setInterval(() => { try { ws.send('{"type":"heartbeat"}'); } catch { /* closed */ } }, RELAY_HEARTBEAT_MS);
    };
    ws.onmessage = async (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'registered') { this.state = 'connected'; this.retry = 2000; }
      else if (m.type === 'error') { this.lastError = m.message; }
      else if (m.type === 'pair_request') {
        chrome.notifications.create(`infera-pair:${m.sessionId}`, {
          type: 'basic', iconUrl: 'icons/icon128.png', title: 'Infera Agent — connect a cloud session?',
          message: `A cloud session wants to use this browser. Pairing code: ${m.code}`, buttons: [{ title: 'Connect' }, { title: 'Reject' }], requireInteraction: true,
        });
      } else if (m.type === 'tool_request') {
        const res = await handleToolRequest(m.params || {}, 'relay').catch((e) => ({ error: { content: [{ type: 'text', text: e.message }] } }));
        try { ws.send(JSON.stringify({ type: 'tool_response', id: m.id, ...res })); } catch { /* closed */ }
      }
    };
    ws.onclose = () => { clearInterval(this.heartbeat); if (this.state !== 'off') { this.state = 'disconnected'; this.#later(); } };
    ws.onerror = () => { this.lastError = 'WebSocket error (check the relay URL / IP allowlists)'; };
  }

  pairAnswer(sessionId, accept) {
    try { this.ws?.send(JSON.stringify({ type: 'pair_response', sessionId, accept })); } catch { /* closed */ }
  }

  #later() {
    setTimeout(() => this.start(), this.retry);
    this.retry = Math.min(this.retry * 2, 60_000);
  }

  stop() {
    this.state = 'off';
    clearInterval(this.heartbeat);
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}

export const relay = new RelayClient();

chrome.notifications.onButtonClicked.addListener((nid, btn) => {
  if (!nid.startsWith('infera-pair:')) return;
  relay.pairAnswer(nid.slice('infera-pair:'.length), btn === 0);
  chrome.notifications.clear(nid);
});
