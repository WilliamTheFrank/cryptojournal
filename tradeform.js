/* ═══════════════════════════════════════════════════════════
   CryptoJournal — trade entry (tradeform.js)
   The most-used UI in the app: full trade form, quick log,
   duplicate-last, scale legs, close / partial close + post-trade
   review, review-later, trade detail drawer, cash flows and the
   "set balance" adjustment. Owns the per-trade guardrails
   (guardCheck) and the override interrupt that logs violations.
   Public: TradeForm.open(entry|null, prefill?) · quick() ·
           duplicateLast() · scale(parentId) · close(rowId) ·
           review(tradeId) · view(tradeId) · flow(kind?, entry?) ·
           adjust() · guardCheck(draft) → {state, items}
   Research: psychology (checklist, A/B/C grade, mistakes incl.
   "Clean", emotion + intensity, suggested-not-automatic flags),
   crypto (fees in R, liquidation estimate, funding, gas, tx),
   critic (quick log, duplicate, review-later, "as of" prices,
   perp fields under Advanced, liquidation labelled estimate).
   ═══════════════════════════════════════════════════════════ */
const TradeForm = (() => {
  'use strict';

  /* ── Small helpers ─────────────────────────────────────── */
  const isN = (v) => typeof v === 'number' && isFinite(v);
  const numIn = (s) => { if (s == null) return null; const t = String(s).trim(); if (t === '') return null; const n = Number(t); return isFinite(n) ? n : null; };
  // Numbers going INTO inputs: plain decimals — never subscript, compact or exponent notation
  const plain = (v) => (isN(v) ? v.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }) : '');
  const sig = (v, n) => (isN(v) ? Number(v.toPrecision(n || 8)) : null);
  const cents = (v) => (!isN(v) ? null : Math.abs(v) >= 1 ? Math.round(v * 100) / 100 : sig(v, 4));
  const ic = (id, sz) => `<svg width="${sz || 16}" height="${sz || 16}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const call = (fn, d) => { try { return fn(); } catch (e) { console.error('[tradeform]', e); return d; } };
  const ensureC = () => C || (typeof recompute === 'function' ? recompute() : null);
  const hasMetrics = () => typeof Metrics !== 'undefined' && !!Metrics;
  const hasMarket = () => typeof Market !== 'undefined' && !!Market;
  const hasStore = () => typeof Store !== 'undefined' && !!Store && typeof Store.putMedia === 'function';
  const safeUrl = (u) => { const s = typeof u === 'string' ? u.trim() : ''; return /^(https?:|blob:|data:image\/)/i.test(s) ? s : null; };
  const isWeb = (u) => /^https?:/i.test(u || '');
  const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
  const COIN_RE = /^[A-Z0-9][A-Z0-9.\-_]{0,19}$/;
  const MIN_MS = 60000, H_MS = 3600000;
  const FLOW_TYPES = ['deposit', 'withdrawal', 'adjustment'];
  const SHOT_KINDS = [{ id: 'before', label: 'Before' }, { id: 'after', label: 'After' }, { id: 'other', label: 'Other' }];
  const GROUP_LABEL = { entry: 'Entry', risk: 'Risk', management: 'Trade management', exit: 'Exit', mindset: 'Mindset', execution: 'Execution' };
  const RULE_LABEL = { stop: 'No stop loss', risk: 'Risk per trade', strategy: 'No setup chosen', leverage: 'Leverage', cost: 'Costs', liq: 'Stop beyond liquidation', daily: 'Daily loss limit', weekly: 'Weekly loss limit', count: 'Max trades per day', streak: 'Losses in a row', cooldown: 'Cooldown after a loss', heat: 'Open risk (heat)', cluster: 'Correlated exposure', balance: 'Account balance' };
  const DAY_RULES = ['daily', 'weekly', 'count', 'streak', 'cooldown'];
  const HOT_EMOS = ['fomo', 'frustrated', 'winback', 'euphoric', 'anxious', 'fearful'];
  const RATE5 = (titles) => ['1', '2', '3', '4', '5'].map(id => ({ id, label: id, title: (titles || {})[id] }));
  const INT_TITLES = { 1: 'Barely noticeable', 3: 'Noticeable and distracting', 5: 'Controlling my decisions' };
  const CONF_TITLES = { 1: 'Low', 3: 'Medium', 5: 'Very high' };
  const OT = [{ id: 'maker', label: 'Maker (limit)' }, { id: 'taker', label: 'Taker (market)' }];
  const sideBadge = (side) => `<span class="badge ${side === 'short' ? 'short' : 'long'}">${side === 'short' ? '↘ SHORT' : '↗ LONG'}</span>`;
  const statusBadge = (g) => (!g || !g.closed ? '<span class="badge open">OPEN</span>' : g.win ? '<span class="badge win">✓ WIN</span>' : g.loss ? '<span class="badge loss">✕ LOSS</span>' : '<span class="badge be">– BE</span>');
  const gradeBadge = (gr) => (['A', 'B', 'C'].includes(gr) ? `<span class="badge grade-${gr}" title="Process grade (the decision, not the result)">Grade ${gr}</span>` : '');
  // P/L always carries sign + colour + glyph — colour is never the only cue
  const gl = (v) => (glyph(v) ? `<span aria-hidden="true">${glyph(v)}</span> ` : '');
  const plSpan = (v, inner) => `<span class="${plClass(v)}">${gl(v)}${inner}</span>`;
  const rTxt = (v) => (isN(v) ? Math.abs(v).toFixed(2) + 'R' : '—');   // unsigned R (R:R, MAE/MFE)
  // signed R without a '+' (costs, net R:R) — a rebate or a negative net R:R keeps its true minus sign
  const rNum = (v) => (isN(v) ? (v < 0 ? MINUS : '') + Math.abs(v).toFixed(2) + 'R' : '—');
  // lookups keyed by stored / imported strings must never hit Object.prototype ('constructor', '__proto__')
  const own = (o, k) => (k != null && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  const moneyTxt = (v, o) => (View.privacy ? '•••' : fmtMoney(v, o));
  const modeName = () => ({ paper: 'Paper', live: 'Live', demo: 'Demo' }[db.mode] || 'Paper');
  const modeBadge = () => `<span class="badge mode">${esc(modeName())} account</span>`;
  const marketLabel = (id) => ((typeof MARKETS !== 'undefined' && MARKETS.find(m => m.id === id)) || {}).label || id || '—';
  const stratLabel = (id) => (id ? stratName(id) : 'No setup');
  const emoLabel = (id, list) => ((list || []).find(x => x.id === id) || {}).label || String(id);
  const kindLabel = (k) => (SHOT_KINDS.find(x => x.id === k) || SHOT_KINDS[2]).label;
  const nowISO = () => new Date().toISOString();
  const fmtLev = (v) => (v >= 10 ? Math.floor(v) : Math.max(1, Math.floor(v * 10) / 10));
  const toLocalInput = (s) => { if (!s) return ''; if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s; const t = Date.parse(s); return isFinite(t) ? nowLocalInput(new Date(t)) : ''; };
  // keep the stored timestamp when the user didn't change it (imports may carry seconds)
  const keepTime = (orig, val) => (orig && toLocalInput(orig) === val ? orig : val);
  const autoFillOn = () => db.mode !== 'live' && !!(S().fees && S().fees.autoFillPaper);
  const delMedia = (id) => { if (id && typeof Store !== 'undefined' && Store && typeof Store.deleteMedia === 'function') Promise.resolve(Store.deleteMedia(id)).catch(() => {}); };
  // successful save() calls (Bus 'saved'): removed screenshots are deleted only once the entry that dropped them is stored
  let saveN = 0;
  const cssEsc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const mctx = () => (ensureC() ? metricsCtx() : null);
  const fees0 = () => S().fees || {};
  let seqN = 0;
  const newPrefix = () => 'tf' + (++seqN);
  // drop empty values from a NEW entry so localStorage stays lean (patches keep nulls to clear fields)
  function lean(o) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v == null || v === '' || (Array.isArray(v) && !v.length && k !== 'mistakes' && k !== 'tags')) delete o[k];
    }
    return o;
  }
  // A save is all-or-nothing: when commit() could not write to disk, undo() puts memory back the way
  // disk has it. touch(id) BEFORE changing an entry, add(id) after addEntry; overrides pushed since are dropped.
  function txn() {
    const before = [], added = [], ov0 = Array.isArray(db.overrides) ? db.overrides.length : 0;
    return {
      touch(id) { const e = entryById(id); if (e && !before.some(b => b[0] === e)) before.push([e, JSON.parse(JSON.stringify(e))]); },
      add(id) { added.push(id); },
      undo() {
        for (const [e, o] of before) { for (const k of Object.keys(e)) delete e[k]; Object.assign(e, o); }
        if (added.length) { const es = acct().entries; for (let i = es.length - 1; i >= 0; i--) if (added.includes(es[i].id)) es.splice(i, 1); }
        if (Array.isArray(db.overrides) && db.overrides.length > ov0) db.overrides.length = ov0;
        call(refresh);
      },
    };
  }
  // another window may have moved the entry to Trash while its form was open
  const TRASHED = 'This trade was moved to Trash in another window';
  // stored numbers compare equal when both are blank (lean() drops nulls from new entries)
  const sameN = (a, b) => (isN(a) ? a : null) === (isN(b) ? b : null);

  /* ── Strategies, coins, balances ───────────────────────── */
  const activeStrats = () => (Array.isArray(db.strategies) ? db.strategies.filter(s => s && !s.archived) : []);
  // select values are strings — map back to the stored id (hand-edited numeric ids still resolve)
  function sidFrom(val) { if (!val) return null; const s = (db.strategies || []).find(x => x && String(x.id) === String(val)); return s ? s.id : val; }
  function rulesFor(id) {
    if (!id) return [];
    if (typeof Discipline !== 'undefined' && Discipline && typeof Discipline.checklistFor === 'function') {
      const r = call(() => Discipline.checklistFor(id), null);
      if (Array.isArray(r)) return r.map(x => String(x == null ? '' : x).trim()).filter(Boolean);
    }
    const s = strategyById(id); if (!s) return [];
    const list = (Array.isArray(s.checklist) && s.checklist.length ? s.checklist : s.entry) || [];
    return list.map(x => String(x == null ? '' : x).trim()).filter(Boolean);
  }
  function stratOptions(cur) {
    const list = activeStrats().map(s => [String(s.id), s.name || 'Untitled']);
    if (cur != null && cur !== '' && !list.some(x => x[0] === String(cur))) list.push([String(cur), stratName(cur) + (strategyById(cur) ? ' (archived)' : ' (deleted)')]);
    return '<option value="">— no setup —</option>' + list.map(([v, t]) => `<option value="${esc(v)}"${cur != null && v === String(cur) ? ' selected' : ''}>${esc(t)}</option>`).join('');
  }
  function coinOptions() {
    const seen = new Set(), out = [];
    const es = liveEntries().filter(e => e.coin && (e.type === 'trade' || e.type === 'scale'));
    for (let i = es.length - 1; i >= 0 && out.length < 30; i--) { const c = String(es[i].coin).toUpperCase(); if (!seen.has(c)) { seen.add(c); out.push(c); } }
    const ids = typeof CG !== 'undefined' && CG && CG.IDS ? Object.keys(CG.IDS) : [];
    for (const c of ids) if (!seen.has(c)) { seen.add(c); out.push(c); }
    return out.map(c => `<option value="${esc(c)}"></option>`).join('');
  }
  function venueOptions(cur) {
    const vs = [...VENUES]; if (cur && !vs.includes(cur)) vs.unshift(cur);
    return '<option value="">—</option>' + vs.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  }
  // Balance a trade is sized against: the balance before its row (edits) or the current balance (new)
  function balanceFor(id) {
    const c = ensureC(); if (!c) return 0;
    if (id) { const r = c.rows.find(x => x.id === id); if (r && isN(r.prevBalance)) return r.prevBalance; }
    return c.balance;
  }
  // Balance just before a flow placed at time t (engine order: entry time, then seq), ignoring the row being edited
  function balanceAt(t, ex) {
    const c = ensureC(); if (!c) return 0;
    let bal = c.startingBalance;
    const exSeq = ex ? (ex.seq || 0) : Infinity;
    for (const r of c.rows) {
      if (ex && r.id === ex.id) continue;
      const rt = Date.parse(r.entryAt || 0) || 0;
      if (rt < t || (rt === t && (r.seq || 0) < exSeq)) bal += (isN(r.balance) ? r.balance : 0) - (isN(r.prevBalance) ? r.prevBalance : 0);
      else break;
    }
    return bal;
  }
  // Effective cap: rule (live ramp applied by core) and an optional tighter per-setup cap
  function riskCap(strategyId) {
    const cap = effectiveMaxRisk();
    const s = strategyId ? strategyById(strategyId) : null;
    const sc = s && isN(s.maxRiskPct) && s.maxRiskPct > 0 ? s.maxRiskPct : null;
    const rs = S().ramp || {};
    const ramp = db.mode === 'live' && !!rs.enabled && RAMP_STAGES[rs.stage] != null && RAMP_STAGES[rs.stage] < S().risk.maxRiskPct;
    return { cap, stratCap: sc, use: sc != null ? Math.min(cap, sc) : cap, ramp, stage: rs.stage };
  }

  /* ── Costs: venue fee presets (% per side) → $ and R ───── */
  // DEX swap fees (PulseX 0.29%) are already inside the executed price — never added on top.
  function feeRates(venue, market, otIn, otOut) {
    const m = market || 'spot';
    const presets = fees0().presets || {};
    const p = presets[`${venue}|${m}`];
    if (m === 'dex') return { inRate: 0, outRate: 0, dex: true, label: p && isN(p.swap) ? `The ${p.swap}% swap fee is already inside the executed price — only gas is added.` : 'DEX swap fees are inside the executed price — only gas is added.' };
    const lg = (t) => (t === 'maker' ? 'maker' : 'taker');
    if (p && isN(p.maker) && isN(p.taker)) {
      const a = otIn === 'maker' ? p.maker : p.taker, b = otOut === 'maker' ? p.maker : p.taker;
      return { inRate: a / 100, outRate: b / 100, label: `${venue} ${marketLabel(m).toLowerCase()} preset: ${lg(otIn)} ${a}% in · ${lg(otOut)} ${b}% out${fees0().checked ? ` (checked ${fees0().checked})` : ''} — edit presets in Settings → Costs.` };
    }
    const c = isN(S().costs && S().costs.cexFeePct) ? S().costs.cexFeePct : 0.1;
    return { inRate: c / 100, outRate: c / 100, label: `No fee preset for ${venue || 'this venue'} ${marketLabel(m).toLowerCase()} — using your default ${c}% per side.` };
  }
  // Every live number the form shows, from one draft. balance = what the trade is sized against.
  function derive(d, balance) {
    const o = { balance };
    const e = d.entryPrice, s = d.stopPrice, t = d.targetPrice, q = d.amount;
    o.stopSize = isN(e) && isN(s) ? Math.abs(e - s) : null;
    o.stopPct = o.stopSize != null && e ? o.stopSize / e : null;
    o.risk = isN(q) && q > 0 && o.stopSize ? q * o.stopSize : null;
    o.riskPct = o.risk != null && balance > 0 ? o.risk / balance : null;
    o.rr = o.stopSize && isN(t) ? Math.abs(t - e) / o.stopSize : null;
    o.notional = isN(q) && isN(e) ? q * e : null;
    o.effLev = o.notional != null && balance > 0 ? o.notional / balance : null;
    o.fr = feeRates(d.venue, d.market, d.orderTypeEntry, d.orderTypeExit);
    const est = isN(q) && q > 0 && isN(e) ? Engine.feeEstimate({ qty: q, entry: e, exit: isN(d.exitPrice) ? d.exitPrice : e, stop: s, rateEntry: o.fr.inRate, rateExit: o.fr.outRate }) : null;
    o.feeEst = est ? est.usd : null;
    o.feesEstimated = !isN(d.fees) && o.feeEst != null;
    o.feesUsed = isN(d.fees) ? d.fees : o.feeEst;
    o.cost = o.feesUsed != null || isN(d.funding) || isN(d.gas) ? (o.feesUsed || 0) + (d.funding || 0) + (d.gas || 0) : null;
    o.costR = o.cost != null && o.risk ? o.cost / o.risk : null;
    // net R:R and breakeven win rate after costs: losers lose 1R + c, winners make RRR − c
    o.netRR = o.rr != null && o.costR != null ? (o.rr - o.costR) / (1 + o.costR) : null;
    o.beWin = o.rr != null ? (1 + Math.max(0, o.costR || 0)) / (o.rr + 1) : null;
    const mmr = isN(d.mmr) ? d.mmr : 0.005;
    if (d.market === 'perp' && isN(d.leverage) && d.leverage > 1 && isN(q) && q > 0 && isN(e)) {
      o.liq = Engine.liqPrice({ side: d.side, entry: e, qty: q, leverage: d.leverage, mmr, mode: d.marginMode, balance });
      o.liqState = o.liq ? Engine.liqCheck(d.side, e, s, o.liq) : null;
    }
    o.maxSafeLev = o.stopPct ? 1 / (2 * o.stopPct + mmr) : null;   // liquidation ≥ 2× the stop distance away
    if (isN(d.exitPrice) && isN(e) && isN(q)) {
      const dir = d.side === 'short' ? -1 : 1;
      o.netUsesEst = !isN(d.fees) && autoFillOn() && d.autoFee !== false && o.feeEst != null;
      const fees = isN(d.fees) ? d.fees : (o.netUsesEst ? o.feeEst : 0);
      o.gross = (d.exitPrice - e) * q * dir;
      o.net = o.gross - (fees + (d.funding || 0) + (d.gas || 0));
      o.R = o.risk ? o.net / o.risk : null;
      o.pct = balance > 0 ? o.net / balance : null;
    }
    // slippage vs the intended price: positive = worse fill
    o.slip = isN(d.plannedEntry) && d.plannedEntry > 0 && isN(e) ? (e - d.plannedEntry) / d.plannedEntry * (d.side === 'short' ? -1 : 1) : null;
    return o;
  }

  /* ── Guardrails ────────────────────────────────────────── */
  // Day-level circuit breakers only make sense for a position opened right now (not a back-filled log)
  function openedNow(d) {
    if (d.id) return false;
    const t = Date.parse(d.entryAt || ''), now = Date.now();
    if (!isFinite(t)) return true;
    if (Math.abs(now - t) > 12 * H_MS) return false;
    if (!hasMetrics()) return true;
    const reset = S().risk.dayResetHour || 0;
    return Metrics.tradingDayKey(t, reset) === Metrics.tradingDayKey(now, reset);
  }
  // guardCheck(draft) → { state 'ok'|'warn'|'stop', items:[{rule,label,state,value,limit,hint}] }
  // draft: entry-like fields (+ optional id, isNew, balance; kind:'scale' + groupRisk for a scale leg,
  // so the risk cap applies to the whole trade, not just the added leg)
  function guardCheck(draft) {
    const d = draft || {}, items = [], rules = S().risk || {}, c = ensureC();
    const add = (rule, label, state, value, limit, hint) => items.push({ rule, label, state, value, limit, hint: hint || '' });
    const live = db.mode === 'live', isScale = d.kind === 'scale';
    const bal = isN(d.balance) ? d.balance : balanceFor(d.id);
    const x = derive(d, bal);
    const isNew = d.isNew != null ? !!d.isNew : !d.id;
    const isOpen = !isN(d.exitPrice);
    // a closed trade logged after the fact only gets the day checks if it started in the last 2 hours
    const t0 = Date.parse(d.entryAt || ''), recent = !isFinite(t0) || Date.now() - t0 <= 2 * H_MS;
    if (isNew && openedNow({ entryAt: d.entryAt }) && (isOpen || recent) && c && hasMetrics()) {
      const g = call(() => Metrics.riskGuard(c, rules, Date.now()), null);
      if (g) {
        // adding to a position is not a new trade, so the trades-per-day count doesn't apply to a scale leg
        for (const k of g.checks) if (k.key !== 'heat' && k.key !== 'cluster' && !(isScale && k.key === 'count')) add(k.key, k.label, k.state, k.value, k.limit, k.hint);
        // heat and correlated exposure recomputed WITH this position added
        if (rules.maxOpenRiskPct && isOpen) {
          const tot = (g.openRisk || 0) + (isN(x.risk) ? x.risk : 0), pct = c.balance > 0 ? tot / c.balance : 0, lim = rules.maxOpenRiskPct / 100;
          const noStop = g.noStop || 0;   // this trade's own missing stop is reported by the 'stop' rule below
          add('heat', 'Open risk incl. this trade', noStop || pct > lim ? 'stop' : pct > lim * 0.75 ? 'warn' : 'ok', pct, lim,
            noStop ? `${plural(noStop, 'open position')} without a stop — that risk is unlimited.` : pct > lim ? 'Too much on at once — close or tighten something first.' : 'What you would lose if every open stop were hit.');
        }
        if (rules.maxClusterRiskPct && isOpen && isN(x.risk) && d.coin) {
          const k = clusterOf(d.coin);
          if (k !== 'alts') {
            const tot = ((g.byCluster || {})[k] || 0) + x.risk, pct = c.balance > 0 ? tot / c.balance : 0, lim = rules.maxClusterRiskPct / 100;
            add('cluster', `Correlated risk · ${(CLUSTERS[k] || {}).label || k}`, pct > lim ? 'warn' : 'ok', pct, lim, pct > lim ? 'These coins move together — this is largely one bet.' : '');
          }
        }
      }
    }
    if (!(bal > 0)) add('balance', 'Account balance', 'warn', bal, null, 'Your balance is $0 — set a starting balance in Settings → Account (or record a deposit) so risk % can be checked.');
    // per-trade rules
    if (!isN(d.stopPrice)) add('stop', 'Stop loss', rules.requireStop ? 'stop' : 'warn', null, null, 'No stop — the risk is unlimited and R can’t be measured.');
    else add('stop', 'Stop loss', 'ok', d.stopPrice, null);
    const rc = riskCap(d.strategyId);
    const riskAll = isN(x.risk) ? x.risk + (isN(d.groupRisk) ? d.groupRisk : 0) : null;
    const riskPctAll = riskAll != null && bal > 0 ? riskAll / bal : null;
    if (isN(riskPctAll)) {
      const over = riskPctAll * 100 > rc.cap * 1.05;
      const overS = !over && rc.stratCap != null && riskPctAll * 100 > rc.stratCap * 1.05;
      add('risk', isScale ? 'Risk for the whole trade' : 'Risk per trade', over ? 'stop' : overS ? 'warn' : 'ok', riskPctAll, (overS ? rc.stratCap : rc.cap) / 100,
        over ? (rc.ramp ? `Live ramp stage ${rc.stage}/4 caps risk at ${rc.cap}% (your rule is ${rules.maxRiskPct}%). Use “Size from risk %”.` : `Your rule is ${rc.cap}% of the account. Use “Size from risk %”.`)
          : overS ? `Within your ${rc.cap}% rule but above this setup’s ${rc.stratCap}% limit.` : rc.ramp ? `Live ramp stage ${rc.stage}/4 cap: ${rc.cap}%.` : '');
    }
    // a scale leg inherits the trade's setup — a missing one was already flagged when the trade was opened
    if (!d.strategyId) { if (rules.requireStrategy) add('strategy', 'Setup from your Playbook', isScale ? 'warn' : 'stop', null, null, 'Pick the setup this trade follows — trades without a plan are the costliest.'); }
    else add('strategy', 'Setup', 'ok', stratName(d.strategyId), null);
    if (d.market === 'perp' && isN(d.leverage) && rules.maxLeverage) {
      const over = d.leverage > rules.maxLeverage;
      add('leverage', 'Leverage', over ? (live ? 'stop' : 'warn') : 'ok', d.leverage, rules.maxLeverage,
        over ? (live ? `Above your ${rules.maxLeverage}× live limit.` : `Above your ${rules.maxLeverage}× live limit — fine to practise, but live mode treats it as a broken rule.`) : '');
    }
    if (isN(x.costR) && rules.maxCostR) add('cost', 'Est. round-trip cost', x.costR > rules.maxCostR ? 'warn' : 'ok', x.costR, rules.maxCostR, x.costR > rules.maxCostR ? 'Costs eat a big part of the edge — widen the stop, use maker orders, or skip it.' : '');
    if (x.liqState === 'beyond') add('liq', 'Stop vs liquidation', 'stop', x.liq ? x.liq.price : null, d.stopPrice, 'Your stop is beyond liquidation — you’d be liquidated first.');
    else if (x.liqState === 'tight') add('liq', 'Stop vs liquidation', 'warn', x.liq ? x.liq.price : null, d.stopPrice, 'Your stop uses more than 50% of the distance to liquidation — lower the leverage.');
    const state = items.some(i => i.state === 'stop') ? 'stop' : items.some(i => i.state === 'warn') ? 'warn' : 'ok';
    return { state, items };
  }
  // HTML for a rule's value. Also renders stored entry.violations (backups / imports), so every
  // branch only ever interpolates numbers or escaped text.
  function guardVal(it) {
    const v = it.value, l = it.limit;
    switch (it.rule) {
      case 'daily': case 'weekly': return `${fmtPct(v, { sign: true, dp: 1 })} / ${fmtPct(isN(l) ? Math.abs(l) : null, { dp: 0 })}`;
      case 'heat': case 'cluster': case 'risk': return `${fmtPct(v, { dp: 2 })} / ${fmtPct(l, { dp: 2 })}`;
      case 'cooldown': return !isN(v) ? '—' : isN(l) && v < l ? `${Math.ceil(l - v)} min left` : 'done';
      case 'count': case 'streak': return isN(v) ? `${v}${isN(l) ? ` / ${l}` : ''}` : '—';
      case 'leverage': return isN(v) ? `${+v.toFixed(2)}×${isN(l) ? ` / ${l}×` : ''}` : '—';
      case 'cost': return `${rNum(v)} / ${rTxt(l)}`;
      case 'liq': return isN(v) ? `liq ≈ ${fmtPrice(v)}` : '';
      case 'stop': return isN(v) ? fmtPrice(v) : 'none';
      case 'strategy': return v ? esc(v) : 'none';
      case 'balance': return money(isN(v) ? v : 0);
      default: return v == null ? '' : esc(String(v));
    }
  }
  const OK_SHORT = { stop: 'Stop set', risk: 'Risk', strategy: 'Setup', leverage: 'Leverage', cost: 'Costs', liq: 'Liquidation', daily: 'Daily loss', weekly: 'Weekly loss', count: 'Trades today', streak: 'Loss streak', cooldown: 'Cooldown', heat: 'Open risk', cluster: 'Correlated', balance: 'Balance' };
  // Compact list: broken / warning rules as rows, passing ones on a single ✓ line
  function guardHtml(g) {
    if (!g || !g.items.length) return '';
    const bad = g.items.filter(i => i.state !== 'ok'), ok = g.items.filter(i => i.state === 'ok');
    const withVal = ['risk', 'heat', 'cost', 'leverage', 'count', 'daily'];
    return `<div class="guard-list tf-guards">${bad.map(i => `<div class="guard ${i.state}"><span class="gi" aria-hidden="true">${i.state === 'stop' ? '✕' : '!'}</span>
        <span class="tf-gtxt"><span class="gl">${esc(i.label)}<span class="sr-only">: ${i.state === 'stop' ? 'rule broken' : 'warning'}</span></span>${i.hint ? `<span class="gh">${esc(i.hint)}</span>` : ''}</span>
        <span class="gv">${guardVal(i)}</span></div>`).join('')}
      ${ok.length ? `<div class="tf-okline"><span class="sr-only">Rules passing:</span>${ok.map(i => `<span class="tf-ok">${esc(own(OK_SHORT, i.rule) || i.label)}${withVal.includes(i.rule) ? ` <b>${guardVal(i)}</b>` : ''}</span>`).join('')}</div>` : ''}</div>`;
  }
  // Screen readers hear when the set of broken / warning rules changes — not every keystroke's new numbers
  function sayGuards(root, g) {
    const el = root.querySelector('[data-r="guardsay"]'); if (!el) return;
    const bad = g ? g.items.filter(i => i.state !== 'ok') : [];
    const msg = bad.length ? bad.map(i => `${i.label}: ${i.state === 'stop' ? 'rule broken' : 'warning'}`).join('. ') + '.' : g && g.items.length ? 'All your rules pass.' : '';
    if (el.dataset.say !== msg) { el.dataset.say = msg; el.textContent = msg; }
  }
  const GUARDS_BOX = '<div data-r="guards"></div><div class="sr-only" data-r="guardsay" role="status" aria-live="polite"></div>';
  // Circuit breaker tripped today → one clear banner at the top of the form
  function dayBanner(g) {
    const it = g.items.find(i => DAY_RULES.includes(i.rule) && i.state === 'stop'); if (!it) return '';
    const left = isN(it.value) && isN(it.limit) ? Math.max(1, Math.ceil(it.limit - it.value)) : null;
    const msg = {
      daily: 'Daily loss limit hit — the plan says stop for today.',
      weekly: 'Weekly loss limit hit — the plan says pause until next week.',
      count: `That’s ${it.value} trades today — your limit is ${it.limit}.`,
      streak: `${it.value} losses in a row today — your rule says walk away.`,
      cooldown: `You’re in your cooldown after a loss${left ? ` — ${left} min left` : ''}.`,
    }[it.rule] || it.label;
    return `<div class="banner err" role="alert">${ic('alert')}<div class="grow"><b>${esc(msg)}</b> You can still log it, but you’ll be asked why you’re overriding your rule.</div></div>`;
  }
  // The soft interrupt: broken rules need a typed reason; returns {violations} or null (don't take it)
  async function confirmOverride(g, what) {
    const broken = g.items.filter(i => i.state === 'stop');
    if (!broken.length) return { violations: [] };
    const res = await confirmDialog({
      title: 'This breaks your rules', danger: true, width: 520,
      html: `<div class="tf-cmsg"><p>${esc(what || 'This trade')} breaks ${broken.length === 1 ? 'one of your rules' : broken.length + ' of your rules'}:</p>
        <ul class="tf-viol">${broken.map(i => `<li><b>${esc(i.label)}</b>${guardVal(i) ? `<span class="mono">${guardVal(i)}</span>` : ''}${i.hint ? `<br><span class="dim">${esc(i.hint)}</span>` : ''}</li>`).join('')}</ul>
        <p class="dim">Overrides are logged in your journal and count against your discipline score. Walking away is always an option.</p></div>`,
      reason: 'Why are you overriding your rule?', confirmText: 'Override & save', cancelText: 'Don’t take this trade',
    });
    if (!res || typeof res !== 'object') return null;
    const at = nowISO();
    return { violations: broken.map(i => ({ rule: i.rule, value: isN(i.value) ? i.value : null, limit: isN(i.limit) ? i.limit : null, reason: res.reason, at })) };
  }
  function logOverrides(violations, tradeId) {
    if (!violations || !violations.length) return;
    if (!Array.isArray(db.overrides)) db.overrides = [];
    for (const v of violations) db.overrides.push({ at: v.at, mode: db.mode, rule: v.rule, value: v.value, limit: v.limit, reason: v.reason, tradeId });
  }
  // Celebrate process, never P/L: "Plan followed ✓ — N clean trades in a row"
  function processToast(tradeId) {
    const c = ensureC(); if (!c || !hasMetrics()) return;
    const g = groupById(tradeId); if (!g || !g.closed) return;
    const ctx = metricsCtx();
    if (call(() => Metrics.flagsFor(g, ctx).length, 1) !== 0) return;
    const desc = [...c.closedGroups].sort((a, b) => (b.exitMs || 0) - (a.exitMs || 0));
    let n = 0;
    for (const x of desc) { if (call(() => Metrics.flagsFor(x, ctx).length, 1) === 0) n++; else break; }
    // n = 0: a back-filled trade that isn't part of the current clean streak
    setTimeout(() => toast(n > 0 ? `Plan followed ✓ — ${plural(n, 'clean trade')} in a row` : 'Plan followed ✓', 'ok'), 350);
  }

  /* ── Suggested mistakes & grade (suggestions, never silent tags) ── */
  // info: { id (trade id to ignore in history), riskPct, R, win, plannedR }
  function detectFlags(d, info) {
    const out = [], rules = S().risk || {}, known = new Set((db.mistakes || []).map(m => m && m.id));
    const add = (id, why) => { if (known.has(id)) out.push({ id, why }); };
    const cap = riskCap(d.strategyId).use;
    if (!isN(d.stopPrice)) add('no_stop', 'No stop loss was set.');
    if (isN(info.riskPct) && info.riskPct * 100 > cap * 1.1) add('oversize', `Risked ${fmtPct(info.riskPct, { dp: 2 })} against your ${cap}% rule.`);
    if (isN(d.stopFinal) && isN(d.stopPrice) && (d.side === 'short' ? d.stopFinal > d.stopPrice : d.stopFinal < d.stopPrice)) add('moved_stop', `The stop moved from ${fmtPriceText(d.stopPrice)} to ${fmtPriceText(d.stopFinal)} — further from the entry.`);
    if (isN(info.R) && info.R < -1.1) add('held_loser', `Lost ${fmtR(info.R)} — more than the planned 1R (stop moved, ignored or slipped).`);
    if (!d.strategyId) add('no_plan', 'No setup from your Playbook was chosen.');
    const t = Date.parse(d.entryAt || ''), c = ensureC();
    if (isFinite(t) && c) {
      const cd = (rules.cooldownMin || 0) * MIN_MS;
      if (cd) {
        const prev = c.closedGroups.find(g => g.trade.id !== info.id && g.loss && isN(g.exitMs) && g.exitMs <= t && t - g.exitMs <= cd);
        if (prev) add('revenge', `Opened ${Math.max(1, Math.round((t - prev.exitMs) / MIN_MS))} min after a losing ${prev.coin || ''} exit.`);
      }
      if (rules.maxTradesDay && hasMetrics()) {
        const reset = rules.dayResetHour || 0, k = Metrics.tradingDayKey(t, reset);
        const n = c.groups.filter(g => { const gt = Date.parse(g.trade.entryAt); return g.trade.id !== info.id && isFinite(gt) && gt <= t && Metrics.tradingDayKey(gt, reset) === k; }).length + 1;
        if (n > rules.maxTradesDay) add('overtrading', `Trade #${n} of the day — your limit is ${rules.maxTradesDay}.`);
      }
    }
    if (info.win && isN(info.R) && isN(info.plannedR) && info.plannedR > 0 && info.R < 0.5 * info.plannedR) add('early_exit', `Closed at ${fmtR(info.R)} of a planned ${rTxt(info.plannedR)}.`);
    return out;
  }
  function suggestFor(info, mistakes) {
    if (!info || !info.draft || !hasMetrics()) return null;
    const ctx = mctx(); if (!ctx) return null;
    const e = { ...info.draft, mistakes: mistakes || [], riskPct: isN(info.riskPct) ? info.riskPct : null };
    const g = call(() => Metrics.suggestGrade(e, ctx), null);
    if (!['A', 'B', 'C'].includes(g)) return null;
    // a logged rule override is "broke a key rule" (C), however clean the rest of the trade was
    return hasViolations(info.draft) ? 'C' : g;
  }
  const hasViolations = (e) => !!e && Array.isArray(e.violations) && e.violations.some(v => v && typeof v === 'object');
  // Group-level numbers for a closed trade (risk across all legs, net R)
  function groupInfo(g) {
    const pb = g.trade.prevBalance;
    return { id: g.trade.id, riskPct: isN(g.risk) && pb > 0 ? g.risk / pb : null, R: isN(g.R) ? g.R : null, win: !!g.win, plannedR: isN(g.plannedR) ? g.plannedR : null };
  }
  // Universal risk rules added to every setup's checklist, ticked automatically from the numbers
  function autoChecks(d, x) {
    const rc = riskCap(d.strategyId), s = d.strategyId ? strategyById(d.strategyId) : null;
    const out = [
      { text: 'Stop loss set before entry', met: isN(d.stopPrice), auto: true },
      { text: `Risk within ${rc.use}% of the account`, met: isN(x.riskPct) && x.riskPct * 100 <= rc.use * 1.05, auto: true },
    ];
    // without a target the R:R can't be checked (trailing exits have none) — shown, but not scored
    if (s && isN(s.minRR) && s.minRR > 0) out.push({ text: `Reward:risk at least ${s.minRR}R`, met: x.rr != null && x.rr >= s.minRR - 1e-9, auto: true, na: x.rr == null });
    return out;
  }
  // High-intensity pre-trade state → show how the user's own trades in that state went
  function emoWarnHtml(d, excludeId) {
    const hot = (d.emoPre || []).filter(id => HOT_EMOS.includes(id));
    const intense = isN(d.emoPreInt) && d.emoPreInt >= 4;
    if (!hot.length && !intense) return '';
    const c = ensureC();
    const gs = c ? c.closedGroups.filter(g => g.trade.id !== excludeId && (hot.some(h => (g.trade.emoPre || []).includes(h)) || (intense && isN(g.trade.emoPreInt) && g.trade.emoPreInt >= 4))) : [];
    const rs = gs.map(g => g.R).filter(isN), m = rs.length ? rs.reduce((s, v) => s + v, 0) / rs.length : null;
    const what = hot.length ? hot.map(id => emoLabel(id, EMOTIONS_PRE)).join(' / ') : `intensity ${d.emoPreInt} of 5`;
    // per-bucket statistic → the contract's 10-trade minimum
    const stat = rs.length >= 10 ? `In this state your trades average <b class="${plClass(m)}">${gl(m)}${fmtR(m)}</b> ${confBadge(rs.length)}.` : `${rs.length ? `Only ${plural(rs.length, 'past trade')}` : 'No past trades'} in this state — not enough to judge yet (needs 10+).`;
    return `<b>High-intensity state (${esc(what)}).</b> ${stat} Fear tends to cut winners early, FOMO to chase and oversize, frustration to revenge-trade. Consider half size — or skip it.`;
  }

  /* ── Field helpers (inputs found by data-f, hints by data-h) ── */
  const q = (root, k) => root.querySelector(`[data-f="${k}"]`);
  const val = (root, k) => { const el = q(root, k); return el ? String(el.value || '') : ''; };
  const numF = (root, k) => numIn(val(root, k));
  const strF = (root, k) => { const s = val(root, k).trim(); return s || null; };
  function setVal(root, k, v) { const el = q(root, k); if (el) el.value = v == null ? '' : String(v); }
  const hintEl = (root, k) => root.querySelector(`[data-h="${k}"]`);
  // Only touch the DOM when the markup changed (keeps focus, avoids screen-reader chatter)
  function setHtml(el, html) { if (!el) return; if (el._tfh !== html) { el._tfh = html; el.innerHTML = html; } }
  // Live help text under a field (kept while an error is showing, restored after)
  function setHint(root, k, text, cls) {
    const h = hintEl(root, k); if (!h) return;
    h.dataset.base = text || ''; h.dataset.bcls = cls || '';
    if (!h.classList.contains('err')) { h.textContent = text || ''; h.className = 'hint' + (cls ? ' ' + cls : ''); }
  }
  function mark(root, k, msg) {
    const el = q(root, k), h = hintEl(root, k);
    if (el) { el.classList.add('invalid'); el.setAttribute('aria-invalid', 'true'); }
    if (h) { h.textContent = msg; h.className = 'hint err'; }
  }
  function unmark(root, k) {
    const el = q(root, k), h = hintEl(root, k);
    if (el) { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); }
    if (h && h.classList.contains('err')) { h.textContent = h.dataset.base || ''; h.className = 'hint' + (h.dataset.bcls ? ' ' + h.dataset.bcls : ''); }
  }
  function clearMarks(root) {
    root.querySelectorAll('[aria-invalid="true"][data-f]').forEach(el => unmark(root, el.dataset.f));
    root.querySelectorAll('.hint.err[data-h]').forEach(h => unmark(root, h.dataset.h));
  }
  // Mark every error, open a collapsed section that holds one, focus the first
  function showErrors(root, errs) {
    errs.forEach(([k, m]) => mark(root, k, m));
    if (!errs.length) return;
    const first = q(root, errs[0][0]) || hintEl(root, errs[0][0]);
    if (!first) return;
    const det = first.closest('details'); if (det && !det.open) det.open = true;
    const target = first.matches('input, select, textarea') ? first : (first.parentElement && first.parentElement.querySelector('button')) || first;
    if (target.focus) target.focus({ preventScroll: true });
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // type=number keeps '' for text it can't parse — flag it instead of silently saving nothing
  function badNumbers(root) {
    const out = [];
    root.querySelectorAll('input[type="number"][data-f]').forEach(el => { if (el.validity && el.validity.badInput && !el.closest('[hidden]')) out.push([el.dataset.f, 'Not a number — use digits and a dot for decimals.']); });
    return out;
  }
  // Side-aware price sanity: stop below a long's entry / above a short's, target the other way
  function sideErrors(d, errs) {
    const long = d.side !== 'short', e = d.entryPrice;
    if (isN(d.stopPrice)) {
      if (d.stopPrice <= 0) errs.push(['stopPrice', 'The stop must be above 0.']);
      else if (isN(e) && (long ? d.stopPrice >= e : d.stopPrice <= e)) errs.push(['stopPrice', long ? 'For a long, the stop goes below the entry price.' : 'For a short, the stop goes above the entry price.']);
    }
    if (isN(d.targetPrice)) {
      if (d.targetPrice <= 0) errs.push(['targetPrice', 'The target must be above 0.']);
      else if (isN(e) && (long ? d.targetPrice <= e : d.targetPrice >= e)) errs.push(['targetPrice', long ? 'For a long, the target goes above the entry price.' : 'For a short, the target goes below the entry price.']);
    }
  }
  // more than 10 minutes ahead of the clock — a typo in the date, not a real fill
  const futureT = (s) => { const t = Date.parse(s || ''); return isFinite(t) && t > Date.now() + 10 * MIN_MS; };
  function exitErrors(d, errs) {
    if (isN(d.exitPrice)) {
      if (d.exitPrice <= 0) errs.push(['exitPrice', 'The exit price must be above 0.']);
      if (!d.exitAt || !isFinite(Date.parse(d.exitAt))) errs.push(['exitAt', 'When did you get out?']);
      else if (isFinite(Date.parse(d.entryAt)) && Date.parse(d.exitAt) < Date.parse(d.entryAt)) errs.push(['exitAt', 'The exit can’t be before the entry.']);
    } else if (d.exitAt) errs.push(['exitPrice', 'Add the exit price — or clear the exit time if the trade is still open.']);
  }
  // list: every price the trade traded at (all legs' entries and exits); defaults to this row's
  function excursionErrors(d, errs, list) {
    const hi = d.highDuring, lo = d.lowDuring, px = (list || [d.entryPrice, d.exitPrice]).filter(isN);
    if (isN(hi) && isN(lo) && hi < lo) { errs.push(['highDuring', 'The high can’t be below the low.']); return; }
    if (isN(hi) && px.length && hi < Math.max(...px) * (1 - 1e-9)) errs.push(['highDuring', 'The high must be at least the entry and exit prices — price traded there.']);
    if (isN(lo) && px.length && lo > Math.min(...px) * (1 + 1e-9)) errs.push(['lowDuring', 'The low must be at most the entry and exit prices — price traded there.']);
  }
  // One labelled field. o: { k, label, type 'num'|'text'|'dt'|'area'|'select', value, ph, opt, hint, tip, attrs, cls, html, addon, btn, chip, lbtn, after, show, rows, max }
  function fld(p, o) {
    const id = `${p}-${o.k}`, hint = o.hint || '';
    const common = `id="${id}" data-f="${o.k}" aria-describedby="${id}-h"${o.attrs ? ' ' + o.attrs : ''}`;
    const v = o.value == null ? '' : String(o.value);
    let input;
    if (o.type === 'area') input = `<textarea class="input${o.cls ? ' ' + o.cls : ''}" ${common} rows="${o.rows || 2}" maxlength="${o.max || 4000}" placeholder="${esc(o.ph || '')}">${esc(v)}</textarea>`;
    else if (o.type === 'select') input = `<select class="input" ${common}>${o.html || ''}</select>`;
    else if (o.type === 'dt') input = `<input class="input" type="datetime-local" ${common} value="${esc(v)}">`;
    else if (o.type === 'num') input = `<input class="input mono${o.cls ? ' ' + o.cls : ''}" type="number" step="any" inputmode="decimal" ${common} placeholder="${esc(o.ph || '')}" value="${esc(v)}">`;
    else input = `<input class="input${o.cls ? ' ' + o.cls : ''}" type="text" ${common} autocomplete="off" placeholder="${esc(o.ph || '')}" value="${esc(v)}">`;
    if (o.addon) input = `<div class="input-group">${input}<span class="addon" aria-hidden="true">${esc(o.addon)}</span></div>`;
    if (o.btn) input = `<div class="tf-inrow">${input}${o.btn}</div>`;
    const lab = `<label for="${id}">${esc(o.label)}${o.opt ? ' <span class="opt">optional</span>' : ''}</label>${o.tip || ''}`;
    const head = o.chip || o.lbtn || o.tip ? `<div class="tf-lrow">${lab}${o.lbtn || ''}${o.chip || ''}</div>` : lab;
    return `<div class="field${o.full ? ' full' : ''}"${o.show ? ` data-show="${o.show}"` : ''}>${head}${input}${o.after || ''}<div class="hint" id="${id}-h" data-h="${o.k}" data-base="${esc(hint)}">${esc(hint)}</div></div>`;
  }

  /* ── Pickers (shared .seg / .chip / .stars look; focus survives redraw) ── */
  // Segmented control. clearable: clicking the active option clears it (ratings, grade).
  function segX(el, options, value, onChange, clearable) {
    let v = value == null || value === '' ? null : String(value);
    function draw(focusId) {
      el.classList.add('seg');
      el.innerHTML = options.map(o => `<button type="button" data-id="${esc(o.id)}" class="${o.id === v ? 'on' : ''}" aria-pressed="${o.id === v}"${o.title ? ` title="${esc(o.title)}"` : ''}>${esc(o.label)}</button>`).join('');
      el.querySelectorAll('button').forEach(b => b.onclick = () => { const id = b.dataset.id; v = clearable && v === id ? null : id; draw(id); if (onChange) onChange(v); });
      if (focusId != null) { const f = el.querySelector(`button[data-id="${cssEsc(focusId)}"]`); if (f) f.focus({ preventScroll: true }); }
    }
    draw();
    return { get value() { return v; }, set(x) { v = x == null || x === '' ? null : String(x); draw(); } };
  }
  // Chip picker with optional groups. o: { multi, max, exclusive:[ids], onChange(sel) }
  function picker(el, groups, selected, o) {
    o = o || {};
    let sel = [...(selected || [])];
    const ex = o.exclusive || [];
    function draw(focusId) {
      el.innerHTML = groups.map(g => `${g.label ? `<div class="chip-group-l">${esc(g.label)}</div>` : ''}<div class="chip-row">${g.items.map(it => {
        const on = sel.includes(it.id);
        return `<button type="button" class="chip sm${it.tone ? ' tone-' + it.tone : ''}${on ? ' on' : ''}" data-id="${esc(it.id)}" aria-pressed="${on}"${it.title ? ` title="${esc(it.title)}"` : ''}>${on ? '<span aria-hidden="true">✓</span>' : ''}${esc(it.label)}</button>`;
      }).join('')}</div>`).join('');
      el.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => {
        const id = b.dataset.id, on = sel.includes(id);
        if (!o.multi) sel = on ? [] : [id];
        else if (on) sel = sel.filter(x => x !== id);
        else {
          sel = ex.includes(id) ? [id] : sel.filter(x => !ex.includes(x)).concat(id);
          if (o.max && sel.length > o.max) sel = sel.slice(sel.length - o.max);
        }
        draw(id); if (o.onChange) o.onChange([...sel]);
      });
      if (focusId != null) { const f = el.querySelector(`button[data-id="${cssEsc(focusId)}"]`); if (f) f.focus({ preventScroll: true }); }
    }
    draw();
    return { get value() { return [...sel]; }, set(v) { sel = [...(v || [])]; draw(); } };
  }
  // Legacy 1–5 discipline stars ("execution feel")
  function starsX(el, value, onChange) {
    let v = isN(value) && value >= 1 && value <= 5 ? Math.round(value) : null;
    function draw(focusN) {
      el.className = 'stars';
      el.innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" class="${v != null && n <= v ? 'on' : ''}" aria-pressed="${v === n}" aria-label="${plural(n, 'star')}">${ic('star', 20)}</button>`).join('');
      el.querySelectorAll('button').forEach(b => b.onclick = () => { const n = +b.dataset.n; v = v === n ? null : n; draw(n); if (onChange) onChange(v); });
      if (focusN) { const f = el.querySelector(`button[data-n="${focusN}"]`); if (f) f.focus({ preventScroll: true }); }
    }
    draw();
    return { get value() { return v; } };
  }
  function tagGroupsFor(sel) {
    const groups = (Array.isArray(db.tagGroups) ? db.tagGroups : []).filter(g => g && Array.isArray(g.tags) && g.tags.length)
      .map(g => ({ label: g.name || g.id, items: g.tags.filter(t => typeof t === 'string' && t).map(t => ({ id: t, label: t })) }));
    const known = new Set(groups.flatMap(g => g.items.map(i => i.id)));
    const extra = (sel || []).filter(t => typeof t === 'string' && t && !known.has(t));
    if (extra.length) groups.push({ label: 'Other', items: extra.map(t => ({ id: t, label: t })) });
    return groups;
  }
  function mistakeGroups(sel) {
    const chosen = Array.isArray(sel) ? sel : [];
    const list = (Array.isArray(db.mistakes) ? db.mistakes : []).filter(m => m && m.id && m.id !== 'none' && ((m.hidden !== true && m.active !== false) || chosen.includes(m.id)));
    const by = new Map();
    for (const m of list) {
      const g = m.group || 'other';
      if (!by.has(g)) by.set(g, []);
      by.get(g).push({ id: m.id, label: m.label, tone: m.severe ? 'severe' : m.minor ? 'hot' : 'neg', title: m.severe ? 'Severe — usually the costliest' : '' });
    }
    const groups = [{ items: [{ id: 'none', label: 'Clean — no mistakes', tone: 'clean' }] }];
    for (const [g, items] of by) groups.push({ label: own(GROUP_LABEL, g) || String(g), items });
    const known = new Set(list.map(m => m.id));
    const extra = chosen.filter(id => id !== 'none' && !known.has(id));
    if (extra.length) groups.push({ label: 'Other', items: extra.map(id => ({ id, label: mistakeLabel(id), tone: 'neg' })) });
    return groups;
  }

  /* ── Live price chip ("as of HH:MM", stale) ────────────── */
  const chipHtml = (k) => `<button type="button" class="tf-chip" data-chip="${k}" hidden><span class="pulse" aria-hidden="true"></span><span data-cv></span><span class="tf-asof" data-ca></span></button>`;
  // targets: { chipKey: fieldKey } — click fills that input with the last known price
  function liveChips(root, getCoin, targets) {
    let quote = null, coin = '', reqN = 0;
    function draw() {
      for (const k of Object.keys(targets)) {
        const b = root.querySelector(`[data-chip="${k}"]`); if (!b) continue;
        if (!quote || !isN(quote.usd)) { b.hidden = true; continue; }
        const t = isN(quote.at) ? fmtTime(quote.at) : '';
        b.hidden = false;
        b.classList.toggle('stale', !!quote.stale);
        b.querySelector('[data-cv]').innerHTML = fmtPrice(quote.usd);
        b.querySelector('[data-ca]').textContent = (quote.stale ? 'stale · ' : '') + (t ? 'as of ' + t : '');
        b.title = `${quote.stale ? 'Last known' : 'Live'} ${coin} price${quote.source ? ' from ' + quote.source : ''}${isN(quote.at) ? ', as of ' + fmtDateTime(quote.at) : ''}. Click to use it.`;
        b.setAttribute('aria-label', `Use the ${quote.stale ? 'last known' : 'live'} price ${fmtPriceText(quote.usd)}${t ? ', as of ' + t : ''}`);
      }
    }
    function refresh(fetch) {
      const s = String(getCoin() || '').toUpperCase().trim();
      coin = s;
      if (!hasMarket() || !s || !COIN_RE.test(s)) { quote = null; draw(); return; }
      quote = typeof Market.cached === 'function' ? call(() => Market.cached(s), null) : null;
      draw();
      if (fetch && typeof Market.price === 'function') {
        const n = ++reqN;
        Promise.resolve(call(() => Market.price(s), null)).then(qt => { if (n !== reqN || coin !== s || !qt) return; quote = qt; draw(); }).catch(() => {});
      }
    }
    for (const [k, field] of Object.entries(targets)) {
      const b = root.querySelector(`[data-chip="${k}"]`); if (!b) continue;
      b.onclick = () => {
        if (!quote || !isN(quote.usd)) return;
        const inp = q(root, field); if (!inp) return;
        inp.value = plain(sig(quote.usd, 10));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.focus();
      };
    }
    return { refresh };
  }

  /* ── Modal wrapper & image viewer ──────────────────────── */
  // Modal.open + Ctrl/⌘+Enter clicks the footer's Save, plus live-price hook cleanup on close
  const priceHooks = new Set(), refreshHooks = new Set();
  function modal(o) {
    let hook = null;
    return Modal.open({
      title: o.title, width: o.width, body: o.body, foot: o.foot,
      onMount: (el, closeM) => {
        el.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter' || !(ev.ctrlKey || ev.metaKey) || ev.defaultPrevented) return;
          const b = el.querySelector('.modal-foot [data-a="save"]');
          if (b && !b.disabled) { ev.preventDefault(); b.click(); }
        });
        if (o.onMount) o.onMount(el, closeM, (f) => { hook = f; priceHooks.add(f); });
      },
      onClose: (v) => { if (hook) priceHooks.delete(hook); if (o.onClose) o.onClose(v); },
    });
  }
  function bigView(url, caption) {
    Modal.open({ title: caption || 'Screenshot', width: 1100, body: `<img class="tf-big" src="${esc(url)}" alt="${esc(caption || 'Trade screenshot')}">${caption ? `<p class="tf-bigcap">${esc(caption)}</p>` : ''}` });
  }
  const hasFiles = (ev) => !!(ev.dataTransfer && [...(ev.dataTransfer.types || [])].includes('Files'));
  function imageFiles(list) { return [...(list || [])].filter(f => f && /^image\//i.test(f.type || '')); }

  /* ── Screenshots (stored in IndexedDB via Store, never localStorage) ── */
  // Saved shots are {id|url, kind, caption}. New ones stay in memory until Save, so a cancelled
  // form leaves no orphan media; removed ones are deleted only after the save succeeds.
  function mountShots(box, saved, pendingIn, removedIn, onDirty) {
    const kept = (Array.isArray(saved) ? saved : []).filter(s => s && (s.id || s.url)).map(s => ({ id: s.id || null, url: s.url || null, kind: s.kind || 'other', caption: s.caption || '' }));
    const removed = Array.isArray(removedIn) ? [...removedIn] : [];
    // id: already stored by a save that could not be written to disk — reused instead of storing it twice
    const pend = (Array.isArray(pendingIn) ? pendingIn : []).filter(x => x && x.blob instanceof Blob).map(x => ({ blob: x.blob, kind: x.kind || 'other', caption: x.caption || '', url: URL.createObjectURL(x.blob), id: x.id || null }));
    // Store.error is set once IndexedDB has failed to open (null while it is still opening)
    const can = hasStore() && !Store.error;
    box.innerHTML = `<button type="button" class="tf-drop${can ? '' : ' off'}" data-s="pick"${can ? '' : ' disabled'}>${ic('image', 22)}<span><b>${can ? 'Add a screenshot' : 'Screenshots unavailable'}</b>${can ? 'Paste with Ctrl+V anywhere in this form, drop an image here, or click to choose a file.' : 'This browser blocks local image storage — add a link under Advanced instead.'}</span></button>
      <input type="file" accept="image/*" multiple hidden data-s="file" tabindex="-1">
      <div class="tf-thumbs" data-s="thumbs"></div>`;
    const byKey = (key) => (key && key[0] === 'k' ? kept[+key.slice(1)] : key && key[0] === 'p' ? pend[+key.slice(1)] : null);
    function draw() {
      const th = box.querySelector('[data-s="thumbs"]');
      const all = [...kept.map((s, i) => ({ s, key: 'k' + i })), ...pend.map((s, i) => ({ s, key: 'p' + i }))];
      th.innerHTML = all.map(({ s, key }, i) => `<div class="tf-thumb" data-key="${key}">
          <button type="button" class="tf-thumb-img" data-s="big" aria-label="View screenshot ${i + 1} larger"><span class="tf-ph">${ic('image', 22)}</span><img alt="" hidden></button>
          <div class="tf-thumb-bar"><select class="input sm" data-s="kind" aria-label="Screenshot ${i + 1} type">${SHOT_KINDS.map(k => `<option value="${k.id}"${k.id === s.kind ? ' selected' : ''}>${k.label}</option>`).join('')}</select>
            <button type="button" class="btn btn-quiet btn-icon btn-xs" data-s="rm" aria-label="Remove screenshot ${i + 1}">${ic('trash', 14)}</button></div>
          <input class="input sm" data-s="cap" maxlength="140" placeholder="Caption (optional)" aria-label="Screenshot ${i + 1} caption" value="${esc(s.caption)}"></div>`).join('');
      th.querySelectorAll('.tf-thumb').forEach(t => {
        const it = byKey(t.dataset.key); if (!it) return;
        const img = t.querySelector('img'), ph = t.querySelector('.tf-ph');
        const show = (u) => { if (!u || !img.isConnected) return; img.onload = () => { img.hidden = false; ph.hidden = true; }; img.src = u; };
        if (it.blob) show(it.url);
        else if (it.id && can && typeof Store.mediaURL === 'function') Promise.resolve(Store.mediaURL(it.id)).then(show).catch(() => {});
        else if (it.url) { const u = safeUrl(it.url); if (u && !isWeb(u)) show(u); else ph.innerHTML = '<span class="tf-small">link</span>'; }
      });
    }
    function add(files) {
      if (!can) { toast('Screenshots need browser storage, which is blocked here', 'err'); return 0; }
      const imgs = imageFiles(files);
      if (!imgs.length) { if (files && files.length) toast('Only image files can be attached', 'warn'); return 0; }
      let n = 0;
      for (const f of imgs) {
        if (f.size > 25 * 1024 * 1024) { toast('That image is over 25 MB — crop or compress it first', 'warn'); continue; }
        if (kept.length + pend.length >= 12) { toast('Up to 12 screenshots per trade', 'warn'); break; }
        const kinds = [...kept, ...pend].map(s => s.kind);
        pend.push({ blob: f, kind: !kinds.includes('before') ? 'before' : !kinds.includes('after') ? 'after' : 'other', caption: '', url: URL.createObjectURL(f) });
        n++;
      }
      if (n) { draw(); if (onDirty) onDirty(); }
      return n;
    }
    function remove(key) {
      if (key[0] === 'k') { const [s] = kept.splice(+key.slice(1), 1); if (s && s.id) removed.push(s.id); }
      else { const [s] = pend.splice(+key.slice(1), 1); if (s && s.url) URL.revokeObjectURL(s.url); if (s && s.id) removed.push(s.id); }
      draw(); if (onDirty) onDirty();
      const pick = box.querySelector('.tf-drop'); if (pick) pick.focus({ preventScroll: true });
    }
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-s]'); if (!b || !box.contains(b)) return;
      const a = b.dataset.s, t = b.closest('.tf-thumb'), it = t ? byKey(t.dataset.key) : null;
      if (a === 'pick') box.querySelector('[data-s="file"]').click();
      else if (a === 'rm' && t) remove(t.dataset.key);
      else if (a === 'big' && it) {
        const img = t.querySelector('img');
        if (img && img.src && !img.hidden) bigView(img.src, it.caption || kindLabel(it.kind));
        else if (it.url && isWeb(it.url) && safeUrl(it.url)) window.open(safeUrl(it.url), '_blank', 'noopener');
      }
    });
    box.addEventListener('change', (ev) => {
      const s = ev.target.dataset.s;
      if (s === 'file') { add([...(ev.target.files || [])]); ev.target.value = ''; return; }
      const t = ev.target.closest('.tf-thumb'), it = t ? byKey(t.dataset.key) : null;
      if (it && s === 'kind') { it.kind = ev.target.value; if (onDirty) onDirty(); }
    });
    box.addEventListener('input', (ev) => {
      if (ev.target.dataset.s !== 'cap') return;
      const it = byKey(ev.target.closest('.tf-thumb').dataset.key);
      if (it) { it.caption = ev.target.value.slice(0, 140); if (onDirty) onDirty(); }
    });
    const drop = box.querySelector('.tf-drop');
    drop.addEventListener('dragenter', () => { if (can) drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', () => drop.classList.remove('over'));
    draw();
    return {
      add,
      async commit(tradeId) {
        const list = kept.map(s => ({ ...(s.id ? { id: s.id } : { url: s.url }), kind: s.kind, ...(s.caption ? { caption: s.caption } : {}) }));
        let failed = 0;
        for (const s of pend) {
          try {
            // stays pending with its id until the entry is on disk, so a retry after a failed save reuses it
            const id = s.id || (s.id = await Store.putMedia(s.blob, { tradeId, kind: s.kind, name: s.blob.name || '' }));
            list.push({ id, kind: s.kind, ...(s.caption ? { caption: s.caption } : {}) });
          } catch (e) { failed++; console.error('[tradeform] screenshot', e); }
        }
        return { list, failed };
      },
      removedIds: () => [...removed],
      kept: () => kept.map(s => ({ ...s })),
      pending: () => pend.map(s => ({ blob: s.blob, kind: s.kind, caption: s.caption, id: s.id })),
      dispose() { for (const s of pend) if (s.url) URL.revokeObjectURL(s.url); },
    };
  }

  /* ── Calc strip, liquidation readout, result preview ──── */
  function calcHtml(x, rc, rules) {
    const ci = (l, v, o) => `<div class="ci"><div class="l">${l}${(o && o.tip) || ''}</div><div class="v${o && o.cls ? ' ' + o.cls : ''}">${v}</div></div>`;
    const over = isN(x.riskPct) && x.riskPct * 100 > rc.use * 1.05;
    const costHi = isN(x.costR) && rules.maxCostR && x.costR > rules.maxCostR;
    return [
      ci('Stop distance', x.stopPct != null ? fmtPct(x.stopPct, { dp: 2 }) : '—'),
      ci('$ at risk', x.risk != null ? money(x.risk) : '—'),
      ci('% of account', x.riskPct != null ? `${fmtPct(x.riskPct, { dp: 2 })}<small>${over ? `over ${rc.use}%` : `of ${rc.use}%`}</small>` : '—', { cls: over ? 'warn-c' : '' }),
      ci('Planned R:R', x.rr != null ? x.rr.toFixed(2) + 'R' : '—', { tip: tipFor('rMultiple', 'R = how many times your risk you make or lose. A 2R target makes twice what you risk.') }),
      ci('Position', x.notional != null ? `${money(x.notional)}${isN(x.effLev) ? `<small>${x.effLev.toFixed(1)}× acct</small>` : ''}` : '—'),
      ci(x.feesEstimated ? 'Est. costs' : 'Costs', x.cost != null ? `${money(x.cost)}${x.costR != null ? `<small>${rNum(x.costR)}</small>` : ''}` : '—', { cls: costHi ? 'warn-c' : '', tip: tipFor('fees', 'Round-trip fees (plus funding and gas) as dollars and as a share of your risk. Above 0.25R, costs eat the edge.') }),
      ci('Net R:R', rNum(x.netRR)),
      ci('Breakeven win rate', x.beWin != null ? fmtPct(x.beWin, { dp: 0 }) : '—', { tip: tipFor('beWinRate', 'How often this kind of trade must win to break even after costs: (1 + cost in R) ÷ (R:R + 1).') }),
    ].join('');
  }
  function liqHtml(d, x) {
    const safe = x.maxSafeLev ? `<span>Max safe leverage for this stop ≈ <b>${fmtLev(x.maxSafeLev)}×</b> — keeps liquidation at least 2× the stop distance away${isN(d.leverage) && d.leverage > x.maxSafeLev ? ' <span class="warn-c">(you are above it)</span>' : ''}.</span>` : '';
    if (!isN(d.leverage) || d.leverage <= 1) return `<span>Enter the leverage to see a liquidation estimate.</span>${safe}`;
    if (!x.liq) return `<span>Add the entry price and size to estimate liquidation.</span>${safe}`;
    const L = x.liq;
    const warn = x.liqState === 'beyond'
      ? `<div class="banner err tf-liqwarn" role="alert">${ic('alert')}<div class="grow"><b>Your stop is beyond liquidation — you’d be liquidated first.</b> Lower the leverage or tighten the stop.</div></div>`
      : x.liqState === 'tight' ? `<div class="banner tf-liqwarn">${ic('alert')}<div class="grow"><b>Your stop uses more than 50% of the distance to liquidation.</b> A wick, fees or funding could liquidate you first — lower the leverage.</div></div>` : '';
    return `<span>Liquidation <b>≈ ${fmtPrice(L.price)}</b> <span class="dim">(≈ estimate${L.approx ? ' — cross margin uses your whole balance' : ''})</span> · ${fmtPct(L.distPct, { dp: 1 })} from entry · margin ${money(L.margin)}</span>${safe}
      <span class="dim tf-small">Exchanges liquidate on the mark price, and fees and funding move it. Treat this as a guide, not a guarantee.</span>${warn}`;
  }
  function plPreview(x) {
    if (!isN(x.net)) return '';
    return `<span>Result</span><b class="${plClass(x.net)}">${gl(x.net)}${money(x.net, { sign: true })}</b><b class="${plClass(x.net)}">${x.R != null ? fmtR(x.R) : 'R —'}</b>${x.pct != null ? `<span>${fmtPct(x.pct, { sign: true, dp: 2 })} of the account</span>` : ''}${x.netUsesEst ? '<span class="dim">after estimated fees</span>' : ''}`;
  }

  /* ── Prefill normalising (Calc, duplicate, reopen) ─────── */
  const PRE_MAP = { entry: 'entryPrice', stop: 'stopPrice', target: 'targetPrice', exit: 'exitPrice', size: 'amount', qty: 'amount' };
  const PRE_NUM = ['entryPrice', 'stopPrice', 'targetPrice', 'exitPrice', 'amount', 'leverage', 'mmr', 'riskPct', 'fees', 'funding', 'gas', 'gasNative', 'plannedEntry', 'stopFinal', 'highDuring', 'lowDuring', 'emoPreInt', 'confidence', 'discipline'];
  function normPrefill(o) {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    for (const [k, v] of Object.entries(o)) { if (v === undefined) continue; out[PRE_MAP[k] || k] = v; }
    for (const k of PRE_NUM) {
      if (!(k in out) || out[k] === null) continue;
      const n = isN(out[k]) ? out[k] : numIn(out[k]);
      if (n == null) delete out[k]; else out[k] = n;
    }
    if (out.coin != null) out.coin = String(out.coin).toUpperCase().trim();
    if (out.side != null) out.side = out.side === 'short' ? 'short' : 'long';
    if (out.market != null && !MARKETS.some(m => m.id === out.market)) delete out.market;
    if (out.tags != null && !Array.isArray(out.tags)) delete out.tags;
    return out;
  }
  // What "Duplicate" copies: the setup, not the prices
  function prefillFrom(e) {
    const o = { coin: e.coin, side: e.side, strategyId: e.strategyId, venue: e.venue, market: e.market, leverage: e.leverage, marginMode: e.marginMode, mmr: e.mmr, orderTypeEntry: e.orderTypeEntry, orderTypeExit: e.orderTypeExit, tags: Array.isArray(e.tags) ? [...e.tags] : [] };
    for (const k of Object.keys(o)) if (o[k] == null) delete o[k];
    return o;
  }

  /* ── Post-trade review block (full form, close step 2, review()) ── */
  // r0: entry-like initial values. o: { excursion (high/low inputs), compact (fold the long-form reflection) }
  function reviewHtml(p, r0, o) {
    const rv = r0.review || {};
    const more = `<div class="tf-grid2">${fld(p, { k: 'wentWell', label: 'What did I do well?', type: 'area', opt: true, max: 1000, value: rv.wentWell || '' })}${fld(p, { k: 'improve', label: 'What would I do differently?', type: 'area', opt: true, max: 1000, value: rv.improve || '' })}</div>
      <div class="field"><label id="${p}-stars-l">Execution feel <span class="opt">legacy 1–5 stars</span></label><div data-rv="stars" role="group" aria-labelledby="${p}-stars-l"></div></div>`;
    return `<div class="tf-sugg-row" data-rv="sugg"></div>
      <div class="field"><label id="${p}-mk-l">Mistakes <span class="opt">tick every one that applies — or Clean</span></label><div data-rv="mistakes" role="group" aria-labelledby="${p}-mk-l" aria-describedby="${p}-mistakes-h"></div><div class="hint" id="${p}-mistakes-h" data-h="mistakes" data-base=""></div></div>
      <div class="tf-grid">
        <div class="field"><label id="${p}-plan-l">Did you follow your plan?</label><div data-rv="plan" role="group" aria-labelledby="${p}-plan-l"></div></div>
        <div class="field"><div class="tf-lrow"><label id="${p}-grade-l">Process grade</label>${tipFor('grade', 'Grade the decision, not the result. A = every rule followed, B = small slips, C = broke a key rule.')}<span class="tf-gsugg" data-rv="gsugg"></span></div><div data-rv="grade" role="group" aria-labelledby="${p}-grade-l"></div></div>
      </div>
      <div class="field"><label id="${p}-emo2-l">Emotion after <span class="opt">optional, up to 2</span></label><div data-rv="emoPost" role="group" aria-labelledby="${p}-emo2-l"></div></div>
      ${o.excursion ? `<div class="tf-grid">${fld(p, { k: 'highDuring', label: 'Highest price while open', type: 'num', opt: true, value: plain(r0.highDuring), hint: 'Gives MAE/MFE — how far price went for and against you.' })}${fld(p, { k: 'lowDuring', label: 'Lowest price while open', type: 'num', opt: true, value: plain(r0.lowDuring) })}</div>` : ''}
      ${fld(p, { k: 'lesson', label: 'Lesson', opt: true, ph: 'One line you want to remember', value: rv.lesson || '', attrs: 'maxlength="300"' })}
      ${o.compact ? `<details class="adv"><summary>More reflection — what went well, what to change, stars</summary><div class="adv-body tf-stack">${more}</div></details>` : more}`;
  }
  function mountReview(box, p, r0, getInfo, onDirty, o) {
    o = o || {};
    box.innerHTML = reviewHtml(p, r0, o);
    const rv0 = r0.review || {};
    let dismissed = Array.isArray(r0.flagsDismissed) ? [...r0.flagsDismissed] : [];
    let shown = [], lastGrade = null;
    const ch = () => { update(); if (onDirty) onDirty(); };
    const mk = picker($('[data-rv="mistakes"]', box), mistakeGroups(r0.mistakes), Array.isArray(r0.mistakes) ? r0.mistakes : [], { multi: true, exclusive: ['none'], onChange: () => { unmark(box, 'mistakes'); ch(); } });
    const plan = segX($('[data-rv="plan"]', box), [{ id: 'yes', label: 'Yes' }, { id: 'partly', label: 'Partly' }, { id: 'no', label: 'No' }], ['yes', 'partly', 'no'].includes(rv0.followedPlan) ? rv0.followedPlan : null, ch, true);
    const grade = segX($('[data-rv="grade"]', box), [{ id: 'A', label: 'A', title: 'Every rule followed' }, { id: 'B', label: 'B', title: 'Small slips' }, { id: 'C', label: 'C', title: 'Broke a key rule' }], ['A', 'B', 'C'].includes(r0.grade) ? r0.grade : null, ch, true);
    const emo = picker($('[data-rv="emoPost"]', box), [{ items: EMOTIONS_POST.map(e => ({ id: e.id, label: e.label, tone: e.tone })) }], Array.isArray(r0.emoPost) ? r0.emoPost : [], { multi: true, max: 2, onChange: ch });
    const st = starsX($('[data-rv="stars"]', box), r0.discipline, ch);
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-sugg], [data-rvs]'); if (!b || !box.contains(b)) return;
      if (b.dataset.sugg) {
        const id = b.dataset.sugg;
        mk.set(mk.value.filter(x => x !== 'none').concat(id)); unmark(box, 'mistakes'); ch();
        const f = box.querySelector(`[data-rv="mistakes"] button[data-id="${cssEsc(id)}"]`); if (f) f.focus({ preventScroll: true });
      } else if (b.dataset.rvs === 'use-grade' && lastGrade) {
        grade.set(lastGrade); ch();
        const f = box.querySelector(`[data-rv="grade"] button[data-id="${lastGrade}"]`); if (f) f.focus({ preventScroll: true });
      } else if (b.dataset.rvs === 'dismiss') { dismissed = [...new Set([...dismissed, ...shown.map(s => s.id)])]; ch(); }
    });
    function update() {
      const info = (getInfo && getInfo()) || {};
      const sel = mk.value;
      shown = info.draft ? detectFlags(info.draft, info).filter(s => !sel.includes(s.id) && !dismissed.includes(s.id)) : [];
      setHtml($('[data-rv="sugg"]', box), shown.length
        ? `<span class="tf-sugg-l">Suggested from your numbers:</span>${shown.map(s => `<button type="button" class="chip sm tf-sugg" data-sugg="${esc(s.id)}" aria-label="Add mistake: ${esc(mistakeLabel(s.id))}">${ic('plus', 11)}${esc(mistakeLabel(s.id))}</button>`).join('')}<button type="button" class="link-btn tf-small" data-rvs="dismiss">Not mistakes — hide</button>${shown.map(s => `<span class="tf-sugg-why">${esc(mistakeLabel(s.id))}: ${esc(s.why)}</span>`).join('')}`
        : '');
      lastGrade = suggestFor(info, sel);
      setHtml($('[data-rv="gsugg"]', box), lastGrade ? `Suggested: <span class="badge grade-${lastGrade} sm">${lastGrade}</span>${grade.value !== lastGrade ? '<button type="button" class="link-btn" data-rvs="use-grade">use it</button>' : ''}` : '');
    }
    const peek = () => ({
      mistakes: mk.value, grade: grade.value, emoPost: emo.value, discipline: st.value, flagsDismissed: [...dismissed],
      review: { followedPlan: plan.value, wentWell: strF(box, 'wentWell'), improve: strF(box, 'improve'), lesson: strF(box, 'lesson') },
      ...(o.excursion ? { highDuring: numF(box, 'highDuring'), lowDuring: numF(box, 'lowDuring') } : {}),
    });
    // requireMistakes: "Save review" needs at least one chip (a mistake or Clean); prices: for the high/low check
    function validate(requireMistakes, prices) {
      clearMarks(box);
      const errs = badNumbers(box);
      if (o.excursion) excursionErrors({ highDuring: numF(box, 'highDuring'), lowDuring: numF(box, 'lowDuring') }, errs, prices || []);
      if (requireMistakes && !mk.value.length) errs.push(['mistakes', 'Tick the mistakes you made — or “Clean — no mistakes” if there were none.']);
      showErrors(box, errs);
      return !errs.length;
    }
    function hasContent() {
      const r = peek();
      return !!(r.mistakes.length || r.grade || r.emoPost.length || r.discipline != null || r.review.followedPlan || r.review.wentWell || r.review.improve || r.review.lesson || (o.excursion && (isN(r.highDuring) || isN(r.lowDuring))));
    }
    update();
    return { peek, update, validate, hasContent, suggested: () => lastGrade };
  }
  // Review answers → entry patch. reviewed=false ("Skip — review later") never touches mistakes,
  // so an unreviewed trade stays in the review queue.
  function reviewPatch(cur, r, reviewed, sugg) {
    const patch = {}, rev = { ...(cur.review || {}) };
    for (const k of ['followedPlan', 'wentWell', 'improve', 'lesson']) { if (r.review[k]) rev[k] = r.review[k]; else delete rev[k]; }
    if (r.emoPost.length) patch.emoPost = r.emoPost; else if (cur.emoPost) patch.emoPost = null;
    if (r.discipline != null) patch.discipline = r.discipline; else if (cur.discipline != null) patch.discipline = null;
    if (r.flagsDismissed.length) patch.flagsDismissed = r.flagsDismissed;
    if ('highDuring' in r && (r.highDuring !== (isN(cur.highDuring) ? cur.highDuring : null) || r.lowDuring !== (isN(cur.lowDuring) ? cur.lowDuring : null))) {
      patch.highDuring = r.highDuring; patch.lowDuring = r.lowDuring;
      patch.excursionSource = isN(r.highDuring) || isN(r.lowDuring) ? 'manual' : null;
    }
    if (sugg) patch.gradeAuto = sugg;
    if (r.grade) patch.grade = r.grade;
    if (reviewed) {
      patch.mistakes = r.mistakes;
      if (!patch.grade) patch.grade = sugg || cur.grade || null;
      rev.reviewedAt = nowISO();
      patch.needsReview = false;
    }
    patch.review = Object.keys(rev).length ? rev : null;
    return patch;
  }

  /* ═══ Full trade form ═══════════════════════════════════ */
  let fullOpen = null;   // backdrop of the open full form (one at a time)
  function openAny(entry, prefill) {
    // tolerate open(id) and open({coin, side, …}) — an id-less, type-less object is a prefill, not a trade
    if (typeof entry === 'string' && entry) {
      const e = entryById(entry);
      if (!e) { toast('That trade is not in the current account', 'warn'); return; }
      entry = e;
    }
    if (entry && typeof entry === 'object' && !entry.id && !entry.type) {
      prefill = { ...entry, ...(prefill && typeof prefill === 'object' ? prefill : {}) };
      entry = null;
    }
    if (entry && typeof entry === 'object') {
      if (FLOW_TYPES.includes(entry.type)) return flow(entry.type, entry);
      const raw = entry.id ? entryById(entry.id) : null;
      if (!raw) { toast('That trade is not in the current account', 'warn'); return; }
      entry = raw;   // callers may pass an enriched engine row — always edit the stored entry
      if (entry.deletedAt) { toast('That trade is in the Trash — restore it from Settings → Trash first', 'warn'); return; }
      if (entry.type === 'scale' && entry.parentId && entryById(entry.parentId)) return scaleForm(entry.parentId, entry);
    } else entry = null;
    if (fullOpen && fullOpen.isConnected) {
      toast('Finish or close the trade form that is already open', 'warn');
      const f = fullOpen.querySelector('.modal-body input, .modal-body select'); if (f) f.focus();
      return;
    }
    openForm(entry, normPrefill(prefill));
  }

  function openForm(entry, pre) {
    const isEdit = !!entry, p = newPrefix(), c = ensureC(), fs = fees0(), mode0 = db.mode;
    const base = isEdit ? entry : { side: 'long', strategyId: null, entryAt: nowLocalInput(), market: fs.defaultMarket || 'spot', venue: fs.defaultVenue || '', orderTypeEntry: 'taker', orderTypeExit: 'taker', tags: [], mistakes: [] };
    const d0 = { ...base, ...pre };
    const bal = isEdit ? balanceFor(entry.id) : (c ? c.balance : 0);
    // Calc / prefill sizing: a risk % without an amount sizes the position (never above the cap)
    if (!isN(d0.amount) && isN(pre.riskPct) && isN(d0.entryPrice) && isN(d0.stopPrice) && d0.entryPrice !== d0.stopPrice && bal > 0) {
      d0.amount = sig(bal * Math.min(pre.riskPct, riskCap(d0.strategyId).use) / 100 / Math.abs(d0.entryPrice - d0.stopPrice), 6);
    }
    const mk0 = MARKETS.some(m => m.id === d0.market) ? d0.market : 'spot';
    const advOpen = !!S().advancedFields || mk0 !== 'spot' || (isN(d0.leverage) && d0.leverage > 1) || [d0.plannedEntry, d0.stopFinal, d0.highDuring, d0.lowDuring].some(isN) || !!(d0.shotBefore || d0.shotAfter);
    const ckState = Object.create(null);   // keyed by rule text: a rule named 'constructor' or '__proto__' must not hit Object.prototype
    if (d0.checklist && Array.isArray(d0.checklist.items) && String(d0.checklist.strategyId) === String(d0.strategyId)) for (const it of d0.checklist.items) if (it && !it.auto && it.text) ckState[it.text] = !!it.met;
    // Editing keeps the checklist the trade was taken with (the playbook's rules may have changed since),
    // and an edit that never touches the checklist of a trade logged without one doesn't invent one.
    const ck0 = isEdit && d0.checklist && Array.isArray(d0.checklist.items) ? d0.checklist : null;
    const rulesOf = (sid) => (ck0 && String(ck0.strategyId) === String(sid) ? ck0.items.filter(i => i && !i.auto && i.text).map(i => String(i.text)) : rulesFor(sid));
    let ckTouched = false;
    const gasLegs = {};
    let gasNative = isN(d0.gasNative) ? d0.gasNative : null;
    let root = null, body = null, closeM = null, dirty = false, saving = false, exitAuto = false, done = false, newId = null;
    let sideS, mktS, otInS, otOutS, mmS, intS, confS, tagsP, emoP, rv, shots, chips;
    const schedule = debounce(() => upd(), 60);
    const coinDeb = debounce(() => { if (chips) chips.refresh(true); }, 450);
    const changed = () => { dirty = true; schedule(); };
    const tagGs = tagGroupsFor(d0.tags);
    const sec = (t) => `<div class="form-section">${t}</div>`;
    const btnS = (a, label, title) => `<button type="button" class="btn btn-ghost btn-sm" data-a="${a}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;

    const html = `<div class="tf-form">
      <div class="tf-top">${modeBadge()}<span class="tf-small dim">${isEdit ? 'Editing a saved trade.' : pre._note ? esc(pre._note) : 'Required: coin, entry price and size. Everything else is optional — fill in what helps you learn.'}</span></div>
      <div data-r="dayban" hidden></div>
      ${sec('Setup')}
      <div class="tf-grid">
        <div class="field"><label id="${p}-side-l">Direction</label><div data-r="side" role="group" aria-labelledby="${p}-side-l"></div></div>
        ${fld(p, { k: 'coin', label: 'Coin', cls: 'tf-coin mono', ph: 'e.g. BTC', value: d0.coin || '', attrs: `list="${p}-coins" maxlength="20" spellcheck="false" autocapitalize="characters"` })}
        ${fld(p, { k: 'strategyId', label: 'Setup', type: 'select', opt: true, html: stratOptions(d0.strategyId) })}
      </div>
      <datalist id="${p}-coins">${coinOptions()}</datalist>
      <div data-r="ck"></div>
      <div class="field"><label id="${p}-tags-l">Tags <span class="opt">optional</span></label>${tagGs.length ? `<div data-r="tags" role="group" aria-labelledby="${p}-tags-l"></div>` : '<div class="tf-small dim">No tags yet — add tag groups in Settings → Journal.</div>'}</div>
      ${sec('Entry')}
      <div class="tf-grid">
        ${fld(p, { k: 'entryAt', label: 'Entry time', type: 'dt', value: toLocalInput(d0.entryAt) })}
        ${fld(p, { k: 'entryPrice', label: 'Entry price', type: 'num', ph: '0.00', value: plain(d0.entryPrice), chip: chipHtml('in') })}
        ${fld(p, { k: 'amount', label: 'Size (coins)', type: 'num', ph: '0', value: plain(d0.amount), lbtn: '<button type="button" class="link-btn tf-lbtn" data-a="size" title="Set the size so a stop-out loses exactly your risk %">Size from risk %</button>' })}
        ${fld(p, { k: 'stopPrice', label: 'Stop loss', type: 'num', ph: '0.00', value: plain(d0.stopPrice), hint: S().risk.requireStop ? 'Required by your rules.' : '' })}
        ${fld(p, { k: 'targetPrice', label: 'Target', type: 'num', ph: '0.00', opt: true, value: plain(d0.targetPrice) })}
      </div>
      <div class="calc-strip tf-calc" data-r="calc"></div>
      <div class="tf-small dim" data-r="costnote"></div>
      ${GUARDS_BOX}
      <details class="adv tf-adv"${advOpen ? ' open' : ''}><summary>Advanced — market, leverage, costs, execution</summary><div class="adv-body">
        <div class="tf-grid">
          <div class="field"><label id="${p}-mkt-l">Market</label><div data-r="market" role="group" aria-labelledby="${p}-mkt-l"></div></div>
          ${fld(p, { k: 'venue', label: 'Venue', type: 'select', html: venueOptions(d0.venue || '') })}
          <div class="field" data-show="cex"><label id="${p}-oti-l">Entry order</label><div data-r="otIn" role="group" aria-labelledby="${p}-oti-l"></div></div>
          <div class="field" data-show="cex"><label id="${p}-oto-l">Exit order</label><div data-r="otOut" role="group" aria-labelledby="${p}-oto-l"></div></div>
        </div>
        <div class="tf-stack" data-show="perp">
          <div class="tf-adv-sub">Perpetual futures</div>
          <div class="tf-grid">
            ${fld(p, { k: 'leverage', label: 'Leverage (×)', type: 'num', ph: '1', addon: '×', value: plain(d0.leverage), attrs: 'min="1" max="200"' })}
            <div class="field"><label id="${p}-mm-l">Margin mode</label><div data-r="mm" role="group" aria-labelledby="${p}-mm-l"></div></div>
            ${fld(p, { k: 'mmrPct', label: 'Maintenance margin (%)', type: 'num', ph: '0.5', addon: '%', value: isN(d0.mmr) ? plain(sig(d0.mmr * 100, 6)) : '', hint: 'Tier 1 for BTC/ETH is about 0.4–0.5%.' })}
            ${fld(p, { k: 'funding', label: 'Funding ($)', type: 'num', ph: '0.00', value: plain(d0.funding), hint: '+ = you paid, − = you received.', btn: btnS('fund-est', 'Estimate', 'Estimate from public funding history (needs the exit)') })}
          </div>
          <div class="tf-liq" data-r="liq"></div>
        </div>
        <div class="tf-stack" data-show="dex">
          <div class="tf-adv-sub">DEX swap · PulseChain</div>
          <div class="tf-grid">
            ${fld(p, { k: 'gas', label: 'Gas ($)', type: 'num', ph: '0.00', value: plain(d0.gas) })}
            ${fld(p, { k: 'txHash', label: 'Entry tx hash', cls: 'mono', ph: '0x…', value: d0.txHash || '', attrs: 'maxlength="66" spellcheck="false"', btn: btnS('tx-in', 'Fetch from tx') })}
            ${fld(p, { k: 'txHashExit', label: 'Exit tx hash', cls: 'mono', ph: '0x…', value: d0.txHashExit || '', attrs: 'maxlength="66" spellcheck="false"', btn: btnS('tx-out', 'Fetch from tx') })}
          </div>
        </div>
        <div class="tf-adv-sub">Execution &amp; excursion</div>
        <div class="tf-grid">
          ${fld(p, { k: 'plannedEntry', label: 'Planned entry', type: 'num', ph: '0.00', opt: true, value: plain(d0.plannedEntry) })}
          ${fld(p, { k: 'stopFinal', label: 'Final stop (if moved)', type: 'num', ph: '0.00', opt: true, value: plain(d0.stopFinal), hint: 'Where the stop ended up — moving it away from the entry is a mistake.' })}
          ${fld(p, { k: 'highDuring', label: 'Highest price while open', type: 'num', opt: true, value: plain(d0.highDuring) })}
          ${fld(p, { k: 'lowDuring', label: 'Lowest price while open', type: 'num', opt: true, value: plain(d0.lowDuring), hint: 'High and low give MAE/MFE — how far price went for and against you.' })}
        </div>
        <div class="tf-adv-sub">Screenshot links (older trades)</div>
        <div class="tf-grid2">
          ${fld(p, { k: 'shotBefore', label: 'Before — link', ph: 'https://…', value: d0.shotBefore || '', attrs: 'inputmode="url" spellcheck="false"' })}
          ${fld(p, { k: 'shotAfter', label: 'After — link', ph: 'https://…', value: d0.shotAfter || '', attrs: 'inputmode="url" spellcheck="false"' })}
        </div>
      </div></details>
      ${sec('Psychology')}
      <div class="field"><label id="${p}-emo-l">Emotion before <span class="opt">optional, up to 2</span></label><div data-r="emoPre" role="group" aria-labelledby="${p}-emo-l"></div></div>
      <div class="tf-grid">
        <div class="field"><label id="${p}-int-l">Intensity</label><div data-r="emoInt" role="group" aria-labelledby="${p}-int-l"></div><div class="hint">1 barely noticeable · 3 distracting · 5 controlling my decisions</div></div>
        <div class="field"><label id="${p}-conf-l">Confidence in the setup</label><div data-r="conf" role="group" aria-labelledby="${p}-conf-l"></div><div class="hint">1 low · 5 very high</div></div>
      </div>
      <div class="reading tf-warnread" data-r="emowarn" role="status" hidden></div>
      <div class="tf-grid2">
        ${fld(p, { k: 'thesis', label: 'Why am I taking this?', type: 'area', opt: true, max: 2000, ph: 'One sentence: the setup and what you expect', value: d0.thesis || '' })}
        ${fld(p, { k: 'invalidation', label: 'What proves me wrong?', type: 'area', opt: true, max: 2000, ph: 'The price or event that kills the idea', value: d0.invalidation || '' })}
      </div>
      ${sec('Exit')}
      <div class="tf-grid">
        ${fld(p, { k: 'exitPrice', label: 'Exit price', type: 'num', ph: 'blank while open', value: plain(d0.exitPrice), chip: chipHtml('out') })}
        ${fld(p, { k: 'exitAt', label: 'Exit time', type: 'dt', value: toLocalInput(d0.exitAt), hint: 'Leave blank while the trade is open.' })}
        ${fld(p, { k: 'fees', label: 'Fees ($, both legs)', type: 'num', ph: '0.00', value: plain(d0.fees), lbtn: '<button type="button" class="link-btn tf-lbtn" data-a="fees-est">Use estimate</button>' })}
      </div>
      <div class="tf-plprev" data-r="plprev" aria-live="polite"></div>
      <div class="tf-stack" data-r="revsec" hidden>${sec('Review')}<div class="tf-stack" data-r="review"></div></div>
      ${sec('Screenshots')}
      <div data-r="shots"></div>
      ${sec('Notes')}
      ${fld(p, { k: 'notes', label: 'Notes', type: 'area', opt: true, rows: 3, ph: 'Anything else worth remembering', value: d0.notes || '' })}
    </div>`;
    const foot = `<span class="tf-kbd dim" aria-hidden="true"><kbd>Ctrl</kbd><kbd>Enter</kbd> saves</span><span class="tf-fstat warn-c" data-r="fstat" role="status"></span><span class="sp"></span>
      ${isEdit ? `<button type="button" class="btn btn-quiet btn-sm" data-a="del">${ic('trash', 14)}Delete</button>` : ''}
      <button type="button" class="btn btn-ghost" data-a="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-a="save">${ic('check')}<span>${isEdit ? 'Save changes' : 'Save trade'}</span></button>`;

    modal({
      title: isEdit ? `Edit trade${d0.coin ? ' · ' + d0.coin : ''}` : 'New trade', width: 780, body: html, foot,
      onMount: (el, cm, hook) => { root = el; closeM = cm; body = $('.tf-form', el); fullOpen = el; mount(); hook(() => { if (chips) chips.refresh(false); }); },
      onClose: onClosed,
    });

    function mount() {
      sideS = segX($('[data-r="side"]', body), [{ id: 'long', label: '↗ Long' }, { id: 'short', label: '↘ Short' }], d0.side === 'short' ? 'short' : 'long', changed);
      mktS = segX($('[data-r="market"]', body), MARKETS.map(m => ({ id: m.id, label: m.label })), mk0, () => { dirty = true; upd(); });
      otInS = segX($('[data-r="otIn"]', body), OT, d0.orderTypeEntry === 'maker' ? 'maker' : 'taker', changed);
      otOutS = segX($('[data-r="otOut"]', body), OT, d0.orderTypeExit === 'maker' ? 'maker' : 'taker', changed);
      mmS = segX($('[data-r="mm"]', body), [{ id: 'isolated', label: 'Isolated' }, { id: 'cross', label: 'Cross' }], d0.marginMode === 'cross' ? 'cross' : 'isolated', changed);
      intS = segX($('[data-r="emoInt"]', body), RATE5(INT_TITLES), isN(d0.emoPreInt) ? String(d0.emoPreInt) : null, changed, true);
      confS = segX($('[data-r="conf"]', body), RATE5(CONF_TITLES), isN(d0.confidence) ? String(d0.confidence) : null, changed, true);
      const tg = $('[data-r="tags"]', body);
      tagsP = tg ? picker(tg, tagGs, d0.tags || [], { multi: true, onChange: changed }) : null;
      emoP = picker($('[data-r="emoPre"]', body), [{ items: EMOTIONS_PRE.map(e => ({ id: e.id, label: e.label, tone: e.tone })) }], Array.isArray(d0.emoPre) ? d0.emoPre : [], { multi: true, max: 2, onChange: changed });
      rv = mountReview($('[data-r="review"]', body), p, d0, reviewInfo, changed, { excursion: false, compact: false });
      shots = mountShots($('[data-r="shots"]', body), d0.shots, pre._pending, pre._removed, changed);
      chips = liveChips(body, () => val(body, 'coin'), { in: 'entryPrice', out: 'exitPrice' });
      drawChecklist();
      wire();
      refreshHooks.add(onRefresh);
      upd();
      chips.refresh(true);
      focusFirst();
    }
    function wire() {
      body.addEventListener('input', (ev) => {
        const k = ev.target.dataset ? ev.target.dataset.f : null;
        dirty = true; setFstat('');
        if (k) unmark(body, k);
        if (k === 'coin') coinDeb();
        else if (k === 'exitPrice') exitTyped();
        else if (k === 'exitAt') exitAuto = false;
        schedule();
      });
      body.addEventListener('change', (ev) => {
        const k = ev.target.dataset ? ev.target.dataset.f : null;
        dirty = true;
        if (k === 'strategyId') { unmark(body, k); drawChecklist(); }
        schedule();
      });
      body.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-a]'); if (!b || !body.contains(b)) return;
        const a = b.dataset.a;
        if (a === 'size') sizeFromRisk();
        else if (a === 'fees-est') useFeeEstimate();
        else if (a === 'fund-est') estFunding(b);
        else if (a === 'tx-in') fetchTx('in', b);
        else if (a === 'tx-out') fetchTx('out', b);
        else if (a === 'setup') writeSetup();
      });
      $('[data-a="save"]', root).onclick = doSave;
      $('[data-a="cancel"]', root).onclick = () => closeM();
      const del = $('[data-a="del"]', root); if (del) del.onclick = doDelete;
      root.addEventListener('paste', onPaste);
      // a file dropped anywhere on the form becomes a screenshot (and never navigates the app away)
      root.addEventListener('dragover', (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
      root.addEventListener('drop', (ev) => {
        if (!hasFiles(ev)) return;
        ev.preventDefault();
        if (shots.add([...(ev.dataTransfer.files || [])])) { const s = $('[data-r="shots"]', body); if (s) s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      });
    }
    const setFstat = (t) => { const f = $('[data-r="fstat"]', root); if (f) f.textContent = t; };
    function onPaste(ev) {
      const items = ev.clipboardData && ev.clipboardData.items; if (!items) return;
      const files = [];
      for (const it of Array.from(items)) if (it.kind === 'file' && /^image\//i.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); }
      if (!files.length) return;
      ev.preventDefault();
      if (shots.add(files)) toast(files.length === 1 ? 'Screenshot added — it is stored when you save' : `${files.length} screenshots added — stored when you save`, 'ok');
    }
    // Typing an exit price fills the exit time with "now" (cleared again if the price is removed)
    function exitTyped() {
      const has = val(body, 'exitPrice').trim() !== '', at = q(body, 'exitAt');
      if (!at) return;
      if (has && !at.value) { at.value = nowLocalInput(); exitAuto = true; setHint(body, 'exitAt', 'Set to now — change it if you closed earlier.'); }
      else if (!has && exitAuto) { at.value = ''; exitAuto = false; setHint(body, 'exitAt', 'Leave blank while the trade is open.'); }
    }
    function onRefresh() {
      if (!body || !body.isConnected) return;
      const sel = q(body, 'strategyId');
      if (sel) sel.innerHTML = stratOptions(sidFrom(sel.value));
      drawChecklist(); schedule();
    }

    /* the draft, read from the inputs */
    function collect() {
      const n = (k) => numF(body, k), s = (k) => strF(body, k);
      const market = mktS ? mktS.value : mk0, perp = market === 'perp', dex = market === 'dex';
      const mmrPct = n('mmrPct');
      // a cost this market's fields don't show (funding / gas on an imported row) is kept, never silently zeroed —
      // unless the user switched the market away
      const hiddenCost = (k, shown) => (shown ? n(k) : isEdit && market === mk0 && isN(entry[k]) ? entry[k] : null);
      const d = {
        side: sideS ? sideS.value : 'long', coin: (s('coin') || '').toUpperCase() || null, strategyId: sidFrom(val(body, 'strategyId')),
        entryAt: val(body, 'entryAt') || null, entryPrice: n('entryPrice'), amount: n('amount'), stopPrice: n('stopPrice'), targetPrice: n('targetPrice'),
        exitPrice: n('exitPrice'), exitAt: val(body, 'exitAt') || null, fees: n('fees'),
        market, venue: s('venue'),
        orderTypeEntry: dex || !otInS ? null : otInS.value, orderTypeExit: dex || !otOutS ? null : otOutS.value,
        leverage: perp ? n('leverage') : null, marginMode: perp && mmS ? mmS.value : null, mmr: perp && isN(mmrPct) && mmrPct >= 0 && mmrPct < 50 ? mmrPct / 100 : null,
        funding: hiddenCost('funding', perp),
        gas: hiddenCost('gas', dex), gasNative: dex ? gasNative : null, txHash: dex ? s('txHash') : null, txHashExit: dex ? s('txHashExit') : null, chain: dex ? (d0.chain || 'pulsechain') : null,
        plannedEntry: n('plannedEntry'), stopFinal: n('stopFinal'), highDuring: n('highDuring'), lowDuring: n('lowDuring'),
        shotBefore: s('shotBefore'), shotAfter: s('shotAfter'),
        tags: tagsP ? tagsP.value : [], emoPre: emoP ? emoP.value : [],
        emoPreInt: intS && intS.value ? +intS.value : null, confidence: confS && confS.value ? +confS.value : null,
        thesis: s('thesis'), invalidation: s('invalidation'), notes: s('notes'),
        // a blank fee is auto-estimated only when this save closes the trade — never on an old closed row
        autoFee: !isEdit || !isN(entry.exitPrice),
      };
      const ck = checklistOf(d);
      const keepNoCk = isEdit && !ck0 && !ckTouched && String(d.strategyId == null ? '' : d.strategyId) === String(entry.strategyId == null ? '' : entry.strategyId);
      d.checklist = keepNoCk ? null : ck ? ck.checklist : null;
      d.rulesMetPct = keepNoCk ? (isN(entry.rulesMetPct) ? entry.rulesMetPct : null) : ck ? ck.pct : null;
      if (rv) Object.assign(d, rv.peek());
      return d;
    }
    function reviewInfo() {
      const d = collect(), x = derive(d, bal);
      if (isEdit && Array.isArray(entry.violations)) d.violations = entry.violations;   // overrides cap the suggested grade
      return { draft: d, id: isEdit ? entry.id : null, riskPct: x.riskPct, R: isN(x.R) ? x.R : null, win: isN(x.net) && x.net > 0, plannedR: x.rr };
    }

    /* pre-trade checklist: the setup's rules (ticked by hand) + universal risk rules (auto) */
    function checklistOf(d) {
      if (!d.strategyId) return null;
      const x = derive(d, bal);
      const items = rulesOf(d.strategyId).map(t => ({ text: t, met: !!ckState[t] })).concat(autoChecks(d, x).filter(a => !a.na).map(({ na, ...a }) => a));
      const met = items.filter(i => i.met).length;
      return { checklist: { strategyId: d.strategyId, items }, pct: items.length ? met / items.length : null, met, total: items.length };
    }
    function drawChecklist() {
      const wrap = $('[data-r="ck"]', body); if (!wrap) return;
      const sid = sidFrom(val(body, 'strategyId'));
      if (!sid) {
        wrap.innerHTML = `<div class="tf-ckempty dim">Pick a setup from your Playbook to get its pre-trade checklist.${activeStrats().length ? '' : ' <button type="button" class="link-btn" data-a="setup">Write your first setup</button>'}</div>`;
        return;
      }
      const rules = rulesOf(sid);
      wrap.innerHTML = `<div class="tf-ckwrap"><div class="tf-ckhead"><span>Checklist · ${esc(stratName(sid))}</span><span class="tf-ckpct" data-r="ckpct"></span></div>
        ${rules.length ? `<div class="checklist">${rules.map((t, i) => `<label class="ck${ckState[t] ? ' done' : ''}"><input type="checkbox" class="sr-only" data-ck="${i}"${ckState[t] ? ' checked' : ''}><span class="cb" aria-hidden="true">${ic('check', 12)}</span><span class="ct">${esc(t)}</span></label>`).join('')}</div>`
          : ck0 && String(ck0.strategyId) === String(sid) ? '<div class="tf-ckempty dim">No setup rules were recorded when this trade was logged.</div>'
            : '<div class="tf-ckempty dim">This setup has no checklist yet. <button type="button" class="link-btn" data-a="setup">Add rules in the Playbook</button></div>'}
        <div class="checklist" data-r="ckauto"></div>
        <div class="tf-small warn-c" data-r="ckmsg" hidden></div></div>`;
      wrap.querySelectorAll('[data-ck]').forEach(cb => cb.onchange = () => {
        ckState[rules[+cb.dataset.ck]] = cb.checked; ckTouched = true;
        cb.closest('.ck').classList.toggle('done', cb.checked);
        changed();
      });
    }
    function drawAutoChecks(d, x) {
      const box = $('[data-r="ckauto"]', body); if (!box || !d.strategyId) return;
      setHtml(box, autoChecks(d, x).map(a => `<div class="ck tf-auto ${a.na ? 'na' : a.met ? 'done' : 'fail'}"><span class="cb" aria-hidden="true">${ic(a.na ? 'minus' : a.met ? 'check' : 'x', 12)}</span><span class="ct">${esc(a.text)}${a.na ? ' <span class="dim">— add a target to check it</span>' : ''}<span class="sr-only">: ${a.na ? 'not checked, no target' : a.met ? 'met' : 'not met'}</span></span><span class="tf-autotag">auto</span></div>`).join(''));
      const ck = checklistOf(d), pctEl = $('[data-r="ckpct"]', body), msg = $('[data-r="ckmsg"]', body);
      if (!ck) return;
      if (pctEl) { pctEl.textContent = `${ck.met}/${ck.total} met`; pctEl.classList.toggle('ok', ck.met === ck.total); }
      if (msg) { const un = ck.total - ck.met; msg.hidden = !un; msg.textContent = un ? `${un} of ${ck.total} rules unmet — this is a B/C setup. You can still take it; the journal will show what it costs.` : ''; }
    }

    /* every live readout, from one draft */
    function upd() {
      if (!body || !body.isConnected) return;
      const d = collect(), x = derive(d, bal), rc = riskCap(d.strategyId), rules = S().risk || {};
      const closed = isN(d.exitPrice);
      body.querySelectorAll('[data-show]').forEach(n => {
        const s = n.dataset.show;
        n.hidden = s === 'perp' ? d.market !== 'perp' : s === 'dex' ? d.market !== 'dex' : s === 'cex' ? d.market === 'dex' : false;
      });
      setHtml($('[data-r="calc"]', body), calcHtml(x, rc, rules));
      setHtml($('[data-r="costnote"]', body), esc(x.fr.label));
      const sb = $('[data-a="size"]', body); if (sb) sb.textContent = `Size from ${rc.use}% risk`;
      const fi = q(body, 'fees'); if (fi) fi.placeholder = x.feeEst != null ? `est. ${moneyTxt(cents(x.feeEst))}` : '0.00';
      setHint(body, 'fees', x.feeEst == null ? '' : isN(d.fees) ? `Preset estimate: ${moneyTxt(cents(x.feeEst))}.` : closed && autoFillOn() && d.autoFee ? `Blank = the ${moneyTxt(cents(x.feeEst))} estimate is saved (paper).` : `Blank = no fees recorded. Paste the real fee from your exchange${closed ? ` — or use the ${moneyTxt(cents(x.feeEst))} estimate` : ''}.`);
      setHint(body, 'amount', x.notional != null ? `≈ ${moneyTxt(x.notional)} position${isN(x.effLev) && x.effLev >= 1 ? ` · ${x.effLev.toFixed(1)}× your account` : ''}` : '');
      setHint(body, 'plannedEntry', x.slip != null ? `Slippage ${fmtPct(x.slip, { sign: true, dp: 2 })}${x.slip > 0 ? ' — worse than planned' : x.slip < 0 ? ' — better than planned' : ''}` : 'The price you meant to get — shows your slippage.');
      setHtml($('[data-r="liq"]', body), d.market === 'perp' ? liqHtml(d, x) : '');
      const g = guardCheck({ ...d, id: isEdit ? entry.id : null, isNew: !isEdit, balance: bal });
      // no "missing stop" alarm on an empty form — it appears once there is an entry price
      const gShown = isN(d.entryPrice) || isEdit ? g : { ...g, items: g.items.filter(i => i.rule !== 'stop') };
      setHtml($('[data-r="guards"]', body), guardHtml(gShown)); sayGuards(body, gShown);
      const ban = $('[data-r="dayban"]', body), bh = isEdit ? '' : dayBanner(g);
      setHtml(ban, bh); ban.hidden = !bh;
      setHtml($('[data-r="plprev"]', body), plPreview(x));
      $('[data-r="revsec"]', body).hidden = !closed;
      if (closed && rv) rv.update();
      drawAutoChecks(d, x);
      const ew = $('[data-r="emowarn"]', body), eh = emoWarnHtml(d, isEdit ? entry.id : null);
      setHtml(ew, eh); ew.hidden = !eh;
      const fb = $('[data-a="fund-est"]', body); if (fb && !fb.dataset.busy) fb.disabled = !(closed && d.exitAt);
    }

    /* actions */
    function sizeFromRisk() {
      const d = collect(), rc = riskCap(d.strategyId);
      if (!isN(d.entryPrice) || !isN(d.stopPrice) || d.entryPrice === d.stopPrice) {
        const k = isN(d.entryPrice) ? 'stopPrice' : 'entryPrice';
        mark(body, k, 'Enter the entry and stop first — the size comes from the distance between them.');
        const el = q(body, k); if (el) el.focus();
        return;
      }
      if (!(bal > 0)) { toast('Set a starting balance first (Settings → Account)', 'warn'); return; }
      setVal(body, 'amount', plain(sig(bal * rc.use / 100 / Math.abs(d.entryPrice - d.stopPrice), 6)));
      unmark(body, 'amount'); dirty = true; upd();
      setHint(body, 'amount', `Sized so a stop-out loses ${rc.use}% (${moneyTxt(bal * rc.use / 100)}).`);
    }
    function useFeeEstimate() {
      const x = derive(collect(), bal);
      if (x.feeEst == null) { toast('Enter the entry price and size first', 'warn'); return; }
      setVal(body, 'fees', plain(cents(x.feeEst))); unmark(body, 'fees'); dirty = true; upd();
    }
    async function estFunding(btn) {
      const d = collect();
      if (!isN(d.exitPrice) || !d.exitAt) { toast('Add the exit first — funding is estimated over the time the trade was open', 'warn'); return; }
      if (!d.coin || !isN(d.amount) || !isN(d.entryPrice)) { toast('Enter the coin, entry and size first', 'warn'); return; }
      if (!hasMarket() || typeof Market.funding !== 'function') { toast('Market data is not available', 'warn'); return; }
      btn.disabled = true; btn.dataset.busy = '1'; btn.textContent = 'Estimating…';
      const r = await Promise.resolve(call(() => Market.funding({ coin: d.coin, fromMs: Date.parse(d.entryAt), toMs: Date.parse(d.exitAt), side: d.side, qty: d.amount, price: d.entryPrice }), null)).catch(() => null);
      if (!btn.isConnected) return;
      delete btn.dataset.busy; btn.disabled = false; btn.textContent = 'Estimate';
      if (!r || !isN(r.usd)) { toast(navigator.onLine === false ? 'Offline — enter the funding from your exchange history' : `No funding history found for ${d.coin}`, 'warn'); return; }
      setVal(body, 'funding', plain(cents(r.usd))); unmark(body, 'funding');
      setHint(body, 'funding', `≈ ${plural(r.n || 0, 'settlement')} · ${r.source || 'estimate'}${r.partial ? ' · history only partly covers this trade' : ''}. Paste the exact figure from your exchange if you have it.`);
      changed();
    }
    async function fetchTx(which, btn) {
      const k = which === 'out' ? 'txHashExit' : 'txHash', h = val(body, k).trim();
      if (!HASH_RE.test(h)) { mark(body, k, 'Paste the full transaction hash: 0x followed by 64 characters.'); const el = q(body, k); if (el) el.focus(); return; }
      if (!hasMarket() || typeof Market.tx !== 'function') { toast('Chain lookups are not available', 'warn'); return; }
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Fetching…';
      const r = await Promise.resolve(call(() => Market.tx(h), null)).catch(() => null);
      if (!btn.isConnected) return;
      btn.disabled = false; btn.textContent = label;
      if (!r) { toast(navigator.onLine === false ? 'Offline — enter the gas by hand' : 'Couldn’t find that transaction on PulseChain', 'warn'); return; }
      gasLegs[which] = { usd: isN(r.gasUsd) ? r.gasUsd : null, native: isN(r.gasNative) ? r.gasNative : null };
      const legs = Object.values(gasLegs);
      if (legs.some(l => isN(l.usd))) setVal(body, 'gas', plain(sig(legs.reduce((s, l) => s + (l.usd || 0), 0), 6)));
      if (legs.some(l => isN(l.native))) gasNative = sig(legs.reduce((s, l) => s + (l.native || 0), 0), 8);
      const when = isN(r.at) ? fmtDateTime(r.at) : '';
      setHint(body, k, `${r.ok === false ? 'This transaction failed on-chain. ' : r.pending ? 'Still pending. ' : ''}${isN(r.gasNative) ? `Gas ${fmtNum(r.gasNative, 2)} PLS` : 'Gas unknown'}${isN(r.gasUsd) ? ` ≈ ${moneyTxt(r.gasUsd)}` : ''}${when ? ` · mined ${when}` : ''}`, r.ok === false ? 'warn' : '');
      if (which === 'out' && isN(r.at) && !val(body, 'exitAt')) { setVal(body, 'exitAt', nowLocalInput(new Date(r.at))); exitAuto = false; }
      changed();
    }
    function writeSetup() {
      const sid = sidFrom(val(body, 'strategyId'));
      if (typeof Discipline !== 'undefined' && Discipline && typeof Discipline.editStrategy === 'function') call(() => Discipline.editStrategy(sid || null));
      else toast('Open Playbook to write your setups', 'warn');
    }
    function focusFirst() {
      const k = ['coin', 'entryPrice', 'amount'].find(f => !val(body, f).trim());
      if (k) setTimeout(() => { const el = q(body, k); if (el && el.isConnected) el.focus({ preventScroll: true }); }, 60);
    }

    /* save */
    function validate(d) {
      clearMarks(body);
      const errs = badNumbers(body);
      // a v1 / hand-typed coin such as "PLSX/WPLS" stays editable as long as it isn't changed
      const coin0 = isEdit ? String(entry.coin || '').toUpperCase().trim() : null;
      if (!d.coin) errs.push(['coin', 'Enter the coin, e.g. BTC.']);
      else if (!COIN_RE.test(d.coin) && d.coin !== coin0) errs.push(['coin', 'Letters and numbers only (up to 20), e.g. BTC or PLSX.']);
      if (!d.entryAt || !isFinite(Date.parse(d.entryAt))) errs.push(['entryAt', 'Pick the date and time you got in.']);
      else if (futureT(d.entryAt) && (!isEdit || d.entryAt !== toLocalInput(entry.entryAt))) errs.push(['entryAt', 'That’s in the future — use the time you actually got in.']);
      if (!isN(d.entryPrice) || d.entryPrice <= 0) errs.push(['entryPrice', 'Enter the price you got in at.']);
      if (!isN(d.amount) || d.amount <= 0) errs.push(['amount', 'Enter how many coins you bought or sold (more than 0).']);
      sideErrors(d, errs);
      exitErrors(d, errs);
      if (isN(d.exitPrice) && futureT(d.exitAt) && (!isEdit || d.exitAt !== toLocalInput(entry.exitAt))) errs.push(['exitAt', 'That’s in the future — use the time you actually got out.']);
      if (d.market === 'perp') {
        if (isN(d.leverage) && (d.leverage < 1 || d.leverage > 200)) errs.push(['leverage', 'Leverage must be between 1× and 200×.']);
        const m = numF(body, 'mmrPct'); if (isN(m) && (m < 0 || m >= 50)) errs.push(['mmrPct', 'Maintenance margin must be 0–50%.']);
      }
      if (d.market === 'dex') for (const k of ['txHash', 'txHashExit']) if (d[k] && !HASH_RE.test(d[k])) errs.push([k, 'A tx hash is 0x followed by 64 hex characters.']);
      if (isN(d.plannedEntry) && d.plannedEntry <= 0) errs.push(['plannedEntry', 'The planned price must be above 0.']);
      if (isN(d.stopFinal) && d.stopFinal <= 0) errs.push(['stopFinal', 'The stop must be above 0.']);
      excursionErrors(d, errs);
      for (const k of ['shotBefore', 'shotAfter']) if (d[k] && !safeUrl(d[k])) errs.push([k, 'Use a full link starting with https://']);
      const seen = new Set(), uniq = errs.filter(([k]) => (seen.has(k) ? false : (seen.add(k), true)));
      showErrors(body, uniq);
      setFstat(uniq.length ? (uniq.length === 1 ? '1 field needs attention' : `${uniq.length} fields need attention`) : '');
      return !uniq.length;
    }
    // An exchange-provided liquidation price (imports) beats our estimate while the position itself is unchanged
    function liqFor(d, x) {
      const keep = isEdit && isN(entry.liqPrice) && d.market === 'perp';
      const norm = (o, k) => (k === 'side' ? (o.side === 'short' ? 'short' : 'long') : k === 'marginMode' ? (o.marginMode === 'cross' ? 'cross' : 'isolated') : o[k] == null ? null : o[k]);
      const same = keep && ['side', 'entryPrice', 'amount', 'leverage', 'marginMode', 'mmr'].every(k => norm(d, k) === norm(entry, k));
      return same ? entry.liqPrice : x.liq ? sig(x.liq.price, 8) : keep ? entry.liqPrice : null;
    }
    // viol: the overrides accepted for this save (a new trade) — they make the auto grade a C
    function buildFields(d, x, viol) {
      const closed = isN(d.exitPrice);
      const f = {
        coin: d.coin, side: d.side, strategyId: d.strategyId || null,
        entryAt: keepTime(isEdit ? entry.entryAt : null, d.entryAt), entryPrice: d.entryPrice, amount: d.amount,
        stopPrice: d.stopPrice, targetPrice: d.targetPrice,
        exitPrice: closed ? d.exitPrice : null, exitAt: closed ? keepTime(isEdit ? entry.exitAt : null, d.exitAt) : null,
        fees: isN(d.fees) ? d.fees : closed && autoFillOn() && d.autoFee && x.feeEst != null ? cents(x.feeEst) : null,
        funding: d.funding, gas: d.gas, gasNative: d.gasNative, txHash: d.txHash, txHashExit: d.txHashExit, chain: d.chain,
        market: d.market, venue: d.venue, leverage: d.leverage, marginMode: d.marginMode, mmr: d.mmr,
        liqPrice: liqFor(d, x),
        orderTypeEntry: d.orderTypeEntry, orderTypeExit: d.orderTypeExit,
        plannedEntry: d.plannedEntry, stopFinal: d.stopFinal, highDuring: d.highDuring, lowDuring: d.lowDuring,
        shotBefore: d.shotBefore, shotAfter: d.shotAfter,
        tags: d.tags, emoPre: d.emoPre.length ? d.emoPre : null, emoPreInt: d.emoPreInt, confidence: d.confidence,
        thesis: d.thesis, invalidation: d.invalidation, notes: d.notes,
        checklist: d.checklist, rulesMetPct: isN(d.rulesMetPct) ? Math.round(d.rulesMetPct * 1000) / 1000 : null,
      };
      // the risk cap in force when the trade was taken — an edit keeps its stamp unless the size or stop changed
      if (!isEdit || !sameN(d.amount, entry.amount) || !sameN(d.stopPrice, entry.stopPrice)) f.riskCapPct = riskCap(d.strategyId).cap;
      if (isN(f.highDuring) || isN(f.lowDuring)) { if (!isEdit || f.highDuring !== entry.highDuring || f.lowDuring !== entry.lowDuring) f.excursionSource = 'manual'; }
      else if (isEdit && entry.excursionSource) f.excursionSource = null;
      if (closed) {
        const r = rv.peek(), reviewed = r.mistakes.length > 0, sugg = viol && viol.length && rv.suggested() ? 'C' : rv.suggested();
        const rev = { ...((isEdit && entry.review) || {}) };
        for (const k of ['followedPlan', 'wentWell', 'improve', 'lesson']) { if (r.review[k]) rev[k] = r.review[k]; else delete rev[k]; }
        f.mistakes = r.mistakes;
        f.emoPost = r.emoPost.length ? r.emoPost : null;
        f.discipline = r.discipline;
        f.flagsDismissed = r.flagsDismissed.length ? r.flagsDismissed : null;
        f.gradeAuto = sugg || null;
        f.grade = r.grade || (reviewed ? sugg : null) || null;
        if (reviewed) { if (!rev.reviewedAt) rev.reviewedAt = nowISO(); f.needsReview = false; }
        f.review = Object.keys(rev).length ? rev : null;
      } else if (!isEdit) f.mistakes = [];
      return f;
    }
    async function doSave() {
      if (saving || done) return;
      upd();   // flush pending readouts so the grade suggestion matches what is on screen
      const d = collect();
      if (!validate(d)) return;
      if (db.mode !== mode0) { toast('You switched accounts while this form was open — close it and log the trade again', 'err'); return; }
      if (isEdit && !entryById(entry.id)) { toast('This trade is no longer in the current account', 'err'); return; }
      if (isEdit && !liveById(entry.id)) { toast(TRASHED, 'warn'); return; }
      const x = derive(d, bal);
      let viol = [];
      if (!isEdit) {
        const g = guardCheck({ ...d, isNew: true, balance: bal });
        if (g.state === 'stop') {
          saving = true;   // one interrupt at a time (a fast second Ctrl+Enter must not stack another)
          const ov = await confirmOverride(g, `${d.coin} ${d.side === 'short' ? 'short' : 'long'}`);
          saving = false;
          if (!ov) return;   // "Don't take this trade" — the form stays open
          viol = ov.violations;
        }
      }
      if (done || !root.isConnected || modeMoved(mode0)) return;   // the account may have changed during the dialog
      saving = true;
      const btn = $('[data-a="save"]', root), lbl = btn ? btn.querySelector('span') : null, txt = lbl ? lbl.textContent : '';
      if (btn) btn.disabled = true; if (lbl) lbl.textContent = 'Saving…';
      try {
        // a retry after a failed save keeps the same new id (its screenshots were stored under it)
        const id = isEdit ? entry.id : newId || (newId = uid());
        const sh = await shots.commit(id);
        if (db.mode !== mode0 || (isEdit && !entryById(id))) { toast('The account changed while saving — the trade was not saved', 'err'); return; }
        if (isEdit && !liveById(id)) { toast(TRASHED, 'warn'); return; }
        const f = buildFields(d, x, viol);
        f.shots = sh.list.length ? sh.list : null;
        const tx = txn();
        if (isEdit) {
          tx.touch(id);
          updateEntry(id, f);
          // scale legs follow the parent's coin / side / setup (the engine prices each leg with its own side)
          for (const e2 of acct().entries) if (e2.parentId === id && (e2.coin !== f.coin || e2.side !== f.side || e2.strategyId !== f.strategyId)) { tx.touch(e2.id); Object.assign(e2, { coin: f.coin, side: f.side, strategyId: f.strategyId, updatedAt: nowISO() }); }
        } else {
          addEntry(lean({ id, type: 'trade', ...f, violations: viol.length ? viol : null }));
          tx.add(id);
          logOverrides(viol, id);
        }
        const s0 = saveN;
        // not written to disk (save() showed why): undo it and keep the form open for another try
        if (!commit(isEdit ? 'Trade updated' : 'Trade saved', 'ok')) { tx.undo(); return; }
        done = true;
        closeM('saved');
        // a failed save (storage full / blocked) keeps the old entry on disk — and the images it still points to
        if (saveN > s0) for (const mid of shots.removedIds()) delMedia(mid);
        if (sh.failed) toast(`${plural(sh.failed, 'screenshot')} couldn’t be stored — try adding ${sh.failed === 1 ? 'it' : 'them'} again`, 'warn');
        if (isN(f.exitPrice)) processToast(id);
      } catch (e) {
        console.error('[tradeform] save', e);
        toast('Could not save the trade — ' + (e && e.message ? e.message : 'unknown error'), 'err');
      } finally {
        saving = false;
        if (btn && btn.isConnected) { btn.disabled = false; if (lbl) lbl.textContent = txt; }
      }
    }
    function doDelete() { if (!isEdit || saving) return; done = true; closeM('deleted'); softDelete([entry.id], 'Moved the trade to Trash'); }
    // Esc / Cancel with unsaved input: nothing is lost — the toast reopens the form as it was
    function onClosed(v) {
      if (fullOpen === root) fullOpen = null;
      refreshHooks.delete(onRefresh);
      if (!shots) return;
      if (saving || done || v === 'saved' || v === 'deleted' || !dirty || !body) { shots.dispose(); return; }
      const snap = { ...collect(), shots: shots.kept(), _pending: shots.pending(), _removed: shots.removedIds() };
      shots.dispose();
      const reopen = () => {
        if (!isEdit) { openAny(null, snap); return; }
        // never turn an edit into a NEW trade: the original must still be in this account
        const e = entryById(entry.id);
        if (!e || db.mode !== mode0) { toast('That trade is no longer in the current account', 'warn'); return; }
        openAny(e, snap);
      };
      toast('Closed without saving', 'warn', { ms: 10000, action: { label: 'Reopen', run: reopen } });
    }
  }

  /* ── Shared bits for the smaller dialogs and the drawer ── */
  // Any id (trade or scale leg) → its engine group
  function groupFor(id) {
    if (!id || !ensureC()) return null;
    return groupById(id) || groupOfRow(id) || null;
  }
  const sumOf = (list, f) => list.reduce((s, x) => { const v = f(x); return s + (isN(v) ? v : 0); }, 0);
  // quantity-weighted average of a price field over legs
  function avgPx(legs, k) {
    let qt = 0, v = 0;
    for (const x of legs) if (isN(x.amount) && x.amount > 0 && isN(x[k])) { qt += x.amount; v += x.amount * x[k]; }
    return qt > 0 ? v / qt : null;
  }
  const tradeTitle = (e) => `${(e && e.coin) || '?'} ${e && e.side === 'short' ? 'short' : 'long'}`;
  const whenTxt = (s) => { const t = Date.parse(s || ''); return isFinite(t) ? fmtDateTime(t) : '—'; };
  const secH = (t) => `<div class="form-section">${esc(t)}</div>`;
  const headHtml = (e, extra) => `<div class="tf-closehead">${coinIcon(e.coin)}<b>${esc(e.coin || '?')}</b>${sideBadge(e.side)}${extra || ''}</div>`;
  const isRev = (e) => (hasMetrics() ? Metrics.isReviewed(e) : Array.isArray(e.mistakes) && e.mistakes.length > 0);
  const groupPrices = (g) => (g ? g.portions.flatMap(x => [x.entryPrice, x.exitPrice]).filter(isN) : []);
  const footSave = (label, extra) => `<span class="tf-kbd dim" aria-hidden="true"><kbd>Ctrl</kbd><kbd>Enter</kbd> saves</span><span class="sp"></span>${extra || ''}
    <button type="button" class="btn btn-ghost" data-a="cancel">Cancel</button><button type="button" class="btn btn-primary" data-a="save">${ic('check')}<span>${esc(label)}</span></button>`;
  const modeMoved = (mode0) => { if (db.mode === mode0) return false; toast('You switched accounts while this was open — close it and try again', 'err'); return true; };
  const firstErr = (errs) => { const seen = new Set(); return errs.filter(([k]) => (seen.has(k) ? false : (seen.add(k), true))); };
  // Closed-trade result line — sign + colour + glyph, never colour alone
  function resultHtml(g) {
    if (!g || !g.closed) return '';
    return `<div class="tf-result"><span>Result</span><b class="tf-rv ${plClass(g.netPL)}">${gl(g.netPL)}${money(g.netPL, { sign: true })}</b>
      <b class="tf-rv ${plClass(g.R)}">${g.R != null ? fmtR(g.R) : 'R —'}</b>
      ${isN(g.changePct) ? `<span class="${plClass(g.changePct)}">${fmtPct(g.changePct, { sign: true, dp: 2 })}</span><span class="dim">of the account</span>` : ''}
      <span class="sp"></span>${statusBadge(g)}</div>`;
  }
  // The plan written at entry, shown again while reviewing
  function planReadHtml(e) {
    const out = [];
    if (e.thesis) out.push(`<b>Your reason:</b> ${esc(e.thesis)}`);
    if (e.invalidation) out.push(`<b>Wrong if:</b> ${esc(e.invalidation)}`);
    return out.length ? `<div class="reading tf-small">${out.join('<br>')}</div>` : '';
  }
  // Review context for a closed group: the stored parent entry + group-level risk and R
  function infoForGroup(id) {
    const g = groupFor(id), raw = g ? entryById(g.trade.id) : null;
    return g && raw ? { ...groupInfo(g), draft: raw } : {};
  }
  function lastTrade() { const l = liveEntries().filter(e => e.type === 'trade'); return l.length ? Engine.sortEntries(l).pop() : null; }

  /* ═══ Quick log ═════════════════════════════════════════ */
  // Coin, side, entry, stop and size (or risk %) — saved with needsReview so it lands in the review queue.
  const QS_KEY = 'cj.tf.qsize';
  function quick() {
    if (fullOpen && fullOpen.isConnected) { toast('Finish or close the trade form that is already open', 'warn'); return; }
    const p = newPrefix(), c = ensureC(), fs = fees0(), mode0 = db.mode, bal = c ? c.balance : 0;
    const mkt = MARKETS.some(m => m.id === fs.defaultMarket) ? fs.defaultMarket : 'spot';
    // most beginners trade one or two setups — start from the last one used (still visible, still editable)
    const last = lastTrade();
    const sid0 = last && last.strategyId && activeStrats().some(s => String(s.id) === String(last.strategyId)) ? last.strategyId : null;
    let sizeMode = 'qty';
    try { if (localStorage.getItem(QS_KEY) === 'risk') sizeMode = 'risk'; } catch (e) { /* storage blocked — default */ }
    let root = null, body = null, closeM = null, sideS = null, chips = null, saving = false, done = false;
    const schedule = debounce(() => upd(), 60);
    const cap0 = riskCap(sid0).use;
    const html = `<div class="tf-form tf-quick">
      <div class="tf-top">${modeBadge()}<span class="tf-small dim">Log it in seconds — it goes to your review queue so you can add the details later.</span></div>
      <div data-r="dayban" hidden></div>
      <div class="tf-grid">
        <div class="field"><label id="${p}-side-l">Direction</label><div data-r="side" role="group" aria-labelledby="${p}-side-l"></div></div>
        ${fld(p, { k: 'coin', label: 'Coin', cls: 'tf-coin mono', ph: 'e.g. BTC', attrs: `list="${p}-coins" maxlength="20" spellcheck="false" autocapitalize="characters"` })}
      </div>
      <datalist id="${p}-coins">${coinOptions()}</datalist>
      <div class="tf-grid">
        ${fld(p, { k: 'entryPrice', label: 'Entry price', type: 'num', ph: '0.00', chip: chipHtml('in') })}
        ${fld(p, { k: 'stopPrice', label: 'Stop loss', type: 'num', ph: '0.00', hint: S().risk.requireStop ? 'Required by your rules.' : '' })}
      </div>
      <div class="field"><label id="${p}-sz-l">Enter the size as</label><div class="sm inline" data-r="sizemode" role="group" aria-labelledby="${p}-sz-l"></div></div>
      <div class="tf-grid">
        ${fld(p, { k: 'amount', label: 'Size (coins)', type: 'num', ph: '0' })}
        ${fld(p, { k: 'riskPct', label: 'Risk (% of account)', type: 'num', ph: String(cap0), addon: '%', value: plain(cap0) })}
        ${fld(p, { k: 'strategyId', label: 'Setup', type: 'select', opt: true, html: stratOptions(sid0) })}
      </div>
      <div class="tf-qcalc" data-r="qcalc"></div>
      ${GUARDS_BOX}
    </div>`;
    const foot = `<button type="button" class="link-btn" data-a="full">Open full form</button><span class="sp"></span>
      <button type="button" class="btn btn-ghost" data-a="cancel">Cancel</button><button type="button" class="btn btn-primary" data-a="save">${ic('check')}<span>Log trade</span></button>`;

    modal({
      title: 'Quick log', width: 560, body: html, foot,
      onMount: (el, cm, hook) => {
        root = el; closeM = cm; body = $('.tf-form', el);
        sideS = segX($('[data-r="side"]', body), [{ id: 'long', label: '↗ Long' }, { id: 'short', label: '↘ Short' }], 'long', schedule);
        segX($('[data-r="sizemode"]', body), [{ id: 'qty', label: 'Coins' }, { id: 'risk', label: 'Risk %' }], sizeMode, (v) => {
          sizeMode = v === 'risk' ? 'risk' : 'qty';
          try { localStorage.setItem(QS_KEY, sizeMode); } catch (e) { /* ok */ }
          unmark(body, 'amount'); unmark(body, 'riskPct'); upd();
        });
        chips = liveChips(body, () => val(body, 'coin'), { in: 'entryPrice' });
        hook(() => chips.refresh(false));
        const coinDeb = debounce(() => chips.refresh(true), 450);
        body.addEventListener('input', (ev) => { const k = ev.target.dataset ? ev.target.dataset.f : null; if (k) unmark(body, k); if (k === 'coin') coinDeb(); schedule(); });
        body.addEventListener('change', () => schedule());
        $('[data-a="save"]', el).onclick = doSave;
        $('[data-a="cancel"]', el).onclick = () => cm();
        $('[data-a="full"]', el).onclick = toFull;
        upd();
        setTimeout(() => { const f = q(body, 'coin'); if (f && f.isConnected) f.focus({ preventScroll: true }); }, 60);
      },
    });

    function draft() {
      const entry = numF(body, 'entryPrice'), stop = numF(body, 'stopPrice'), riskPct = sizeMode === 'risk' ? numF(body, 'riskPct') : null;
      let amount = sizeMode === 'qty' ? numF(body, 'amount') : null;
      if (sizeMode === 'risk' && isN(riskPct) && riskPct > 0 && isN(entry) && isN(stop) && entry !== stop && bal > 0) amount = sig(bal * riskPct / 100 / Math.abs(entry - stop), 6);
      return {
        side: sideS ? sideS.value : 'long', coin: (strF(body, 'coin') || '').toUpperCase() || null, strategyId: sidFrom(val(body, 'strategyId')),
        entryAt: nowLocalInput(), entryPrice: entry, stopPrice: stop, amount, riskPct,
        market: mkt, venue: fs.defaultVenue || null, orderTypeEntry: mkt === 'dex' ? null : 'taker', orderTypeExit: mkt === 'dex' ? null : 'taker',
      };
    }
    function upd() {
      if (!body || !body.isConnected) return;
      const d = draft(), x = derive(d, bal), rc = riskCap(d.strategyId), maxC = S().risk.maxCostR;
      const fa = q(body, 'amount'), fr = q(body, 'riskPct');
      if (fa) fa.closest('.field').hidden = sizeMode !== 'qty';
      if (fr) fr.closest('.field').hidden = sizeMode !== 'risk';
      setHint(body, 'riskPct', `Your cap is ${rc.use}%${rc.ramp ? ` (live ramp stage ${rc.stage}/4)` : ''}. The size comes from the entry-to-stop distance.`);
      const over = isN(x.riskPct) && x.riskPct * 100 > rc.use * 1.05;
      setHtml($('[data-r="qcalc"]', body), [
        `<span>At risk <b>${x.risk != null ? money(x.risk) : '—'}</b></span>`,
        `<span>Of account <b class="${over ? 'warn-c' : ''}">${x.riskPct != null ? fmtPct(x.riskPct, { dp: 2 }) : '—'}</b> <span class="dim">cap ${rc.use}%</span></span>`,
        sizeMode === 'risk' ? `<span>Size <b>${isN(d.amount) ? esc(fmtQty(d.amount)) : '—'}</b> <span class="dim">${esc(d.coin || 'coins')}</span></span>` : '',
        `<span>Position <b>${x.notional != null ? money(x.notional) : '—'}</b></span>`,
        x.costR != null ? `<span>Est. costs <b class="${maxC && x.costR > maxC ? 'warn-c' : ''}">${rNum(x.costR)}</b></span>` : '',
      ].join(''));
      const g = guardCheck({ ...d, isNew: true, balance: bal });
      const gShown = isN(d.entryPrice) ? g : { ...g, items: g.items.filter(i => i.rule !== 'stop') };
      setHtml($('[data-r="guards"]', body), guardHtml(gShown)); sayGuards(body, gShown);
      const ban = $('[data-r="dayban"]', body), bh = dayBanner(g);
      setHtml(ban, bh); ban.hidden = !bh;
    }
    function validate(d) {
      clearMarks(body);
      const errs = badNumbers(body);
      if (!d.coin) errs.push(['coin', 'Enter the coin, e.g. BTC.']);
      else if (!COIN_RE.test(d.coin)) errs.push(['coin', 'Letters and numbers only (up to 20), e.g. BTC or PLSX.']);
      if (!isN(d.entryPrice) || d.entryPrice <= 0) errs.push(['entryPrice', 'Enter the price you got in at.']);
      sideErrors(d, errs);
      if (sizeMode === 'qty') { if (!isN(d.amount) || d.amount <= 0) errs.push(['amount', 'Enter how many coins you bought or sold (more than 0).']); }
      else if (!isN(d.riskPct) || d.riskPct <= 0) errs.push(['riskPct', 'Enter the % of your account to risk, e.g. 1.']);
      else if (!isN(d.stopPrice)) errs.push(['stopPrice', 'Sizing from risk % needs a stop — the size comes from the entry-to-stop distance.']);
      else if (!(bal > 0)) errs.push(['riskPct', 'Your balance is $0 — set a starting balance in Settings first, or enter the size in coins.']);
      const uniq = firstErr(errs);
      showErrors(body, uniq);
      return !uniq.length;
    }
    async function doSave() {
      if (saving || done) return;
      const d = draft();
      if (!validate(d) || modeMoved(mode0)) return;
      let viol = [];
      const g = guardCheck({ ...d, isNew: true, balance: bal });
      if (g.state === 'stop') {
        saving = true;   // one interrupt at a time
        const ov = await confirmOverride(g, tradeTitle(d));
        saving = false;
        if (!ov) return;   // "Don't take this trade" — the form stays open
        viol = ov.violations;
      }
      if (done || !root.isConnected || modeMoved(mode0)) return;
      saving = true;
      try {
        const id = uid(), tx = txn();
        addEntry(lean({
          id, type: 'trade', coin: d.coin, side: d.side, strategyId: d.strategyId || null, entryAt: d.entryAt,
          entryPrice: d.entryPrice, amount: d.amount, stopPrice: d.stopPrice, riskCapPct: riskCap(d.strategyId).cap,
          market: d.market, venue: d.venue, orderTypeEntry: d.orderTypeEntry, orderTypeExit: d.orderTypeExit,
          tags: [], mistakes: [], needsReview: true, violations: viol.length ? viol : null,
        }));
        tx.add(id);
        logOverrides(viol, id);
        if (!commit(`${tradeTitle(d)} logged — add the details when you review it`, 'ok')) { tx.undo(); return; }
        done = true;
        closeM('saved');
      } catch (e) {
        console.error('[tradeform] quick', e);
        toast('Could not log the trade — ' + (e && e.message ? e.message : 'unknown error'), 'err');
      } finally { saving = false; }
    }
    // Carry what was typed into the full form (risk % sizing included)
    function toFull() {
      const d = draft(), pre = {};
      for (const k of ['coin', 'side', 'strategyId', 'entryPrice', 'stopPrice', 'amount']) if (d[k] != null && d[k] !== '') pre[k] = d[k];
      if (!isN(pre.amount) && isN(d.riskPct)) pre.riskPct = d.riskPct;
      done = true;
      closeM('full');
      openAny(null, pre);
    }
  }

  /* ═══ Duplicate last trade ══════════════════════════════ */
  // Copies the setup (coin, side, strategy, venue, market, leverage, tags, order types) — never the prices
  function duplicateLast() {
    const last = lastTrade();
    if (!last) { toast('No trades to copy yet — here is a fresh form', 'ok'); openAny(null); return; }
    openAny(null, { ...prefillFrom(last), _note: `Copied the setup of your last ${tradeTitle(last)} — the time is now and the prices are blank.` });
  }

  /* ═══ Scale legs: add size to a trade, or edit one leg ══ */
  function scale(parentId) {
    const g = groupFor(parentId);
    scaleForm(g ? g.trade.id : parentId, null);
  }
  function scaleForm(pid, rowIn) {
    const parent = pid ? entryById(pid) : null;
    if (!parent || parent.deletedAt || !(parent.type === 'trade' || parent.type === 'scale')) { toast('That trade is not in the current account', 'warn'); return; }
    const row = rowIn ? entryById(rowIn.id) : null;
    if (rowIn && (!row || row.deletedAt)) { toast('That leg is not in the current account', 'warn'); return; }
    const isEdit = !!row, p = newPrefix(), c = ensureC(), mode0 = db.mode;
    const g0 = groupFor(pid), mkt = parent.market || 'spot', perp = mkt === 'perp', dex = mkt === 'dex';
    // the risk cap covers the whole trade, so the other legs' risk counts too
    const others = g0 ? g0.portions.filter(x => !row || x.id !== row.id) : [];
    const otherRisk = sumOf(others, x => x.riskDollar), otherNoStop = others.some(x => !isN(x.riskDollar));
    const bal = isEdit ? balanceFor(row.id) : (c ? c.balance : 0);
    const d0 = isEdit ? { ...row } : { entryAt: nowLocalInput(), stopPrice: isN(parent.stopFinal) ? parent.stopFinal : parent.stopPrice, targetPrice: parent.targetPrice };
    let root = null, body = null, closeM = null, chips = null, saving = false, done = false, exitAuto = false;
    const schedule = debounce(() => upd(), 60);
    const tag = isEdit ? (row.splitFrom ? 'Partial close leg' : 'Scale leg') : 'Add a scale-in leg';
    const html = `<div class="tf-form">
      ${headHtml(parent, `<span class="badge scale">${esc(tag)}</span><span class="tf-small dim">${esc(stratLabel(parent.strategyId))} · opened ${esc(whenTxt(parent.entryAt))} at ${fmtPrice(parent.entryPrice)}</span>`)}
      ${isEdit ? '' : '<div class="reading tf-small">A scale leg adds size to this trade at a new price. It keeps its own entry, size and stop, and the trade’s R uses the risk of every leg together. To take partial profit, use <b>Close position</b> and close part of the size instead.</div>'}
      <div data-r="dayban" hidden></div>
      ${secH('Entry')}
      <div class="tf-grid">
        ${fld(p, { k: 'entryAt', label: 'Entry time', type: 'dt', value: toLocalInput(d0.entryAt) })}
        ${fld(p, { k: 'entryPrice', label: 'Entry price', type: 'num', ph: '0.00', value: plain(d0.entryPrice), chip: chipHtml('in') })}
        ${fld(p, { k: 'amount', label: 'Size (coins)', type: 'num', ph: '0', value: plain(d0.amount), lbtn: '<button type="button" class="link-btn tf-lbtn" data-a="size" title="Size this leg so the whole trade risks exactly your cap">Fill my risk %</button>' })}
        ${fld(p, { k: 'stopPrice', label: 'Stop loss', type: 'num', ph: '0.00', value: plain(d0.stopPrice), hint: isEdit ? '' : 'Starts at the trade’s current stop.' })}
        ${fld(p, { k: 'targetPrice', label: 'Target', type: 'num', ph: '0.00', opt: true, value: plain(d0.targetPrice) })}
      </div>
      <div class="tf-qcalc" data-r="qcalc"></div>
      ${GUARDS_BOX}
      ${secH('Exit — only if this leg is already closed')}
      <div class="tf-grid">
        ${fld(p, { k: 'exitPrice', label: 'Exit price', type: 'num', ph: 'blank while open', value: plain(d0.exitPrice), chip: chipHtml('out') })}
        ${fld(p, { k: 'exitAt', label: 'Exit time', type: 'dt', value: toLocalInput(d0.exitAt) })}
        ${fld(p, { k: 'fees', label: 'Fees ($, both legs)', type: 'num', ph: '0.00', value: plain(d0.fees), lbtn: '<button type="button" class="link-btn tf-lbtn" data-a="fees-est">Use estimate</button>' })}
        ${perp ? fld(p, { k: 'funding', label: 'Funding ($)', type: 'num', ph: '0.00', value: plain(d0.funding), hint: '+ = you paid, − = you received.' }) : ''}
        ${dex ? fld(p, { k: 'gas', label: 'Gas ($)', type: 'num', ph: '0.00', value: plain(d0.gas) }) : ''}
      </div>
      <div class="tf-plprev" data-r="plprev" aria-live="polite"></div>
      ${fld(p, { k: 'notes', label: 'Notes', type: 'area', opt: true, max: 2000, ph: 'Why did you add here?', value: d0.notes || '' })}
    </div>`;
    const del = isEdit ? `<button type="button" class="btn btn-quiet btn-sm" data-a="del">${ic('trash', 14)}Delete</button>` : '';

    modal({
      title: `${isEdit ? 'Edit leg' : 'Add to position'} · ${tradeTitle(parent)}`, width: 640, body: html, foot: footSave(isEdit ? 'Save leg' : 'Add leg', del),
      onMount: (el, cm, hook) => {
        root = el; closeM = cm; body = $('.tf-form', el);
        chips = liveChips(body, () => parent.coin || '', { in: 'entryPrice', out: 'exitPrice' });
        hook(() => chips.refresh(false));
        body.addEventListener('input', (ev) => {
          const k = ev.target.dataset ? ev.target.dataset.f : null;
          if (k) unmark(body, k);
          // typing an exit price fills the exit time with "now" (cleared again if the price is removed)
          if (k === 'exitPrice') {
            const has = val(body, 'exitPrice').trim() !== '', at = q(body, 'exitAt');
            if (at && has && !at.value) { at.value = nowLocalInput(); exitAuto = true; }
            else if (at && !has && exitAuto) { at.value = ''; exitAuto = false; }
          } else if (k === 'exitAt') exitAuto = false;
          schedule();
        });
        body.addEventListener('change', () => schedule());
        body.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-a]'); if (!b || !body.contains(b)) return;
          if (b.dataset.a === 'size') sizeFill(); else if (b.dataset.a === 'fees-est') feeFill();
        });
        $('[data-a="save"]', el).onclick = doSave;
        $('[data-a="cancel"]', el).onclick = () => cm();
        const db2 = $('[data-a="del"]', el);
        if (db2) db2.onclick = () => { if (saving) return; done = true; cm('deleted'); softDelete([row.id], 'Moved the leg to Trash'); };
        upd();
        chips.refresh(true);
        if (!isEdit) setTimeout(() => { const f = q(body, 'entryPrice'); if (f && f.isConnected) f.focus({ preventScroll: true }); }, 60);
      },
    });

    function collect() {
      const n = (k) => numF(body, k);
      return {
        side: parent.side, coin: parent.coin, strategyId: parent.strategyId || null, market: mkt, venue: parent.venue || null,
        orderTypeEntry: parent.orderTypeEntry, orderTypeExit: parent.orderTypeExit,
        leverage: perp ? parent.leverage : null, marginMode: parent.marginMode, mmr: parent.mmr,
        entryAt: val(body, 'entryAt') || null, entryPrice: n('entryPrice'), amount: n('amount'), stopPrice: n('stopPrice'), targetPrice: n('targetPrice'),
        exitPrice: n('exitPrice'), exitAt: val(body, 'exitAt') || null, fees: n('fees'),
        funding: perp ? n('funding') : null, gas: dex ? n('gas') : null, notes: strF(body, 'notes'),
        autoFee: !isEdit || !isN(row.exitPrice),   // never auto-fill fees on a leg that was already closed
      };
    }
    function upd() {
      if (!body || !body.isConnected) return;
      const d = collect(), x = derive(d, bal), rc = riskCap(parent.strategyId), closed = isN(d.exitPrice);
      const tot = isN(x.risk) && !otherNoStop ? x.risk + otherRisk : null, totPct = tot != null && bal > 0 ? tot / bal : null;
      const avg = avgPx(others.concat(isN(d.amount) && isN(d.entryPrice) ? [{ amount: d.amount, entryPrice: d.entryPrice }] : []), 'entryPrice');
      const over = totPct != null && totPct * 100 > rc.use * 1.05;
      setHtml($('[data-r="qcalc"]', body), [
        `<span>This leg risks <b>${x.risk != null ? money(x.risk) : '—'}</b></span>`,
        `<span>Whole trade <b class="${over ? 'warn-c' : ''}">${tot != null ? `${money(tot)} · ${totPct != null ? fmtPct(totPct, { dp: 2 }) : '—'}` : otherNoStop ? 'a leg has no stop' : '—'}</b> <span class="dim">cap ${rc.use}%</span></span>`,
        avg != null ? `<span>Average entry <b>${fmtPrice(avg)}</b></span>` : '',
        x.notional != null ? `<span>Leg size <b>${money(x.notional)}</b></span>` : '',
      ].join(''));
      const g = guardCheck({ ...d, kind: 'scale', groupRisk: otherNoStop ? null : otherRisk, id: isEdit ? row.id : null, isNew: !isEdit, balance: bal });
      const gShown = isN(d.entryPrice) || isEdit ? g : { ...g, items: g.items.filter(i => i.rule !== 'stop') };
      setHtml($('[data-r="guards"]', body), guardHtml(gShown)); sayGuards(body, gShown);
      const ban = $('[data-r="dayban"]', body), bh = isEdit ? '' : dayBanner(g);
      setHtml(ban, bh); ban.hidden = !bh;
      const fi = q(body, 'fees'); if (fi) fi.placeholder = x.feeEst != null ? `est. ${moneyTxt(cents(x.feeEst))}` : '0.00';
      setHint(body, 'fees', x.feeEst == null ? '' : isN(d.fees) ? `Preset estimate: ${moneyTxt(cents(x.feeEst))}.` : closed && autoFillOn() && d.autoFee ? `Blank = the ${moneyTxt(cents(x.feeEst))} estimate is saved (paper).` : 'Blank = no fees recorded.');
      setHint(body, 'exitAt', !closed && g0 && g0.closed ? 'This trade is closed — a leg without an exit re-opens it.' : closed && exitAuto ? 'Set to now — change it if you closed earlier.' : '');
      setHtml($('[data-r="plprev"]', body), plPreview(x));
    }
    function sizeFill() {
      const d = collect(), rc = riskCap(parent.strategyId);
      if (!isN(d.entryPrice) || !isN(d.stopPrice) || d.entryPrice === d.stopPrice) {
        const k = isN(d.entryPrice) ? 'stopPrice' : 'entryPrice';
        mark(body, k, 'Enter the entry and stop first — the size comes from the distance between them.');
        const el = q(body, k); if (el) el.focus();
        return;
      }
      if (otherNoStop) { toast('Another leg of this trade has no stop — set it first so its risk can be counted', 'warn'); return; }
      if (!(bal > 0)) { toast('Set a starting balance first (Settings → Account)', 'warn'); return; }
      const room = bal * rc.use / 100 - otherRisk;
      if (!(room > 0)) { toast(`This trade already uses your full ${rc.use}% risk — adding size would break your rule`, 'warn'); return; }
      setVal(body, 'amount', plain(sig(room / Math.abs(d.entryPrice - d.stopPrice), 6)));
      unmark(body, 'amount'); upd();
      setHint(body, 'amount', `Sized so the whole trade loses ${rc.use}% (${moneyTxt(bal * rc.use / 100)}) if every stop is hit.`);
    }
    function feeFill() {
      const x = derive(collect(), bal);
      if (x.feeEst == null) { toast('Enter the entry price and size first', 'warn'); return; }
      setVal(body, 'fees', plain(cents(x.feeEst))); unmark(body, 'fees'); upd();
    }
    function validate(d) {
      clearMarks(body);
      const errs = badNumbers(body), t0 = Date.parse(parent.entryAt || '');
      if (!d.entryAt || !isFinite(Date.parse(d.entryAt))) errs.push(['entryAt', 'Pick the date and time you added.']);
      else if (isFinite(t0) && Date.parse(d.entryAt) < t0) errs.push(['entryAt', 'A scale leg can’t start before the trade’s first entry.']);
      else if (futureT(d.entryAt) && (!isEdit || d.entryAt !== toLocalInput(row.entryAt))) errs.push(['entryAt', 'That’s in the future — use the time you actually added.']);
      if (!isN(d.entryPrice) || d.entryPrice <= 0) errs.push(['entryPrice', 'Enter the price you added at.']);
      if (!isN(d.amount) || d.amount <= 0) errs.push(['amount', 'Enter how many coins you added (more than 0).']);
      sideErrors(d, errs);
      exitErrors(d, errs);
      if (isN(d.exitPrice) && futureT(d.exitAt) && (!isEdit || d.exitAt !== toLocalInput(row.exitAt))) errs.push(['exitAt', 'That’s in the future — use the time you actually got out.']);
      if (isN(d.gas) && d.gas < 0) errs.push(['gas', 'Gas can’t be negative.']);
      const uniq = firstErr(errs);
      showErrors(body, uniq);
      return !uniq.length;
    }
    async function doSave() {
      if (saving || done) return;
      upd();
      const d = collect();
      if (!validate(d) || modeMoved(mode0)) return;
      if (!entryById(pid) || (isEdit && !entryById(row.id))) { toast('This trade is no longer in the current account', 'err'); return; }
      if (!liveById(pid) || (isEdit && !liveById(row.id))) { toast(TRASHED, 'warn'); return; }
      const x = derive(d, bal);
      let viol = [];
      if (!isEdit) {
        const g = guardCheck({ ...d, kind: 'scale', groupRisk: otherNoStop ? null : otherRisk, isNew: true, balance: bal });
        if (g.state === 'stop') {
          saving = true;   // one interrupt at a time
          const ov = await confirmOverride(g, `Adding to this ${tradeTitle(parent)}`);
          saving = false;
          if (!ov) return;
          viol = ov.violations;
        }
      }
      if (done || !root.isConnected || modeMoved(mode0) || !entryById(pid)) return;
      if (!liveById(pid) || (isEdit && !liveById(row.id))) { toast(TRASHED, 'warn'); return; }   // trashed during the dialog
      saving = true;
      try {
        const closed = isN(d.exitPrice);
        const f = {
          entryAt: keepTime(isEdit ? row.entryAt : null, d.entryAt), entryPrice: d.entryPrice, amount: d.amount,
          stopPrice: d.stopPrice, targetPrice: d.targetPrice,
          exitPrice: closed ? d.exitPrice : null, exitAt: closed ? keepTime(isEdit ? row.exitAt : null, d.exitAt) : null,
          fees: isN(d.fees) ? d.fees : closed && autoFillOn() && d.autoFee && x.feeEst != null ? cents(x.feeEst) : null,
          notes: d.notes,
        };
        if (perp) f.funding = d.funding;
        if (dex) f.gas = d.gas;
        // the risk cap in force when the leg was added — an edit keeps its stamp unless the size or stop changed
        if (!isEdit || !sameN(d.amount, row.amount) || !sameN(d.stopPrice, row.stopPrice)) f.riskCapPct = riskCap(parent.strategyId).cap;
        let id;
        const tx = txn();
        if (isEdit) { id = row.id; tx.touch(id); updateEntry(id, f); }
        else {
          id = uid();
          addEntry(lean({
            id, type: 'scale', parentId: pid, coin: parent.coin, side: parent.side, strategyId: parent.strategyId || null,
            market: parent.market, venue: parent.venue, leverage: parent.leverage, marginMode: parent.marginMode, mmr: parent.mmr,
            orderTypeEntry: parent.orderTypeEntry, orderTypeExit: parent.orderTypeExit, ...f,
          }));
          tx.add(id);
          // overrides live on the parent trade, where adherence and the review queue read them
          if (viol.length) {
            const par = entryById(pid);
            tx.touch(pid);
            updateEntry(pid, { violations: (par && Array.isArray(par.violations) ? par.violations : []).concat(viol.map(v => ({ ...v, legId: id }))) });
            logOverrides(viol, pid);
          }
        }
        if (!commit(isEdit ? 'Leg updated' : `Added ${fmtQty(d.amount)} ${parent.coin || ''} to the trade`, 'ok')) { tx.undo(); return; }
        done = true;
        closeM('saved');
        const g2 = groupById(pid), par2 = entryById(pid);
        if (g2 && g2.closed && par2 && !isRev(par2)) toast('The trade is now fully closed', 'ok', { action: { label: 'Review it', run: () => review(pid) } });
      } catch (e) {
        console.error('[tradeform] scale', e);
        toast('Could not save the leg — ' + (e && e.message ? e.message : 'unknown error'), 'err');
      } finally { saving = false; }
    }
  }

  /* ═══ Close / partial close, then the post-trade review ═ */
  // Step 1: exit price (live chip), time, amount (partial = split into a closed scale leg, so the
  // trade's total risk is preserved), fees, funding, gas. Step 2 (same modal): the quick review.
  function closePos(rowId) {
    if (!ensureC()) return;
    let row = rowId ? entryById(rowId) : null;
    if (!row || row.deletedAt || !(row.type === 'trade' || row.type === 'scale')) { toast('That position is not in the current account', 'warn'); return; }
    const g = groupFor(row.id);
    if (!g) { toast('That position is not in the current account', 'warn'); return; }
    if (isN(row.exitPrice)) {
      const nxt = g.portions.find(x => !x.closed);
      row = nxt ? entryById(nxt.id) : null;
      if (!row) {
        const rvd = isRev(g.trade);
        toast('This trade is already closed', 'ok', { action: { label: rvd ? 'View' : 'Review', run: () => (rvd ? view(g.trade.id) : review(g.trade.id)) } });
        return;
      }
    }
    const tradeId = g.trade.id, tr = entryById(tradeId) || row, p = newPrefix(), mode0 = db.mode;
    const openLegs = g.portions.filter(x => !x.closed).map(x => entryById(x.id)).filter(Boolean);
    const multi = openLegs.length > 1;
    let all = multi && row.id === tradeId;   // closing from the trade itself → every open leg by default
    const mkt = tr.market || 'spot', perp = mkt === 'perp', dex = mkt === 'dex';
    const fr = feeRates(tr.venue, mkt, tr.orderTypeEntry, tr.orderTypeExit);
    const pb = isN(g.trade.prevBalance) ? g.trade.prevBalance : 0;
    const touched = { fees: false, funding: false, gas: false };
    let root = null, body = null, closeM = null, chips = null, stage = 1, saving = false, rv = null;
    const schedule = debounce(() => upd(), 60);
    const html = `<div class="tf-form">
      ${headHtml(tr, '<span class="tf-small dim" data-r="leginfo"></span>')}
      ${multi ? `<label class="check tf-allck"><input type="checkbox" data-r="all"${all ? ' checked' : ''}> Close all ${openLegs.length} open legs at this price</label>` : ''}
      <div class="tf-grid">
        ${fld(p, { k: 'exitPrice', label: 'Exit price', type: 'num', ph: '0.00', chip: chipHtml('out') })}
        ${fld(p, { k: 'exitAt', label: 'Exit time', type: 'dt', value: nowLocalInput(), hint: 'Now — change it if you closed earlier.' })}
        ${fld(p, { k: 'closeAmt', label: 'Amount to close (coins)', type: 'num', value: plain(row.amount), hint: 'Close part of it to take partial profit — the rest stays open.',
          after: `<div class="tf-pctbtns" role="group" aria-label="Close a share of the position">${[25, 50, 75, 100].map(v => `<button type="button" class="btn btn-ghost btn-xs" data-pct="${v}">${v === 100 ? 'All' : v + '%'}</button>`).join('')}</div>` })}
      </div>
      <div class="tf-grid">
        ${fld(p, { k: 'fees', label: 'Fees ($, entry + exit)', type: 'num', ph: '0.00', lbtn: '<button type="button" class="link-btn tf-lbtn" data-a="fees-est">Use estimate</button>' })}
        ${perp ? fld(p, { k: 'funding', label: 'Funding ($)', type: 'num', ph: '0.00', hint: '+ = you paid, − = you received.', btn: '<button type="button" class="btn btn-ghost btn-sm" data-a="fund-est" title="Estimate from public funding history">Estimate</button>' }) : ''}
        ${dex ? fld(p, { k: 'gas', label: 'Gas ($)', type: 'num', ph: '0.00' }) : ''}
      </div>
      <div class="tf-plprev" data-r="plprev" aria-live="polite"></div>
      <div class="tf-small dim" data-r="split"></div>
    </div>`;

    modal({
      title: `Close position · ${tradeTitle(tr)}`, width: 600, body: html, foot: footSave('Close position'),
      onMount: (el, cm, hook) => {
        root = el; closeM = cm; body = $('.tf-form', el);
        chips = liveChips(body, () => tr.coin || '', { out: 'exitPrice' });
        hook(() => { if (stage === 1 && chips) chips.refresh(false); });
        body.addEventListener('input', (ev) => {
          const k = ev.target.dataset ? ev.target.dataset.f : null;
          if (k) unmark(body, k);
          if (k && k in touched) touched[k] = true;
          schedule();
        });
        body.addEventListener('change', (ev) => {
          if (ev.target.dataset && ev.target.dataset.r === 'all') { all = !!ev.target.checked; unmark(body, 'closeAmt'); upd(); }
          else schedule();
        });
        body.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-pct], [data-a]'); if (!b || !body.contains(b)) return;
          if (b.dataset.pct) {
            const v = +b.dataset.pct;
            if (isN(row.amount)) setVal(body, 'closeAmt', plain(v === 100 ? row.amount : sig(row.amount * v / 100, 8)));
            unmark(body, 'closeAmt'); upd();
          } else if (b.dataset.a === 'fees-est') { setVal(body, 'fees', plain(cents(plan().feeEst))); touched.fees = true; unmark(body, 'fees'); upd(); }
          else if (b.dataset.a === 'fund-est') estFund(b);
        });
        $('[data-a="save"]', el).onclick = () => { if (stage === 1) doClose(); };
        $('[data-a="cancel"]', el).onclick = () => cm();
        upd();
        chips.refresh(true);
        setTimeout(() => { const f = q(body, 'exitPrice'); if (f && f.isConnected) f.focus({ preventScroll: true }); }, 60);
      },
      onClose: onClosed,
    });

    // Everything the close would write, read from the inputs: closing qty per leg and its share of costs
    function plan() {
      const ex = numF(body, 'exitPrice'), at = val(body, 'exitAt') || null, qIn = numF(body, 'closeAmt');
      const legs = all ? openLegs : [row];
      const parts = legs.map(r => {
        const A = isN(r.amount) ? r.amount : (r === row && isN(qIn) && qIn > 0 ? qIn : 0);
        const qv = all ? A : isN(qIn) && qIn > 0 ? Math.min(qIn, A) : A;
        const frac = A > 0 ? qv / A : 1, e = r.entryPrice, x = isN(ex) ? ex : e;
        const base = isN(r.fees) ? r.fees * frac : null;
        // the entry leg is estimated only when no entry fee was recorded on the row
        const est = isN(e) ? (base != null ? 0 : qv * e * fr.inRate) + qv * x * fr.outRate : 0;
        return { r, A, q: qv, frac, base, est, fund: isN(r.funding) ? r.funding * frac : null, gas: isN(r.gas) ? r.gas * frac : null };
      });
      const partial = !all && isN(row.amount) && isN(qIn) && qIn > 0 && qIn < row.amount * (1 - 1e-9);
      const sum = (k) => parts.reduce((s, pt) => s + (isN(pt[k]) ? pt[k] : 0), 0);
      const anyBase = parts.some(pt => pt.base != null), feeEst = sum('base') + sum('est');
      const notion = parts.reduce((s, pt) => s + pt.q * (isN(pt.r.entryPrice) ? pt.r.entryPrice : 0), 0);
      return {
        ex, at, qIn, legs, parts, partial, anyBase, feeEst, baseSum: sum('base'),
        feeDefault: autoFillOn() ? feeEst : anyBase ? sum('base') : null,
        fundDefault: parts.some(pt => pt.fund != null) ? sum('fund') : null,
        gasDefault: parts.some(pt => pt.gas != null) ? sum('gas') : null,
        share: (pt) => (notion > 0 ? pt.q * (isN(pt.r.entryPrice) ? pt.r.entryPrice : 0) / notion : 1 / parts.length),
      };
    }
    // Totals the save applies (a blank paper fee field saves the estimate, per the auto-fill setting)
    function totals(pl) {
      const fv = numF(body, 'fees'), fu = perp ? numF(body, 'funding') : null, ga = dex ? numF(body, 'gas') : null;
      return {
        fees: isN(fv) ? fv : autoFillOn() ? pl.feeEst : pl.anyBase ? pl.baseSum : null,
        funding: isN(fu) ? fu : pl.fundDefault, gas: isN(ga) ? ga : pl.gasDefault,
      };
    }
    function feeHint(pl) {
      if (fr.dex) return fr.label;
      if (autoFillOn()) return touched.fees ? `Preset estimate: ${moneyTxt(cents(pl.feeEst))}.` : `Paper: estimated from your fee preset${pl.anyBase ? ', including the entry fee you recorded' : ''}. Replace it with the real fee if you have it.`;
      if (pl.anyBase) return `Includes the entry fee you recorded. Add the exit fee from your exchange (the preset estimates ${moneyTxt(cents(pl.feeEst))} in total).`;
      return `Paste the total fee from your exchange — your preset estimates ${moneyTxt(cents(pl.feeEst))}.`;
    }
    function upd() {
      if (stage !== 1 || !body || !body.isConnected) return;
      const pl = plan(), legs = pl.legs, dir = tr.side === 'short' ? -1 : 1;
      const amtF = q(body, 'closeAmt'); if (amtF) amtF.closest('.field').hidden = all;
      const qty = sumOf(legs, r => r.amount), avg = avgPx(legs, 'entryPrice');
      setHtml($('[data-r="leginfo"]', body), all
        ? `${legs.length} open legs · ${esc(fmtQty(qty))} coins · avg entry ${avg != null ? fmtPrice(avg) : '—'}`
        : `Entry ${fmtPrice(row.entryPrice)} · ${esc(fmtQty(row.amount))} coins · stop ${isN(row.stopPrice) ? fmtPrice(row.stopPrice) : 'none'}${row.type === 'scale' ? ' · scale leg' : ''}`);
      // auto-filled cost fields follow the inputs until the user types in them
      if (!touched.fees) setVal(body, 'fees', pl.feeDefault != null ? plain(cents(pl.feeDefault)) : '');
      if (perp && !touched.funding) setVal(body, 'funding', pl.fundDefault != null ? plain(cents(pl.fundDefault)) : '');
      if (dex && !touched.gas) setVal(body, 'gas', pl.gasDefault != null ? plain(cents(pl.gasDefault)) : '');
      const fi = q(body, 'fees'); if (fi) fi.placeholder = pl.feeEst > 0 ? `est. ${moneyTxt(cents(pl.feeEst))}` : '0.00';
      setHint(body, 'fees', feeHint(pl));
      let prev = '';
      if (isN(pl.ex)) {
        const tt = totals(pl), cost = (tt.fees || 0) + (tt.funding || 0) + (tt.gas || 0);
        const gross = pl.parts.reduce((s, pt) => s + (isN(pt.r.entryPrice) ? (pl.ex - pt.r.entryPrice) * pt.q * dir : 0), 0);
        const net = gross - cost;
        const risk = pl.parts.every(pt => isN(pt.r.stopPrice) && isN(pt.r.entryPrice)) ? pl.parts.reduce((s, pt) => s + pt.q * Math.abs(pt.r.entryPrice - pt.r.stopPrice), 0) : null;
        const R = risk ? net / risk : null;
        prev = `<span>${pl.partial ? 'This part' : 'Result'}</span><b class="${plClass(net)}">${gl(net)}${money(net, { sign: true })}</b><b class="${plClass(R)}">${R != null ? fmtR(R) : 'R —'}</b>${pb > 0 ? `<span class="${plClass(net)}">${fmtPct(net / pb, { sign: true, dp: 2 })}</span><span>of the account</span>` : ''}${cost ? `<span class="dim">after ${money(cost)} costs</span>` : ''}`;
      }
      setHtml($('[data-r="plprev"]', body), prev);
      const others = openLegs.length - 1;
      setHtml($('[data-r="split"]', body), pl.partial
        ? `Closes ${esc(fmtQty(pl.qIn))} of ${esc(fmtQty(row.amount))} — ${esc(fmtQty(row.amount - pl.qIn))} stays open with the same entry and stop. The closed part is saved as a leg of this trade, so the total risk and the trade’s R stay correct.`
        : all ? 'Every open leg is closed at this price; fees are shared by size.'
          : multi ? `Only this leg is closed — the trade has ${plural(others, 'other open leg')}.` : '');
    }
    function validateClose(pl) {
      clearMarks(body);
      const errs = badNumbers(body);
      if (!isN(pl.ex) || pl.ex <= 0) errs.push(['exitPrice', 'Enter the price you got out at.']);
      const t = Date.parse(pl.at || '');
      if (!isFinite(t)) errs.push(['exitAt', 'When did you get out?']);
      else {
        const t0 = Math.max(...pl.legs.map(r => Date.parse(r.entryAt)).filter(isFinite).concat([-Infinity]));
        if (t < t0) errs.push(['exitAt', 'The exit can’t be before the entry.']);
        else if (t > Date.now() + 10 * MIN_MS) errs.push(['exitAt', 'That’s in the future — use the time you actually got out.']);
      }
      if (!all) {
        if (!isN(pl.qIn) || pl.qIn <= 0) errs.push(['closeAmt', 'Enter how much you closed (more than 0).']);
        else if (isN(row.amount) && pl.qIn > row.amount * (1 + 1e-9)) errs.push(['closeAmt', `This position is ${fmtQty(row.amount)} — you can’t close more than that.`]);
      }
      if (dex) { const gv = numF(body, 'gas'); if (isN(gv) && gv < 0) errs.push(['gas', 'Gas can’t be negative.']); }
      const uniq = firstErr(errs);
      showErrors(body, uniq);
      return !uniq.length;
    }
    function doClose() {
      if (saving || stage !== 1) return;
      const pl = plan();
      if (!validateClose(pl) || modeMoved(mode0)) return;
      // moved to Trash in another window: keep the form open and write nothing (missing / already-closed legs below)
      if ([tradeId, ...pl.legs.map(r => r.id)].some(id => entryById(id) && !liveById(id))) { toast(TRASHED, 'warn'); return; }
      if (pl.legs.some(r => { const cur = entryById(r.id); return !cur || cur.deletedAt || isN(cur.exitPrice); })) { toast('This position changed in the meantime — open it again to close it', 'err'); closeM(); return; }
      saving = true;
      try {
        const tt = totals(pl), at = pl.at;
        const r6 = (v) => (isN(v) ? Math.round(v * 1e6) / 1e6 : null);
        // a total entered for what is closed → each leg's share by size; otherwise its own pro-rated value
        const part = (tot, pt, k) => r6(isN(tot) ? tot * pl.share(pt) : pt[k]);
        const tx = txn();
        if (pl.partial) {
          const pt = pl.parts[0], r = pt.r, keep = 1 - pt.frac, lid = uid();
          // the split-off part keeps the risk-cap stamp of the leg it came from (the cap when that leg was taken)
          addEntry(lean({
            id: lid, type: 'scale', parentId: tradeId, splitFrom: r.id, coin: r.coin, side: r.side, strategyId: r.strategyId || null,
            entryAt: r.entryAt, entryPrice: r.entryPrice, amount: sig(pt.q, 12), stopPrice: r.stopPrice, targetPrice: r.targetPrice, stopFinal: r.stopFinal, riskCapPct: r.riskCapPct,
            market: r.market, venue: r.venue, leverage: r.leverage, marginMode: r.marginMode, mmr: r.mmr, orderTypeEntry: r.orderTypeEntry, orderTypeExit: r.orderTypeExit,
            exitPrice: pl.ex, exitAt: at, fees: part(tt.fees, pt, 'base'), funding: part(tt.funding, pt, 'fund'), gas: part(tt.gas, pt, 'gas'),
          }));
          tx.add(lid);
          const rest = { amount: sig(pt.A - pt.q, 12) };
          if (isN(r.fees)) rest.fees = r6(r.fees * keep);
          if (isN(r.funding)) rest.funding = r6(r.funding * keep);
          if (isN(r.gas)) rest.gas = r6(r.gas * keep);
          tx.touch(r.id);
          updateEntry(r.id, rest);
        } else {
          for (const pt of pl.parts) {
            const patch = { exitPrice: pl.ex, exitAt: at, fees: part(tt.fees, pt, 'base'), funding: part(tt.funding, pt, 'fund'), gas: part(tt.gas, pt, 'gas') };
            if (!isN(pt.r.amount) && pt.q > 0) patch.amount = pt.q;   // a row saved without a size gets the closed amount
            tx.touch(pt.r.id);
            updateEntry(pt.r.id, patch);
          }
        }
        const msg = pl.partial ? `Closed ${fmtQty(pl.qIn)} of ${fmtQty(row.amount)} ${tr.coin || ''} — ${fmtQty(row.amount - pl.qIn)} still open` : `${tradeTitle(tr)} closed`;
        // not written to disk (save() showed why): undo it and keep step 1 open for another try
        if (!commit(msg, 'ok')) { tx.undo(); return; }
        const g2 = groupById(tradeId);
        if (g2 && g2.closed && root.isConnected) step2(g2); else { stage = 3; closeM('saved'); }
      } catch (e) {
        console.error('[tradeform] close', e);
        toast('Could not close the position — ' + (e && e.message ? e.message : 'unknown error'), 'err');
      } finally { saving = false; }
    }
    async function estFund(btn) {
      const pl = plan();
      if (!pl.at || !isFinite(Date.parse(pl.at))) { mark(body, 'exitAt', 'Set the exit time first — funding is counted while the trade was open.'); return; }
      if (!hasMarket() || typeof Market.funding !== 'function') { toast('Market data is not available', 'warn'); return; }
      const lbl = btn.textContent;
      btn.disabled = true; btn.textContent = 'Estimating…';
      let usd = 0, n = 0, got = false, thin = false;
      for (const pt of pl.parts) {
        if (!(pt.q > 0) || !isN(pt.r.entryPrice)) continue;
        const r = await Promise.resolve(call(() => Market.funding({ coin: tr.coin, fromMs: Date.parse(pt.r.entryAt), toMs: Date.parse(pl.at), side: tr.side, qty: pt.q, price: pt.r.entryPrice }), null)).catch(() => null);
        if (r && isN(r.usd)) { usd += r.usd; n += r.n || 0; got = true; if (r.partial) thin = true; }
      }
      if (!btn.isConnected) return;
      btn.disabled = false; btn.textContent = lbl;
      if (!got) { toast(navigator.onLine === false ? 'Offline — enter the funding from your exchange history' : `No funding history found for ${tr.coin}`, 'warn'); return; }
      setVal(body, 'funding', plain(cents(usd))); touched.funding = true; unmark(body, 'funding');
      setHint(body, 'funding', `≈ ${plural(n, 'settlement')} at OKX rates (an estimate — your venue may differ)${thin ? ' · history only partly covers this trade' : ''}.`);
      upd();
    }
    // Step 2 — the quick post-trade review, in the same modal
    function step2(g2) {
      const raw = entryById(tradeId);
      if (!raw) { stage = 3; closeM('saved'); return; }
      stage = 2;
      const h3 = root.querySelector('.modal-head h3'); if (h3) h3.textContent = `Review · ${tradeTitle(raw)}`;
      const mb = root.querySelector('.modal-body'), mf = root.querySelector('.modal-foot');
      mb.innerHTML = `<div class="tf-form">${resultHtml(g2)}${planReadHtml(raw)}<p class="tf-small dim">Two minutes now beats an hour on Sunday. Grade the decision, not the result.</p><div data-r="rv"></div></div>`;
      mb.scrollTop = 0;
      if (mf) mf.innerHTML = `<span class="tf-kbd dim" aria-hidden="true"><kbd>Ctrl</kbd><kbd>Enter</kbd> saves</span><span class="sp"></span>
        <button type="button" class="btn btn-ghost" data-a="skip">Skip — review later</button><button type="button" class="btn btn-primary" data-a="save">${ic('check')}<span>Save review</span></button>`;
      body = $('.tf-form', mb);
      rv = mountReview($('[data-r="rv"]', body), p + 'r', raw, () => infoForGroup(tradeId), null, { excursion: true, compact: true });
      $('[data-a="save"]', root).onclick = () => finishReview(true);
      $('[data-a="skip"]', root).onclick = () => finishReview(false);
      setTimeout(() => { const f = body.querySelector('[data-rv="mistakes"] button'); if (f && f.isConnected) f.focus({ preventScroll: true }); }, 40);
    }
    function finishReview(reviewed) {
      if (stage !== 2 || saving || !rv) return;
      const cur = entryById(tradeId);
      if (!cur) { stage = 3; closeM('saved'); return; }
      if (!liveById(tradeId)) { toast(TRASHED, 'warn'); return; }
      if (!rv.validate(reviewed, groupPrices(groupFor(tradeId)))) return;
      if (!reviewed && !rv.hasContent()) { stage = 3; closeM('saved'); toast('Added to your review queue — review it from Trades when you’re ready', 'ok'); return; }
      const tx = txn(); tx.touch(tradeId);
      updateEntry(tradeId, reviewPatch(cur, rv.peek(), reviewed, rv.suggested()));
      if (!commit(reviewed ? 'Review saved' : 'Saved — the trade stays in your review queue', 'ok')) { tx.undo(); return; }
      stage = 3;
      closeM('saved');
      if (reviewed) processToast(tradeId);
    }
    // Esc / ✕ on the review step keeps whatever was typed, but leaves the trade unreviewed
    function onClosed(v) {
      if (stage !== 2 || v === 'saved' || !rv) return;
      const cur = entryById(tradeId);
      if (!cur || !rv.hasContent()) { toast('Added to your review queue', 'ok'); return; }
      if (!liveById(tradeId)) { toast(TRASHED, 'warn'); return; }   // the dialog is already gone — write nothing
      const r = rv.peek();
      if (isN(r.highDuring) || isN(r.lowDuring)) { const errs = []; excursionErrors(r, errs, groupPrices(groupFor(tradeId))); if (errs.length) { delete r.highDuring; delete r.lowDuring; } }
      const tx = txn(); tx.touch(tradeId);
      updateEntry(tradeId, reviewPatch(cur, r, false, rv.suggested()));
      // the dialog is already closed: a save that didn't reach disk is undone (save() showed why)
      if (!commit('Saved for later — the trade is in your review queue', 'ok')) tx.undo();
    }
  }

  /* ═══ Review an already-closed trade ════════════════════ */
  function review(tradeId) {
    const g = groupFor(tradeId);
    if (!g) { toast('That trade is not in the current account', 'warn'); return; }
    if (!g.closed) {
      const o = g.portions.find(x => !x.closed);
      toast('This trade is still open — close it first, then review it', 'warn');
      if (o) closePos(o.id);   // the parent first when it is open → "close all legs" by default
      return;
    }
    const id = g.trade.id, raw = entryById(id), p = newPrefix(), mode0 = db.mode;
    if (!raw) { toast('That trade is not in the current account', 'warn'); return; }
    const again = isRev(raw);
    let rv = null, done = false;
    const span = `${esc(stratLabel(raw.strategyId))} · ${esc(whenTxt(raw.entryAt))} → ${isN(g.exitMs) ? esc(fmtDateTime(g.exitMs)) : '—'}`;
    modal({
      title: `${again ? 'Edit review' : 'Review'} · ${tradeTitle(raw)}`, width: 680,
      body: `<div class="tf-form">${headHtml(raw, `<span class="tf-small dim">${span}</span>`)}${resultHtml(g)}${planReadHtml(raw)}<div data-r="rv"></div></div>`,
      foot: footSave(again ? 'Save changes' : 'Save review'),
      onMount: (el, cm) => {
        rv = mountReview($('[data-r="rv"]', el), p, raw, () => infoForGroup(id), null, { excursion: true, compact: false });
        $('[data-a="cancel"]', el).onclick = () => cm();
        $('[data-a="save"]', el).onclick = () => {
          if (done || modeMoved(mode0)) return;
          const cur = entryById(id);
          if (!cur) { toast('This trade is no longer in the current account', 'err'); cm(); return; }
          if (!liveById(id)) { toast(TRASHED, 'warn'); return; }
          if (!rv.validate(true, groupPrices(groupFor(id)))) return;
          const tx = txn(); tx.touch(id);
          updateEntry(id, reviewPatch(cur, rv.peek(), true, rv.suggested()));
          if (!commit(again ? 'Review updated' : 'Review saved', 'ok')) { tx.undo(); return; }
          done = true;
          cm('saved');
          processToast(id);
        };
        setTimeout(() => { const f = el.querySelector('[data-rv="mistakes"] button'); if (f && f.isConnected) f.focus({ preventScroll: true }); }, 40);
      },
    });
  }

  /* ═══ Trade detail drawer ═══════════════════════════════ */
  let viewCur = null;   // { id, body, mode } of the open detail drawer
  function shotList(e) {
    const out = (Array.isArray(e.shots) ? e.shots : []).filter(s => s && (s.id || s.url)).map(s => ({ id: s.id || null, url: s.url || null, kind: s.kind || 'other', caption: s.caption || '' }));
    if (e.shotBefore) out.push({ id: null, url: e.shotBefore, kind: 'before', caption: '' });
    if (e.shotAfter) out.push({ id: null, url: e.shotAfter, kind: 'after', caption: '' });
    return out;
  }
  const vsec = (title, inner, tip) => `<section class="tf-vsec"><h4 class="tf-vsec-h">${esc(title)}${tip || ''}</h4>${inner}</section>`;
  const viewSub = (g) => `${stratLabel(g.strategyId)} · ${whenTxt(g.trade.entryAt)} → ${g.closed ? (isN(g.exitMs) ? fmtDateTime(g.exitMs) : '—') : 'open'}`;
  // Open position: unrealised P/L at the last known price, with its "as of" time
  function liveHtml(g) {
    const open = g.portions.filter(x => !x.closed), dir = g.side === 'short' ? -1 : 1;
    const qt = hasMarket() && g.coin && typeof Market.cached === 'function' ? call(() => Market.cached(g.coin), null) : null;
    const anyClosed = g.portions.some(x => x.closed), realized = sumOf(g.portions.filter(x => x.closed), x => x.netPL);
    const risk = open.length && open.every(x => isN(x.riskDollar)) ? sumOf(open, x => x.riskDollar) : null;
    const head = `<div class="tf-vpl-l">Open position${anyClosed ? ' · partly closed' : ''}</div>`;
    const riskTxt = risk != null ? `<span>At risk <b>${money(risk)}</b> if the stop is hit</span>` : '<span class="warn-c">No stop on every leg — the risk is open-ended</span>';
    const realTxt = anyClosed ? `<span>Realised so far ${plSpan(realized, money(realized, { sign: true }))}</span>` : '';
    if (!qt || !isN(qt.usd)) return `${head}<div class="tf-vpl-main dim">—</div><div class="tf-vpl-sub"><span>No live price${navigator.onLine === false ? ' — you are offline' : ' yet'}.</span>${riskTxt}${realTxt}</div>`;
    const un = open.reduce((s, x) => s + (isN(x.entryPrice) && isN(x.amount) ? (qt.usd - x.entryPrice) * x.amount * dir : 0), 0) - sumOf(open, x => x.fees) - sumOf(open, x => x.funding) - sumOf(open, x => x.gas);
    const uR = risk ? un / risk : null;
    return `${head}<div class="tf-vpl-main ${plClass(un)}">≈ ${gl(un)}${money(un, { sign: true })}</div>
      <div class="tf-vpl-sub"><b class="${plClass(uR)}">${uR != null ? fmtR(uR) : 'R —'}</b><span>unrealised at ${fmtPrice(qt.usd)}</span>
        <span class="${qt.stale ? 'warn-c' : 'dim'}">${qt.stale ? 'stale · ' : ''}${isN(qt.at) ? 'as of ' + esc(fmtTime(qt.at)) : ''}</span>${riskTxt}${realTxt}</div>`;
  }
  function viewHtml(g) {
    const e = g.trade, id = e.id, ps = g.portions, multi = ps.length > 1, now = Date.now();
    const closedPs = ps.filter(x => x.closed);
    const qty = sumOf(ps, x => x.amount), avgIn = avgPx(ps, 'entryPrice'), avgOut = avgPx(closedPs, 'exitPrice');
    const fees = sumOf(ps, x => x.fees), funding = sumOf(ps, x => x.funding), gas = sumOf(ps, x => x.gas), costs = fees + funding + gas;
    const riskPct = isN(g.risk) && e.prevBalance > 0 ? g.risk / e.prevBalance : null;
    const reviewed = isRev(e), rc = riskCap(e.strategyId);
    const btn = (a, label, icon, cls) => `<button type="button" class="btn ${cls || 'btn-ghost'} btn-sm" data-va="${a}" data-fid="tfv-${a}-${esc(id)}">${icon ? ic(icon, 14) : ''}${label}</button>`;
    const kv = (l, v, sub, tip) => `<div><dt>${l}${tip || ''}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;

    const head = `<div class="tf-vhead">${coinIcon(e.coin)}<div class="tf-vtitle">
      <div class="tf-vcoin">${esc(e.coin || '?')}${sideBadge(e.side)}${statusBadge(g)}${gradeBadge(e.grade)}${g.closed && !reviewed ? '<span class="badge warn sm">Needs review</span>' : ''}</div>
      <div class="tf-vsub">${esc(stratLabel(e.strategyId))} · ${esc(marketLabel(e.market || 'spot'))}${e.venue ? ' · ' + esc(e.venue) : ''}${isN(e.leverage) && e.leverage > 1 ? ` · ${esc(String(+e.leverage))}×` : ''} · ${esc(modeName())}</div></div></div>`;

    const plBlock = g.closed
      ? `<div class="tf-vpl"><div class="tf-vpl-l">Net P/L ${tipFor('netPL', 'Profit or loss after fees, funding and gas.')}</div>
          <div class="tf-vpl-main ${plClass(g.netPL)}">${gl(g.netPL)}${money(g.netPL, { sign: true })}</div>
          <div class="tf-vpl-sub"><b class="${plClass(g.R)}">${g.R != null ? fmtR(g.R) : 'R —'}</b>${isN(g.changePct) ? `<b class="${plClass(g.changePct)}">${fmtPct(g.changePct, { sign: true, dp: 2 })}</b><span>of the account</span>` : ''}${g.R == null ? '<span class="warn-c">a leg has no stop, so R can’t be measured</span>' : ''}${costs ? `<span class="dim">gross ${money(g.grossPL, { sign: true })} · costs ${money(costs)}</span>` : ''}</div></div>`
      : `<div class="tf-vpl" data-v="live">${liveHtml(g)}</div>`;

    const hasChart = typeof TradeChart !== 'undefined' && !!TradeChart && typeof TradeChart.open === 'function';
    const acts = `<div class="tf-vacts" role="group" aria-label="Trade actions">
      ${btn('edit', 'Edit', 'edit')}
      ${!g.closed ? btn('close', 'Close position', 'check', 'btn-primary') : btn('review', reviewed ? 'Edit review' : 'Review', 'journal', reviewed ? 'btn-ghost' : 'btn-primary')}
      ${btn('scale', 'Add scale', 'plus')}${hasChart ? btn('chart', 'Chart', 'candles') : ''}${btn('dup', 'Duplicate', 'copy')}
      <span class="sp"></span>${btn('del', 'Delete', 'trash', 'btn-quiet')}</div>`;

    // key numbers
    const moved = isN(e.stopFinal) && isN(e.stopPrice) && e.stopFinal !== e.stopPrice;
    const dur = g.closed ? g.durationMs : (isFinite(Date.parse(e.entryAt)) ? Math.max(0, now - Date.parse(e.entryAt)) : null);
    const slip = isN(e.plannedEntry) && e.plannedEntry > 0 && isN(e.entryPrice) ? (e.entryPrice - e.plannedEntry) / e.plannedEntry * (e.side === 'short' ? -1 : 1) : null;
    const costSub = [fees ? `fees ${money(fees)}` : '', funding ? `funding ${money(funding, { sign: true })}` : '', gas ? `gas ${money(gas)}` : '', isN(g.risk) && g.risk > 0 && costs ? rNum(costs / g.risk) : ''].filter(Boolean).join(' · ');
    const entryPx = multi ? avgIn : e.entryPrice;
    const cells = [
      kv('Entry', isN(entryPx) ? fmtPrice(entryPx) : '—', multi ? `avg of ${ps.length} legs` : esc(whenTxt(e.entryAt))),
      kv('Exit', closedPs.length ? fmtPrice(avgOut) : '—', closedPs.length ? (closedPs.length > 1 ? 'average' : esc(whenTxt(closedPs[0].exitAt))) : 'still open'),
      kv('Stop', isN(e.stopPrice) ? fmtPrice(e.stopPrice) : '<span class="warn-c">none</span>', moved ? `moved to ${fmtPrice(e.stopFinal)}` : isN(e.stopPrice) && isN(e.entryPrice) && e.entryPrice ? `${fmtPct(Math.abs(e.entryPrice - e.stopPrice) / e.entryPrice, { dp: 2 })} away` : ''),
      kv('Target', isN(e.targetPrice) ? fmtPrice(e.targetPrice) : '—', isN(g.plannedR) ? `${g.plannedR.toFixed(2)}R planned` : ''),
      kv('Size', esc(fmtQty(qty)), avgIn != null && qty ? money(qty * avgIn) : ''),
      kv('$ at risk', isN(g.risk) ? money(g.risk) : '<span class="warn-c">no stop</span>', riskPct != null ? `${fmtPct(riskPct, { dp: 2 })} of account · cap ${rc.use}%` : ''),
      kv('Costs', money(costs), costSub, tipFor('fees', 'Fees, funding and gas. Shown in R too — above 0.25R costs eat the edge.')),
      kv('Held', dur != null ? esc(fmtDuration(dur)) : '—', g.closed ? '' : 'so far'),
      kv('Venue', esc(e.venue || '—'), esc(marketLabel(e.market || 'spot'))),
      e.market === 'perp' ? kv('Leverage', isN(e.leverage) ? `${esc(String(+e.leverage))}×` : '—', `${e.marginMode === 'cross' ? 'cross' : 'isolated'}${isN(e.liqPrice) ? ` · liq ≈ ${fmtPrice(e.liqPrice)}` : ''}`, tipFor('liqPrice', 'An estimate — exchanges liquidate on the mark price, and fees and funding move it.')) : '',
      slip != null ? kv('Slippage', fmtPct(slip, { sign: true, dp: 2 }), slip > 0 ? 'worse than planned' : slip < 0 ? 'better than planned' : 'as planned', tipFor('slippage', 'The gap between the price you planned and the fill you got.')) : '',
      e.market !== 'dex' && (e.orderTypeEntry || e.orderTypeExit) ? kv('Orders', `${esc(e.orderTypeEntry || '—')} → ${esc(e.orderTypeExit || '—')}`, 'entry → exit') : '',
      e.market === 'dex' && HASH_RE.test(e.txHash || '') ? kv('Entry tx', `<a href="https://scan.pulsechain.com/tx/${esc(e.txHash)}" target="_blank" rel="noopener noreferrer">${esc(e.txHash.slice(0, 10))}…</a>`, isN(e.gasNative) ? `${esc(fmtNum(e.gasNative, 2))} PLS gas` : '') : '',
    ].join('');

    // planned vs actual R, with a plain reading
    const pR = isN(g.plannedR) ? g.plannedR : null, aR = g.closed && isN(g.R) ? g.R : null;
    const mx = Math.max(1, Math.abs(pR || 0), Math.abs(aR || 0));
    const rb = (l, v, cls, txt) => `<div class="tf-rb"><span class="tf-rb-l">${l}</span><span class="tf-rb-t" aria-hidden="true"><span class="tf-rb-f ${cls}" style="width:${isN(v) ? Math.max(2, Math.min(100, Math.abs(v) / mx * 100)).toFixed(1) : 0}%"></span></span><span class="tf-rb-v${cls === 'acc' ? '' : ' ' + plClass(v)}">${txt}</span></div>`;
    // a winner without a target has no plan to compare with (it is not "breakeven")
    const rRead = aR == null ? '' : pR != null && aR >= pR - 1e-9 ? 'Reached the planned reward — or better.'
      : aR > 0.1 ? (pR != null ? `Captured ${Math.round(aR / pR * 100)}% of the planned reward.` : 'A winner — no target was set, so there is no plan to compare it with.')
        : aR >= -0.1 ? 'Roughly breakeven after costs.'
          : aR >= -0.9 ? 'A small loss — less than the 1R you planned to risk.'
            : aR >= -1.1 ? 'Lost about the planned 1R — the stop did its job.'
              : 'Lost more than the planned 1R — the stop moved, was ignored or slipped.';
    const rBlock = pR != null || aR != null ? vsec('Planned vs actual', `<div class="tf-rbars">${rb('Planned', pR, 'acc', pR != null ? rTxt(pR) : '—')}${rb('Actual', aR, aR == null ? 'flat' : aR > 0 ? 'pos' : aR < 0 ? 'neg' : 'flat', aR != null ? fmtR(aR) : g.closed ? '—' : 'open')}</div>${rRead ? `<div class="tf-vnote">${esc(rRead)}</div>` : ''}`, tipFor('rMultiple', 'R = how many times your risk you made or lost.')) : '';

    // MAE / MFE and efficiency (closed, single-leg trades with a high/low)
    const xc = g.closed && hasMetrics() ? call(() => Metrics.excursion(g), null) : null, src = String(e.excursionSource || '');
    const excBlock = !g.closed ? '' : vsec('Best & worst price (MAE / MFE)', xc
      ? `<dl class="tf-kv tf-exc">${kv('Went against you', isN(xc.maeR) ? rTxt(xc.maeR) : '—', 'MAE', tipFor('mae', 'How far price moved against you while the trade was open, in R.'))}
          ${kv('Went your way', isN(xc.mfeR) ? rTxt(xc.mfeR) : '—', 'MFE', tipFor('mfe', 'How far price moved in your favour while the trade was open, in R.'))}
          ${kv('Exit efficiency', isN(xc.exitEff) ? `${Math.round(xc.exitEff * 100)}%` : '—', isN(xc.exitEff) ? 'of the best exit' : 'winners only', tipFor('exitEff', 'How much of the best available move you kept (winners only).'))}
          ${kv('Entry efficiency', isN(xc.entryEff) ? `${Math.round(xc.entryEff * 100)}%` : '—', 'of the range')}</dl>
        <div class="tf-vnote">High ${fmtPrice(e.highDuring)} · low ${fmtPrice(e.lowDuring)}${src.startsWith('candles:') ? ` · from ${esc(src.slice(8))} candles` : src === 'manual' ? ' · entered by hand' : ''}</div>`
      : `<div class="tf-vnote">${multi ? 'MAE/MFE is measured on single-leg trades.' : `Add the highest and lowest price while the trade was open (in the review, or Edit → Advanced)${hasChart ? ' — or open the Chart to fill them from candles' : ''}.`}</div>`);

    // checklist
    const ck = e.checklist && Array.isArray(e.checklist.items) ? e.checklist.items.filter(i => i && i.text) : [];
    const ckBlock = ck.length ? vsec(`Checklist · ${ck.filter(i => i.met).length}/${ck.length} met`, `<div class="tf-vck">${ck.map(i => `<span class="${i.met ? 'met' : 'unmet'}"><i aria-hidden="true">${i.met ? '✓' : '✕'}</i><span>${esc(i.text)}${i.auto ? ' <span class="dim">(auto)</span>' : ''}<span class="sr-only">${i.met ? ': met' : ': not met'}</span></span></span>`).join('')}</div>`) : '';

    // tags, mistakes, emotions
    const mk = Array.isArray(e.mistakes) ? e.mistakes : [];
    const line = (l, arr) => (arr.length ? `<div><div class="tf-vq">${l}</div><div class="tf-vtags">${arr.join('')}</div></div>` : '');
    const pre = (e.emoPre || []).map(x => `<span class="badge cat">${esc(emoLabel(x, EMOTIONS_PRE))}</span>`);
    if (isN(e.emoPreInt)) pre.push(`<span class="badge cat">intensity ${e.emoPreInt}/5</span>`);
    if (isN(e.confidence)) pre.push(`<span class="badge cat">confidence ${e.confidence}/5</span>`);
    const stars = isN(e.discipline) && e.discipline >= 1 && e.discipline <= 5 ? Math.round(e.discipline) : null;
    const mind = [
      line('Tags', (e.tags || []).filter(t => typeof t === 'string' && t).map(t => `<span class="badge cat">${esc(t)}</span>`)),
      g.closed ? line('Mistakes', !reviewed ? ['<span class="badge warn sm">Not reviewed yet</span>']
        : mk.every(m => m === 'none') ? ['<span class="badge cat">✓ Clean — no mistakes</span>']
          : mk.filter(m => m && m !== 'none').map(m => `<span class="badge warn">${esc(mistakeLabel(m))}</span>`)) : '',
      line('Before the trade', pre),
      line('After the trade', (e.emoPost || []).map(x => `<span class="badge cat">${esc(emoLabel(x, EMOTIONS_POST))}</span>`)),
      stars ? line('Execution feel', [`<span class="badge cat" role="img" aria-label="${plural(stars, 'star')} of 5">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>`]) : '',
    ].join('');

    // plan & review text (escaped, line breaks kept by CSS)
    const rv = e.review && typeof e.review === 'object' ? e.review : {};
    const tx = (l, v) => (v ? `<div><div class="tf-vq">${l}</div><div class="tf-vtext">${esc(v)}</div></div>` : '');
    const PLAN = { yes: 'Yes', partly: 'Partly', no: 'No' };
    const texts = [tx('Why I took it', e.thesis), tx('What proves me wrong', e.invalidation), tx('Followed the plan', own(PLAN, rv.followedPlan) || ''),
      tx('What went well', rv.wentWell), tx('What I’d do differently', rv.improve), tx('Lesson', rv.lesson), tx('Notes', e.notes)].join('');

    // guardrail overrides
    const viol = Array.isArray(e.violations) ? e.violations.filter(v => v && typeof v === 'object') : [];
    const histVal = (v) => (v.rule === 'cooldown' ? (isN(v.value) ? `${Math.round(v.value)} min after a loss` : '') : guardVal(v));
    const violBlock = viol.length ? vsec(`Rules overridden (${viol.length})`, `<div class="guard-list">${viol.map(v => `<div class="guard stop"><span class="gi" aria-hidden="true">✕</span>
        <span class="tf-gtxt"><span class="gl">${esc(own(RULE_LABEL, v.rule) || v.rule || 'Rule')}${v.legId ? ' <span class="dim">(scale leg)</span>' : ''}</span>${v.reason ? `<span class="gh">“${esc(v.reason)}”</span>` : ''}${v.at ? `<span class="gh">${esc(whenTxt(v.at))}</span>` : ''}</span>
        <span class="gv">${histVal(v)}</span></div>`).join('')}</div>`) : '';

    // screenshots (stored media load after render; web links open in a new tab, never fetched by the app)
    const shots = shotList(e);
    const shotBlock = shots.length ? vsec(`Screenshots (${shots.length})`, `<div class="tf-gal">${shots.map((s, i) => {
      const web = s.url && isWeb(s.url) ? safeUrl(s.url) : null;
      const cap = `${esc(kindLabel(s.kind))}${s.caption ? ' · ' + esc(s.caption) : ''}`;
      return web
        ? `<div><a class="tf-gal-i tf-gal-link" href="${esc(web)}" target="_blank" rel="noopener noreferrer" aria-label="Open screenshot link: ${cap}"><span class="tf-ph">${ic('link', 20)}<span class="tf-small">Open link ↗</span></span></a><div class="tf-gal-cap">${cap}</div></div>`
        : `<div><button type="button" class="tf-gal-i" data-vshot="${i}" aria-label="View screenshot: ${cap}"><span class="tf-ph">${ic('image', 22)}</span><img alt="" hidden></button><div class="tf-gal-cap">${cap}</div></div>`;
    }).join('')}</div>`) : '';

    // legs
    const legLabel = (x, i) => (i === 0 && x.type === 'trade' ? 'First entry' : x.splitFrom ? 'Partial close' : 'Scale in');
    const legsBlock = multi ? vsec(`Legs (${ps.length})`, `<div class="table-wrap tf-legs"><table><thead><tr><th scope="col">Leg</th><th scope="col">Opened</th><th scope="col" class="num">Entry</th><th scope="col" class="num">Size</th><th scope="col" class="num">Stop</th><th scope="col" class="num">Exit</th><th scope="col" class="num">Net P/L</th><th scope="col" class="num">R</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${ps.map((x, i) => `<tr><td>${legLabel(x, i)}</td><td>${esc(whenTxt(x.entryAt))}</td><td class="num">${fmtPrice(x.entryPrice)}</td><td class="num">${esc(fmtQty(x.amount))}</td>
        <td class="num">${isN(x.stopPrice) ? fmtPrice(x.stopPrice) : '<span class="warn-c">none</span>'}</td><td class="num">${x.closed ? fmtPrice(x.exitPrice) : '<span class="badge open sm">open</span>'}</td>
        <td class="num">${x.closed ? plSpan(x.netPL, money(x.netPL, { sign: true })) : '—'}</td><td class="num ${x.closed ? plClass(x.netR) : ''}">${x.closed && isN(x.netR) ? fmtR(x.netR) : '—'}</td>
        <td><span class="row tight"><button type="button" class="btn btn-quiet btn-xs" data-vleg="edit" data-id="${esc(x.id)}" aria-label="Edit leg ${i + 1}">${ic('edit', 13)}</button>${x.closed ? '' : `<button type="button" class="btn btn-ghost btn-xs" data-vleg="close" data-id="${esc(x.id)}" aria-label="Close leg ${i + 1}">Close</button>`}</span></td></tr>`).join('')}
      </tbody></table></div><div class="tf-vnote">The trade’s R = the net P/L of every leg ÷ the risk of every leg together.</div>`) : '';

    const meta = [e.createdAt ? `Logged ${whenTxt(e.createdAt)}` : '', e.updatedAt ? `edited ${whenTxt(e.updatedAt)}` : '', e.importBatchId ? 'imported from a CSV' : '',
      e.needsReview ? 'quick-logged — add the details when you review it' : ''].filter(Boolean).join(' · ');

    return `<div class="tf-v">${head}${plBlock}${acts}
      ${vsec('Key numbers', `<dl class="tf-kv">${cells}</dl>`)}
      ${rBlock}${excBlock}${ckBlock}
      ${mind ? vsec('Setup & mindset', `<div class="tf-stack">${mind}</div>`) : ''}
      ${texts ? vsec('Plan & review', `<div class="tf-stack">${texts}</div>`) : ''}
      ${violBlock}${shotBlock}${legsBlock}
      ${meta ? `<div class="tf-vnote">${esc(meta)}</div>` : ''}</div>`;
  }
  function bindView(b, id) {
    b.querySelectorAll('[data-va]').forEach(x => { x.onclick = () => viewAct(x.dataset.va, id); });
    b.querySelectorAll('[data-vleg]').forEach(x => {
      x.onclick = () => { const r = entryById(x.dataset.id); if (!r) return; if (x.dataset.vleg === 'close') closePos(r.id); else openAny(r); };
    });
    const g = groupFor(id); if (!g) return;
    const shots = shotList(g.trade);
    b.querySelectorAll('[data-vshot]').forEach(x => {
      const s = shots[+x.dataset.vshot]; if (!s) return;
      const img = x.querySelector('img'), ph = x.querySelector('.tf-ph');
      const show = (u) => { if (!u || !img.isConnected) return; img.onload = () => { img.hidden = false; ph.hidden = true; }; img.src = u; };
      if (s.id && hasStore() && typeof Store.mediaURL === 'function') Promise.resolve(Store.mediaURL(s.id)).then(show).catch(() => {});
      else if (s.url) { const u = safeUrl(s.url); if (u && !isWeb(u)) show(u); }
      x.onclick = () => { if (img.src && !img.hidden) bigView(img.src, s.caption || kindLabel(s.kind)); else toast('This screenshot isn’t stored on this device', 'warn'); };
    });
    // refresh the open position's price once; the 'prices' event then updates the P/L block
    if (!g.closed && g.coin && hasMarket() && typeof Market.price === 'function') Promise.resolve(call(() => Market.price(g.coin), null)).catch(() => {});
  }
  function viewAct(a, id) {
    const g = groupFor(id); if (!g) { Drawer.close(); return; }
    switch (a) {
      case 'edit': openAny(entryById(id)); break;
      case 'close': closePos(id); break;
      case 'review': review(id); break;
      case 'scale': scale(id); break;
      case 'chart': if (typeof TradeChart !== 'undefined' && TradeChart && typeof TradeChart.open === 'function') call(() => TradeChart.open(id)); break;
      case 'dup': openAny(null, { ...prefillFrom(g.trade), _note: `Copied the setup of this ${tradeTitle(g.trade)} — the time is now and the prices are blank.` }); break;
      case 'del': Drawer.close(); softDelete([id], `Moved the ${tradeTitle(g.trade)} to Trash`); break;
      default: break;
    }
  }
  function view(tradeId) {
    const e0 = tradeId ? entryById(tradeId) : null;
    if (e0 && FLOW_TYPES.includes(e0.type)) { flow(e0.type, e0); return; }
    const g = groupFor(tradeId);
    if (!g) { toast('That trade is not in the current account', 'warn'); return; }
    const id = g.trade.id;
    Drawer.open({
      title: tradeTitle(g.trade), sub: viewSub(g), width: 640, html: viewHtml(g),
      onMount: (b) => { viewCur = { id, body: b, mode: db.mode }; bindView(b, id); },
      onClose: () => { if (viewCur && viewCur.id === id) viewCur = null; },
    });
  }
  // After any commit: redraw the open drawer in place (scroll and focus kept), or close it if the trade is gone
  function rerenderView() {
    if (!viewCur) return;
    const b = viewCur.body;
    if (!b.isConnected) { viewCur = null; return; }
    const g = db.mode === viewCur.mode ? groupFor(viewCur.id) : null;
    if (!g) { viewCur = null; Drawer.close(); return; }
    const act = document.activeElement, fid = act && b.contains(act) && act.dataset ? act.dataset.fid : null, top = b.scrollTop;
    b.innerHTML = viewHtml(g);
    const dr = b.closest('.drawer');
    if (dr) { const h = dr.querySelector('.drawer-head h3'), s = dr.querySelector('.drawer-head .page-sub'); if (h) h.textContent = tradeTitle(g.trade); if (s) s.textContent = viewSub(g); }
    bindView(b, viewCur.id);
    b.scrollTop = top;
    if (fid) { const f = b.querySelector(`[data-fid="${cssEsc(fid)}"]`); if (f) f.focus({ preventScroll: true }); }
  }

  /* ═══ Cash flows: deposit · withdrawal · set balance ════ */
  // Ported from v1 openFlowModal/saveFlow. "Set balance" stores flowAmount = target − balance at that
  // time (P/L-neutral) plus targetBalance, exactly like v1, so older entries keep working.
  const FLOW_OPTS = [{ id: 'deposit', label: '↓ Deposit' }, { id: 'withdrawal', label: '↑ Withdrawal' }, { id: 'adjustment', label: '⇄ Set balance' }];
  const FLOW_NAME = { deposit: 'Deposit', withdrawal: 'Withdrawal', adjustment: 'Balance correction' };
  function flow(kind, entry) {
    let ex = null;
    if (entry && entry.id) {
      ex = entryById(entry.id);
      if (!ex || ex.deletedAt || !FLOW_TYPES.includes(ex.type)) { toast('That entry is not in the current account', 'warn'); return; }
    }
    if (!ensureC()) return;
    let k = ex ? ex.type : FLOW_TYPES.includes(kind) ? kind : 'deposit';
    const p = newPrefix(), mode0 = db.mode, isEdit = !!ex;
    const at0 = (ex && toLocalInput(ex.entryAt)) || nowLocalInput();
    const t0 = Date.parse(at0);
    const amt0 = ex
      ? (ex.type === 'adjustment' ? (isN(ex.targetBalance) ? ex.targetBalance : balanceAt(t0, ex) + (isN(ex.flowAmount) ? ex.flowAmount : 0)) : ex.flowAmount)
      : k === 'adjustment' ? cents(balanceAt(isFinite(t0) ? t0 : Date.now(), null)) : null;
    let root = null, body = null, closeM = null, saving = false, done = false, prefilled = k === 'adjustment' && !isEdit;
    const title = () => (k === 'adjustment' ? (isEdit ? 'Edit balance correction' : 'Set balance') : isEdit ? `Edit ${FLOW_NAME[k].toLowerCase()}` : 'Deposit / withdrawal');
    const html = `<div class="tf-form">
      <div class="tf-top">${modeBadge()}<span class="tf-small dim" data-r="kindnote"></span></div>
      <div class="field"><label id="${p}-k-l">Type</label><div data-r="kind" role="group" aria-labelledby="${p}-k-l"></div></div>
      ${fld(p, { k: 'flowAmount', label: 'Amount ($)', type: 'num', ph: '0.00', value: plain(amt0), attrs: 'min="0"' })}
      <div class="tf-delta" data-r="delta" aria-live="polite"></div>
      <div class="tf-grid">
        ${fld(p, { k: 'entryAt', label: 'Date', type: 'dt', value: at0 })}
        ${fld(p, { k: 'flowNote', label: 'Note', opt: true, ph: k === 'adjustment' ? 'e.g. Matched to exchange' : 'e.g. Monthly top-up', value: ex ? ex.flowNote || '' : '', attrs: 'maxlength="200"' })}
      </div>
    </div>`;
    const del = isEdit ? `<button type="button" class="btn btn-quiet btn-sm" data-a="del">${ic('trash', 14)}Delete</button>` : '';

    modal({
      title: title(), width: 480, body: html, foot: footSave(isEdit ? 'Save changes' : 'Save', del),
      onMount: (el, cm) => {
        root = el; closeM = cm; body = $('.tf-form', el);
        segX($('[data-r="kind"]', body), FLOW_OPTS, k, (v) => {
          const prev = k, inp = q(body, 'flowAmount');
          k = FLOW_TYPES.includes(v) ? v : 'deposit';
          // switching to "Set balance" starts from the journal balance; switching away clears that prefill
          if (k === 'adjustment' && prev !== 'adjustment' && inp && !inp.value) { inp.value = plain(cents(before())); prefilled = true; }
          else if (prev === 'adjustment' && k !== 'adjustment' && prefilled && inp) { inp.value = ''; prefilled = false; }
          const h3 = el.querySelector('.modal-head h3'); if (h3) h3.textContent = title();
          unmark(body, 'flowAmount'); upd();
        });
        body.addEventListener('input', (ev) => {
          const kk = ev.target.dataset ? ev.target.dataset.f : null;
          if (kk) unmark(body, kk);
          if (kk === 'flowAmount') prefilled = false;
          upd();
        });
        body.addEventListener('change', () => upd());
        $('[data-a="save"]', el).onclick = doSave;
        $('[data-a="cancel"]', el).onclick = () => cm();
        const d2 = $('[data-a="del"]', el);
        if (d2) d2.onclick = () => { if (saving) return; done = true; cm('deleted'); softDelete([ex.id], `Moved the ${FLOW_NAME[ex.type].toLowerCase()} to Trash`); };
        upd();
        // "Set balance": the journal balance is prefilled and selected, so typing replaces it
        setTimeout(() => { const i = q(body, 'flowAmount'); if (!i || !i.isConnected) return; i.focus({ preventScroll: true }); if (prefilled) { try { i.select(); } catch (e) { /* not selectable */ } } }, 60);
      },
    });

    function before() { const t = Date.parse(val(body, 'entryAt')); return balanceAt(isFinite(t) ? t : Date.now(), ex); }
    function upd() {
      if (!body || !body.isConnected) return;
      const v = numF(body, 'flowAmount'), b = before(), t = Date.parse(val(body, 'entryAt'));
      const lab = body.querySelector(`label[for="${p}-flowAmount"]`); if (lab) lab.textContent = k === 'adjustment' ? 'Set balance to ($)' : 'Amount ($)';
      setHtml($('[data-r="kindnote"]', body), esc(k === 'adjustment' ? 'Match the journal to your exchange. It’s recorded as a correction, not as trading P/L.' : k === 'deposit' ? 'Money you added to the account.' : 'Money you took out of the account.'));
      const ago = isFinite(t) && Math.abs(Date.now() - t) > 5 * MIN_MS;
      let h = '';
      if (k === 'adjustment') {
        h = `Journal balance ${ago ? 'at that time' : 'now'}: <b>${money(b)}</b>.`;
        if (isN(v)) {
          const dl = v - b;
          h += Math.abs(dl) < 0.005 ? ' They already match — nothing to correct.' : ` This records a <b>${money(dl, { sign: true })}</b> correction that moves your balance without counting as trading P/L.`;
          if (b > 0 && Math.abs(dl) > 0.2 * b) h += ' <span class="warn-c">That’s a big gap — first check for a missing trade, deposit, withdrawal or fee.</span>';
        }
        const nOpen = C && Array.isArray(C.openRows) ? C.openRows.length : 0;
        if (nOpen) h += ` <span class="dim">Use the wallet balance without the unrealised P/L of your ${plural(nOpen, 'open position')}.</span>`;
      } else if (isN(v) && v > 0) {
        const after = k === 'deposit' ? b + v : b - v;
        h = `Balance after it: <b>${money(after)}</b> <span class="dim">(was ${money(b)})</span>.`;
        if (k === 'withdrawal' && v > b) h += ' <span class="warn-c">That’s more than your journal balance — check the amount.</span>';
      }
      setHtml($('[data-r="delta"]', body), h);
    }
    function doSave() {
      if (saving || done) return;
      clearMarks(body);
      const v = numF(body, 'flowAmount'), atRaw = val(body, 'entryAt'), errs = badNumbers(body);
      if (!isN(v)) errs.push(['flowAmount', k === 'adjustment' ? 'Enter the balance your exchange shows.' : 'Enter the amount.']);
      else if (k !== 'adjustment' && v <= 0) errs.push(['flowAmount', 'The amount must be more than 0.']);
      else if (k === 'adjustment' && v < 0) errs.push(['flowAmount', 'A balance can’t be negative.']);
      if (!atRaw || !isFinite(Date.parse(atRaw))) errs.push(['entryAt', 'Pick the date.']);
      const uniq = firstErr(errs);
      showErrors(body, uniq);
      if (uniq.length || modeMoved(mode0)) return;
      if (isEdit && !entryById(ex.id)) { toast('This entry is no longer in the current account', 'err'); return; }
      if (isEdit && !liveById(ex.id)) { toast('This entry was moved to Trash in another window', 'warn'); return; }
      const at = keepTime(ex ? ex.entryAt : null, atRaw), note = strF(body, 'flowNote');
      let data;
      if (k === 'adjustment') {
        const dl = Math.round((v - balanceAt(Date.parse(at), ex)) * 1e8) / 1e8;
        if (!isEdit && Math.abs(dl) < 0.005) { done = true; closeM('saved'); toast('Your balance already matches — nothing recorded', 'ok'); return; }
        data = { type: 'adjustment', flowAmount: dl, targetBalance: v, entryAt: at, flowNote: note };
      } else data = { type: k, flowAmount: v, targetBalance: null, entryAt: at, flowNote: note };
      saving = true;
      try {
        const tx = txn();
        if (isEdit) { tx.touch(ex.id); updateEntry(ex.id, data); } else tx.add(addEntry(lean({ ...data })).id);
        if (!commit(k === 'adjustment' ? `Balance set to ${moneyTxt(v)}` : `${FLOW_NAME[k]} of ${moneyTxt(v)} ${isEdit ? 'updated' : 'recorded'}`, 'ok')) { tx.undo(); return; }
        done = true;
        closeM('saved');
      } catch (e) {
        console.error('[tradeform] flow', e);
        toast('Could not save — ' + (e && e.message ? e.message : 'unknown error'), 'err');
      } finally { saving = false; }
    }
  }
  // Topbar balance pill: "Set balance to" what the exchange shows
  function adjust() { flow('adjustment', null); }

  /* ── Live updates (prices, data changes, account switch) ── */
  if (typeof Bus !== 'undefined') {
    Bus.on('prices', () => {
      for (const f of [...priceHooks]) call(f);
      if (viewCur && viewCur.body.isConnected) {
        const el = viewCur.body.querySelector('[data-v="live"]'), g = el ? groupFor(viewCur.id) : null;
        if (el && g && !g.closed) setHtml(el, liveHtml(g));
      }
    });
    Bus.on('refresh', () => { for (const f of [...refreshHooks]) call(f); call(rerenderView); });
    Bus.on('mode', () => { if (viewCur && viewCur.body.isConnected) { viewCur = null; Drawer.close(); } else viewCur = null; });
    Bus.on('saved', () => { saveN++; });
  }

  return { open: openAny, quick, duplicateLast, scale, close: closePos, review, view, flow, adjust, guardCheck };
})();
