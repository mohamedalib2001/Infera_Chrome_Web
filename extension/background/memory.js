// Long-term memory: short facts the user told the agent to remember (a preferred
// airline, a delivery city, the format they like reports in). Stored only in this
// browser; shown to the agent at the start of each new conversation; the user can
// review and delete them in Settings.
import { getLocal, setLocal, uuid } from './storage.js';

const KEY = 'userMemory';
const MAX_ITEMS = 100;
const MAX_CHARS = 500;

// Never keep secrets or payment data, whoever asks.
const SENSITIVE = [
  /\b(?:\d[ -]?){13,19}\b/,                                    // card-like numbers
  /\b(password|passcode|passwd|otp|cvv|cvc|pin code|seed phrase|private key|api[_ -]?key)\b/i,
  /(كلمة (ال)?(مرور|سر)|رمز التحقق|الرقم السري|رقم البطاقة)/,
];

export async function listMemory() {
  return getLocal(KEY, []);
}

export async function saveMemory(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('Nothing to remember.');
  if (t.length > MAX_CHARS) throw new Error(`Keep a memory under ${MAX_CHARS} characters.`);
  if (SENSITIVE.some((re) => re.test(t))) throw new Error('Passwords, codes, card numbers and keys are never stored in memory.');
  const all = await listMemory();
  if (all.some((m) => m.text.toLowerCase() === t.toLowerCase())) return all.find((m) => m.text.toLowerCase() === t.toLowerCase());
  const item = { id: 'm_' + uuid().slice(0, 8), text: t, createdAt: Date.now() };
  await setLocal(KEY, [...all, item].slice(-MAX_ITEMS));
  return item;
}

export async function forgetMemory(id) {
  const all = await listMemory();
  const next = all.filter((m) => m.id !== id);
  if (next.length === all.length) throw new Error(`No memory with id ${id}.`);
  await setLocal(KEY, next);
}

export async function clearMemory() {
  await setLocal(KEY, []);
}

// The block added to the first message of a new conversation.
export function memoryBlock(items) {
  if (!items.length) return null;
  return {
    type: 'text',
    text: `<user_memory>\nThings the user asked you to remember in earlier conversations (use them when relevant; forget one with memory_forget if the user says it is wrong):\n${items.map((m) => `- [${m.id}] ${m.text}`).join('\n')}\n</user_memory>`,
  };
}
