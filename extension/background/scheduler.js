// Scheduled tasks on top of chrome.alarms (alarms survive service-worker idle).
// Frequencies: once | daily | weekly | monthly | annually.
import { STORAGE_KEYS } from './constants.js';
import { getLocal, setLocal, uuid } from './storage.js';

const PREFIX = 'infera-task:';

export async function listTasks() {
  return getLocal(STORAGE_KEYS.SCHEDULES, []);
}

// Next occurrence strictly after `from`.
export function nextRun(task, from = Date.now()) {
  const [hh, mm] = String(task.time || '09:00').split(':').map(Number);
  const base = new Date(from);
  const at = (d) => { const x = new Date(d); x.setHours(hh, mm, 0, 0); return x; };
  let d = at(base);
  switch (task.frequency) {
    case 'once': {
      const x = task.date ? new Date(`${task.date}T${task.time || '09:00'}`) : d;
      return x.getTime() > from ? x.getTime() : null;
    }
    case 'daily':
      if (d.getTime() <= from) d.setDate(d.getDate() + 1);
      return d.getTime();
    case 'weekly': {
      const dow = Number(task.dayOfWeek ?? 1);
      let add = (dow - d.getDay() + 7) % 7;
      if (add === 0 && d.getTime() <= from) add = 7;
      d.setDate(d.getDate() + add);
      return d.getTime();
    }
    case 'monthly': {
      const dom = Number(task.dayOfMonth ?? 1);
      for (let i = 0; i < 14; i++) {
        const c = new Date(base.getFullYear(), base.getMonth() + i, 1, hh, mm);
        const last = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
        c.setDate(Math.min(dom, last));
        if (c.getTime() > from) return c.getTime();
      }
      return null;
    }
    case 'annually': {
      const month = Number(task.month ?? 0);
      const dom = Number(task.dayOfMonth ?? 1);
      for (let i = 0; i < 3; i++) {
        const c = new Date(base.getFullYear() + i, month, dom, hh, mm);
        if (c.getTime() > from) return c.getTime();
      }
      return null;
    }
    default:
      return null;
  }
}

async function arm(task) {
  await chrome.alarms.clear(PREFIX + task.id);
  if (!task.enabled) return task;
  const when = nextRun(task);
  task.nextRun = when;
  if (when) await chrome.alarms.create(PREFIX + task.id, { when });
  return task;
}

export async function saveTask(t) {
  if (!t.prompt?.trim()) throw new Error('Task prompt is required');
  if (!['once', 'daily', 'weekly', 'monthly', 'annually'].includes(t.frequency)) throw new Error('Invalid frequency');
  const all = await listTasks();
  const task = await arm({
    id: t.id || uuid(),
    name: t.name || t.prompt.slice(0, 50),
    prompt: t.prompt,
    startUrl: t.startUrl || '',
    frequency: t.frequency,
    time: t.time || '09:00',
    date: t.date || '',
    dayOfWeek: t.dayOfWeek ?? 1,
    dayOfMonth: t.dayOfMonth ?? 1,
    month: t.month ?? 0,
    model: t.model || '',
    enabled: t.enabled !== false,
    lastRun: t.lastRun || null,
    lastStatus: t.lastStatus || null,
    createdAt: t.createdAt || Date.now(),
  });
  const idx = all.findIndex((x) => x.id === task.id);
  if (idx >= 0) all[idx] = task; else all.push(task);
  await setLocal(STORAGE_KEYS.SCHEDULES, all);
  return task;
}

export async function deleteTask(id) {
  await chrome.alarms.clear(PREFIX + id);
  await setLocal(STORAGE_KEYS.SCHEDULES, (await listTasks()).filter((t) => t.id !== id));
}

export async function rearmAll() {
  const all = await listTasks();
  for (const t of all) await arm(t);
  await setLocal(STORAGE_KEYS.SCHEDULES, all);
}

export async function markRun(id, status) {
  const all = await listTasks();
  const t = all.find((x) => x.id === id);
  if (!t) return;
  t.lastRun = Date.now();
  t.lastStatus = status;
  if (t.frequency === 'once') t.enabled = false;
  await arm(t);
  await setLocal(STORAGE_KEYS.SCHEDULES, all);
}

export function taskIdFromAlarm(name) {
  return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : null;
}
