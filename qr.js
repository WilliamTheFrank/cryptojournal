/* ═══════════════════════════════════════════════════════════
   CryptoJournal — QR Code encoder (ISO/IEC 18004), no dependencies
   Byte mode with UTF-8 bytes, versions 1–40, ECC levels L/M/Q/H.
   Picks the smallest version that fits, scores all 8 masks with
   the four penalty rules and keeps the lowest. Pure: no DOM.
     QR.matrix(text, {ecc}) → {version, size, ecc, mask, modules}
       modules[y][x] === true means a dark module
     QR.svg(text, {ecc, margin, size, dark, light, label}) → '<svg…>'
   The install guide uses it for the "Put it on your iPhone" code.
   ═══════════════════════════════════════════════════════════ */
const QR = (() => {
  /* ── Error correction structure (ISO/IEC 18004 Table 9) ── */
  // Index = version 1–40 (0 unused); rows are levels L, M, Q, H. Data codewords
  // follow from the raw capacity; when blocks can't be equal, the later ones hold one more.
  const EC_PER_BLOCK = [
    [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const BLOCKS = [
    [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];
  const LEVELS = ['L', 'M', 'Q', 'H'];
  const FORMAT_LEVEL = [1, 0, 3, 2];  // format-info bits for L, M, Q, H: 01, 00, 11, 10

  /* ── GF(256) with the 0x11d polynomial, α = 2 ── */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  /* ── Reed–Solomon ── */
  const GEN = [];
  function generator(n) {  // ∏ (x − αⁱ) for i < n; coefficients high → low, leading 1
    if (!GEN[n]) {
      let g = [1];
      for (let i = 0; i < n; i++) {
        const next = new Array(g.length + 1).fill(0);
        g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
        g = next;
      }
      GEN[n] = g;
    }
    return GEN[n];
  }
  function ecCodewords(data, n) {  // remainder of data(x)·xⁿ ÷ g(x)
    const g = generator(n), rem = new Array(n).fill(0);
    for (const b of data) {
      const f = b ^ rem.shift();
      rem.push(0);
      for (let i = 0; i < n; i++) rem[i] ^= mul(g[i + 1], f);
    }
    return rem;
  }

  /* ── Capacity ── */
  // Modules left for data and EC once the function patterns are drawn
  function rawModules(v) {
    let n = (16 * v + 128) * v + 64;  // minus finders, separators, timing, format info
    if (v >= 2) {
      const a = Math.floor(v / 7) + 2;  // alignment centres per row
      n -= (25 * a - 10) * a - 55;      // alignment patterns, less their overlap with timing
      if (v >= 7) n -= 36;              // two 6×3 version-info blocks
    }
    return n;
  }
  const dataCodewords = (v, L) => (rawModules(v) >> 3) - EC_PER_BLOCK[L][v] * BLOCKS[L][v];
  const countBits = (v) => (v < 10 ? 8 : 16);  // byte-mode character count

  /* ── Data codewords: mode, count, bytes, terminator, padding ── */
  function dataStream(bytes, v, L) {
    const cap = dataCodewords(v, L) * 8, bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0b0100, 4);
    put(bytes.length, countBits(v));
    bytes.forEach(b => put(b, 8));
    put(0, Math.min(4, cap - bits.length));  // terminator, cut short when the symbol is full
    put(0, -bits.length & 7);                // to a byte boundary
    for (let pad = 0xec; bits.length < cap; pad = pad === 0xec ? 0x11 : 0xec) put(pad, 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((b, x) => (b << 1) | x, 0));
    return out;
  }

  /* ── Blocks: split, add EC, interleave ── */
  function interleave(data, v, L) {
    const nb = BLOCKS[L][v], ec = EC_PER_BLOCK[L][v], raw = rawModules(v) >> 3;
    const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb) - ec;  // data codewords per short block
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const len = shortLen + (i < nShort ? 0 : 1);
      const d = data.slice(k, k + len);
      k += len;
      blocks.push({ d, e: ecCodewords(d, ec) });
    }
    const out = [];
    for (let i = 0; i <= shortLen; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < ec; i++) blocks.forEach(b => out.push(b.e[i]));
    return out;
  }

  /* ── Function patterns ── */
  function alignment(v) {  // centre coordinates (ISO Annex E): 6, then evenly spaced back from the far edge
    if (v === 1) return [];
    const count = Math.floor(v / 7) + 2;
    const step = Math.floor((v * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const out = [6];
    for (let p = 10 + 4 * v; out.length < count; p -= step) out.splice(1, 0, p);
    return out;
  }
  // BCH code: data·x^deg mod poly appended to data (polynomials over GF(2) as bit masks)
  function bch(data, poly, deg) {
    let r = data;
    for (let i = 0; i < deg; i++) r = (r << 1) ^ ((r >>> (deg - 1)) & 1 ? poly : 0);
    return (data << deg) | r;
  }
  const formatBits = (L, mask) => bch((FORMAT_LEVEL[L] << 3) | mask, 0x537, 10) ^ 0x5412;
  const versionBits = (v) => bch(v, 0x1f25, 12);
  // [x, y] cells of format bit i (0 = least significant): first copy by the top-left
  // finder, second split between the top-right and bottom-left finders
  function formatCells(n) {
    const cells = [];
    for (let i = 0; i < 15; i++) {
      cells.push([
        i < 6 ? [8, i] : i < 8 ? [8, i + 1] : i === 8 ? [7, 8] : [14 - i, 8],
        i < 8 ? [n - 1 - i, 8] : [8, n - 15 + i],
      ]);
    }
    return cells;
  }

  // Everything except the data: modules m[y][x] plus a map fn of cells data may not use
  function template(v) {
    const n = 17 + 4 * v;
    const grid = () => Array.from({ length: n }, () => new Array(n).fill(false));
    const m = grid(), fn = grid();
    const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
    const ring = (dx, dy) => Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }  // timing
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {  // finders and their light separators
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = ring(dx, dy);
        if (x >= 0 && y >= 0 && x < n && y < n) set(x, y, d !== 2 && d !== 4);
      }
    }
    const pos = alignment(v), last = pos.length - 1;
    pos.forEach((cy, i) => pos.forEach((cx, j) => {
      if ((i === 0 && (j === 0 || j === last)) || (i === last && j === 0)) return;  // would sit on a finder
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, ring(dx, dy) !== 1);
    }));
    formatCells(n).forEach(pair => pair.forEach(([x, y]) => set(x, y, false)));  // drawn once the mask is known
    set(8, n - 8, true);  // the dark module
    if (v >= 7) {
      const bits = versionBits(v);
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1, a = n - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, dark);  // above the top-right finder
        set(b, a, dark);  // left of the bottom-left finder
      }
    }
    return { m, fn };
  }

  /* ── Data placement: 2-module columns zig-zag up and down from the bottom right ── */
  function place(m, fn, cw) {
    const n = m.length, total = cw.length * 8;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;  // the vertical timing pattern
      const up = ((right + 1) & 2) === 0;
      for (let k = 0; k < n; k++) {
        const y = up ? n - 1 - k : k;
        for (const x of [right, right - 1]) {
          if (fn[y][x]) continue;
          m[y][x] = i < total && ((cw[i >> 3] >> (7 - (i & 7))) & 1) === 1;  // leftover remainder bits stay light
          i++;
        }
      }
    }
  }

  /* ── Masks and penalty (ISO 7.8.2–7.8.3), x = column, y = row ── */
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  function penalty(m) {
    const n = m.length;
    let p = 0, dark = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = m[y][x];
        if (c) dark++;
        if (x < n - 1 && y < n - 1 && c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;  // rule 2: 2×2 blocks
      }
    }
    for (let a = 0; a < n; a++) {
      for (const line of [m[a], m.map(row => row[a])]) {
        let run = 1;  // rule 1: 5+ in a row of one colour → 3 + (run − 5)
        for (let b = 1; b < n; b++) {
          if (line[b] === line[b - 1]) run++;
          else { if (run >= 5) p += run - 2; run = 1; }
        }
        if (run >= 5) p += run - 2;
        // rule 3: dark-light-dark×3-light-dark with 4 light on either side (outside the symbol counts as light)
        const light = (b) => b < 0 || b >= n || !line[b];
        for (let b = 0; b + 7 <= n; b++) {
          if (!(line[b] && light(b + 1) && line[b + 2] && line[b + 3] && line[b + 4] && light(b + 5) && line[b + 6])) continue;
          if (light(b - 1) && light(b - 2) && light(b - 3) && light(b - 4)) p += 40;
          if (light(b + 7) && light(b + 8) && light(b + 9) && light(b + 10)) p += 40;
        }
      }
    }
    return p + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;  // rule 4: each 5% away from half dark
  }

  /* ── Public API ── */
  // opts.mask (0–7) forces one mask; it exists for the dev tests.
  function matrix(text, opts) {
    const o = opts || {};
    const ecc = String(o.ecc || 'M').toUpperCase(), L = LEVELS.indexOf(ecc);
    if (L < 0) throw new RangeError('QR: ecc must be L, M, Q or H');
    const bytes = Array.from(new TextEncoder().encode(text == null ? '' : String(text)));
    let v = 1;
    while (v <= 40 && 4 + countBits(v) + bytes.length * 8 > dataCodewords(v, L) * 8) v++;
    if (v > 40) {
      const max = (dataCodewords(40, L) * 8 - 20) >> 3;
      throw new RangeError(`QR: text too long (${bytes.length} bytes; level ${ecc} holds ${max})`);
    }
    const { m, fn } = template(v);
    place(m, fn, interleave(dataStream(bytes, v, L), v, L));
    const n = m.length, cells = formatCells(n);
    const only = Number.isInteger(o.mask) && o.mask >= 0 && o.mask < 8 ? o.mask : -1;
    let best = null;
    for (let k = 0; k < 8; k++) {
      if (only >= 0 && k !== only) continue;
      const t = m.map((row, y) => row.map((dark, x) => (fn[y][x] ? dark : dark !== MASKS[k](x, y))));
      const bits = formatBits(L, k);
      cells.forEach((pair, i) => pair.forEach(([x, y]) => { t[y][x] = ((bits >>> i) & 1) === 1; }));
      const p = penalty(t);
      if (!best || p < best.p) best = { p, k, t };
    }
    return { version: v, size: n, ecc, mask: best.k, modules: best.t };
  }

  const attr = (s) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  // margin: quiet zone in modules (keep 4 for phone cameras); size: width/height
  // attribute (px number or CSS length; 0 leaves sizing to CSS); mask: as for matrix().
  function svg(text, opts) {
    const o = opts || {};
    const q = matrix(text, { ecc: o.ecc || 'M', mask: o.mask });
    const margin = Math.max(0, Math.floor(o.margin == null ? 4 : +o.margin) || 0);
    const dim = q.size + margin * 2, size = o.size == null ? 200 : o.size;
    let d = '';
    q.modules.forEach((row, y) => {
      for (let x = 0; x < q.size; x++) {
        if (!row[x]) continue;
        const x0 = x;
        while (x + 1 < q.size && row[x + 1]) x++;
        d += `M${x0 + margin} ${y + margin}h${x - x0 + 1}v1h-${x - x0 + 1}z`;
      }
    });
    const box = size ? ` width="${attr(size)}" height="${attr(size)}"` : '';
    const a11y = o.label ? ` role="img" aria-label="${attr(o.label)}"` : ' aria-hidden="true"';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}"${box}${a11y} shape-rendering="crispEdges">` +
      `<rect width="${dim}" height="${dim}" fill="${attr(o.light || '#ffffff')}"/>` +
      `<path d="${d}" fill="${attr(o.dark || '#0b1220')}"/></svg>`;
  }

  return { matrix, svg, _rs: ecCodewords };  // _rs: Reed–Solomon, exposed for the dev tests
})();
