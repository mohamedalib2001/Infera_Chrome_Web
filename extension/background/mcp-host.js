// Executes tool requests coming from external MCP clients (via the native
// messaging host or the cloud relay). Each client_id gets its own tab group.
import { executeTool } from './tools/executor.js';
import { MCP_TOOLS } from './tools/definitions.js';
import { getSettings } from './storage.js';
import { popupApproval } from './approvals.js';
import { tabGroups } from './tab-groups.js';
import { cdp } from './cdp.js';

const MCP_NAMES = new Set(MCP_TOOLS.map((t) => t.name));
const idleTimers = new Map();
const IDLE_DETACH_MS = 5 * 60_000;
export const mcpClients = new Map(); // client_id -> {connectedAt, lastSeen, via}

function toMcpContent(content) {
  return content.map((b) => (b.type === 'image'
    ? { type: 'image', data: b.source.data, mimeType: b.source.media_type }
    : { type: 'text', text: b.text }));
}

function scheduleIdleDetach(sessionId) {
  clearTimeout(idleTimers.get(sessionId));
  idleTimers.set(sessionId, setTimeout(async () => {
    for (const t of await tabGroups.tabs(sessionId)) await cdp.detach(t.tabId);
    await tabGroups.setStatus(sessionId, 'idle');
  }, IDLE_DETACH_MS));
}

export function listMcpTools() {
  return MCP_TOOLS.map(({ name, description, input_schema }) => ({ name, description, inputSchema: input_schema }));
}

export async function handleToolRequest({ tool, args = {}, client_id = 'default', tabId }, via = 'native') {
  if (!MCP_NAMES.has(tool)) return { error: { content: [{ type: 'text', text: `Unknown tool: ${tool}` }] } };
  const policy = await chrome.storage.managed.get(null).catch(() => ({}));
  if (policy.enabled === false) return { error: { content: [{ type: 'text', text: 'Infera Agent is disabled by your organization.' }] } };
  const settings = await getSettings();
  const sessionId = `mcp:${client_id}`;
  mcpClients.set(client_id, { ...(mcpClients.get(client_id) || { connectedAt: Date.now() }), lastSeen: Date.now(), via });
  if (tabId !== undefined && args.tabId === undefined && tool !== 'tabs_context_mcp' && tool !== 'tabs_create_mcp') args.tabId = tabId;
  await tabGroups.setStatus(sessionId, 'working');
  const r = await executeTool(tool, args, {
    sessionId,
    kind: 'mcp',
    mode: settings.permissionMode,
    task: '(request from an external MCP client — the user\'s instructions are not visible here)',
    toolUseId: crypto.randomUUID(),
    safetyChecker: settings.safetyChecker,
    requestApproval: (req) => popupApproval({
      permissionType: req.type, netloc: req.netloc, url: req.url, description: req.description,
      allowAlways: req.allowAlways, reason: req.reason, tabTitle: req.tabTitle, client: client_id,
    }),
    approvePlan: null,
    runShortcut: null,
  });
  scheduleIdleDetach(sessionId);
  const content = toMcpContent(r.content);
  return r.isError ? { error: { content } } : { result: { content } };
}
