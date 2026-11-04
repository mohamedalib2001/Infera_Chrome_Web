// The activity log: what the agent did, where and when, kept in this browser only (the last
// 5,000 entries) and exportable as CSV from Settings — for the person's own audit, or their
// company's. Writes are batched so a busy task does not hammer storage.
import { getLocal, setLocal } from './storage.js';

const KEY = 'activityLog';
const MAX = 5000;
let pending = [];
let timer = null;

export function logActivity(e) {
  pending.push({ at: Date.now(), ...e });
  clearTimeout(timer);
  timer = setTimeout(flush, 800);
}

export async function flush() {
  if (!pending.length) return;
  const add = pending;
  pending = [];
  const all = await getLocal(KEY, []);
  await setLocal(KEY, [...all, ...add].slice(-MAX));
}

export async function listActivity() {
  await flush();
  return getLocal(KEY, []);
}

export async function clearActivity() {
  pending = [];
  await setLocal(KEY, []);
}

/** CSV with a byte-order mark so Excel opens Arabic correctly. */
export function activityCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['time', 'task', 'kind', 'action', 'site', 'result', 'detail'];
  return `﻿${[head.join(','), ...rows.map((r) => [new Date(r.at).toISOString(), r.task, r.kind, r.action, r.site, r.result, r.detail].map(esc).join(','))].join('\n')}`;
}
