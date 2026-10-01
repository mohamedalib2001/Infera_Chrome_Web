// What the agent has spent in this browser, per day, from the charges the INFERA
// Agent gateway reports after each call — for the daily budget and the Costs tab.
// (The authoritative log, across devices, is on inferaagent.com.)
import { getLocal, setLocal } from './storage.js';

const KEY = 'spendByDay';
const day = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

export async function addSpend(amount, currency = '') {
  if (!(amount > 0)) return;
  if (currency) await setLocal('spendCurrency', currency);
  const all = await getLocal(KEY, {});
  all[day()] = (all[day()] || 0) + amount;
  for (const k of Object.keys(all).sort().slice(0, -60)) delete all[k];
  await setLocal(KEY, all);
}

export async function lastCurrency() {
  return getLocal('spendCurrency', '');
}

export async function spentToday() {
  return (await getLocal(KEY, {}))[day()] || 0;
}

export function money(amount, currency = '') {
  const n = Number(amount) || 0;
  return `${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}${currency ? ` ${currency}` : ''}`;
}
