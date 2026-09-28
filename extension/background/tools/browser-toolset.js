// Anthropic's browser use toolset (browser_toolset_20260801). Current models are
// trained on this exact tool surface, so it is offered instead of our own
// browsing tools whenever the model supports it. Each member call is mapped onto
// the existing executor, so permissions, domain safety, the tab-group boundary,
// the overlay and GIF recording all behave exactly as with the classic tools.
//
// tool_use:    { type:'tool_use', id, name:<member>, toolset_name:'browser', input }
// tool_result: { type:'tool_result', tool_use_id, toolset_name:'browser', content:[text|image|browser_state], is_error? }
import { executeTool } from './executor.js';
import { tabGroups } from '../tab-groups.js';

export const TOOLSET_NAME = 'browser';

// file_upload stays off: it takes local file paths, which an extension cannot read.
export const BROWSER_TOOLSET = {
  type: 'browser_toolset_20260801',
  configs: {
    javascript_exec: { enabled: true },
    read_console: { enabled: true },
    read_network: { enabled: true },
  },
};

// Classic tools the toolset replaces (the rest — plan, shortcuts, GIFs, image
// upload, window size — are still offered next to it).
export const REPLACED_TOOLS = new Set([
  'tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp', 'navigate', 'computer', 'read_page', 'find',
  'form_input', 'get_page_text', 'javascript_tool', 'read_console_messages', 'read_network_requests',
  'file_upload', 'browser_batch', 'tabs_context', 'tabs_create',
]);

export const isToolsetUse = (b) => b?.type === 'tool_use' && b.toolset_name === TOOLSET_NAME;

const TAB_MEMBERS = new Set(['new_tab', 'list_tabs', 'switch_tab', 'close_tab']);
const text = (t) => ({ type: 'text', text: t });

// Per-session view of the tab group as last reported to the model.
const current = new Map(); // sessionId -> tabId the model is working in
const reported = new Map(); // sessionId -> Set of tabIds already reported

function clean(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 4096);
}

async function browserState(sessionId, opened = []) {
  const tabs = (await tabGroups.tabs(sessionId)).slice(0, 100);
  let active = current.get(sessionId);
  if (!tabs.some((t) => t.tabId === active)) active = (tabs.find((t) => t.active) || tabs[0])?.tabId;
  if (active !== undefined) current.set(sessionId, active);
  const seen = reported.get(sessionId) || new Set();
  const changes = [];
  for (const t of tabs) {
    if (!seen.has(t.tabId) && (seen.size || opened.includes(t.tabId))) changes.push({ type: 'tab_opened', tab_id: String(t.tabId) });
  }
  reported.set(sessionId, new Set(tabs.map((t) => t.tabId)));
  return {
    type: 'browser_state',
    tabs: tabs.map((t) => ({ tab_id: String(t.tabId), title: clean(t.title), url: clean(t.url), ...(t.tabId === active ? { active: true } : {}) })),
    ...(changes.length ? { state_changes: changes.slice(0, 200) } : {}),
  };
}

async function tabFor(sessionId, tabIdArg) {
  if (tabIdArg !== undefined && tabIdArg !== null && tabIdArg !== '') {
    const id = Number(tabIdArg);
    if (!Number.isInteger(id)) throw new Error(`Invalid tab_id "${tabIdArg}". Use a tab_id from browser_state.`);
    current.set(sessionId, id);
    return id;
  }
  const tabs = await tabGroups.tabs(sessionId);
  const cur = current.get(sessionId);
  if (tabs.some((t) => t.tabId === cur)) return cur;
  const t = tabs.find((x) => x.active) || tabs[0];
  if (!t) throw new Error('There are no tabs in your tab group. Call new_tab first.');
  current.set(sessionId, t.tabId);
  return t.tabId;
}

// Browser toolset Target -> the executor's ref / coordinate input.
function target(t) {
  if (!t || typeof t !== 'object') return {};
  if (t.type === 'ref') return { ref: t.ref };
  if (t.type === 'coordinate') return { coordinate: [t.x, t.y] };
  return {};
}

