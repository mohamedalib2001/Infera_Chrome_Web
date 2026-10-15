// Files the agent produces from a task's results: spreadsheets (xlsx, csv),
// documents (docx, pdf, html, md, txt) and data (json). Built in the browser with
// no libraries: Office files are small zip packages written here (stored, not
// compressed), and PDFs are printed by Chrome itself from the generated HTML.
// Arabic and other right-to-left text gets right-to-left sheets and paragraphs.

const enc = new TextEncoder();
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
export const isRtl = (s) => RTL.test(String(s || ''));

// ---------- zip (store) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** files: [{name, data: string|Uint8Array}] → Uint8Array of a zip archive. */
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

const xml = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- spreadsheets ----------
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const isNumber = (v) => typeof v === 'number' ? Number.isFinite(v) : /^-?\d+(\.\d+)?$/.test(String(v ?? '').trim()) && String(v).trim().length < 16;

/** sheets: [{name, rows: [[cell…]…]}]; the first row is a bold header. */
export function xlsx(sheets) {
  const used = new Set();
  const names = sheets.map((s, i) => {
    let n = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`;
    for (let k = 2; used.has(n.toLowerCase()); k++) n = `${n.slice(0, 28)} ${k}`;
    used.add(n.toLowerCase());
    return n;
  });
  const sheetXml = (rows) => {
    const rtl = rows.some((r) => r.some(isRtl));
    const widths = [];
    rows.forEach((r) => r.forEach((v, c) => { widths[c] = Math.min(60, Math.max(widths[c] || 8, String(v ?? '').length + 2)); }));
    const cols = widths.length ? `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const s = ri === 0 ? ' s="1"' : '';
      if (v === null || v === undefined || v === '') return '';
      if (ri > 0 && isNumber(v)) return `<c r="${ref}"${s}><v>${Number(v)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
  };
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDEBFA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>' },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows || []) })),
  ];
  return zip(files);
}

export function csv(rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // BOM so Excel reads UTF-8 (Arabic) correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

// ---------- documents ----------
// A small Markdown subset → blocks: headings, paragraphs, bullet and numbered
// lists, tables, code blocks, quotes; inline **bold**, *italic*, `code`, [links](url).
export function mdBlocks(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if (/^```/.test(l)) {
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push({ type: 'code', text: code.join('\n') });
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
      out.push({ type: 'h', level: m[1].length, text: m[2] }); i++;
    } else if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue;
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      }
      out.push({ type: 'table', rows });
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      out.push({ type: 'list', ordered, items });
    } else if (/^>\s?/.test(l)) {
      const q = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ''));
      out.push({ type: 'quote', text: q.join(' ') });
    } else {
      const p = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*\||\s*([-*+]|\d+[.)])\s+|>)/.test(lines[i]); i++) p.push(lines[i].trim());
      out.push({ type: 'p', text: p.join(' ') });
    }
  }
  return out;
}

// Inline marks → runs [{text, b, i, code, href}].
function runs(s) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0; let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    if (m[2]) out.push({ text: m[2], b: true });
    else if (m[3]) out.push({ text: m[3], i: true });
    else if (m[4]) out.push({ text: m[4], code: true });
    else out.push({ text: m[5], href: m[6] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inlineHtml = (s) => runs(s).map((r) => {
  const t = esc(r.text);
  if (r.b) return `<strong>${t}</strong>`;
  if (r.i) return `<em>${t}</em>`;
  if (r.code) return `<code>${t}</code>`;
  if (r.href) return /^https?:|^mailto:/.test(r.href) ? `<a href="${esc(r.href)}">${t}</a>` : t;
  return t;
}).join('');

/** A complete, printable HTML page from Markdown (or the given HTML body). */
export function htmlDoc({ title = '', markdown = '', html = '' }) {
  const body = html || mdBlocks(markdown).map((b) => {
    switch (b.type) {
      case 'h': return `<h${b.level}>${inlineHtml(b.text)}</h${b.level}>`;
      case 'code': return `<pre><code>${esc(b.text)}</code></pre>`;
      case 'quote': return `<blockquote>${inlineHtml(b.text)}</blockquote>`;
      case 'list': return `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((x) => `<li>${inlineHtml(x)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`;
      case 'table': return `<table><thead><tr>${(b.rows[0] || []).map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      default: return `<p>${inlineHtml(b.text)}</p>`;
    }
  }).join('\n');
  const rtl = isRtl(markdown || html || title);
  return `<!doctype html><html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:11pt/1.55 "Segoe UI","Noto Sans","Noto Naskh Arabic",Tahoma,Arial,sans-serif;color:#1a1a2e;max-width:780px;margin:32px auto;padding:0 24px}
h1{font-size:20pt;margin:0 0 12px}h2{font-size:15pt;margin:22px 0 8px}h3{font-size:12.5pt;margin:18px 0 6px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:10pt}th,td{border:1px solid #d8d6e6;padding:6px 8px;text-align:start;vertical-align:top}
th{background:#edebfa}tr:nth-child(even) td{background:#faf9fe}pre{background:#f4f3f8;padding:10px;border-radius:6px;white-space:pre-wrap}
code{font-family:Consolas,monospace;font-size:9.5pt}blockquote{border-inline-start:3px solid #7c5cff;margin:10px 0;padding:2px 12px;color:#444}
a{color:#5b3fd9}@page{margin:18mm}</style></head><body>${title && !/^<h1/.test(body) ? `<h1>${esc(title)}</h1>` : ''}${body}</body></html>`;
}

/** A Word document from Markdown: headings, paragraphs, lists, tables; right-to-left when the text is. */
export function docx({ title = '', markdown = '' }) {
  const rtl = isRtl(markdown || title);
  const bidi = rtl ? '<w:bidi/>' : '';
  const rPr = (r, extra = '') => `<w:rPr>${r.b ? '<w:b/><w:bCs/>' : ''}${r.i ? '<w:i/><w:iCs/>' : ''}${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}${r.href ? '<w:color w:val="5B3FD9"/><w:u w:val="single"/>' : ''}${extra}${rtl ? '<w:rtl/>' : ''}</w:rPr>`;
  const run = (r, extra) => `<w:r>${rPr(r, extra)}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
  const para = (text, { style = '', extra = '', prefix = '' } = {}) =>
    `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${bidi}</w:pPr>${prefix ? run({ text: prefix }, extra) : ''}${runs(text).map((r) => run(r, extra)).join('')}</w:p>`;
  const blocks = mdBlocks(markdown);
  const parts = [];
  if (title && !(blocks[0]?.type === 'h' && blocks[0].level === 1)) parts.push(para(title, { style: 'Title' }));
  for (const b of blocks) {
    if (b.type === 'h') parts.push(para(b.text, { style: `Heading${Math.min(b.level, 3)}` }));
    else if (b.type === 'list') b.items.forEach((x, k) => parts.push(para(x, { prefix: b.ordered ? `${k + 1}. ` : '• ' })));
    else if (b.type === 'code') b.text.split('\n').forEach((x) => parts.push(`<w:p><w:pPr>${bidi}</w:pPr>${run({ text: x, code: true })}</w:p>`));
    else if (b.type === 'quote') parts.push(para(b.text, { extra: '<w:i/>' }));
    else if (b.type === 'table') {
      const cell = (c, head) => `<w:tc><w:tcPr>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEBFA"/>' : ''}</w:tcPr>${para(c, { extra: head ? '<w:b/>' : '' })}</w:tc>`;
      parts.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>${rtl ? '<w:bidiVisual/>' : ''}<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="D8D6E6"/>`).join('')}</w:tblBorders></w:tblPr>${b.rows.map((r, ri) => `<w:tr>${r.map((c) => cell(c, ri === 0)).join('')}</w:tr>`).join('')}</w:tbl>`, para(''));
    } else parts.push(para(b.text));
  }
  const heading = (id, name, size) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/>${bidi}</w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="1A1A2E"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>${rtl ? '<w:pPr><w:bidi/></w:pPr>' : ''}</w:style>${heading('Title', 'Title', 40)}${heading('Heading1', 'heading 1', 32)}${heading('Heading2', 'heading 2', 28)}${heading('Heading3', 'heading 3', 24)}<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>` },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>${rtl ? '<w:bidi/>' : ''}</w:sectPr></w:body></w:document>` },
  ]);
}

