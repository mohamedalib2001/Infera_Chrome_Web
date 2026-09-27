// Domain classification. Categories:
//   category0            no restrictions
//   category1/category2  fully blocked (page replaced by blocked.html)
//   category3            forced prompt: always ask, "Always allow" not offered
//   category_org_blocked blocked by organization policy (managed storage)
// Local rules are always applied; an optional remote classifier (settings)
// can refine them. Results are cached for 5 minutes.
import { DOMAIN_CACHE_TTL_MS, RESTRICTED_HOSTS } from './constants.js';
import { getSettings, getManagedPolicy } from './storage.js';

// Default-blocked categories: financial services & banking, investment &
// trading, cryptocurrency, adult content, pirated content.
const BLOCKED_PATTERNS = {
  financial: [
    /(^|\.)(chase|bankofamerica|wellsfargo|citi|citibank|capitalone|usbank|pnc|tdbank|hsbc|barclays|lloydsbank|natwest|santander|bbva|bnpparibas|societegenerale|deutsche-bank|db|commerzbank|ing|rabobank|ubs|credit-suisse|scotiabank|rbc|bmo|cibc|anz|westpac|commbank|nab|alrajhibank|alahli|snb|riyadbank|emiratesnbd|mashreq|adcb|fab|qnb|cib|banquemisr|nbe|paypal|venmo|wise|revolut|monzo|americanexpress|discover|synchrony)(\.[a-z]{2,4}){1,2}$/i,
    /(^|\.)(online|secure|my)?banking\./i,
    /(^|[.-])bank[.-]/i,
  ],
  investment: [/(^|\.)(robinhood|etrade|schwab|fidelity|vanguard|interactivebrokers|tdameritrade|webull|etoro|plus500|ig|saxobank|tradestation|merrilledge|degiro|trading212|tastytrade)(\.[a-z]{2,4}){1,2}$/i],
  crypto: [/(^|\.)(coinbase|binance|kraken|crypto|bybit|okx|kucoin|bitfinex|bitstamp|huobi|htx|gate|mexc|bitget|metamask|blockchain|uniswap|opensea|phantom|ledger|trezor)(\.[a-z]{2,4}){1,2}$/i],
  adult: [/(^|\.)(pornhub|xvideos|xnxx|xhamster|onlyfans|redtube|youporn|chaturbate|stripchat|brazzers)(\.[a-z]{2,4}){1,2}$/i, /(^|\.)[a-z0-9-]*(porn|xxx)[a-z0-9-]*(\.[a-z]{2,4}){1,2}$/i],
  piracy: [/(^|\.)(thepiratebay|1337x|rarbg|yts|nyaa|fitgirl-repacks|libgen|z-lib|sci-hub|fmovies|123movies|putlocker|soap2day)(\.[a-z]{2,4}){1,2}$/i],
};
const CATEGORY_OF = { financial: 'category1', investment: 'category1', crypto: 'category1', adult: 'category2', piracy: 'category2' };

// Forced-prompt: sensitive but legitimate (health records, password managers,
// government identity, account security / OAuth consent).
const FORCE_PROMPT_PATTERNS = [
  /(^|\.)(mychart|patient|healthvault|1password|lastpass|bitwarden|dashlane|keepersecurity|login\.gov|id\.me|irs\.gov|ssa\.gov|absher|nafath)(\.[a-z]{2,4}){1,2}$/i,
  /(^|\.)accounts\.google\.com$/i, /(^|\.)login\.microsoftonline\.com$/i, /(^|\.)appleid\.apple\.com$/i,
];

const cache = new Map(); // host -> {result, at}

function hostMatches(host, pattern) {
  pattern = pattern.trim().toLowerCase().replace(/^\*\./, '');
  if (!pattern) return false;
  return host === pattern || host.endsWith('.' + pattern);
}

export async function classifyHost(host) {
  host = (host || '').toLowerCase();
  if (!host) return { category: 'category0' };
  const c = cache.get(host);
  if (c && Date.now() - c.at < DOMAIN_CACHE_TTL_MS) return c.result;

  const policy = await getManagedPolicy();
  const settings = await getSettings();
  let result = { category: 'category0' };

  if ((policy.blocklist || []).some((p) => hostMatches(host, p))) {
    result = { category: 'category_org_blocked', reason: 'Blocked by your organization' };
  } else if ((policy.allowlist || []).length && !(policy.allowlist || []).some((p) => hostMatches(host, p))) {
    result = { category: 'category_org_blocked', reason: 'Not on your organization\'s allowlist' };
  } else if ((settings.userBlocklist || []).some((p) => hostMatches(host, p))) {
    result = { category: 'category1', reason: 'On your personal blocklist' };
  } else {
    for (const [kind, pats] of Object.entries(BLOCKED_PATTERNS)) {
      if (pats.some((re) => re.test(host))) { result = { category: CATEGORY_OF[kind], reason: `High-risk category: ${kind}` }; break; }
    }
    if (result.category === 'category0' && FORCE_PROMPT_PATTERNS.some((re) => re.test(host))) {
      result = { category: 'category3', reason: 'Sensitive site: confirmation is always required' };
    }
    if (result.category === 'category0' && settings.remoteDomainClassifier) {
      try {
        const url = settings.remoteDomainClassifier.replace('{domain}', encodeURIComponent(host));
        const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (r.ok) {
          const j = await r.json();
          if (j?.category && /^category(0|1|2|3|_org_blocked)$/.test(j.category)) result = { category: j.category, reason: j.reason || 'Remote classification' };
        }
      } catch { /* fail open to local rules */ }
    }
  }
  cache.set(host, { result, at: Date.now() });
  return result;
}

export function isBlockedCategory(cat) {
  return cat === 'category1' || cat === 'category2' || cat === 'category_org_blocked';
}

export async function classifyUrl(url) {
  let u;
  try { u = new URL(url); } catch { return { category: 'category0', host: '' }; }
  if (!/^https?:$/.test(u.protocol)) return { category: 'category0', host: u.hostname };
  return { ...(await classifyHost(u.hostname)), host: u.hostname };
}

export function isRestrictedUrl(url = '') {
  if (!url) return false;
  if (/^(chrome|chrome-extension|edge|brave|about|devtools|view-source|chrome-search|chrome-untrusted):/i.test(url)) return true;
  try { return RESTRICTED_HOSTS.includes(new URL(url).hostname); } catch { return false; }
}

export function blockedPageUrl(url, reason) {
  return chrome.runtime.getURL(`blocked/blocked.html?url=${encodeURIComponent(url)}&reason=${encodeURIComponent(reason || '')}`);
}

export function clearDomainCache() { cache.clear(); }
