// Anthropic's server-side web tools: web search (billed per search from the
// person's credits) and web fetch (tokens only). They run on Anthropic's
// servers, so research doesn't need to open tabs; the results come back as
// server_tool_use / *_tool_result blocks that are replayed unchanged.
// Dynamic filtering (the model filters results with code before reading them)
// comes with the _20260318 versions; response_inclusion "excluded" leaves the
// raw results that code already consumed out of the response.

function bareDomain(d) {
  return String(d || '').trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
}

// The person's and the organization's blocklists apply to the web tools too;
// an organization allowlist restricts them to those domains.
function domainFilter(settings, policy) {
  const allow = [...new Set((policy.allowlist || []).map(bareDomain).filter(Boolean))];
  if (allow.length) return { allowed_domains: allow.slice(0, 100) };
  const block = [...new Set([...(settings.userBlocklist || []), ...(policy.blocklist || [])].map(bareDomain).filter(Boolean))];
  return block.length ? { blocked_domains: block.slice(0, 100) } : {};
}

export function webTools(settings, policy = {}) {
  const filter = domainFilter(settings, policy);
  return [
    { type: 'web_search_20260318', name: 'web_search', max_uses: 5, response_inclusion: 'excluded', ...filter },
    { type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 10, max_content_tokens: 40_000, response_inclusion: 'excluded', ...filter },
  ];
}

export const SERVER_RESULT_TYPES = new Set([
  'web_search_tool_result', 'web_fetch_tool_result',
  'code_execution_tool_result', 'bash_code_execution_tool_result', 'text_editor_code_execution_tool_result',
]);

// A short, human-readable line for the side panel's tool card.
export function summarizeServerResult(b) {
  const c = b.content;
  if (c && !Array.isArray(c) && /error/.test(c.type || '')) return { text: `Error: ${c.error_code || c.type}`, isError: true };
  if (b.type === 'web_search_tool_result') {
    const rows = (Array.isArray(c) ? c : []).slice(0, 8).map((r) => `• ${r.title || r.url}\n  ${r.url}`);
    return { text: rows.length ? rows.join('\n') : 'No results.', isError: false };
  }
  if (b.type === 'web_fetch_tool_result') {
    return { text: `${c?.content?.title || ''}\n${c?.url || ''}`.trim(), isError: false };
  }
  const out = c?.stdout ?? c?.content ?? '';
  return { text: typeof out === 'string' ? out.slice(0, 2000) : 'Done.', isError: false };
}

// Sources cited in a text block (web search / web fetch citations).
export function citedSources(block) {
  const seen = new Map();
  for (const c of block.citations || []) {
    const url = c.url || c.document_url;
    if (url && !seen.has(url)) seen.set(url, { url, title: c.title || c.document_title || url });
  }
  return [...seen.values()];
}
