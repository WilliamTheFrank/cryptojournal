/* ═══════════════════════════════════════════════════════════
   CryptoJournal — calculation engine
   Pure functions replicating the trading-journal spreadsheet:
   per-row metrics, trade grouping (scale in/out), running
   balance, streaks, overall / monthly / breakdown statistics.

   Entry model:
   { id, type: 'trade'|'scale'|'deposit'|'withdrawal'|'adjustment',
     entryAt, exitAt, coin, strategyId, side: 'long'|'short',
     entryPrice, amount, stopPrice, targetPrice, exitPrice,
     fees, funding, gas, discipline (1-5|null), notes, shotBefore, shotAfter,
     parentId (scale rows), flowAmount, flowNote,
     v2 journal fields (ignored here, used by metrics/UI): market, venue, leverage,
     marginMode, liqPrice, tags[], mistakes[], emoPre[], emoPreInt, confidence,
     emoPost[], checklist{items[]}, rulesMetPct, grade, thesis, invalidation,
     review{}, highDuring, lowDuring, plannedEntry, stopFinal, violations[], shots[],
     orderTypeEntry/Exit ('maker'|'taker'), txHash, importBatchId, extId, needsReview,
     deletedAt (soft delete — excluded from every computation) }
   ═══════════════════════════════════════════════════════════ */

