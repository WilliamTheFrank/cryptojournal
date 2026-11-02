/* ═══════════════════════════════════════════════════════════
   CryptoJournal — demo data generator
   A deterministic (seeded mulberry32) sample journal written only to
   db.accounts.demo, so a beginner can explore every page before
   logging real trades. It is built to exercise the whole app: net R
   with real fee presets, scale-outs, open positions, trades without a
   stop, perps (funding, liquidation) and PulseChain swaps (tiny
   prices, gas), mistakes that cost money, unreviewed trades, excursion
   data for MAE/MFE, deposits, a withdrawal, day plans and a weekly
   review — with a learning curve (fewer mistakes in recent trades).
   Paper and live accounts are never touched.
   ═══════════════════════════════════════════════════════════ */
const Demo = (() => {
  const DAY = 86400000, HOUR = 3600000, MIN = 60000;
  // Seed 442 was picked from a scan of 1,500 seeds because it stays representative whatever today's date is:
  // ~45% win rate, ~1.7R average win, ≈ +0.3R expectancy whose 95% range still touches 0 (honest: not proven yet),
  // ~10% max drawdown, ~13% unreviewed and a visible learning curve (rule adherence ~60% overall → 80% over the last 30)
  const DEFAULT_SEED = 442, START_BAL = 10000;
  const ok = (f, d) => { try { return f(); } catch (e) { return d; } };

  // Reference prices for late 2026 — each random walk ends here today (or at the last cached live quote). dp = amount precision (negative = round to 10^-dp units).
  const COINS = {
    BTC: { p: 100000, vol: 0.024, drift: 0.0006, w: 0.26, stop: 0.016, dp: 4, kind: 'major' },
    ETH: { p: 3500, vol: 0.031, drift: 0.0005, w: 0.22, stop: 0.02, dp: 3, kind: 'major' },
    SOL: { p: 180, vol: 0.042, drift: 0.0004, w: 0.18, stop: 0.028, dp: 2, kind: 'major' },
    PLS: { p: 0.00003, vol: 0.058, drift: 0.0002, w: 0.12, stop: 0.06, dp: -3, kind: 'pulse' },
    PLSX: { p: 0.00002, vol: 0.063, drift: 0.0002, w: 0.12, stop: 0.065, dp: -3, kind: 'pulse' },
    HEX: { p: 0.004, vol: 0.055, drift: 0.0001, w: 0.10, stop: 0.06, dp: 0, kind: 'pulse' },
  };
  // Entry hour weights (local time): quiet nights, busiest through the afternoon / London–NY overlap
  const HOUR_W = [0.25, 0.2, 0.15, 0.15, 0.2, 0.3, 0.5, 0.8, 1.1, 1.3, 1.3, 1.2, 1.1, 1.3, 1.6, 1.7, 1.6, 1.4, 1.2, 1.1, 1.0, 0.9, 0.6, 0.4];
  // Trading style by strategy slot (default playbook: MM with/without protection, swing, scalper)
  const STYLE = [
    { name: 'intraday', hold: [1 * HOUR, 9 * HOUR], edge: 0.04, tf: ['15m', '1h'], winMul: 1, stopMul: 0.8 },
    { name: 'intraday', hold: [40 * MIN, 6 * HOUR], edge: -0.04, tf: ['15m', '1h'], winMul: 0.95, stopMul: 0.8 },
    { name: 'swing', hold: [14 * HOUR, 5 * DAY], edge: 0.02, tf: ['4h', '1D'], winMul: 1.15, stopMul: 1.6 },
    { name: 'scalp', hold: [8 * MIN, 90 * MIN], edge: -0.06, tf: ['5m', '15m'], winMul: 0.9, stopMul: 0.5 },
  ];
  const STRAT_W = [0.32, 0.18, 0.28, 0.22];
  // Mistake frequencies (ids from DEFAULT_MISTAKES); revenge and no_stop are placed deliberately below
  const MK_POOL = [['fomo', 16], ['early_exit', 16], ['late_entry', 12], ['moved_stop', 8], ['held_loser', 8], ['overtrading', 7], ['ignored_setup', 8],
    ['boredom', 6], ['oversize', 5], ['no_tp', 7], ['exec_error', 3], ['overconfidence', 5], ['no_plan', 3]];
  const DEFAULT_CHECK = ['Higher-timeframe trend agrees', 'Clear invalidation level for the stop', 'R:R at or above the strategy minimum', 'Stop loss set before entry', 'Risk ≤ max risk per trade'];
  const SETUPS = ['Breakout', 'Pullback', 'Range fade', 'Trend continuation', 'Reversal'];
  const THESIS = {
    long: ['{c} reclaimed the range high on the {tf} with rising volume — looking for continuation toward {t}.',
      '{c} pulled back into prior support at the rising 20 EMA; buyers stepped in on the {tf}.',
      'Higher low held above {s}; entering the breakout retest with a target at {t}.',
      'Bull flag on the {tf} after a strong impulse — entry on the break of the flag.',
      'Bullish RSI divergence into support on the {tf}; waited for the confirmation candle.'],
    short: ['{c} lost the range low on the {tf} and the retest failed — targeting {t}.',
      'Lower high under resistance with bearish divergence on the {tf} RSI.',
      'Rejected the daily level twice; funding is elevated and longs look crowded.',
      'Bear flag on the {tf} after the breakdown — short the loss of the flag low.'],
  };
  const INVALID = { long: ['A {tf} close back below {s}.', 'Losing the higher low at {s}.', 'Breakout fails and closes back inside the range.'],
    short: ['A {tf} close back above {s}.', 'Reclaiming the broken level at {s}.', 'Funding flips negative and price holds the range.'] };
  const NOTES = ['Waited for the candle close — no chase.', 'Entered during the London/NY overlap; spread was tight.', 'Sized from the stop, 1R as planned.',
    'Alert triggered at my level, took it as planned.', 'News spike right after entry — stayed with the plan.', 'Checked BTC first; market was calm.'];
  const DEX_NOTES = ['Thin pool — expect slippage on the exit.', 'Checked pool liquidity on DexScreener before sizing.'];
  const LESSON = {
    fomo: 'Wait for the retest instead of chasing the first candle.', early_exit: 'Let the trade reach the target — the plan was fine.',
    moved_stop: 'The stop is the plan. Never widen it.', held_loser: 'Exit at the stop, not at the hope level.',
    revenge: 'After a loss, take the full cooldown. No exceptions.', late_entry: 'Set the alert at the level so I don’t hesitate.',
    overtrading: 'Max trades a day means max.', ignored_setup: 'If two rules are missing, it is not my setup.',
    boredom: 'No setup, no trade — close the chart.', oversize: 'Size from the calculator every single time.',
    no_tp: 'Take the planned profit at the target.', exec_error: 'Double-check size and side before confirming.',
    overconfidence: 'A win streak is not a reason to size up.', no_plan: 'Write the plan before the order.', no_stop: 'The stop goes in with the order.',
  };
  const WELL = ['Followed the checklist and sized from the stop.', 'Patient entry at my level.', 'Took the stop without hesitation.', 'Logged it right after closing.'];
  const WELL_PARTIAL = ['The setup itself was valid.', 'Kept the loss small once I noticed.', 'Journaled it honestly.'];
  const IMPROVE = ['Nothing major — keep doing this.', 'Could have scaled out at 1R.', 'Check the higher timeframe once more before entry.'];
  const CLEAN_LESSON = ['Process over outcome — this was an A trade.', 'Trust the plan; the edge plays out over many trades.', 'Small, boring, repeatable.'];
  const PLANS = ['A-setups only on BTC / ETH; no PulseChain until volume returns.', 'Wait for the London/NY overlap; max three trades.',
    'Trade pullbacks in the trend only — no counter-trend shorts today.', 'Focus on one coin and the 1h chart.', 'Light day: news at 14:30 UTC, flat before it.'];
  const GOALS = ['Zero trades within 30 minutes of a loss.', 'Every stop set before entry.', 'Only take trades that pass the full checklist.', 'Journal every trade within an hour.'];
  // Next week's ONE process focus, picked from the week's costliest mistake (weekly review)
  const FOCUS = {
    fomo: 'Enter only on a retest or a candle close — no chasing.', revenge: 'Zero trades within 30 minutes of a loss.',
    early_exit: 'Hold every winner to the target or the trailing stop.', late_entry: 'Set alerts at my levels so I act on time.',
    moved_stop: 'The stop never moves further away.', held_loser: 'Exit at the stop — no hoping.', no_stop: 'Every stop set before entry.',
    overtrading: 'Max three trades a day.', ignored_setup: 'Only take trades that pass the full checklist.', boredom: 'No setup, no trade.',
    oversize: 'Size every trade from the calculator.', no_tp: 'Take profit at the planned target.', exec_error: 'Double-check size and side before confirming.',
    overconfidence: 'Same size after a win streak.', no_plan: 'Write the plan before the order.',
  };
  // Mirrors the Journal's readiness check-in heuristic (pages/journal.js) so demo days score the same way
  const checkinScore = (r) => {
    const flags = Object.values(r.halt).filter(Boolean).length;
    const s = 100 - 15 * flags - ({ 1: 25, 2: 20, 3: 8 }[r.sleep] || 0) - ({ 1: 20, 2: 15 }[r.mood] || 0) - ({ 5: 20, 4: 12 }[r.stress] || 0);
    return Math.max(0, Math.min(100, Math.round(s)));
  };

  /* ── Seeded PRNG (mulberry32) ── */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const sig = (v, d) => +Number(v).toPrecision(d);
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const floorTo = (v, dp) => { if (dp >= 0) { const f = 10 ** dp; return Math.floor(v * f + 1e-7) / f; } const s = 10 ** -dp; return Math.floor(v / s + 1e-7) * s; };
  const iso = (ms) => new Date(ms).toISOString();
  const dkey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (_, k) => (o[k] != null ? o[k] : ''));
  // Drop undefined keys so stored entries stay compact
  const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

  /* ── Generator ── */
  // Demo.generate({ n = 80, seed }) → entries; replaces db.accounts.demo + days/reviews/missed for demo. Caller saves.
  function generate(opts) {
    const o = opts || {};
    const n = Math.max(5, Math.min(1000, Math.round(isNum(o.n) ? o.n : 80)));
    const rnd = mulberry32(isNum(o.seed) ? o.seed : DEFAULT_SEED);
    const between = (a, b) => a + (b - a) * rnd();
    const int = (a, b) => Math.floor(between(a, b + 1));
    const chance = (p) => rnd() < p;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const wpick = (pairs) => { let t = 0; for (const [, w] of pairs) t += w; let x = rnd() * t; for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; } return pairs[pairs.length - 1][0]; };
    const normal = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };

    const now = Date.now();
    const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
    const startMs = today0.getTime() - 120 * DAY;
    const winStart = startMs + 10 * DAY, winEnd = now - 6 * HOUR;
    const risk = S().risk || {};
    const maxLev = Math.max(2, risk.maxLeverage || 5);
    // 1% sizing from the stop, never above the user's own per-trade cap (else every demo trade is flagged over-risk)
    const baseRisk = Math.min(1, isNum(risk.maxRiskPct) && risk.maxRiskPct > 0 ? risk.maxRiskPct : 1) / 100;
    const resetHour = risk.dayResetHour || 0;
    const tdKey = (ms) => dkey(ms - resetHour * HOUR);
    const presets = (S().fees && S().fees.presets) || (typeof FEE_PRESETS !== 'undefined' ? FEE_PRESETS : {});
    const known = new Set((db.mistakes || []).map(m => m && m.id));
    const pool = MK_POOL.filter(([id]) => known.has(id));
    const strats = (db.strategies || []).filter(s => s && s.id && !s.archived);
    const PRE = new Set((typeof EMOTIONS_PRE !== 'undefined' ? EMOTIONS_PRE : []).map(e => e.id));
    const POST = new Set((typeof EMOTIONS_POST !== 'undefined' ? EMOTIONS_POST : []).map(e => e.id));
    const tagGroup = (id) => { const g = (db.tagGroups || []).find(x => x && x.id === id); return g && Array.isArray(g.tags) && g.tags.length ? g.tags : null; };
    const marketTags = tagGroup('market') || ['Trending up', 'Trending down', 'Ranging', 'News / volatile', 'BTC dumping'];
    const tfTags = tagGroup('tf') || ['5m', '15m', '1h', '4h', '1D'];

    // Daily price paths, walked backwards from today's reference price (index 120 = today 00:00)
    const paths = {};
    for (const [sym, c] of Object.entries(COINS)) {
      // Anchor "today" to the last live quote when we have one, so open demo trades show sensible unrealised P/L
      const q = ok(() => (typeof Market !== 'undefined' && typeof Market.cached === 'function' ? Market.cached(sym) : null), null);
      const arr = new Array(122); arr[121] = q && isNum(q.usd) && q.usd > 0 ? q.usd : c.p;
      for (let d = 120; d >= 0; d--) arr[d] = arr[d + 1] / Math.exp(normal() * c.vol + c.drift);
      paths[sym] = arr;
    }
    const priceAt = (sym, ms) => {
      const d = (ms - startMs) / DAY, i = Math.max(0, Math.min(120, Math.floor(d))), f = Math.max(0, Math.min(1, d - i));
      const a = paths[sym][i], b = paths[sym][i + 1];
      return a * Math.pow(b / a, f);   // log-linear between daily closes
    };
    const rates = (venue, market, inT, outT) => {
      const p = presets[venue + '|' + market] || { maker: 0.1, taker: 0.1 };
      const r = (t) => (isNum(p[t]) ? p[t] : 0.1) / 100;
      return { ri: r(inT || 'taker'), ro: r(outT || 'taker') };
    };

    /* ── 1. Trade specs ── */
    let order = 0;
    const stratPick = () => (strats.length ? wpick(strats.map((s, i) => [i, STRAT_W[i] != null ? STRAT_W[i] : 0.1])) : -1);
    // A learning curve: ~40% clean trades at the start of the window, ~70% by the end (tiltmeter and adherence improve)
    function drawMistakes(progress) {
      if (!pool.length) return [];
      const p = Math.max(0, Math.min(1, progress || 0));
      const want = Math.min(wpick([[0, 40 + 30 * p], [1, 38 - 18 * p], [2, 22 - 12 * p]]), pool.length), out = [];
      for (let g = 0; out.length < want && g < 30; g++) { const m = wpick(pool); if (!out.includes(m)) out.push(m); }
      return out;
    }
    function venueFor(kind, style) {
      if (kind === 'pulse') return { market: 'dex', venue: 'PulseX' };
      const perpP = style.name === 'scalp' ? 0.9 : style.name === 'swing' ? 0.35 : 0.6;
      if (chance(perpP)) return { market: 'perp', venue: wpick([['Binance', 5], ['Bybit', 3], ['OKX', 2]]) };
      return { market: 'spot', venue: wpick([['Binance', 6], ['OKX', 2], ['Bybit', 2]]) };
    }
    // Stop distance as a fraction of entry: coin volatility × style, but never so tight that a stop-out costs more than ~0.075R in fees
    function stopPct(s) {
      const { ri, ro } = rates(s.venue, s.market, s.ordIn, 'taker');
      return Math.max(COINS[s.coin].stop * s.style.stopMul * between(0.75, 1.3), (ri + ro) / 0.075, 0.006);
    }
    function makeSpec(entryMs, open) {
      const prog = Math.max(0, Math.min(1, (entryMs - winStart) / (winEnd - winStart)));
      const coin = wpick(Object.entries(COINS).map(([k, c]) => [k, c.w])), c = COINS[coin];
      const si = stratPick(), strat = si >= 0 ? strats[si] : null;
      let style = STYLE[si >= 0 ? si % 4 : 0];
      if (open && style.name === 'scalp') style = STYLE[0];   // open positions are the longer holds
      const vm = venueFor(c.kind, style);
      const s = {
        order: order++, coin, kind: c.kind, strat, style, market: vm.market, venue: vm.venue,
        // shorts need a perp (spot and DEX swaps are long-only)
        side: vm.market === 'perp' && chance(0.6) ? 'short' : 'long', entryMs,
        holdMs: Math.round(Math.exp(between(Math.log(style.hold[0]), Math.log(style.hold[1])))),
        // ~15% wait in the review queue overall — mostly the recent ones (old trades ~7%, the last week ~35%)
        open: !!open, reviewed: !open && !chance(0.07 + 0.32 * prog ** 3), mk: open ? [] : drawMistakes(prog),
        ordIn: vm.market === 'dex' ? null : chance(0.45) ? 'maker' : 'taker',
        rr: Math.round(Math.max(strat && isNum(strat.minRR) ? strat.minRR : 1.5, between(1.5, 3)) * 10) / 10,
        lev: vm.market === 'perp' ? Math.min(maxLev, pick([2, 3, 3, 5, 5])) : null,
        fundRate: between(0.00004, 0.00013) * (chance(0.15) ? -1 : 1),   // per 8h settlement
        exc: !open && chance(0.4),
      };
      s.sp = stopPct(s);
      return s;
    }
    // Gross price-R outcome (exit distance in stop units). Mistakes lower the odds and enlarge the losses.
    function outcome(s) {
      const mk = s.mk, nm = Math.min(mk.length, 2);
      let pWin = [0.53, 0.40, 0.27][nm] + s.style.edge;
      if (mk.some(m => m === 'fomo' || m === 'revenge' || m === 'boredom' || m === 'no_plan')) pWin -= 0.06;
      if (!mk.includes('moved_stop') && !mk.includes('held_loser') && !mk.includes('no_stop') && chance(0.06)) {
        const g = s.kind === 'pulse' && chance(0.5) ? 0 : between(-0.08, 0.08);
        return { g, kind: 'scratch' };
      }
      if (chance(pWin)) {
        if (mk.includes('early_exit')) return { g: between(0.3, 0.9), kind: 'win' };
        if (mk.includes('no_tp')) return { g: between(0.4, Math.max(0.5, s.rr * 0.6)), kind: 'win' };
        if (chance(0.3)) return { g: s.rr * between(0.97, 1), kind: 'target' };
        const mean = [2.05, 1.65, 1.35][nm] * s.style.winMul;
        return { g: Math.min(s.rr * 1.6, Math.max(0.35, mean + normal() * 0.6)), kind: 'win' };
      }
      if (mk.includes('no_stop')) return { g: -between(1.1, 2.2), kind: 'slip' };
      if (mk.includes('moved_stop') || mk.includes('held_loser')) return { g: -between(1.3, 1.9), kind: 'slip' };
      if (mk.includes('exec_error')) return { g: -between(1.15, 1.35), kind: 'slip' };
      if (chance(0.25)) return { g: -between(0.25, 0.85), kind: 'cut' };
      if (s.kind === 'pulse' && chance(0.15)) return { g: -between(1.15, 1.35), kind: 'slip' };   // thin-pool slippage
      if (chance(0.06)) return { g: -between(1.2, 1.35), kind: 'slip' };                            // gap through the stop
      return { g: -between(1.0, 1.03), kind: 'stop' };
    }
    const fitWindow = (s) => {
      if (s.entryMs + s.holdMs > winEnd) { s.holdMs = Math.max(5 * MIN, winEnd - s.entryMs); if (s.entryMs + s.holdMs > winEnd) s.entryMs = winEnd - s.holdMs; }
    };

    const openN = n >= 10 ? (chance(0.5) ? 2 : 3) : 1, closedN = n - openN;
    let closed = [];
    for (let i = 0; i < closedN; i++) {
      // stratified over the window so trades spread across ~110 days, then a weighted hour of day
      const t = winStart + (i + rnd()) / closedN * (winEnd - winStart);
      const day = new Date(t); day.setHours(0, 0, 0, 0);
      closed.push(makeSpec(day.getTime() + wpick(HOUR_W.map((w, h) => [h, w])) * HOUR + int(0, 59) * MIN, false));
    }
    // A few trades without a stop (R stays "—")
    if (known.has('no_stop') && closedN >= 20) {
      for (let k = Math.max(1, Math.round(closedN * 0.035)), g = 0; k > 0 && g < 200; g++) {
        const s = closed[int(0, closed.length - 1)];
        if (s.reviewed && !s.noStop) { s.noStop = true; s.exc = false; s.mk = ['no_stop'].concat(s.mk.filter(m => m !== 'no_stop')).slice(0, 2); k--; }
      }
    }
    closed.sort((a, b) => a.entryMs - b.entryMs || a.order - b.order);
    closed.forEach(fitWindow);
    for (const s of closed) s.out = outcome(s);
    // Revenge trades: re-enter the same coin minutes after a losing exit (some override the cooldown)
    const cdMin = isNum(risk.cooldownMin) ? risk.cooldownMin : 30;
    let revLeft = known.has('revenge') && closedN >= 20 ? Math.max(1, Math.round(closedN * 0.04)) : 0;
    for (let i = 1; i < closed.length && revLeft > 0; i++) {
      const prev = closed[i - 1], cur = closed[i];
      if (!(prev.out.g < 0) || cur.noStop || prev.noStop || !cur.reviewed || prev.revenge || cur.revenge || !chance(0.35)) continue;
      const gap = int(6, Math.max(7, Math.min(25, cdMin - 3)));
      const entryMs = prev.entryMs + prev.holdMs + gap * MIN;
      if (entryMs + 20 * MIN > winEnd) continue;
      Object.assign(cur, { coin: prev.coin, kind: prev.kind, side: prev.side, market: prev.market, venue: prev.venue, ordIn: prev.ordIn, lev: prev.lev, entryMs, revenge: true, gapMin: gap });
      cur.sp = stopPct(cur);
      cur.mk = ['revenge'].concat(cur.mk.filter(m => m !== 'revenge')).slice(0, 2);
      cur.override = cdMin > 0 && gap < cdMin && chance(0.5);
      fitWindow(cur);
      cur.out = outcome(cur);
      revLeft--;
    }
    closed.sort((a, b) => a.entryMs - b.entryMs || a.order - b.order);
    // A few scale-outs: half off around 1R, the rest at the final exit
    for (const s of closed) if (!s.noStop && s.out.g >= 1.3 && chance(0.15)) { s.scale = true; s.exc = false; }

    const opens = [];
    for (let i = 0; i < openN; i++) { const s = makeSpec(now - between(2, 44) * HOUR, true); s.partial = i === 0 && openN >= 2; opens.push(s); }
    const flows = [[24, 'deposit', 1000, 'Monthly top-up'], [52, 'deposit', 1500, 'Paycheck — added to the account'], [81, 'deposit', 500, 'Top-up'], [98, 'withdrawal', 750, 'Took some profit out']]
      .map(([d, type, amt, note]) => ({ flow: true, order: order++, type, amt, note, entryMs: startMs + d * DAY + int(9, 20) * HOUR }));

    /* ── 2. Materialise in the engine's row order (entryAt, then seq) so risk is sized from the running balance ── */
    const entries = [], overrides = [];
    const ids = () => { const id = uid('d'); return { id, seq: db.seq }; };   // mirrors addEntry(): seq = counter after uid()
    let bal = START_BAL;

    function checklistItems(strat) {
      const fromMod = strat ? ok(() => (typeof Discipline !== 'undefined' && typeof Discipline.checklistFor === 'function' ? Discipline.checklistFor(strat.id) : null), null) : null;
      const items = Array.isArray(fromMod) && fromMod.length ? fromMod
        : strat && Array.isArray(strat.checklist) && strat.checklist.length ? strat.checklist
          : strat && Array.isArray(strat.entry) && strat.entry.length ? strat.entry : DEFAULT_CHECK;
      const list = items.filter(x => typeof x === 'string' && x.trim()).slice(0, 8);
      return list.length ? list : DEFAULT_CHECK;
    }
    function tagsFor(s) {
      const hasT = (t) => marketTags.includes(t), opt = (arr) => arr.filter(hasT);
      let mt;
      if (s.side === 'long' && s.out && s.out.g < 0 && hasT('BTC dumping') && chance(0.3)) mt = 'BTC dumping';
      else mt = pick(s.side === 'short' ? opt(['Trending down', 'Ranging', 'News / volatile']) : opt(['Trending up', 'Trending up', 'Ranging', 'News / volatile']));
      const tf = pick(s.style.tf.filter(t => tfTags.includes(t)));
      const out = [mt || pick(marketTags), tf || pick(tfTags)];
      if (chance(0.7)) out.push(pick(SETUPS));
      return [...new Set(out.filter(Boolean))];
    }
    function emoPreFor(s) {
      const m = s.mk, out = [];
      if (m.includes('fomo')) out.push('fomo');
      if (m.includes('revenge')) out.push(chance(0.5) ? 'winback' : 'frustrated');
      if (m.includes('boredom')) out.push('bored');
      if (m.includes('overconfidence')) out.push('euphoric');
      if (m.includes('early_exit') || m.includes('late_entry')) out.push(chance(0.5) ? 'anxious' : 'fearful');
      if (new Date(s.entryMs).getHours() < 5) out.push('tired');
      if (!out.length) out.push(chance(0.75) ? (chance(0.6) ? 'calm' : 'confident') : 'anxious');
      return [...new Set(out)].filter(x => PRE.has(x)).slice(0, 2);
    }
    function emoPostFor(s) {
      const g = s.out.g, nm = s.mk.length;
      const id = g > 0.1 ? (g > 2.5 && chance(0.4) ? 'euphoric' : chance(0.6) ? 'satisfied' : 'relieved')
        : g >= -0.1 ? 'indifferent' : nm ? (chance(0.5) ? 'regretful' : 'frustrated') : (chance(0.5) ? 'indifferent' : 'satisfied');
      return POST.has(id) ? [id] : [];
    }
    // Journal fields: tags, checklist, emotions, thesis, review, grade (grade = Metrics.suggestGrade on the same inputs)
    function journal(s, px, rpActual, exitMs) {
      const f = {}, mk = s.mk, nm = mk.length;
      const tfName = pick(s.style.tf), txt = { c: s.coin, tf: tfName, s: fmtPriceText(px.stop), t: fmtPriceText(px.target), e: fmtPriceText(px.entry) };
      f.tags = tagsFor(s);
      const items = checklistItems(s.strat);
      let miss = nm === 0 ? 0 : nm === 1 ? (chance(0.6) ? 1 : 0) : (chance(0.5) ? 2 : 1);
      if (mk.includes('ignored_setup') || mk.includes('no_plan')) miss = Math.max(miss, 2);
      if (s.noStop) miss = Math.max(miss, 1);
      miss = Math.min(miss, Math.max(0, items.length - 1));
      const missed = new Set(); for (let g = 0; missed.size < miss && g < 40; g++) missed.add(int(0, items.length - 1));
      f.checklist = { strategyId: s.strat ? s.strat.id : null, items: items.map((text, i) => ({ text, met: !missed.has(i) })) };
      f.rulesMetPct = Math.round((items.length - missed.size) / items.length * 1000) / 1000;
      f.emoPre = emoPreFor(s);
      f.emoPreInt = nm ? int(3, 5) : chance(0.2) ? 3 : int(1, 2);
      f.confidence = mk.includes('overconfidence') ? 5 : nm ? int(2, 4) : int(3, 5);
      f.thesis = fill(pick(THESIS[s.side === 'short' ? 'short' : 'long']), txt);
      if (!s.noStop) f.invalidation = fill(pick(INVALID[s.side === 'short' ? 'short' : 'long']), txt);
      if (chance(0.4)) f.notes = s.kind === 'pulse' && chance(0.5) ? pick(DEX_NOTES) : pick(NOTES);
      if (s.open || !s.reviewed) { f.mistakes = []; return f; }   // [] = waiting in the review queue
      f.mistakes = nm ? mk.slice() : ['none'];
      f.emoPost = emoPostFor(s);
      const ctx = { riskPerTradePct: risk.maxRiskPct || 1 };
      const grade = ok(() => Metrics.suggestGrade({ mistakes: f.mistakes, rulesMetPct: f.rulesMetPct, stopPrice: s.noStop ? null : px.stop, riskPct: rpActual }, ctx), null);
      if (grade) { f.grade = grade; f.gradeAuto = grade; }
      f.discipline = nm === 0 ? int(4, 5) : nm === 1 ? 3 : int(1, 2);
      f.review = {
        wentWell: nm ? pick(WELL_PARTIAL) : pick(WELL),
        improve: nm ? (LESSON[mk[0]] || 'Stick to the checklist.') : pick(IMPROVE),
        lesson: nm ? (LESSON[mk[mk.length - 1]] || 'Stick to the checklist.') : pick(CLEAN_LESSON),
        followedPlan: nm === 0 ? 'yes' : nm === 1 ? 'partly' : 'no',
        reviewedAt: iso(Math.min(now - MIN, exitMs + int(20, 600) * MIN)),
      };
      return f;
    }

    function materialize(s) {
      const c = COINS[s.coin], dir = s.side === 'short' ? -1 : 1;
      const E = sig(priceAt(s.coin, s.entryMs) * (1 + (rnd() - 0.5) * 0.004), 6);
      const stop = sig(E * (1 - dir * s.sp), 5), sd = Math.abs(E - stop);
      const target = sig(E + dir * s.rr * sd, 5);
      const rp = s.mk.includes('oversize') ? baseRisk * between(1.6, 2.1) : baseRisk * between(0.85, 0.99);
      const unit = 10 ** -c.dp;
      let amount = floorTo(bal * rp / sd, c.dp); if (!(amount > 0)) amount = unit;
      const rpActual = bal > 0 ? amount * sd / bal : null;
      const exitMs = s.entryMs + s.holdMs;
      const dex = s.market === 'dex', perp = s.market === 'perp';
      const zeroGas = s.out && s.out.kind === 'scratch' && s.out.g === 0;   // an exact scratch stays an exact breakeven
      // One closed leg: exit price from gross price-R, then fees (presets), funding (perps) and gas (PulseChain)
      const leg = (amt, g, outMs, ordOut) => {
        const X = sig(E + dir * g * sd, 6);
        const { ri, ro } = rates(s.venue, s.market, s.ordIn, ordOut);
        const fees = dex ? 0 : r2(amt * E * ri + amt * X * ro);
        const settlements = perp ? Math.floor(outMs / (8 * HOUR)) - Math.floor(s.entryMs / (8 * HOUR)) : 0;   // 00/08/16 UTC
        const funding = perp ? r2(settlements * amt * E * s.fundRate * dir) : 0;
        const gasNative = dex && !zeroGas ? int(150, 480) : 0;
        const gas = gasNative ? r4(gasNative * priceAt('PLS', outMs)) : 0;
        return { X, fees, funding, gas, gasNative, net: (X - E) * amt * dir - fees - funding - gas, outMs, ordOut };
      };
      const ordOutFor = (g) => (dex ? null : g >= s.rr * 0.95 ? 'maker' : 'taker');
      const common = {
        coin: s.coin, strategyId: s.strat ? s.strat.id : null, side: s.side, entryAt: nowLocalInput(s.entryMs),
        entryPrice: E, stopPrice: s.noStop ? undefined : stop, targetPrice: target, market: s.market, venue: s.venue,
        orderTypeEntry: s.ordIn || undefined, createdAt: iso(s.entryMs),
      };
      if (perp) {
        const lq = ok(() => Engine.liqPrice({ side: s.side, entry: E, qty: amount, leverage: s.lev, mmr: 0.005 }), null);
        Object.assign(common, { leverage: s.lev, marginMode: 'isolated', mmr: 0.005, liqPrice: lq && isNum(lq.price) ? sig(lq.price, 6) : undefined });
      }
      if (dex) {
        common.chain = 'pulsechain';
        if (s.side === 'long') common.plannedEntry = sig(E / (1 + between(0.002, 0.012)), 6);   // the pool moved against the buy
      } else if (s.ordIn === 'taker' && chance(0.3)) common.plannedEntry = sig(E * (1 - dir * between(0.0002, 0.001)), 6);
      const legFields = (l) => (l ? clean({
        exitPrice: l.X, exitAt: nowLocalInput(l.outMs), fees: dex ? undefined : l.fees, funding: perp ? l.funding : undefined,
        gas: dex ? l.gas : undefined, gasNative: dex && l.gasNative ? l.gasNative : undefined, orderTypeExit: l.ordOut || undefined, updatedAt: iso(l.outMs),
      }) : { exitPrice: null });

      // portions: [parent, scale?]
      let pLeg = null, sLeg = null, pAmt = amount, sAmt = 0;
      if (s.open) {
        if (s.partial) { pAmt = Math.max(unit, floorTo(amount / 2, c.dp)); sAmt = Math.max(unit, floorTo(amount - pAmt, c.dp)); sLeg = leg(sAmt, between(0.9, 1.3), s.entryMs + (now - 10 * MIN - s.entryMs) * between(0.3, 0.7), 'maker'); }
      } else if (s.scale) {
        pAmt = Math.max(unit, floorTo(amount / 2, c.dp)); sAmt = Math.max(unit, floorTo(amount - pAmt, c.dp));
        pLeg = leg(pAmt, between(1.0, 1.4), s.entryMs + s.holdMs * between(0.25, 0.55), 'maker');
        sLeg = leg(sAmt, s.out.g, exitMs, ordOutFor(s.out.g));
      } else pLeg = leg(amount, s.out.g, exitMs, ordOutFor(s.out.g));

      const parent = { ...ids(), type: 'trade', ...common, amount: pAmt, ...legFields(pLeg) };
      Object.assign(parent, journal(s, { entry: E, stop, target }, rpActual, exitMs));
      // MAE / MFE: high & low while open, consistent with the exit (single-portion closed trades only)
      if (pLeg && !sLeg && s.exc) {
        const g = s.out.g;
        const maeR = g > 0 ? between(0.05, chance(0.15) ? 0.95 : 0.6) : -g + (s.out.kind === 'cut' ? between(0.05, 0.3) : between(0.01, 0.08));
        const mfeR = g > 0 ? g + between(0.05, 1.2) : between(0.08, 0.9);
        const best = E + dir * Math.max(mfeR, 0.02) * sd, worst = E - dir * Math.max(maeR, 0.02) * sd;
        parent.highDuring = sig(Math.max(best, worst, E, pLeg.X), 6);
        parent.lowDuring = sig(Math.min(best, worst, E, pLeg.X), 6);
        parent.excursionSource = 'demo';   // generated, not typed in by the user and not from candles
      }
      if (s.override) {
        const v = { rule: 'cooldown', value: s.gapMin, limit: cdMin, reason: 'Same setup came back — I wanted the loss back', at: iso(s.entryMs) };
        parent.violations = [v];
        overrides.push({ at: v.at, mode: 'demo', rule: v.rule, value: v.value, limit: v.limit, reason: v.reason, tradeId: parent.id });
      }
      entries.push(clean(parent));
      if (sLeg) {
        const sc = { ...ids(), type: 'scale', parentId: parent.id, ...common, amount: sAmt, ...legFields(sLeg), tags: parent.tags };
        delete sc.orderTypeEntry; if (!s.open) sc.notes = 'Scaled out half near 1R, let the rest run.'; else sc.notes = 'Took half off near 1R; stop to breakeven on the rest.';
        entries.push(clean(sc));
      }
      bal += (pLeg ? pLeg.net : 0) + (sLeg ? sLeg.net : 0);
    }

    const rows = closed.concat(opens, flows).sort((a, b) => a.entryMs - b.entryMs || a.order - b.order);
    for (const r of rows) {
      if (r.flow) {
        entries.push({ ...ids(), type: r.type, entryAt: nowLocalInput(r.entryMs), flowAmount: r.amt, flowNote: r.note, createdAt: iso(r.entryMs) });
        bal += r.type === 'deposit' ? r.amt : -r.amt;
      } else materialize(r);
    }
    const account = { startingBalance: START_BAL, startDate: dkey(startMs), entries };

    /* ── 3. Day records (pre-market plan + post-session review) for recent trading days ── */
    const days = {};
    const todayKey = tdKey(now);
    const dayKeys = [...new Set(closed.map(s => tdKey(s.entryMs + s.holdMs)))].filter(k => k !== todayKey).sort().slice(-8);
    for (const k of dayKeys) {
      const [y, m, d] = k.split('-').map(Number), d0 = new Date(y, m - 1, d).getTime();
      const btc = priceAt('BTC', d0 + 8 * HOUR), lvl = (f) => (Math.round(btc * f / 100) * 100).toLocaleString('en-US');
      const sleep = int(2, 5), stress = int(1, 4), mood = int(2, 5);
      const halt = { hungry: chance(0.1), angry: chance(0.08), lonely: chance(0.05), tired: sleep <= 2 || chance(0.15) };
      const score = checkinScore({ sleep, stress, mood, halt });
      const ds = closed.filter(s => tdKey(s.entryMs + s.holdMs) === k);
      const w = ds.filter(s => s.out.g > 0.1).length, l = ds.filter(s => s.out.g < -0.1).length;
      const broke = ds.filter(s => s.mk.length).length, messy = broke > 0;
      days[k] = {
        pre: { plan: pick(PLANS), bias: pick(['long', 'long', 'neutral', 'short']), levels: `BTC ${lvl(0.98)} support · ${lvl(1.02)} resistance`, maxTrades: 3, goal: pick(GOALS), readiness: { sleep, stress, mood, halt, score }, at: iso(d0 + 7.5 * HOUR) },
        post: {
          summary: `${ds.length} trade${ds.length === 1 ? '' : 's'}: ${w} win${w === 1 ? '' : 's'}, ${l} loss${l === 1 ? '' : 'es'}.${messy ? ` ${broke === 1 ? 'One trade' : broke + ' trades'} broke a rule.` : ' Followed the plan.'}`,
          wentWell: messy ? pick(WELL_PARTIAL) : pick(WELL), improve: messy ? 'Slow down after the first loss of the day.' : pick(IMPROVE),
          followedPlan: messy ? 'partly' : 'yes', grade: messy ? (broke > 1 ? 'C' : 'B') : 'A', goalMet: messy ? (chance(0.4) ? 'partly' : 'no') : 'yes', at: iso(Math.min(now - MIN, d0 + 22 * HOUR)),
        },
      };
    }

    /* ── 4. One weekly review: the latest finished week with 3+ closed trades (else last week). The snapshot has
          the fields Journal.openReview() freezes, and the notes are written from that week's own trades. ── */
    const reviews = {};
    ok(() => {
      const c = Engine.compute(account, { beBandR: S().beBandR || 0 });
      const all = Metrics.filterGroups(c.groups, {});
      const mctx = { startingBalance: c.startingBalance, now, riskPerTradePct: risk.maxRiskPct || 1, liveRiskPct: risk.maxRiskPct || 1, costs: S().costs, rules: risk,
        resetHour, maxDailyLossPct: risk.maxDailyLossPct, strategies: db.strategies, sessionScheme: S().sessionScheme };
      const weeks = [1, 2, 3, 4, 5, 6].map(k => {
        const mon = Metrics.weekKey(now - k * 7 * DAY), [y, m, d] = mon.split('-').map(Number);
        const w = { mon, monMs: new Date(y, m - 1, d).getTime(), to: dkey(new Date(y, m - 1, d + 6, 12).getTime()) };
        w.gs = all.filter(g => { const t = tdKey(g.exitMs); return t >= w.mon && t <= w.to; });
        return w;
      });
      const wk = weeks.find(w => w.gs.length >= 3) || weeks[0], gs = wk.gs;
      const s = Metrics.summary(gs, mctx), mr = Metrics.mistakeReport(gs), rs = gs.map(g => g.R).filter(isNum);
      const clean = gs.filter(g => !(ok(() => Metrics.flagsFor(g, mctx), []) || []).length).length;
      const byCost = mr.rows.filter(r => isNum(r.costR) && r.costR > 0).sort((a, b) => b.costR - a.costR);
      const top = byCost[0] || mr.rows.filter(r => r.pl < 0).sort((a, b) => a.pl - b.pl)[0] || [...mr.rows].sort((a, b) => b.n - a.n)[0] || null;
      const best = gs.length ? gs.reduce((a, g) => (g.netPL > a.netPL ? g : a)) : null;
      const worst = gs.length ? gs.reduce((a, g) => (g.netPL < a.netPL ? g : a)) : null;
      const brief = (g) => (g ? { id: g.trade.id, coin: g.coin || '', pl: g.netPL, R: isNum(g.R) ? g.R : null } : null);
      const dm = Metrics.dailyMap(gs, resetHour);
      const inWeek = (t) => { const ms = Date.parse(t); if (!isFinite(ms)) return false; const k = tdKey(ms); return k >= wk.mon && k <= wk.to; };
      const at = iso(Math.min(now - MIN, wk.monMs + 7 * DAY + 10 * HOUR));
      const pl = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
      const nA = gs.filter(g => g.trade.grade === 'A').length;
      const share = gs.length ? clean / gs.length : 0;
      reviews['W:' + wk.mon] = {
        kind: 'week',
        wins: gs.length ? `${clean} of ${pl(gs.length, 'trade')} followed every rule${nA ? `, ${nA} graded A` : ''}.${best && best.netPL > 0 && isNum(best.R) ? ` Best trade: ${best.coin} ${fmtR(best.R, 1)}.` : ''}`
          : 'A quiet week — no trades closed, and none forced either.',
        mistakes: top ? `${mistakeLabel(top.key)}: ${pl(top.n, 'trade')}${isNum(top.costR) && top.costR > 0 ? `, about ${fmtR(-top.costR, 1)} against my clean trades` : ''}.${mr.unreviewed ? ` ${pl(mr.unreviewed, 'trade')} still to review.` : ''}`
          : `No mistakes tagged on the reviewed trades.${mr.unreviewed ? ` ${pl(mr.unreviewed, 'trade')} still to review.` : ''}`,
        lessons: top && LESSON[top.key] ? LESSON[top.key] : pick(CLEAN_LESSON),
        focus: top && FOCUS[top.key] ? FOCUS[top.key] : pick(GOALS),
        rating: Math.max(1, Math.min(5, 2 + (share >= 0.6 ? 1 : 0) + (share >= 0.85 ? 1 : 0) + (s.pl > 0 ? 1 : 0))),
        prevFocusMet: 'partly',
        snapshot: {
          n: s.n, pl: s.pl, R: rs.length ? rs.reduce((a, v) => a + v, 0) : null, rN: rs.length, expR: s.expR, winRate: s.winRate,
          adherence: s.adherence ? s.adherence.pct : null, clean, wins: s.wins, losses: s.losses, days: dm.size, greenDays: s.greenDays,
          journaled: [...dm.keys()].filter(k => days[k]).length, overrides: overrides.filter(x => inWeek(x.at)).length,
          reviewed: mr.reviewed, unreviewed: mr.unreviewed,
          top: top ? { id: top.key, n: top.n, costR: isNum(top.costR) ? top.costR : null, pl: top.pl } : null,
          best: brief(best), worst: best === worst ? null : brief(worst), takenAt: at,
        },
        createdAt: at, updatedAt: at,
      };
    });

    /* ── 5. Missed trades (passed setups) — reason ids match the Journal's missed-trade log ── */
    const missed = [
      ['hesitation', 2.3, 'Hesitated at the level, then watched it run to the target.'],
      ['rules', -1, 'Correct pass — volume never confirmed and the breakout failed.'],
      ['away', 1.4, 'The alert fired while I was away from the screen.'],
    ].map(([reason, outcomeR, notes], i) => {
      const ms = now - (10 + i * 17) * DAY + int(9, 20) * HOUR;
      return { id: uid('m'), at: nowLocalInput(ms), coin: pick(['BTC', 'ETH', 'SOL', 'PLSX']), side: 'long', strategyId: strats.length ? strats[i % strats.length].id : null,
        reason, plannedR: 2, outcomeR, notes, createdAt: iso(ms), updatedAt: iso(ms) };
    });

    // Write demo-only stores; overrides from earlier demo data are replaced, paper/live ones kept
    db.accounts.demo = account;
    if (!db.days) db.days = {}; if (!db.reviews) db.reviews = {}; if (!db.missed) db.missed = {};
    db.days.demo = days; db.reviews.demo = reviews; db.missed.demo = missed;
    db.overrides = (Array.isArray(db.overrides) ? db.overrides : []).filter(x => !x || x.mode !== 'demo').concat(overrides);
    return entries;
  }

  // Generate once when the demo account is empty (called by App.switchMode('demo')). Bookkeeping only: save(), never commit().
  function ensure() {
    const a = db.accounts && db.accounts.demo;
    // Never regenerate over anything the user has: trashed demo trades (30-day Trash promise),
    // demo journal days, reviews or missed trades. "Remove demo data" then load is the explicit reset.
    const has = (o) => !!o && (Array.isArray(o) ? o.length > 0 : Object.keys(o).length > 0);
    if (a && Array.isArray(a.entries) && a.entries.length) return false;
    if (has(db.days && db.days.demo) || has(db.reviews && db.reviews.demo) || has(db.missed && db.missed.demo)) return false;
    generate();
    save();
    if (db.mode === 'demo') recompute();
    return true;
  }
  // Reset the demo account (user action from Settings) — paper and live are untouched
  function clear() {
    db.accounts.demo = freshAccount(START_BAL);
    if (!db.days) db.days = {}; if (!db.reviews) db.reviews = {}; if (!db.missed) db.missed = {};
    db.days.demo = {}; db.reviews.demo = {}; db.missed.demo = [];
    db.overrides = (Array.isArray(db.overrides) ? db.overrides : []).filter(x => !x || x.mode !== 'demo');
    commit('Demo data removed');
  }

  return { generate, ensure, clear };
})();
