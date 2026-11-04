// Learning by doing: while the agent works, the actions it takes on pages are kept as
// semantic steps (the element's CSS path and accessible name, not screen coordinates) in
// the same format as a recorded workflow. A task that went well can then be saved as a
// workflow that fast replay runs again without the model; a replay the agent had to finish
// is repaired with the steps the agent took.
const traces = new Map(); // sessionId -> { steps, tabs:Set }
const MAX = 300;

export function startTrace(sessionId, startUrl) {
  traces.set(sessionId, { steps: /^https?:/.test(startUrl || '') ? [{ action: 'navigate', url: startUrl }] : [], tabs: new Set() });
}

const target = (d) => (d ? { tag: d.tag, role: d.role || '', name: String(d.name || '').slice(0, 100), selector: d.selector || '', type: d.type || '' } : null);

/** One action the agent took on a page; consecutive typing into one field is merged. */
export function traceStep(sessionId, tabId, step) {
  const t = traces.get(sessionId);
  if (!t || t.steps.length >= MAX) return;
  if (tabId != null) t.tabs.add(tabId);
  const s = { ...step, target: target(step.target) };
  if (!s.target) delete s.target;
  if (s.sensitive) { s.value = '<redacted>'; delete s.sensitive; }
  const last = t.steps[t.steps.length - 1];
  if (s.action === 'type' && step.append && last?.action === 'type' && last.target?.selector === s.target?.selector && last.value !== '<redacted>') {
    last.value = `${last.value}${s.value}`;
    return;
  }
  t.steps.push(s);
}

/**
 * The steps so far. usable = enough page actions in a single tab to replay (navigation alone
 * or a task spread over several tabs is not a workflow).
 */
export function peekTrace(sessionId) {
  const t = traces.get(sessionId);
  if (!t) return { steps: [], usable: false };
  const actions = t.steps.filter((s) => s.action !== 'navigate').length;
  return { steps: t.steps.map((s) => ({ ...s })), usable: actions >= 2 && t.tabs.size <= 1 && t.steps.every((s) => s.action !== 'navigate' || /^https?:/.test(s.url)) };
}

export function endTrace(sessionId) {
  const r = peekTrace(sessionId);
  traces.delete(sessionId);
  return r;
}