const Engine = (() => {
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const MS_DAY = 86400000;
  // 'YYYY-MM-DD' → LOCAL midnight (Date.parse treats a bare date as UTC, every other timestamp here is local)
  const localDay = (d) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T00:00' : d);

  function sortEntries(entries) {
    return [...entries].sort((a, b) => {
      const ta = Date.parse(a.entryAt || 0) || 0;
      const tb = Date.parse(b.entryAt || 0) || 0;
      if (ta !== tb) return ta - tb;
      return (a.seq || 0) - (b.seq || 0);
    });
  }

  // Per-row metrics + running balance (mirrors Trades cols J-T, S chain)
  function enrichRows(entries, startingBalance) {
    let balance = startingBalance;
    const rows = [];
    for (const e of entries) {
      const r = { ...e, prevBalance: balance };
      if (e.type === 'deposit') {
        const amt = num(e.flowAmount) || 0;
        balance += amt;
        r.balance = balance;
      } else if (e.type === 'withdrawal') {
        const amt = num(e.flowAmount) || 0;
        balance -= amt;
        r.balance = balance;
      } else if (e.type === 'adjustment') {
        // Manual balance correction: apply the signed delta. P/L-neutral —
        // excluded from trade stats and from deposit/withdrawal totals.
        const delta = num(e.flowAmount) || 0;
        balance += delta;
        r.balance = balance;
        r.adjustDelta = delta;
      } else {
        const entry = num(e.entryPrice), amount = num(e.amount);
        const stop = num(e.stopPrice), target = num(e.targetPrice);
        const exit = num(e.exitPrice);
        const dir = e.side === 'short' ? -1 : 1;
        r.stopSize = (entry != null && stop != null) ? Math.abs(entry - stop) : null;
        r.targetSize = (entry != null && target != null) ? Math.abs(target - entry) : null;
        r.plannedR = (r.stopSize && r.targetSize != null) ? r.targetSize / r.stopSize : null;
        r.closed = exit != null;
        r.riskDollar = (amount != null && r.stopSize != null) ? amount * r.stopSize : null;
        r.riskPct = (r.riskDollar != null && r.prevBalance > 0) ? r.riskDollar / r.prevBalance : null;
        if (r.closed && entry != null && amount != null) {
          r.exitSize = Math.abs(entry - exit);
          r.grossPL = (exit - entry) * amount * dir;
          // Net of every cost: exchange fees, perp funding (signed: + paid, − received), DEX gas.
          r.costs = (num(e.fees) || 0) + (num(e.funding) || 0) + (num(e.gas) || 0);
          r.netPL = r.grossPL - r.costs;
          // Sheet-parity price R (gross) kept as actualR; netR is what analytics use.
          r.actualR = r.stopSize ? (r.grossPL >= 0 ? 1 : -1) * (r.exitSize / r.stopSize) : null;
          r.netR = r.riskDollar ? r.netPL / r.riskDollar : null;
          r.accountChangePct = r.prevBalance > 0 ? r.netPL / r.prevBalance : null;
          r.grossWin = r.grossPL > 0; r.grossLoss = r.grossPL < 0; r.grossBE = r.grossPL === 0;
          r.netWin = r.netPL > 0; r.netLoss = r.netPL < 0; r.netBE = r.netPL === 0;
          const t0 = Date.parse(e.entryAt), t1 = Date.parse(e.exitAt || e.entryAt);
          r.durationMs = (isFinite(t0) && isFinite(t1)) ? Math.max(0, t1 - t0) : null;
          // Asymmetric risk/reward convention (Trades DC/DD):
          // risk% = realized loss% if trade lost, else planned risk%
          // reward% = realized gain% if trade won, else planned reward%
          const grossPLPct = r.prevBalance > 0 ? r.grossPL / r.prevBalance : null;
          const plannedRiskPct = r.riskPct;
          const plannedRewardPct = (amount != null && r.targetSize != null && r.prevBalance > 0)
            ? amount * r.targetSize / r.prevBalance : null;
          r.riskPctUsed = r.grossPL < 0 ? (grossPLPct != null ? -grossPLPct : null) : plannedRiskPct;
          r.rewardPctUsed = r.grossPL > 0 ? grossPLPct : plannedRewardPct;
          balance += r.netPL;
        } else {
          r.netPL = null; // pending — balance unchanged
        }
        r.balance = balance;
      }
      rows.push(r);
    }
    return rows;
  }

  // Group scale rows with their parent trade (explicit parentId, more
  // robust than the sheet's row-contiguity rule)
  function buildGroups(rows, beBandR) {
    beBandR = num(beBandR) || 0;
    const groups = new Map();
    for (const r of rows) {
      if (r.type === 'trade') {
        groups.set(r.id, { trade: r, portions: [r] });
      }
    }
    for (const r of rows) {
      if (r.type === 'scale') {
        const g = groups.get(r.parentId);
        if (g) g.portions.push(r);
        else groups.set(r.id, { trade: r, portions: [r], orphan: true });
      }
    }
    const out = [];
    for (const g of groups.values()) {
      const ps = g.portions;
      g.closed = ps.every(p => p.closed);
      g.anyClosed = ps.some(p => p.closed);
      g.coin = g.trade.coin; g.strategyId = g.trade.strategyId; g.side = g.trade.side;
      g.fees = ps.reduce((s, p) => s + (num(p.fees) || 0), 0);
      // Total $ at risk across the trade's portions (null if any portion lacks a stop)
      g.risk = ps.every(p => num(p.riskDollar) && p.riskDollar > 0) ? ps.reduce((s, p) => s + p.riskDollar, 0) : null;
      g.plannedR = g.trade.plannedR != null ? g.trade.plannedR : null;
      if (g.closed) {
        g.netPL = ps.reduce((s, p) => s + p.netPL, 0);
        g.grossPL = ps.reduce((s, p) => s + (p.grossPL || 0), 0);
        const rs = ps.map(p => p.actualR).filter(v => v != null);
        g.sumR = rs.length ? rs.reduce((s, v) => s + v, 0) : null;
        g.avgR = rs.length ? g.sumR / ps.length : null;
        const prs = ps.map(p => p.plannedR).filter(v => v != null);
        g.avgPlannedR = prs.length ? prs.reduce((s, v) => s + v, 0) / prs.length : null;
        const ds = ps.map(p => num(p.discipline)).filter(v => v != null);
        g.avgDiscipline = ds.length ? ds.reduce((s, v) => s + v, 0) / ds.length : null;
        const exits = ps.map(p => Date.parse(p.exitAt)).filter(isFinite);
        const entry0 = Date.parse(g.trade.entryAt);
        g.exitMs = exits.length ? Math.max(...exits) : null;
        g.durationMs = (isFinite(entry0) && g.exitMs != null) ? Math.max(0, g.exitMs - entry0) : null;
        // Trade R (net of all costs) = net P/L ÷ total initial $ risk (Van Tharp / TradesViz definition)
        g.R = g.risk ? g.netPL / g.risk : null;
        // Win/loss on NET P/L; optional scratch band (|R| < beBandR counts as breakeven)
        const scratch = beBandR > 0 && g.R != null && Math.abs(g.R) < beBandR;
        g.win = !scratch && g.netPL > 0; g.loss = !scratch && g.netPL < 0; g.be = !g.win && !g.loss;
        g.costs = ps.reduce((s, p) => s + (p.costs || 0), 0);
        // % change of account for the whole trade vs balance before parent row
        g.changePct = g.trade.prevBalance > 0 ? g.netPL / g.trade.prevBalance : null;
        const rp = ps.map(p => p.riskPctUsed).filter(v => v != null);
        g.riskPctUsed = rp.length ? rp.reduce((s, v) => s + v, 0) / rp.length : null;
        const wp = ps.map(p => p.rewardPctUsed).filter(v => v != null);
        g.rewardPctUsed = wp.length ? wp.reduce((s, v) => s + v, 0) / wp.length : null;
      } else {
        g.netPL = null;
      }
      out.push(g);
    }
    out.sort((a, b) => (Date.parse(a.trade.entryAt) || 0) - (Date.parse(b.trade.entryAt) || 0));
    return out;
  }

  // Longest win/loss streaks over closed groups in chronological order
  function streaks(closedGroups) {
    let win = 0, loss = 0, maxWin = 0, maxLoss = 0;
    let curWin = 0, curLoss = 0;
    for (const g of closedGroups) {
      if (g.win) { win += 1; loss = 0; }
      else if (g.loss) { loss += 1; win = 0; }
      else { win = 0; loss = 0; } // breakeven resets both (sheet resets on non-winner)
      maxWin = Math.max(maxWin, win);
      maxLoss = Math.max(maxLoss, loss);
    }
    curWin = win; curLoss = loss;
    return { maxWin, maxLoss, curWin, curLoss };
  }

  function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }

  function statsFor(groups, tradeRows) {
    const closed = groups.filter(g => g.closed);
    const wins = closed.filter(g => g.win), losses = closed.filter(g => g.loss), bes = closed.filter(g => g.be);
    const st = streaks(closed);
    // Total P/L sums every CLOSED portion row (sheet H33 = SUM of col Q), so a
    // scale-out counts the moment it closes even if the parent is still open.
    // This keeps Net P/L consistent with the running balance, which enrichRows
    // already advances per closed portion.
    const closedRows = tradeRows.filter(r => r.closed && r.netPL != null);
    const totalPL = closedRows.reduce((s, r) => s + r.netPL, 0);
    // Expectancy uses fully-closed trades only (numerator and denominator agree);
    // realised scale-outs of still-open trades are reported separately.
    const closedPL = closed.reduce((s, g) => s + g.netPL, 0);
    const holdAll = closed.map(g => g.durationMs).filter(v => v != null);
    return {
      total: closed.length,
      wins: wins.length, losses: losses.length, breakevens: bes.length,
      winRate: closed.length ? wins.length / closed.length : null,
      avgWin: wins.length ? mean(wins.map(g => g.netPL)) : null,
      avgLoss: losses.length ? mean(losses.map(g => g.netPL)) : null,
      largestWin: wins.length ? Math.max(...wins.map(g => g.netPL)) : null,
      largestLoss: losses.length ? Math.min(...losses.map(g => g.netPL)) : null,
      maxWinStreak: st.maxWin, maxLossStreak: st.maxLoss,
      curWinStreak: st.curWin, curLossStreak: st.curLoss,
      totalFees: tradeRows.reduce((s, r) => s + (num(r.fees) || 0), 0),
      totalPL: closedRows.length ? totalPL : null,
      closedPL: closed.length ? closedPL : null,
      realizedOpen: totalPL - closedPL,
      expectancy: closed.length ? closedPL / closed.length : null,
      expectancyR: mean(closed.map(g => g.R).filter(v => v != null)),
      // Sheet H40/H41: SUM(risk%/reward% over closed rows) / count of ALL
      // trade+scale rows (open rows contribute 0 to the numerator).
      avgRiskPct: closedRows.length ? tradeRows.reduce((s, r) => s + (r.riskPctUsed || 0), 0) / tradeRows.length : null,
      avgRewardPct: closedRows.length ? tradeRows.reduce((s, r) => s + (r.rewardPctUsed || 0), 0) / tradeRows.length : null,
      avgPlannedR: mean(closed.map(g => g.avgPlannedR).filter(v => v != null)),
      // Achieved R is NET (same definition as Metrics); the sheet's gross price-R kept as avgGrossR
      avgActualR: mean(closed.map(g => g.R).filter(v => v != null)),
      avgGrossR: mean(closed.map(g => g.avgR).filter(v => v != null)),
      avgHoldMs: mean(holdAll),
      avgHoldWinMs: mean(wins.map(g => g.durationMs).filter(v => v != null)),
      avgHoldLossMs: mean(losses.map(g => g.durationMs).filter(v => v != null)),
      avgDiscipline: mean(closed.map(g => g.avgDiscipline).filter(v => v != null)),
      profitFactor: (() => {
        const gp = wins.reduce((s, g) => s + g.netPL, 0);
        const gl = Math.abs(losses.reduce((s, g) => s + g.netPL, 0));
        return gl > 0 ? gp / gl : (gp > 0 ? Infinity : null);
      })(),
    };
  }

  // Monthly timeline (Results rows 78-96): SOM/EOM recurrence,
  // month P/L keyed by trade EXIT month, deposit-adjusted % change
  function monthlyTimeline(groups, rows, startingBalance, startDate) {
    const closed = groups.filter(g => g.closed && g.exitMs != null);
    const flows = rows.filter(r => r.type === 'deposit' || r.type === 'withdrawal' || r.type === 'adjustment');
    const dates = [
      ...closed.map(g => g.exitMs),
      ...flows.map(f => Date.parse(f.entryAt)).filter(isFinite),
    ];
    if (startDate) { const t = localDay(startDate); if (isFinite(t)) dates.push(t); }
    dates.push(Date.now());
    if (!dates.length) return [];
    const lo = new Date(Math.min(...dates)), hi = new Date(Math.max(...dates));
    const months = [];
    let y = lo.getFullYear(), m = lo.getMonth();
    let som = startingBalance;
    while (y < hi.getFullYear() || (y === hi.getFullYear() && m <= hi.getMonth())) {
      const inMonth = (ms) => { const d = new Date(ms); return d.getFullYear() === y && d.getMonth() === m; };
      const monthGroups = closed.filter(g => inMonth(g.exitMs));
      const pnl = monthGroups.reduce((s, g) => s + g.netPL, 0);
      const dep = flows.filter(f => f.type === 'deposit' && inMonth(Date.parse(f.entryAt)))
        .reduce((s, f) => s + (num(f.flowAmount) || 0), 0);
      const wd = flows.filter(f => f.type === 'withdrawal' && inMonth(Date.parse(f.entryAt)))
        .reduce((s, f) => s + (num(f.flowAmount) || 0), 0);
      // 'Set balance' corrections move the balance like a flow but are not P/L (kept out of pctExcl)
      const adj = flows.filter(f => f.type === 'adjustment' && inMonth(Date.parse(f.entryAt)))
        .reduce((s, f) => s + (num(f.flowAmount) || 0), 0);
      const somAdj = som + dep - wd + adj;
      const eom = somAdj + pnl;
      months.push({ y, m, date: new Date(y, m, 1), pnl, nTrades: monthGroups.length, dep, wd, adj, som, eom, groups: monthGroups });
      som = eom;
      m += 1; if (m > 11) { m = 0; y += 1; }
    }
    // % change series (Results rows 95/96). The sheet's baseline is row 94 =
    // IF(nTrades>0, EOM, SOM): a no-trade month carries its start-of-month
    // balance forward, so that month's deposits stay out of the next traded
    // month's baseline (som[m] === eom[m-1]).
    for (let i = 0; i < months.length; i++) {
      const prev = i === 0 ? startingBalance
        : (months[i - 1].nTrades > 0 ? months[i - 1].eom : months[i - 1].som);
      const mm = months[i];
      mm.pctExcl = (mm.nTrades > 0 && prev > 0) ? (mm.eom - prev - mm.dep + mm.wd - mm.adj) / prev : null;
      mm.pctIncl = (mm.nTrades > 0 && prev > 0) ? (mm.eom - prev) / prev : null;
    }
    return months;
  }

  function breakdown(groups, keyFn) {
    const closed = groups.filter(g => g.closed);
    const buckets = new Map();
    for (const g of closed) {
      const k = keyFn(g) || '—';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(g);
    }
    return [...buckets.entries()].map(([key, gs]) => {
      const wins = gs.filter(g => g.win).length;
      const pl = gs.reduce((s, g) => s + g.netPL, 0);
      return {
        key, count: gs.length, wins,
        winRate: wins / gs.length,
        totalPL: pl,
        expectancy: pl / gs.length,
        avgR: mean(gs.map(g => g.R).filter(v => v != null)),
        avgHoldMs: mean(gs.map(g => g.durationMs).filter(v => v != null)),
      };
    }).sort((a, b) => b.totalPL - a.totalPL);
  }

  // Full account computation
  // opts: { beBandR } — scratch band for win/loss classification (0 = spreadsheet behaviour)
  function compute(account, opts) {
    opts = opts || {};
    const startingBalance = num(account.startingBalance) || 0;
    const entries = sortEntries((account.entries || []).filter(e => !e.deletedAt));
    const rows = enrichRows(entries, startingBalance);
    const tradeRows = rows.filter(r => r.type === 'trade' || r.type === 'scale');
    const groups = buildGroups(rows, opts.beBandR);
    const closedGroups = groups.filter(g => g.closed);
    const openRows = tradeRows.filter(r => !r.closed);
    const stats = statsFor(groups, tradeRows);

    const deposits = rows.filter(r => r.type === 'deposit').reduce((s, r) => s + (num(r.flowAmount) || 0), 0);
    const withdrawals = rows.filter(r => r.type === 'withdrawal').reduce((s, r) => s + (num(r.flowAmount) || 0), 0);
    const capitalIn = startingBalance + deposits; // sheet's "Total Deposits" includes starting balance
    const balance = rows.length ? rows[rows.length - 1].balance : startingBalance;

    // Equity curve: balance after every balance-affecting row
    const equity = [];
    const t0 = account.startDate ? localDay(account.startDate) : null;
    equity.push({ t: isFinite(t0) && t0 ? t0 : (rows.length ? Date.parse(rows[0].entryAt) : Date.now()), bal: startingBalance, label: 'Start' });
    for (const r of rows) {
      if (r.type === 'deposit' || r.type === 'withdrawal' || r.type === 'adjustment' || (r.closed && r.netPL != null)) {
        const t = Date.parse(r.type === 'trade' || r.type === 'scale' ? (r.exitAt || r.entryAt) : r.entryAt);
        equity.push({ t: isFinite(t) ? t : equity[equity.length - 1].t, bal: r.balance, row: r });
      }
    }
    equity.sort((a, b) => a.t - b.t);
    // re-run balances in exit order for a monotone-time curve? Sheet uses row order;
    // we keep row-order balances but sort x by time for display.

    return {
      startingBalance, rows, tradeRows, groups, closedGroups, openRows, stats,
      deposits, withdrawals, capitalIn, balance,
      totalPL: stats.totalPL,
      accountGrowth: (stats.totalPL != null && capitalIn > 0) ? stats.totalPL / capitalIn : null,
      months: monthlyTimeline(groups, rows, startingBalance, account.startDate),
      byCoin: breakdown(groups, g => g.coin),
      byStrategy: breakdown(groups, g => g.strategyId),
      bySide: breakdown(groups, g => g.side === 'short' ? 'Short' : 'Long'),
      equity,
    };
  }

  // Position size calculator (Position Size sheet)
  function positionSize({ balance, entry, stop, target, riskPct }) {
    const out = {};
    const b = num(balance), e = num(entry), s = num(stop), t = num(target), r = num(riskPct);
    out.stopSize = (e != null && s != null) ? Math.abs(e - s) : null;
    out.targetSize = (e != null && t != null) ? Math.abs(e - t) : null;
    out.amountRisked = (b != null && r != null) ? b * (r / 100) : null;
    out.cryptoAmount = (out.amountRisked != null && out.stopSize) ? out.amountRisked / out.stopSize : null;
    out.capitalNeeded = (out.cryptoAmount != null && e != null) ? out.cryptoAmount * e : null;
    out.rr = (out.stopSize && out.targetSize != null) ? out.targetSize / out.stopSize : null;
    out.stopPct = (out.stopSize != null && e) ? out.stopSize / e : null;
    out.targetPct = (out.targetSize != null && e) ? out.targetSize / e : null;
    return out;
  }

  // Isolated-margin liquidation estimate for a USDT-margined linear perp (Binance/Bybit tier-1 formula).
  // { side, entry, qty, leverage, mmr=0.005, maintAmt=0, extraMargin=0, mode:'isolated'|'cross', balance }
  // Cross margin uses the whole wallet as margin → only an approximation (flag `approx`).
  function liqPrice(o) {
    const e = num(o.entry), q = num(o.qty), L = num(o.leverage);
    if (e == null || !q || !L || L <= 1) return null;
    const mmr = num(o.mmr) != null ? o.mmr : 0.005, cum = num(o.maintAmt) || 0;
    const cross = o.mode === 'cross';
    const wb = cross && num(o.balance) ? o.balance : q * e / L + (num(o.extraMargin) || 0);
    const lp = o.side === 'short' ? (q * e + wb + cum) / (q * (1 + mmr)) : (q * e - wb - cum) / (q * (1 - mmr));
    const price = Math.max(0, lp);
    return { price, distPct: Math.abs(e - price) / e, approx: cross, margin: q * e / L };
  }
  // Stop vs liquidation check: 'beyond' = stop never triggers before liquidation; 'tight' = stop uses > 50% of the liq distance
  function liqCheck(side, entry, stop, liq) {
    if (liq == null || num(stop) == null || num(entry) == null) return null;
    const lp = liq.price != null ? liq.price : liq;
    const beyond = side === 'short' ? stop >= lp : stop <= lp;
    const tight = !beyond && Math.abs(entry - stop) > 0.5 * Math.abs(entry - lp);
    return beyond ? 'beyond' : tight ? 'tight' : 'ok';
  }
  // Round-trip fee estimate. rates are fractions (0.001 = 0.1%). Returns $ and R (when a stop is known).
  function feeEstimate({ qty, entry, exit, stop, rateEntry, rateExit }) {
    const q = num(qty), e = num(entry); if (!q || e == null) return null;
    const x = num(exit) != null ? exit : e;
    const usd = q * e * (num(rateEntry) || 0) + q * x * (num(rateExit) || 0);
    const risk = num(stop) != null ? q * Math.abs(e - stop) : null;
    return { usd, R: risk ? usd / risk : null, pctOfNotional: ((num(rateEntry) || 0) + (num(rateExit) || 0)) };
  }

  // Backtesting sheet: points → % (pts/1000), fixed-risk info column, compounding
  function backtest({ start, riskPct, points }) {
    let account = num(start) || 0;
    const rows = [];
    (points || []).forEach((pts, i) => {
      const pct = pts / 1000; // sheet: (points/10)/100
      const risk = account * ((num(riskPct) || 0) / 100);
      const pl = pct * account;
      const before = account;
      account = before + pl;
      rows.push({ n: i + 1, pts, pct, risk, before, pl, after: account });
    });
    const wins = rows.filter(r => r.pl > 0).length;
    return {
      rows, final: account,
      totalPL: account - (num(start) || 0),
      growth: num(start) ? (account - start) / start : null,
      winRate: rows.length ? wins / rows.length : null,
      best: rows.length ? Math.max(...rows.map(r => r.pl)) : null,
      worst: rows.length ? Math.min(...rows.map(r => r.pl)) : null,
    };
  }

  function fmtDuration(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    const d = Math.floor(ms / MS_DAY);
    const h = Math.floor((ms % MS_DAY) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // Methodology tooltips (from the workbook's cell comments)
  const TIPS = {
    totalTrades: 'Counts every closed trade taken (scale in/outs group into their parent trade).',
    winRate: 'Winning trades divided by total closed trades.',
    avgWin: 'Total P/L of all winning trades divided by the number of winners.',
    avgLoss: 'Total P/L of all losing trades divided by the number of losers.',
    largestWin: 'The trade that won the largest sum of money (not necessarily the largest price move).',
    largestLoss: 'The trade that lost the largest sum of money (not necessarily the largest price move).',
    winStreak: 'Longest run of winning trades without a losing trade.',
    lossStreak: 'Longest run of losing trades without a winning trade.',
    totalFees: 'Total of trade costs on all trades taken.',
    totalPL: 'Total net P/L on all closed trades.',
    avgPL: 'Total P/L divided by the total number of trades taken.',
    growth: 'Total P/L divided by total capital in (starting balance + deposits).',
    avgRisk: 'Uses the actual result if the trade lost, or the planned risk if the trade won.',
    avgReward: 'Uses the actual result if the trade won, or the planned reward if the trade lost.',
    expectancy: 'Net P/L of closed trades divided by the number of closed trades — the $ you can expect per trade.',
    plannedRRR: 'Total planned risk:reward on all trades divided by the number of trades.',
    achievedRRR: 'Average net R per closed trade: net P/L (after fees, funding and gas) divided by the $ you risked at entry.',
    holdTime: 'Total time in all trades divided by the number of trades taken.',
    holdWin: 'Total time in winning trades divided by the number of winners.',
    holdLoss: 'Total time in losing trades divided by the number of losers.',
    deposits: 'All deposits recorded in the journal including the starting balance.',
    withdrawals: 'All withdrawals recorded in the journal.',
    discipline: 'Average of all trade discipline scores (did you follow your plan?).',
    profitFactor: 'Gross profit divided by gross loss. Above 1.0 means the system makes money.',
  };

  return { compute, positionSize, liqPrice, liqCheck, feeEstimate, backtest, fmtDuration, sortEntries, TIPS };
})();
