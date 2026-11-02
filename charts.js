/* ═══════════════════════════════════════════════════════════
   CryptoJournal — chart library (canvas + DOM, no dependencies)
   Rules: solid hairline grid, 2px lines, ≤24px bars rounded only at
   the data end, ~10% area washes, ringed markers, crosshair hover on
   lines, per-mark hover on bars/cells, values lead in tooltips.
   Colours are read from CSS custom properties at render time, so a
   palette switch (e.g. colour-blind mode) re-tints every chart.
   ═══════════════════════════════════════════════════════════ */
const Charts = (() => {
  const css = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fb;
  function T() {
    // up/down/accent are MARK colours (validated chart tokens); text colours stay in CSS
    return {
      up: css('--chart-up', css('--up', '#14A97C')), down: css('--chart-down', css('--down', '#E5484D')), flat: css('--flat', '#7E8AAE'),
      accent: css('--chart-s1', '#3987E5'), accentL: css('--violet-l', '#7DD3FC'), amber: css('--amber', '#FFB84D'),
      s1: css('--chart-s1', '#3987E5'), s2: css('--chart-s2', '#C98500'), s3: css('--chart-s3', '#9085E9'),
      grid: css('--chart-grid', 'rgba(255,255,255,.06)'), axis: css('--chart-axis', 'rgba(255,255,255,.16)'),
      text: css('--t2', '#93A2C6'), muted: css('--t3', '#5C6A8E'), surface: css('--chart-surface', '#0b1222'),
    };
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FONT = (px, w) => `${w || 500} ${px}px Inter, system-ui, sans-serif`;

  // hex or rgb() → rgba() with alpha
  function alpha(c, a) {
    c = (c || '').trim();
    if (c.startsWith('#')) {
      let h = c.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(',').map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
    return c;
  }

  function setup(cv) {
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.parentElement.getBoundingClientRect();
    const W = Math.max(10, rect.width), H = Math.max(10, rect.height);
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  }
  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return { lo: 0, hi: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
    if (min === max) { const p = Math.abs(min) * 0.1 || 1; min -= p; max += p; }
    const raw = (max - min) / (count || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const st = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / st) * st, hi = Math.ceil(max / st) * st;
    const ticks = []; for (let v = lo; v <= hi + st / 2; v += st) ticks.push(+v.toPrecision(12));
    return { lo, hi, step: st, ticks };
  }
  function empty(ctx, W, H, msg) {
    const t = T();
    ctx.fillStyle = t.muted; ctx.font = FONT(12.5, 500); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(msg || 'Not enough data yet', W / 2, H / 2);
  }
  function placeTip(tip, x, y, W, html) {
    if (!tip) return;
    tip.innerHTML = html; tip.style.display = 'block';
    const bw = tip.offsetWidth, bh = tip.offsetHeight;
    tip.style.left = Math.min(Math.max(x - bw / 2, 4), W - bw - 4) + 'px';
    tip.style.top = Math.max(y - bh - 14, 2) + 'px';
  }
  const hideTip = (tip) => { if (tip) tip.style.display = 'none'; };
  const tipHtml = (value, label, extra, cls) =>
    `<div class="tt-v ${cls || ''}">${value}</div><div class="tt-l">${esc(label)}</div>${extra ? `<div class="tt-x">${extra}</div>` : ''}`;

  /* ── Line / area chart with crosshair ───────────────────── */
  // pts: [{ y, label, sub?, extra? }]; opts: { color, fmtY, fmtAxis, baseline, emptyMsg, padL, onHover(i), zeroLine }
  function line(cv, tip, pts, opts) {
    opts = opts || {};
    if (!cv) return null;
    const { ctx, W, H } = setup(cv);
    const t = T();
    if (!pts || pts.length < 2) { empty(ctx, W, H, opts.emptyMsg); hideTip(tip); cv.onpointermove = cv.onpointerleave = null; return null; }
    const padL = opts.padL || 52, padR = 14, padT = 10, padB = 22;
    const ys = pts.map(p => p.y).concat(opts.baseline != null ? [opts.baseline] : []);
    const nt = niceTicks(Math.min(...ys), Math.max(...ys), 4);
    const X = i => padL + (W - padL - padR) * (i / (pts.length - 1));
    const Y = v => padT + (H - padT - padB) * (1 - (v - nt.lo) / (nt.hi - nt.lo));
    const color = opts.color || t.accent;
    const fmtAxis = opts.fmtAxis || (v => String(v));
    function base() {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.strokeStyle = t.grid; ctx.fillStyle = t.muted; ctx.font = FONT(10.5);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of nt.ticks) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillText(fmtAxis(v), padL - 8, y);
      }
      if (opts.baseline != null) {
        const y = Math.round(Y(opts.baseline)) + 0.5;
        ctx.strokeStyle = t.axis; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]);
      }
      // area wash (~10%)
      const g = ctx.createLinearGradient(0, padT, 0, H - padB);
      g.addColorStop(0, alpha(color, 0.16)); g.addColorStop(1, alpha(color, 0));
      ctx.beginPath(); ctx.moveTo(X(0), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i].y));
      ctx.lineTo(X(pts.length - 1), H - padB); ctx.lineTo(X(0), H - padB); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(0), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i].y));
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      // x labels
      ctx.fillStyle = t.muted; ctx.font = FONT(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const maxLabels = Math.max(2, Math.floor((W - padL) / 90));
      const step = Math.max(1, Math.ceil(pts.length / maxLabels));
      for (let i = 0; i < pts.length; i += step) ctx.fillText(pts[i].label || '', X(i), H - padB + 6);
      // end marker
      dot(X(pts.length - 1), Y(pts[pts.length - 1].y), color);
    }
    function dot(x, y, c) {
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = t.surface; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
    }
    function hover(i) {
      base();
      const x = X(i);
      ctx.strokeStyle = t.axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, H - padB); ctx.stroke();
      dot(x, Y(pts[i].y), color);
      const p = pts[i];
      placeTip(tip, x, Y(p.y), W, tipHtml((opts.fmtY || String)(p.y), [p.label, p.sub].filter(Boolean).join(' · '), p.extra));
    }
    base();
    const nearest = (mx) => { let b = 0, bd = Infinity; for (let i = 0; i < pts.length; i++) { const d = Math.abs(X(i) - mx); if (d < bd) { bd = d; b = i; } } return b; };
    cv.onpointermove = (ev) => { const r = cv.getBoundingClientRect(); const i = nearest(ev.clientX - r.left); hover(i); if (opts.onHover) opts.onHover(i); };
    cv.onpointerleave = () => { hideTip(tip); base(); if (opts.onHover) opts.onHover(null); };
    return { hover: (i) => (i == null ? (hideTip(tip), base()) : hover(i)), X, count: pts.length };
  }

  /* ── Underwater (drawdown) panel ─────────────────────────── */
  // pts: [{ dd (≤0 fraction), label }]
  function underwater(cv, tip, pts, opts) {
    opts = opts || {};
    if (!cv) return null;
    const { ctx, W, H } = setup(cv);
    const t = T();
    if (!pts || pts.length < 2) { empty(ctx, W, H, opts.emptyMsg || 'No drawdown yet'); hideTip(tip); cv.onpointermove = cv.onpointerleave = null; return null; }
    const padL = opts.padL || 52, padR = 14, padT = 6, padB = 18;
    const minDD = Math.min(-0.0001, ...pts.map(p => p.dd));
    const nt = niceTicks(minDD, 0, 2);
    const lo = Math.min(nt.lo, minDD);
    const X = i => padL + (W - padL - padR) * (i / (pts.length - 1));
    const Y = v => padT + (H - padT - padB) * ((0 - v) / (0 - lo));
    const c = t.down;
    let worst = 0; pts.forEach((p, i) => { if (p.dd < pts[worst].dd) worst = i; });
    function base() {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.font = FONT(10.5); ctx.fillStyle = t.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of nt.ticks.filter(v => v <= 0 && v >= lo)) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? t.axis : t.grid;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillText((v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0) + '%', padL - 8, y);
      }
      ctx.beginPath(); ctx.moveTo(X(0), Y(0));
      for (let i = 0; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i].dd));
      ctx.lineTo(X(pts.length - 1), Y(0)); ctx.closePath();
      ctx.fillStyle = alpha(c, 0.14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(0), Y(pts[0].dd));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i].dd));
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      if (pts[worst].dd < 0) {
        const x = X(worst), y = Y(pts[worst].dd);
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = t.surface; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
        ctx.fillStyle = t.text; ctx.font = FONT(10.5, 600); ctx.textBaseline = 'top';
        const lab = 'Max ' + (pts[worst].dd * 100).toFixed(1) + '%';
        ctx.textAlign = x > W - 80 ? 'right' : x < padL + 40 ? 'left' : 'center';
        ctx.fillText(lab, x, Math.min(y + 8, H - padB - 12));
      }
    }
    function hover(i) {
      base();
      const x = X(i);
      ctx.strokeStyle = t.axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, H - padB); ctx.stroke();
      placeTip(tip, x, Y(pts[i].dd), W, tipHtml((pts[i].dd * 100).toFixed(2) + '%', 'Drawdown · ' + (pts[i].label || ''), null, pts[i].dd < 0 ? 'neg' : ''));
    }
    base();
    const nearest = (mx) => { let b = 0, bd = Infinity; for (let i = 0; i < pts.length; i++) { const d = Math.abs(X(i) - mx); if (d < bd) { bd = d; b = i; } } return b; };
    cv.onpointermove = (ev) => { const r = cv.getBoundingClientRect(); const i = nearest(ev.clientX - r.left); hover(i); if (opts.onHover) opts.onHover(i); };
    cv.onpointerleave = () => { hideTip(tip); base(); if (opts.onHover) opts.onHover(null); };
    return { hover: (i) => (i == null ? (hideTip(tip), base()) : hover(i)) };
  }

  /* ── Column chart (diverging around zero) ───────────────── */
  // bars: [{ v, label, sub?, extra?, color? }]; opts: { fmtY, fmtAxis, emptyMsg, labelExtremes }
  function bars(cv, tip, data, opts) {
    opts = opts || {};
    if (!cv) return;
    const { ctx, W, H } = setup(cv);
    const t = T();
    if (!data || !data.length) { empty(ctx, W, H, opts.emptyMsg); hideTip(tip); cv.onpointermove = cv.onpointerleave = null; return; }
    const padL = opts.padL || 52, padR = 12, padT = 16, padB = 22;
    const vs = data.map(b => b.v);
    const nt = niceTicks(Math.min(0, ...vs), Math.max(0, ...vs), 4);
    const Y = v => padT + (H - padT - padB) * (1 - (v - nt.lo) / (nt.hi - nt.lo));
    const slot = (W - padL - padR) / data.length;
    const bw = Math.max(2, Math.min(24, slot * 0.62));
    const fmtAxis = opts.fmtAxis || (v => String(v));
    const rects = data.map((b, i) => ({ x: padL + slot * i + (slot - bw) / 2, w: bw, b, i }));
    let hot = -1;
    function base() {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.font = FONT(10.5); ctx.fillStyle = t.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of nt.ticks) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? t.axis : t.grid;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillText(fmtAxis(v), padL - 8, y);
      }
      const y0 = Y(0);
      for (const r of rects) {
        const y = Y(r.b.v), top = Math.min(y, y0), h = Math.max(1.5, Math.abs(y - y0));
        const col = r.b.color || (r.b.v >= 0 ? t.up : t.down);
        ctx.fillStyle = r.i === hot ? alpha(col, 1) : alpha(col, 0.88);
        const rad = Math.min(4, r.w / 2, h);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(r.x, top, r.w, h, r.b.v >= 0 ? [rad, rad, 0, 0] : [0, 0, rad, rad]); else ctx.rect(r.x, top, r.w, h);
        ctx.fill();
        if (r.i === hot) { ctx.strokeStyle = alpha('#ffffff', 0.5); ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.fillStyle = t.muted; ctx.font = FONT(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const maxLabels = Math.max(2, Math.floor((W - padL) / 46));
      const step = Math.max(1, Math.ceil(data.length / maxLabels));
      rects.forEach(r => { if (r.i % step === 0) ctx.fillText(r.b.label || '', r.x + r.w / 2, H - padB + 6); });
      if (opts.labelExtremes && data.length > 1) {
        let mx = 0, mn = 0; data.forEach((b, i) => { if (b.v > data[mx].v) mx = i; if (b.v < data[mn].v) mn = i; });
        ctx.font = FONT(10.5, 600); ctx.fillStyle = t.text;
        [mx, mn].forEach(i => {
          const r = rects[i], v = data[i].v; if (!v) return;
          ctx.textBaseline = v >= 0 ? 'bottom' : 'top';
          ctx.fillText((opts.fmtY || String)(v), r.x + r.w / 2, v >= 0 ? Y(v) - 3 : Y(v) + 3);
        });
      }
    }
    base();
    const show = (hit) => {
      if (!hit) { if (hot !== -1) { hot = -1; base(); } hideTip(tip); return; }
      if (hot !== hit.i) { hot = hit.i; base(); }
      placeTip(tip, hit.x + hit.w / 2, Math.min(Y(hit.b.v), Y(0)), W,
        tipHtml((opts.fmtY || String)(hit.b.v), [hit.b.label, hit.b.sub].filter(Boolean).join(' · '), hit.b.extra, hit.b.v > 0 ? 'pos' : hit.b.v < 0 ? 'neg' : ''));
    };
    const hitAt = (ev) => { const rr = cv.getBoundingClientRect(); const mx = ev.clientX - rr.left; return rects.find(r => mx >= r.x - (slot - r.w) / 2 && mx <= r.x + r.w + (slot - r.w) / 2); };
    cv.onpointermove = (ev) => { const h = hitAt(ev); show(h); cv.style.cursor = h && opts.onClick ? 'pointer' : ''; };
    cv.onpointerleave = () => { hot = -1; hideTip(tip); base(); };
    // opts.onClick(i, item): drill-down by click, or Enter on the keyboard-focused bar
    cv.onclick = opts.onClick ? (ev) => { const h = hitAt(ev); if (h) opts.onClick(h.i, h.b); } : null;
    keyNav(cv, rects.length, (i) => show(i == null ? null : rects[i]));
    if (opts.onClick) { const kn = cv.onkeydown; cv.onkeydown = (ev) => { if (ev.key === 'Enter' && hot >= 0) { ev.preventDefault(); opts.onClick(hot, rects[hot].b); } else kn(ev); }; }
  }

  /* ── Candlestick chart for trade replay ─────────────────── */
  // candles: [{t,o,h,l,c}]; opts: { entry:{t,price}, exit:{t,price}, levels:[{price,label,kind}], fmtP, side }
  function candles(cv, tip, cs, opts) {
    opts = opts || {};
    if (!cv) return;
    const { ctx, W, H } = setup(cv);
    const t = T();
    if (!cs || cs.length < 2) { empty(ctx, W, H, opts.emptyMsg || 'No price history available'); hideTip(tip); cv.onpointermove = cv.onpointerleave = null; return; }
    const padL = 8, padR = 64, padT = 12, padB = 22;
    const prices = cs.flatMap(c => [c.h, c.l]).concat((opts.levels || []).map(l => l.price)).concat([opts.entry, opts.exit].filter(Boolean).map(m => m.price));
    let lo = Math.min(...prices), hi = Math.max(...prices); const pad = (hi - lo) * 0.06 || hi * 0.01; lo -= pad; hi += pad;
    const slot = (W - padL - padR) / cs.length;
    const bw = Math.max(1, Math.min(10, slot * 0.66));
    const X = i => padL + slot * i + slot / 2;
    const Y = p => padT + (H - padT - padB) * (1 - (p - lo) / (hi - lo));
    const fmtP = opts.fmtP || (v => String(v));
    const tIdx = (ms) => { let b = 0, bd = Infinity; cs.forEach((c, i) => { const d = Math.abs(c.t - ms); if (d < bd) { bd = d; b = i; } }); return b; };
    function base(hi2) {
      ctx.clearRect(0, 0, W, H);
      const nt = niceTicks(lo, hi, 4);
      ctx.lineWidth = 1; ctx.font = FONT(10.5); ctx.fillStyle = t.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const v of nt.ticks) { if (v < lo || v > hi) continue; const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = t.grid; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(fmtP(v), W - padR + 6, y); }
      // planned levels (dashed = threshold)
      for (const l of (opts.levels || [])) {
        if (l.price == null) continue;
        const y = Math.round(Y(l.price)) + 0.5;
        const col = l.kind === 'stop' ? t.down : l.kind === 'target' ? t.up : t.accentL;
        ctx.strokeStyle = alpha(col, 0.75); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.font = FONT(10, 700); ctx.textAlign = 'left'; ctx.fillText(l.label, W - padR + 6, y);
      }
      cs.forEach((c, i) => {
        const up = c.c >= c.o, col = up ? t.up : t.down, x = X(i);
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(c.h)); ctx.lineTo(Math.round(x) + 0.5, Y(c.l)); ctx.stroke();
        const top = Y(Math.max(c.o, c.c)), h = Math.max(1, Math.abs(Y(c.o) - Y(c.c)));
        ctx.fillStyle = i === hi2 ? col : alpha(col, 0.85); ctx.fillRect(x - bw / 2, top, bw, h);
      });
      const mark = (m, kind) => {
        if (!m || m.t == null || m.price == null) return;
        const i = tIdx(m.t), x = X(i), y = Y(m.price);
        const col = kind === 'entry' ? t.accentL : (opts.win ? t.up : t.down);
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = t.surface; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = t.text; ctx.font = FONT(10, 700); ctx.textAlign = 'center'; ctx.textBaseline = kind === 'entry' ? 'top' : 'bottom';
        ctx.fillText(kind === 'entry' ? 'IN' : 'OUT', x, kind === 'entry' ? y + 9 : y - 9);
      };
      mark(opts.entry, 'entry'); mark(opts.exit, 'exit');
      ctx.fillStyle = t.muted; ctx.font = FONT(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const step = Math.max(1, Math.ceil(cs.length / Math.max(2, Math.floor((W - padR) / 90))));
      const fmtT = opts.fmtT || (ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      for (let i = 0; i < cs.length; i += step) ctx.fillText(fmtT(cs[i].t), X(i), H - padB + 6);
    }
    base(-1);
    cv.onpointermove = (ev) => {
      const r = cv.getBoundingClientRect(); const mx = ev.clientX - r.left;
      const i = Math.max(0, Math.min(cs.length - 1, Math.floor((mx - padL) / slot)));
      base(i);
      const x = X(i); ctx.strokeStyle = T().axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, H - padB); ctx.stroke();
      const c = cs[i];
      placeTip(tip, x, Y(c.h), W, `<div class="tt-v">${fmtP(c.c)}</div><div class="tt-l">${esc(new Date(c.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div><div class="tt-x">O ${fmtP(c.o)} · H ${fmtP(c.h)} · L ${fmtP(c.l)}</div>`);
    };
    cv.onpointerleave = () => { hideTip(tip); base(-1); };
  }

  /* ── P&L calendar heatmap (DOM, accessible) ─────────────── */
  // days: Map 'YYYY-MM-DD' → { pl, n, wins, losses, note? }
  // opts: { year, month (0-11), fmt, value(d) → number (default d.pl), onDay(key), clickAll (empty days clickable too), today, notes:Set(keys) }
  // Colour cap = 95th percentile of |value| so one huge day does not wash out the rest.
  function calendar(el, days, opts) {
    if (!el) return;
    const y = opts.year, m = opts.month;
    const first = new Date(y, m, 1), lastDay = new Date(y, m + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const keys = [];
    for (let d = 1; d <= lastDay; d++) keys.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    const valOf = opts.value || (d => d.pl);
    const src = new Map();
    // value(d) may return null (e.g. R view on a day whose trades have no stop) → shown as '—', uncoloured
    for (const k of keys) { const d = days.get(k); if (d) { const v = valOf(d); src.set(k, { ...d, pl: v == null || !isFinite(v) ? 0 : v, na: v == null || !isFinite(v) }); } }
    days = src;
    const marks = opts.marks || new Map(); // key → { cls, badge, label } decorations (e.g. rule-break markers)
    const absVals = [...src.values()].map(d => Math.abs(d.pl)).filter(v => v > 0).sort((a, b) => a - b);
    const maxAbs = Math.max(1e-9, absVals.length ? absVals[Math.min(absVals.length - 1, Math.floor(absVals.length * 0.95))] : 1);
    const fmt = opts.fmt || (v => v.toFixed(0));
    const notes = opts.notes || new Set();
    const cellBg = (pl) => {
      if (!pl) return '';
      const s = Math.min(1, Math.abs(pl) / maxAbs);
      const a = (0.12 + 0.5 * Math.sqrt(s)).toFixed(3);
      return `background:${alpha(pl > 0 ? T().up : T().down, a)}`;
    };
    const head = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map(d => `<div class="cal-h">${d}</div>`).join('');
    let cells = '', weekPL = 0, weekN = 0, col = 0;
    const flushWeek = () => {
      cells += `<div class="cal-week ${weekPL > 0 ? 'pos' : weekPL < 0 ? 'neg' : ''}"><span class="wl">Week</span><b>${weekN ? fmt(weekPL) : '—'}</b><span class="wn">${weekN ? weekN + ' trade' + (weekN === 1 ? '' : 's') : ''}</span></div>`;
      weekPL = 0; weekN = 0; col = 0;
    };
    for (let i = 0; i < lead; i++) { cells += '<div class="cal-d blank"></div>'; col++; }
    keys.forEach((k, idx) => {
      const d = days.get(k);
      const pl = d ? d.pl : 0, n = d ? d.n : 0;
      weekPL += pl; weekN += n;
      const isToday = k === opts.today;
      const mk = marks.get(k);
      const shown = d && d.na ? '—' : fmt(pl);
      const label = `${new Date(y, m, idx + 1).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${n ? shown + ', ' + n + ' trade' + (n === 1 ? '' : 's') : 'no trades'}${mk && mk.label ? ', ' + mk.label : ''}`;
      cells += `<button type="button" class="cal-d ${n ? 'has' : ''} ${n && !d.na && pl > 0 ? 'pos' : n && !d.na && pl < 0 ? 'neg' : n ? 'flat' : ''} ${isToday ? 'today' : ''} ${mk && mk.cls ? esc(mk.cls) : ''}" data-day="${k}" style="${d && d.na ? '' : cellBg(pl)}" aria-label="${esc(label)}">
        <span class="dn">${idx + 1}</span>${notes.has(k) ? '<i class="note-dot" aria-hidden="true"></i>' : ''}${mk && mk.badge ? `<i class="cal-mark" aria-hidden="true" title="${esc(mk.label || '')}">${esc(mk.badge)}</i>` : ''}${n ? `<span class="dp">${shown}</span><span class="dt">${n} trade${n === 1 ? '' : 's'}${d.wins != null ? ` · ${Math.round((d.wins / n) * 100)}%` : ''}</span>` : ''}</button>`;
      col++;
      if (col === 7) flushWeek();
    });
    if (col > 0) { while (col < 7) { cells += '<div class="cal-d blank"></div>'; col++; } flushWeek(); }
    el.innerHTML = `<div class="cal-grid">${head}${cells}</div>`;
    if (opts.onDay) el.querySelectorAll(opts.clickAll ? '.cal-d[data-day]' : '.cal-d.has').forEach(b => b.onclick = () => opts.onDay(b.dataset.day));
  }

  /* ── Heat grid (e.g. weekday × hour) ─────────────────────── */
  // grid: { rows:[label], cols:[label], cells:[[{v,n}|null]] }
  // opts: { fmt, clamp (symmetric, e.g. 2 for ±2R), minN (cells below are hatched, uncoloured), onCell(ri, ci) }
  function heatgrid(el, grid, opts) {
    if (!el) return;
    opts = opts || {};
    const minN = opts.minN || 1;
    const all = grid.cells.flat().filter(c => c && c.n >= minN).map(c => c.v);
    const maxAbs = opts.clamp || Math.max(1e-9, ...all.map(Math.abs));
    const fmt = opts.fmt || (v => v.toFixed(0));
    let html = `<div class="hg" style="grid-template-columns: 44px repeat(${grid.cols.length}, minmax(0,1fr))"><div></div>` +
      grid.cols.map(c => `<div class="hg-c">${esc(c)}</div>`).join('');
    grid.rows.forEach((r, ri) => {
      html += `<div class="hg-r">${esc(r)}</div>`;
      grid.cols.forEach((c, ci) => {
        const cell = grid.cells[ri][ci];
        if (!cell || !cell.n) { html += `<div class="hg-x empty" title="${esc(r + ' ' + c)}: no trades"></div>`; return; }
        if (cell.n < minN) { html += `<button type="button" class="hg-x thin" data-r="${ri}" data-c="${ci}" title="${esc(`${r} ${c}: n=${cell.n} — too few to read`)}" aria-label="${esc(`${r} ${c}: ${cell.n} trades, too few`)}"></button>`; return; }
        const s = Math.min(1, Math.abs(cell.v) / maxAbs);
        const bg = alpha(cell.v >= 0 ? T().up : T().down, (0.14 + 0.6 * Math.sqrt(s)).toFixed(3));
        const tt = `${r} ${c}: ${fmt(cell.v)} · ${cell.n} trade${cell.n === 1 ? '' : 's'}`;
        html += `<button type="button" class="hg-x" data-r="${ri}" data-c="${ci}" style="background:${bg}" title="${esc(tt)}" aria-label="${esc(tt)}"></button>`;
      });
    });
    el.innerHTML = html + '</div>';
    if (opts.onCell) el.querySelectorAll('button.hg-x').forEach(b => b.onclick = () => opts.onCell(+b.dataset.r, +b.dataset.c));
  }

  /* ── Diverging horizontal bars (DOM) ─────────────────────── */
  // rows: [{ label, v, sub?, n? }]; opts: { fmt }
  function hbars(el, rows, opts) {
    if (!el) return;
    opts = opts || {};
    if (!rows || !rows.length) { el.innerHTML = `<div class="muted" style="padding:14px 2px;font-size:12.5px">${esc(opts.emptyMsg || 'No data yet')}</div>`; return; }
    const maxAbs = Math.max(1e-9, ...rows.map(r => Math.abs(r.v)));
    const fmt = opts.fmt || (v => v.toFixed(2));
    el.innerHTML = `<div class="hb">` + rows.map(r => {
      const w = (Math.abs(r.v) / maxAbs) * 50;
      const pos = r.v >= 0;
      return `<div class="hb-row" title="${esc(r.label)}: ${esc(fmt(r.v))}${r.sub ? ' · ' + esc(r.sub) : ''}">
        <div class="hb-l"><span>${esc(r.label)}</span>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div>
        <div class="hb-track"><div class="hb-mid"></div><div class="hb-bar ${pos ? 'pos' : 'neg'}" style="${pos ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></div></div>
        <div class="hb-v ${r.v > 0 ? 'pos' : r.v < 0 ? 'neg' : ''}">${esc(fmt(r.v))}</div></div>`;
    }).join('') + '</div>';
  }

  /* ── Tiny SVGs: sparkline + ring gauge ───────────────────── */
  function spark(values, o) {
    o = o || {};
    const w = o.w || 96, h = o.h || 28;
    if (!values || values.length < 2) return `<svg width="${w}" height="${h}" aria-hidden="true"></svg>`;
    const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
    const pts = values.map((v, i) => `${(i / (values.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - (v - lo) / span * (h - 6)).toFixed(1)}`).join(' ');
    const col = o.color || T().accentL;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function gauge(frac, o) {
    o = o || {};
    const size = o.size || 120, sw = o.stroke || 10, r = (size - sw) / 2, c = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, frac || 0));
    const col = o.color || (f >= 0.8 ? T().up : f >= 0.5 ? T().amber : T().down);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="transform:rotate(-90deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${alpha(col, 0.16)}" stroke-width="${sw}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}"/></svg>`;
  }

  /* ── Accessibility helpers ───────────────────────────────── */
  // Canvas charts get role=img + a generated summary; arrow keys move the crosshair.
  function label(cv, text) { if (!cv) return; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', text || ''); }
  function keyNav(cv, count, hover) {
    if (!cv) return;
    let i = -1; cv.tabIndex = 0;
    cv.onkeydown = (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(ev.key)) return;
      ev.preventDefault();
      if (ev.key === 'Escape') { i = -1; hover(null); return; }
      i = ev.key === 'Home' ? 0 : ev.key === 'End' ? count - 1 : Math.max(0, Math.min(count - 1, (i < 0 ? count - 1 : i) + (ev.key === 'ArrowLeft' ? -1 : 1)));
      hover(i);
    };
    cv.onblur = () => { i = -1; hover(null); };
  }
  function dotAt(ctx, x, y, c, r) {
    const t = T(); r = r || 4;
    ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fillStyle = t.surface; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
  }
  const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  /* ── Time-scaled equity with synced underwater panel ────── */
  // pts: [{ t (ms), y, dd (≤0 fraction, optional), label?, extra? }]
  // opts: { color, fmtY, fmtAxis, peak:true, under:true, flows:[{t, amt, kind:'deposit'|'withdrawal'}], emptyMsg, ghost, onHover(i) }
  function equity(cv, tip, pts, opts) {
    opts = opts || {};
    if (!cv) return null;
    const { ctx, W, H } = setup(cv);
    const t = T();
    const color = opts.color || t.accent;
    if (!pts || pts.length < 2) {
      if (opts.ghost) { // dashed example curve so an empty dashboard still explains itself
        ctx.setLineDash([5, 5]); ctx.strokeStyle = alpha(t.text, 0.25); ctx.lineWidth = 2; ctx.beginPath();
        const ex = [0, .05, .02, .09, .07, .14, .11, .19, .16, .24, .3];
        ex.forEach((v, i) => { const x = 52 + (W - 66) * i / (ex.length - 1), y = H * 0.72 - v * H * 1.6; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = alpha(t.text, 0.5); ctx.font = FONT(10.5, 700); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('EXAMPLE', W - 16, H * 0.72 - 0.3 * H * 1.6 - 6);
      }
      empty(ctx, W, H * (opts.ghost ? 1.6 : 1), opts.emptyMsg); hideTip(tip); cv.onpointermove = cv.onpointerleave = null; return null;
    }
    const under = opts.under !== false && pts.some(p => p.dd != null);
    const padL = opts.padL || 56, padR = 14, padT = 10, padB = 22, gap = 10;
    const hMain = under ? Math.round((H - padT - padB - gap) * 0.72) : H - padT - padB;
    const uTop = padT + hMain + gap, uH = H - padB - uTop;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1, span = Math.max(1, t1 - t0);
    const X = (ms) => padL + (W - padL - padR) * ((ms - t0) / span);
    let peak = -Infinity; const peaks = pts.map(p => (peak = Math.max(peak, p.y)));
    const ys = pts.map(p => p.y).concat(opts.baseline != null ? [opts.baseline] : []);
    const nt = niceTicks(Math.min(...ys), Math.max(...ys), 4);
    const Y = v => padT + hMain * (1 - (v - nt.lo) / (nt.hi - nt.lo));
    const minDD = under ? Math.min(-0.0001, ...pts.map(p => p.dd || 0)) : 0;
    const ut = niceTicks(minDD, 0, 2), uLo = Math.min(ut.lo, minDD);
    const YU = v => uTop + uH * ((0 - v) / (0 - uLo));
    const fmtAxis = opts.fmtAxis || (v => String(v));
    let worst = 0; if (under) pts.forEach((p, i) => { if ((p.dd || 0) < (pts[worst].dd || 0)) worst = i; });
    function base() {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.font = FONT(10.5); ctx.fillStyle = t.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of nt.ticks) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = v === 0 ? t.axis : t.grid; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(fmtAxis(v), padL - 8, y); }
      // area wash + line
      const g = ctx.createLinearGradient(0, padT, 0, padT + hMain);
      g.addColorStop(0, alpha(color, 0.14)); g.addColorStop(1, alpha(color, 0));
      ctx.beginPath(); ctx.moveTo(X(pts[0].t), Y(pts[0].y)); pts.forEach(p => ctx.lineTo(X(p.t), Y(p.y)));
      ctx.lineTo(X(t1), padT + hMain); ctx.lineTo(X(t0), padT + hMain); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      if (opts.peak !== false) { ctx.setLineDash([3, 4]); ctx.strokeStyle = alpha(t.text, 0.4); ctx.lineWidth = 1; ctx.beginPath(); pts.forEach((p, i) => { const x = X(p.t), y = Y(peaks[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]); }
      ctx.beginPath(); pts.forEach((p, i) => { const x = X(p.t), y = Y(p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      dotAt(ctx, X(pts[pts.length - 1].t), Y(pts[pts.length - 1].y), color);
      // cash-flow markers on the main panel's floor
      for (const f of (opts.flows || [])) {
        if (f.t < t0 || f.t > t1) continue;
        const x = X(f.t), y = padT + hMain - 2, dep = f.kind === 'deposit';
        ctx.fillStyle = dep ? t.accentL : t.amber; ctx.beginPath();
        if (dep) { ctx.moveTo(x, y - 8); ctx.lineTo(x - 5, y); ctx.lineTo(x + 5, y); } else { ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 8); ctx.lineTo(x + 5, y - 8); }
        ctx.closePath(); ctx.fill();
      }
      if (under) {
        ctx.font = FONT(10.5); ctx.fillStyle = t.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (const v of ut.ticks.filter(v => v <= 0 && v >= uLo)) { const y = Math.round(YU(v)) + 0.5; ctx.strokeStyle = v === 0 ? t.axis : t.grid; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText((v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0) + '%', padL - 8, y); }
        ctx.beginPath(); ctx.moveTo(X(t0), YU(0)); pts.forEach(p => ctx.lineTo(X(p.t), YU(p.dd || 0))); ctx.lineTo(X(t1), YU(0)); ctx.closePath();
        ctx.fillStyle = alpha(t.down, 0.16); ctx.fill();
        ctx.beginPath(); pts.forEach((p, i) => { const x = X(p.t), y = YU(p.dd || 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = t.down; ctx.lineWidth = 1.5; ctx.stroke();
        if ((pts[worst].dd || 0) < 0) {
          const x = X(pts[worst].t), y = YU(pts[worst].dd); dotAt(ctx, x, y, t.down, 3);
          ctx.fillStyle = t.text; ctx.font = FONT(10.5, 600); ctx.textBaseline = 'middle';
          ctx.textAlign = x > W - 90 ? 'right' : 'left';
          ctx.fillText('Max ' + (pts[worst].dd * 100).toFixed(1) + '%', x + (x > W - 90 ? -8 : 8), Math.min(y, H - padB - 6));
        }
      }
      // time axis
      ctx.fillStyle = t.muted; ctx.font = FONT(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const nLab = Math.max(2, Math.floor((W - padL) / 96));
      for (let k = 0; k <= nLab; k++) { const ms = t0 + span * k / nLab; const x = X(ms); ctx.textAlign = k === 0 ? 'left' : k === nLab ? 'right' : 'center'; ctx.fillText(fmtDay(ms), x, H - padB + 6); }
    }
    function hover(i) {
      base(); if (i == null) { hideTip(tip); return; }
      const p = pts[i], x = X(p.t);
      ctx.strokeStyle = t.axis; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, H - padB); ctx.stroke();
      dotAt(ctx, x, Y(p.y), color);
      if (under) dotAt(ctx, x, YU(p.dd || 0), t.down, 3);
      const ddTxt = under && p.dd != null ? `Drawdown ${(p.dd * 100).toFixed(2)}%` : '';
      placeTip(tip, x, Y(p.y), W, tipHtml((opts.fmtY || String)(p.y), [p.label || new Date(p.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' · '), [ddTxt, p.extra].filter(Boolean).join('<br>')));
      if (opts.onHover) opts.onHover(i);
    }
    base();
    const nearest = (mx) => { let b = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.abs(X(p.t) - mx); if (d < bd) { bd = d; b = i; } }); return b; };
    cv.onpointermove = (ev) => { const r = cv.getBoundingClientRect(); hover(nearest(ev.clientX - r.left)); };
    cv.onpointerleave = () => { hideTip(tip); base(); if (opts.onHover) opts.onHover(null); };
    keyNav(cv, pts.length, hover);
    return { hover };
  }

  /* ── Several lines on ONE axis (never dual-axis) ────────── */
  // series: [{ name, color, values:[y|null], dash? }], xLabels:[...]; opts { fmtY, fmtAxis, baseline, band:{lo:[], hi:[], color} }
  function multi(cv, tip, series, xLabels, opts) {
    opts = opts || {};
    if (!cv) return null;
    const { ctx, W, H } = setup(cv);
    const t = T();
    const n = xLabels.length;
    if (n < 2 || !series.length) { empty(ctx, W, H, opts.emptyMsg); hideTip(tip); cv.onpointermove = cv.onpointerleave = null; return null; }
    const padL = opts.padL || 52, padR = opts.directLabels ? 70 : 14, padT = 10, padB = 22;
    const all = series.flatMap(s => s.values).concat(opts.band ? opts.band.lo.concat(opts.band.hi) : []).concat(opts.baseline != null ? [opts.baseline] : []).filter(v => v != null && isFinite(v));
    const nt = niceTicks(Math.min(...all), Math.max(...all), 4);
    const X = i => padL + (W - padL - padR) * (i / (n - 1));
    const Y = v => padT + (H - padT - padB) * (1 - (v - nt.lo) / (nt.hi - nt.lo));
    const fmtAxis = opts.fmtAxis || (v => String(v));
    function base() {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.font = FONT(10.5); ctx.fillStyle = t.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of nt.ticks) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = t.grid; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(fmtAxis(v), padL - 8, y); }
      if (opts.baseline != null) { const y = Math.round(Y(opts.baseline)) + 0.5; ctx.strokeStyle = t.axis; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]); }
      if (opts.band) {
        ctx.beginPath(); opts.band.hi.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(opts.band.lo[i]));
        ctx.closePath(); ctx.fillStyle = alpha(opts.band.color || t.accent, 0.12); ctx.fill();
      }
      for (const s of series) {
        ctx.beginPath(); let started = false;
        s.values.forEach((v, i) => { if (v == null || !isFinite(v)) { started = false; return; } if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v)); });
        ctx.strokeStyle = s.color || t.accent; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash ? [5, 4] : []); ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
        if (opts.directLabels) { let li = n - 1; while (li > 0 && s.values[li] == null) li--; if (s.values[li] != null) { ctx.fillStyle = t.text; ctx.font = FONT(10.5, 600); ctx.textAlign = 'left'; ctx.fillText(s.name, X(li) + 6, Y(s.values[li])); } }
      }
      ctx.fillStyle = t.muted; ctx.font = FONT(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - padL) / 80))));
      for (let i = 0; i < n; i += step) ctx.fillText(xLabels[i], X(i), H - padB + 6);
    }
    function hover(i) {
      base(); if (i == null) { hideTip(tip); return; }
      const x = X(i);
      ctx.strokeStyle = t.axis; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, H - padB); ctx.stroke();
      const rows = series.filter(s => s.values[i] != null).map(s => { dotAt(ctx, x, Y(s.values[i]), s.color || t.accent, 3); return `<div class="tt-row"><i style="background:${s.color || t.accent}"></i>${esc(s.name)} <b>${(opts.fmtY || String)(s.values[i])}</b></div>`; });
      const topY = Math.min(...series.filter(s => s.values[i] != null).map(s => Y(s.values[i])), H / 2);
      placeTip(tip, x, topY, W, `<div class="tt-l">${esc(xLabels[i])}</div>${rows.join('')}`);
    }
    base();
    cv.onpointermove = (ev) => { const r = cv.getBoundingClientRect(); const i = Math.max(0, Math.min(n - 1, Math.round((ev.clientX - r.left - padL) / ((W - padL - padR) / (n - 1))))); hover(i); };
    cv.onpointerleave = () => hover(null);
    keyNav(cv, n, hover);
    return { hover };
  }

  /* ── Scatter (e.g. MAE vs MFE in R) ──────────────────────── */
  // pts: [{ x, y, win:bool, label }]; opts: { fmtX, fmtY, xLabel, yLabel, vlines:[{x,label}], hlines:[{y,label}], xMin, yMin, onClick(p) }
  function scatter(cv, tip, pts, opts) {
    opts = opts || {};
    if (!cv) return;
    const { ctx, W, H } = setup(cv);
    const t = T();
    if (!pts || !pts.length) { empty(ctx, W, H, opts.emptyMsg); hideTip(tip); cv.onpointermove = cv.onpointerleave = cv.onclick = null; return; }
    const padL = 48, padR = 14, padT = 12, padB = 34;
    const xs = pts.map(p => p.x).concat((opts.vlines || []).map(v => v.x), [opts.xMin != null ? opts.xMin : Math.min(...pts.map(p => p.x))]);
    const ys = pts.map(p => p.y).concat((opts.hlines || []).map(v => v.y), [opts.yMin != null ? opts.yMin : Math.min(...pts.map(p => p.y))]);
    const nx = niceTicks(Math.min(...xs), Math.max(...xs), 4), ny = niceTicks(Math.min(...ys), Math.max(...ys), 4);
    const X = v => padL + (W - padL - padR) * ((v - nx.lo) / (nx.hi - nx.lo));
    const Y = v => padT + (H - padT - padB) * (1 - (v - ny.lo) / (ny.hi - ny.lo));
    const fx = opts.fmtX || (v => v.toFixed(1)), fy = opts.fmtY || (v => v.toFixed(1));
    let hot = -1;
    function base() {
      ctx.clearRect(0, 0, W, H); ctx.lineWidth = 1; ctx.font = FONT(10.5); ctx.fillStyle = t.muted;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of ny.ticks) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = t.grid; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(fy(v), padL - 6, y); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const v of nx.ticks) { const x = Math.round(X(v)) + 0.5; ctx.strokeStyle = t.grid; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke(); ctx.fillText(fx(v), x, H - padB + 5); }
      ctx.setLineDash([4, 4]); ctx.strokeStyle = alpha(t.amber, 0.8);
      for (const v of (opts.vlines || [])) { const x = Math.round(X(v.x)) + 0.5; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke(); ctx.save(); ctx.setLineDash([]); ctx.fillStyle = t.amber; ctx.font = FONT(10, 700); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(v.label || '', x + 4, padT); ctx.restore(); }
      for (const v of (opts.hlines || [])) { const y = Math.round(Y(v.y)) + 0.5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); }
      ctx.setLineDash([]);
      pts.forEach((p, i) => {
        const x = X(p.x), y = Y(p.y), r = i === hot ? 6 : 4.5;
        if (p.win) { ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, Math.PI * 2); ctx.fillStyle = t.surface; ctx.fill(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = alpha(t.up, 0.9); ctx.fill(); }
        else { ctx.strokeStyle = t.down; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); }
      });
      ctx.fillStyle = t.text; ctx.font = FONT(10.5, 600);
      if (opts.xLabel) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(opts.xLabel, padL + (W - padL - padR) / 2, H - 1); }
      if (opts.yLabel) { ctx.save(); ctx.translate(11, padT + (H - padT - padB) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(opts.yLabel, 0, 0); ctx.restore(); }
    }
    base();
    const near = (mx, my) => { let b = -1, bd = 14 * 14; pts.forEach((p, i) => { const d = (X(p.x) - mx) ** 2 + (Y(p.y) - my) ** 2; if (d < bd) { bd = d; b = i; } }); return b; };
    cv.onpointermove = (ev) => {
      const r = cv.getBoundingClientRect(); const i = near(ev.clientX - r.left, ev.clientY - r.top);
      if (i !== hot) { hot = i; base(); }
      if (i < 0) { hideTip(tip); cv.style.cursor = ''; return; }
      cv.style.cursor = opts.onClick ? 'pointer' : '';
      const p = pts[i];
      placeTip(tip, X(p.x), Y(p.y), W, tipHtml(`${fx(p.x)} · ${fy(p.y)}`, p.label || '', p.extra, p.win ? 'pos' : 'neg'));
    };
    cv.onpointerleave = () => { hot = -1; hideTip(tip); base(); };
    cv.onclick = (ev) => { if (!opts.onClick) return; const r = cv.getBoundingClientRect(); const i = near(ev.clientX - r.left, ev.clientY - r.top); if (i >= 0) opts.onClick(pts[i]); };
  }

  /* ── R-multiple histogram with reference lines ──────────── */
  // values: R numbers; opts: { binW 0.5, min −3, max 5, mean, refs:[{x,label,color,dash}], fmt }
  function histogram(cv, tip, values, opts) {
    opts = opts || {};
    if (!cv) return;
    const { ctx, W, H } = setup(cv);
    const t = T();
    values = (values || []).filter(v => v != null && isFinite(v));
    if (!values.length) { empty(ctx, W, H, opts.emptyMsg || 'Log trades with a stop to see your R distribution'); hideTip(tip); cv.onpointermove = cv.onpointerleave = null; return; }
    const bw = opts.binW || 0.5, lo = opts.min != null ? opts.min : -3, hi = opts.max != null ? opts.max : 5;
    const nb = Math.round((hi - lo) / bw) + 2; // + underflow & overflow bins
    const bins = Array.from({ length: nb }, (_, i) => ({ i, n: 0, from: i === 0 ? -Infinity : lo + (i - 1) * bw, to: i === nb - 1 ? Infinity : lo + i * bw }));
    for (const v of values) { const i = v < lo ? 0 : v >= hi ? nb - 1 : 1 + Math.floor((v - lo) / bw); bins[Math.min(nb - 1, i)].n++; }
    const padL = 34, padR = 10, padT = 18, padB = 24;
    const nt = niceTicks(0, Math.max(1, ...bins.map(b => b.n)), 3);
    const slot = (W - padL - padR) / nb, barW = Math.max(2, Math.min(24, slot - 2));
    const Xb = i => padL + slot * i + (slot - barW) / 2;
    const Xv = v => padL + slot * (v <= lo ? 1 : v >= hi ? nb - 1 : 1 + (v - lo) / bw);
    const Y = v => padT + (H - padT - padB) * (1 - v / nt.hi);
    const fmt = opts.fmt || (v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + 'R');
    const lab = (b) => (b.from === -Infinity ? `< ${fmt(lo)}` : b.to === Infinity ? `≥ ${fmt(hi)}` : `${fmt(b.from)} to ${fmt(b.to)}`);
    let hot = -1;
    function base() {
      ctx.clearRect(0, 0, W, H); ctx.lineWidth = 1; ctx.font = FONT(10.5); ctx.fillStyle = t.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of nt.ticks) { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = v === 0 ? t.axis : t.grid; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(String(v), padL - 6, y); }
      bins.forEach(b => {
        if (!b.n) return;
        const x = Xb(b.i), y = Y(b.n), h = Y(0) - y, mid = b.to === Infinity ? hi : b.from === -Infinity ? lo - bw : (b.from + b.to) / 2;
        const col = mid >= 0 ? t.up : t.down;
        const breach = b.to <= -1.0001 || b.from === -Infinity; // losses bigger than the planned stop
        ctx.fillStyle = alpha(col, b.i === hot ? 1 : breach ? 0.55 : 0.85);
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, barW, h, [Math.min(4, barW / 2), Math.min(4, barW / 2), 0, 0]); else ctx.rect(x, y, barW, h); ctx.fill();
        if (breach) { ctx.save(); ctx.clip(); ctx.strokeStyle = alpha(t.surface, 0.55); ctx.lineWidth = 2; for (let k = -h; k < barW + h; k += 6) { ctx.beginPath(); ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); ctx.stroke(); } ctx.restore(); }
      });
      const refs = [{ x: 0, label: '0R', color: t.text }, { x: -1, label: 'planned stop', color: t.amber, dash: true }].concat(opts.mean != null ? [{ x: opts.mean, label: 'avg ' + fmt(opts.mean), color: t.accentL }] : []).concat(opts.refs || []);
      refs.forEach((r, k) => {
        const x = Math.round(Xv(r.x)) + 0.5; ctx.strokeStyle = r.color; ctx.lineWidth = r.x === 0 ? 1 : 1.5; ctx.setLineDash(r.dash ? [4, 4] : []);
        ctx.beginPath(); ctx.moveTo(x, padT - 4); ctx.lineTo(x, H - padB); ctx.stroke(); ctx.setLineDash([]);
        if (r.x !== 0) { ctx.fillStyle = r.color; ctx.font = FONT(10, 700); ctx.textAlign = x > W - 90 ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText(r.label, x + (x > W - 90 ? -4 : 4), k % 2 ? 2 : padT - 14); }
      });
      ctx.fillStyle = t.muted; ctx.font = FONT(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let v = lo; v <= hi; v += 1) ctx.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + 'R', Xv(v), H - padB + 6);
    }
    base();
    cv.onpointermove = (ev) => {
      const r = cv.getBoundingClientRect(); const i = Math.floor((ev.clientX - r.left - padL) / slot);
      const b = bins[i]; if (!b || !b.n) { if (hot !== -1) { hot = -1; base(); } hideTip(tip); return; }
      if (hot !== i) { hot = i; base(); }
      const u1 = opts.unit || 'trade', uN = opts.units || u1 + 's';
      placeTip(tip, Xb(i) + barW / 2, Y(b.n), W, tipHtml(`${b.n} ${b.n === 1 ? u1 : uN}`, lab(b), `${Math.round(b.n / values.length * 100)}% of ${uN}`));
    };
    cv.onpointerleave = () => { hot = -1; hideTip(tip); base(); };
  }

  /* ── 100% stacked bar (DOM) — e.g. Win | BE | Loss ───────── */
  // segs: [{ label, v, cls:'pos'|'neg'|'flat'|'acc' }]
  function stack(el, segs, opts) {
    if (!el) return;
    const tot = segs.reduce((s, x) => s + (x.v || 0), 0);
    if (!tot) { el.innerHTML = `<div class="stk empty"></div>`; return; }
    el.innerHTML = `<div class="stk" role="img" aria-label="${esc(segs.map(s => `${s.label} ${s.v}`).join(', '))}">` + segs.filter(s => s.v > 0).map(s => {
      const p = s.v / tot * 100;
      return `<div class="stk-s ${s.cls || ''}" style="width:${p}%" title="${esc(`${s.label}: ${s.v} (${Math.round(p)}%)`)}">${p >= 14 ? `<span>${esc(s.short || s.label)} ${Math.round(p)}%</span>` : ''}</div>`;
    }).join('') + '</div>' + (opts && opts.legend ? `<div class="legend" style="margin-top:8px">${segs.map(s => `<span><i class="dot ${s.cls}"></i>${esc(s.label)} ${s.v}</span>`).join('')}</div>` : '');
  }

  return { line, underwater, equity, multi, bars, scatter, histogram, candles, calendar, heatgrid, hbars, stack, spark, gauge, label, keyNav, alpha, tokens: T, niceTicks };
})();