// Maps one member call onto [toolName, input] for the executor.
function mapMember(name, i, tabId) {
  switch (name) {
    case 'navigate': return ['navigate', { url: i.url, tabId }];
    case 'screenshot': return ['computer', { action: 'screenshot', tabId }];
    case 'zoom': return ['computer', { action: 'zoom', region: i.region, tabId }];
    case 'left_click': case 'right_click': case 'middle_click': case 'double_click': case 'triple_click':
      return ['computer', { action: name, ...target(i.target), ...(i.modifiers ? { modifiers: i.modifiers } : {}), tabId }];
    case 'hover': return ['computer', { action: 'hover', ...target(i.target), tabId }];
    case 'mouse_move': case 'left_mouse_down': case 'left_mouse_up':
      return ['computer', { action: name, ...target(i.target), tabId }];
    case 'left_click_drag':
      return ['computer', { action: 'left_click_drag', start_coordinate: [i.from?.x, i.from?.y], coordinate: [i.target?.x, i.target?.y], tabId }];
    case 'scroll':
      return ['computer', { action: 'scroll', ...target(i.target), scroll_direction: i.scroll_direction, scroll_amount: i.scroll_amount ?? 3, tabId }];
    case 'scroll_to': return ['computer', { action: 'scroll_to', ...target(i.target), tabId }];
    case 'type': return ['computer', { action: 'type', text: i.text, tabId }];
    case 'key': return ['computer', { action: 'key', text: i.text, repeat: i.repeat ?? 1, tabId }];
    case 'hold_key': return ['computer', { action: 'hold_key', text: i.text, duration: i.duration, tabId }];
    case 'wait': return ['computer', { action: 'wait', duration: i.duration, tabId }];
    case 'read_page':
      return ['read_page', { filter: i.filter === 'interactive' ? 'interactive' : 'all', ...(i.depth ? { depth: i.depth } : {}), ...(i.ref ? { ref_id: i.ref } : {}), max_chars: 50_000, tabId }];
    case 'find': return ['find', { query: i.query, tabId }];
    case 'get_page_text': return ['get_page_text', { tabId }];
    case 'form_input': return ['form_input', { ...target(i.target), value: i.value, tabId }];
    case 'read_console': return ['read_console_messages', { tabId }];
    case 'read_network': return ['read_network_requests', { tabId }];
    case 'javascript_exec': return ['javascript_tool', { action: 'javascript_exec', text: i.text, tabId }];
    default: return null;
  }
}

async function tabMember(name, i, ctx) {
  const sid = ctx.sessionId;
  switch (name) {
    case 'new_tab': {
      const tab = await tabGroups.createTab(sid, 'about:blank', ctx.kind === 'mcp' ? 'mcp' : ctx.kind === 'scheduled' ? 'scheduled' : 'panel');
      current.set(sid, tab.id);
      return browserState(sid, [tab.id]);
    }
    case 'list_tabs': return browserState(sid);
    case 'switch_tab': {
      const id = Number(i.tab_id);
      await tabGroups.assertInGroup(sid, id);
      await chrome.tabs.update(id, { active: true });
      current.set(sid, id);
      return browserState(sid);
    }
    case 'close_tab': {
      const id = Number(i.tab_id);
      await tabGroups.closeTab(sid, id);
      if (current.get(sid) === id) current.delete(sid);
      return browserState(sid);
    }
    default: return null;
  }
}

// Runs one member call. Returns { content, isError } in executor form.
export async function executeMember(u, ctx) {
  const i = u.input || {};
  try {
    if (TAB_MEMBERS.has(u.name)) return { content: [await tabMember(u.name, i, ctx)] };
    const tabId = await tabFor(ctx.sessionId, i.tab_id);
    const call = mapMember(u.name, i, tabId);
    if (!call) return { content: [text(`The browser action "${u.name}" is not available in INFERA Agent.`)], isError: true };
    const r = await executeTool(call[0], call[1], ctx, { internal: true });
    if (r.isError) return r;
    return { content: [...r.content, await browserState(ctx.sessionId)] };
  } catch (e) {
    return { content: [text(e?.message || String(e))], isError: true };
  }
}

export function toolsetResult(u, r) {
  return {
    type: 'tool_result', tool_use_id: u.id, toolset_name: TOOLSET_NAME,
    content: r.content, ...(r.isError ? { is_error: true } : {}),
  };
}

export function notExecuted(u) {
  return toolsetResult(u, { content: [text('Not executed: an earlier action in this turn failed.')], isError: true });
}

export function forgetSession(sessionId) {
  current.delete(sessionId);
  reported.delete(sessionId);
}