/** A PDF printed by Chrome from the HTML, in a temporary tab. Returns base64. */
export async function pdf(html) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const target = { tabId: tab.id };
  try {
    await chrome.debugger.attach(target, '1.3');
    const { frameTree } = await chrome.debugger.sendCommand(target, 'Page.getFrameTree');
    await chrome.debugger.sendCommand(target, 'Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await new Promise((r) => setTimeout(r, 300)); // fonts and layout
    const { data } = await chrome.debugger.sendCommand(target, 'Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: 8.27, paperHeight: 11.69 });
    return data;
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', csv: 'text/csv', md: 'text/markdown', txt: 'text/plain', json: 'application/json', html: 'text/html',
};
export const FORMATS = Object.keys(MIME);

/**
 * Builds the file for export_file. input: {filename, format, title, content (Markdown/text/HTML/JSON), sheets: [{name, rows}], rows}.
 * Returns {filename, mime, base64, bytes}.
 */
export async function buildFile(input) {
  const format = String(input.format || String(input.filename || '').split('.').pop() || '').toLowerCase();
  if (!MIME[format]) throw new Error(`Unsupported format "${format}". Use one of: ${FORMATS.join(', ')}.`);
  const base = String(input.filename || input.title || 'Infera export').replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'Infera export';
  const title = String(input.title || '');
  const content = typeof input.content === 'string' ? input.content : input.content != null ? JSON.stringify(input.content, null, 2) : '';
  const sheets = Array.isArray(input.sheets) && input.sheets.length ? input.sheets
    : Array.isArray(input.rows) ? [{ name: title || 'Sheet1', rows: input.rows }]
      : mdBlocks(content).filter((b) => b.type === 'table').map((b, i) => ({ name: `Table ${i + 1}`, rows: b.rows }));
  const norm = sheets.map((s) => ({ name: s.name, rows: (s.rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r ?? {}))) }));
  let bytes;
  switch (format) {
    case 'xlsx':
      if (!norm.length || !norm.some((s) => s.rows.length)) throw new Error('Give rows (or sheets, or a Markdown table in content) for a spreadsheet.');
      bytes = xlsx(norm); break;
    case 'csv':
      if (!norm[0]?.rows.length) throw new Error('Give rows (or a Markdown table in content) for a CSV file.');
      bytes = enc.encode(csv(norm[0].rows)); break;
    case 'docx': bytes = docx({ title, markdown: content }); break;
    case 'html': bytes = enc.encode(/^\s*<(!doctype|html)/i.test(content) ? content : htmlDoc({ title, markdown: content })); break;
    case 'pdf': {
      const b64 = await pdf(/^\s*<(!doctype|html)/i.test(content) ? content : htmlDoc({ title, markdown: content }));
      return { filename: `${base}.pdf`, mime: MIME.pdf, base64: b64, bytes: Math.round(b64.length * 0.75) };
    }
    case 'json': {
      let v = content;
      try { v = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep as given */ }
      bytes = enc.encode(v); break;
    }
    default: bytes = enc.encode(content);
  }
  return { filename: `${base}.${format}`, mime: MIME[format], base64: toBase64(bytes), bytes: bytes.length };
}
