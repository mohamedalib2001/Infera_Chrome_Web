// Minimal animated-GIF (GIF89a) encoder: per-frame local palettes built by
// popularity quantisation, nearest-colour mapping, LZW compression.
// quality 1..30 = pixel sampling step when building a palette (lower = better).

export function encodeGif(frames, { width, height, loop = 0 }) {
  const out = new ByteWriter();
  out.str('GIF89a');
  out.u16(width); out.u16(height);
  out.byte(0x70); // no global colour table, colour resolution 8 bits
  out.byte(0); out.byte(0);
  // NETSCAPE2.0 looping extension
  out.bytes([0x21, 0xff, 0x0b]); out.str('NETSCAPE2.0'); out.bytes([0x03, 0x01]); out.u16(loop); out.byte(0);

  for (const f of frames) {
    const { palette, indices } = f;
    // Graphic control extension: delay in 1/100 s
    out.bytes([0x21, 0xf9, 0x04, 0x00]); out.u16(Math.round(f.delayMs / 10)); out.byte(0); out.byte(0);
    // Image descriptor with local colour table (256 entries)
    out.byte(0x2c); out.u16(0); out.u16(0); out.u16(width); out.u16(height);
    out.byte(0x87); // local table present, 2^(7+1)=256 entries
    for (let i = 0; i < 256; i++) {
      const c = palette[i] || [0, 0, 0];
      out.byte(c[0]); out.byte(c[1]); out.byte(c[2]);
    }
    lzw(indices, 8, out);
  }
  out.byte(0x3b);
  return out.result();
}

export function quantize(rgba, quality = 10) {
  const step = Math.max(1, Math.min(30, quality | 0));
  const counts = new Map(); // 15-bit key -> [count, r, g, b]
  for (let i = 0; i < rgba.length; i += 4 * step) {
    const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
    const e = counts.get(key);
    if (e) { e[0]++; e[1] += rgba[i]; e[2] += rgba[i + 1]; e[3] += rgba[i + 2]; }
    else counts.set(key, [1, rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  const top = [...counts.values()].sort((a, b) => b[0] - a[0]).slice(0, 256);
  const palette = top.map(([n, r, g, b]) => [Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  while (palette.length < 2) palette.push([255, 255, 255]);

  const cache = new Int16Array(32768).fill(-1);
  const indices = new Uint8Array(rgba.length / 4);
  for (let p = 0, i = 0; i < rgba.length; i += 4, p++) {
    const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
    let idx = cache[key];
    if (idx < 0) {
      let best = 0; let bd = Infinity;
      const r = rgba[i]; const g = rgba[i + 1]; const b = rgba[i + 2];
      for (let k = 0; k < palette.length; k++) {
        const c = palette[k];
        const d = (c[0] - r) ** 2 * 2 + (c[1] - g) ** 2 * 4 + (c[2] - b) ** 2 * 3;
        if (d < bd) { bd = d; best = k; if (d === 0) break; }
      }
      cache[key] = idx = best;
    }
    indices[p] = idx;
  }
  return { palette, indices };
}

function lzw(indices, minCodeSize, out) {
  out.byte(minCodeSize);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map();
  const block = new SubBlockWriter(out);
  let bitBuf = 0; let bitCount = 0;
  const emit = (code) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) { block.byte(bitBuf & 0xff); bitBuf >>>= 8; bitCount -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitCount > 0) block.byte(bitBuf & 0xff);
  block.flush();
  out.byte(0);
}

class SubBlockWriter {
  constructor(out) { this.out = out; this.buf = new Uint8Array(255); this.n = 0; }
  byte(b) { this.buf[this.n++] = b; if (this.n === 255) this.flush(); }
  flush() { if (!this.n) return; this.out.byte(this.n); this.out.bytes(this.buf.subarray(0, this.n)); this.n = 0; }
}

class ByteWriter {
  constructor() { this.chunks = []; this.cur = new Uint8Array(1 << 16); this.n = 0; }
  byte(b) { if (this.n === this.cur.length) { this.chunks.push(this.cur); this.cur = new Uint8Array(1 << 16); this.n = 0; } this.cur[this.n++] = b; }
  bytes(arr) { for (let i = 0; i < arr.length; i++) this.byte(arr[i]); }
  u16(v) { this.byte(v & 0xff); this.byte((v >> 8) & 0xff); }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result() {
    const total = this.chunks.length * (1 << 16) + this.n;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    out.set(this.cur.subarray(0, this.n), o);
    return out;
  }
}
