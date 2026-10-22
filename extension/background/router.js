// Operating modes (Fast / Balanced / Power / Auto) and the router that picks one per task.
// A mode is a model plus an effort level. "Auto" reads the request and picks the cheapest
// mode likely to finish it, and steps up when that mode has been failing in this browser.
// The choice is made once, when a conversation starts: a conversation stays on one model,
// which keeps the prompt cache warm and its thinking blocks valid.
import { getLocal, setLocal } from './storage.js';

export const OPERATING_MODES = {
  fast: { model: 'claude-sonnet-5', effort: 'low' },
  balanced: { model: 'claude-sonnet-5[advisor]', effort: 'medium' },
  power: { model: 'claude-opus-5-5', effort: 'high' },
};
export const MODE_IDS = ['auto', 'fast', 'balanced', 'power'];

// Another model of the same kind when the first one is overloaded or unavailable, tried
// only before the conversation has its first answer (so nothing model-bound is lost).
export const FAILOVER = {
  'claude-opus-5-5': 'claude-opus-5',
  'claude-opus-5': 'claude-sonnet-5',
  'claude-fable-5-1': 'claude-opus-5-5',
  'claude-sonnet-5[advisor]': 'claude-sonnet-5',
  'claude-sonnet-5': 'claude-opus-5',
};

const STATS_KEY = 'routeStats';
const WINDOW = 20; // the last N tasks per mode

// Signals in English and Arabic. Arabic is matched without diacritics or hamza forms.
const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const HEAVY = [
  /\b(submit|apply|application|register|sign ?up|fill( in| out)?|form|upload|checkout|book(ing)?|reserve|file (a|the)|log ?in|sign ?in)\b/,
  /\b(each|every|all (the|of)|for all|bulk|batch|multiple|several|list of|one by one)\b/,
  /\b(research|investigate|compare|comparison|analy[sz]e|report|spreadsheet|excel|table of|across)\b/,
  /(قدم|تقديم|طلب|نموذج|استماره|املا|عبي|سجل|تسجيل|ارفع|رفع|حجز|احجز|اكمل|استكمال|ادخل علي)/,
  /(كل |جميع|لكل|واحد واحد|عده|مجموعه|قائمه)/,
  /(بحث|ابحث|قارن|مقارنه|حلل|تحليل|تقرير|جدول|اكسل)/,
];
const LIGHT = [
  /^(what|who|when|where|which|how (much|many)|is|are|does|do|can you (tell|explain)|summari[sz]e|translate|explain|define|read)\b/,
  /^(ما|ماذا|من |متي|اين|كم|هل|لخص|ترجم|اشرح|اقرا|عرف)/,
];

/** Reads a request and says which mode should do it, and why (shown to the user). */
export function classifyTask(text, { attachments = 0, followUp = false } = {}) {
  const t = norm(text).trim();
  let score = 0;
  const why = [];
  // Every distinct action word counts: "sign in, then submit the request and complete the data" is heavy.
  const heavy = new Set(HEAVY.flatMap((re) => [...t.matchAll(new RegExp(re.source, 'g'))].map((m) => m[0].trim()))).size;
  if (heavy) { score += Math.min(heavy, 4) * 2 - (heavy === 1 ? 1 : 0); why.push('multi-step actions'); }
  const lines = t.split(/\n/).filter((l) => /^\s*(\d+[.)-]|[-•*])\s+/.test(l)).length;
  if (lines >= 3) { score += 2; why.push(`${lines} listed steps`); }
  if (t.length > 600) { score += 2; why.push('long instructions'); } else if (t.length > 220) score += 1;
  if (attachments) { score += 1; why.push('attached files'); }
  const light = LIGHT.some((re) => re.test(t)) && t.length < 160 && !heavy;
  if (light) { score -= 2; why.push('a quick question'); }
  if (followUp) score += 1;
  const mode = score >= 5 ? 'power' : score <= -1 ? 'fast' : 'balanced';
  return { mode, reason: why[0] || (mode === 'balanced' ? 'a general task' : '') };
}

async function stats() { return (await getLocal(STATS_KEY, {})) || {}; }

/** The success rate of each mode on recent tasks in this browser (done vs error). */
export async function routeStats() {
  const s = await stats();
  const out = {};
  for (const m of Object.keys(OPERATING_MODES)) {
    const runs = s[m] || [];
    out[m] = { runs: runs.length, ok: runs.filter(Boolean).length };
  }
  return out;
}

/** Records how a routed task ended, so Auto learns which mode works here. */
export async function recordOutcome(mode, ok) {
  if (!OPERATING_MODES[mode]) return;
  const s = await stats();
  s[mode] = [...(s[mode] || []), ok ? 1 : 0].slice(-WINDOW);
  await setLocal(STATS_KEY, s);
}

const STEP_UP = { fast: 'balanced', balanced: 'power', power: 'power' };

/**
 * The model and effort for a new task. `mode` is the person's choice (auto / fast /
 * balanced / power); Auto classifies the request, then steps up a level when that level
 * failed on more than a third of at least five recent tasks.
 */
export async function routeTask(mode, text, opts = {}) {
  let chosen = mode;
  let reason = '';
  if (mode === 'auto') {
    ({ mode: chosen, reason } = classifyTask(text, opts));
    const st = (await stats())[chosen] || [];
    if (st.length >= 5 && st.filter((x) => !x).length / st.length > 1 / 3 && STEP_UP[chosen] !== chosen) {
      chosen = STEP_UP[chosen];
      reason = 'recent tasks needed more power';
    }
  }
  const m = OPERATING_MODES[chosen] || OPERATING_MODES.balanced;
  return { mode: chosen, auto: mode === 'auto', model: m.model, effort: m.effort, reason };
}
