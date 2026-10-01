// Infera Agent — background service worker (the extension's "brain").
import { AgentSession } from './agent.js';
import { cdp, safeHost } from './cdp.js';
import { tabGroups } from './tab-groups.js';
import { permissions } from './permissions.js';
import { classifyUrl, isBlockedCategory, blockedPageUrl, clearDomainCache } from './domain-safety.js';
import { getSettings, updateSettings, getLocal, setLocal, getManagedPolicy } from './storage.js';
import { STORAGE_KEYS, MODELS, PERMISSION_MODES, VERSION } from './constants.js';
import { nativeBridge } from './native-bridge.js';
import { relay } from './relay.js';
import { mcpClients } from './mcp-host.js';
import { popupApproval, getApproval, answerApproval } from './approvals.js';
import { listShortcuts, saveShortcut, deleteShortcut, renderShortcut } from './shortcuts.js';
import { listTasks, saveTask, deleteTask, rearmAll, markRun, taskIdFromAlarm } from './scheduler.js';
import { startRecording, stopRecording, addStep, recordingState } from './recording.js';
import { signOut, authStatus, inferaSignIn, refreshInferaAccount, inferaServer, inferaUsage, inferaLimits, inferaConversations } from './auth.js';
import { spentToday } from './spend.js';
import { overlay } from './page.js';
import { executeTool } from './tools/executor.js';
import { listMemory, forgetMemory, clearMemory } from './memory.js';
import { listServers, saveServer, deleteServer } from './remote-mcp.js';

// ---------------- session registry ----------------
const sessions = new Map();        // sessionId -> AgentSession
const windowSession = new Map();   // windowId -> sessionId (side panel's current conversation)
const panelPorts = new Map();      // windowId -> Set<Port>

// Which conversation each window's side panel shows. Kept in session storage too:
// Chrome stops an idle service worker after a short while, and the panel must
// come back to the same conversation instead of a new one.
function rememberWindow(windowId, id) {
  windowSession.set(windowId, id);
  chrome.storage.session.get('windowSessions').then((r) => {
    chrome.storage.session.set({ windowSessions: { ...(r.windowSessions || {}), [windowId]: id } });
  }).catch(() => {});
}

async function sessionForWindow(windowId, { create = true } = {}) {
  let id = windowSession.get(windowId);
  let s = id && sessions.get(id);
  if (!s) {
    const saved = (await chrome.storage.session.get('windowSessions').catch(() => ({}))).windowSessions?.[windowId];
    if (saved) s = sessions.get(saved);
    if (!s && saved) {
      const entry = (await getLocal(STORAGE_KEYS.CONVERSATIONS, [])).find((c) => c.id === saved);
      if (entry) {
        s = AgentSession.fromHistory(entry, windowId);
        wireSession(s);
        sessions.set(s.id, s);
      }
    }
    if (s) windowSession.set(windowId, s.id);
  }
  if (!s && create) {
    s = new AgentSession({ kind: 'panel', windowId });
    wireSession(s);
    sessions.set(s.id, s);
    rememberWindow(windowId, s.id);
  }
  return s;
}

function wireSession(s) {
  s.runShortcut = async (shortcut) => {
    const next = new AgentSession({ kind: 'panel', windowId: s.windowId, title: `/${shortcut.command}` });
    wireSession(next);
    sessions.set(next.id, next);
    rememberWindow(s.windowId, next.id);
    attachPorts(next);
    broadcast(s.windowId, { type: 'session_switched', session: next.summary() });
    const [tab] = await chrome.tabs.query({ active: true, windowId: s.windowId });
    next.run(renderShortcut(shortcut), { startTabId: tab?.id }).catch(() => {});
    return `Started /${shortcut.command} in a new task.`;
  };
}

function attachPorts(s) {
  const ports = panelPorts.get(s.windowId);
  if (!ports) return;
  for (const p of ports) subscribePort(p, s);
}

const portUnsub = new WeakMap();
function subscribePort(port, s) {
  portUnsub.get(port)?.();
  portUnsub.set(port, s.subscribe((ev) => port.postMessage(ev)));
}

function broadcast(windowId, msg) {
  for (const p of panelPorts.get(windowId) || []) { try { p.postMessage(msg); } catch { /* closed */ } }
}

// ---------------- lifecycle ----------------
chrome.runtime.onInstalled.addListener(async (d) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await rearmAll();
  // First run: the side panel shows the Infera Agent sign-in; the settings page
  // is only needed when no Infera Agent server is built in.
  if (d.reason === 'install' && !(await inferaServer())) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => rearmAll());

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
nativeBridge.connect();
relay.start();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEYS.SETTINGS]) { relay.start(); clearDomainCache(); }
  if (area === 'managed') clearDomainCache();
});

