// Developer tools for the agent: code editors on web pages and a DevTools layer.
// The page scripts below run in the page's own JavaScript world (CDP Runtime.evaluate),
// because editors keep their state in page objects (Monaco models, CodeMirror views).
// Each script is a plain function serialised with its arguments; nothing is injected
// into the page permanently.

// ---------- code editors ----------
// Finds every code editor on the page and reads or edits it through the editor's own
// API, so a whole file is written in one step, with the editor's undo history, instead
// of being typed key by key (which triggers auto-indent and auto-closing brackets).
function editorsInPage(op, arg) {
  const list = [];
  const has = (el) => list.some((x) => x.el && (x.el === el || x.el.contains(el) || el.contains(x.el)));
  const mon = window.monaco?.editor;
  if (mon?.getEditors) {
    for (const ed of mon.getEditors()) {
      const m = ed.getModel?.();
      if (!m) continue;
      list.push({
        kind: 'monaco', el: ed.getDomNode?.(), lang: m.getLanguageId?.() || '', path: m.uri?.path || '',
        get: () => m.getValue(),
        set: (t) => { ed.pushUndoStop?.(); ed.executeEdits('infera', [{ range: m.getFullModelRange(), text: t }]); ed.pushUndoStop?.(); },
      });
    }
  }
  for (const el of document.querySelectorAll('.cm-content')) {
    const cv = el.cmView;
    const v = cv?.rootView?.view || cv?.view || el.cmTile?.view;
    if (!v?.state?.doc || has(el)) continue;
    list.push({ kind: 'codemirror6', el: v.dom || el, lang: '', path: '', get: () => v.state.doc.toString(), set: (t) => v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }) });
  }
  for (const el of document.querySelectorAll('.CodeMirror')) {
    const c = el.CodeMirror;
    if (!c || has(el)) continue;
    const mode = c.getOption?.('mode');
    list.push({ kind: 'codemirror5', el, lang: typeof mode === 'string' ? mode : mode?.name || '', path: '', get: () => c.getValue(), set: (t) => c.setValue(t) });
  }
  for (const el of document.querySelectorAll('.ace_editor')) {
    const a = el.env?.editor;
    if (!a || has(el)) continue;
    list.push({ kind: 'ace', el, lang: String(a.session?.getMode?.()?.$id || '').replace('ace/mode/', ''), path: '', get: () => a.getValue(), set: (t) => { a.session.setValue(t); } });
  }
  // Monaco without a reachable API (vscode.dev, github.dev): found by its DOM, written by paste.
  for (const el of document.querySelectorAll('.monaco-editor')) {
    if (has(el) || !el.offsetParent) continue;
    const ta = el.querySelector('textarea');
    list.push({
      kind: 'monaco-dom', el, lang: el.getAttribute('data-mode-id') || '', path: '', api: false,
      get: () => [...el.querySelectorAll('.view-line')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((l) => l.textContent.replace(/ /g, ' ')).join('\n'),
      set: null, input: ta,
    });
  }
  for (const el of document.querySelectorAll('textarea')) {
    if (has(el) || !el.offsetParent || (el.rows < 4 && el.clientHeight < 80)) continue;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    list.push({
      kind: 'textarea', el, lang: '', path: el.name || el.id || '',
      get: () => el.value,
      set: (t) => { setter.call(el, t); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
    });
  }
  const pick = () => {
    const e = list[arg.editor ?? 0];
    if (!e) throw new Error(list.length ? `There is no editor ${arg.editor}; this page has ${list.length} (0–${list.length - 1}).` : 'No code editor found on this page.');
    return e;
  };
  const box = (el) => { const r = el?.getBoundingClientRect?.(); return r ? { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + Math.min(20, r.height / 2)) } : null; };
  if (op === 'list') {
    return list.map((e, i) => { const v = e.get(); return { editor: i, kind: e.kind, language: e.lang, path: e.path, lines: v.split('\n').length, chars: v.length, writable: e.api !== false, visibleOnly: e.kind === 'monaco-dom' }; });
  }
  const e = pick();
  if (op === 'read') {
    const lines = e.get().split('\n');
    const from = Math.max(1, arg.from_line || 1);
    const to = Math.min(lines.length, arg.to_line || lines.length);
    return { kind: e.kind, total: lines.length, from, to, text: lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(4)}| ${l}`).join('\n'), visibleOnly: e.kind === 'monaco-dom' };
  }
  // Writes: compute the new text, set it, read it back.
  const before = e.get();
  let next;
  if (op === 'write') next = String(arg.text ?? '');
  else if (op === 'replace') {
    const find = String(arg.find ?? '');
    if (!find) throw new Error('Give "find": the exact text to replace.');
    const n = before.split(find).length - 1;
    if (!n) throw new Error('The text to replace was not found. Read the editor again and copy the text exactly.');
    if (n > 1 && !arg.all) throw new Error(`The text to replace occurs ${n} times; add more surrounding lines to make it unique, or set "all": true.`);
    next = arg.all ? before.split(find).join(String(arg.replace_with ?? '')) : before.replace(find, () => String(arg.replace_with ?? ''));
  } else if (op === 'insert') {
    const lines = before.split('\n');
    const at = Math.max(0, Math.min(lines.length, (arg.line || lines.length + 1) - 1));
    lines.splice(at, 0, ...String(arg.text ?? '').split('\n'));
    next = lines.join('\n');
  } else throw new Error(`Unknown action ${op}`);
  if (!e.set) return { needsPaste: true, text: next, point: box(e.el), kind: e.kind };
  e.set(next);
  const after = e.get();
  return { kind: e.kind, verified: after === next, lines: after.split('\n').length, changedChars: Math.abs(after.length - before.length) };
}

export function editorScript(op, arg = {}) {
  return `(${editorsInPage.toString()})(${JSON.stringify(op)}, ${JSON.stringify(arg)})`;
}

// Paste into an editor with no reachable API: a synthetic paste event carries the text,
// which editors such as Monaco take as one edit (no auto-indent, no auto-closed brackets).
export function pasteScript(text) {
  return `(() => {
    const t = document.activeElement;
    if (!t) return false;
    const dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(text)});
    t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`;
}

// ---------- DevTools ----------
function perfInPage() {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  const res = performance.getEntriesByType('resource');
  const byType = {};
  let bytes = 0;
  for (const r of res) {
    const k = r.initiatorType || 'other';
    byType[k] = byType[k] || { count: 0, kb: 0 };
    byType[k].count++;
    byType[k].kb += Math.round((r.transferSize || r.encodedBodySize || 0) / 1024);
    bytes += r.transferSize || r.encodedBodySize || 0;
  }
  const slow = [...res].sort((a, b) => b.duration - a.duration).slice(0, 8).map((r) => ({ url: r.name.slice(0, 160), ms: Math.round(r.duration), kb: Math.round((r.transferSize || 0) / 1024) }));
  return new Promise((resolve) => {
    let lcp = null;
    let cls = 0;
    try { new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported */ }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
    setTimeout(() => resolve({
      url: location.href,
      timing: { ttfb: Math.round(nav.responseStart || 0), domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0), fcp: paint['first-contentful-paint'] ?? null, lcp, cls: +cls.toFixed(3) },
      resources: { count: res.length, totalKB: Math.round(bytes / 1024), byType },
      slowest: slow,
      dom: { elements: document.getElementsByTagName('*').length, scripts: document.scripts.length, stylesheets: document.styleSheets.length },
      memoryMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    }), 300);
  });
}

function auditInPage() {
  const issues = [];
  const add = (area, severity, message, sample) => issues.push({ area, severity, message, ...(sample ? { sample: String(sample).slice(0, 140) } : {}) });
  const q = (s) => [...document.querySelectorAll(s)];
  const desc = (el) => `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}>`;
  // SEO
  if (!document.title.trim()) add('seo', 'high', 'The page has no <title>.');
  else if (document.title.length > 65) add('seo', 'low', `The title is long (${document.title.length} characters).`, document.title);
  const md = document.querySelector('meta[name="description"]');
  if (!md?.content?.trim()) add('seo', 'medium', 'No meta description.');
  const h1 = q('h1');
  if (!h1.length) add('seo', 'medium', 'No <h1> heading.');
  if (h1.length > 1) add('seo', 'low', `${h1.length} <h1> headings.`);
  if (!document.documentElement.lang) add('seo', 'medium', '<html> has no lang attribute.');
  if (!document.querySelector('link[rel="canonical"]')) add('seo', 'low', 'No canonical link.');
  if (!document.querySelector('meta[name="viewport"]')) add('mobile', 'high', 'No viewport meta tag: the page will not fit phones.');
  // Accessibility
  const noAlt = q('img').filter((i) => !i.hasAttribute('alt'));
  if (noAlt.length) add('accessibility', 'medium', `${noAlt.length} image(s) without alt text.`, noAlt[0].src);
  const unlabeled = q('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea').filter((el) => !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title || el.placeholder));
  if (unlabeled.length) add('accessibility', 'medium', `${unlabeled.length} form field(s) without a label.`, desc(unlabeled[0]));
  const emptyBtn = q('button,a[href]').filter((el) => !(el.innerText.trim() || el.getAttribute('aria-label') || el.title || el.querySelector('img[alt]:not([alt=""]),svg title')));
  if (emptyBtn.length) add('accessibility', 'medium', `${emptyBtn.length} button(s)/link(s) with no accessible name.`, desc(emptyBtn[0]));
  const ids = q('[id]').map((e) => e.id);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dup.length) add('html', 'low', `${dup.length} duplicate id(s).`, dup.slice(0, 5).join(', '));
  // Security and performance
  if (location.protocol === 'https:') {
    const mixed = q('img[src^="http:"],script[src^="http:"],link[href^="http:"][rel=stylesheet],iframe[src^="http:"]');
    if (mixed.length) add('security', 'high', `${mixed.length} resource(s) loaded over plain HTTP (mixed content).`, mixed[0].src || mixed[0].href);
  }
  const blank = q('a[target="_blank"]').filter((a) => !/noopener|noreferrer/.test(a.rel));
  if (blank.length) add('security', 'low', `${blank.length} link(s) open a new tab without rel="noopener".`);
  const blocking = q('head script[src]:not([async]):not([defer]):not([type=module])');
  if (blocking.length) add('performance', 'medium', `${blocking.length} render-blocking script(s) in <head>.`, blocking[0].src);
  const bigImgs = q('img').filter((i) => i.naturalWidth > 2 * Math.max(1, i.clientWidth) && i.naturalWidth > 1200);
  if (bigImgs.length) add('performance', 'low', `${bigImgs.length} image(s) much larger than displayed.`, bigImgs[0].src);
  const noLazy = q('img').filter((i) => !i.loading && i.getBoundingClientRect().top > innerHeight * 2);
  if (noLazy.length > 3) add('performance', 'low', `${noLazy.length} off-screen images without loading="lazy".`);
  return { url: location.href, title: document.title, issues, counts: issues.reduce((a, i) => ({ ...a, [i.severity]: (a[i.severity] || 0) + 1 }), {}) };
}

function inspectInPage(selector) {
  const els = [...document.querySelectorAll(selector)];
  if (!els.length) throw new Error(`No element matches ${selector}`);
  const el = els[0];
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const props = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'border', 'border-radius', 'z-index', 'overflow', 'opacity', 'visibility', 'flex-direction', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'transform'];
  return {
    matches: els.length,
    tag: el.tagName.toLowerCase(),
    attributes: Object.fromEntries([...el.attributes].slice(0, 30).map((a) => [a.name, a.value.slice(0, 200)])),
    box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), visible: !!(r.width && r.height) && cs.visibility !== 'hidden' && cs.display !== 'none' },
    styles: Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]).filter(([, v]) => v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px')),
    text: el.innerText?.slice(0, 300) || '',
    html: el.outerHTML.slice(0, 1500),
  };
}

// Names and sizes only: values can be session tokens, so they never leave the page.
function storageInPage() {
  const keys = (s) => { try { return Object.keys(s).slice(0, 100).map((k) => ({ key: k, chars: String(s.getItem(k) || '').length })); } catch { return []; } };
  return {
    origin: location.origin,
    cookies: document.cookie ? document.cookie.split(';').map((c) => c.split('=')[0].trim()).slice(0, 100) : [],
    localStorage: keys(localStorage),
    sessionStorage: keys(sessionStorage),
    serviceWorker: !!navigator.serviceWorker?.controller,
  };
}

// A passive security review of the page the user is on: response headers, cookies that
// scripts can read, forms and fields. It only reads; it never probes or attacks anything.
async function securityInPage() {
  const findings = [];
  const add = (severity, check, message) => findings.push({ severity, check, message });
  let headers = {};
  try {
    const r = await fetch(location.href, { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
    r.headers.forEach((v, k) => { headers[k] = v; });
  } catch (e) { add('info', 'headers', `Could not read the response headers (${e.message}).`); }
  const h = (k) => headers[k];
  if (location.protocol !== 'https:') add('high', 'https', 'The page is not served over HTTPS.');
  else if (!h('strict-transport-security')) add('medium', 'hsts', 'No Strict-Transport-Security header.');
  const csp = h('content-security-policy');
  if (!csp) add('medium', 'csp', 'No Content-Security-Policy header.');
  else if (/unsafe-inline|unsafe-eval/.test(csp) && /script-src|default-src/.test(csp)) add('low', 'csp', 'The CSP allows unsafe-inline or unsafe-eval scripts.');
  if (!h('x-content-type-options')) add('low', 'nosniff', 'No X-Content-Type-Options: nosniff.');
  if (!h('x-frame-options') && !(csp && /frame-ancestors/.test(csp))) add('medium', 'clickjacking', 'Neither X-Frame-Options nor CSP frame-ancestors: the page can be framed.');
  if (!h('referrer-policy')) add('low', 'referrer', 'No Referrer-Policy header.');
  if (!h('permissions-policy')) add('info', 'permissions-policy', 'No Permissions-Policy header.');
  if (h('server') && /\d/.test(h('server'))) add('low', 'disclosure', `The Server header discloses a version: ${h('server')}.`);
  if (h('x-powered-by')) add('low', 'disclosure', `X-Powered-By discloses the stack: ${h('x-powered-by')}.`);
  if (h('access-control-allow-origin') === '*') add('low', 'cors', 'CORS allows any origin (Access-Control-Allow-Origin: *).');
  const readable = document.cookie ? document.cookie.split(';').map((c) => c.split('=')[0].trim()) : [];
  const sessionLike = readable.filter((n) => /sess|auth|token|jwt|sid/i.test(n));
  if (sessionLike.length) add('high', 'cookies', `Session-like cookies are readable by scripts (not HttpOnly): ${sessionLike.join(', ')}.`);
  else if (readable.length) add('info', 'cookies', `${readable.length} cookie(s) are readable by scripts.`);
  for (const f of document.forms) {
    const action = f.getAttribute('action') || location.href;
    if (/^http:/i.test(new URL(action, location.href).href) && location.protocol === 'https:') add('high', 'forms', `A form posts to plain HTTP: ${action}.`);
    const pw = f.querySelector('input[type=password]');
    if (pw && f.method.toLowerCase() === 'get') add('high', 'forms', 'A password form submits with GET (the password ends up in URLs and logs).');
  }
  const ext = [...document.scripts].filter((s) => s.src && new URL(s.src).origin !== location.origin);
  const noSri = ext.filter((s) => !s.integrity);
  if (noSri.length) add('low', 'sri', `${noSri.length} third-party script(s) without Subresource Integrity.`);
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { url: location.href, headers: Object.fromEntries(Object.entries(headers).filter(([k]) => !/cookie|authorization/i.test(k))), findings, thirdPartyScripts: [...new Set(ext.map((s) => new URL(s.src).host))].slice(0, 30) };
}

export const devScripts = {
  // Top-level await (CDP REPL mode) so the promise's value is returned, not the promise.
  security: () => `await (${securityInPage.toString()})()`,
  performance: () => `await (${perfInPage.toString()})()`,
  audit: () => `(${auditInPage.toString()})()`,
  inspect: (selector) => `(${inspectInPage.toString()})(${JSON.stringify(String(selector || ''))})`,
  storage: () => `(${storageInPage.toString()})()`,
};

// A HAR 1.2 log from the requests captured on the tab (URLs, methods, status, types and
// timing; no headers or bodies, which can carry credentials).
export function toHar(requests, page = {}) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Infera Agent Web', version: chrome.runtime.getManifest().version },
      pages: [{ id: 'page_1', title: page.title || '', startedDateTime: new Date(requests[0]?.ts || Date.now()).toISOString(), pageTimings: {} }],
      entries: requests.map((r) => ({
        pageref: 'page_1',
        startedDateTime: new Date(r.ts || Date.now()).toISOString(),
        time: Math.max(0, Math.round(r.duration || 0)),
        request: { method: r.method || 'GET', url: r.url, httpVersion: '', headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: -1 },
        response: { status: r.status || 0, statusText: r.error || '', httpVersion: '', headers: [], cookies: [], content: { size: r.size || 0, mimeType: r.mimeType || '' }, redirectURL: '', headersSize: -1, bodySize: r.size || -1 },
        cache: {},
        timings: { send: 0, wait: Math.max(0, Math.round(r.duration || 0)), receive: 0 },
        _resourceType: r.type || '',
      })),
    },
  };
}
