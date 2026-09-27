// Saved shortcuts ("/" commands): reusable prompts, optionally produced by
// workflow recording, optionally scheduled.
import { STORAGE_KEYS } from './constants.js';
import { getLocal, setLocal, uuid } from './storage.js';

export async function listShortcuts() {
  return getLocal(STORAGE_KEYS.SHORTCUTS, []);
}

export async function saveShortcut(s) {
  const all = await listShortcuts();
  const command = String(s.command || '').replace(/^\//, '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!command) throw new Error('Shortcut command is required');
  if (!s.prompt?.trim()) throw new Error('Shortcut prompt is required');
  const clash = all.find((x) => x.command === command && x.id !== s.id);
  if (clash) throw new Error(`/${command} already exists`);
  const entry = {
    id: s.id || uuid(),
    command,
    description: s.description || '',
    prompt: s.prompt,
    params: s.params || [],        // [{name, description, default}] -> {{name}} placeholders
    isWorkflow: !!s.isWorkflow,
    startUrl: s.startUrl || '',
    model: s.model || '',
    createdAt: s.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  const idx = all.findIndex((x) => x.id === entry.id);
  if (idx >= 0) all[idx] = entry; else all.push(entry);
  await setLocal(STORAGE_KEYS.SHORTCUTS, all);
  return entry;
}

export async function deleteShortcut(id) {
  await setLocal(STORAGE_KEYS.SHORTCUTS, (await listShortcuts()).filter((s) => s.id !== id));
}

export async function findShortcut({ shortcutId, command }) {
  const all = await listShortcuts();
  if (shortcutId) return all.find((s) => s.id === shortcutId) || null;
  if (command) {
    const c = command.replace(/^\//, '').toLowerCase();
    return all.find((s) => s.command === c) || null;
  }
  return null;
}

export function renderShortcut(s, values = {}) {
  let prompt = s.prompt;
  for (const p of s.params || []) {
    const v = values[p.name] ?? p.default ?? '';
    prompt = prompt.split(`{{${p.name}}}`).join(String(v));
  }
  if (s.startUrl) prompt = `Start at ${s.startUrl}.\n\n${prompt}`;
  return prompt;
}
