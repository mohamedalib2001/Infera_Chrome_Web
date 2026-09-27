// Helpers for talking to the injected page agent and the overlay.

export async function ensureInjected(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => !!(window.__inferaPageAgent && window.__inferaOverlay),
  }).catch(() => [{ result: false }]);
  if (result) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/page-agent.js', 'content/overlay.js'] });
}

export async function callPage(tabId, fn, ...args) {
  await ensureInjected(tabId);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (name, a) => {
      const f = window[name];
      if (typeof f !== 'function') return { __error: `page helper ${name} missing` };
      return f(...a);
    },
    args: [fn, args],
  });
  if (res?.result?.__error) throw new Error(res.result.__error);
  return res?.result;
}

async function overlayMsg(tabId, type, extra = {}) {
  try { await chrome.tabs.sendMessage(tabId, { type, ...extra }); } catch { /* not injected / restricted page */ }
}

export const overlay = {
  show: (tabId, text) => overlayMsg(tabId, 'SHOW_AGENT_INDICATOR', { text }),
  hide: (tabId) => overlayMsg(tabId, 'HIDE_AGENT_INDICATOR'),
  done: (tabId) => overlayMsg(tabId, 'AGENT_DONE_INDICATOR'),
  hideForTool: (tabId) => overlayMsg(tabId, 'HIDE_FOR_TOOL_USE'),
  showAfterTool: (tabId) => overlayMsg(tabId, 'SHOW_AFTER_TOOL_USE'),
};

export function waitForLoad(tabId, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); resolve(); };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const t = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') setTimeout(finish, 50); }).catch(finish);
  });
}