// ---------------- side panel port ----------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  let windowId = null;
  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.type === 'init') {
        windowId = msg.windowId;
        if (!panelPorts.has(windowId)) panelPorts.set(windowId, new Set());
        panelPorts.get(windowId).add(port);
        const s = await sessionForWindow(windowId);
        subscribePort(port, s);
        port.postMessage({ type: 'init', ...(await panelState(s)) });
        return;
      }
      const s = await sessionForWindow(windowId);
      const reply = await handlePanel(msg, s, port);
      if (reply !== undefined) port.postMessage({ type: 'reply', requestId: msg.requestId, data: reply });
    } catch (e) {
      port.postMessage({ type: 'reply', requestId: msg.requestId, error: e.message });
    }
  });
  port.onDisconnect.addListener(() => {
    portUnsub.get(port)?.();
    panelPorts.get(windowId)?.delete(port);
  });
});

async function panelState(s) {
  const settings = await getSettings();
  const policy = await getManagedPolicy();
  return {
    session: s.summary(),
    messages: s.messages,
    pending: [],
    settings: { model: s.modelOverride || settings.model, permissionMode: s.modeOverride || settings.permissionMode, language: settings.language },
    canChangeServer: false,
    models: MODELS,
    modes: Object.values(PERMISSION_MODES).filter((m) => !(policy.disableSkipAllApprovals && m === PERMISSION_MODES.SKIP_ALL)),
    conversations: (await getLocal(STORAGE_KEYS.CONVERSATIONS, [])).map(({ id, title, updatedAt, status, kind }) => ({ id, title, updatedAt, status, kind })),
    shortcuts: await listShortcuts(),
    tasks: await listTasks(),
    auth: await authStatus(),
    recording: recordingState(),
    version: VERSION,
  };
}

// The Costs tab: the server's log (all devices) plus this browser's numbers.
async function costLog(days = 30) {
  const settings = await getSettings();
  const conversations = (await getLocal(STORAGE_KEYS.CONVERSATIONS, []))
    .filter((c) => c.cost > 0).map(({ id, title, cost, currency, updatedAt }) => ({ id, title, cost, currency, updatedAt }));
  let server = null;
  let error = null;
  let limits = null;
  try { server = await inferaUsage(days); } catch (e) { error = e.message; }
  try { limits = await inferaLimits(); } catch (e) { error = error || e.message; }
  return {
    server, error, limits, conversations, spentToday: await spentToday(),
    settings: { taskBudget: settings.taskBudget, dailyBudget: settings.dailyBudget, webResearch: settings.webResearch !== false, effort: settings.effort, model: settings.model },
  };
}

