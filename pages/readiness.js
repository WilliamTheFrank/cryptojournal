/* ═══════════════════════════════════════════════════════════
   CryptoJournal — Go-live readiness page (pages/readiness.js)
   Answers "Am I ready to switch from paper to live, and how
   should I ramp up?" with a transparent EVIDENCE CHECKLIST:
   must-pass gates + evidence checks, each showing its own number
   (metrics research + critic: never a 0-100 "readiness score").
   Always judges the PAPER account, whatever mode is active; live
   trades only feed the ramp plan and the paper-vs-live comparison.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Readiness = (() => {
  /* ── Constants ─────────────────────────────────────────── */
  const TITLES = {
    keep: 'Keep paper trading',
    close: 'Getting close — evidence still building',
    ready: 'Evidence supports a small live start',
  };
  const BLOCK = 25;   // live trades per ramp review block (research: review every 25 live trades)
  const STATE = {
    pass: { cls: 'done', icon: 'check', word: 'Pass' },
    partial: { cls: 'partial', icon: 'minus', word: 'Partly' },
    fail: { cls: 'fail', icon: 'x', word: 'Not yet' },
    wait: { cls: 'wait', icon: 'clock', word: 'Waiting' },   // not enough data to judge (ramp block / journal signals only)
  };
  const FLAG_LABELS = {
    noStop: 'no stop', overRisk: 'risk above your limit', stopBlown: 'loss past −1.2R',
    noStrategy: 'no strategy chosen', mistakes: 'mistake tagged', override: 'guardrail override',
  };
  const TAB_LABEL = { overview: 'Overview', risk: 'Risk & drawdown', process: 'Process', timing: 'Timing', compare: 'Paper vs Live' };
  const LIVE_MIN = 20;   // contract: win rate / expectancy need 20+ trades before they are read as signal
  const DAY = 86400000;

  // Plain-words formula for each gate ('g:' prefix) and evidence check, plus where to dig deeper.
  // k = live settings values (formatted), so the text always matches the user's own limits.
  const HOW = {
    'g:n': { tab: 'overview', text: () => "Counts your closed paper trades. A trade with scale-ins or partial exits counts once; open trades, deposits and withdrawals don't count. Below 30, a couple of lucky or unlucky trades can swing every number." },
    'g:exp': { tab: 'overview', text: (k) => `Each paper trade is re-priced as if it were live: extra cost = position value × round-trip cost (${k.cex} on exchanges, ${k.dex} for DEX coins) minus the fees you already logged. After-cost R = (net P/L − extra cost) ÷ the $ you risked at the stop. The gate needs the average to be above 0R.` },
    'g:clean': { tab: 'process', text: (k) => `Counts back from your most recent trading day. A day is clean when every trade had a stop, risked no more than 1.1× your ${k.maxRisk} limit, lost no more than 1.2R, had a strategy, no mistake tags and no guardrail override${k.daily ? ` — and the day's loss stayed under your ${k.daily} daily limit` : ''}. The streak ends at the first day that isn't clean.` },
    'g:adh': { tab: 'process', text: () => 'The share of your last 30 closed trades with no rule flag (the same rules as a clean day). It needs at least 20 recent trades to count.' },
    'g:dd': { tab: 'risk', text: () => "The biggest fall from a peak in your paper account, using trade results only — deposits and withdrawals don't count as gains or losses." },
    'g:playbook': { go: 'playbook', text: () => "Every strategy used in your last 30 trades needs written entry or exit rules in the Playbook. If none of your recent trades has a strategy, this gate can't pass." },
    sample: { tab: 'overview', text: () => 'Counts closed paper trades. The uncertainty around an average shrinks with the square root of the count: 4× the trades halves it. 50 trades is a developing picture; 100+ is meaningful.' },
    signif: { tab: 'overview', text: () => 'Uses your after-cost R per trade. Standard error = spread of your results ÷ √(number of trades). t = average ÷ standard error, and the 95% range is the average ± about 2 standard errors. If the range includes 0R your results are still consistent with no edge. (This is not "the chance your edge is luck".)' },
    expv: { tab: 'overview', text: () => 'Average after-cost R per trade — see the live-costs panel below. +0.25R means that, on average, you keep about a quarter of your risk per trade after fees and slippage.' },
    pf: { tab: 'overview', text: () => 'After-cost winning dollars ÷ after-cost losing dollars. 1.0 is breakeven; edges around 1.2 or lower rarely survive live trading.' },
    winrate: { tab: 'overview', text: () => 'Your win rate with a 95% Wilson range. Breakeven win rate = 1 ÷ (1 + payoff), where payoff = average win ÷ average loss in R. It passes when even the low end of the range is above breakeven.' },
    mcdd: { tab: 'risk', text: (k) => `Shuffles your after-cost R results 3,000 times into new 100-trade runs at ${k.liveRisk} risk per trade, with one extra −3R "gap" loss added to the pool so the worst case is never rosier than reality. Reports the drawdown that 95% of the runs stayed within. Needs 50 trades with a stop.` },
    adh95: { tab: 'process', text: () => 'The same rule flags as the adherence gate, with a stricter target: 95% of your last 30 trades clean.' },
    stops: { tab: 'process', text: () => 'Of your losing trades with a stop, the share that lost more than 1.1R — a sign the stop was moved, ignored or slipped. Live fills (especially on thin DEX pairs) only make this worse.' },
    cons: { tab: 'overview', text: () => "Green weeks = weeks with positive net P/L ÷ weeks you traded (needs 6+ weeks). Best-day share = your best day's profit ÷ the total profit of all green days." },
    time: { tab: 'timing', text: () => 'Calendar days since your first paper trade, and the number of different days you closed trades on — so the sample covers quiet and volatile markets, not one hot week.' },
    sizing: { go: 'account', text: () => "Paper starting balance ÷ your planned live capital. Trading a $100k paper account builds position-size and emotional habits that a $1k live account can't use." },
  };

  // Psychological self-check (psychology + readiness research). Advisory only — never a gate.
  const SELF = [
    { id: 'plan', text: 'I have a written plan — entry, exit and stop — for every setup I trade.', fix: 'write entry, exit and stop rules for each setup in the Playbook',
      sub: (M) => (M.undocumented.length ? `${plural(M.undocumented.length, 'strategy', 'strategies')} you use recently ${M.undocumented.length === 1 ? 'has' : 'have'} no written rules yet.` : '') },
    { id: 'afford', text: 'The money I will trade live is money I can afford to lose completely.', fix: 'lower your planned live capital until losing all of it would not change your life',
      sub: () => "If losing it would hurt your rent, bills or sleep, it's too much for a first live account." },
    { id: 'streak', text: 'I can take 5 losses in a row without changing my plan or my position size.', fix: 'decide now what you will do after 5 losses (stop for the day, halve size) and write it down',
      sub: (M) => (isNum(M.s.expLongestLossRun) && M.gs.length >= 10 ? `With your win rate, a losing streak of about ${Math.max(1, Math.round(M.s.expLongestLossRun))} is normal over ${M.gs.length} trades.` : 'Losing streaks are normal — even good systems have them.') },
    { id: 'dailyStop', text: 'I stop trading for the day once I hit my daily loss limit.', fix: 'treat the daily loss limit as the end of the day, every day — on paper first',
      sub: () => (S().risk.maxDailyLossPct > 0 ? `Your daily loss limit is ${S().risk.maxDailyLossPct}% of the account.` : 'You have no daily loss limit set — add one in Settings → Risk.') },
    { id: 'revenge', text: 'After a loss I wait before the next trade — I never trade to win it back.', fix: 'respect the cooldown after every loss and walk away from the screen',
      sub: () => (S().risk.cooldownMin > 0 ? `Your cooldown after a loss is ${S().risk.cooldownMin} minutes. Revenge trades are the costliest mistake.` : 'You have no cooldown after a loss set — revenge trades are the costliest mistake.') },
    { id: 'worst', text: 'I kept following my rules during my worst paper losing streak.', fix: 'replay your worst paper streak and note how it would feel with real money',
      sub: (M) => (M.gs.length ? `Your worst paper drop was ${pct(-M.s.maxDDPct, 1)} and your longest losing streak ${plural(M.s.maxLossStreak, 'trade')}. Could you sit through that with real money?` : '') },
    { id: 'state', text: "I don't trade when tired, angry or stressed — I check in with myself first.", fix: 'do the daily readiness check-in in the Journal before your first trade',
      sub: () => 'Hungry, angry, lonely or tired (HALT) days are when rules get broken.' },
    { id: 'expect', text: 'I expect live results to be worse than paper, and I will start at the smallest size.', fix: 'start at stage 1 (0.25% risk) and let the ramp decide when to size up',
      sub: () => 'Real fills, fees and nerves usually cost some of the paper edge at first.' },
  ];

  /* ── Small helpers ─────────────────────────────────────── */
  const isO = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  function plural(n, w, pl) { return `${n} ${n === 1 ? w : (pl || w + 's')}`; }
  function pct(v, dp) { return isNum(v) ? fmtPct(v, { dp: dp == null ? 0 : dp }) : '—'; }
  const prob = (p) => (!isNum(p) ? '—' : p > 0 && p < 0.005 ? '<1%' : p < 1 && p > 0.995 ? '>99%' : fmtPct(p, { dp: 0 }));
  const riskTxt = (v) => (isNum(v) ? `${+v.toFixed(2)}%` : '—');
  const ico = (id, cls) => `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const cssVar = (name, fb) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } };
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ISO string or epoch ms (other modules may store either) → ms | null
  const parseMs = (v) => { if (isNum(v)) return v > 0 ? v : null; const t = v ? Date.parse(v) : NaN; return isFinite(t) ? t : null; };
  // 'YYYY-MM-DD' → local midnight (Date.parse would read it as UTC and shift the day west of Greenwich)
  const dayMs = (key) => { const p = String(key).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1).getTime(); };
  const lc1 = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');
  const maxRisk = () => (isNum(S().risk.maxRiskPct) && S().risk.maxRiskPct > 0 ? S().risk.maxRiskPct : 1);
  const DEFAULT_RAMP = { enabled: true, stage: 1, stageStartAt: null };
  const rampR = () => (isO(S().ramp) ? S().ramp : DEFAULT_RAMP);                      // read
  const rampW = () => { if (!isO(S().ramp)) S().ramp = { ...DEFAULT_RAMP }; return S().ramp; }; // write
  const clampStage = (v) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.min(4, Math.max(1, n)) : 1; };
  const stageCap = (st) => Math.min(maxRisk(), RAMP_STAGES[st] || maxRisk());
  const liveCap = (st) => (rampR().enabled ? stageCap(st) : maxRisk());
  const fmtSigned = (v, dp) => `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(dp)}%`;
  const fmtX = (v) => `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(2)}×`;   // ratio with a true minus sign
  // More trades needed for t = 2, the same rule as Metrics' tradesNeeded: n* = (2·sd/mean)² = 4·n ÷ t².
  // null when the average is not positive (more of the same can't prove an edge).
  const needFor = (t, n) => (isNum(t) && t > 0 && n >= 2 ? Math.max(0, Math.ceil(4 * n / (t * t)) - n) : null);

  /* ── Cross-module entry points (always guarded) ────────── */
  // A module whose script threw while loading leaves its `const` in the temporal dead zone, where
  // even `typeof X` throws — so read other modules through try/catch, not just typeof.
  const peek = (get) => { try { return get() || null; } catch (e) { return null; } };
  // Router.go() silently ignores an unregistered page — say so instead of a dead click.
  function goPage(id, label) {
    if (Pages.has(id)) Router.go(id);
    else toast(`The ${label} page is not available right now`, 'warn');
  }
  // Always pass a filter object (even {}): Analytics.show replaces its current filter with it, so a
  // leftover coin / date filter can't make the numbers there disagree with this checklist (all trades).
  function goAnalytics(tab, filter) {
    const A = peek(() => Analytics);
    if (A && A.show) A.show(tab, filter || {});
    else goPage('analytics', 'Analytics');
  }
  function goSettings(sec) {
    const St = peek(() => Settings);
    if (St && St.show) St.show(sec); else goPage('settings', 'Settings');
  }
  function goPlaybook(id) {
    const D = peek(() => Discipline);
    if (id && strategyById(id) && D && D.editStrategy) D.editStrategy(id);
    else goPage('playbook', 'Playbook');
  }
  function switchMode(m) {
    const A = peek(() => App);
    if (A && A.switchMode) A.switchMode(m);
    else toast('Use the Paper / Live switch in the sidebar', 'warn');
  }
  function newTrade() {
    if (db.mode !== 'paper') { switchMode('paper'); return; }
    const T = peek(() => TradeForm);
    if (T && T.open) T.open(null); else goPage('trades', 'Trades');
  }
  function goReview(key) {
    const J = peek(() => Journal);
    if (J && J.openReview) J.openReview(key);
    else goPage('journal', 'Journal');
  }

  /* ── Evaluation cache ──────────────────────────────────── */
  // Readiness runs two bootstraps + a Monte Carlo, so it is computed once per data/settings change.
  // Bus events invalidate it; a cheap signature also catches writes that skipped the Bus.
  let cache = null, cacheSig = '';
  const mcCache = new Map();
  let tryRisk = null;              // transient "what if I risk X%" value for the drawdown panel
  const openSet = new Set();       // expanded check ids survive re-renders
  let curEl = null;
  let renderSeq = 0;               // bumped after every finished render — show() waits for a fresh one

  function invalidate() { cache = null; cacheSig = ''; mcCache.clear(); }
  function signature() {
    const st = S(), parts = [todayISO()];
    for (const m of ['paper', 'live']) {
      const a = acct(m); let n = 0, last = '';
      for (const e of a.entries) { if (e.deletedAt) continue; n++; const u = e.updatedAt || e.createdAt || ''; if (u > last) last = u; }
      parts.push(m, a.startingBalance, n, last);
    }
    parts.push(JSON.stringify(st.costs), JSON.stringify(st.risk), st.plannedLiveCapital, st.beBandR, JSON.stringify(st.ramp), st.sessionScheme);
    parts.push(db.strategies.map(s => `${s.id}:${s.name}:${(s.entry || []).length}:${(s.exit || []).length}`).join(','));
    // journal signals read overrides and paper weekly reviews
    const rv = isO(db.reviews) && isO(db.reviews.paper) ? db.reviews.paper : {};
    parts.push(Array.isArray(db.overrides) ? db.overrides.length : 0, Object.keys(rv).filter(k => k.startsWith('W:')).join(','));
    return parts.join('|');
  }
  function model() {
    const sig = signature();
    if (cache && sig === cacheSig) return cache;
    mcCache.clear();
    cache = compute(); cacheSig = sig;
    return cache;
  }

  function compute() {
    /* paper evidence */
    const paperC = computeFor('paper');
    // Judge paper trades against the FULL risk limit (mode 'paper'): the live ramp cap must not
    // flag every 1% paper trade as oversized while Live mode happens to be active.
    const ctx = { ...metricsCtx(paperC, 'paper'), riskPerTradePct: maxRisk() };
    const gs = Metrics.filterGroups(paperC.closedGroups, {});          // closed, sorted by exit
    const r = Metrics.readiness(gs, ctx);
    const s = r.summary, h = r.haircut;
    const costs = isO(S().costs) ? S().costs : {};
    const hc = gs.map(g => Metrics.haircut(g, costs));
    const hR = hc.map(x => x.R).filter(isNum);                          // same pool readiness() simulates
    // per-setup after-cost expectancy (readiness only gives the paper R)
    const byStrat = new Map();
    gs.forEach((g, i) => { const k = g.strategyId || null; if (!byStrat.has(k)) byStrat.set(k, []); if (isNum(hc[i].R)) byStrat.get(k).push(hc[i].R); });
    const perStrategy = (r.perStrategy || []).map(p => ({ ...p, name: stratName(p.id), afterR: Metrics.mean(byStrat.get(p.id) || []) }))
      .sort((a, b) => b.n - a.n);
    const noStrategyN = gs.filter(g => !g.strategyId).length;
    // typical stop distance vs round-trip cost (research: cost in R ≈ round-trip % ÷ stop %)
    const stopPcts = [];
    for (const g of gs) { const e = g.trade; if (isNum(e.entryPrice) && isNum(e.stopPrice) && e.entryPrice > 0) stopPcts.push(Math.abs(e.entryPrice - e.stopPrice) / e.entryPrice); }
    const num = (v) => (isNum(v) ? v : 0);
    const rtCex = 2 * (num(costs.cexFeePct) + num(costs.cexSlipPct)), rtDex = 2 * (num(costs.dexFeePct) + num(costs.dexSlipPct));
    const dexN = Math.abs(rtDex - rtCex) > 1e-9 ? hc.filter(x => isNum(x.roundTripPct) && Math.abs(x.roundTripPct - rtDex) < 1e-9).length : 0;
    // mirrors the playbook gate so the page can name the strategies that need rules
    const used = [...new Set(gs.slice(-30).map(g => g.strategyId).filter(Boolean))];
    const undocumented = used.filter(id => { const st = strategyById(id); return !st || !((st.entry || []).length || (st.exit || []).length); });
    const flags30 = {};
    for (const g of gs.slice(-30)) for (const f of Metrics.flagsFor(g, ctx)) flags30[f] = (flags30[f] || 0) + 1;
    const totalR = gs.reduce((t, g) => t + (isNum(g.R) ? g.R : 0), 0);
    // gs is sorted by EXIT, so the first trade taken is the earliest entry, not gs[0]
    const firstMs = gs.reduce((m, g) => { const t = Date.parse(g.trade.entryAt); return isFinite(t) && t < m ? t : m; }, Infinity);
    const openN = paperC.groups.filter(g => !g.closed).length;
    const signals = journalSignals(gs);

    /* live side: ramp + comparison */
    const liveC = computeFor('live');
    const liveGs = Metrics.filterGroups(liveC.closedGroups, {});
    const stage = clampStage(rampR().stage);
    const sinceMs = parseMs(rampR().stageStartAt);
    const liveCtx = { ...metricsCtx(liveC, 'live'), riskPerTradePct: liveCap(stage) };   // live trades judged at the stage cap
    const block = liveGs.filter(g => !sinceMs || g.exitMs >= sinceMs);
    // The live account starts at $0 (freshAccount(0)). With no starting balance, deposit or "Set balance"
    // adjustment the engine's running balance is just cumulative P/L, so a drawdown % is meaningless (0%
    // while losing, or a fake 80% after one loss following a small win) — and so is any promote / step-back
    // / back-to-paper call driven by it. Hold the ramp and show drawdown as "waiting" instead.
    // (A positive adjustment counts: TradeForm.adjust() is how many users set their live balance.)
    const liveMeasurable = balanceMeasurable(liveC);
    let ramp = liveGs.length ? Metrics.rampStatus(liveGs, stage, sinceMs, h.expR, liveCtx) : null;
    if (ramp && !liveMeasurable) ramp = { ...ramp, dd: null, ddOk: false, ddUnknown: true, action: 'hold' };
    const rampAdh = block.length ? Metrics.adherence(block, liveCtx) : null;
    const cmp = liveGs.length >= 5 ? Metrics.compare(gs, liveGs, ctx) : null;
    // compare() scores both sides with the paper ctx; live adherence must use the live (stage-capped) ctx
    const cmpLiveAdh = cmp ? Metrics.adherence(liveGs, liveCtx) : null;

    const M = {
      paperC, ctx, gs, r, s, h, costs, hc, hR, perStrategy, noStrategyN, medStopPct: Metrics.median(stopPcts),
      rtCex, rtDex, dexN, undocumented, flags30, totalR, firstMs: isFinite(firstMs) ? firstMs : null, openN, signals,
      liveC, liveGs, stage, sinceMs, block, ramp, rampAdh, cmp, cmpLiveAdh, liveMeasurable,
    };
    // metrics.js writes a few values with an ASCII hyphen or a fixed plural ("1 days"). Store the app's
    // formatting on the object itself, so the dashboard mini card (which prints `value` raw) matches too.
    // r is built fresh by Metrics.readiness() for this cache entry — nothing shared is mutated.
    for (const g of r.gates) g.value = valueOf('gate', g, M);
    for (const c of r.checks) { c.value = valueOf('check', c, M); c.hint = hintOf(c, M); }
    // extras for the dashboard mini card (Readiness.evaluate())
    r.n = gs.length;
    r.title = TITLES[r.verdict];
    r.next = nextStep(M);
    return M;
  }

  // Bootstrap drawdown at any risk %, on the same after-cost pool and seed as readiness() — cached.
  function mcAt(M, risk) {
    if (M.hR.length < 50 || !(risk > 0)) return null;
    if (M.r.mc && Math.abs(risk - (M.ctx.liveRiskPct || 1)) < 1e-9) return M.r.mc;
    const key = risk.toFixed(3);
    if (!mcCache.has(key)) {
      if (mcCache.size > 24) mcCache.clear();
      mcCache.set(key, Metrics.monteCarlo(M.hR, { riskPct: risk, trades: 100, sims: 3000, seed: 7, stress: true }));
    }
    return mcCache.get(key);
  }

  /* ── Journal signals (behaviour; advisory, never a gate) ─ */
  // Psychology research's behavioural prerequisites — things a lucky streak can't fake: no guardrail
  // overrides lately, weekly reviews actually done, and best-process (A-grade) trades that make money.
  // The thresholds are opinion, so these sit beside the self-check rather than among the gates.
  function journalSignals(gs) {
    const now = Date.now(), out = [], since14 = now - 14 * DAY;
    const starts = gs.map(g => Date.parse(g.trade.entryAt)).filter(isFinite);
    const recent = starts.filter(t => t >= since14).length;
    // only overrides whose trade still exists (a trashed / deleted trade takes its override with it)
    const ov = liveOverrides('paper').filter(o => isO(o) && (parseMs(o.at) || 0) >= since14).length;
    out.push({
      id: 'overrides', label: 'No guardrail overrides in the last 14 days', value: plural(ov, 'override'),
      // zero overrides only means something if you actually traded in that window
      state: ov === 0 ? (recent ? 'pass' : 'wait') : ov === 1 ? 'partial' : 'fail',
      hint: ov ? 'Each override is a rule you broke on purpose. Live, the same urge costs real money.'
        : recent ? 'You respected every guardrail lately — that habit is what carries over to live.' : 'No closed paper trades in the last 14 days to judge.',
    });
    // last 4 completed weeks, counting only weeks since the first paper trade
    const rv = isO(db.reviews) && isO(db.reviews.paper) ? db.reviews.paper : {};
    const firstWk = starts.length ? Metrics.weekKey(Math.min(...starts)) : null;
    const weeks = firstWk ? [1, 2, 3, 4].map(k => Metrics.weekKey(now - 7 * k * DAY)).filter(w => w >= firstWk) : [];
    const done = weeks.filter(w => isO(rv['W:' + w])).length;
    const missing = weeks.find(w => !isO(rv['W:' + w])) || null;
    out.push({
      id: 'reviews', label: 'A weekly review for each of the last 4 weeks', value: weeks.length ? `${done}/${weeks.length} done` : '—',
      state: !weeks.length ? 'wait' : done === weeks.length ? 'pass' : done * 2 >= weeks.length ? 'partial' : 'fail',
      hint: weeks.length ? 'The weekly review is where lessons turn into rule changes.' : 'Starts after your first full week of paper trading.',
      review: missing ? 'W:' + missing : null,
    });
    const a = (Metrics.gradeReport(gs) || []).find(x => x && x.key === 'A');
    const aN = a ? a.rN : 0;
    out.push({
      id: 'gradeA', label: 'Your A-grade (best-process) trades make money', value: aN >= 10 ? `${fmtR(a.expR)} · ${plural(a.n, 'trade')}` : `${aN} with a stop`,
      state: aN < 10 ? 'wait' : a.expR > 0 ? 'pass' : 'fail',
      hint: aN < 10 ? 'Needs 10+ A-grade trades with a stop. Grade every trade on process, not profit.'
        : a.expR > 0 ? 'Following your plan pays — trust the process when the money is real.' : 'Even your best-process trades lose — the plan itself needs work before money goes in.',
    });
    return out;
  }

  /* ── Plain-language verdict, next step and per-item extras ─ */
  function explain(M) {
    const r = M.r, n = M.gs.length, G = r.gates.length, Y = r.checks.length;
    if (!n) {
      return `Readiness is judged only on your paper account, and it has no closed trades yet${M.openN ? ` (${M.openN} still open — they count once closed)` : ''}. Log every paper trade with a stop and close it; this page then fills in ${G} must-pass gates and ${Y} evidence checks, each with its real number.`;
    }
    if (r.verdict === 'keep') {
      const fails = r.gates.filter(g => !g.pass);
      const names = fails.slice(0, 3).map(g => lc1(g.label)).join('; ') + (fails.length > 3 ? '; …' : '');
      return `${fails.length} of the ${G} must-pass gates ${fails.length === 1 ? 'is' : 'are'} not met yet (${names}). Gates are the minimum proof that your plan works and that you follow it — until every one passes, real money would be paying to test an unproven plan. So far: ${plural(n, 'closed paper trade')}, ${r.passed} of ${Y} evidence checks met.`;
    }
    if (r.verdict === 'close') {
      const need = Math.ceil(Y * 0.7), sig = r.checks.find(c => c.id === 'signif'), parts = [];
      if (sig && sig.state === 'fail') parts.push('your after-cost results are still consistent with no edge (the likely range includes 0R)');
      if (r.passed < need) parts.push(`${r.passed} of ${Y} checks are met and a small live start needs about ${need}`);
      return `All ${G} gates pass — the basics are in place. The evidence is still building: ${parts.join(', and ') || 'a few checks are borderline'}. Keep paper trading; every trade narrows the uncertainty.`;
    }
    return `All ${G} gates pass, the "edge vs. luck" check on your after-cost results is at least partly met, and ${r.passed} of ${Y} checks are met. That supports a small live start at stage 1 of the ramp (${riskTxt(stageCap(1))} risk per trade) — not full size. Expect live results to be worse than paper; the ramp plan below says when to size up or step back.`;
  }
  function topFlag(flags) {
    const e = Object.entries(flags).sort((a, b) => b[1] - a[1])[0];
    return e ? `${FLAG_LABELS[e[0]] || e[0]} (${e[1]}×)` : '';
  }
  function gateExtra(id, M) {
    const r = M.r, n = M.gs.length, a = M.s.adherence || {};
    switch (id) {
      case 'n': return n < 30 ? `Log and close ${plural(30 - n, 'more paper trade')}.` : '';
      case 'exp': return isNum(M.h.expR) ? `After costs you average ${fmtR(M.h.expR)} per trade${isNum(M.h.avgCostR) ? `; costs take about ${fmtNum(M.h.avgCostR, 2)}R of every trade` : ''}.` : 'Log trades with a stop so the app can measure R.';
      case 'clean': return r.cleanStreak >= 10 ? '' : `Current streak: ${plural(r.cleanStreak, 'clean day')} — ${plural(10 - r.cleanStreak, 'more day')} to go.`;
      case 'adh': {
        if (!(a.n30 >= 20)) return `Needs 20+ recent trades to judge (you have ${a.n30 || 0}).`;
        const top = topFlag(M.flags30);
        return `${pct(a.pct30)} of your last ${a.n30} trades followed every rule${top ? ` — most common issue: ${top}` : ''}.`;
      }
      case 'dd': return n ? `Your worst paper drop was ${pct(-M.s.maxDDPct, 1)}.${-M.s.maxDDPct >= 0.2 ? ' Lower your risk per trade or tighten your daily loss limit.' : ''}` : '';
      case 'playbook': return M.undocumented.length ? `Write entry/exit rules for: ${M.undocumented.map(stratName).join(', ')}.` : (r.gates.find(g => g.id === 'playbook') || {}).pass ? '' : 'Pick a strategy from your Playbook on every trade.';
      default: return '';
    }
  }
  function checkExtra(id, M, state) {
    if (state === 'pass') return '';
    switch (id) {
      case 'sample': return M.gs.length < 100 ? `${plural(100 - M.gs.length, 'more trade')} to reach 100.` : '';
      case 'time': {
        const d = Math.max(0, 30 - M.r.calDays), t = Math.max(0, 20 - (M.s.tradingDays || 0));
        return d || t ? `About ${[d ? plural(d, 'more calendar day') : '', t ? plural(t, 'more trading day') : ''].filter(Boolean).join(' and ')}.` : '';
      }
      case 'mcdd': return M.hR.length < 50 ? `${plural(50 - M.hR.length, 'more trade')} with a stop before the simulation runs.` : 'Try a smaller risk per trade in the drawdown panel below.';
      case 'sizing': return 'Set your paper starting balance close to the money you plan to trade live.';
      default: return '';
    }
  }
  function nextStep(M) {
    const r = M.r;
    const g = r.gates.find(x => !x.pass);
    if (g) return { kind: 'gate', id: g.id, label: g.label, hint: g.hint, extra: gateExtra(g.id, M) };
    const c = r.checks.find(x => x.state === 'fail') || r.checks.find(x => x.state === 'partial');
    if (c) return { kind: 'check', id: c.id, label: c.label, hint: c.hint, extra: checkExtra(c.id, M, c.state) };
    return { kind: 'done', id: 'ramp', label: 'Start live at the smallest size', hint: `Begin at stage 1 of the ramp (${riskTxt(stageCap(1))} risk per trade) and review after ${BLOCK} live trades.`, extra: '' };
  }
  const fmtK = (M) => ({
    maxRisk: riskTxt(maxRisk()), daily: S().risk.maxDailyLossPct > 0 ? `${S().risk.maxDailyLossPct}%` : '', liveRisk: riskTxt(M.ctx.liveRiskPct || 1),
    cex: `${fmtNum(M.rtCex, 2)}%`, dex: `${fmtNum(M.rtDex, 2)}%`,
  });

  /* ── Hero: verdict, ring, explanation, next step ───────── */
  function heroHtml(M) {
    const r = M.r, s = M.s, n = M.gs.length, v = r.verdict, Y = r.checks.length, G = r.gates.length, nx = r.next;
    const T = Charts.tokens();
    const col = v === 'ready' ? T.up : v === 'close' ? T.accentL : T.amber;    // status, not P/L
    const aria = `${r.passed} of ${Y} evidence checks met${r.partial ? `, ${r.partial} partly met` : ''}. ${r.gatesPassed} of ${G} must-pass gates passed.`;
    // net result honours the topbar unit switch
    const u = S().units, R = s.rN ? M.totalR : null;
    const uv = u === 'R' ? R : u === '%' ? s.totalReturn : s.pl;
    const ut = fmtUnit({ netPL: s.pl, changePct: s.totalReturn, R });
    const first = M.firstMs;
    const strip = [
      `<span><b>${n}</b> closed paper trade${n === 1 ? '' : 's'}</span>`,
      M.openN ? `<span>${M.openN} open (not counted yet)</span>` : '',
      n && s.noStop ? `<span class="warn-c">${s.noStop} without a stop — no R, counted as rule breaks</span>` : '',
      n ? `<span>Net result <b class="${plClass(uv)}">${glyph(uv)} ${u === '$' ? `<span class="money">${ut}</span>` : ut}</b></span>` : '',
      n ? `<span>Max drawdown <b>${pct(s.maxDDPct, 1)}</b></span>` : '',
      isNum(first) ? `<span>Since ${fmtDate(first)}</span>` : '',
    ].filter(Boolean).join('');
    const acts = [`<button type="button" class="btn btn-ghost btn-sm" data-act="print" title="Print or save as PDF to share with a mentor">${ico('download')}Print / PDF</button>`];
    if (!n) acts.unshift(db.mode === 'paper'
      ? `<button type="button" class="btn btn-primary btn-sm" data-act="new-trade">${ico('plus')}Log a paper trade</button>`
      : `<button type="button" class="btn btn-primary btn-sm" data-act="to-paper">Switch to Paper</button>`);
    if (v === 'ready') acts.unshift(`<button type="button" class="btn btn-primary btn-sm" data-act="goto-ramp">${ico('layers')}See the ramp plan</button>`);
    return `<section class="card rd-hero rd-v-${v}" aria-labelledby="rd-verdict">
      <div class="rd-hero-grid">
        <div class="rd-ring-col">
          <div class="gauge-wrap rd-ring" role="img" aria-label="${esc(aria)}">${Charts.gauge(r.progress, { size: 136, stroke: 11, color: col })}
            <div class="gv" aria-hidden="true"><b>${r.passed}</b><span>of ${Y} checks met</span></div>
          </div>
          <div class="rd-gates ${r.gatesPass ? 'all' : ''}">Gates: <b>${r.gatesPassed}/${G}</b></div>
          ${r.partial ? `<div class="rd-ring-note">+ ${plural(r.partial, 'check')} partly met</div>` : ''}
        </div>
        <div class="rd-hero-main">
          <div class="rd-eyebrow"><span class="badge rd-paper">Paper account</span>${confBadge(n)}</div>
          <h2 class="rd-verdict" id="rd-verdict">${esc(TITLES[v])}</h2>
          <p class="rd-expl">${esc(explain(M))}</p>
          <div class="rd-next">
            <div class="rd-next-ic">${ico(nx.kind === 'done' ? 'check' : 'flag')}</div>
            <div class="rd-next-b">
              <div class="rd-next-l">${nx.kind === 'done' ? 'Next step' : 'Most important next step'}</div>
              <div class="rd-next-t">${esc(nx.label)}</div>
              <div class="rd-next-h">${esc([nx.extra, nx.hint].filter(Boolean).join(' '))}</div>
              ${nx.kind === 'done' ? '' : `<button type="button" class="btn btn-ghost btn-xs rd-next-go no-print" data-act="open-item" data-target="rd-x-${nx.kind}-${esc(nx.id)}">${ico('chevron-d')}Show how it's worked out</button>`}
            </div>
          </div>
          <div class="rd-strip">${strip}</div>
          <p class="rd-caveat">${ico('info')}<span>This is a checklist, not a guarantee. Paper results overstate live results.</span></p>
        </div>
        <div class="rd-hero-acts no-print">${acts.join('')}</div>
      </div>
    </section>`;
  }

  /* ── Gates & evidence checks (expandable) ──────────────── */
  // Analytics always shows the account you are in — say so when that isn't the paper account
  const anNote = () => (db.mode === 'paper' ? '' : ` (shows your ${db.mode} account)`);
  function linkFor(how) {
    if (how.tab) return `<button type="button" class="link-btn rd-link no-print" data-act="an" data-tab="${how.tab}">Open Analytics → ${TAB_LABEL[how.tab] || how.tab}${anNote()}</button>`;
    if (how.go === 'playbook') return '<button type="button" class="link-btn rd-link no-print" data-act="playbook">Open the Playbook</button>';
    if (how.go === 'account') return '<button type="button" class="link-btn rd-link no-print" data-act="settings" data-sec="account">Open Settings → Account</button>';
    return '';
  }
  // Contract §1.6 minimums: below them a check's number is noise, so it is dimmed with what it still
  // needs. The pass / partly / not-yet state stays Metrics.readiness' own, so the ring counts match.
  function earlyNote(id, M) {
    const n = M.gs.length, rn = M.h.n || 0, s = M.s;
    if (!n) return '';
    switch (id) {
      case 'expv': return rn < 20 ? `Early — needs 20+ trades with a stop (you have ${rn}).` : '';
      case 'signif': return rn < 30 ? `Early — needs 30+ trades with a stop (you have ${rn}).` : '';
      case 'winrate': return n < 20 ? `Early — needs 20+ trades (you have ${n}).` : '';
      case 'pf': return s.pfReliable ? '' : `Early — needs 20+ trades and 5+ losses (you have ${plural(n, 'trade')}, ${plural(s.losses || 0, 'loss', 'losses')}).`;
      default: return '';
    }
  }
  // metrics.js writes a few values with an ASCII hyphen or a fixed plural ("1 days");
  // show those the app's way. Every other value is Metrics.readiness' own text. Idempotent.
  function valueOf(kind, it, M) {
    const n = M.gs.length;
    if (kind === 'gate') {
      if (it.id === 'n') return plural(n, 'trade');
      if (it.id === 'dd') return n ? pct(M.s.maxDDPct, 1) : '—';   // "0.0%" with no trades reads like a result
      if (it.id === 'clean' && isNum(M.r.cleanStreak)) return plural(M.r.cleanStreak, 'day');
      return it.value;
    }
    if (it.id === 'sample') return plural(n, 'trade');
    if (it.id === 'time' && isNum(M.r.calDays)) return `${plural(M.r.calDays, 'day')} · ${plural(M.s.tradingDays || 0, 'trading day')}`;
    // metrics.js prints t with toFixed() — a negative t would show an ASCII hyphen ("t = -1.23")
    if (it.id === 'signif' && isNum(M.h.t)) {
      const ci = M.h.ci, fr = (v) => (isNum(v) ? fmtR(v) : '—');
      return `t = ${M.h.t < 0 ? MINUS : ''}${Math.abs(M.h.t).toFixed(2)} · 95% CI ${fr(ci && ci.lo)} to ${fr(ci && ci.hi)}`;
    }
    return it.value;
  }
  // Metrics.readiness' hints assume there is something to measure. With no after-cost interval its
  // 'signif' hint says the edge "is statistically distinguishable from zero" on a failed check, and
  // 'stops' gives no reason for failing when there are no losses — say what is actually missing.
  function hintOf(c, M) {
    if (c.id === 'signif' && !M.h.ci) {
      return M.h.n >= 2 ? 'Every after-cost result so far is the same size, so the test cannot run yet — keep logging.'
        : `Needs at least 2 closed trades with a stop to test (you have ${M.h.n || 0}).`;
    }
    // metrics.js quotes the BEFORE-cost tradesNeeded here, which can read "About 0 more trades … would
    // settle it" while the after-cost range still includes 0. This check is about after-cost results.
    if (c.id === 'signif' && M.h.ci.lo <= 0) {
      const raw = needFor(M.h.t, M.h.n), more = raw == null ? null : Math.max(raw, 30 - M.h.n, 1);
      return `Still consistent with no edge after costs.${more != null
        ? ` About ${more} more trade${more === 1 ? '' : 's'} at this edge would settle it.`
        : ' The after-cost average is not positive, so more of the same trades will not prove an edge.'}`;
    }
    if (c.id === 'stops' && M.s.stopViolationRate == null) return 'No losing trades with a stop yet, so stop discipline cannot be measured.';
    return c.hint;
  }
  // Readiness research: show the win-rate interval as a bar, with your rate and the breakeven tick —
  // "does the low end of the range clear breakeven?" is easier to see than to read. Neutral colours
  // (this is a range, not P/L); dimmed below the 20-trade minimum.
  function wilsonBar(M) {
    const s = M.s;
    if (!s.winCI || !isNum(s.beWinRate) || !isNum(s.winRate)) return '';
    const P = (v) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
    const lo = s.winCI.lo, hi = s.winCI.hi, be = s.beWinRate;
    const read = lo > be ? 'Even the low end of the range clears breakeven.'
      : s.winRate > be ? 'Your win rate is above breakeven, but the likely range still dips below it.' : 'Your win rate is below breakeven.';
    return `<div class="rd-wb${s.n < 20 ? ' rd-dimv' : ''}" role="img" aria-label="${esc(`Win rate ${pct(s.winRate)}, likely range ${pct(lo)} to ${pct(hi)}, breakeven ${pct(be)}. ${read}`)}">
      <div class="rd-wb-track"><span class="rd-wb-band" style="left:${P(lo)};width:${P(hi - lo)}"></span><span class="rd-wb-be" style="left:${P(be)}"></span><span class="rd-wb-dot" style="left:${P(s.winRate)}"></span></div>
      <div class="rd-wb-axis" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
      <div class="rd-wb-leg" aria-hidden="true"><span><i class="rd-sw band"></i>likely range ${pct(lo)}–${pct(hi)}</span><span><i class="rd-wb-k dot"></i>you ${pct(s.winRate)}</span><span><i class="rd-wb-k be"></i>breakeven ${pct(be)}</span></div>
      <p class="rd-wb-read">${esc(read)}</p>
    </div>`;
  }
  function itemHtml(kind, it, M, k) {
    const state = kind === 'gate' ? (it.pass ? 'pass' : 'fail') : it.state;
    const st = STATE[state] || STATE.fail;
    const how = HOW[(kind === 'gate' ? 'g:' : '') + it.id];
    const id = `rd-x-${kind}-${it.id}`;
    const extra = kind === 'gate' ? gateExtra(it.id, M) : checkExtra(it.id, M, it.state);
    const sub = kind === 'gate' ? it.hint : `Target: ${it.target}`;
    const early = kind === 'check' ? earlyNote(it.id, M) : '';
    const value = it.value;     // already formatted by valueOf() in compute()
    const valHtml = early ? `<span class="rd-dimv">${esc(value)}</span>` : esc(value);
    const fixBtns = kind === 'gate' && it.id === 'playbook' && M.undocumented.length
      ? `<div class="rd-btns no-print">${M.undocumented.slice(0, 4).map(sid => `<button type="button" class="btn btn-ghost btn-xs" data-act="playbook" data-id="${esc(sid)}">${ico('edit')}Write rules: ${esc(stratName(sid))}</button>`).join('')}</div>` : '';
    return `<details class="rd-x" id="${id}"${openSet.has(id) ? ' open' : ''}>
      <summary class="ck ${st.cls}">
        <span class="cb">${ico(st.icon)}</span>
        <span class="rd-ckb"><span class="ct">${esc(it.label)}</span><span class="cs">${esc(sub)}</span>${kind === 'check' && it.hint && state !== 'pass' ? `<span class="cs rd-hint">${esc(it.hint)}</span>` : ''}${early ? `<span class="cs rd-gnote">${esc(early)}</span>` : ''}</span>
        <span class="cv">${valHtml}<span class="rd-st ${state}${early ? ' rd-early' : ''}">${st.word}</span></span>
        ${ico('chevron-d', 'rd-chev')}
      </summary>
      <div class="rd-how">
        ${kind === 'check' && it.hint && state === 'pass' ? `<p>${esc(it.hint)}</p>` : ''}
        ${extra ? `<p class="rd-extra">${ico('flag')}<span>${esc(extra)}</span></p>` : ''}
        ${kind === 'check' && it.id === 'winrate' ? wilsonBar(M) : ''}
        ${fixBtns}
        ${how ? `<p><b>How it's worked out:</b> ${esc(how.text(k, M))}</p>${linkFor(how)}` : ''}
      </div>
    </details>`;
  }
  function gatesHtml(M, k) {
    const r = M.r;
    return `<div class="card">
      <h3 class="card-title">${ico('lock')}Must-pass gates${infoTip('Hard minimums. If any gate fails, the verdict is "Keep paper trading", however good the other numbers look.')}<span class="aside">${r.gatesPassed}/${r.gates.length} passed</span></h3>
      <p class="card-sub">The minimum proof that your plan works and that you follow it. Every gate must pass before a live start is suggested.</p>
      <div class="checklist">${r.gates.map(g => itemHtml('gate', g, M, k)).join('')}</div>
    </div>`;
  }
  function checksHtml(M, k) {
    const r = M.r;
    return `<div class="card">
      <h3 class="card-title">${ico('target')}Evidence checks<span class="aside">${r.passed} met · ${r.partial} partly</span></h3>
      <p class="card-sub">Each check shows the number behind it and the target. Open one to see how it's worked out. A live start needs every gate, a borderline-or-better edge test and about ${Math.ceil(r.checks.length * 0.7)} of ${r.checks.length} checks.</p>
      <div class="checklist">${r.checks.map(c => itemHtml('check', c, M, k)).join('')}</div>
    </div>`;
  }

  /* ── Per-setup sample ──────────────────────────────────── */
  function strategyHtml(M) {
    const rows = M.perStrategy.map(p => {
      const thin = p.n < 10, w = Math.min(100, Math.round(p.n / 30 * 100));
      const expC = thin ? '<span class="dim">needs 10+</span>' : `<span class="${plClass(p.expR)}">${fmtR(p.expR)}</span>`;
      const aftC = thin ? '<span class="dim">—</span>' : `<span class="${plClass(p.afterR)}">${fmtR(p.afterR)}</span>`;
      return `<tr class="${thin ? 'rd-thin' : ''}">
        <td><button type="button" class="link-btn rd-sname" data-act="an" data-tab="overview" data-strat="${esc(p.id)}" title="Open this setup in Analytics${anNote()}">${esc(p.name)}</button></td>
        <td><span class="rd-mini ${p.enough ? 'full' : ''}" aria-hidden="true"><i style="width:${w}%"></i></span><span class="mono">${p.n}</span>${p.enough ? ` <span class="badge ok sm">${ico('check')}30+</span>` : `<span class="dim"> · ${30 - p.n} to go</span>`}</td>
        <td class="num">${expC}</td><td class="num">${aftC}</td></tr>`;
    });
    if (M.noStrategyN) rows.push(`<tr class="rd-thin"><td>No strategy</td><td><span class="mono">${M.noStrategyN}</span></td><td colspan="2" class="dim">not counted for any setup</td></tr>`);
    const enough = M.perStrategy.filter(p => p.enough).length;
    return `<div class="card">
      <h3 class="card-title">${ico('book')}Sample per setup<span class="aside">${enough}/${M.perStrategy.length} with 30+</span></h3>
      <p class="card-sub">100 trades spread over 6 setups proves little about any one of them. Trust a setup's numbers once it has 30+ closed trades; rows under 10 are greyed out.</p>
      ${rows.length ? `<div class="table-wrap"><table class="compact-t rd-tbl">
        <thead><tr><th scope="col">Setup</th><th scope="col">Closed trades</th><th scope="col" class="num">Paper R</th><th scope="col" class="num">After costs</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>` : '<p class="dim rd-empty">No closed paper trades yet.</p>'}
    </div>`;
  }

  /* ── Live-costs haircut + trades needed ────────────────── */
  function needHtml(M) {
    const s = M.s, h = M.h, rN = s.rN, need = s.tradesNeeded, MIN_T = 30;
    const needAfter = needFor(h.t, h.n);
    // Contract §1.6: a t-test is not read below 30 results, so the estimate never promises proof sooner
    // (5 similar winners give t ≥ 2 on paper — that is noise, not a proven edge).
    const floor30 = (v, n) => (v == null ? null : Math.max(v, MIN_T - n, 0));
    const shown = floor30(need, rN), shownAfter = floor30(needAfter, h.n);
    const tr = (v) => `${v} more trade${v === 1 ? '' : 's'}`;
    let main, bar = '', after = '';
    if (rN < 2) main = 'Log a few paper trades with a stop first — the estimate needs at least 2 results measured in R.';
    // tradesNeeded is also null when every result is identical (spread 0) — that is not a losing edge
    else if (need == null && isNum(s.expR) && s.expR > 0) main = `Your results so far are all the same size (${fmtR(s.expR)} each), so their variability — and the trades needed — can't be estimated yet. Keep logging.`;
    else if (need == null) main = `Your average trade isn't positive yet (${fmtR(s.expR)}), so more trades of the same kind won't prove an edge — the setup or the execution has to change first.`;
    else if (shown === 0) {   // only reachable with 30+ results
      main = h.ci && h.ci.lo > 0
        ? 'Your edge already stands out from the noise, before and after live costs (t ≥ 2). More trades still narrow the range — and keep checking it holds.'
        : 'Before costs, your edge already stands out from the noise in your results (t ≥ 2). Keep going to confirm it after costs.';
    }
    else if (shown > need) main = `At your current edge and variability the numbers ${need === 0 ? 'would already pass the usual noise test (t ≥ 2)' : `point to about ${tr(need)}`}, but that test isn't reliable below ${MIN_T} trades with a stop — so about <b>${shown}</b> more trade${shown === 1 ? '' : 's'} would show whether the edge is real.`;
    else main = `At your current edge and variability, about <b>${shown}</b> more trade${shown === 1 ? '' : 's'} would show whether the edge is real.`;
    if (rN >= 2 && shown != null) {
      const tot = rN + shown, f = tot ? rN / tot : 1;
      bar = `<div class="meter"><div class="ml"><span>Trades with a stop so far</span><b>${rN} of ~${tot}</b></div>
        <div class="progress-track" role="progressbar" aria-label="Trades logged toward confirming the edge" aria-valuemin="0" aria-valuemax="${tot}" aria-valuenow="${rN}"><div class="progress-fill" style="width:${Math.round(f * 100)}%"></div></div></div>`;
      if (!isNum(h.expR) || h.expR <= 0) after = 'After live costs the average is not positive, so this only holds if you cut costs (wider stops with smaller size, maker orders, a cheaper venue).';
      else if (shownAfter != null && shownAfter !== shown) after = `After live costs: about ${tr(shownAfter)}${shownAfter > shown ? ' — a thinner edge takes longer to prove' : ''}.`;
    }
    const early = rN >= 2 && rN < 20 ? 'Early estimate — it will move a lot as you log more trades.' : '';
    return `<div class="rd-need" id="rd-need" tabindex="-1"><div class="rd-sub-h">How many more trades?</div><p>${main}</p>${bar}
      ${after ? `<p class="rd-dimnote">${esc(after)}</p>` : ''}${early ? `<p class="rd-dimnote">${early}</p>` : ''}</div>`;
  }
  function costHtml(M) {
    const s = M.s, h = M.h, c = M.costs, early = s.rN < 20, ciOk = h.n >= 30;
    // headline R values: sign + colour + ▲/▼ glyph (dimmed, no colour, below 20 trades)
    const tile = (label, v, sub, warn) => `<div class="result-tile ${warn ? 'warnt' : ''}"><div class="rl">${label}</div><div class="rv ${early ? 'rd-muted' : plClass(v)}">${early || !glyph(v) ? '' : `<span class="rd-glyph" aria-hidden="true">${glyph(v)}</span>`}${fmtR(v)}</div><div class="rs">${sub}</div></div>`;
    const drop = isNum(h.expR) && isNum(s.expR) ? h.expR - s.expR : null;
    const gnote = early && s.rN ? ' · <span class="rd-gnote">needs 20+ trades</span>' : '';
    const ciTxt = h.ci ? `${fmtR(h.ci.lo)} to ${fmtR(h.ci.hi)}` : '—';
    const ciRead = !h.ci ? 'needs 2+ trades with a stop' : h.ci.lo > 0 ? 'above 0R — distinguishable from no edge' : h.ci.hi < 0 ? 'below 0R — losing after costs' : 'includes 0R — consistent with no edge';
    const bootTxt = h.boot ? `${fmtR(h.boot.lo)} to ${fmtR(h.boot.hi)}` : '—';
    const bootRead = h.boot ? `${pct(h.boot.pPos)} of 2,000 reshuffles averaged above 0R` : 'needs 10+ trades with a stop';
    const coins = Array.isArray(c.dexCoins) && c.dexCoins.length ? c.dexCoins.slice(0, 6).join(', ') + (c.dexCoins.length > 6 ? '…' : '') : 'none listed';
    const rt = M.gs.length && M.dexN > M.gs.length / 2 ? M.rtDex : M.rtCex;
    const warn = isNum(M.medStopPct) && M.medStopPct > 0 && rt > 0 && M.medStopPct * 100 < 3 * rt
      ? `<div class="rd-warn">${ico('alert')}<div>Your typical stop is <b>${pct(M.medStopPct, 2)}</b> from entry — only ${fmtNum(M.medStopPct * 100 / rt, 1)}× the ${fmtNum(rt, 2)}% round-trip cost, so each trade starts about <b>${fmtNum(rt / (M.medStopPct * 100), 2)}R</b> behind. A wider stop with a smaller position, or maker (limit) orders, shrinks that.</div></div>` : '';
    return `<div class="card" id="rd-costs" tabindex="-1">
      <h3 class="card-title">${ico('scale')}Live costs haircut${tipFor('haircut', 'Paper results re-priced with live fees and slippage, so you see what would likely survive real trading.')}<span class="aside">${confBadge(s.rN)}</span></h3>
      <p class="card-sub">Paper fills are perfect and free. This re-prices every paper trade with live fees and slippage on both sides.</p>
      <div class="result-tiles">
        ${tile('Paper, as logged', s.expR, `average per trade${gnote}`, false)}
        ${tile('After live costs', h.expR, drop != null ? `${fmtR(drop)} vs paper${gnote}` : `average per trade${gnote}`, isNum(h.expR) && h.expR <= 0)}
      </div>
      <div class="stat-rows rd-rows">
        <div class="stat-row"><span class="sl">Average cost per trade</span><span class="sv">${isNum(h.avgCostR) ? `${fmtNum(h.avgCostR, 2)}R` : '—'}<small>fees logged + extra live costs</small></span></div>
        <div class="stat-row ${s.pfReliable ? '' : 'gated'}"><span class="sl">Profit factor, paper → after costs</span><span class="sv">${fmtPF(s.profitFactor)} → ${fmtPF(h.pf)}<small>${s.pfReliable ? 'winning $ ÷ losing $' : 'needs 20 trades and 5 losses'}</small></span></div>
        <div class="stat-row ${ciOk ? '' : 'gated'}"><span class="sl">95% range after costs${tipFor('ci', 'The range where your true average result likely sits. If it includes 0R, your results are still consistent with no edge.')}</span><span class="sv">${ciTxt}<small>${ciOk ? ciRead : 'needs 30+ trades'}</small></span></div>
        <div class="stat-row ${ciOk && h.boot ? '' : 'gated'}"><span class="sl">Bootstrap range${infoTip('Resamples your own after-cost trades 2,000 times. It makes no bell-curve assumption, which suits fat-tailed crypto results.')}</span><span class="sv">${bootTxt}<small>${ciOk ? bootRead : 'needs 30+ trades'}</small></span></div>
      </div>
      <div class="rd-assume">${ico('info')}<span>Assumed live costs: exchanges <b>${fmtNum(M.rtCex, 2)}%</b> round trip (fee ${fmtNum(c.cexFeePct, 2)}% + slippage ${fmtNum(c.cexSlipPct, 2)}% per side); DEX coins and PulseX/9mm trades <b>${fmtNum(M.rtDex, 2)}%</b> (${esc(coins)}).${M.gs.length && M.dexN ? ` ${M.dexN} of ${M.gs.length} trades priced as DEX.` : ''} <button type="button" class="link-btn no-print" data-act="settings" data-sec="costs">Edit cost assumptions</button></span></div>
      ${warn}
      ${needHtml(M)}
    </div>`;
  }

  /* ── Drawdown at live risk (Monte Carlo) ───────────────── */
  function mcOutHtml(M, risk) {
    const m = mcAt(M, risk);
    if (!m) {
      return `<div class="rd-gated">${ico('lock')}<div><b>Needs 50 trades with a stop</b> — you have ${M.hR.length}.<br>A reshuffle of a small sample can never be worse than your worst trade so far, so it would look safer than reality.</div></div>`;
    }
    const p95 = m.maxDD.p95, state = p95 <= 0.2 ? 'pass' : p95 <= 0.3 ? 'partial' : 'fail';
    const pr = (th) => (m.probDD.find(x => Math.abs(x.th - th) < 1e-9) || {}).p;
    return `<div class="rd-mc-head">
        <div class="rd-big">${pct(p95, 0)}</div>
        <div><b>Worst drop in 95% of runs</b> over the next 100 trades at ${riskTxt(risk)} risk <span class="rd-st ${state}">${STATE[state].word}</span>
          <div class="dim">Target ≤ 20% (≤ 30% partly). Typical worst drop: ${pct(m.maxDD.p50, 0)}.</div></div>
      </div>
      <div class="stat-rows rd-rows">
        <div class="stat-row"><span class="sl">Chance of a 10% · 20% · 30% drop</span><span class="sv">${esc(prob(pr(0.1)))} · ${esc(prob(pr(0.2)))} · ${esc(prob(pr(0.3)))}</span></div>
        <div class="stat-row"><span class="sl">Losing streak to be ready for (95% of runs)</span><span class="sv">${Math.round(m.streakP95)} in a row</span></div>
        <div class="stat-row"><span class="sl">Chance of being below the start after 100 trades</span><span class="sv">${esc(prob(m.probLoss))}</span></div>
      </div>
      <div class="chart-box rd-fan"><canvas id="rd-fan-cv"></canvas><div class="chart-tip"></div></div>
      <div class="chart-cap"><span><i class="rd-sw band" aria-hidden="true"></i>5th–95th percentile of account change</span><span><i class="rd-sw line" aria-hidden="true"></i>median path</span></div>
      <p class="rd-note">A range, not a guarantee: it assumes future trades look like your past ones. Real drawdowns can be worse when the market changes.</p>`;
  }
  function mcHtml(M, risk) {
    const can = M.hR.length >= 50;
    const presets = [1, 2, 3, 4].map(i => RAMP_STAGES[i]);
    if (!presets.some(p => Math.abs(p - maxRisk()) < 1e-9)) presets.push(maxRisk());
    const chips = presets.map(p => { const on = Math.abs(p - risk) < 1e-9; return `<button type="button" class="chip sm ${on ? 'on' : ''}" data-act="mc-preset" data-risk="${p}" aria-pressed="${on}" ${can ? '' : 'disabled'}>${riskTxt(p)}</button>`; }).join('');
    return `<div class="card" id="rd-mc" tabindex="-1">
      <h3 class="card-title">${ico('trend-down')}Drawdown at live risk${tipFor('monteCarlo', 'Thousands of reshuffles of your own results show the range of drawdowns you could plausibly hit — not a prediction.')}<span class="aside">${confBadge(M.hR.length)}</span></h3>
      <p class="card-sub">How deep could a losing stretch get over your next 100 trades? 3,000 reshuffles of your after-cost results, with one extra −3R shock trade. Your live limit is ${riskTxt(maxRisk())} per trade.</p>
      <div class="rd-mc-ctl no-print">
        <div class="field"><label for="rd-mc-risk">Try a risk per trade</label>
          <div class="input-group"><input id="rd-mc-risk" class="input sm mono" type="number" inputmode="decimal" min="0.05" max="10" step="0.05" value="${+risk.toFixed(2)}" ${can ? '' : 'disabled'}><span class="addon">%</span></div></div>
        <div class="chip-row" role="group" aria-label="Ramp stage risk presets">${chips}</div>
      </div>
      <div id="rd-mc-out" aria-live="polite">${mcOutHtml(M, risk)}</div>
    </div>`;
  }
  function drawFan(root, m, risk) {
    const cv = root && root.querySelector('#rd-fan-cv');
    if (!cv || !m || !m.bands) return;
    const T = Charts.tokens(), toPct = (x) => (x - 1) * 100;
    const p50 = m.bands.map(b => toPct(b.p50)), lo = m.bands.map(b => toPct(b.p5)), hi = m.bands.map(b => toPct(b.p95));
    Charts.multi(cv, cv.parentElement.querySelector('.chart-tip'), [{ name: 'Median path', color: T.accentL, values: p50 }],
      m.bands.map(b => (b.trade === 0 ? 'Now' : `Trade ${b.trade}`)),
      { band: { lo, hi, color: T.accentL }, baseline: 0, fmtY: (v) => fmtSigned(v, 1), fmtAxis: (v) => fmtSigned(v, Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0) });
    const L = p50.length - 1;
    Charts.label(cv, `Simulated account change over the next 100 trades at ${riskTxt(risk)} risk per trade: median ${fmtSigned(p50[L], 1)}, 5th percentile ${fmtSigned(lo[L], 1)}, 95th percentile ${fmtSigned(hi[L], 1)}.`);
  }
  function setTryRisk(el, v) {
    if (!(v > 0) || v > 10) return;
    tryRisk = v;
    const out = $('#rd-mc-out', el); if (!out) return;
    const M = model();
    out.innerHTML = mcOutHtml(M, v);
    drawFan(out, mcAt(M, v), v);
    $$('[data-act="mc-preset"]', el).forEach(b => { const on = Math.abs(parseFloat(b.dataset.risk) - v) < 1e-9; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  const mcLater = debounce((el) => { const inp = $('#rd-mc-risk', el); if (inp) setTryRisk(el, parseFloat(inp.value)); }, 250);

  /* ── Live ramp plan ────────────────────────────────────── */
  function whyNot(M) {
    const st = M.ramp; if (!st) return 'there are no live trades at this stage yet';
    const out = [];
    if (st.need > 0) out.push(`${plural(st.need, 'more live trade')} until the review`);
    if (!st.adhOk) out.push('rule adherence is below 90%');
    if (!st.edgeOk) out.push('live expectancy is not positive');
    if (st.ddUnknown) out.push("drawdown can't be measured until your live account has a starting balance or deposit");
    else if (!st.ddOk) out.push('drawdown since the stage began is 5% or more');
    return out.join('; ') || 'the conditions are not met';
  }
  function rampAct(M) {
    const st = M.ramp, stage = M.stage;
    if (!st) return null;
    const dd = isNum(st.dd) ? pct(-st.dd, 1) : '—';
    switch (st.action) {
      case 'backToPaper': return { cls: 'stop', icon: 'alert', title: 'Go back to paper', text: `Your live drawdown since this stage began is ${dd}. At 10% the plan says stop live trading, go back to paper and find out what changed — fills, emotions or setups.` };
      case 'demote': return stage > 1
        ? { cls: 'warn', icon: 'trend-down', title: `Step back to stage ${stage - 1}`, text: `Drawdown since this stage began is ${dd} (the limit is 5%). Drop to ${riskTxt(stageCap(stage - 1))} risk and rebuild — stepping back is the plan working, not failing.` }
        : { cls: 'warn', icon: 'trend-down', title: 'Pause and review', text: `Drawdown since you went live is ${dd} and you are already at the smallest size. Pause live trading or go back to paper until you know why.` };
      case 'promote': return { cls: 'ok', icon: 'trend-up', title: `Ready for stage ${stage + 1}`, text: `${st.n} live trades at this stage with rule adherence ≥ 90%, a positive edge and drawdown under 5%. You can move up to ${riskTxt(stageCap(stage + 1))} risk per trade.` };
      default:
        if (st.need > 0) return { cls: 'hold', icon: 'clock', title: `Hold at stage ${stage}`, text: `${plural(st.need, 'more live trade')} until the next review. Keep the size the same until then.` };
        if (stage >= 4) return { cls: 'hold', icon: 'check', title: 'At full planned size', text: `Keep reviewing every ${BLOCK} trades and step back if drawdown since the last review reaches 5%.` };
        return { cls: 'hold', icon: 'clock', title: `Hold at stage ${stage}`, text: `The review isn't passed yet: ${whyNot(M)}. Stay at this size — you can start a fresh ${BLOCK}-trade block.` };
    }
  }
  function rampLiveHtml(M) {
    const st = M.ramp, a = M.rampAdh, stage = M.stage, act = rampAct(M);
    const paperExp = M.h.expR;
    // An empty block (stage just started) has nothing to judge yet — show "waiting", not "not yet"
    const cs = (ok) => (!st.n ? 'wait' : ok ? 'pass' : 'fail');
    const WORD = { pass: 'OK', fail: 'Not yet', wait: 'Waiting' };
    const conds = [
      { state: cs(st.adhOk), label: 'Rule adherence ≥ 90%', sub: a && a.n ? plural(a.n, 'trade') + ' in this block' : 'no live trades in this block yet', value: a && a.n ? pct(a.pct) : '—' },
      { state: cs(st.edgeOk), label: 'Live expectancy positive', sub: isNum(paperExp) && paperExp > 0 ? `ideally at least half your paper edge (${fmtR(paperExp / 2)})` : '', value: fmtR(st.expR) },
      { state: st.ddUnknown ? 'wait' : cs(st.ddOk), label: 'Drawdown since stage start under 5%', sub: M.liveMeasurable ? 'step back at 5%, back to paper at 10%' : 'set a live starting balance so drawdown can be measured', value: st.n && isNum(st.dd) ? pct(-st.dd, 1) : '—' },
    ];
    const f = Math.min(1, st.n / BLOCK);
    const canBlock = st.action === 'hold' && st.need === 0 && stage < 4;
    const showPaper = st.action === 'backToPaper' || (st.action === 'demote' && stage === 1);
    // While the plan says step back / go back to paper, a "Promote" button next to it only invites a bad call
    const canPromote = stage < 4 && st.action !== 'demote' && st.action !== 'backToPaper';
    return `<div class="rd-live">
      <div class="meter"><div class="ml"><span>Live trades since this stage began${M.sinceMs ? ` (${fmtDate(M.sinceMs)})` : ''}</span><b>${st.n} / ${BLOCK}${st.n >= BLOCK ? ' · review due' : ''}</b></div>
        <div class="progress-track" role="progressbar" aria-label="Progress to the next ramp review" aria-valuemin="0" aria-valuemax="${BLOCK}" aria-valuenow="${Math.min(st.n, BLOCK)}"><div class="progress-fill ${f >= 1 ? 'ok' : ''}" style="width:${Math.round(f * 100)}%"></div></div></div>
      <div class="checklist rd-conds">${conds.map(c => `<div class="ck ${STATE[c.state].cls}"><span class="cb">${ico(STATE[c.state].icon)}</span>
        <span class="rd-ckb"><span class="ct">${esc(c.label)}</span>${c.sub ? `<span class="cs">${esc(c.sub)}</span>` : ''}</span>
        <span class="cv">${esc(c.value)}<span class="rd-st ${c.state}">${WORD[c.state]}</span></span></div>`).join('')}</div>
      ${act ? `<div class="rd-act ${act.cls}"><span class="rd-act-ic">${ico(act.icon)}</span><div><div class="rd-act-l">Recommended</div><div class="rd-act-t">${esc(act.title)}</div><div class="rd-act-x">${esc(act.text)}</div></div></div>` : ''}
      <div class="row rd-ramp-acts no-print">
        ${canPromote ? `<button type="button" class="btn ${st.action === 'promote' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-act="ramp-promote">${ico('trend-up')}Promote to stage ${stage + 1}</button>` : ''}
        ${stage > 1 ? `<button type="button" class="btn ${st.action === 'demote' ? 'btn-warn' : 'btn-ghost'} btn-sm" data-act="ramp-back">${ico('trend-down')}Step back to stage ${stage - 1}</button>` : ''}
        ${canBlock ? `<button type="button" class="btn btn-quiet btn-sm" data-act="ramp-block">${ico('refresh')}Start a new ${BLOCK}-trade block</button>` : ''}
        ${showPaper ? '<button type="button" class="btn btn-danger btn-sm" data-act="ramp-paper">Back to paper</button>' : ''}
      </div>
    </div>`;
  }
  function rampHtml(M) {
    const stage = M.stage, on = !!rampR().enabled, mr = maxRisk();
    const stages = [1, 2, 3, 4].map(i => {
      const cls = i < stage ? 'done' : i === stage ? 'cur' : '';
      const capped = mr < RAMP_STAGES[i];
      return `<li class="rd-stage ${cls}"${i === stage ? ' aria-current="step"' : ''}>
        <span class="rd-sn">${i < stage ? ico('check') : i}</span><span class="sr-only">Stage ${i}${i === stage ? ' (current)' : i < stage ? ' (done)' : ''}:</span>
        <b>${riskTxt(RAMP_STAGES[i])}</b><small>${i < 4 ? `${BLOCK}+ live trades` : 'full size'}${capped ? ` · capped at ${riskTxt(mr)}` : ''}</small></li>`;
    }).join('');
    // With no live trades a stage left over from earlier live trading (since deleted) must still be
    // stepped back from here — the plan always starts at stage 1.
    const emptyBack = stage > 1
      ? `<div class="row rd-ramp-acts no-print"><button type="button" class="btn btn-ghost btn-sm" data-act="ramp-back">${ico('trend-down')}Step back to stage ${stage - 1}</button></div>` : '';
    const live = M.liveGs.length ? rampLiveHtml(M)
      : `<div class="rd-ramp-empty">${ico('info')}<div>No live trades yet. When you go live, your first ${BLOCK} live trades count toward stage ${stage}${M.sinceMs ? ` (this block started ${fmtDate(M.sinceMs)})` : ''}. Progress, the review conditions and promote / step-back buttons then appear here.</div></div>${emptyBack}`;
    const balNote = M.liveGs.length && !M.liveMeasurable
      ? `<p class="rd-note warn-c">Your live account has no starting balance, deposit or set balance, so drawdown % can't be measured. <button type="button" class="link-btn" data-act="settings" data-sec="account">Set it in Settings → Account</button></p>` : '';
    return `<div class="card rd-ramp" id="rd-ramp" tabindex="-1">
      <h3 class="card-title">${ico('layers')}Live ramp plan${tipFor('rampStage', 'Go live at a tiny risk per trade and only size up after each block of 25 live trades meets the review conditions.')}<span class="aside">${on ? `Stage ${stage} of 4 · cap ${riskTxt(liveCap(stage))}` : `Ramp off · full ${riskTxt(mr)}`}</span></h3>
      <p class="card-sub">Start tiny, then earn each step up. Each stage lasts at least ${BLOCK} live trades.</p>
      <ol class="rd-stages" aria-label="Ramp stages, risk per trade">${stages}</ol>
      <ul class="rd-rules">
        <li>${ico('trend-up')}<span><b>Move up</b> after a block of ${BLOCK} live trades with rule adherence ≥ 90%, positive live expectancy (ideally at least half your paper edge) and a drawdown under 5% since the stage began.</span></li>
        <li>${ico('trend-down')}<span><b>Step back</b> one stage if the drawdown since the stage began reaches 5%.</span></li>
        <li>${ico('alert')}<span><b>Back to paper</b> at a 10% drawdown — something changed; find out what before risking more.</span></li>
      </ul>
      ${live}${balNote}
      <label class="check rd-toggle no-print"><input type="checkbox" data-act="ramp-toggle"${on ? ' checked' : ''}>Cap my live risk per trade by stage</label>
      <p class="rd-note">${on
        ? `On: in Live mode your maximum risk per trade is capped at the current stage — now ${riskTxt(liveCap(stage))} instead of your full ${riskTxt(mr)} limit. The trade form warns above it and the position-size calculator uses it. Paper mode always uses your full limit.`
        : `Off: Live mode uses your full ${riskTxt(mr)} limit from the first trade. Recommended: on.`}</p>
    </div>`;
  }

  /* ── Paper vs live ─────────────────────────────────────── */
  function compareHtml(M) {
    const liveN = M.liveGs.length, cmp = M.cmp;
    const head = `<h3 class="card-title">${ico('columns')}Paper vs live<span class="aside">${confBadge(liveN, 'live trades')}</span></h3>
      <p class="card-sub">How much of your paper edge survives real fills, fees and emotions.</p>`;
    if (!cmp) {
      return `<div class="card">${head}<div class="rd-gated">${ico('info')}<div>${liveN
        ? `The comparison starts at 5 closed live trades — you have ${liveN}.`
        : 'No live trades yet. Once you have 5 closed live trades this card compares them with your paper results.'}</div></div></div>`;
    }
    const a = cmp.a, b = cmp.b, tr = cmp.transfer, w = cmp.welch;
    // Below 20 trades a side, its win rate / expectancy are shown dimmed — early, not signal (contract §1.6)
    const liveThin = liveN < LIVE_MIN, paperThin = a.n < LIVE_MIN;
    // one verdict scale for every page (Metrics.TRANSFER: ≥ 0.7 good, 0.4–0.7 typical decay, < 0.4 investigate)
    const tv = Metrics.transferVerdict(tr);
    const band = tv ? { cls: { good: 'ok', decay: 'warn', investigate: 'stop' }[tv.key], w: tv.label } : null;
    let welchTxt;
    if (!w) welchTxt = 'Not enough spread in the results yet to test the difference.';
    else {
      const gap = Math.abs(w.diff) < 0.005 ? 'about the same as paper' : `${Math.abs(w.diff).toFixed(2)}R per trade ${w.diff < 0 ? 'lower' : 'higher'} than paper (as logged)`;
      welchTxt = `Live averages ${gap}. ` + (w.p < 0.05
        ? `With ${liveN} live trades that gap is unlikely to be noise alone (Welch test p = ${w.p.toFixed(3)}).`
        : `With ${liveN} live trades that gap could still be noise (Welch test p = ${w.p.toFixed(2)}) — keep both journals going.`);
    }
    const row = (label, pv, lv) => `<tr><th scope="row">${label}</th><td class="num">${pv}</td><td class="num">${lv}</td></tr>`;
    const rc = (v) => `<span class="${plClass(v)}">${fmtR(v)}</span>`;
    const dimIf = (thin, html) => (thin ? `<span class="rd-dimv" title="Early — needs ${LIVE_MIN}+ trades">${html}</span>` : html);
    return `<div class="card">${head}
      <div class="rd-tr">
        <div class="rd-big ${liveThin ? 'rd-muted' : ''}">${tr == null ? 'n/a' : fmtX(tr)}</div>
        <div><b>Transfer ratio</b>${infoTip('Live average R ÷ paper after-cost average R. 1.0 means live matches paper after costs; 0.7 or more is good, 0.4–0.7 is typical decay, below 0.4 investigate.')}
          <div>${band
            // below the live minimum the reading is noise: neutral badge, no green / red verdict
            ? (liveThin ? `<span class="badge cat rd-dimv">Early read: ${band.w.charAt(0).toLowerCase() + band.w.slice(1)}</span>` : `<span class="badge ${band.cls}">${band.w}</span>`)
            : '<span class="dim">Needs a positive paper after-cost edge</span>'}${liveThin ? ` <span class="rd-gnote">needs ${LIVE_MIN}+ live trades</span>` : ''}</div></div>
      </div>
      <div class="table-wrap bare"><table class="compact-t rd-cmp">
        <thead><tr><th scope="col">Metric</th><th scope="col" class="num">Paper</th><th scope="col" class="num">Live</th></tr></thead>
        <tbody>
          ${row('Trades', String(a.n), String(liveN))}
          ${row('Expectancy', dimIf(paperThin, rc(a.expR)), dimIf(liveThin, rc(b.expR)))}
          ${row('Paper after costs', dimIf(paperThin, rc(cmp.paperAfterCost)), '<span class="dim">—</span>')}
          ${row('Win rate', dimIf(paperThin, pct(a.winRate)), dimIf(liveThin, pct(b.winRate)))}
          ${row('Rule adherence (all trades)', pct(a.adherence && a.adherence.pct), pct(M.cmpLiveAdh && M.cmpLiveAdh.pct))}
          ${row('Max drawdown', pct(a.maxDDPct, 1), M.liveMeasurable ? pct(b.maxDDPct, 1) : '<span class="dim" title="Set a live starting balance to measure drawdown">—</span>')}
        </tbody></table></div>
      <p class="rd-welch">${liveThin ? 'Early read. ' : ''}${esc(welchTxt)}</p>
      <button type="button" class="link-btn rd-link no-print" data-act="an" data-tab="compare">Open Analytics → ${TAB_LABEL.compare}</button>
    </div>`;
  }

  /* ── Psychological self-check (advisory) ───────────────── */
  function selfAnswers() { const x = db.readinessSelf; return isO(x) && isO(x.answers) ? x.answers : {}; }
  function selfAt() { const x = db.readinessSelf; return isO(x) ? parseMs(x.at) : null; }
  function selfSummary(a) {
    const yes = SELF.filter(q => a[q.id] === true).length, answered = SELF.filter(q => typeof a[q.id] === 'boolean').length;
    return answered ? `${yes}/${SELF.length} yes` : 'not answered';
  }
  function selfMsg(a) {
    const answered = SELF.filter(q => typeof a[q.id] === 'boolean');
    if (!answered.length) return 'Answer each statement honestly. Nothing here blocks you — it is a mirror, not a gate.';
    const no = SELF.filter(q => a[q.id] === false);
    if (!no.length) return answered.length === SELF.length ? 'All yes. Re-check after your first live losing streak — feelings change when the money is real.' : `So far so good — ${SELF.length - answered.length} still to answer.`;
    return `${plural(no.length, '"not yet" answer')}. Work on ${no.length === 1 ? 'it' : 'those'} before risking money — start with this: ${no[0].fix}.`;
  }
  function selfHtml(M) {
    const a = selfAnswers(), at = selfAt();
    const rows = SELF.map(q => {
      const v = a[q.id], sub = q.sub(M);
      return `<div class="rd-q ${v === true ? 'yes' : v === false ? 'no' : ''}" data-q="${q.id}">
        <div class="rd-qt"><span class="rd-qs">${esc(q.text)}</span>${sub ? `<span class="rd-qh">${esc(sub)}</span>` : ''}</div>
        <div class="seg sm inline rd-yn" role="group" aria-label="${esc(q.text)}" data-yn="${q.id}"></div>
      </div>`;
    }).join('');
    return `<div class="card" id="rd-self" tabindex="-1">
      <h3 class="card-title">${ico('brain')}Ready in your head?<span class="aside" id="rd-self-sum">${selfSummary(a)}</span></h3>
      <p class="card-sub">Paper trading tests your strategy, not you. Answer honestly — this is advice, not a gate, and it stays on this device.</p>
      <div class="rd-self-list">${rows}</div>
      <p class="rd-note rd-self-msg" id="rd-self-msg">${esc(selfMsg(a))}</p>
      <div class="rd-self-foot"><span id="rd-self-at">${at ? `Last answered ${fmtDate(at)}` : 'Not answered yet'}</span>
        <button type="button" class="btn btn-quiet btn-xs no-print" data-act="self-clear">Clear answers</button></div>
      ${signalsHtml(M)}
    </div>`;
  }
  // Behaviour read from the paper journal itself — the honest counterpart to the self-check
  function signalsHtml(M) {
    const rows = (M.signals || []).map(x => {
      const st = STATE[x.state] || STATE.fail;
      const btn = x.review && db.mode === 'paper'
        ? `<button type="button" class="link-btn rd-sig-act no-print" data-act="review" data-key="${esc(x.review)}">Write the review for the week of ${esc(fmtDateShort(dayMs(x.review.slice(2))))}</button>` : '';
      return `<div class="ck ${st.cls}"><span class="cb">${ico(st.icon)}</span>
        <span class="rd-ckb"><span class="ct">${esc(x.label)}</span><span class="cs">${esc(x.hint)}</span>${btn}</span>
        <span class="cv">${esc(x.value)}<span class="rd-st ${x.state}">${st.word}</span></span></div>`;
    }).join('');
    return rows ? `<div class="rd-sig"><div class="rd-sub-h">What your journal says</div>
      <p class="rd-note rd-sig-sub">Worked out from your paper journal — advisory too, but harder to fool than a feeling.</p>
      <div class="checklist">${rows}</div></div>` : '';
  }
  function updateSelf(root) {
    const a = selfAnswers(), at = selfAt();
    $$('.rd-q', root).forEach(q => { const v = a[q.dataset.q]; q.classList.toggle('yes', v === true); q.classList.toggle('no', v === false); });
    const sum = $('#rd-self-sum', root); if (sum) sum.textContent = selfSummary(a);
    const msg = $('#rd-self-msg', root); if (msg) msg.textContent = selfMsg(a);
    const foot = $('#rd-self-at', root); if (foot) foot.textContent = at ? `Last answered ${fmtDate(at)}` : 'Not answered yet';
  }
  function setAnswer(root, id, yes) {
    const cur = isO(db.readinessSelf) ? db.readinessSelf : {};
    const answers = { ...(isO(cur.answers) ? cur.answers : {}), [id]: !!yes };
    db.readinessSelf = { ...cur, answers, at: new Date().toISOString() };
    save();               // advisory data: no recompute / re-render needed
    updateSelf(root);
  }
  function clearSelf() {
    const prev = isO(db.readinessSelf) ? clone(db.readinessSelf) : null;
    if (!prev || !isO(prev.answers) || !Object.keys(prev.answers).length) { toast('No answers to clear yet', 'warn'); return; }
    db.readinessSelf = { answers: {}, at: null };
    save(); Router.render();
    toast('Self-check answers cleared', 'ok', { action: { label: 'Undo', run: () => { db.readinessSelf = prev; save(); Router.render(); } } });
  }

  /* ── Realistic sizing (planned live capital) ───────────── */
  function sizingHtml(M) {
    const cap = S().plannedLiveCapital, start = M.paperC.startingBalance;
    const has = isNum(cap) && cap > 0;
    const chk = M.r.checks.find(c => c.id === 'sizing');
    let body;
    if (!has) body = '<p class="dim rd-empty">Set it to add a "realistic paper balance" check to the evidence list.</p>';
    else if (!chk) body = `<p class="dim rd-empty">Set a paper starting balance to compare. <button type="button" class="link-btn" data-act="settings" data-sec="account">Settings → Account</button></p>`;
    else {
      const st = STATE[chk.state] || STATE.fail;
      body = `<div class="checklist"><div class="ck ${st.cls}"><span class="cb">${ico(st.icon)}</span>
        <span class="rd-ckb"><span class="ct">Paper ${money(start)} vs planned live ${money(cap)}</span><span class="cs">${esc(chk.hint)} Target: ${esc(chk.target)}.</span></span>
        <span class="cv">${fmtNum(start / cap, 1)}×<span class="rd-st ${chk.state}">${st.word}</span></span></div></div>
        ${chk.state !== 'pass' ? '<p class="rd-note">Easiest fix: set the paper starting balance close to your planned live capital, so position sizes and the feeling of each loss match what is coming.</p>' : ''}
        <button type="button" class="link-btn rd-link no-print" data-act="settings" data-sec="account">Change the paper starting balance</button>`;
    }
    return `<div class="card" id="rd-size" tabindex="-1">
      <h3 class="card-title">${ico('wallet')}Realistic sizing</h3>
      <p class="card-sub">Your paper account should be about the size of the money you will really trade, so the habits carry over.</p>
      <div class="rd-cap-row no-print">
        <div class="field"><label for="rd-cap">Planned live capital</label>
          <div class="input-group"><input id="rd-cap" class="input mono money" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 1000" value="${has ? cap : ''}"><span class="addon">USD</span></div></div>
        <button type="button" class="btn btn-primary btn-sm" data-act="cap-save">Save</button>
        ${has ? '<button type="button" class="btn btn-quiet btn-sm" data-act="cap-clear">Clear</button>' : ''}
      </div>
      ${body}
    </div>`;
  }
  function saveCap(el) {
    const inp = $('#rd-cap', el); if (!inp) return;
    const v = parseFloat(String(inp.value).replace(/[,$\s]/g, ''));
    if (!(v > 0) || !isFinite(v)) { toast('Enter the amount you plan to trade live, e.g. 1000', 'warn'); inp.focus(); return; }
    S().plannedLiveCapital = v;
    Bus.emit('settings');
    commit('Planned live capital saved', 'ok');
  }
  function clearCap() {
    const prev = S().plannedLiveCapital;
    if (!isNum(prev)) return;
    S().plannedLiveCapital = null;
    Bus.emit('settings');
    commit();
    toast('Planned live capital cleared', 'ok', { action: { label: 'Undo', run: () => { S().plannedLiveCapital = prev; Bus.emit('settings'); commit('Planned live capital restored', 'ok'); } } });
  }

  /* ── History (one snapshot per day) ────────────────────── */
  const histList = () => (Array.isArray(db.readinessHistory) ? db.readinessHistory : []).filter(x => isO(x) && typeof x.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.day) && isNum(x.passed));
  // Once per calendar day, when the page renders and the paper account has a closed trade.
  // save() only — never commit() from a render (it would re-render in a loop).
  // No module-level "booked today" flag: a backup restore or a paper wipe replaces the history
  // mid-day, and the last-entry check below is cheap and always reads the current db.
  function bookkeep(M) {
    const today = todayISO();
    if (!M.gs.length) return;
    if (typeof StorageGuard !== 'undefined' && StorageGuard.loadError) return;   // save() would refuse and toast
    if (!Array.isArray(db.readinessHistory)) db.readinessHistory = [];
    const h = db.readinessHistory, last = h[h.length - 1];
    if (last && last.day === today) return;
    const r = M.r;
    h.push({ day: today, verdict: r.verdict, passed: r.passed, total: r.checks.length, gatesPassed: r.gatesPassed, n: M.gs.length, expR: isNum(r.haircut.expR) ? +r.haircut.expR.toFixed(4) : null });
    if (h.length > 400) h.splice(0, h.length - 400);
    save();
  }
  function historyHtml() {
    const h = histList();
    if (h.length < 3) {
      return `<div class="card rd-hist-card"><h3 class="card-title">${ico('stats')}Progress over time</h3>
        <p class="dim rd-empty">A line of your checks appears after 3 days of snapshots (${h.length} so far). One snapshot is saved each day you open this page with closed paper trades.</p></div>`;
    }
    const a = h[0], b = h[h.length - 1];
    return `<div class="card rd-hist-card">
      <h3 class="card-title">${ico('stats')}Progress over time<span class="aside">${plural(h.length, 'daily snapshot')}</span></h3>
      <div class="chart-box rd-hist"><canvas id="rd-hist-cv"></canvas><div class="chart-tip"></div></div>
      <div class="legend rd-hist-legend"><span><i class="ln rd-ln-a" aria-hidden="true"></i>Checks met</span><span><i class="ln dash rd-ln-b" aria-hidden="true"></i>Gates passed</span></div>
      <div class="chart-cap"><span>First (${esc(fmtDate(dayMs(a.day)))}): <b>${a.passed}/${isNum(a.total) ? a.total : '—'}</b> checks</span><span>Latest: <b>${b.passed}/${isNum(b.total) ? b.total : '—'}</b> checks · ${esc(TITLES[b.verdict] || '')}</span></div>
    </div>`;
  }
  function drawHistory(el) {
    const cv = $('#rd-hist-cv', el), h = histList();
    if (!cv || h.length < 3) return;
    const T = Charts.tokens();
    Charts.multi(cv, cv.parentElement.querySelector('.chart-tip'), [
      { name: 'Checks met', color: T.accentL, values: h.map(x => x.passed) },
      { name: 'Gates passed', color: cssVar('--lilac', '#C4B5FD'), values: h.map(x => (isNum(x.gatesPassed) ? x.gatesPassed : null)), dash: true },
    ], h.map(x => fmtDateShort(dayMs(x.day))), { fmtY: (v) => String(Math.round(v)), fmtAxis: (v) => (Number.isInteger(v) ? String(v) : '') });
    const a = h[0], b = h[h.length - 1];
    Charts.label(cv, `Readiness snapshots over ${h.length} days: checks met went from ${a.passed} to ${b.passed}, gates passed from ${isNum(a.gatesPassed) ? a.gatesPassed : 'unknown'} to ${isNum(b.gatesPassed) ? b.gatesPassed : 'unknown'}.`);
  }

  /* ── Ramp actions (user-initiated writes → commit) ─────── */
  // One ramp dialog at a time: a double-click must not stack two confirms (and log two overrides).
  let rampBusy = false;
  async function oneAtATime(fn, arg) {
    if (rampBusy) return false;
    rampBusy = true;
    try { await fn(arg); return true; } finally { rampBusy = false; }
  }
  // With the ramp switched off no stage cap applies — don't let a dialog promise a risk change that won't happen
  const capOffNote = () => (rampR().enabled ? '' : '<br><br>The ramp cap is off right now, so the stage only limits live risk once you turn the cap back on.');
  function setStage(stage, msg) {
    const rp = rampW();
    rp.stage = clampStage(stage);
    rp.stageStartAt = new Date().toISOString();   // a new review block starts now
    Bus.emit('settings');
    commit(msg, 'ok');
  }
  async function promote() {
    const M = model(), st = M.stage;
    if (st >= 4) return;
    const next = st + 1, rec = !!(M.ramp && M.ramp.action === 'promote');
    const res = await confirmDialog({
      title: `Promote to stage ${next}?`,
      html: rec
        ? `Your risk cap in Live mode rises to <b>${esc(riskTxt(stageCap(next)))}</b> per trade and a new ${BLOCK}-trade review block starts today.${capOffNote()}`
        : `<b>The review doesn't support this yet:</b> ${esc(whyNot(M))}.<br><br>Moving up early is how small live losses become big ones. If you still want to, write down why — it is saved with your guardrail overrides.${capOffNote()}`,
      confirmText: `Promote to stage ${next}`,
      danger: !rec,
      reason: rec ? null : 'Why promote before the review says so?',
    });
    if (!res) return;
    if (!rec && isO(res) && res.reason) {
      if (!Array.isArray(db.overrides)) db.overrides = [];
      db.overrides.push({ at: new Date().toISOString(), mode: 'live', rule: 'rampPromote', value: next, limit: st, reason: res.reason, tradeId: null });
    }
    setStage(next, `Ramp: stage ${next} · ${riskTxt(stageCap(next))} risk cap`);
  }
  async function stepBack() {
    const st = model().stage;
    if (st <= 1) return;
    const ok = await confirmDialog({
      title: `Step back to stage ${st - 1}?`,
      html: `Your risk cap in Live mode drops to <b>${esc(riskTxt(stageCap(st - 1)))}</b> per trade and a new ${BLOCK}-trade block starts today. Stepping back after a drawdown is the plan working, not failing.${capOffNote()}`,
      confirmText: 'Step back',
    });
    if (ok) setStage(st - 1, `Ramp: back to stage ${st - 1} · ${riskTxt(stageCap(st - 1))} risk cap`);
  }
  async function newBlock() {
    const st = model().stage;
    const ok = await confirmDialog({
      title: `Start a new ${BLOCK}-trade block?`,
      message: `You stay at stage ${st}. Live trades before today stop counting toward this stage's next review.`,
      confirmText: 'Start new block',
    });
    if (ok) setStage(st, `New ${BLOCK}-trade review block started`);
  }
  async function backToPaper() {
    const ok = await confirmDialog({
      title: 'Back to paper?',
      message: `This resets the ramp to stage 1 (${riskTxt(stageCap(1))} risk)${db.mode === 'live' ? ' and switches the app to Paper mode' : ''}. Your live trades stay in the journal.`,
      confirmText: 'Back to paper', danger: true,
    });
    if (!ok) return;
    setStage(1, 'Ramp reset to stage 1');
    if (db.mode !== 'paper') switchMode('paper');
  }
  async function toggleRamp(t) {
    const on = t.checked;
    if (!on) {
      const ok = await confirmDialog({
        title: 'Turn off the live ramp?',
        message: `Live trades would be allowed your full ${riskTxt(maxRisk())} risk per trade straight away. The ramp exists because live results are usually worse than paper at first.`,
        confirmText: 'Turn off', danger: true,
      });
      if (!ok) { t.checked = true; return; }
    }
    rampW().enabled = on;
    Bus.emit('settings');
    commit(on ? 'Live ramp on — risk capped by stage' : 'Live ramp off', 'ok');
  }

  /* ── Render & events ───────────────────────────────────── */
  function modeNote() {
    if (db.mode === 'live') return `<div class="banner info rd-mode no-print">${ico('info')}<div class="grow">You're in <b>Live</b> mode. This checklist always judges your <b>paper</b> account; your live progress is in the ramp plan below.</div></div>`;
    if (db.mode === 'demo') return `<div class="banner info rd-mode no-print">${ico('info')}<div class="grow">Demo data isn't counted here — readiness always judges your own <b>paper</b> account.</div></div>`;
    return '';
  }
  // The page is rebuilt on every commit, unit switch and window resize — and a phone keyboard
  // opening is a resize. Remember the focused control (and a half-typed number) and put it back,
  // so typing into "Planned live capital" or "Try a risk per trade" is not wiped mid-entry.
  const cssq = (v) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'));
  function focusState(el) {
    const a = document.activeElement;
    if (!a || a === el || !el.contains(a)) return null;
    const d = a.dataset || {}, yn = a.closest ? a.closest('[data-yn]') : null;
    let sel = null;
    if (a.id) sel = '#' + cssq(a.id);
    else if (yn && d.id) sel = `[data-yn="${cssq(yn.dataset.yn)}"] button[data-id="${cssq(d.id)}"]`;
    else if (a.tagName === 'SUMMARY' && a.parentElement && a.parentElement.id) sel = `#${cssq(a.parentElement.id)} > summary`;
    else if (d.act) sel = `[data-act="${cssq(d.act)}"]` + ['id', 'risk', 'tab', 'strat', 'sec', 'key', 'target'].filter(x => d[x] != null).map(x => `[data-${x}="${cssq(d[x])}"]`).join('');
    if (!sel) return null;
    const f = { sel, value: null, s: null, e: null };
    if (a.tagName === 'INPUT' && a.type !== 'checkbox') {
      f.value = a.value;
      try { f.s = a.selectionStart; f.e = a.selectionEnd; } catch (e) { /* number inputs have no selection */ }
    }
    return f;
  }
  function restoreFocus(el, f) {
    if (!f) return;
    let t = null;
    try { t = el.querySelector(f.sel); } catch (e) { return; }
    if (!t || t.disabled) return;
    if (f.value != null && t.tagName === 'INPUT') t.value = f.value;
    try {
      t.focus({ preventScroll: true });
      if (f.s != null && t.setSelectionRange) t.setSelectionRange(f.s, f.e);
    } catch (e) { /* best effort */ }
  }
  function scrollToId(el, id) {
    const t = $('#' + id, el); if (!t) return;
    t.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    t.focus({ preventScroll: true });
  }
  // "Show how it's worked out": expand the gate / check row, bring it into view, move focus to it
  function openItem(el, id) {
    const dt = id ? document.getElementById(id) : null;
    if (!dt || !el.contains(dt)) return;
    dt.open = true; openSet.add(dt.id);
    dt.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    const s = dt.querySelector('summary'); if (s) s.focus({ preventScroll: true });
  }
  function bind(el) {
    el.onclick = (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-act]');
      if (!b || !el.contains(b) || b.tagName === 'INPUT') return;   // the ramp checkbox is handled by onchange
      const d = b.dataset;
      switch (d.act) {
        case 'print': window.print(); break;
        case 'an': goAnalytics(d.tab, d.strat ? { strategyId: d.strat } : null); break;
        case 'settings': goSettings(d.sec); break;
        case 'playbook': goPlaybook(d.id); break;
        case 'new-trade': newTrade(); break;
        case 'to-paper': switchMode('paper'); break;
        case 'goto-ramp': scrollToId(el, 'rd-ramp'); break;
        case 'open-item': openItem(el, d.target); break;
        case 'review': goReview(d.key); break;
        case 'mc-preset': { const v = parseFloat(d.risk), inp = $('#rd-mc-risk', el); if (inp) inp.value = String(v); setTryRisk(el, v); break; }
        case 'ramp-promote': oneAtATime(promote); break;
        case 'ramp-back': oneAtATime(stepBack); break;
        case 'ramp-block': oneAtATime(newBlock); break;
        case 'ramp-paper': oneAtATime(backToPaper); break;
        case 'cap-save': saveCap(el); break;
        case 'cap-clear': clearCap(); break;
        case 'self-clear': clearSelf(); break;
        default: break;
      }
    };
    el.onchange = (ev) => {
      const t = ev.target;
      if (!t || !t.dataset || t.dataset.act !== 'ramp-toggle') return;
      // another ramp dialog is open: put the box back to the saved setting
      oneAtATime(toggleRamp, t).then(ran => { if (!ran) t.checked = !!rampR().enabled; });
    };
    const inp = $('#rd-mc-risk', el); if (inp) inp.oninput = () => mcLater(el);
    const cap = $('#rd-cap', el); if (cap) cap.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveCap(el); } };
    // <details> 'toggle' doesn't bubble — bind each one; remember what is open across re-renders
    $$('details.rd-x', el).forEach(dt => dt.addEventListener('toggle', () => {
      if (dt.dataset.printOpened) return;
      if (dt.open) openSet.add(dt.id); else openSet.delete(dt.id);
    }));
    const answers = selfAnswers();
    $$('[data-yn]', el).forEach(box => {
      const id = box.dataset.yn, v = answers[id];
      seg(box, [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'Not yet' }], v === true ? 'yes' : v === false ? 'no' : null, (val) => {
        setAnswer(el, id, val === 'yes');
        // seg() rebuilt its buttons, so the one just pressed is gone — keep keyboard focus on its replacement
        const nb = box.querySelector(`button[data-id="${val === 'yes' ? 'yes' : 'no'}"]`);
        if (nb) nb.focus({ preventScroll: true });
      });
    });
  }
  function render(el) {
    curEl = el;
    if (!peek(() => Metrics) || !peek(() => Charts)) {
      el.innerHTML = `<div class="card"><div class="card-title">Readiness needs the analytics engine</div><div class="muted">metrics.js or charts.js did not load. Reload the app.</div></div>`;
      return;
    }
    const M = model();
    bookkeep(M);
    const risk = tryRisk != null ? tryRisk : maxRisk();
    const k = fmtK(M), n = M.gs.length;
    const focus = focusState(el);
    el.innerHTML = `<div class="rd">
      <div class="rd-print-head">CryptoJournal · Go-live readiness · paper account · printed ${esc(fmtDate(Date.now()))}</div>
      ${modeNote()}
      ${heroHtml(M)}
      <h2 class="section-h">The evidence<span class="aside">from ${plural(n, 'closed paper trade')} ${confBadge(n)}</span></h2>
      <div class="g2 rd-g">
        <div class="stack">${gatesHtml(M, k)}${strategyHtml(M)}</div>
        <div class="stack">${checksHtml(M, k)}</div>
      </div>
      <h2 class="section-h">What changes with real money</h2>
      <div class="g2 rd-g">${costHtml(M)}${mcHtml(M, risk)}</div>
      <h2 class="section-h">How to ramp up</h2>
      <div class="g2 rd-g">${rampHtml(M)}${compareHtml(M)}</div>
      <h2 class="section-h">You, not just the numbers</h2>
      <div class="g2 rd-g">${selfHtml(M)}${sizingHtml(M)}</div>
      ${historyHtml()}
    </div>`;
    bind(el);
    const out = $('#rd-mc-out', el); if (out) drawFan(out, mcAt(M, risk), risk);
    drawHistory(el);
    restoreFocus(el, focus);
    renderSeq++;
  }

  /* ── Wiring ────────────────────────────────────────────── */
  if (typeof Bus !== 'undefined') { Bus.on('refresh', invalidate); Bus.on('settings', invalidate); }
  // Print for a mentor: expand every check while printing, restore afterwards.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeprint', () => {
      if (Router.active !== 'readiness') return;
      $$('.page[data-page="readiness"] details.rd-x:not([open])').forEach(dt => { dt.dataset.printOpened = '1'; dt.open = true; });
    });
    window.addEventListener('afterprint', () => {
      $$('.page[data-page="readiness"] details[data-print-opened]').forEach(dt => { delete dt.dataset.printOpened; dt.open = false; });
    });
  }
  if (typeof Pages !== 'undefined') {
    Pages.register('readiness', {
      title: 'Go-live readiness',
      sub: () => {
        try { const M = model(); return `Paper account · ${plural(M.gs.length, 'closed trade')} · ${TITLES[M.r.verdict]}`; }
        catch (e) { return 'Paper → live evidence checklist'; }
      },
      render,
      onLeave() { curEl = null; },
    });
  }

  /* ── Public API ────────────────────────────────────────── */
  return {
    // The Metrics.readiness() object for the PAPER account (+ n, title, next), cached per data/settings change.
    evaluate() {
      if (!peek(() => Metrics)) return null;
      try { return model().r; } catch (e) { console.error('[readiness]', e); return null; }
    },
    // Navigate here, optionally scrolling to a section: 'ramp' | 'costs' | 'mc' | 'self' | 'size' | 'need'
    show(section) {
      const seq = renderSeq;
      Router.go('readiness');
      if (!section) return;
      // Router.go may render inside a view transition. Wait for THAT render: the hidden section still holds
      // the markup of an earlier visit (so the target already "exists"), and Router resets the scroll after
      // rendering — jumping before it would be undone.
      let tries = 0;
      const jump = () => {
        const el = curEl || document.querySelector('.page[data-page="readiness"]');
        if (renderSeq > seq && el && el.querySelector('#rd-' + section)) scrollToId(el, 'rd-' + section);
        else if (++tries < 12) setTimeout(jump, 80);
      };
      setTimeout(jump, 60);
    },
    invalidate,
  };
})();
