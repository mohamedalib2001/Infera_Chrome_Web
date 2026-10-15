// Long-term memory: lasting facts the user told the agent to remember (a preferred
// airline, a delivery city, how they like reports, the people and projects they
// work with). Kept in the person's Infera Agent account so it follows them to every
// device, with a copy in this browser for when the account can't be reached. The
// newest and pinned memories are shown to the agent at the start of each
// conversation; the rest are found with memory_search. The user reviews and
// deletes them in Settings.
import { getLocal, setLocal, uuid } from './storage.js';
import { inferaMemory } from './auth.js';

const KEY = 'userMemory';
const SYNCED = 'userMemorySynced'; // memories saved before account sync have been uploaded
export const MAX_ITEMS = 2000;
export const MAX_CHARS = 2000;
// How much memory goes into a conversation's first message; the rest is searched.
const BLOCK_CHARS = 24_000;
const FRESH_MS = 60_000;

// Never keep secrets or payment data, whoever asks.
const SENSITIVE = [
  /\b(?:\d[ -]?){13,19}\b/,                                    // card-like numbers
  /\b(password|passcode|passwd|otp|cvv|cvc|pin code|seed phrase|private key|api[_ -]?key)\b/i,
  /(كلمة (ال)?(مرور|سر)|رمز التحقق|الرقم السري|رقم البطاقة)/,
];

let fetchedAt = 0;

const order = (a, b) => (b.pinned === true) - (a.pinned === true) || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

// The account's memories (refreshed at most once a minute), else this browser's copy.
export async function listMemory({ fresh = false } = {}) {
  const local = await getLocal(KEY, []);
  if (!fresh && Date.now() - fetchedAt < FRESH_MS) return local.slice().sort(order);
  try {
    let remote = await inferaMemory('get');
    if (!Array.isArray(remote)) throw new Error('bad reply');
    // Memories from before account sync are uploaded once.
    if (!(await getLocal(SYNCED, false))) {
      const known = new Set(remote.map((m) => m.id));
      for (const m of local.filter((x) => !known.has(x.id))) await inferaMemory('put', m.id, m).catch(() => {});
      if (local.some((x) => !known.has(x.id))) remote = await inferaMemory('get');
      await setLocal(SYNCED, true);
    }
    await setLocal(KEY, remote);
    fetchedAt = Date.now();
    return remote.slice().sort(order);
  } catch {
    return local.slice().sort(order);
  }
}

export async function saveMemory(text, { topic = '', pinned = false } = {}) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('Nothing to remember.');
  if (t.length > MAX_CHARS) throw new Error(`Keep a memory under ${MAX_CHARS} characters; split it into several.`);
  if (SENSITIVE.some((re) => re.test(t))) throw new Error('Passwords, codes, card numbers and keys are never stored in memory.');
  const all = await listMemory();
  const same = all.find((m) => m.text.toLowerCase() === t.toLowerCase());
  if (same) return same;
  if (all.length >= MAX_ITEMS) throw new Error(`Memory is full (${MAX_ITEMS} items). Forget some first.`);
  const now = Date.now();
  let item = { id: 'm_' + uuid().slice(0, 8), text: t, topic: String(topic || '').trim().slice(0, 40), pinned: pinned === true, createdAt: now, updatedAt: now };
  try { item = { ...item, ...(await inferaMemory('put', item.id, item)) }; } catch (e) {
    if (e.status === 400) throw new Error(e.message);
    // Offline: kept here and uploaded with the next sync.
    await setLocal(SYNCED, false);
  }
  await setLocal(KEY, [...(await getLocal(KEY, [])).filter((m) => m.id !== item.id), item]);
  return item;
}

export async function forgetMemory(id) {
  const all = await getLocal(KEY, []);
  const next = all.filter((m) => m.id !== id);
  if (next.length === all.length && !(await listMemory({ fresh: true })).some((m) => m.id === id)) throw new Error(`No memory with id ${id}.`);
  await inferaMemory('delete', id).catch(() => {});
  await setLocal(KEY, (await getLocal(KEY, [])).filter((m) => m.id !== id));
}

export async function clearMemory() {
  await inferaMemory('delete', 'all').catch(() => {});
  await setLocal(KEY, []);
}

// Words of a text, for matching (Arabic and Latin; case and diacritics ignored).
const words = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ̀-ͯ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

// The memories that best match a query (by shared words, prefix matches count half).
export async function searchMemory(query, limit = 20) {
  const q = words(query);
  if (!q.length) return [];
  const scored = (await listMemory()).map((m) => {
    const w = words(`${m.text} ${m.topic || ''}`);
    let score = 0;
    for (const t of q) score += w.includes(t) ? 1 : w.some((x) => x.startsWith(t) || t.startsWith(x)) ? 0.5 : 0;
    return { m, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || order(a.m, b.m));
  return scored.slice(0, limit).map((x) => x.m);
}

const line = (m) => `- [${m.id}]${m.topic ? ` (${m.topic})` : ''} ${m.text}`;

// The block added to the first message of a new conversation.
export function memoryBlock(items) {
  if (!items.length) return null;
  const shown = [];
  let size = 0;
  for (const m of items) {
    const l = line(m);
    if (size + l.length > BLOCK_CHARS) break;
    shown.push(l);
    size += l.length + 1;
  }
  const more = items.length - shown.length;
  return {
    type: 'text',
    text: `<user_memory>\nThings the user asked you to remember in earlier conversations (use them when relevant; forget one with memory_forget if the user says it is wrong):\n${shown.join('\n')}${more > 0 ? `\n(${more} older memories are not shown here: look them up with memory_search when the task may need them.)` : ''}\n</user_memory>`,
  };
}
