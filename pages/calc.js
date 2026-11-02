/* ═══════════════════════════════════════════════════════════
   CryptoJournal — Position Size page (global Calc)
   Risk a fixed % of the account, let the stop distance size the
   trade, then show what leverage, liquidation, fees and DEX price
   impact do to that plan — in $, % and R, in plain language.
   Inputs live in module state (mirrored to localStorage 'cj.calc')
   so router re-renders never wipe what the user typed.
   Public: Calc.prefill({coin, side, entry, stop, target, riskPct, …})
   ═══════════════════════════════════════════════════════════ */
const Calc = (() => {
  const LS = 'cj.calc';
  const KEYS = ['balance', 'coin', 'side', 'entry', 'stop', 'target', 'risk', 'market', 'venue', 'legIn', 'legOut', 'feeIn', 'feeOut', 'lev', 'marginMode', 'mmr', 'poolLiq'];
  const DEFAULTS = () => ({
    balance: '', coin: '', side: 'long', entry: '', stop: '', target: '', risk: '',
    market: '', venue: '', legIn: 'taker', legOut: 'taker', feeIn: '', feeOut: '',
    lev: '', marginMode: 'isolated', mmr: '', poolLiq: '',
  });
  const DEX_VENUES = ['PulseX', '9mm'];
  const MKTS = ['spot', 'perp', 'dex'];
  const SYM_RE = /^[A-Z0-9]{1,15}$/;

  function loadState() {
    const s = DEFAULTS();
    try {
      const o = JSON.parse(localStorage.getItem(LS) || 'null');
      if (o && typeof o === 'object') for (const k of KEYS) if (typeof o[k] === 'string') s[k] = o[k].slice(0, 40);
    } catch (e) { /* private window / blocked storage — defaults */ }
    return s;
  }
  let st = loadState();
  const persist = debounce(() => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* ok */ } }, 400);
  let ui = null;       // { root, segs } — the built DOM, reused across re-renders
  let look = null;     // { sym, busy, none } live-price lookup status
  let dexLiq = null;   // { sym, usd, at } DexScreener pool liquidity for the coin
  let dexLook = null;  // { sym, busy, none, at }

  /* ── Small helpers ──────────────────────────────────────── */
  const norm = (s) => String(s == null ? '' : s).toUpperCase().trim();
  // Accepts "67,000.5", "$0.00012", "0,5" / "0,500" (decimal comma), "8.35e-7", "0.5%", "10x" and "−2".
  // A unit typed in the box must never make the value unreadable — "0.5%" silently falling
  // back to the 1% default would double the position size.
  function num(s) {
    let t = String(s == null ? '' : s).trim().replace(/[\s$%×]/g, '').replace(/−/g, '-').replace(/x$/i, '');
    if (!t) return null;
    // thousands groups never start with 0 — "0,500" is a decimal comma, "1,500" is fifteen hundred
    if (/^-?[1-9]\d{0,2}(,\d{3})+(\.\d*)?$/.test(t)) t = t.replace(/,/g, '');
    else if (/^-?\d*,\d+$/.test(t)) t = t.replace(',', '.');
    const v = Number(t);
    return isFinite(v) ? v : null;
  }
  // Something typed that isn't a number — flagged instead of quietly using the default
  const filled = (k) => String(st[k] == null ? '' : st[k]).trim() !== '';
  const badNum = (k) => filled(k) && num(st[k]) == null;
  const NAN_MSG = 'That isn’t a number — type digits only, e.g. 0.5 or 67000';
  // Number → input text without exponent notation (tiny PulseChain prices stay readable)
  const numStr = (v) => (isNum(v) ? v.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }) : '');
  const pctTxt = (v) => numStr(v) + '%';
  // fixed decimals with the true minus sign (core formatters' convention)
  const dec = (v, dp) => { if (!isNum(v)) return '—'; const a = Math.abs(v).toFixed(dp == null ? 2 : dp); return (v < 0 && +a !== 0 ? MINUS : '') + a; };
  const hasMarket = () => typeof Market !== 'undefined';
  const isOnline = () => (hasMarket() ? Market.online() : navigator.onLine !== false);
  const curBal = () => (C && isNum(C.balance) ? C.balance : (acct() && isNum(acct().startingBalance) ? acct().startingBalance : 0));
  const bal = () => { const v = num(st.balance); return v != null ? v : curBal(); };
  const riskPct = () => { const v = num(st.risk); return v != null ? v : effectiveMaxRisk(); };
  const legOf = (v) => (v === 'maker' ? 'maker' : 'taker');
  const modeName = () => (db.mode === 'live' ? 'live' : db.mode === 'demo' ? 'demo' : 'paper');
  const mLabel = (id) => (MARKETS.find(m => m.id === id) || {}).label || id;
  const fees = () => S().fees || {};
  const costs = () => S().costs || {};
  const mkt = () => (MKTS.includes(st.market) ? st.market : MKTS.includes(fees().defaultMarket) ? fees().defaultMarket : 'spot');
  function defaultVenueFor(m) {
    const d = fees().defaultVenue;
    if (m === 'dex') return DEX_VENUES.includes(d) ? d : 'PulseX';
    return VENUES.includes(d) && !DEX_VENUES.includes(d) ? d : 'Binance';
  }
  const ven = () => (VENUES.includes(st.venue) ? st.venue : defaultVenueFor(mkt()));
  // Switching between CEX and DEX swaps the venue too; a new market always means new preset fees
  function setMarket(v) {
    if (!MKTS.includes(v)) return;
    const onDex = DEX_VENUES.includes(ven());
    st.market = v;
    if (v === 'dex' && !onDex) st.venue = defaultVenueFor('dex');
    if (v !== 'dex' && onDex) st.venue = defaultVenueFor(v);
    st.feeIn = ''; st.feeOut = '';
  }
  const presetFor = (venue, m) => { const p = (fees().presets || {})[`${venue}|${m}`]; return p && typeof p === 'object' ? p : null; };
  const defaultFee = () => (isNum(costs().cexFeePct) ? costs().cexFeePct : 0.1);
  // % per side for a leg: the box if typed, else the venue preset, else the cost model default
  function legPreset(which) {
    const p = presetFor(ven(), mkt()), leg = legOf(which === 'in' ? st.legIn : st.legOut);
    return p && isNum(p[leg]) ? p[leg] : defaultFee();
  }
  function feePct(which) { const v = num(which === 'in' ? st.feeIn : st.feeOut); return v != null && v >= 0 && v < 20 ? v : legPreset(which); }
  function dexFeePct() { const p = presetFor(ven(), 'dex'); return p && isNum(p.swap) ? p.swap : (isNum(costs().dexFeePct) ? costs().dexFeePct : 0.29); }
  const levOf = () => { const v = num(st.lev); return v != null && v >= 1 ? Math.min(v, 200) : 1; };
  const mmrOf = () => { const v = num(st.mmr); return v != null && v >= 0 && v < 50 ? v / 100 : 0.005; };
  const unitHtml = (obj) => (S().units === '$' ? `<span class="money">${fmtUnit(obj)}</span>` : fmtUnit(obj));
  const resultHtml = (pl, pct, R) => `<span class="${plClass(pl)}">${glyph(pl)} ${unitHtml({ netPL: pl, changePct: pct, R })}</span>`;
  const tile = (label, value, sub, cls, tip) =>
    `<div class="result-tile ${cls || ''}"><div class="rl">${esc(label)}${tip || ''}</div><div class="rv">${value}</div>${sub ? `<div class="rs">${sub}</div>` : ''}</div>`;

  /* ── The maths ──────────────────────────────────────────── */
  function compute() {
    const m = mkt(), venue = ven(), side = st.side === 'short' ? 'short' : 'long';
    const b = bal(), entry = num(st.entry), stop = num(st.stop), target = num(st.target), risk = riskPct();
    const o = { m, venue, side, b, entry, stop, target, risk, errs: {}, flip: false, qty: null };
    for (const k of ['balance', 'entry', 'stop', 'target', 'risk']) if (badNum(k)) o.errs[k] = NAN_MSG;
    if (entry != null && !(entry > 0)) o.errs.entry = 'Entry must be above 0';
    if (stop != null && !(stop > 0)) o.errs.stop = 'The stop must be above 0';
    else if (stop != null && entry > 0) {
      if (stop === entry) o.errs.stop = 'The stop can’t be the same as the entry';
      else if (side === 'long' && stop > entry) { o.errs.stop = 'For a long, the stop goes below your entry.'; o.flip = true; }
      else if (side === 'short' && stop < entry) { o.errs.stop = 'For a short, the stop goes above your entry.'; o.flip = true; }
    }
    if (target != null && entry > 0 && (!(target > 0) || (side === 'long' && target <= entry) || (side === 'short' && target >= entry))) {
      o.errs.target = side === 'long' ? 'For a long, the target goes above your entry' : 'For a short, the target goes below your entry';
    }
    if (!(risk > 0)) o.errs.risk = 'Risk must be above 0%';
    else if (risk > 100) o.errs.risk = 'Risk can’t be more than 100% of the account';
    if (num(st.balance) != null && !(b > 0)) o.errs.balance = 'Balance must be above 0';
    // an unreadable box blocks sizing (it never falls back to a default the user didn't choose)
    o.missing = o.errs.balance || (!(b > 0) ? 'Enter your account balance to size the trade' : '')
      || (entry == null ? o.errs.entry || 'Enter your entry price to size the trade' : o.errs.entry)
      || (stop == null ? o.errs.stop || 'Add a stop-loss — the position size comes from it' : o.errs.stop)
      || o.errs.risk || '';
    if (o.missing) return o;

    const ps = Engine.positionSize({ balance: b, entry, stop, target: o.errs.target ? null : target, riskPct: risk });
    if (!isNum(ps.cryptoAmount) || !(ps.cryptoAmount > 0)) { o.missing = 'Check the entry and stop prices'; return o; }
    o.qty = ps.cryptoAmount; o.notional = ps.capitalNeeded; o.risk$ = ps.amountRisked;
    o.rr = isNum(ps.rr) && !o.errs.target ? ps.rr : null;
    o.stopPct = ps.stopPct; o.targetPct = o.rr != null ? ps.targetPct : null;
    o.effLev = o.notional / b;
    o.reward$ = o.rr != null ? o.risk$ * o.rr : null;

    // Costs — DEX: 0.29% swap fee + pool price impact, both paid again on exit; CEX: maker/taker per leg
    if (m === 'dex') {
      const typed = num(st.poolLiq), s = norm(st.coin);
      const liq = typed != null && typed > 0 ? typed : dexLiq && dexLiq.sym === s ? dexLiq.usd : null;
      o.poolLiq = liq; o.poolSrc = typed != null && typed > 0 ? 'you' : liq ? 'DexScreener' : null;
      o.impact = liq > 0 ? o.notional / (liq / 2 + o.notional) : null;   // constant-product estimate S / (L/2 + S)
      o.swapFee = dexFeePct() / 100;
      // in, then out again on what is left: 1 − (1 − p)² (≈ 2p when small, never above 100% when huge)
      const perSide = Math.min(1, o.swapFee + (o.impact || 0));
      o.costPct = 1 - (1 - perSide) * (1 - perSide);
      o.cost$ = o.notional * o.costPct;
    } else {
      const fe = Engine.feeEstimate({ qty: o.qty, entry, stop, rateEntry: feePct('in') / 100, rateExit: feePct('out') / 100 });
      o.cost$ = fe ? fe.usd : null; o.costPct = fe ? fe.pctOfNotional : null;
    }
    o.costR = isNum(o.cost$) && o.risk$ > 0 ? o.cost$ / o.risk$ : null;
    const c = o.costR || 0;
    if (o.rr != null) {
      o.netRR = (o.rr - c) / (1 + c);            // winners make RRR − c, losers lose 1 + c
      o.beBefore = 1 / (o.rr + 1);
      o.beAfter = (1 + c) / (o.rr + 1);
    }
    if (m === 'perp') {
      o.L = levOf(); o.mmr = mmrOf(); o.mode = st.marginMode === 'cross' ? 'cross' : 'isolated';
      o.margin = o.notional / o.L;
      o.liq = o.L > 1 ? Engine.liqPrice({ side, entry, qty: o.qty, leverage: o.L, mmr: o.mmr, mode: o.mode, balance: b }) : null;
      // a cross estimate at $0 means "no liquidation": liqCheck would still call a deep stop 'tight'
      // (stop distance > half of entry→0) and the checks would contradict the "None above $0" tile
      o.liqState = o.liq && o.liq.price > 0 ? Engine.liqCheck(side, entry, stop, o.liq) : null;
      o.maxSafe = 1 / (2 * o.stopPct + o.mmr);   // liquidation ≥ 2× the stop distance away
      o.funding8h = o.notional * 0.0001;          // the usual 0.01% per 8h baseline
    }
    return o;
  }

  /* ── Output HTML ────────────────────────────────────────── */
  // The user's own closed-trade win rate beside what this plan needs — only from 20 trades (sample-size rule)
  function yoursHtml(o) {
    const s = C && C.stats, n = s && s.total ? s.total : 0;
    if (!n) return '';
    if (n < 20 || !isNum(s.winRate)) return `<br><span class="dim">Your own win rate appears here after 20 closed trades (${n} so far).</span>`;
    return `<br>Your win rate so far: <b>${fmtPct(s.winRate, { dp: 0 })}</b> ${confBadge(n)}${s.winRate < o.beAfter ? ' — <b>lower than this plan needs.</b>' : ''}`;
  }
  function tilesHtml(o) {
    const D = '<span class="dim">—</span>';
    const sym = norm(st.coin), unit = esc(sym || 'units'), has = isNum(o.qty) && o.qty > 0;
    const c = o.costR || 0, maxC = isNum(S().risk.maxCostR) ? S().risk.maxCostR : 0.25;
    const t = [];
    t.push(`<div class="result-tile big"><div class="rl"><svg width="13" height="13" aria-hidden="true"><use href="#i-target"/></svg>Position size</div>
      <div class="rv">${has ? `${fmtQty(o.qty)}<small>${unit}</small>` : D}</div>
      <div class="rs">${has ? `${o.side === 'short' ? 'Sell short' : 'Buy'} about ${money(o.notional)} worth at ${fmtPrice(o.entry)}` : esc(o.missing)}</div></div>`);
    t.push(tile('Position value', has ? money(o.notional) : D, has ? (o.m === 'perp' ? 'Notional — the full size the exchange sees' : 'Cash needed to open it') : ''));
    t.push(tile('Amount at risk', has ? `<span class="neg">${glyph(-1)} ${money(-o.risk$)}</span>` : D,
      has ? `${fmtPct(o.risk$ / o.b)} of your account if the stop is hit — this is your 1R` : '',
      has && o.risk > effectiveMaxRisk() + 1e-9 ? 'warnt' : '',
      tipFor('rMultiple', 'R is the dollar amount you lose if your stop is hit. Results are measured in multiples of it: +2R means you made twice what you risked.')));
    if (has) {
      const cashOver = o.m !== 'perp' && o.effLev > 1.0001;
      t.push(tile('Effective leverage', `${o.effLev.toFixed(2)}×`,
        cashOver ? `Needs ${money(o.notional)} — more than your balance. Use a wider stop or a lower risk %.` : o.effLev > 3 ? 'Above 3× is aggressive for a beginner.' : 'Position value ÷ account balance',
        cashOver || o.effLev > 3 ? 'warnt' : ''));
    } else t.push(tile('Effective leverage', D, 'Position value ÷ account balance'));
    t.push(tile('Stop distance', has ? fmtPct(o.stopPct) : D, has ? `${fmtPrice(Math.abs(o.entry - o.stop))} per ${esc(sym || 'unit')} from entry` : ''));
    t.push(tile('Target distance', has && o.targetPct != null ? fmtPct(o.targetPct) : D,
      has && o.reward$ != null ? `${resultHtml(o.reward$, o.reward$ / o.b, o.rr)} if price gets there` : has ? 'Add a target to see the reward' : ''));
    const rw = o.rr != null ? o.rr / (1 + o.rr) : 0.5;
    t.push(`<div class="result-tile cl-wide ${o.rr == null ? 'cl-rr-empty' : ''}">
      <div class="rl">Planned risk : reward${tipFor('rMultiple', 'How much you could make for every $1 you risk, if price reaches your target.')}</div>
      <div class="rv">${o.rr != null ? `1 : ${o.rr.toFixed(2)}` : D}</div>
      <div class="rr-meter"><div class="rr-bar" role="img" aria-label="${o.rr != null ? esc(`Reward is ${o.rr.toFixed(2)} times the risk`) : 'No target yet'}"><div class="risk" style="width:${((1 - rw) * 100).toFixed(1)}%"></div><div class="reward" style="width:${(rw * 100).toFixed(1)}%"></div></div></div>
      <div class="rs">${o.netRR == null ? (has ? 'Add a target to see reward : risk.' : '')
        : o.rr - c <= 0 ? `<b>After costs even a win loses money</b> (${dec(o.rr - c)}R) — the costs are bigger than the reward. A loss costs ${dec(1 + c)}R.`
        : `After costs <b>1 : ${dec(o.netRR)}</b> — a win nets ${dec(o.rr - c)}R, a loss costs ${dec(1 + c)}R.`}</div></div>`);
    if (has && isNum(o.cost$)) {
      const cls = o.costR > maxC ? 'alert' : o.costR >= 0.1 ? 'warnt' : '';
      // DEX swaps have no maker orders — the lever there is a smaller size (less price impact)
      const read = o.costR > maxC ? `Above your ${numStr(maxC)}R limit — costs eat the edge. ${o.m === 'dex' ? 'Trade smaller, widen the stop' : 'Widen the stop, use maker orders'}, or skip.`
        : o.costR >= 0.1 ? (o.m === 'dex' ? 'Worth watching — a smaller swap pays less price impact.' : 'Worth watching — limit (maker) orders cost less.') : 'Small next to your risk.';
      // at the usual +0.01% / 8 h longs pay shorts; the direction flips when the rate turns negative
      const fund = o.m === 'perp' ? (o.side === 'short'
        ? ` Funding is separate: at the usual +0.01% rate a short receives about ${money(o.funding8h)} per 8 h (you pay when the rate turns negative).`
        : ` Funding is extra: about ${money(o.funding8h)} per 8 h at the usual +0.01% rate — it adds up on multi-day holds.`) : '';
      t.push(tile(o.m === 'dex' ? 'Round-trip swap cost (est.)' : 'Round-trip fees (est.)',
        `${money(o.cost$)}<small>${o.costR != null ? o.costR.toFixed(2) + 'R' : ''}</small>`,
        `${fmtPct(o.costPct)} of the position, in and out. ${read}${fund}`, cls,
        tipFor(o.m === 'dex' ? 'slippage' : 'fees', 'Fees are charged on the full position value when you open and again when you close. In R they show how much of your risk they eat.')));
    } else t.push(tile('Round-trip fees (est.)', D, ''));
    if (o.beAfter != null) {
      const impossible = o.beAfter >= 1;
      t.push(tile('Break-even win rate', impossible ? 'n/a' : fmtPct(o.beAfter, { dp: 0 }),
        impossible ? 'Costs are bigger than the reward — this trade can’t pay.' : `${fmtPct(o.beBefore, { dp: 0 })} before costs. Win more often than this to make money.${yoursHtml(o)}`,
        impossible ? 'alert' : o.beAfter > 0.6 ? 'warnt' : '',
        tipFor('beWinRate', 'The share of trades like this you must win just to break even, after costs.')));
    } else t.push(tile('Break-even win rate', D, has ? 'Needs a target' : ''));

    if (o.m === 'perp' && has) {
      const marginOver = o.margin > o.b * 1.0001;
      t.push(tile('Margin required', money(o.margin), marginOver
        ? `More than your ${money(o.b)} balance — the exchange won't open this at ${numStr(o.L)}×. More leverage means less margin but a closer liquidation; a wider stop or a lower risk % makes the position smaller.`
        : `At ${numStr(o.L)}× (${o.mode} margin). Leverage changes the margin you post, not your $ risk.`, marginOver ? 'warnt' : ''));
      if (o.liq && !(o.liq.price > 0)) {
        // cross margin with a big wallet: the estimate lands at or below zero — say so instead of "≈ 0.00, 100% away"
        t.push(tile('Liquidation (estimate)', 'None above $0',
          `Your ${money(o.b)} balance backs the whole position, so this rough cross-margin estimate never reaches liquidation. Other open positions share that balance — check your exchange.`,
          '', tipFor('liqPrice', 'The price where the exchange force-closes your position because the margin is used up. It is an estimate — exchanges use the mark price and their own margin tiers.')));
      } else if (o.liq) {
        const beyond = o.liqState === 'beyond', tight = o.liqState === 'tight';
        t.push(tile('Liquidation (estimate)', `${o.liq.approx ? '≈ ' : ''}${fmtPrice(o.liq.price)}`,
          beyond ? `<b>Your stop will never trigger — you'd be liquidated first.</b> Lower the leverage.`
            : tight ? `Only ${fmtPct(o.liq.distPct)} away and your stop uses over half of that gap. Fees and funding move liquidation closer — lower the leverage.`
            : `${fmtPct(o.liq.distPct)} away — safely beyond your ${fmtPct(o.stopPct)} stop.${o.liq.approx ? ' Cross margin: a rough guide only.' : ''}`,
          beyond ? 'alert' : tight ? 'warnt' : '',
          tipFor('liqPrice', 'The price where the exchange force-closes your position because the margin is used up. It is an estimate — exchanges use the mark price and their own margin tiers.')));
      } else t.push(tile('Liquidation (estimate)', '<span class="dim">—</span>', 'Set leverage above 1× to estimate it.'));
      const over = o.L > o.maxSafe;
      t.push(tile('Max safe leverage', `${o.maxSafe >= 100 ? '100+' : o.maxSafe.toFixed(1)}×`,
        `Keeps liquidation at least twice your stop distance away${over ? ` — you chose ${numStr(o.L)}×.` : '.'}`, over ? 'warnt' : ''));
    }
    if (o.m === 'dex' && has) {
      if (o.impact != null) {
        const cls = o.impact >= 0.02 ? 'alert' : o.impact >= 0.005 ? 'warnt' : '';
        const read = o.impact >= 0.02 ? 'Too big for this pool — trade smaller.' : o.impact >= 0.005 ? 'Use caution — consider a smaller size.' : 'Small for this pool.';
        t.push(`<div class="result-tile cl-wide ${cls}"><div class="rl">Price impact (estimate)${tipFor('slippage', 'How much your own order moves the pool price against you. Bigger orders in smaller pools pay more.')}</div>
          <div class="rv">${fmtPct(o.impact)}</div>
          <div class="rs">Pool liquidity ${money(o.poolLiq, { compact: true })} (${o.poolSrc === 'you' ? 'your figure' : 'DexScreener'}) plus the ${fmtPct(o.swapFee)} swap fee — both paid again when you sell. ${read}</div></div>`);
      } else {
        t.push(`<div class="result-tile cl-wide"><div class="rl">Price impact (estimate)</div><div class="rv"><span class="dim">—</span></div>
          <div class="rs">${isOnline() ? 'Type the pool liquidity (from DexScreener) to estimate it.' : 'Offline — type the pool liquidity to estimate it.'} The ${fmtPct(o.swapFee)} swap fee is counted above.</div></div>`);
      }
    }
    return t.join('');
  }

  function summaryHtml(o) {
    if (!isNum(o.qty)) {
      const next = String(o.missing || '').replace(/[.\s]+$/, '');
      return `<b>How it works:</b> enter your entry and stop. The calculator sizes the trade so that hitting the stop loses exactly your chosen risk %${next ? ' — ' + esc(next.charAt(0).toLowerCase() + next.slice(1)) : ''}.`;
    }
    const sym = esc(norm(st.coin) || 'units'), c = o.costR || 0;
    const parts = [`<b>${o.side === 'short' ? 'Sell short' : 'Buy'} ${fmtQty(o.qty)} ${sym}</b> (about ${money(o.notional)}) at ${fmtPrice(o.entry)}.`];
    parts.push(`If price hits your stop at ${fmtPrice(o.stop)} you lose about <b>${money(o.risk$)}</b> (${fmtPct(o.risk$ / o.b)} of your account)${o.cost$ > 0 ? ` plus about ${money(o.cost$)} in ${o.m === 'dex' ? 'swap costs' : 'fees'}` : ''}.`);
    if (o.rr != null) {
      parts.push(`At your target of ${fmtPrice(o.target)} you'd make about <b>${money(o.reward$)}</b>: ${dec(o.rr)}R before costs, ${dec(o.rr - c)}R after.`);
      parts.push(o.beAfter >= 1 ? '<b>Costs are bigger than the reward, so this trade can’t pay.</b>'
        : `You need to win more than <b>${fmtPct(o.beAfter, { dp: 0 })}</b> of trades like this to come out ahead.`);
    } else parts.push('Add a target to see the reward and the win rate you need.');
    if (o.m === 'perp' && o.liq) {
      parts.push(o.liqState === 'beyond' ? `<b class="neg">At ${numStr(o.L)}× the exchange would liquidate you before your stop.</b>`
        : `At ${numStr(o.L)}× you post ${money(o.margin)} of margin; ${o.liq.price > 0 ? `liquidation is around ${fmtPrice(o.liq.price)}` : 'with cross margin your balance keeps liquidation out of reach (rough estimate)'}.`);
    }
    if (o.m !== 'perp' && o.effLev > 1.0001) parts.push('<b>This needs more cash than your balance</b> — widen the stop or lower the risk %.');
    return parts.join(' ');
  }

  function checksHtml(o) {
    if (!isNum(o.qty)) return '<div class="dim cl-none">Checks appear once the trade is sized.</div>';
    const R = S().risk, maxR = effectiveMaxRisk(), items = [];
    const maxC = isNum(R.maxCostR) ? R.maxCostR : 0.25;
    items.push(['Stop-loss set', 'ok', 'The size comes from your stop, so your loss is capped', fmtPct(o.stopPct)]);
    items.push([`Risk at most ${pctTxt(maxR)} per trade`, o.risk > maxR + 1e-9 ? 'stop' : 'ok',
      o.risk > maxR + 1e-9 ? 'Above your rule — the journal will ask for a reason' : 'Within your rule', pctTxt(+o.risk.toFixed(3))]);
    if (isNum(o.costR)) items.push([`Costs at most ${numStr(maxC)}R`, o.costR > maxC ? 'stop' : o.costR >= 0.1 ? 'warn' : 'ok',
      o.costR > maxC ? 'Costs eat too much of the edge' : o.costR >= 0.1 ? 'Acceptable, but worth watching' : 'Small next to your risk', o.costR.toFixed(2) + 'R']);
    if (o.netRR != null) items.push(['Reward beats risk after costs', o.netRR <= 0 ? 'stop' : o.netRR < 1 ? 'warn' : 'ok',
      o.netRR <= 0 ? 'Costs wipe out the reward' : o.netRR < 1 ? 'A win would make less than a loss costs' : 'A win makes at least what a loss costs', `1 : ${dec(o.netRR)}`]);
    if (o.m === 'perp') {
      const maxL = isNum(R.maxLeverage) ? R.maxLeverage : 5;
      items.push([`Leverage at most ${numStr(maxL)}×`, o.L > maxL ? 'stop' : 'ok', o.L > maxL ? 'Above your leverage limit' : 'Within your limit', numStr(o.L) + '×']);
      items.push(['Margin fits your balance', o.margin > o.b * 1.0001 ? 'warn' : 'ok', o.margin > o.b * 1.0001 ? 'The margin needed is more than your account holds' : 'You have enough to post the margin', fmtPct(o.margin / o.b)]);
      if (o.liqState) items.push(['Stop triggers before liquidation', o.liqState === 'beyond' ? 'stop' : o.liqState === 'tight' ? 'warn' : 'ok',
        o.liqState === 'beyond' ? 'You would be liquidated before the stop' : o.liqState === 'tight' ? 'Liquidation is uncomfortably close to the stop' : 'Liquidation is well beyond the stop', fmtPct(o.liq.distPct)]);
    } else {
      items.push(['Fits your balance', o.effLev > 1.0001 ? 'warn' : 'ok', o.effLev > 1.0001 ? 'The position costs more than your account holds' : 'You have the cash for it', o.effLev.toFixed(2) + '×']);
    }
    if (o.m === 'dex' && isNum(o.impact)) items.push(['Price impact under 0.5%', o.impact >= 0.02 ? 'stop' : o.impact >= 0.005 ? 'warn' : 'ok',
      o.impact >= 0.02 ? 'Too big for this pool' : o.impact >= 0.005 ? 'Noticeable — consider a smaller size' : 'Small for this pool', fmtPct(o.impact)]);
    const word = { ok: 'passes', warn: 'warning', stop: 'fails' };
    return items.map(([l, s, h, v]) => `<div class="guard ${s}"><span class="gi" aria-hidden="true">${s === 'ok' ? '✓' : s === 'warn' ? '!' : '✕'}</span>
      <div class="cl-gt"><div class="gl">${esc(l)}<span class="sr-only"> — ${word[s]}</span></div><div class="gh">${esc(h)}</div></div><span class="gv">${esc(v)}</span></div>`).join('');
  }

  /* ── DOM: build once, then sync state ↔ inputs ──────────── */
  // put(sel, html, tone) — tone '' | 'warn' | 'err' toggles the hint colour, other classes stay
  const put = (sel, html, tone) => {
    const el = ui && $(sel, ui.root);
    if (!el) return;
    el.innerHTML = html;
    if (tone !== undefined) { el.classList.toggle('warn', tone === 'warn'); el.classList.toggle('err', tone === 'err'); }
  };
  function chipHtml() {
    const s = norm(st.coin);
    if (!s || !hasMarket() || !SYM_RE.test(s)) return '';
    const q = Market.cached(s);
    if (q) {
      return `<button type="button" class="cl-live-btn ${q.stale ? 'stale' : ''}" data-act="use-price" title="Use this price as your entry">
        <span class="pulse" aria-hidden="true"></span><span class="mono">${fmtPrice(q.usd)}</span>
        <span class="cl-live-meta">${q.stale ? 'as of ' + esc(fmtDateTime(q.at)) : 'live'}${q.source ? ' · ' + esc(q.source) : ''}</span>
        <span class="cl-live-use">Use as entry</span></button>`;
    }
    if (look && look.sym === s && look.busy) return `<span class="dim">Looking up ${esc(s)}…</span>`;
    if (look && look.sym === s && look.none) return `<span class="dim">${isOnline() ? `No live price found for ${esc(s)}` : `Offline — no saved price for ${esc(s)}`}</span>`;
    return '';
  }
  // skip identical redraws so a focused chip keeps focus when an unrelated 'prices' event arrives;
  // when the quote itself changes, move focus to the new chip (or back to the coin box) instead of <body>
  const drawChip = () => {
    const el = ui && $('#cl-live', ui.root);
    if (!el) return;
    const html = chipHtml();
    if (el._clHtml === html) return;
    const had = el.contains(document.activeElement);
    el._clHtml = html; el.innerHTML = html;
    if (had) { const f = $('button', el) || $('#cl-coin', ui.root); if (f) f.focus({ preventScroll: true }); }
  };
  // Known symbols are looked up while typing; unknown ones only once the user commits the box
  // (change/blur, or a prefill) — a half-typed "SO" must never trigger a search that caches the wrong coin.
  let forceLook = false;
  const known = (s) => hasMarket() && (!!Market.idFor(s) || Market.isPulse(s));
  const lookup = debounce(async () => {
    const s = norm(st.coin), force = forceLook;
    forceLook = false;
    if (!s || !SYM_RE.test(s) || !hasMarket() || (!force && !known(s))) { look = null; drawChip(); return; }
    look = { sym: s, busy: true }; drawChip();
    const q = await Market.price(s);
    if (norm(st.coin) !== s) return;   // the user typed on — never show another coin's price
    look = { sym: s, busy: false, none: !q }; drawChip();
    if (mkt() === 'dex') fetchDex();
  }, 600);
  async function fetchDex() {
    const s = norm(st.coin);
    if (!s || !hasMarket() || !Market.isPulse(s)) { dexLook = null; update(); return; }
    dexLook = { sym: s, busy: true, at: Date.now() }; update();
    const d = await Market.dexInfo(s);
    if (norm(st.coin) !== s) return;
    if (d && d.liquidityUsd > 0) dexLiq = { sym: s, usd: d.liquidityUsd, at: d.at };
    dexLook = { sym: s, busy: false, none: !d, at: Date.now() };
    sync(); update();
  }

  // Suggestions for the coin box: built-in symbols plus every coin in this journal
  const coinList = () => [...new Set([...Object.keys(hasMarket() ? Market.IDS : {}), ...(C ? C.groups.map(g => norm(g.coin)) : [])])].filter(s => SYM_RE.test(s)).sort();
  const coinOpts = (coins) => coins.map(s => `<option value="${esc(s)}"></option>`).join('');
  function build(el) {
    const coins = coinList();
    const field = (id, k, label, opt, hintId, extra) => `<div class="field">
        <label for="${id}">${label}${opt ? ' <span class="opt">(optional)</span>' : ''}</label>
        <input class="input mono" id="${id}" data-k="${k}" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.00" aria-describedby="${hintId}"${extra || ''}>
        <div class="hint" id="${hintId}"></div></div>`;
    el.innerHTML = `<div class="cl-root calc-layout">
      <div class="card cl-form">
        <div class="card-title"><svg aria-hidden="true"><use href="#i-calc"/></svg>Plan the trade
          <span class="aside"><button type="button" class="btn btn-quiet btn-xs" data-act="reset"><svg aria-hidden="true"><use href="#i-undo"/></svg>Clear</button></span></div>
        <p class="card-sub">Choose how much of your account you'd lose if the stop is hit. The calculator sizes the position from that — leverage never changes your $ risk.</p>
        <div class="form-grid">
          <div class="form-section">Account</div>
          <div class="field full">
            <label for="cl-balance">Account balance</label>
            <div class="input-group"><input class="input mono" id="cl-balance" data-k="balance" inputmode="decimal" autocomplete="off" aria-describedby="cl-balance-hint"><span class="addon">USD</span></div>
            <div class="hint" id="cl-balance-hint"></div>
          </div>
          <div class="form-section">Trade</div>
          <div class="field">
            <label for="cl-coin">Coin <span class="opt">(optional)</span></label>
            <input class="input mono cl-coin" id="cl-coin" data-k="coin" list="cl-coins" placeholder="BTC" maxlength="15" autocomplete="off" spellcheck="false" autocapitalize="characters" aria-describedby="cl-live">
            <datalist id="cl-coins">${coinOpts(coins)}</datalist>
            <div class="cl-live" id="cl-live" aria-live="polite"></div>
          </div>
          <div class="field">
            <label id="cl-side-l">Direction</label>
            <div id="cl-side" role="group" aria-labelledby="cl-side-l"></div>
          </div>
          ${field('cl-entry', 'entry', 'Entry price', false, 'cl-entry-hint')}
          ${field('cl-stop', 'stop', 'Stop-loss price', false, 'cl-stop-hint')}
          ${field('cl-target', 'target', 'Target price', true, 'cl-target-hint')}
          <div class="field">
            <label for="cl-risk">Risk per trade</label>
            <div class="input-group"><input class="input mono" id="cl-risk" data-k="risk" inputmode="decimal" autocomplete="off" aria-describedby="cl-risk-hint"><span class="addon">% of account</span></div>
            <div class="hint" id="cl-risk-hint"></div>
          </div>
          <div class="form-section">Where you'll trade</div>
          <div class="field full">
            <label id="cl-market-l">Market</label>
            <div id="cl-market" role="group" aria-labelledby="cl-market-l"></div>
          </div>
          <div class="field full">
            <label for="cl-venue">Venue</label>
            <select class="input" id="cl-venue">${VENUES.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>
          </div>
          <div class="full cl-legs" id="cl-fees-cex">
            <div class="field">
              <label id="cl-legin-l">Entry order</label>
              <div id="cl-legin" role="group" aria-labelledby="cl-legin-l"></div>
              <div class="input-group"><input class="input mono sm" id="cl-feein" data-k="feeIn" inputmode="decimal" autocomplete="off" aria-label="Entry fee in % of the position" aria-describedby="cl-fee-hint"><span class="addon">% fee</span></div>
            </div>
            <div class="field">
              <label id="cl-legout-l">Exit order</label>
              <div id="cl-legout" role="group" aria-labelledby="cl-legout-l"></div>
              <div class="input-group"><input class="input mono sm" id="cl-feeout" data-k="feeOut" inputmode="decimal" autocomplete="off" aria-label="Exit fee in % of the position" aria-describedby="cl-fee-hint"><span class="addon">% fee</span></div>
            </div>
            <div class="hint cl-span" id="cl-fee-hint"></div>
          </div>
          <div class="field full hidden" id="cl-dex-box">
            <label for="cl-pool">Pool liquidity <span class="opt">(for price impact)</span></label>
            <div class="input-group"><input class="input mono" id="cl-pool" data-k="poolLiq" inputmode="decimal" autocomplete="off" aria-describedby="cl-dex-hint"><span class="addon">USD</span></div>
            <div class="hint" id="cl-dex-hint"></div>
          </div>
          <div class="full cl-perp hidden" id="cl-perp-box">
            <div class="field">
              <label for="cl-lev">Leverage</label>
              <div class="input-group"><input class="input mono" id="cl-lev" data-k="lev" inputmode="decimal" placeholder="1" autocomplete="off" aria-describedby="cl-lev-hint"><span class="addon">×</span></div>
            </div>
            <div class="field">
              <label id="cl-mm-l">Margin mode</label>
              <div id="cl-mm" role="group" aria-labelledby="cl-mm-l"></div>
            </div>
            <div class="field">
              <label for="cl-mmr">Maintenance margin</label>
              <div class="input-group"><input class="input mono" id="cl-mmr" data-k="mmr" inputmode="decimal" placeholder="0.5" autocomplete="off" aria-describedby="cl-lev-hint"><span class="addon">%</span></div>
            </div>
            <div class="hint cl-span" id="cl-lev-hint"></div>
          </div>
        </div>
      </div>
      <div class="cl-out">
        <div class="result-tiles cl-tiles" id="cl-tiles"></div>
        <div class="reading cl-summary" id="cl-summary"></div>
        <div class="sr-only" id="cl-sr" aria-live="polite"></div>
        <div class="card cl-checks">
          <div class="card-title"><svg aria-hidden="true"><use href="#i-shield"/></svg>Pre-trade checks<span class="aside">your rules from Settings</span></div>
          <div class="guard-list" id="cl-checks"></div>
        </div>
        <button type="button" class="btn btn-primary cl-open" id="cl-open" data-act="open"><svg aria-hidden="true"><use href="#i-plus"/></svg>Open this trade in the journal</button>
        <p class="cl-foot">Estimates only — liquidation, fees, funding and price impact differ by venue and change over time. Confirm on your exchange before you trade.${hasMarket() ? ' ' + esc(Market.attribution) + '.' : ''}</p>
      </div>
    </div>`;
    const r = $('.cl-root', el);
    ui = { root: r, segs: {}, coinsKey: coins.join(',') };
    const mkSeg = (id, opts, val, fn, small) => { const host = $('#' + id, r); if (small) host.classList.add('sm'); return seg(host, opts, val, fn); };
    const changed = () => { persist(); sync(); update(); };
    ui.segs.side = mkSeg('cl-side', [{ id: 'long', label: 'Long (buy)' }, { id: 'short', label: 'Short (sell)' }], st.side === 'short' ? 'short' : 'long', (v) => { st.side = v; changed(); });
    ui.segs.market = mkSeg('cl-market', MARKETS.map(m => ({ id: m.id, label: m.label })), mkt(), (v) => {
      setMarket(v); changed();
      if (v === 'dex') fetchDex();
    });
    const legs = [{ id: 'taker', label: 'Taker', title: 'Market order: fills right away, higher fee' }, { id: 'maker', label: 'Maker', title: 'Limit order: waits in the order book, lower fee' }];
    ui.segs.legIn = mkSeg('cl-legin', legs, legOf(st.legIn), (v) => { st.legIn = v; changed(); }, true);
    ui.segs.legOut = mkSeg('cl-legout', legs, legOf(st.legOut), (v) => { st.legOut = v; changed(); }, true);
    ui.segs.mm = mkSeg('cl-mm', [{ id: 'isolated', label: 'Isolated' }, { id: 'cross', label: 'Cross' }], st.marginMode === 'cross' ? 'cross' : 'isolated', (v) => { st.marginMode = v; changed(); }, true);

    r.addEventListener('input', (ev) => {
      const k = ev.target && ev.target.dataset ? ev.target.dataset.k : null;
      if (!k || !KEYS.includes(k)) return;
      st[k] = String(ev.target.value).slice(0, 40);
      persist();
      if (k === 'coin') { look = null; dexLook = null; forceLook = false; lookup(); }   // typing again cancels a forced search
      update();
    });
    $('#cl-coin', r).addEventListener('change', () => { forceLook = true; lookup(); });
    $('#cl-venue', r).addEventListener('change', (ev) => {
      // a DEX venue means a DEX swap (and back): spot + PulseX would price fees that don't exist
      const v = ev.target.value, dexV = DEX_VENUES.includes(v);
      if (dexV && mkt() !== 'dex') setMarket('dex');
      else if (!dexV && v !== 'Other' && mkt() === 'dex') setMarket(['spot', 'perp'].includes(fees().defaultMarket) ? fees().defaultMarket : 'spot');
      st.venue = v; st.feeIn = ''; st.feeOut = ''; changed();
      if (mkt() === 'dex') fetchDex();
    });
    r.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-act]');
      if (!b || !r.contains(b)) return;
      const act = b.dataset.act;
      if (act === 'reset') {
        const prev = { ...st };
        st = DEFAULTS(); look = null; dexLook = null; changed(); drawChip(); $('#cl-entry', r).focus();
        toast('Calculator cleared', 'ok', {
          action: {
            label: 'Undo', run: () => {
              st = prev; look = null; dexLook = null; forceLook = !!norm(st.coin);
              persist();
              if (ui && ui.root.isConnected) { sync(); update(); lookup(); }
            },
          },
        });
      }
      // these hint links vanish once used — keep keyboard focus on the field they fixed
      else if (act === 'bal-reset') { st.balance = ''; changed(); $('#cl-balance', r).focus(); }
      else if (act === 'flip') { st.side = st.side === 'short' ? 'long' : 'short'; changed(); $('#cl-stop', r).focus(); }
      else if (act === 'use-price') {
        const q = hasMarket() ? Market.cached(norm(st.coin)) : null;
        if (!q) return;
        st.entry = numStr(q.usd); changed();
        $(num(st.stop) == null ? '#cl-stop' : '#cl-entry', r).focus();
      }
      else if (act === 'fees') { if (typeof Settings !== 'undefined' && Settings.show) Settings.show('costs'); }
      else if (act === 'settings-account') { if (typeof Settings !== 'undefined' && Settings.show) Settings.show('account'); }
      else if (act === 'open') openInJournal();
    });
  }

  function sync() {
    if (!ui) return;
    const r = ui.root, m = mkt();
    for (const inp of $$('[data-k]', r)) { const v = st[inp.dataset.k] == null ? '' : String(st[inp.dataset.k]); if (inp.value !== v) inp.value = v; }
    const sel = $('#cl-venue', r), v = ven();
    if (sel && sel.value !== v) sel.value = v;
    const want = { side: st.side === 'short' ? 'short' : 'long', market: m, legIn: legOf(st.legIn), legOut: legOf(st.legOut), mm: st.marginMode === 'cross' ? 'cross' : 'isolated' };
    for (const k of Object.keys(want)) if (ui.segs[k] && ui.segs[k].value !== want[k]) ui.segs[k].set(want[k]);
    $('#cl-fees-cex', r).classList.toggle('hidden', m === 'dex');
    $('#cl-dex-box', r).classList.toggle('hidden', m !== 'dex');
    $('#cl-perp-box', r).classList.toggle('hidden', m !== 'perp');
    // placeholders show the default an empty box falls back to
    // a placeholder can't be blurred, so privacy mode hides the balance there
    const priv = typeof View !== 'undefined' && View.privacy;
    $('#cl-balance', r).placeholder = priv ? 'Current balance' : numStr(Math.round(curBal() * 100) / 100);
    $('#cl-risk', r).placeholder = numStr(effectiveMaxRisk());
    $('#cl-feein', r).placeholder = numStr(legPreset('in'));
    $('#cl-feeout', r).placeholder = numStr(legPreset('out'));
    $('#cl-pool', r).placeholder = dexLiq && dexLiq.sym === norm(st.coin) ? numStr(Math.round(dexLiq.usd)) : 'e.g. 250000';
  }

  const announce = debounce((html) => {
    const el = ui && $('#cl-sr', ui.root);
    if (!el) return;
    const d = document.createElement('div'); d.innerHTML = html;
    el.textContent = d.textContent;
  }, 1200);

  function update() {
    if (!ui || !ui.root.isConnected) return;
    const r = ui.root, o = compute();
    // field hints
    const cb = curBal(), custom = num(st.balance) != null;
    put('#cl-balance-hint', o.errs.balance ? esc(o.errs.balance)
      : custom ? `Custom balance — your ${modeName()} balance is ${money(cb)}. <button type="button" class="link-btn" data-act="bal-reset">Use it</button>`
      : cb > 0 ? `Using your current ${modeName()} balance (${money(cb)}).`
      : `Your ${modeName()} balance is ${money(cb)} — type one here or <button type="button" class="link-btn" data-act="settings-account">set a starting balance</button>.`, o.errs.balance ? 'err' : '');
    put('#cl-entry-hint', o.errs.entry ? esc(o.errs.entry) : '', o.errs.entry ? 'err' : '');
    put('#cl-stop-hint', o.errs.stop
      ? esc(o.errs.stop) + (o.flip ? ` <button type="button" class="link-btn" data-act="flip">Switch to ${o.side === 'long' ? 'short' : 'long'}</button>` : '')
      : isNum(o.stopPct) ? `${fmtPct(o.stopPct)} from entry` : 'Where your idea is proven wrong', o.errs.stop ? 'err' : '');
    put('#cl-target-hint', o.errs.target ? esc(o.errs.target) : isNum(o.targetPct) ? `${fmtPct(o.targetPct)} from entry` : 'Where you plan to take profit', o.errs.target ? 'err' : '');
    const maxR = effectiveMaxRisk(), rule = S().risk.maxRiskPct, ramp = S().ramp || {};
    let rh = `Your max is <b>${pctTxt(maxR)}</b> per trade`;
    if (db.mode === 'live' && ramp.enabled && maxR < rule) rh += ` — live ramp stage ${esc(String(ramp.stage))} caps it (your rule is ${pctTxt(rule)})`;
    else if (db.mode === 'paper' && ramp.enabled && isNum(RAMP_STAGES[1])) rh += ` · going live, the ramp starts you at ${pctTxt(RAMP_STAGES[1])}`;
    const over = isNum(o.risk) && o.risk > maxR + 1e-9;
    put('#cl-risk-hint', o.errs.risk ? esc(o.errs.risk) : over ? `Above your ${pctTxt(maxR)} max — the journal will ask for a reason if you take this trade.` : rh + '.', o.errs.risk ? 'err' : over ? 'warn' : '');
    // optional boxes that fall back to a default: say so when what was typed can't be used
    const feeOk = (k) => { const v = num(st[k]); return !filled(k) || (v != null && v >= 0 && v < 20); };
    const levRaw = num(st.lev), mmrRaw = num(st.mmr), poolRaw = num(st.poolLiq);
    const bad = {
      feeIn: !feeOk('feeIn'), feeOut: !feeOk('feeOut'),
      lev: filled('lev') && !(levRaw != null && levRaw >= 1 && levRaw <= 200),
      mmr: filled('mmr') && !(mmrRaw != null && mmrRaw >= 0 && mmrRaw < 50),
      poolLiq: filled('poolLiq') && !(poolRaw != null && poolRaw > 0),
    };
    if (o.m !== 'dex') {
      const p = presetFor(o.venue, o.m), edit = ' <button type="button" class="link-btn" data-act="fees">Edit presets</button>';
      const legs = 'Taker = market order (fills now, stops usually fill this way); maker = limit order (waits, costs less). ';
      const feeBad = bad.feeIn || bad.feeOut;
      put('#cl-fee-hint', (feeBad ? '<b>A fee box needs a % between 0 and 20 — the preset is used instead.</b> ' : '') + legs + (p && (isNum(p.maker) || isNum(p.taker))
        ? `${esc(o.venue)} ${esc(mLabel(o.m).toLowerCase())} preset: maker ${esc(numStr(p.maker) || '—')}% · taker ${esc(numStr(p.taker) || '—')}% per side (checked ${esc(fees().checked || '—')}). Leave a box empty to use it.${edit}`
        : `No fee preset for ${esc(o.venue)} ${esc(mLabel(o.m).toLowerCase())} — using your default ${esc(numStr(defaultFee()))}% per side.${edit}`), feeBad ? 'warn' : '');
    } else {
      const s = norm(st.coin), typed = num(st.poolLiq);
      let dh;
      if (typed != null && typed > 0) dh = 'Using your figure.' + (dexLiq && dexLiq.sym === s ? ` DexScreener shows ${money(dexLiq.usd, { compact: true })}.` : '');
      else if (dexLiq && dexLiq.sym === s) dh = `DexScreener: the deepest ${esc(s)} pool holds ${money(dexLiq.usd, { compact: true })} (as of ${esc(fmtTime(dexLiq.at))}).`;
      else if (!s) dh = 'Enter the coin to look up its PulseChain pool, or type the pool liquidity.';
      else if (!hasMarket() || !Market.isPulse(s)) dh = `No built-in PulseChain contract for ${esc(s)} — type the pool liquidity from DexScreener.`;
      else if (dexLook && dexLook.sym === s && dexLook.busy) dh = 'Looking up the pool…';
      else dh = isOnline() ? 'Couldn’t load the pool right now — type the liquidity instead.' : 'Offline — type the pool liquidity to estimate price impact.';
      if (bad.poolLiq) dh = '<b>Pool liquidity needs a $ amount above 0 — your figure is ignored.</b> ' + dh;
      put('#cl-dex-hint', `${dh} The ${esc(numStr(dexFeePct()))}% swap fee is taken inside the swap price (you won't see it as a separate fee) — it's counted in the cost estimate.`, bad.poolLiq ? 'warn' : '');
    }
    if (o.m === 'perp') {
      const L = levOf(), maxL = isNum(S().risk.maxLeverage) ? S().risk.maxLeverage : 5;
      const fix = (bad.lev ? `Leverage must be 1–200× — using ${esc(numStr(L))}×. ` : '') + (bad.mmr ? `Maintenance margin must be 0–50% — using ${esc(numStr(mmrOf() * 100))}%. ` : '');
      put('#cl-lev-hint', (fix ? `<b>${fix}</b>` : '') + (L > maxL ? `<b>${esc(numStr(L))}× is above your ${esc(numStr(maxL))}× limit.</b> ` : '') +
        'Leverage changes the margin you post and how close liquidation sits — not your $ risk. Maintenance margin is about 0.4–0.5% for BTC/ETH and higher for small coins; check your exchange.', fix || L > maxL ? 'warn' : '');
    }
    for (const [id, err] of [['cl-balance', o.errs.balance], ['cl-entry', o.errs.entry], ['cl-stop', o.errs.stop], ['cl-target', o.errs.target], ['cl-risk', o.errs.risk],
      ['cl-feein', bad.feeIn], ['cl-feeout', bad.feeOut], ['cl-lev', bad.lev], ['cl-mmr', bad.mmr], ['cl-pool', bad.poolLiq]]) {
      const inp = $('#' + id, r);
      if (!inp) continue;
      inp.classList.toggle('invalid', !!err);
      inp.setAttribute('aria-invalid', err ? 'true' : 'false');
    }
    // outputs
    $('#cl-tiles', r).innerHTML = tilesHtml(o);
    const sum = summaryHtml(o);
    $('#cl-summary', r).innerHTML = sum;
    announce(sum);
    $('#cl-checks', r).innerHTML = checksHtml(o);
    $('#cl-open', r).disabled = !isNum(o.qty);
    drawChip();
  }

  function openInJournal() {
    const o = compute();
    if (!isNum(o.qty)) return;
    const pre = {
      coin: norm(st.coin) || undefined, side: o.side, entry: o.entry, stop: o.stop,
      target: o.errs.target || !isNum(o.target) ? undefined : o.target,
      amount: Number(o.qty.toPrecision(8)), market: o.m, venue: o.venue, leverage: o.m === 'perp' ? o.L : 1,
    };
    // Entry-field aliases too, so the form fills whether it reads {entry, stop, target} or the Entry names
    pre.entryPrice = pre.entry; pre.stopPrice = pre.stop; pre.targetPrice = pre.target;
    if (o.m === 'perp') { pre.marginMode = o.mode; pre.mmr = o.mmr; }
    if (o.m !== 'dex') { pre.orderTypeEntry = legOf(st.legIn); pre.orderTypeExit = legOf(st.legOut); }
    for (const k of Object.keys(pre)) if (pre[k] === undefined) delete pre[k];
    if (typeof TradeForm !== 'undefined' && TradeForm.open) TradeForm.open(null, pre);
    else toast('The trade form isn’t available right now', 'warn');
  }

  function render(el) {
    if (!ui || !ui.root.isConnected || !el.contains(ui.root)) build(el);
    else {
      // the page is built once; only the coin suggestions follow new trades / mode switches
      const coins = coinList(), key = coins.join(',');
      const dl = $('#cl-coins', ui.root);
      if (dl && key !== ui.coinsKey) { ui.coinsKey = key; dl.innerHTML = coinOpts(coins); }
    }
    sync(); update(); drawChip();
    const s = norm(st.coin);
    if (s && SYM_RE.test(s) && hasMarket()) {
      // re-renders (resize, commit) must not redo a settled lookup — only a new coin or a stale quote
      const q = Market.cached(s), settled = look && look.sym === s && !look.busy;
      if (!settled || (q && q.stale)) lookup();
      if (mkt() === 'dex' && Market.isPulse(s)) {
        const old = !dexLiq || dexLiq.sym !== s || Date.now() - dexLiq.at > 5 * 60000;
        const recent = dexLook && dexLook.sym === s && (dexLook.busy || Date.now() - dexLook.at < 60000);
        if (old && !recent) fetchDex();
      }
    }
  }

  // Calc.prefill({coin, side, entry, stop, target, riskPct, market, venue, leverage, balance}) → fills the inputs and opens the page
  function prefill(p) {
    p = p && typeof p === 'object' ? p : {};
    const pick = (...ks) => { for (const k of ks) if (p[k] !== undefined) return { v: p[k] }; return null; };
    // A prefill is a new plan: trade fields it doesn't supply are cleared, so an old target
    // or coin can't clash with the new entry. Balance, risk %, market and fees are kept.
    if (pick('coin', 'entry', 'entryPrice', 'stop', 'stopPrice')) { st.coin = ''; st.entry = ''; st.stop = ''; st.target = ''; }
    if (p.coin != null) st.coin = String(p.coin).toUpperCase().trim().slice(0, 15);
    if (p.side === 'long' || p.side === 'short') st.side = p.side;
    for (const [k, srcs] of [['entry', ['entry', 'entryPrice']], ['stop', ['stop', 'stopPrice']], ['target', ['target', 'targetPrice']], ['risk', ['riskPct', 'risk']], ['balance', ['balance']], ['lev', ['leverage']]]) {
      const hit = pick(...srcs);
      if (hit) st[k] = isNum(hit.v) ? numStr(hit.v) : typeof hit.v === 'string' ? hit.v.slice(0, 40) : '';
    }
    if (MKTS.includes(p.market) && p.market !== mkt()) setMarket(p.market);
    if (typeof p.venue === 'string' && VENUES.includes(p.venue) && p.venue !== ven()) { st.venue = p.venue; st.feeIn = ''; st.feeOut = ''; }
    if (p.marginMode === 'isolated' || p.marginMode === 'cross') st.marginMode = p.marginMode;
    // render() runs the lookup; only force a search for a coin the caller actually supplied
    // (a stale force flag would let a half-typed symbol trigger a search later)
    look = null; dexLook = null; forceLook = !!st.coin;
    persist();
    if (typeof Router !== 'undefined') Router.go('calc');
  }

  if (typeof Pages !== 'undefined') Pages.register('calc', { title: 'Position Size', sub: () => 'Risk a fixed % — let the math size the trade.', render, onLeave() { persist(); } });
  if (typeof Bus !== 'undefined') {
    // new quotes only touch the price chip — no page re-render
    Bus.on('prices', () => { if (ui && ui.root.isConnected && typeof Router !== 'undefined' && Router.active === 'calc') drawChip(); });
    Bus.on('settings', () => { if (ui && ui.root.isConnected && typeof Router !== 'undefined' && Router.active === 'calc') { sync(); update(); } });
  }

  return { prefill, show: () => { if (typeof Router !== 'undefined') Router.go('calc'); } };
})();