async function handlePanel(msg, s, port) {
  const windowId = s.windowId;
  switch (msg.type) {
    case 'send': {
      // While a task runs, a new message joins it: the agent reads it at its next step.
      if (s.status === 'running' || s.status === 'waiting') { s.enqueue(msg.text, msg.attachments || []); return { ok: true, queued: true }; }
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      s.run(msg.text, { attachments: msg.attachments || [], startTabId: tab?.id }).catch((e) => port.postMessage({ type: 'error', message: e.message }));
      return { ok: true };
    }
    case 'stop': s.stop(); return { ok: true };
    case 'permission_response':
    case 'plan_response':
      s.answer(msg.id, msg.answer); return { ok: true };
    case 'new_chat': {
      if (s.status === 'running' || s.status === 'waiting') s.stop();
      const n = new AgentSession({ kind: 'panel', windowId });
      wireSession(n);
      sessions.set(n.id, n);
      rememberWindow(windowId, n.id);
      subscribePort(port, n);
      return panelState(n);
    }
    case 'load_conversation': {
      let target = sessions.get(msg.id);
      if (!target) {
        let entry = (await getLocal(STORAGE_KEYS.CONVERSATIONS, [])).find((c) => c.id === msg.id);
        // Saved in the account from another device (or cleared from this browser).
        if (!entry) entry = await inferaConversations('get', msg.id).catch(() => null);
        if (!entry) throw new Error('Conversation not found');
        target = AgentSession.fromHistory(entry, windowId);
        wireSession(target);
        sessions.set(target.id, target);
      }
      rememberWindow(windowId, target.id);
      subscribePort(port, target);
      return panelState(target);
    }
    case 'delete_conversation': {
      const all = await getLocal(STORAGE_KEYS.CONVERSATIONS, []);
      await setLocal(STORAGE_KEYS.CONVERSATIONS, all.filter((c) => c.id !== msg.id));
      if (msg.id !== s.id) sessions.delete(msg.id);
      await inferaConversations('delete', msg.id).catch(() => {});
      return panelState(s);
    }
    case 'set_model': s.modelOverride = msg.model; await updateSettings({ model: msg.model }); return { ok: true };
    case 'set_mode': s.modeOverride = msg.mode; await updateSettings({ permissionMode: msg.mode }); return { ok: true };
    case 'save_shortcut': return saveShortcut(msg.shortcut);
    case 'delete_shortcut': await deleteShortcut(msg.id); return listShortcuts();
    case 'list_shortcuts': return listShortcuts();
    case 'run_shortcut': {
      const sc = (await listShortcuts()).find((x) => x.id === msg.id);
      if (!sc) throw new Error('Shortcut not found');
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      s.run(renderShortcut(sc, msg.values || {}), { startTabId: tab?.id }).catch((e) => port.postMessage({ type: 'error', message: e.message }));
      return { ok: true };
    }
    case 'save_task': return saveTask(msg.task);
    case 'delete_task': await deleteTask(msg.id); return listTasks();
    case 'list_tasks': return listTasks();
    case 'run_task_now': runScheduledTask(msg.id); return { ok: true };
    case 'start_recording': {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (!tab) throw new Error('No active tab');
      return startRecording(tab.id);
    }
    case 'stop_recording': return stopRecording({ transcript: msg.transcript || '' });
    case 'recording_state': return recordingState();
    case 'open_settings': chrome.runtime.openOptionsPage(); return { ok: true };
    case 'infera_sign_in': await inferaSignIn(); return panelState(s);
    case 'sign_out': await signOut(); return panelState(s);
    case 'refresh_account': await refreshInferaAccount(); return panelState(s);
    case 'state': return panelState(s);
    case 'cost_log': return costLog(msg.days);
    case 'history_list': {
      // This browser's conversations plus those saved in the account from other devices.
      const local = (await getLocal(STORAGE_KEYS.CONVERSATIONS, [])).map(({ id, title, updatedAt, status, kind, cost, currency }) => ({ id, title, updatedAt, status, kind, cost, currency }));
      const remote = (await getSettings()).syncHistory === false ? [] : await inferaConversations('list').catch(() => []);
      const byId = new Map(local.map((c) => [c.id, c]));
      for (const r of remote || []) if (!byId.has(r.id)) byId.set(r.id, { ...r, kind: 'panel', remote: true });
      return [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    case 'set_budgets': {
      const patch = {};
      if (msg.taskBudget !== undefined) patch.taskBudget = Math.max(0, Number(msg.taskBudget) || 0);
      // The daily limit lives on the server (shared with the app); this browser keeps no copy.
      if (msg.dailyBudget !== undefined) await inferaLimits(Math.max(0, Number(msg.dailyBudget) || 0)).catch(() => {});
      for (const k of ['webResearch']) if (msg[k] !== undefined) patch[k] = !!msg[k];
      if (['low', 'medium', 'high', 'xhigh', 'max'].includes(msg.effort)) patch.effort = msg.effort;
      await updateSettings(patch);
      return costLog(msg.days);
    }
    default: throw new Error(`Unknown panel message ${msg.type}`);
  }
}

// ---------------- one-shot messages (options page, content scripts, popups) ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  handleMessage(msg, sender).then(
    (data) => sendResponse({ data }),
    (e) => sendResponse({ error: e.message }),
  );
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'get_settings': return getSettings();
    case 'update_settings': return updateSettings(msg.patch || {});
    case 'get_policy': return getManagedPolicy();
    case 'list_permissions': return permissions.list();
    case 'revoke_permission': await permissions.revoke(msg.id); return permissions.list();
    case 'revoke_all_permissions': await permissions.revokeAll(); return [];
    case 'native_status': return nativeBridge.status();
    case 'native_reconnect': await nativeBridge.reconnect(); return nativeBridge.status();
    case 'relay_status': return relay.status();
    case 'auth_status': return authStatus();
    case 'sign_out': await signOut(); return authStatus();
    case 'infera_sign_in': return inferaSignIn();
    case 'refresh_account': return refreshInferaAccount();
    case 'classify': return classifyUrl(msg.url);
    case 'list_memory': return listMemory();
    case 'forget_memory': await forgetMemory(msg.id); return listMemory();
    case 'clear_memory': await clearMemory(); return [];
    case 'list_mcp_servers': return listServers();
    case 'save_mcp_server': await saveServer(msg.server); return listServers();
    case 'delete_mcp_server': await deleteServer(msg.id); return listServers();
    case 'APPROVAL_GET': return getApproval(msg.id);
    case 'APPROVAL_ANSWER': answerApproval(msg.id, msg.answer); return { ok: true };
    case 'RECORDER_STEP': if (sender.tab) await addStep(sender.tab.id, msg.step); return { ok: true };
    case 'OVERLAY_STOP':
    case 'OVERLAY_TAKE_CONTROL': {
      if (!sender.tab) return { ok: false };
      const sid = await tabGroups.sessionForTab(sender.tab.id);
      const s = sid && sessions.get(sid);
      if (s) s.stop();
      await overlay.hide(sender.tab.id);
      await cdp.detach(sender.tab.id);
      return { ok: true };
    }
    default: throw new Error(`Unknown message ${msg.type}`);
  }
}

