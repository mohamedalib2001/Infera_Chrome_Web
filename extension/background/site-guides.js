// Site guides: what the agent learned about a website from a task that worked — where
// things are, the steps, the pitfalls, the formats fields expect — saved in the person's
// account memory under the topic "site:<host>" and handed back the next time the agent
// opens that site. One guide per site; a newer guide replaces the older one.
import { listMemory, saveMemory, forgetMemory } from './memory.js';

export const SITE_TOPIC = 'site:';

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

export const isSiteGuide = (m) => String(m?.topic || '').startsWith(SITE_TOPIC);

/** The saved guides for these hosts: Map host -> memory item. */
export async function siteGuides(hosts) {
  const want = new Set(hosts.filter(Boolean));
  if (!want.size) return new Map();
  const out = new Map();
  for (const m of await listMemory().catch(() => [])) {
    const h = isSiteGuide(m) ? m.topic.slice(SITE_TOPIC.length) : '';
    if (want.has(h) && !out.has(h)) out.set(h, m);
  }
  return out;
}

/** Saves (or replaces) the guide for a host. */
export async function saveSiteGuide(host, text) {
  const h = String(host || '').replace(/^https?:\/\//, '').replace(/[/:?#].*$/, '').replace(/^www\./, '').toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h)) throw new Error('Give the site as a host name, e.g. portal.example.gov.');
  const body = String(text ?? '').trim();
  if (body.length < 20) throw new Error('Write a useful guide: where things are, the steps that worked, pitfalls.');
  const topic = `${SITE_TOPIC}${h}`.slice(0, 40);
  const old = (await listMemory().catch(() => [])).filter((m) => m.topic === topic);
  const item = await saveMemory(body.slice(0, 1990), { topic });
  for (const m of old) if (m.id !== item.id) await forgetMemory(m.id).catch(() => {});
  return { host: h, item, replaced: old.length > 0 };
}
