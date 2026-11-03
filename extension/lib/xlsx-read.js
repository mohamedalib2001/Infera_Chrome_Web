// Reads the first sheet of an Excel workbook (.xlsx) into rows of cell text, in the
// browser, without a library: the zip is read from its central directory and inflated
// with DecompressionStream; the sheet and shared strings are plain XML.

const td = new TextDecoder();

async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true);
    const comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    files.set(td.decode(u8.subarray(p + 46, p + 46 + nameLen)), { method, size, local });
    p += 46 + nameLen + extra + comment;
  }
  return async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    const data = u8.subarray(start, start + f.size);
    if (f.method === 0) return td.decode(data);
    if (f.method !== 8) throw new Error('This workbook uses a compression the reader does not support.');
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
}

const colIndex = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** The first sheet as an array of rows (arrays of strings). */
export async function readXlsx(buf) {
  const read = await unzip(buf);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  // The first sheet in workbook order, through its relationship.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.?\//, '')}`;
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new Error('The workbook has no sheet to read.');
  const ssXml = await read('xl/sharedStrings.xml');
  const shared = ssXml ? [...xml(ssXml).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
  const rows = [];
  for (const row of xml(sheet).getElementsByTagName('row')) {
    const out = [];
    let next = 0;
    for (const c of row.getElementsByTagName('c')) {
      const i = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : next;
      next = i + 1;
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let val;
      if (type === 's') val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
      else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else val = v;
      out[i] = val;
    }
    rows.push(Array.from(out, (x) => x ?? ''));
  }
  return rows;
}

/** Rows with a header row → objects keyed by the header (spaces become _). */
export function rowsToObjects(rows) {
  const [head = [], ...data] = rows.filter((r) => r.some((x) => String(x).trim()));
  const keys = head.map((h) => String(h).trim().replace(/\s+/g, '_'));
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, String(r[i] ?? '').trim()])));
}
