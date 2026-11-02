/* ═══════════════════════════════════════════════════════════
   CryptoJournal — advanced analytics (pure functions, no DOM)
   Engine.compute() keeps spreadsheet parity; this layer adds the
   metrics professional journals and the quant literature use.
   Definitions follow the research notes (Van Tharp SQN, NIST t /
   Wilson intervals, Lo 2002 Sharpe SE, Sortino/Red Rock downside
   deviation, Tradervue efficiency, FTMO/Topstep consistency).

   Inputs are closed trade *groups* from Engine.buildGroups:
   g.netPL, g.R (net R = netPL / total $ risk, null without a stop),
   g.risk, g.changePct (flow-neutral return), g.exitMs,
   g.durationMs, g.trade (parent entry with v2 journal fields),
   g.portions[], g.win/loss/be, g.plannedR, g.avgDiscipline.
   ═══════════════════════════════════════════════════════════ */
const Metrics = (() => {
  const MS_H = 3600000, MS_DAY = 86400000;
  const isN = (v) => typeof v === 'number' && isFinite(v);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : null);
  function sd(a) { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); }
  function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }
  function pctile(sorted, p) { if (!sorted.length) return null; const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const weekKey = (ms) => { const d = new Date(ms); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return dayKey(d.getTime()); };
  const monthKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
  // Trading-day key honouring a reset hour (crypto never closes): a trade at 01:00 with reset 04 belongs to the previous day.
  const tradingDayKey = (ms, resetHour) => dayKey(ms - (resetHour || 0) * MS_H);
  const entryMs = (g) => Date.parse(g.trade.entryAt);
  const exitMs = (g) => g.exitMs;
  const R = (g) => (isN(g.R) ? g.R : null);
  const realMistakes = (e) => (e.mistakes || []).filter(m => m && m !== 'none');
  const isReviewed = (e) => Array.isArray(e.mistakes) && e.mistakes.length > 0;

  /* ── Statistics primitives ─────────────────────────────── */
  function wilson(k, n, z) {
    if (!n) return null; z = z || 1.96;
    const p = k / n, z2 = z * z, den = 1 + z2 / n;
    const c = (p + z2 / (2 * n)) / den, h = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / den;
    return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
  }
  function lgamma(z) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function betacf(a, b, x) {
    const FP = 1e-300; let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FP) d = FP; d = 1 / d; let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function tCdf(t, df) { const x = df / (df + t * t); const p = 0.5 * ibeta(x, df / 2, 0.5); return t >= 0 ? 1 - p : p; }
  // Two-sided critical t via Cornish–Fisher (z = 1.96 → 95%); accurate enough for df ≥ 5
  function tCrit(df, z) { z = z || 1.96; return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df); }
  function welch(a, b) {
    if (a.length < 2 || b.length < 2) return null;
    const m1 = mean(a), m2 = mean(b), v1 = sd(a) ** 2 / a.length, v2 = sd(b) ** 2 / b.length;
    if (!(v1 + v2 > 0)) return null;
    const t = (m1 - m2) / Math.sqrt(v1 + v2);
    const df = (v1 + v2) ** 2 / (v1 * v1 / (a.length - 1) + v2 * v2 / (b.length - 1));
    return { t, df, p: 2 * (1 - tCdf(Math.abs(t), df)), diff: m1 - m2 };
  }
  // P(at least one losing run ≥ k within N trades) at loss rate q — exact DP over the current run length
  function pLosingRun(q, k, N) {
    if (!(q > 0) || k < 1) return 0;
    let a = new Array(k).fill(0); a[0] = 1; let hit = 0;
    for (let i = 0; i < N; i++) {
      const tot = sum(a), na = new Array(k).fill(0);
      na[0] = (1 - q) * tot;
      for (let j = 1; j < k; j++) na[j] = q * a[j - 1];
      hit += q * a[k - 1]; a = na;
    }
    return Math.min(1, hit);
  }
  const expLongestRun = (n, q) => (n > 1 && q > 0 && q < 1 ? Math.log(n * (1 - q)) / Math.log(1 / q) : null);
  // Percentile bootstrap 95% CI of the mean (no normality assumption — R is fat-tailed). Seeded → stable.
  function bootMeanCI(xs, B, seed) {
    if (!xs || xs.length < 10) return null;
    const rand = rng(seed || 99), n = xs.length, means = new Array(B || 2000);
    for (let b = 0; b < means.length; b++) { let s = 0; for (let i = 0; i < n; i++) s += xs[Math.floor(rand() * n)]; means[b] = s / n; }
    means.sort((a, c) => a - c);
    return { lo: pctile(means, 0.025), hi: pctile(means, 0.975), pPos: means.filter(m => m > 0).length / means.length };
  }

  /* ── Filtering: one filter object scopes every metric ──── */
  // f: { from, to (ms by exit), strategyId, coin, side, tag, mistake ('__clean__' | id), grade, market, venue, emotion, minDiscipline }
  function filterGroups(groups, f) {
    f = f || {};
    return groups.filter(g => {
      if (!g.closed || !isN(g.exitMs)) return false;
      const t = g.exitMs, e = g.trade;
      if (f.from != null && t < f.from) return false;
      if (f.to != null && t > f.to) return false;
      if (f.strategyId && g.strategyId !== f.strategyId) return false;
      if (f.coin && g.coin !== f.coin) return false;
      if (f.side && (g.side || 'long') !== f.side) return false;
      if (f.market && (e.market || 'spot') !== f.market) return false;
      if (f.venue && (e.venue || '') !== f.venue) return false;
      if (f.grade && (e.grade || '') !== f.grade) return false;
      if (f.tag && !(e.tags || []).includes(f.tag)) return false;
      if (f.emotion && !(e.emoPre || []).includes(f.emotion)) return false;
      if (f.mistake === '__clean__' && realMistakes(e).length) return false;
      if (f.mistake && f.mistake !== '__clean__' && !(e.mistakes || []).includes(f.mistake)) return false;
      if (f.minDiscipline && !(g.avgDiscipline >= f.minDiscipline)) return false;
      return true;
    }).sort((a, b) => a.exitMs - b.exitMs);
  }
  // Preset date ranges → {from,to}
  function rangeFor(preset, nowMs) {
    const now = nowMs || Date.now(), d = new Date(now); d.setHours(0, 0, 0, 0);
    const startOfWeek = () => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); };
    switch (preset) {
      case 'today': return { from: d.getTime(), to: now };
      case 'week': return { from: startOfWeek(), to: now };
      case '30d': return { from: now - 30 * MS_DAY, to: now };
      case '90d': return { from: now - 90 * MS_DAY, to: now };
      case 'ytd': return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: now };
      default: return { from: null, to: null };
    }
  }

  /* ── After-cost ("haircut") results for paper trades ───── */
  // Paper fills are perfect; live adds fees + slippage on both sides. Extra cost = notional × round-trip% − costs already recorded.
  function isDex(g, costs) { const v = (g.trade.venue || '').toLowerCase(); return v === 'pulsex' || v === '9mm' || (costs.dexCoins || []).includes((g.coin || '').toUpperCase()); }
  function haircut(g, costs) {
    if (!costs) return { pl: g.netPL, R: R(g) };
    const notional = sum(g.portions.map(p => (isN(p.amount) && isN(p.entryPrice) ? p.amount * p.entryPrice : 0)));
    const side = isDex(g, costs) ? (costs.dexFeePct + costs.dexSlipPct) : (costs.cexFeePct + costs.cexSlipPct);
    const extra = Math.max(0, notional * (2 * side / 100) - (g.costs || 0));
    const pl = g.netPL - extra;
    return { pl, R: g.risk ? pl / g.risk : null, extra, roundTripPct: 2 * side };
  }

  /* ── Equity, drawdown and daily returns (flow-neutral) ─── */
  // idx_k = idx_{k−1} × (1 + netPL_k / balanceBefore_k); deposits/withdrawals leave it unchanged.
  function performance(gs, nowMs) {
    let idx = 1, peakIdx = 1, cum = 0, peakCum = 0, maxDDPct = 0, maxDD$ = 0;
    let peakAt = gs.length ? entryMs(gs[0]) : null, under = false, longestDDms = 0;
    const pts = [];
    for (const g of gs) {
      idx *= 1 + (isN(g.changePct) ? g.changePct : 0); cum += g.netPL;
      const t = g.exitMs;
      if (idx >= peakIdx - 1e-12) { if (under && isN(peakAt)) longestDDms = Math.max(longestDDms, t - peakAt); peakIdx = idx; peakAt = t; under = false; }
      else under = true;
      if (cum > peakCum) peakCum = cum;
      const ddPct = idx / peakIdx - 1, dd$ = cum - peakCum;
      if (ddPct < maxDDPct) maxDDPct = ddPct; if (dd$ < maxDD$) maxDD$ = dd$;
      pts.push({ t, idx, ddPct, cum, peakCum, dd$, g });
    }
    const cur = pts[pts.length - 1];
    if (under && cur && isN(peakAt)) longestDDms = Math.max(longestDDms, Math.max(nowMs || 0, cur.t) - peakAt);
    return { pts, maxDDPct, maxDD$, longestDDms, underwaterSince: under ? peakAt : null, currentDDPct: cur ? cur.ddPct : 0, currentDD$: cur ? cur.dd$ : 0, totalReturn: idx - 1 };
  }
  function dailyMap(gs, resetHour) {
    const m = new Map();
    for (const g of gs) {
      const k = tradingDayKey(g.exitMs, resetHour);
      const d = m.get(k) || { key: k, pl: 0, n: 0, wins: 0, losses: 0, r: 0, rN: 0, ret: 1, groups: [] };
      d.pl += g.netPL; d.n++; if (g.win) d.wins++; if (g.loss) d.losses++;
      if (R(g) != null) { d.r += R(g); d.rN++; }
      d.ret *= 1 + (isN(g.changePct) ? g.changePct : 0); d.groups.push(g);
      m.set(k, d);
    }
    for (const d of m.values()) d.ret -= 1;
    return m;
  }
  // Every calendar day from the first trade to `endMs`, 0 on idle days (crypto: 365 per year)
  function dailySeries(gs, endMs) {
    if (!gs.length) return [];
    const map = dailyMap(gs), out = [];
    const d = new Date(gs[0].exitMs); d.setHours(0, 0, 0, 0);
    const end = new Date(Math.max(endMs || 0, gs[gs.length - 1].exitMs)); end.setHours(0, 0, 0, 0);
    let idx = 1, peak = 1;
    for (; d <= end; d.setDate(d.getDate() + 1)) {
      const v = map.get(dayKey(d.getTime())), r = v ? v.ret : 0;
      idx *= 1 + r; if (idx > peak) peak = idx;
      out.push({ key: dayKey(d.getTime()), r, idx, dd: idx / peak - 1 });
    }
    return out;
  }

  /* ── Bucketed breakdowns ───────────────────────────────── */
  function bucket(list) {
    const rs = list.map(R).filter(isN), wins = list.filter(g => g.win).length;
    const pl = sum(list.map(g => g.netPL));
    const gw = sum(list.filter(g => g.netPL > 0).map(g => g.netPL)), gl = -sum(list.filter(g => g.netPL < 0).map(g => g.netPL));
    return { n: list.length, wins, winRate: list.length ? wins / list.length : null, pl, avgPL: list.length ? pl / list.length : null, expR: mean(rs), rN: rs.length, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null), groups: list };
  }
  // keyFn may return a key, an array of keys (multi-membership) or null
  function groupBy(gs, keyFn, order) {
    const m = new Map();
    for (const g of gs) for (const k of [].concat(keyFn(g)).filter(k => k != null && k !== '')) { if (!m.has(k)) m.set(k, []); m.get(k).push(g); }
    let rows = [...m.entries()].map(([key, list]) => ({ key, ...bucket(list) }));
    if (order) rows = order.filter(k => m.has(k)).map(k => rows.find(r => r.key === k));
    else rows.sort((a, b) => b.pl - a.pl);
    return rows;
  }
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const SESSIONS = [
    { key: 'Asia', from: 0, to: 7, label: 'Asia · 00–07 UTC' },
    { key: 'London', from: 7, to: 12, label: 'London · 07–12 UTC' },
    { key: 'London/NY', from: 12, to: 16, label: 'London/NY overlap · 12–16 UTC' },
    { key: 'New York', from: 16, to: 21, label: 'New York · 16–21 UTC' },
    { key: 'Late US', from: 21, to: 24, label: 'Late US · 21–24 UTC' },
  ];
  const HOLD = [
    { key: '< 15m', max: 15 * 60000 }, { key: '15m–1h', max: MS_H }, { key: '1–4h', max: 4 * MS_H },
    { key: '4–24h', max: MS_DAY }, { key: '1–3d', max: 3 * MS_DAY }, { key: '3–7d', max: 7 * MS_DAY }, { key: '> 7d', max: Infinity },
  ];
  const weekdayOf = (g) => WEEKDAYS[(new Date(entryMs(g)).getDay() + 6) % 7];
  // Sessions: 'utc' = fixed UTC blocks above; 'dst' = exchange-local hours via Intl (follows daylight saving):
  // Asia = Tokyo 09:00–17:00, London = 08:00–16:30 London, New York = 09:30–16:00 NY (US cash/ETF hours).
  const config = { sessionScheme: 'dst' };
  const SESSIONS_DST = [
    { key: 'Asia', label: 'Asia · Tokyo 09:00–17:00' }, { key: 'London', label: 'London · 08:00–16:30 local' },
    { key: 'London/NY', label: 'London/NY overlap' }, { key: 'New York', label: 'New York · 09:30–16:00 local' },
    { key: 'Off-hours', label: 'Off-hours (no major market open)' },
  ];
  const tzFmt = {};
  function hourIn(ms, tz) {
    try {
      const f = tzFmt[tz] || (tzFmt[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
      const [h, m] = f.format(new Date(ms)).split(':').map(Number); return h + m / 60;
    } catch (e) { return new Date(ms).getUTCHours(); }
  }
  function sessionAt(ms) {
    if (config.sessionScheme === 'utc') { const h = new Date(ms).getUTCHours(); const s = SESSIONS.find(x => h >= x.from && h < x.to) || SESSIONS[0]; return s.key === 'Late US' ? 'Off-hours' : s.key; }
    const lon = hourIn(ms, 'Europe/London'), ny = hourIn(ms, 'America/New_York'), tk = hourIn(ms, 'Asia/Tokyo');
    const wd = new Date(ms).getUTCDay(), weekday = wd !== 0 && wd !== 6;
    const inL = weekday && lon >= 8 && lon < 16.5, inN = weekday && ny >= 9.5 && ny < 16, inA = weekday && tk >= 9 && tk < 17;
    return inL && inN ? 'London/NY' : inN ? 'New York' : inL ? 'London' : inA ? 'Asia' : 'Off-hours';
  }
  const sessionOf = (g) => sessionAt(entryMs(g));
  const sessionList = () => (config.sessionScheme === 'utc' ? SESSIONS.map(s => (s.key === 'Late US' ? { ...s, key: 'Off-hours', label: 'Off-hours · 21–24 UTC' } : s)) : SESSIONS_DST);
  const isWeekend = (g) => { const d = new Date(entryMs(g)).getUTCDay(); return d === 0 || d === 6; };
  const holdOf = (g) => (isN(g.durationMs) ? HOLD.find(h => g.durationMs < h.max).key : null);
  const block4h = (g, utc) => { const d = new Date(entryMs(g)); const h = utc ? d.getUTCHours() : d.getHours(); const b = Math.floor(h / 4) * 4; return `${pad2(b)}–${pad2(b + 4)}`; };
  const BLOCKS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
  // weekday × hour grid of avg R (falls back to $ when R is missing); cells with n < 3 flagged
  function weekdayHourGrid(gs, opts) {
    opts = opts || {};
    const cols = opts.hours === 24 ? Array.from({ length: 24 }, (_, h) => pad2(h)) : ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24'];
    const per = opts.hours === 24 ? 1 : 3;
    const cells = WEEKDAYS.map(() => cols.map(() => null));
    for (const g of gs) {
      const d = new Date(entryMs(g)); if (!isFinite(d)) continue;
      const wd = (d.getDay() + 6) % 7, h = opts.utc ? d.getUTCHours() : d.getHours(), b = Math.floor(h / per);
      const c = cells[wd][b] || { pl: 0, r: 0, rN: 0, n: 0 };
      c.pl += g.netPL; c.n++; if (R(g) != null) { c.r += R(g); c.rN++; }
      cells[wd][b] = c;
    }
    for (const row of cells) for (const c of row) if (c) { c.v = c.rN ? c.r / c.rN : c.pl / c.n; c.unit = c.rN ? 'R' : '$'; c.thin = c.n < 3; }
    return { rows: WEEKDAYS, cols, cells };
  }

  /* ── MAE / MFE (needs highDuring/lowDuring prices) ─────── */
  function excursion(g) {
    if (g.portions.length !== 1) return null;
    const e = g.trade, long = g.side !== 'short';
    const en = e.entryPrice, ex = e.exitPrice, hi = e.highDuring, lo = e.lowDuring;
    if (![en, ex, hi, lo].every(isN) || !(hi > lo)) return null;
    const stop = isN(e.stopPrice) ? Math.abs(en - e.stopPrice) : null;
    const best = long ? hi : lo, worst = long ? lo : hi, dir = long ? 1 : -1;
    const range = hi - lo;
    const mfe = (best - en) * dir, mae = (en - worst) * dir;
    return {
      maeR: stop ? mae / stop : null, mfeR: stop ? mfe / stop : null,
      entryEff: mfe / range,                                   // Wealth-Lab entry efficiency
      exitEff: g.win && mfe > 0 ? ((ex - en) * dir) / mfe : null, // Tradervue: actual / best-exit, winners only
      totalEff: ((ex - en) * dir) / range,
      R: R(g), win: g.win, id: g.trade.id, coin: g.coin,
    };
  }

  /* ── Discipline: auto flags, adherence, grade, tiltmeter ─ */
  // Automatic rule flags per closed group (no self-report needed)
  // The risk cap in force when the trade was taken (e.riskCapPct, stamped by the trade form) wins over
  // today's cap — stepping the live ramp back must not retro-flag history as over-risk.
  const capFor = (e, ctx) => (isN(e && e.riskCapPct) && e.riskCapPct > 0 ? e.riskCapPct : (ctx && ctx.riskPerTradePct) || 1) / 100;
  function flagsFor(g, ctx) {
    const e = g.trade, maxRisk = capFor(e, ctx), out = [];
    if (!isN(e.stopPrice)) out.push('noStop');
    // Whole-trade risk (a partial close splits one trade into smaller portions that could each pass)
    const rp = g.portions.map(p => p.riskPct).filter(isN);
    const whole = isN(g.risk) && g.trade.prevBalance > 0 ? g.risk / g.trade.prevBalance : null;
    const tradeRisk = Math.max(rp.length ? Math.max(...rp) : 0, isN(whole) ? whole : 0);
    if (tradeRisk > maxRisk * 1.1) out.push('overRisk');
    if (R(g) != null && R(g) < -1.2) out.push('stopBlown');
    if (!g.strategyId) out.push('noStrategy');
    if (realMistakes(e).length) out.push('mistakes');
    if ((e.violations || []).length) out.push('override');
    return out;
  }
  // Per-trade discipline score (psychology research): 0.5·rulesMet + 0.3·[no mistakes] + 0.2·[no override]
  function discScore(g) {
    const e = g.trade;
    let rules = isN(e.rulesMetPct) ? e.rulesMetPct : (isN(g.avgDiscipline) ? (g.avgDiscipline - 1) / 4 : null);
    if (rules == null) rules = 0.5;
    return 100 * (0.5 * rules + 0.3 * (realMistakes(e).length ? 0 : 1) + 0.2 * ((e.violations || []).length ? 0 : 1));
  }
  function adherence(gs, ctx) {
    const flagged = gs.map(g => ({ g, f: flagsFor(g, ctx) }));
    const clean = flagged.filter(x => !x.f.length).length;
    const last30 = flagged.slice(-30), clean30 = last30.filter(x => !x.f.length).length;
    const tilt = gs.slice(-10).map(discScore);
    const counts = {}; for (const x of flagged) for (const k of x.f) counts[k] = (counts[k] || 0) + 1;
    return { n: gs.length, pct: gs.length ? clean / gs.length : null, pct30: last30.length ? clean30 / last30.length : null, n30: last30.length, tiltmeter: tilt.length ? mean(tilt) : null, counts };
  }
  // Suggested A/B/C process grade from checklist + mistakes + risk (user can override)
  function suggestGrade(e, ctx) {
    const mk = realMistakes(e);
    const severe = new Set(['no_stop', 'revenge', 'oversize', 'moved_stop', 'no_plan']);
    const minor = new Set(['early_exit', 'late_entry', 'no_tp']);
    const maxRisk = capFor(e, ctx);
    const overRisk = isN(e.riskPct) ? e.riskPct > maxRisk * 1.1 : false;
    if (mk.some(m => severe.has(m)) || overRisk || !isN(e.stopPrice)) return 'C';
    const met = isN(e.rulesMetPct) ? e.rulesMetPct : null;
    if ((met == null || met >= 0.999) && mk.length === 0) return 'A';
    if ((met == null || met >= 0.75) && mk.length <= 1 && mk.every(m => minor.has(m))) return 'B';
    return 'C';
  }

  /* ── Headline summary for any filtered set ─────────────── */
  function summary(gs, ctx) {
    ctx = ctx || {};
    const n = gs.length, tier = n >= 100 ? 4 : n >= 50 ? 3 : n >= 20 ? 2 : 1;
    const wins = gs.filter(g => g.win), losses = gs.filter(g => g.loss);
    const pl = sum(gs.map(g => g.netPL));
    const grossWin = sum(wins.map(g => g.netPL)), grossLoss = -sum(losses.map(g => g.netPL));
    const avgWin = wins.length ? grossWin / wins.length : null, avgLoss = losses.length ? -grossLoss / losses.length : null;
    const rs = gs.map(R).filter(isN), rN = rs.length;
    const expR = mean(rs), sdR = sd(rs), seR = sdR != null ? sdR / Math.sqrt(rN) : null;
    const tStat = seR ? expR / seR : null;
    const winR = gs.filter(g => g.win && R(g) != null).map(R), lossR = gs.filter(g => g.loss && R(g) != null).map(R);
    const payoffR = winR.length && lossR.length ? mean(winR) / Math.abs(mean(lossR)) : null;
    const payoff = avgWin != null && avgLoss ? avgWin / Math.abs(avgLoss) : null;
    const pay = payoffR != null ? payoffR : payoff;
    const winRate = n ? wins.length / n : null, winCI = wilson(wins.length, n);
    const beWin = pay != null ? 1 / (1 + pay) : null;
    const perf = performance(gs, ctx.now);
    const daily = dailySeries(gs, ctx.now), spanDays = daily.length;
    const dr = daily.map(d => d.r), dMean = mean(dr), dSd = sd(dr);
    const tdd = dr.length ? Math.sqrt(sum(dr.map(r => Math.min(0, r) ** 2)) / dr.length) : null;
    const srD = dSd ? dMean / dSd : null;
    const dm = dailyMap(gs, ctx.resetHour), days = [...dm.values()];
    const posDays = days.filter(d => d.pl > 0);
    const weeks = new Map(); for (const g of gs) { const k = weekKey(g.exitMs); weeks.set(k, (weeks.get(k) || 0) + g.netPL); }
    const wv = [...weeks.values()];
    let cw = 0, cl = 0, mw = 0, ml = 0; for (const g of gs) { if (g.win) { cw++; cl = 0; } else if (g.loss) { cl++; cw = 0; } else { cw = 0; cl = 0; } mw = Math.max(mw, cw); ml = Math.max(ml, cl); }
    const q = n ? losses.length / n : null;
    const sortedR = [...rs].sort((a, b) => b - a);
    const dropBest = (k) => (rs.length > k ? mean(sortedR.slice(k)) : null);
    const winHold = wins.map(g => g.durationMs).filter(isN), lossHold = losses.map(g => g.durationMs).filter(isN);
    const lossesWithR = losses.filter(g => R(g) != null);
    const costs = { fees: sum(gs.flatMap(g => g.portions.map(p => p.fees || 0))), funding: sum(gs.flatMap(g => g.portions.map(p => p.funding || 0))), gas: sum(gs.flatMap(g => g.portions.map(p => p.gas || 0))) };
    costs.total = costs.fees + costs.funding + costs.gas;
    const grossProfit = sum(gs.map(g => g.grossPL || 0).filter(v => v > 0));
    const plannedWin = gs.filter(g => g.win && isN(g.plannedR) && R(g) != null);
    const kelly = winRate != null && pay ? winRate - (1 - winRate) / pay : null;
    const kellyPess = winCI && pay ? winCI.lo - (1 - winCI.lo) / pay : null;
    const top3 = [...wins].sort((a, b) => b.netPL - a.netPL).slice(0, 3);
    const exc = gs.map(excursion).filter(Boolean);
    const cagr = spanDays >= 180 && perf.totalReturn > -1 ? Math.pow(1 + perf.totalReturn, 365 / spanDays) - 1 : null;
    return {
      n, tier, wins: wins.length, losses: losses.length, be: n - wins.length - losses.length,
      winRate, winCI, beWinRate: beWin,
      winEdge: winCI && beWin != null ? (winCI.lo > beWin ? 'green' : winRate > beWin ? 'amber' : 'red') : null,
      pl, avgPL: n ? pl / n : null, avgWin, avgLoss, payoff, payoffR,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
      pfReliable: losses.length >= 5 && n >= 20,
      largestWin: wins.length ? Math.max(...wins.map(g => g.netPL)) : null,
      largestLoss: losses.length ? Math.min(...losses.map(g => g.netPL)) : null,
      // R statistics
      rN, noStop: n - rN, expR, sdR, seR, medianR: median(rs),
      ci95: seR && rN >= 2 ? { lo: expR - tCrit(rN - 1) * seR, hi: expR + tCrit(rN - 1) * seR } : null,
      bootCI: bootMeanCI(rs, 2000, 4242),
      // One-tailed t-test p-value for "mean net R > 0". NOT the probability the edge is random —
      // UI wording: "consistent with no edge" when the CI includes 0.
      tStat, pValue: tStat != null ? 1 - tCdf(tStat, rN - 1) : null,
      edgeVerdict: tStat == null ? null : (tStat >= 2 ? 'evidence' : tStat >= 1 ? 'suggestive' : expR > 0 ? 'noise' : 'negative'),
      tradesNeeded: expR > 0 && sdR ? Math.max(0, Math.ceil((2 * sdR / expR) ** 2) - rN) : null,
      sqn: rN >= 2 && sdR ? Math.sqrt(Math.min(rN, 100)) * expR / sdR : null, sqnRaw: rN >= 2 && sdR ? Math.sqrt(rN) * expR / sdR : null, sqnGated: rN < 30,
      fragility: { drop1: dropBest(1), drop2: dropBest(2), drop3: dropBest(3) },
      top3Share: pl > 0 && top3.length ? sum(top3.map(g => g.netPL)) / pl : null,
      stopViolationRate: lossesWithR.length ? lossesWithR.filter(g => R(g) < -1.1).length / lossesWithR.length : null,
      captureRatio: plannedWin.length ? mean(plannedWin.map(R)) / mean(plannedWin.map(g => g.plannedR)) : null,
      // drawdown & risk-adjusted
      maxDDPct: perf.maxDDPct, maxDD$: perf.maxDD$, currentDDPct: perf.currentDDPct, longestDDms: perf.longestDDms, underwaterSince: perf.underwaterSince,
      timeUnderwater: daily.length ? daily.filter(d => d.dd < -1e-9).length / daily.length : null,
      recovery: perf.maxDD$ < 0 ? pl / -perf.maxDD$ : null,
      retToDD: perf.maxDDPct < 0 ? perf.totalReturn / -perf.maxDDPct : null,
      totalReturn: perf.totalReturn, cagr, mar: cagr != null && perf.maxDDPct < 0 ? cagr / -perf.maxDDPct : null,
      spanDays,
      sharpe: spanDays >= 30 && srD != null ? srD * Math.sqrt(365) : null,
      sharpeSE: spanDays >= 30 && srD != null ? Math.sqrt((1 + srD * srD / 2) / spanDays) * Math.sqrt(365) : null,
      sortino: spanDays >= 30 && tdd ? (dMean / tdd) * Math.sqrt(365) : null,
      ulcer: spanDays >= 90 ? Math.sqrt(mean(daily.map(d => (100 * d.dd) ** 2))) : null,
      // Kelly = edge-strength indicator only, never a sizing instruction; hidden below 200 trades (critic)
      kelly, kellyPess, kellyGated: n < 200,
      // daily / weekly consistency
      tradingDays: days.length, greenDays: posDays.length, greenDayPct: days.length ? posDays.length / days.length : null,
      bestDay: days.length ? Math.max(...days.map(d => d.pl)) : null, worstDay: days.length ? Math.min(...days.map(d => d.pl)) : null,
      avgDayPL: days.length ? pl / days.length : null, tradesPerDay: days.length ? n / days.length : null,
      bestDayShare: posDays.length ? Math.max(...posDays.map(d => d.pl)) / sum(posDays.map(d => d.pl)) : null,
      weeksTraded: wv.length, greenWeekPct: wv.length ? wv.filter(v => v > 0).length / wv.length : null,
      rolling50R: rs.length ? sum(rs.slice(-50)) : null,
      // streaks
      maxWinStreak: mw, maxLossStreak: ml, expLongestLossRun: q != null ? expLongestRun(n, q) : null,
      // holding behaviour
      medHoldWin: median(winHold), medHoldLoss: median(lossHold),
      disposition: winHold.length && lossHold.length ? median(lossHold) / median(winHold) : null,
      dispositionReliable: winHold.length >= 10 && lossHold.length >= 10,
      // costs
      costs, costDrag: grossProfit > 0 ? costs.total / grossProfit : null,
      // efficiency (MAE/MFE)
      exc: exc.length ? {
        n: exc.length,
        maeR: mean(exc.map(x => x.maeR).filter(isN)), mfeR: mean(exc.map(x => x.mfeR).filter(isN)),
        entryEff: mean(exc.map(x => x.entryEff)), exitEff: mean(exc.map(x => x.exitEff).filter(isN)), totalEff: mean(exc.map(x => x.totalEff)),
        winnerMaeP80: (() => { const s = exc.filter(x => x.win && isN(x.maeR)).map(x => x.maeR).sort((a, b) => a - b); return s.length >= 20 ? pctile(s, 0.8) : null; })(),
        points: exc,
      } : null,
      adherence: adherence(gs, ctx),
      reviewed: n ? gs.filter(g => isReviewed(g.trade)).length / n : null,
      perf, daily,
    };
  }

  /* ── Process analytics ─────────────────────────────────── */
  function mistakeReport(gs) {
    const clean = gs.filter(g => isReviewed(g.trade) && !realMistakes(g.trade).length);
    const Eclean = mean(clean.map(R).filter(isN));
    const avgRisk = mean(gs.map(g => g.risk).filter(isN));
    const rows = groupBy(gs, g => realMistakes(g.trade)).map(r => {
      const Em = r.expR;
      const gapR = Eclean != null && Em != null ? Eclean - Em : null;
      return { ...r, label: r.key, gapR, costR: gapR != null ? gapR * r.n : null, cost$: gapR != null && avgRisk ? gapR * r.n * avgRisk : null, share: gs.length ? r.n / gs.length : null };
    }).sort((a, b) => a.pl - b.pl);
    const byCount = groupBy(gs.filter(g => isReviewed(g.trade)), g => { const c = realMistakes(g.trade).length; return c === 0 ? '0' : c === 1 ? '1' : '2+'; }, ['0', '1', '2+']);
    // Headline total without double counting multi-mistake trades: (clean E − E of trades with ≥1 mistake) × their count
    const withMk = gs.filter(g => realMistakes(g.trade).length), Emk = mean(withMk.map(R).filter(isN));
    const totalCostR = Eclean != null && Emk != null ? (Eclean - Emk) * withMk.length : null;
    return { rows, byCount, cleanN: clean.length, Eclean, reviewed: gs.filter(g => isReviewed(g.trade)).length, unreviewed: gs.filter(g => !isReviewed(g.trade)).length,
      mistakeN: withMk.length, totalCostR, totalCost$: totalCostR != null && avgRisk ? totalCostR * avgRisk : null };
  }
  function gradeReport(gs) { return groupBy(gs, g => g.trade.grade || null, ['A', 'B', 'C']); }
  function emotionReport(gs) {
    return {
      pre: groupBy(gs, g => g.trade.emoPre || []),
      intensity: groupBy(gs, g => (isN(g.trade.emoPreInt) ? (g.trade.emoPreInt <= 2 ? 'Low (1–2)' : g.trade.emoPreInt === 3 ? 'Medium (3)' : 'High (4–5)') : null), ['Low (1–2)', 'Medium (3)', 'High (4–5)']),
      post: groupBy(gs, g => g.trade.emoPost || []),
    };
  }
  // Russo/Schoemaker process × outcome matrix (good process = grade A/B)
  function processMatrix(gs) {
    const m = { deserved: [], badBreak: [], dumbLuck: [], poetic: [] };
    for (const g of gs) {
      const gd = g.trade.grade; if (!gd) continue;
      const good = gd === 'A' || gd === 'B', won = g.netPL > 0;
      (good ? (won ? m.deserved : m.badBreak) : (won ? m.dumbLuck : m.poetic)).push(g);
    }
    return m;
  }
  function rolling(gs, w) {
    const out = [];
    for (let i = w - 1; i < gs.length; i++) {
      const win = gs.slice(i - w + 1, i + 1), rs = win.map(R).filter(isN);
      const gw = sum(win.filter(g => g.netPL > 0).map(g => g.netPL)), gl = -sum(win.filter(g => g.netPL < 0).map(g => g.netPL));
      out.push({ i, t: gs[i].exitMs, expR: mean(rs), winRate: win.filter(g => g.win).length / win.length, pf: gl > 0 ? gw / gl : null });
    }
    return out;
  }

  /* ── What-if scenarios (combinable; hypothetical) ──────── */
  // s: { capLossR, excludeMistakes (true|[ids]), minGrade ('A'|'B'), minDiscipline, dropBest, dropWorst, excludeWeekdays [], excludeSessions [], onlyClean }
  function whatIf(gs, s) {
    s = s || {};
    let list = gs.map(g => ({ ...g }));
    if (s.excludeMistakes) list = list.filter(g => { const mk = realMistakes(g.trade); return Array.isArray(s.excludeMistakes) ? !mk.some(m => s.excludeMistakes.includes(m)) : !mk.length; });
    if (s.minGrade) list = list.filter(g => g.trade.grade && (s.minGrade === 'A' ? g.trade.grade === 'A' : g.trade.grade !== 'C'));
    if (s.minDiscipline) list = list.filter(g => g.avgDiscipline >= s.minDiscipline);
    if (s.excludeWeekdays && s.excludeWeekdays.length) list = list.filter(g => !s.excludeWeekdays.includes(weekdayOf(g)));
    if (s.excludeSessions && s.excludeSessions.length) list = list.filter(g => !s.excludeSessions.includes(sessionOf(g)));
    if (s.capLossR) list = list.map(g => {
      if (!g.risk || g.R == null || g.R >= -s.capLossR) return g;
      const pl = -s.capLossR * g.risk, f = g.netPL ? pl / g.netPL : 0;
      return { ...g, netPL: pl, R: -s.capLossR, changePct: isN(g.changePct) ? g.changePct * f : g.changePct, _sim: true };
    });
    if (s.dropBest) list = [...list].sort((a, b) => b.netPL - a.netPL).slice(s.dropBest).sort((a, b) => a.exitMs - b.exitMs);
    if (s.dropWorst) list = [...list].sort((a, b) => a.netPL - b.netPL).slice(s.dropWorst).sort((a, b) => a.exitMs - b.exitMs);
    return list;
  }

  /* ── Monte Carlo (bootstrap of R at a fixed risk %) ────── */
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // Gated at 50 trades by default: a bootstrap of a tiny sample can never be worse than its worst trade.
  // o.stress adds a −3R "gap/slippage" outcome to the pool so the tail is never rosier than reality.
  function monteCarlo(rs, o) {
    o = o || {};
    rs = (rs || []).filter(isN);
    if (rs.length < (o.minN != null ? o.minN : 50)) return null;
    if (o.stress) rs = rs.concat([-3]);
    const sims = o.sims || 5000, trades = o.trades || 100, risk = (o.riskPct || 1) / 100;
    const rand = rng(o.seed || 1337);
    const K = Math.min(20, trades), cps = Array.from({ length: K + 1 }, (_, k) => Math.round(k * trades / K));
    const paths = cps.map(() => []);
    const finals = [], mdds = [], runs = [];
    const thresholds = [0.1, 0.2, 0.3, 0.5], hits = thresholds.map(() => 0);
    for (let s = 0; s < sims; s++) {
      let eq = 1, peak = 1, mdd = 0, run = 0, maxRun = 0, k = 1;
      paths[0].push(1);
      for (let i = 0; i < trades; i++) {
        const r = rs[Math.floor(rand() * rs.length)];
        eq *= Math.max(0, 1 + r * risk);
        if (eq > peak) peak = eq;
        const dd = eq / peak - 1; if (dd < mdd) mdd = dd;
        if (r < 0) { run++; if (run > maxRun) maxRun = run; } else run = 0;
        while (k <= K && cps[k] === i + 1) { paths[k].push(eq); k++; }
      }
      finals.push(eq); mdds.push(-mdd); runs.push(maxRun);
      thresholds.forEach((th, j) => { if (-mdd >= th) hits[j]++; });
    }
    finals.sort((a, b) => a - b); mdds.sort((a, b) => a - b); runs.sort((a, b) => a - b);
    return {
      sims, trades, riskPct: risk * 100, n: rs.length,
      final: { p5: pctile(finals, 0.05), p50: pctile(finals, 0.5), p95: pctile(finals, 0.95) },
      maxDD: { p50: pctile(mdds, 0.5), p95: pctile(mdds, 0.95) },
      probDD: thresholds.map((th, j) => ({ th, p: hits[j] / sims })),
      probLoss: finals.filter(f => f < 1).length / sims,
      streakP95: pctile(runs, 0.95),
      bands: paths.map((arr, i) => { const s = arr.sort((a, b) => a - b); return { trade: cps[i], p5: pctile(s, 0.05), p50: pctile(s, 0.5), p95: pctile(s, 0.95) }; }),
    };
  }

  /* ── Circuit breakers (today) ──────────────────────────── */
  // rules: settings.risk; returns per-rule state 'ok'|'warn'|'stop' and whether new trades should be interrupted
  function riskGuard(C, rules, nowMs) {
    const r = rules || {}, now = nowMs || Date.now(), reset = r.dayResetHour || 0;
    const today = tradingDayKey(now, reset), thisWeek = weekKey(now - reset * MS_H);
    const inDay = (ms) => isN(ms) && tradingDayKey(ms, reset) === today;
    const closedRows = C.tradeRows.filter(x => x.closed && x.exitAt && x.netPL != null);
    const todayRows = closedRows.filter(x => inDay(Date.parse(x.exitAt)));
    const weekRows = closedRows.filter(x => weekKey(Date.parse(x.exitAt) - reset * MS_H) === thisWeek);
    const plToday = sum(todayRows.map(x => x.netPL)), plWeek = sum(weekRows.map(x => x.netPL));
    const firstToday = [...todayRows].sort((a, b) => Date.parse(a.exitAt) - Date.parse(b.exitAt))[0];
    const firstWeek = [...weekRows].sort((a, b) => Date.parse(a.exitAt) - Date.parse(b.exitAt))[0];
    const dayStart = firstToday ? firstToday.prevBalance : C.balance;
    const weekStart = firstWeek ? firstWeek.prevBalance : C.balance;
    const dayPct = dayStart > 0 ? plToday / dayStart : 0, weekPct = weekStart > 0 ? plWeek / weekStart : 0;
    const tradesToday = C.groups.filter(g => inDay(Date.parse(g.trade.entryAt))).length;
    const closedDesc = [...C.closedGroups].sort((a, b) => b.exitMs - a.exitMs);
    let lossRunToday = 0; for (const g of closedDesc) { if (!inDay(g.exitMs)) break; if (g.loss && !(Math.abs(g.R || 0) < 0.1 && g.R != null)) lossRunToday++; else if (g.win) break; }
    const lastLoss = closedDesc.find(g => g.loss);
    const minsSinceLoss = lastLoss ? (now - lastLoss.exitMs) / 60000 : null;
    const open = C.openRows, noStop = open.filter(x => !isN(x.riskDollar));
    const openRisk = sum(open.map(x => (isN(x.riskDollar) ? x.riskDollar : 0)));
    const openRiskPct = C.balance > 0 ? openRisk / C.balance : 0;
    const checks = [];
    const add = (key, label, state, value, limit, hint) => checks.push({ key, label, state, value, limit, hint });
    const usedDay = r.maxDailyLossPct ? Math.max(0, -dayPct) / (r.maxDailyLossPct / 100) : 0;
    if (r.maxDailyLossPct) add('daily', 'Daily loss', usedDay >= 1 ? 'stop' : usedDay >= 0.7 ? 'warn' : 'ok', dayPct, -r.maxDailyLossPct / 100, 'Stop trading for the day once hit.');
    const usedWeek = r.maxWeeklyLossPct ? Math.max(0, -weekPct) / (r.maxWeeklyLossPct / 100) : 0;
    if (r.maxWeeklyLossPct) add('weekly', 'Weekly loss', usedWeek >= 1 ? 'stop' : usedWeek >= 0.7 ? 'warn' : 'ok', weekPct, -r.maxWeeklyLossPct / 100, 'Pause until next week once hit.');
    if (r.maxTradesDay) add('count', 'Trades today', tradesToday >= r.maxTradesDay ? 'stop' : tradesToday >= r.maxTradesDay - 1 ? 'warn' : 'ok', tradesToday, r.maxTradesDay, 'Overtrading erodes edge.');
    if (r.maxConsecLosses) add('streak', 'Losses in a row today', lossRunToday >= r.maxConsecLosses ? 'stop' : lossRunToday > 0 && lossRunToday >= r.maxConsecLosses - 1 ? 'warn' : 'ok', lossRunToday, r.maxConsecLosses, 'Walk away after a losing run.');
    if (r.cooldownMin) add('cooldown', 'Cooldown after a loss', minsSinceLoss != null && minsSinceLoss < r.cooldownMin ? 'stop' : 'ok', minsSinceLoss, r.cooldownMin, 'Wait before re-entering — revenge trades are the costliest.');
    if (r.maxOpenRiskPct) add('heat', 'Open risk (heat)', noStop.length ? 'stop' : openRiskPct * 100 > r.maxOpenRiskPct ? 'stop' : openRiskPct * 100 > r.maxOpenRiskPct * 0.75 ? 'warn' : 'ok', openRiskPct, r.maxOpenRiskPct / 100, noStop.length ? `${noStop.length} open position(s) have no stop — unlimited risk.` : 'Total risk if every open stop is hit.');
    // Correlated exposure: BTC/ETH/SOL longs (or PLS/PLSX/HEX/INC) are largely one bet
    const cl = typeof clusterOf === 'function' ? clusterOf : () => 'all';
    const byCluster = {};
    for (const x of open) if (isN(x.riskDollar)) { const k = cl(x.coin); byCluster[k] = (byCluster[k] || 0) + x.riskDollar; }
    let worstCluster = null;
    for (const [k, v] of Object.entries(byCluster)) { const p = C.balance > 0 ? v / C.balance : 0; if (!worstCluster || p > worstCluster.pct) worstCluster = { key: k, pct: p, usd: v }; }
    if (r.maxClusterRiskPct && worstCluster && worstCluster.key !== 'alts') add('cluster', 'Correlated exposure', worstCluster.pct * 100 > r.maxClusterRiskPct ? 'warn' : 'ok', worstCluster.pct, r.maxClusterRiskPct / 100, `Open risk in one correlated group (${worstCluster.key}).`);
    const state = checks.some(c => c.state === 'stop') ? 'stop' : checks.some(c => c.state === 'warn') ? 'warn' : 'ok';
    return { state, checks, plToday, dayPct, plWeek, weekPct, tradesToday, lossRunToday, minsSinceLoss, openRisk, openRiskPct, noStop: noStop.length, byCluster, worstCluster, today };
  }

  /* ── Rule-based insights (offline "coach") ─────────────── */
  // Every insight carries the n it is based on; time-slot insights need ≥ 10 trades in the bucket.
  function insights(gs, C, ctx) {
    ctx = ctx || {};
    const out = [], rules = ctx.rules || {};
    if (gs.length < 3) return out;
    const s = summary(gs, ctx);
    const push = (o) => out.push(o);
    const dm = dailyMap(gs, rules.dayResetHour);
    const days = [...dm.values()].sort((a, b) => a.key.localeCompare(b.key));
    const avgTrades = mean(days.map(d => d.n));
    const lossDays = days.filter(d => d.pl < 0), avgLossDay = mean(lossDays.map(d => d.pl));
    for (const d of days.slice(-14)) {
      if (d.n >= 3 && avgTrades && d.n > 2 * avgTrades) push({ id: 'over-' + d.key, sev: 'warn', title: 'Overtrading day', text: `${d.n} trades on ${d.key} vs your average of ${avgTrades.toFixed(1)} per trading day.`, day: d.key });
      let run = 0, maxRun = 0; for (const g of d.groups) { if (g.loss) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
      if (maxRun >= 3 || (avgLossDay && d.pl < 2 * avgLossDay && lossDays.length >= 3)) push({ id: 'tilt-' + d.key, sev: 'stop', title: 'Possible tilt day', text: `${d.key}: ${maxRun >= 3 ? maxRun + ' losses in a row' : 'a loss over twice your average losing day'}.`, day: d.key });
    }
    // revenge: entry within cooldown after a losing exit
    const cd = (rules.cooldownMin || 30) * 60000;
    const byExit = [...gs].sort((a, b) => a.exitMs - b.exitMs);
    const revenge = [];
    for (const g of gs) { const t = entryMs(g); const prev = byExit.filter(p => p !== g && p.exitMs <= t && t - p.exitMs <= cd && p.loss); if (prev.length) revenge.push(g); }
    if (revenge.length) { const rr = mean(revenge.map(R).filter(isN)); push({ id: 'revenge', sev: 'stop', title: 'Quick re-entries after losses', text: `${revenge.length} trade(s) opened within ${rules.cooldownMin || 30} min of a losing exit${rr != null ? ` — they average ${rr >= 0 ? '+' : ''}${rr.toFixed(2)}R` : ''}.`, ids: revenge.map(g => g.trade.id) }); }
    // oversized vs recent median risk
    const recent = gs.slice(-20), medRisk = median(recent.flatMap(g => g.portions.map(p => p.riskPct)).filter(isN));
    const big = recent.filter(g => g.portions.some(p => isN(p.riskPct) && medRisk && p.riskPct > 1.5 * medRisk));
    if (big.length) push({ id: 'oversize', sev: 'warn', title: 'Position size creeping up', text: `${big.length} of your last ${recent.length} trades risked over 1.5× your usual size.`, ids: big.map(g => g.trade.id) });
    // stop violations
    const blown = gs.filter(g => R(g) != null && R(g) < -1.2);
    if (blown.length) push({ id: 'stops', sev: 'stop', title: 'Losses beyond the stop', text: `${blown.length} trade(s) lost more than 1.2R — stops moved, ignored or slipped (check DEX slippage).`, ids: blown.map(g => g.trade.id) });
    // held losers
    const winD = gs.filter(g => g.win && isN(g.durationMs)).map(g => g.durationMs).sort((a, b) => a - b);
    if (winD.length >= 5) { const p75 = pctile(winD, 0.75); const held = gs.filter(g => g.loss && g.durationMs > p75); if (held.length >= 2) push({ id: 'held', sev: 'warn', title: 'Holding losers too long', text: `${held.length} losing trade(s) were held longer than 75% of your winners.`, ids: held.map(g => g.trade.id) }); }
    // weak time slots (n ≥ 10)
    for (const row of groupBy(gs, sessionOf)) if (row.n >= 10 && row.expR != null && row.expR < 0) push({ id: 'sess-' + row.key, sev: 'warn', title: `${row.key} session is costing you`, text: `${row.n} trades averaging ${row.expR.toFixed(2)}R — consider skipping it.`, filter: { session: row.key } });
    for (const row of groupBy(gs, weekdayOf)) if (row.n >= 10 && row.expR != null && row.expR < 0) push({ id: 'wd-' + row.key, sev: 'info', title: `${row.key} is your weakest day`, text: `${row.n} trades averaging ${row.expR.toFixed(2)}R.`, filter: { weekday: row.key } });
    // edge decay
    const roll = rolling(gs, 20);
    if (roll.length >= 10) { const last10 = roll.slice(-10); if (s.expR > 0 && last10.every(x => x.expR != null && x.expR < 0)) push({ id: 'decay', sev: 'warn', title: 'Recent edge has faded', text: 'Your last 10 rolling-20 windows all have negative expectancy while your lifetime expectancy is positive. Review recent setups or market conditions.' }); }
    // losing streak normaliser
    let curLoss = 0; for (let i = gs.length - 1; i >= 0; i--) { if (gs[i].loss) curLoss++; else break; }
    // "Unusual" needs a real sample and an exact tail probability (< 10% chance of such a run in n trades)
    if (curLoss >= 2 && s.n >= 10 && s.expLongestLossRun != null && s.expLongestLossRun >= 1) {
      const q = s.n ? s.losses / s.n : 0, pRun = pLosingRun(q, curLoss, s.n), unusual = pRun < 0.1;
      push({ id: 'streak', sev: unusual ? 'warn' : 'info', n: s.n, title: unusual ? 'Unusual losing streak' : 'Losing streak — normal variance', text: unusual ? `${curLoss} losses in a row has under a ${Math.max(1, Math.round(pRun * 100))}% chance with your stats (~${s.expLongestLossRun.toFixed(1)} expected). Review setups and reduce size.` : `${curLoss} losses in a row is within the ~${s.expLongestLossRun.toFixed(1)} expected for your win rate over ${s.n} trades. Stick to the plan.` });
    }
    if (s.disposition && s.dispositionReliable && s.disposition > 1.5) push({ id: 'disp', sev: 'warn', title: 'Cutting winners, riding losers', text: `You hold losers ${s.disposition.toFixed(1)}× longer than winners (median).` });
    if (s.exc && s.exc.exitEff != null && s.exc.n >= 10 && s.exc.exitEff < 0.3) push({ id: 'leftmoney', sev: 'info', title: 'Leaving money on the table', text: `Winners capture ${Math.round(s.exc.exitEff * 100)}% of the best available exit on average.` });
    const rank = { stop: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
  }

  /* ── Paper → live readiness: transparent evidence checklist ── */
  // No black-box score (metrics research + critic): hard gates that must all pass, plus evidence
  // checks that each show their own number and a pass / partial / fail state.
  function readiness(gs, ctx) {
    ctx = ctx || {};
    const costs = ctx.costs, s = summary(gs, ctx);
    const hc = gs.map(g => haircut(g, costs));
    const hR = hc.map(h => h.R).filter(isN), hExp = mean(hR), hSd = sd(hR);
    const hT = hR.length >= 2 && hSd ? hExp / (hSd / Math.sqrt(hR.length)) : null;
    const hCI = hR.length >= 2 && hSd ? { lo: hExp - tCrit(hR.length - 1) * hSd / Math.sqrt(hR.length), hi: hExp + tCrit(hR.length - 1) * hSd / Math.sqrt(hR.length) } : null;
    const hBoot = bootMeanCI(hR, 2000, 777);
    const hGW = sum(hc.filter(h => h.pl > 0).map(h => h.pl)), hGL = -sum(hc.filter(h => h.pl < 0).map(h => h.pl));
    const hPF = hGL > 0 ? hGW / hGL : (hGW > 0 ? Infinity : null);
    const mc = monteCarlo(hR, { riskPct: ctx.liveRiskPct || 1, trades: 100, sims: 3000, seed: 7, stress: true });
    const avgCostR = mean(hc.map((h, i) => (gs[i].risk && isN(h.extra) ? (h.extra + (gs[i].costs || 0)) / gs[i].risk : null)).filter(isN));
    const adh = s.adherence;
    // clean sessions streak: consecutive most-recent trading days with all trades adherent and day P/L within the limit
    const dm = [...dailyMap(gs, ctx.resetHour).values()].sort((a, b) => b.key.localeCompare(a.key));
    let cleanStreak = 0;
    for (const d of dm) {
      const ok = d.groups.every(g => !flagsFor(g, ctx).length) && (!ctx.maxDailyLossPct || d.ret > -ctx.maxDailyLossPct / 100);
      if (ok) cleanStreak++; else break;
    }
    const usedStrategies = [...new Set(gs.slice(-30).map(g => g.strategyId).filter(Boolean))];
    const undocumented = usedStrategies.filter(id => { const st = (ctx.strategies || []).find(x => x.id === id); return !st || !((st.entry || []).length || (st.exit || []).length); });
    const first = gs.length ? entryMs(gs[0]) : null;
    const calDays = first ? Math.floor(((ctx.now || Date.now()) - first) / MS_DAY) : 0;
    const fR = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`);
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    // Hard gates — every one must pass before the app suggests a (micro-size) live start.
    const gates = [
      { id: 'n', label: 'At least 30 closed paper trades', pass: gs.length >= 30, value: `${gs.length}`, hint: 'Below 30 trades almost any result is noise.' },
      { id: 'exp', label: 'Positive expectancy after fees & slippage', pass: hExp != null && hExp > 0, value: fR(hExp), hint: 'Paper fills are perfect; live adds costs on every trade.' },
      { id: 'clean', label: '10 clean trading days in a row', pass: cleanStreak >= 10, value: `${cleanStreak} days`, hint: 'Every trade with a stop, risk within your limit, no rule overrides, daily loss limit respected.' },
      { id: 'adh', label: 'Rule adherence ≥ 90% (last 30 trades)', pass: adh.pct30 != null && adh.pct30 >= 0.9 && adh.n30 >= 20, value: pct(adh.pct30), hint: 'Discipline has to transfer before money does.' },
      { id: 'dd', label: 'Paper max drawdown under 20%', pass: gs.length > 0 && -s.maxDDPct < 0.2, value: `${(s.maxDDPct * 100).toFixed(1)}%`, hint: 'Live drawdowns are usually deeper than paper ones.' },
      { id: 'playbook', label: 'Every strategy you trade is written in the Playbook', pass: !undocumented.length && usedStrategies.length > 0, value: undocumented.length ? `${undocumented.length} undocumented` : usedStrategies.length ? 'all written' : 'none used', hint: 'Entry and exit rules for each setup.' },
    ];
    // Evidence checks — pass / partial / fail with the real number. Thresholds from the research notes.
    const st = (passIf, partialIf) => (passIf ? 'pass' : partialIf ? 'partial' : 'fail');
    const checks = [
      { id: 'sample', label: 'Sample size', value: `${gs.length} trades`, target: '100+ trades (50 = developing)', state: st(gs.length >= 100, gs.length >= 50), hint: 'Keep logging every paper trade — the confidence band narrows with √n.' },
      { id: 'signif', label: 'Edge vs. luck', value: hT == null ? '—' : `t = ${hT.toFixed(2)} · 95% CI ${fR(hCI && hCI.lo)} to ${fR(hCI && hCI.hi)}`, target: 'CI above 0R (t ≥ 2)', state: st(hCI && hCI.lo > 0, hT != null && hT >= 1), hint: hCI && hCI.lo <= 0 ? `Still consistent with no edge.${s.tradesNeeded != null ? ` About ${s.tradesNeeded} more trades at this edge would settle it.` : ''}` : 'The after-cost edge is statistically distinguishable from zero.' },
      { id: 'expv', label: 'Size of the edge (after costs)', value: fR(hExp), target: '≥ +0.25R (+0.10R partial)', state: st(hExp != null && hExp >= 0.25, hExp != null && hExp >= 0.1), hint: avgCostR != null ? `Costs take ~${avgCostR.toFixed(2)}R per trade. Wider stops or maker orders shrink that.` : 'Small edges disappear once real costs and slippage hit.' },
      { id: 'pf', label: 'Profit factor (after costs)', value: hPF == null ? '—' : hPF === Infinity ? 'n/a (no losses)' : hPF.toFixed(2), target: '≥ 1.5 (1.2 partial)', state: st(hPF != null && hPF >= 1.5 && hPF !== Infinity, hPF != null && hPF >= 1.2), hint: 'Gross wins ÷ gross losses once fees & slippage are applied.' },
      { id: 'winrate', label: 'Win rate vs. breakeven', value: s.winCI && s.beWinRate != null ? `${pct(s.winRate)} (CI ${pct(s.winCI.lo)}–${pct(s.winCI.hi)}) vs ${pct(s.beWinRate)} needed` : '—', target: 'Lower bound above breakeven', state: s.winEdge === 'green' ? 'pass' : s.winEdge === 'amber' ? 'partial' : 'fail', hint: 'Breakeven win rate = 1 ÷ (1 + payoff ratio).' },
      { id: 'mcdd', label: 'Simulated drawdown at live risk', value: mc ? `95th pct ${(mc.maxDD.p95 * 100).toFixed(0)}% over 100 trades` : 'needs 50 trades', target: '≤ 20% (≤ 30% partial)', state: mc ? st(mc.maxDD.p95 <= 0.2, mc.maxDD.p95 <= 0.3) : 'fail', hint: `Bootstrap of your after-cost R at ${ctx.liveRiskPct || 1}% risk, with a −3R stress trade added.` },
      { id: 'adh95', label: 'Rule adherence (last 30)', value: pct(adh.pct30), target: '≥ 95% (90% partial)', state: st(adh.pct30 != null && adh.pct30 >= 0.95, adh.pct30 != null && adh.pct30 >= 0.9), hint: 'Stop on every trade, risk within limit, tag mistakes honestly.' },
      { id: 'stops', label: 'Stop discipline', value: s.stopViolationRate == null ? '—' : `${pct(s.stopViolationRate)} of losses beyond −1.1R`, target: '≤ 10% (20% partial)', state: s.stopViolationRate == null ? 'fail' : st(s.stopViolationRate <= 0.1, s.stopViolationRate <= 0.2), hint: 'Live slippage only makes this worse.' },
      { id: 'cons', label: 'Consistency', value: `${s.greenWeekPct == null ? '—' : pct(s.greenWeekPct) + ' green weeks'} · best day ${s.bestDayShare == null ? '—' : pct(s.bestDayShare) + ' of profit'}`, target: '≥ 60% green weeks (6+ weeks), best day ≤ 50%', state: st(s.weeksTraded >= 6 && s.greenWeekPct >= 0.6 && s.bestDayShare != null && s.bestDayShare <= 0.5, (s.bestDayShare != null && s.bestDayShare <= 0.5) || (s.greenWeekPct != null && s.greenWeekPct >= 0.5)), hint: 'Profit should not hinge on one lucky day.' },
      { id: 'time', label: 'Time & market conditions', value: `${calDays} days · ${s.tradingDays} trading days`, target: '≥ 30 calendar days and 20 trading days', state: st(calDays >= 30 && s.tradingDays >= 20, calDays >= 14), hint: 'Trade through quiet and volatile weeks before risking money.' },
    ];
    if (ctx.plannedLiveCapital && ctx.startingBalance) {
      const ratio = ctx.startingBalance / ctx.plannedLiveCapital;
      checks.push({ id: 'sizing', label: 'Realistic paper balance', value: `paper ${ratio.toFixed(1)}× planned live capital`, target: 'within 0.5×–2×', state: st(ratio >= 0.5 && ratio <= 2, ratio >= 0.25 && ratio <= 4), hint: 'A $100k paper account trains habits a $1k live account cannot use.' });
    }
    const passed = checks.filter(c => c.state === 'pass').length, partial = checks.filter(c => c.state === 'partial').length;
    const gatesPass = gates.every(g => g.pass);
    const signifOk = checks.find(c => c.id === 'signif').state !== 'fail';
    // 'ready'  = all gates + edge at least suggestive + ≥ 70% of checks passed → start live at the smallest ramp stage
    // 'close'  = all gates pass, evidence still building
    // 'keep'   = a gate fails → keep paper trading
    const verdict = gatesPass && signifOk && passed >= Math.ceil(checks.length * 0.7) ? 'ready' : gatesPass ? 'close' : 'keep';
    const perStrategy = groupBy(gs, g => g.strategyId || null).map(r => ({ id: r.key, n: r.n, expR: r.expR, enough: r.n >= 30 }));
    return {
      verdict, gates, gatesPass, gatesPassed: gates.filter(g => g.pass).length, checks, passed, partial,
      progress: checks.length ? (passed + 0.5 * partial) / checks.length : 0,
      summary: s, haircut: { expR: hExp, pf: hPF, t: hT, ci: hCI, boot: hBoot, n: hR.length, avgCostR }, mc, cleanStreak, calDays, perStrategy,
      tradesNeeded: s.tradesNeeded,
    };
  }

  /* ── Paper vs live comparison & ramp ───────────────────── */
  function compare(a, b, ctx) {
    const sa = summary(a, ctx), sb = summary(b, ctx);
    const ra = a.map(R).filter(isN), rb = b.map(R).filter(isN);
    const haA = a.map(g => haircut(g, ctx && ctx.costs).R).filter(isN);
    const paperAfterCost = mean(haA);
    return { a: sa, b: sb, welch: welch(rb, ra), transfer: paperAfterCost > 0 && sb.expR != null ? sb.expR / paperAfterCost : null, paperAfterCost };
  }
  // Staged micro-size ramp (live): 0.25% → 0.5% → 0.75% → 1% risk, reviewed every 25 live trades
  function rampStatus(liveGs, stage, sinceMs, paperExpR, ctx) {
    const block = liveGs.filter(g => !sinceMs || g.exitMs >= sinceMs);
    const s = summary(block, ctx);
    const perf = performance(block);
    const canReview = block.length >= 25;
    const adhOk = s.adherence.pct != null && s.adherence.pct >= 0.9;
    const edgeOk = s.expR != null && (s.expR > 0 || (paperExpR > 0 && s.expR >= 0.5 * paperExpR));
    const ddOk = -perf.maxDDPct < 0.05;
    let action = 'hold';
    if (-perf.maxDDPct >= 0.1) action = 'backToPaper';
    else if (-perf.maxDDPct >= 0.05) action = 'demote';
    else if (canReview && adhOk && edgeOk && ddOk && stage < 4) action = 'promote';
    return { stage, n: block.length, need: Math.max(0, 25 - block.length), adhOk, edgeOk, ddOk, dd: perf.maxDDPct, expR: s.expR, action };
  }

  /* ── Transfer ratio verdict (live expR ÷ paper after-cost expR) — one scale for every page ── */
  const TRANSFER = [[0.7, 'good', 'Live is keeping most of the paper edge'], [0.4, 'decay', 'Typical paper → live decay — watch it'], [-Infinity, 'investigate', 'Live is far below paper — investigate execution and discipline']];
  const transferVerdict = (ratio) => { if (!isN(ratio)) return null; const t = TRANSFER.find(x => ratio >= x[0]); return { key: t[1], label: t[2], min: t[0] }; };

  /* ── Plain-language readings for a beginner (one line per KPI) ── */
  const SQN_SCALE = [[1.6, 'poor'], [2, 'below average'], [2.5, 'average'], [3, 'good'], [5, 'excellent'], [7, 'superb'], [Infinity, 'suspiciously high — check for errors']];
  function readings(s) {
    const r = {}, R2 = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`), P = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    if (!s || !s.n) return r;
    if (s.rN < 20) r.expR = `Too early to judge — ${s.rN} trade${s.rN === 1 ? '' : 's'} with a stop. Your average so far is ${R2(s.expR)}.`;
    // Confidence ranges are only quoted from 30 trades (contract gating); 20–29 gets a softer reading
    else if (s.rN < 30) r.expR = s.expR > 0 ? `Averaging ${R2(s.expR)} per trade across ${s.rN} trades — promising; confirm it at 30+ trades.` : `Averaging ${R2(s.expR)} per trade across ${s.rN} trades. Check the mistakes report before adding size.`;
    else if (s.ci95 && s.ci95.lo > 0) r.expR = `You make about ${R2(s.expR)} per trade (likely ${R2(s.ci95.lo)} to ${R2(s.ci95.hi)}). That looks like a real edge so far.`;
    else if (s.expR > 0) r.expR = `Averaging ${R2(s.expR)} per trade, but the likely range (${R2(s.ci95 && s.ci95.lo)} to ${R2(s.ci95 && s.ci95.hi)}) still includes zero — not proven yet.${s.tradesNeeded ? ` Roughly ${s.tradesNeeded} more trades would tell.` : ''}`;
    else r.expR = `You lose about ${R2(s.expR)} per trade on average. Check the mistakes report before adding size.`;
    if (s.winRate != null) r.winRate = s.beWinRate != null ? `${P(s.winRate)} of trades win; with your average win vs. loss you need ${P(s.beWinRate)} to break even.` : `${P(s.winRate)} of trades win.`;
    if (s.profitFactor != null) r.pf = s.profitFactor === Infinity ? 'No losing trades yet — profit factor is undefined.' : s.profitFactor >= 1 ? `For every $1 lost you made $${s.profitFactor.toFixed(2)}.` : `For every $1 lost you only made back $${s.profitFactor.toFixed(2)}.`;
    r.dd = s.maxDDPct < 0 ? `Your worst drop from a peak was ${P(-s.maxDDPct)}${s.currentDDPct < -0.001 ? `; you are ${P(-s.currentDDPct)} below your peak now` : '; you are at a new high'}.` : 'No drawdown yet.';
    if (s.sqn != null && !s.sqnGated) r.sqn = `System quality ${s.sqn.toFixed(2)} — ${SQN_SCALE.find(x => s.sqn < x[0])[1]} on Van Tharp's scale.`;
    if (s.adherence && s.adherence.pct30 != null) r.adh = `${P(s.adherence.pct30)} of your last ${s.adherence.n30} trades followed every rule.`;
    if (s.expLongestLossRun != null) r.streak = `With your win rate, a losing streak of about ${Math.round(s.expLongestLossRun)} is normal over ${s.n} trades.`;
    if (s.payoffR != null || s.payoff != null) r.payoff = `Your average win is ${(s.payoffR != null ? s.payoffR : s.payoff).toFixed(2)}× your average loss.`;
    return r;
  }

  return {
    config, readings, bootMeanCI, SQN_SCALE, TRANSFER, transferVerdict, capFor,
    // statistics
    wilson, tCdf, tCrit, welch, pLosingRun, expLongestRun, mean, median, sd,
    // data shaping
    filterGroups, rangeFor, haircut, performance, dailyMap, dailySeries, groupBy, bucket, rolling, weekdayHourGrid, excursion,
    // reports
    summary, mistakeReport, gradeReport, emotionReport, processMatrix, whatIf, monteCarlo, riskGuard, insights, readiness, compare, rampStatus,
    // discipline
    flagsFor, discScore, adherence, suggestGrade, realMistakes, isReviewed,
    // keys & buckets
    weekdayOf, sessionOf, sessionAt, sessionList, hourIn, isWeekend, holdOf, block4h, BLOCKS, WEEKDAYS, SESSIONS, HOLD, dayKey, weekKey, monthKey, tradingDayKey,
  };
})();