// ---------------- keyboard command ----------------
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'stop-agent') for (const s of sessions.values()) if (s.status === 'running' || s.status === 'waiting') s.stop();
});

// ---------------- debugger banner cancelled by the user ----------------
cdp.onDetach(async (tabId, reason) => {
  if (reason !== 'canceled_by_user') return;
  const sid = await tabGroups.sessionForTab(tabId);
  const s = sid && sessions.get(sid);
  if (s && (s.status === 'running' || s.status === 'waiting')) s.stop();
});

// ---------------- navigation guard: blocked categories ----------------
chrome.webNavigation.onBeforeNavigate.addListener(async (d) => {
  if (d.frameId !== 0 || !/^https?:/.test(d.url)) return;
  const sid = await tabGroups.sessionForTab(d.tabId);
  if (!sid) return; // only tabs controlled by the agent
  const c = await classifyUrl(d.url);
  if (isBlockedCategory(c.category)) {
    await chrome.tabs.update(d.tabId, { url: blockedPageUrl(d.url, c.reason || c.category) });
  }
});

// ---------------- downloads always require confirmation ----------------
chrome.downloads.onCreated.addListener(async (item) => {
  if (item.byExtensionId === chrome.runtime.id) return; // our own exports (GIF, screenshots)
  const ref = safeHost(item.referrer || '') || safeHost(item.finalUrl || item.url);
  let owner = null;
  for (const s of sessions.values()) {
    if (s.status !== 'running' && s.status !== 'waiting') continue;
    const tabs = await tabGroups.tabs(s.id);
    if (tabs.some((t) => safeHost(t.url) === ref)) { owner = s; break; }
  }
  const mcpActive = !owner && [...mcpClients.values()].some((c) => Date.now() - c.lastSeen < 30_000);
  if (!owner && !mcpActive) return;
  try { await chrome.downloads.pause(item.id); } catch { /* already done */ }
  const req = {
    type: 'DOWNLOAD', permissionType: 'DOWNLOAD', netloc: ref, url: item.finalUrl || item.url,
    description: `Download "${(item.filename || item.finalUrl || '').split(/[\\/]/).pop()}" from ${ref}`, allowAlways: false,
    reason: 'Downloading files always requires your confirmation.',
  };
  const answer = owner ? await owner.requestApproval(req) : await popupApproval(req);
  if (answer === 'deny') chrome.downloads.cancel(item.id).catch(() => {});
  else chrome.downloads.resume(item.id).catch(() => {});
});

// ---------------- scheduled tasks ----------------
chrome.alarms.onAlarm.addListener((a) => {
  const id = taskIdFromAlarm(a.name);
  if (id) runScheduledTask(id);
});

async function runScheduledTask(id) {
  const task = (await listTasks()).find((t) => t.id === id);
  if (!task) return;
  const s = new AgentSession({ kind: 'scheduled', title: `⏰ ${task.name}` });
  wireSession(s);
  sessions.set(s.id, s);
  if (task.model) s.modelOverride = task.model;
  const win = await chrome.windows.create({ url: task.startUrl || 'about:blank', focused: false });
  s.windowId = win.id;
  await tabGroups.adoptTab(s.id, win.tabs[0].id, 'scheduled');
  await s.run(task.prompt, { startTabId: win.tabs[0].id }).catch(() => {});
  await markRun(id, s.status);
}

chrome.notifications.onClicked.addListener(async (nid) => {
  if (!nid.startsWith('infera-done:')) return;
  const s = sessions.get(nid.slice('infera-done:'.length));
  if (s?.windowId) chrome.windows.update(s.windowId, { focused: true }).catch(() => {});
  chrome.notifications.clear(nid);
});

// Clean agent state when a group's tabs go away.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await cdp.detach(tabId).catch(() => {});
});

// Test/debug hook (used by scripts/e2e.mjs; harmless in production).
self.__infera = {
  AgentSession, executeTool, tabGroups, permissions, sessions, sessionForWindow, nativeBridge, classifyUrl, getSettings, updateSettings,
  // A side-panel message without a panel (tests).
  panelCall: async (windowId, msg) => handlePanel(msg, await sessionForWindow(windowId), { postMessage() {} }),
};
