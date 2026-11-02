/* ═══════════════════════════════════════════════════════════
   CryptoJournal — Journal page (pages/journal.js)
   The daily notebook + P&L calendar:
   · Today card — Prepare → Trade → Reflect prompts, journal streak
   · Month calendar (unit-aware, weekly totals, note dots, rule-break
     markers) and a GitHub-style 53×7 year grid
   · Day drawer — the day's trades, pre-market plan, ONE process goal,
     readiness check-in (sleep / stress / mood / HALT), post-session
     review and notes
   · Weekly & monthly reviews with an auto snapshot of the numbers
     (frozen when saved) and a printable report card
   · Review queue (closed trades not reviewed yet) + missed-trade log
   Everything is stored per account mode (db.days / db.reviews /
   db.missed [db.mode]); writes only happen on Save / Delete clicks.
   Public: Journal.openDay(key, focus?) · Journal.openReview(key) ·
   Journal.logMissed(opts?) · Journal.show(month?) ·
   Journal.readinessFor(key?) · Journal.streak() · Journal.focusFor(key?)
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Journal = (() => {
  /* ── Constants ─────────────────────────────────────────── */
  const LS_VIEW = 'cj.jn.view', LS_MISS = 'cj.jn.miss';
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MS_DAY = 86400000;
  const HALT = [
    { id: 'hungry', label: 'Hungry' }, { id: 'angry', label: 'Angry' },
    { id: 'lonely', label: 'Lonely' }, { id: 'tired', label: 'Tired' },
  ];
  // 1–5 self-ratings for the readiness check-in (words feed the screen-reader labels)
  const SCALES = {
    sleep: { label: 'Sleep', lo: 'Poor', hi: 'Great', words: ['', 'very poor', 'poor', 'okay', 'good', 'great'] },
    stress: { label: 'Stress', lo: 'Calm', hi: 'Very stressed', words: ['', 'calm', 'relaxed', 'some stress', 'stressed', 'very stressed'] },
    mood: { label: 'Mood', lo: 'Low', hi: 'Great', words: ['', 'very low', 'low', 'okay', 'good', 'great'] },
  };
  const BIAS = [{ id: 'long', label: '↗ Bullish' }, { id: 'neutral', label: '→ Neutral' }, { id: 'short', label: '↘ Bearish' }];
  const YPN = [{ id: 'yes', label: '✓ Yes' }, { id: 'partly', label: '~ Partly' }, { id: 'no', label: '✕ No' }];
  const GRADES = [
    { id: 'A', label: 'A', aria: 'Grade A — followed every rule' },
    { id: 'B', label: 'B', aria: 'Grade B — minor slips' },
    { id: 'C', label: 'C', aria: 'Grade C — broke an important rule' },
  ];
  const MISS_WHY = [
    { id: 'hesitation', label: 'Hesitated / fear', tone: 'neg' },
    { id: 'away', label: 'Away from screen' },
    { id: 'rules', label: 'Rules said no', tone: 'calm' },
    { id: 'other', label: 'Other' },
  ];
  // Older / demo records use the research wording — map it onto the four reasons the form offers
  const MISS_ALIAS = { fear: 'hesitation', hesitated: 'hesitation', unsure: 'hesitation', 'not at screen': 'away', 'rules not met': 'rules', guardrail: 'rules' };
  const MISS_HINT = {
    '': 'Misses show the "freeze" side of trading — the mirror image of FOMO.',
    hesitation: 'Worth tracking: if these keep working out, practise taking your A+ setups at a smaller size.',
    away: 'Fine — nobody watches 24/7. If it keeps happening, set price alerts at your key levels.',
    rules: 'A good pass — your rules said no, so skipping it was discipline, not a mistake.',
    other: 'Add a note so future-you knows what happened.',
  };
  const FLAG_LABELS = {
    noStop: 'no stop', overRisk: 'risk above limit', stopBlown: 'loss past −1.2R',
    noStrategy: 'no strategy', mistakes: 'mistake tagged', override: 'guardrail override',
  };
  const RULE_LABELS = {
    daily: 'Daily loss limit', weekly: 'Weekly loss limit', count: 'Max trades per day', streak: 'Losses in a row',
    cooldown: 'Cooldown after a loss', heat: 'Open risk (heat)', cluster: 'Correlated exposure', risk: 'Risk per trade',
    stop: 'Stop required', noStop: 'Stop required', strategy: 'Strategy required', leverage: 'Max leverage', cost: 'Cost per trade',
    liq: 'Stop vs liquidation', rampPromote: 'Moved up a live risk stage early',
  };
  // Mistake → a concrete, controllable focus (research: turn each mistake into the next period's goal)
  const FOCUS_FOR = {
    fomo: 'Enter only at my planned level — no chasing',
    late_entry: 'Take my A+ setup when it triggers (smaller size is fine)',
    no_plan: 'Only trade setups written in my Playbook',
    ignored_setup: 'Tick every checklist item before entering',
    oversize: 'Size every trade with the position calculator',
    no_stop: 'Stop placed before every entry',
    moved_stop: 'Never widen a stop once it is placed',
    held_loser: 'Exit when the stop is hit — no hoping',
    early_exit: 'Let winners reach the target or the trailing stop',
    no_tp: 'Take profit at my planned target',
    boredom: 'No trade without a setup on my checklist',
    overconfidence: 'Same size after a winning streak',
    exec_error: 'Double-check size and side before every order',
  };

  /* ── Small helpers ─────────────────────────────────────── */
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* preference only */ } };
  const isO = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (typeof v === 'string' ? v : '');
  const sum = (a) => a.reduce((s, v) => s + (isNum(v) ? v : 0), 0);
  const pad2 = (n) => String(n).padStart(2, '0');
  const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const ico = (id, cls) => `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const call = (fn) => { try { return fn(); } catch (e) { console.error('[journal]', e); return undefined; } };
  // Other module's API, or null when it is missing OR failed while loading (a const whose initialiser
  // threw stays in the TDZ, where even `typeof X` throws)
  const mod = (get) => { try { return get() || null; } catch (e) { return null; } };
  const missWhy = (r) => { const k = MISS_ALIAS[r] || r; return MISS_WHY.some(w => w.id === k) ? k : 'other'; };
  const modeLabel = (m) => ({ paper: 'Paper', live: 'Live', demo: 'Demo' }[m] || String(m));
  // Typed numbers: '' → null, junk → NaN (so the form can flag it); accepts the true minus sign
  const numIn = (v) => { const s = String(v == null ? '' : v).trim().replace(/−/g, '-'); if (!s) return null; const x = Number(s); return isNum(x) ? x : NaN; };
  // A type=number field holding text the browser can't parse (e.g. "1e", "−1" pasted) reports value '' —
  // read that as invalid, not as "left empty", so the value is never silently dropped on save
  const numField = (el) => (!el ? null : el.validity && el.validity.badInput ? NaN : numIn(el.value));
  // Stored text may carry \r\n (imports, other editors); a textarea hands back \n — compare like with like
  const txt = (v) => str(v).replace(/\r\n?/g, '\n').trim();
  // commit() can't report a failed write (storage full, or the load-error lock in save()): count the
  // successful saves so Save buttons only say "saved" — and only close — when it really was
  let saveTick = 0;
  if (typeof Bus !== 'undefined') Bus.on('saved', () => { saveTick++; });
  function commitOk(msg) { const t0 = saveTick; commit(); const ok = saveTick !== t0; if (ok && msg) toast(msg); return ok; }

  /* ── Day keys (local 'YYYY-MM-DD'; noon anchors keep DST arithmetic safe) ── */
  const parseDay = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const validDay = (k) => typeof k === 'string' && DAY_RE.test(k) && Metrics.dayKey(parseDay(k).getTime()) === k;
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return Metrics.dayKey(d.getTime()); };
  const monthKeyOf = (y, m) => `${y}-${pad2(m + 1)}`;
  const firstDayKey = (y, m) => `${monthKeyOf(y, m)}-01`;
  const lastDayKey = (y, m) => `${monthKeyOf(y, m)}-${pad2(new Date(y, m + 1, 0).getDate())}`;
  const fmtLong = (k) => parseDay(k).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const fmtShort = (k) => parseDay(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtWk = (k) => parseDay(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const monthName = (y, m) => new Date(y, m, 1, 12).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const resetHour = () => (S().risk && S().risk.dayResetHour) || 0;
  const tdKey = (ms) => Metrics.tradingDayKey(ms, resetHour());
  const entryMs = (g) => Date.parse(g.trade.entryAt);

  /* ── Transient UI state (survives re-renders) ──────────── */
  const now0 = new Date();
  let cur = { y: now0.getFullYear(), m: now0.getMonth() };   // visible month (and year in Year view)
  let view = lsGet(LS_VIEW, 'cal') === 'year' ? 'year' : 'cal';
  let missScope = lsGet(LS_MISS, 'month') === 'all' ? 'all' : 'month';
  let queueAll = false, missMore = false, lastMode = null;
  const drafts = new Map();   // unsaved drawer / modal values per 'mode|kind|key' (memory only)

  /* ── Per-mode stores (read-only views never create keys) ── */
  const daysRO = () => (isO(db.days) && isO(db.days[db.mode]) ? db.days[db.mode] : {});
  const reviewsRO = () => (isO(db.reviews) && isO(db.reviews[db.mode]) ? db.reviews[db.mode] : {});
  const missedRO = () => (isO(db.missed) && Array.isArray(db.missed[db.mode]) ? db.missed[db.mode].filter(isO) : []);
  function storeFor(kind, mode) {   // write access — Save / Delete handlers only
    if (kind === 'missed') {
      if (!isO(db.missed)) db.missed = {};
      if (!Array.isArray(db.missed[mode])) db.missed[mode] = [];
      return db.missed[mode];
    }
    const top = kind === 'reviews' ? 'reviews' : 'days';
    if (!isO(db[top])) db[top] = {};
    if (!isO(db[top][mode])) db[top][mode] = {};
    return db[top][mode];
  }

  /* ── DayRec content checks ─────────────────────────────── */
  const TEXT_PRE = ['plan', 'levels', 'goal'], TEXT_POST = ['summary', 'wentWell', 'improve'];
  const preOf = (rec) => (isO(rec) && isO(rec.pre) ? rec.pre : {});
  const postOf = (rec) => (isO(rec) && isO(rec.post) ? rec.post : {});
  // clamped: an imported / hand-edited score must not read "150/100 · Ready"
  const scoreOf = (rec) => { const r = preOf(rec).readiness; return isO(r) && isNum(r.score) ? Math.max(0, Math.min(100, Math.round(r.score))) : null; };
  function hasText(rec) {
    if (!isO(rec)) return false;
    const p = preOf(rec), q = postOf(rec);
    return TEXT_PRE.some(k => str(p[k]).trim()) || TEXT_POST.some(k => str(q[k]).trim()) || !!str(rec.notes).trim();
  }
  function planDone(rec) { const p = preOf(rec); return TEXT_PRE.some(k => str(p[k]).trim()) || !!p.bias || isNum(p.maxTrades); }
  const preDone = (rec) => planDone(rec) || scoreOf(rec) != null;
  function postDone(rec) { const q = postOf(rec); return TEXT_POST.some(k => str(q[k]).trim()) || !!q.followedPlan || !!q.grade || !!q.goalMet; }
  const filled = (rec) => isO(rec) && (hasText(rec) || preDone(rec) || postDone(rec));

  /* ── Readiness check-in score ──────────────────────────── */
  // Psychology research heuristic, adapted to 1–5 ratings: 100 − 15 per HALT flag − poor sleep − low mood − high stress.
  // A self-check, not a validated trading signal — it only ever gives advice.
  function readinessScore(r) {
    if (!isO(r)) return null;
    const halt = isO(r.halt) ? r.halt : {};
    const flags = HALT.filter(h => halt[h.id]).length;
    if (![r.sleep, r.stress, r.mood].some(isNum) && !flags) return null;
    let s = 100 - 15 * flags;
    if (isNum(r.sleep)) s -= ({ 1: 25, 2: 20, 3: 8 })[r.sleep] || 0;
    if (isNum(r.mood)) s -= ({ 1: 20, 2: 15 })[r.mood] || 0;
    if (isNum(r.stress)) s -= ({ 5: 20, 4: 12 })[r.stress] || 0;
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  function readinessBand(score) {
    if (!isNum(score)) return null;
    // Band words match the Analytics "check-in vs results" chart (Ready 80+ · A bit off 60–79 · Low under 60)
    if (score >= 80) return { cls: 'ok', word: 'Ready', advice: 'Good to go — trade your plan at normal size.' };
    if (score >= 60) return { cls: 'warn', word: 'A bit off', advice: 'Only take A+ setups today, at normal size or smaller.' };
    if (score >= 50) return { cls: 'warn', word: 'Below par', advice: 'Consider half size today, or paper trade only.' };
    return { cls: 'stop', word: 'Low', advice: 'Consider sitting out today — not trading is a valid position.' };
  }

  /* ── Unit-aware formatting ($ / % / R) ─────────────────── */
  const unit = () => (S().units === 'R' || S().units === '%' ? S().units : '$');
  // o: day-like { pl, r, rN, ret } (Metrics.dailyMap entries, period totals)
  const uv = (o, u) => { u = u || unit(); return !o ? 0 : u === 'R' ? (o.r || 0) : u === '%' ? (o.ret || 0) : (o.pl || 0); };
  const gObj = (g) => ({ pl: g.netPL, r: isNum(g.R) ? g.R : 0, rN: isNum(g.R) ? 1 : 0, ret: isNum(g.changePct) ? g.changePct : null, retN: isNum(g.changePct) ? 1 : 0 });
  // Trades that carry a % (Engine leaves changePct null when the balance before the trade was ≤ 0, e.g. a
  // live account with no starting balance) — dailyMap folds those in as 0%, so count them from the groups
  const retCount = (o) => (!o ? 0 : isNum(o.retN) ? o.retN : Array.isArray(o.groups) ? o.groups.filter(g => isNum(g.changePct)).length : isNum(o.ret) ? 1 : 0);
  // No value in this unit: R needs a stop, % needs a balance — show "—", never a fake 0R / +0.00%
  const noVal = (o, u) => { u = u || unit(); return !o ? true : u === 'R' ? !o.rN : u === '%' ? !retCount(o) : false; };
  const NO_VAL = { R: 'no R (no stop)', '%': 'no % (no balance)' };
  // HTML value — $ goes through money() so privacy mode blurs it
  function unitHtml(o) {
    const u = unit();
    if (u !== '$' && noVal(o, u)) return '<span class="dim">—</span>';
    if (u === 'R') return fmtR(o.r);
    if (u === '%') return fmtPct(o.ret, { sign: true });
    return money(o.pl, { sign: true });
  }
  // Plain text (aria labels, titles) — privacy hides $ as •••
  function unitText(o) {
    const u = unit();
    if (u !== '$' && noVal(o, u)) return '—';
    if (u === 'R') return fmtR(o.r);
    if (u === '%') return fmtPct(o.ret, { sign: true });
    return View.privacy ? '•••' : fmtMoney(o.pl, { sign: true });
  }
  // Compact text for calendar cells & weekly totals (plain text, no HTML)
  function compactText(v) {
    if (!isNum(v)) return '—';
    const u = unit();
    if (u === 'R') return fmtR(v, 1);
    if (u === '%') return fmtPct(v, { sign: true, dp: 1 });
    if (View.privacy) return '•••';
    const a = Math.abs(v), s = v < 0 ? MINUS : v > 0 ? '+' : '';
    const body = a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? Math.round(a / 1000) + 'k' : a >= 1000 ? (a / 1000).toFixed(1) + 'k' : a >= 10 ? a.toFixed(0) : a.toFixed(2);
    return s + '$' + body;
  }
  const sideBadge = (side) => `<span class="badge sm ${side === 'short' ? 'short' : 'long'}">${side === 'short' ? '↘ SHORT' : '↗ LONG'}</span>`;
  const resultBadge = (g) => (!g.closed ? '<span class="badge sm open">OPEN</span>' : g.win ? '<span class="badge sm win">✓ WIN</span>' : g.loss ? '<span class="badge sm loss">✕ LOSS</span>' : '<span class="badge sm be">– BE</span>');
  const stratTxt = (id) => (id ? stratName(id) : 'No strategy');

  /* ── Aggregates for one render ─────────────────────────── */
  function buildCtx() {
    const gs = Metrics.filterGroups(C.groups, {});
    return { gs, dm: Metrics.dailyMap(gs, resetHour()), mctx: metricsCtx(), today: todayISO(), days: daysRO() };
  }
  const daysIn = (dm, from, to) => [...dm.values()].filter(d => d.key >= from && d.key <= to).sort((a, b) => a.key.localeCompare(b.key));
  const noteSet = (x) => new Set(Object.keys(x.days).filter(k => hasText(x.days[k])));
  // day key → number of trades with an automatic rule flag (no stop, over-risk, blown stop, …)
  function flaggedDays(x, from, to) {
    const out = new Map();
    for (const d of x.dm.values()) {
      if (d.key < from || d.key > to) continue;
      const n = d.groups.filter(g => (call(() => Metrics.flagsFor(g, x.mctx)) || []).length).length;
      if (n) out.set(d.key, n);
    }
    return out;
  }
  // Overrides of trashed / purged trades don't count (liveOverrides); rows saved without a mode (older
  // backups) still count when their trade is live in this account.
  function overridesIn(from, to) {
    const legacy = (Array.isArray(db.overrides) ? db.overrides : []).filter(o => isO(o) && !o.mode && o.tradeId && liveById(o.tradeId, db.mode));
    return liveOverrides(db.mode).concat(legacy).filter(o => {
      if (!isO(o)) return false;
      const t = Date.parse(o.at); if (!isFinite(t)) return false;
      const k = tdKey(t);
      return k >= from && k <= to;
    });
  }
  function periodSummary(days) {
    const pl = sum(days.map(d => d.pl)), r = sum(days.map(d => d.r)), rN = sum(days.map(d => d.rN)), retN = sum(days.map(retCount));
    const ret = days.reduce((a, d) => a * (1 + (isNum(d.ret) ? d.ret : 0)), 1) - 1;   // compounding day returns
    const n = sum(days.map(d => d.n)), wins = sum(days.map(d => d.wins)), losses = sum(days.map(d => d.losses));
    const u = unit();
    let best = null, worst = null;
    for (const d of days) { const v = uv(d, u); if (!best || v > uv(best, u)) best = d; if (!worst || v < uv(worst, u)) worst = d; }
    return { days, pl, r, rN, ret, retN, n, wins, losses, green: days.filter(d => d.pl > 0).length, red: days.filter(d => d.pl < 0).length, best, worst, tot: { pl, r, rN, ret, retN } };
  }
  // Consecutive days with a journal entry, counting back from today (today may still be open).
  // A day you traded without journaling breaks it; up to REST_DAYS quiet days in a row (no trades,
  // no entry) don't — crypto never closes, rest is allowed — but a longer break ends the streak.
  const REST_DAYS = 2;
  function journalStreak(x) {
    let k = filled(x.days[x.today]) ? x.today : addDays(x.today, -1), n = 0, idle = 0;
    for (let i = 0; i < 1500; i++) {
      if (filled(x.days[k])) { n++; idle = 0; }
      else if (x.dm.has(k) || ++idle > REST_DAYS) break;
      k = addDays(k, -1);
    }
    return n;
  }
  // What carries into a day's plan: last session's "to improve" and the previous week's / month's review focus
  function carryFor(key) {
    const store = daysRO(), rv = reviewsRO();
    let improve = null;
    for (let i = 1; i <= 14; i++) {
      const k = addDays(key, -i), t = str(postOf(store[k]).improve).trim();
      if (t) { improve = { key: k, text: t }; break; }
    }
    const wk = Metrics.weekKey(parseDay(key).getTime());
    const pw = rv['W:' + addDays(wk, -7)];
    const d = parseDay(key), pm = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12);
    const pmr = rv['M:' + monthKeyOf(pm.getFullYear(), pm.getMonth())];
    const fw = isO(pw) ? str(pw.focus).trim() : '', fm = isO(pmr) ? str(pmr.focus).trim() : '';
    return { improve, focus: fw ? { kind: 'week', text: fw } : fm ? { kind: 'month', text: fm } : null };
  }
  // Daily-routine ticks for a day — read-only here; the Daily Routine page (discipline.js) owns
  // db.routine.weeks[Monday key][taskId] = [Mon..Sun booleans] (the v1 format)
  function routineFor(key) {
    const r = isO(db.routine) ? db.routine : {}, tasks = Array.isArray(r.tasks) ? r.tasks.filter(t => isO(t) && t.id != null) : [];
    if (!tasks.length) return null;
    const d = parseDay(key), wk = isO(r.weeks) ? r.weeks[Metrics.weekKey(d.getTime())] : null, di = (d.getDay() + 6) % 7;
    return { done: tasks.filter(t => isO(wk) && Array.isArray(wk[t.id]) && !!wk[t.id][di]).length, total: tasks.length };
  }
  function focusIdea(mistakeId) {
    const r = S().risk || {};
    if (mistakeId === 'revenge') return `Wait ${r.cooldownMin || 30} minutes after every loss`;
    if (mistakeId === 'overtrading') return `Max ${r.maxTradesDay || 3} trades a day`;
    return FOCUS_FOR[mistakeId] || '';
  }
  // forPeriod: ideas for a weekly / monthly focus ("a day") rather than today's goal ("today")
  function goalIdeas(extra, forPeriod) {
    const r = S().risk || {};
    const list = [].concat(extra || [], ['Only A+ setups', 'Stop on every trade', `Max ${r.maxTradesDay || 3} trades ${forPeriod ? 'a day' : 'today'}`, `Wait ${r.cooldownMin || 30} min after a loss`, 'Follow my checklist on every entry']);
    return [...new Set(list.map(s => str(s).trim()).filter(Boolean))].slice(0, 6);
  }
  const ideaChips = (list) => list.map(t => `<button type="button" class="chip sm" data-goal="${esc(t)}" title="${esc(t)}">${esc(trunc(t, 46))}</button>`).join('');

  /* ── Cross-module helpers (guarded) ────────────────────── */
  function toLedger(filter) {
    const lg = mod(() => Ledger);
    if (lg && lg.show) return call(() => lg.show(filter));
    return Router.go('trades');
  }
  function viewTrade(id) {
    const tf = mod(() => TradeForm);
    if (tf && tf.view) return call(() => tf.view(id));
    return toLedger({ ids: [id] });
  }
  function reviewTrade(id) {
    const tf = mod(() => TradeForm);
    if (tf && tf.review) return call(() => tf.review(id));
    return viewTrade(id);
  }
  // Stable focus ids for core focusBack(): after a save re-renders the page, the drawer / modal hands
  // focus to the re-rendered twin of the control that opened it. Ids derive from each control's action.
  function stampFids(root) {
    const seen = new Map();
    root.querySelectorAll('button').forEach(b => {
      if (b.dataset.fid) return;
      const d = b.dataset, sg = d.id != null && b.closest('.seg[id]');
      const base = d.jn ? 'a-' + d.jn : d.jnDay ? 'st-' + d.jnDay : d.day ? 'day-' + d.day : d.jnReview ? 'rv-' + d.jnReview
        : d.jnView ? 'v-' + d.jnView : d.jnRev ? 'r-' + d.jnRev : d.jnMiss ? 'm-' + d.jnMiss : d.jnMdel ? 'md-' + d.jnMdel
          : d.jnMonth != null ? 'mo-' + d.jnMonth : sg ? `seg-${sg.id}-${d.id}` : null;
      if (!base) return;
      const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      b.dataset.fid = 'jn-' + base + (n > 1 ? '-' + n : '');
    });
  }
  // Fallback when focusBack found no twin (e.g. a day opened from the dashboard calendar): if focus was
  // lost to <body> or is still inside the closing drawer, put it on `sel` in the active page.
  function refocus(sel) {
    setTimeout(() => {
      const a = document.activeElement;
      const lost = !a || a === document.body || !a.isConnected || !!a.closest('.drawer-wrap:not(.open)');
      if (!lost) return;
      const t = document.querySelector('.page.active ' + sel);
      if (t && !t.disabled && t.focus) t.focus({ preventScroll: true });
    }, 30);
  }
  function rerender(focusSel) {
    Router.render();
    if (!focusSel) return;
    const sec = document.querySelector('.page[data-page="journal"]');
    const t = sec && (sec.querySelector(focusSel + ':not([disabled])') || sec.querySelector('[data-jn="prev"]'));
    if (t) t.focus({ preventScroll: true });
  }

  /* ═══ Page: Today card ═════════════════════════════════ */
  function todayCard(x) {
    const k = x.today, rec = x.days[k] || null, d = x.dm.get(k) || null;
    const p = preOf(rec), q = postOf(rec), h = new Date().getHours();
    const plan = planDone(rec), post = postDone(rec);
    const stage = post ? 'done' : h >= 16 && (plan || d) ? 'post' : !plan ? 'pre' : 'trade';
    const score = scoreOf(rec), band = readinessBand(score);
    const goal = str(p.goal).trim(), carry = carryFor(k), streak = journalStreak(x);
    const taken = C.groups.filter(g => isFinite(entryMs(g)) && tdKey(entryMs(g)) === k).length;
    const COPY = {
      pre: ['Start your day', h >= 18 ? 'No plan yet today. Jot down what you would trade — or plan tomorrow instead.' : 'Two minutes before your first trade: a plan, one process goal and a readiness check-in.'],
      trade: ['Trade your plan', 'Your plan is set. Stick to it, and close the day with a short review when you finish.'],
      post: ['Close your day', 'Review the session while it is fresh: what went well, what to improve, and grade your process.'],
      done: ['Day complete', q.followedPlan === 'yes' ? 'Plan followed ✓ — that is the habit that carries over to live trading.' : 'Reviewed and logged. Plan tomorrow whenever you are ready.'],
    }[stage];
    const ACTS = {
      pre: `<button class="btn btn-primary btn-sm" type="button" data-jn="plan">${ico('target')}Start your day</button>${d ? '<button class="btn btn-ghost btn-sm" type="button" data-jn="close">Close your day</button>' : ''}${h >= 18 ? '<button class="btn btn-quiet btn-sm" type="button" data-jn="tomorrow">Plan tomorrow</button>' : ''}`,
      trade: `<button class="btn btn-ghost btn-sm" type="button" data-jn="close">${ico('check')}Close your day</button><button class="btn btn-quiet btn-sm" type="button" data-jn="plan">Edit plan</button>`,
      post: `<button class="btn btn-primary btn-sm" type="button" data-jn="close">${ico('check')}Close your day</button><button class="btn btn-quiet btn-sm" type="button" data-jn="plan">Edit plan</button>`,
      done: `<button class="btn btn-ghost btn-sm" type="button" data-jn="open-today">${ico('edit')}Open today</button><button class="btn btn-quiet btn-sm" type="button" data-jn="tomorrow">Plan tomorrow</button>`,
    }[stage];
    // Reviews due: last week (traded, not reviewed) and — in the first week of a month — last month
    const nudges = [];
    const lastWk = addDays(Metrics.weekKey(Date.now()), -7);
    if (daysIn(x.dm, lastWk, addDays(lastWk, 6)).length && !reviewsRO()['W:' + lastWk]) nudges.push(`<button type="button" class="link-btn" data-jn-review="W:${lastWk}">Last week's review is due →</button>`);
    const nd = parseDay(k);
    if (nd.getDate() <= 7) {
      const pm = new Date(nd.getFullYear(), nd.getMonth() - 1, 1, 12), pk = monthKeyOf(pm.getFullYear(), pm.getMonth());
      if (daysIn(x.dm, firstDayKey(pm.getFullYear(), pm.getMonth()), lastDayKey(pm.getFullYear(), pm.getMonth())).length && !reviewsRO()['M:' + pk]) {
        nudges.push(`<button type="button" class="link-btn" data-jn-review="M:${pk}">${esc(pm.toLocaleDateString('en-US', { month: 'long' }))} review is due →</button>`);
      }
    }
    const steps = [
      { done: plan, label: 'Pre-market plan', sub: goal ? 'Goal: ' + trunc(goal, 60) : 'Plan, key levels, one process goal', act: 'plan' },
      { done: score != null, label: 'Readiness check-in', sub: band ? `${score}/100 · ${band.word}` : 'Sleep, stress, mood, HALT', act: 'checkin' },
      { done: post, label: 'Close the day', sub: post ? (q.grade ? `Process grade ${q.grade}` : 'Reviewed') : 'Review, grade, goal met?', act: 'close' },
    ];
    const v = d ? uv(d) : 0;
    return `<div class="card jn-today">
      <div class="jn-today-grid">
        <div class="jn-today-main">
          <div class="jn-eyebrow">${ico('sparkle')}Today · ${esc(fmtWk(k))}<span class="badge mode sm">${esc(modeLabel(db.mode))}</span></div>
          <div class="jn-today-t">${esc(COPY[0])}</div>
          <p class="jn-today-s">${esc(COPY[1])}</p>
          ${goal ? `<div class="jn-goal">${ico('target')}<span><b>Today's goal</b>${esc(goal)}</span></div>`
            : carry.focus ? `<div class="jn-goal soft">${ico('flag')}<span><b>This ${carry.focus.kind === 'week' ? 'week' : 'month'}'s focus</b>${esc(carry.focus.text)}</span></div>` : ''}
          ${band && band.cls !== 'ok' ? `<div class="jn-rd-note ${band.cls}" role="note">${ico('alert')}<span><b>Today's check-in: ${score}/100.</b> ${esc(band.advice)}</span></div>` : ''}
          <div class="row jn-today-acts">${ACTS}</div>
          ${nudges.length ? `<div class="jn-nudges">${nudges.join('')}</div>` : ''}
        </div>
        <div class="jn-today-side">
          <div class="checklist jn-steps">${steps.map((s, i) => `<button type="button" class="ck ${s.done ? 'done' : ''}" data-jn="${s.act}">
            <span class="cb">${s.done ? ico('check') : `<span class="jn-stepn">${i + 1}</span>`}</span>
            <span class="jn-step-t"><span class="ct">${esc(s.label)}</span><span class="cs">${esc(s.sub)}</span></span>
            <span class="sr-only">${s.done ? '(done)' : '(to do)'}</span></button>`).join('')}</div>
          <div class="jn-tstats">
            <div class="jn-tstat"><span class="l">P/L today</span><b class="${d ? plClass(v) : 'dim'}">${d ? `${glyph(v)} ${unitHtml(d)}` : '—'}</b><small>${d ? `${plural(d.n, 'trade')} closed` : 'nothing closed yet'}</small></div>
            <div class="jn-tstat"><span class="l">Trades taken</span><b>${taken}${isNum(p.maxTrades) ? `<span class="dim"> / ${p.maxTrades}</span>` : ''}</b><small>${isNum(p.maxTrades) ? (taken > p.maxTrades ? '<span class="warn-c">over your plan</span>' : 'of your planned max') : 'opened today'}</small></div>
            <div class="jn-tstat"><span class="l">Journal streak</span><b>${ico('fire', 'jn-fire')}${plural(streak, 'day')}</b><small>${streak ? `${REST_DAYS} quiet days in a row are fine` : 'save a day entry to start one'}</small></div>
          </div>
        </div>
      </div></div>`;
  }

  /* ═══ Page: header, summary, calendar / year ═══════════ */
  function elapsedDays(yr) {
    const now = new Date(), ny = now.getFullYear(), nm = now.getMonth();
    if (yr) {
      if (cur.y > ny) return 0;
      const end = cur.y < ny ? new Date(cur.y, 11, 31, 12) : new Date(ny, nm, now.getDate(), 12);
      return Math.round((end - new Date(cur.y, 0, 1, 12)) / MS_DAY) + 1;
    }
    if (cur.y > ny || (cur.y === ny && cur.m > nm)) return 0;
    return cur.y === ny && cur.m === nm ? now.getDate() : new Date(cur.y, cur.m + 1, 0).getDate();
  }
  // 'this month' / 'this year' while it is current, otherwise 'in September' / 'in 2025'
  const periodWord = (yr, isNow) => (isNow ? (yr ? 'this year' : 'this month')
    : 'in ' + (yr ? String(cur.y) : new Date(cur.y, cur.m, 1, 12).toLocaleDateString('en-US', { month: 'long' })));
  function summaryStrip(sm, yr, isNow) {
    const u = unit(), tv = uv(sm.tot, u), per = periodWord(yr, isNow);
    const alt = [u !== '$' ? money(sm.pl, { sign: true }) : '', u !== 'R' && sm.rN ? fmtR(sm.r) : '', u !== '%' && sm.retN ? fmtPct(sm.ret, { sign: true }) : ''].filter(Boolean).join(' · ');
    const noStop = sm.n - sm.rN, span = elapsedDays(yr);
    const gap = u === 'R' && noStop ? ` · ${plural(noStop, 'trade')} without a stop` : u === '%' && !sm.retN ? ' · set a starting balance to see %' : '';
    const dayTile = (d, kind) => {
      const v = d ? uv(d, u) : 0, ok = !!d && (kind === 'best' ? v > 0 : v < 0);
      const l = kind === 'best' ? 'Best day' : 'Worst day';
      if (!ok) return `<div class="jn-st"><span class="jn-st-l">${l}</span><b class="jn-st-v dim">—</b><span class="jn-st-s">${kind === 'best' ? 'no green day yet' : 'no red day'}</span></div>`;
      return `<button type="button" class="jn-st jn-st-btn" data-jn-day="${d.key}" aria-label="${esc(`${l}: ${fmtLong(d.key)}, ${unitText(d)}. Open the day`)}">
        <span class="jn-st-l">${l}</span><b class="jn-st-v ${plClass(v)}">${glyph(v)} ${unitHtml(d)}</b><span class="jn-st-s">${esc(fmtWk(d.key))} · ${plural(d.n, 'trade')}</span></button>`;
    };
    return `<div class="jn-sum">
      <div class="jn-st hero"><span class="jn-st-l">Net ${per}</span>
        <b class="jn-st-v ${sm.n ? plClass(tv) : 'dim'}">${sm.n ? `${glyph(tv)} ${unitHtml(sm.tot)}` : '—'}</b>
        <span class="jn-st-s">${sm.n ? alt + gap : 'No closed trades'}</span></div>
      <div class="jn-st"><span class="jn-st-l">Days traded</span><b class="jn-st-v">${sm.days.length}</b><span class="jn-st-s">${span ? `of ${plural(span, 'day')}${isNow ? ' so far' : ''}` : 'not started yet'}</span></div>
      <div class="jn-st"><span class="jn-st-l">Green / red ${tipFor('greenDays', 'Days that closed with a net profit vs. days that closed with a net loss.')}</span>
        <b class="jn-st-v"><span class="${sm.green ? 'pos' : ''}">${sm.green}</span><span class="dim"> / </span><span class="${sm.red ? 'neg' : ''}">${sm.red}</span></b>
        <span class="jn-st-s">${sm.days.length ? fmtPct(sm.green / sm.days.length, { dp: 0 }) + ' of days green' : 'no trading days'}</span></div>
      <div class="jn-st"><span class="jn-st-l">Trades</span><b class="jn-st-v">${sm.n}</b>
        <span class="jn-st-s">${sm.n ? `<span class="${sm.n < 20 ? 'dim' : ''}" title="${sm.n < 20 ? 'Win rate needs 20+ trades to mean much' : ''}">${fmtPct(sm.wins / sm.n, { dp: 0 })} won</span>${confBadge(sm.n)}` : 'none closed'}</span></div>
      ${dayTile(sm.best, 'best')}${dayTile(sm.worst, 'worst')}
    </div>`;
  }
  function monthReading(sm, x, flags, yr, isNow) {
    if (!sm.n) return '';
    const parts = [`${sm.green} of ${plural(sm.days.length, 'trading day')} ${periodWord(yr, isNow)} closed green.`];
    const pos = sm.days.filter(d => d.pl > 0), posSum = sum(pos.map(d => d.pl));
    if (pos.length >= 2 && posSum > 0) {
      const top = Math.max(...pos.map(d => d.pl)) / posSum;
      if (top > 0.5) parts.push(`One day made ${fmtPct(top, { dp: 0 })} of the profit — steady days beat one big one.`);
    }
    if (flags.size) parts.push(`Rules were broken on ${plural(flags.size, 'day')} (marked !).`);
    const j = sm.days.filter(d => filled(x.days[d.key])).length;
    parts.push(`You journaled ${j} of ${plural(sm.days.length, 'trading day')}.`);
    return `<div class="reading jn-read">${esc(parts.join(' '))}</div>`;
  }
  function legendHtml(yr) {
    return `<div class="jn-legend${yr ? ' yr' : ''}" aria-hidden="true">
      <span><i class="jn-sw pos"></i>Profit day</span><span><i class="jn-sw neg"></i>Loss day${yr ? ' (striped)' : ''}</span><span><i class="jn-sw flat"></i>Breakeven</span>
      <span><i class="jn-dot"></i>Journal note</span><span><i class="jn-flag-k">!</i>Rule broken</span>
      <span class="dim">Stronger colour = bigger day${yr ? ' · click a square to open the day' : ' · last column = weekly total'}</span></div>`;
  }
  function calCard(x) {
    const yr = view === 'year', now = new Date(), ny = now.getFullYear(), nm = now.getMonth();
    const atEnd = yr ? cur.y >= ny : (cur.y > ny || (cur.y === ny && cur.m >= nm));
    const isNow = yr ? cur.y === ny : (cur.y === ny && cur.m === nm);
    const from = yr ? `${cur.y}-01-01` : firstDayKey(cur.y, cur.m), to = yr ? `${cur.y}-12-31` : lastDayKey(cur.y, cur.m);
    const sm = periodSummary(daysIn(x.dm, from, to));
    const flags = flaggedDays(x, from, to);
    const what = yr ? 'year' : 'month';
    return `<div class="card jn-cal-card">
      <div class="jn-head">
        <div class="jn-mnav" role="group" aria-label="Choose ${what}">
          <button class="btn btn-ghost btn-icon btn-sm" type="button" data-jn="prev" aria-label="Previous ${what}">${ico('chevron-l')}</button>
          <h2 class="jn-mlabel" aria-live="polite">${esc(yr ? String(cur.y) : monthName(cur.y, cur.m))}</h2>
          <button class="btn btn-ghost btn-icon btn-sm" type="button" data-jn="next" aria-label="Next ${what}" ${atEnd ? 'disabled' : ''}>${ico('chevron-r')}</button>
          <button class="btn btn-quiet btn-sm" type="button" data-jn="today" ${isNow ? 'disabled' : ''}>Today</button>
        </div>
        <div class="jn-head-r">
          <div class="seg sm inline" id="jn-view" role="group" aria-label="Calendar view"></div>
          <button class="btn btn-ghost btn-sm" type="button" data-jn="missed">${ico('flag')}Log missed trade</button>
        </div>
      </div>
      ${summaryStrip(sm, yr, isNow)}
      ${yr ? '<div class="jn-year" id="jn-cal"></div><div class="jn-months" id="jn-months"></div>' : '<div class="cal-big jn-cal" id="jn-cal"></div>'}
      ${legendHtml(yr)}
      ${monthReading(sm, x, flags, yr, isNow)}
    </div>`;
  }
  function drawMonth(el, x) {
    const box = el.querySelector('#jn-cal'); if (!box) return;
    const from = firstDayKey(cur.y, cur.m), to = lastDayKey(cur.y, cur.m), u = unit();
    // Rule-break markers ride on the calendar's own marks option (cell class + "!" badge + spoken label);
    // note days get a label-only mark so screen readers hear "journal note" (the dot itself is aria-hidden)
    const flags = flaggedDays(x, from, to), notes = noteSet(x), marks = new Map();
    for (const k of new Set([...flags.keys(), ...[...notes].filter(k => k >= from && k <= to)])) {
      const n = flags.get(k), label = [n ? `${plural(n, 'trade')} broke a rule` : '', notes.has(k) ? 'journal note' : ''].filter(Boolean).join(', ');
      marks.set(k, n ? { cls: 'jn-flagged', badge: '!', label } : { label });
    }
    Charts.calendar(box, x.dm, {
      year: cur.y, month: cur.m, today: x.today, notes, clickAll: true, marks,
      // R / % view: a day whose trades all lack a stop (no R) or a balance (no %) → null = "—", uncoloured
      value: (d) => (noVal(d, u) ? null : uv(d, u)), fmt: compactText, onDay: (k) => openDay(k),
    });
    // R / % view: a whole week with no value gets "—" too (the weekly column only ever sees the summed value)
    if (u !== '$') {
      const lead = (new Date(cur.y, cur.m, 1).getDay() + 6) % 7, weeks = [];
      for (const d of daysIn(x.dm, from, to)) {
        const w = Math.floor((lead + parseDay(d.key).getDate() - 1) / 7);
        weeks[w] = weeks[w] || { n: 0, has: 0 }; weeks[w].n += d.n; weeks[w].has += noVal(d, u) ? 0 : 1;
      }
      const why = u === 'R' ? 'No stop on these trades, so no R' : 'No account balance before these trades, so no %';
      box.querySelectorAll('.cal-week').forEach((wk, i) => { const w = weeks[i], b = wk.querySelector('b'); if (w && w.n && !w.has && b) { b.textContent = '—'; b.title = why; } });
    }
  }
  // GitHub-style year grid: columns = Monday-first weeks, rows = weekdays; same colour logic as the month calendar
  function drawYear(el, x) {
    const box = el.querySelector('#jn-cal'); if (!box) return;
    const y = cur.y, u = unit(), from = `${y}-01-01`, to = `${y}-12-31`;
    const jan1 = new Date(y, 0, 1, 12), start = new Date(jan1);
    start.setDate(1 - ((jan1.getDay() + 6) % 7));
    const startKey = Metrics.dayKey(start.getTime());
    const nWeeks = Math.ceil((Math.round((new Date(y, 11, 31, 12) - start) / MS_DAY) + 1) / 7);
    const yearDays = daysIn(x.dm, from, to);
    const abs = yearDays.filter(d => !noVal(d, u)).map(d => Math.abs(uv(d, u))).filter(v => v > 0).sort((a, b) => a - b);
    const cap = Math.max(1e-9, abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] : 1);
    const T = Charts.tokens(), notes = noteSet(x), flags = flaggedDays(x, from, to);
    const focusKey = x.today >= from && x.today <= to ? x.today : (yearDays.length ? yearDays[yearDays.length - 1].key : from);
    let html = '';
    for (let m = 0; m < 12; m++) {
      const col = Math.floor(Math.round((new Date(y, m, 1, 12) - start) / MS_DAY) / 7);
      html += `<span class="jn-ym" style="grid-column:${col + 2}">${new Date(y, m, 1, 12).toLocaleDateString('en-US', { month: 'short' })}</span>`;
    }
    ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].forEach((w, r) => { if (w) html += `<span class="jn-ywd" style="grid-row:${r + 2}">${w}</span>`; });
    for (let w = 0; w < nWeeks; w++) {
      for (let r = 0; r < 7; r++) {
        const k = addDays(startKey, w * 7 + r), pos = `grid-column:${w + 2};grid-row:${r + 2}`;
        if (k < from || k > to) { html += `<span class="jn-yc out" style="${pos}"></span>`; continue; }
        const d = x.dm.get(k), na = !!d && noVal(d, u), v = d && !na ? uv(d, u) : 0;
        const cls = ['jn-yc', d ? 'has' : '', d && v > 0 ? 'pos' : d && v < 0 ? 'neg' : d ? 'flat' : '', k === x.today ? 'today' : '', k > x.today ? 'fut' : '', notes.has(k) ? 'nt' : '', flags.has(k) ? 'fl' : ''].filter(Boolean).join(' ');
        // background-color (not the shorthand) so the CSS hatch on loss days stays — colour is never the only cue
        const bg = d && v ? `;background-color:${Charts.alpha(v > 0 ? T.up : T.down, (0.12 + 0.5 * Math.sqrt(Math.min(1, Math.abs(v) / cap))).toFixed(3))}` : '';
        const val = na ? NO_VAL[u] : compactText(v);
        const label = `${fmtWk(k)}: ${d ? `${val}, ${plural(d.n, 'trade')}` : 'no trades'}${notes.has(k) ? ', journal note' : ''}${flags.has(k) ? ', rule broken' : ''}`;
        html += `<button type="button" class="${cls}" data-day="${k}" tabindex="${k === focusKey ? 0 : -1}" style="${pos}${bg}" aria-label="${esc(label)}" title="${esc(label)}"></button>`;
      }
    }
    box.innerHTML = `<div class="jn-yg" style="--wk:${nWeeks}" role="group" aria-label="${esc(`${y} by day — arrow keys move between days, Enter opens a day`)}">${html}</div>`;
    const grid = box.firstElementChild;
    grid.onclick = (ev) => { const b = ev.target.closest('button.jn-yc[data-day]'); if (b) openDay(b.dataset.day); };
    // Roving tabindex: one tab stop for 365 squares; arrows move by day (↑↓) and week (←→)
    grid.onkeydown = (ev) => {
      const b = ev.target.closest('button.jn-yc[data-day]'); if (!b) return;
      const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[ev.key];
      let k = step ? addDays(b.dataset.day, step) : ev.key === 'Home' ? from : ev.key === 'End' ? to : null;
      if (!k) return;
      ev.preventDefault();
      if (k < from) k = from; if (k > to) k = to;
      const nb = grid.querySelector(`button.jn-yc[data-day="${k}"]`); if (!nb) return;
      b.tabIndex = -1; nb.tabIndex = 0; nb.focus();
    };
    // Month strip: totals per month, click to open that month's calendar
    const ms = el.querySelector('#jn-months'); if (!ms) return;
    const now = new Date();
    ms.innerHTML = Array.from({ length: 12 }, (_, m) => {
      const sm = periodSummary(daysIn(x.dm, firstDayKey(y, m), lastDayKey(y, m))), v = uv(sm.tot, u);
      const future = new Date(y, m, 1) > now;
      const name = new Date(y, m, 1, 12).toLocaleDateString('en-US', { month: 'short' });
      return `<button type="button" class="jn-mo" data-jn-month="${m}" ${future ? 'disabled' : ''} aria-label="${esc(`${monthName(y, m)}: ${sm.n ? `${unitText(sm.tot)}, ${plural(sm.days.length, 'trading day')}` : 'no trades'}. Open month`)}">
        <span>${name}</span><b class="${sm.n && !noVal(sm.tot, u) ? plClass(v) : 'dim'}">${!sm.n ? '—' : noVal(sm.tot, u) ? '—' : `${glyph(v)} ${esc(compactText(v))}`}</b><small>${sm.n ? plural(sm.days.length, 'day') : '&nbsp;'}</small></button>`;
    }).join('');
  }

  /* ═══ Page: reviews ════════════════════════════════════ */
  function periodLabel(p) {
    if (p.kind === 'month') { const d = parseDay(p.from); return monthName(d.getFullYear(), d.getMonth()); }
    const a = parseDay(p.from), b = parseDay(p.to);
    return `${fmtShort(p.from)} – ${a.getMonth() === b.getMonth() ? b.getDate() : fmtShort(p.to)}, ${b.getFullYear()}`;
  }
  function periodInfo(p, x) {
    const sm = periodSummary(daysIn(x.dm, p.from, p.to));
    const rv = isO(reviewsRO()[p.key]) ? reviewsRO()[p.key] : null;
    const ended = x.today > p.to;
    const status = rv ? 'done' : !sm.n ? (ended ? 'none' : 'open') : ended ? 'due' : 'open';
    return { ...p, sm, rv, status, ended };
  }
  function periodsFor(y, m, x) {
    const first = firstDayKey(y, m), last = lastDayKey(y, m), out = [];
    let wk = Metrics.weekKey(parseDay(first).getTime());
    for (let i = 0; i < 7 && wk <= last; i++) {
      if (wk <= x.today) out.push(periodInfo({ kind: 'week', key: 'W:' + wk, from: wk, to: addDays(wk, 6) }, x));
      wk = addDays(wk, 7);
    }
    if (first <= x.today) out.push(periodInfo({ kind: 'month', key: 'M:' + monthKeyOf(y, m), from: first, to: last }, x));
    return out;
  }
  function reviewRow(r) {
    const ST = {
      done: ['check', '<span class="badge ok sm">✓ Done</span>'],
      due: ['alert', '<span class="badge warn sm">! Due</span>'],
      open: ['clock', `<span class="badge cat sm">${r.kind === 'week' ? 'Due Sunday' : 'Due month-end'}</span>`],
      none: ['minus', '<span class="badge cat sm">Not traded</span>'],
    }[r.status];
    const v = uv(r.sm.tot);
    const rt = r.rv && isNum(r.rv.rating) ? Math.max(1, Math.min(5, Math.round(r.rv.rating))) : 0;   // clamp: repeat() throws on bad data
    const stars = rt ? `<span class="jn-mini-stars" role="img" aria-label="Rated ${rt} of 5">${'★'.repeat(rt)}<span class="dim">${'★'.repeat(5 - rt)}</span></span>` : '';
    const focus = r.rv && str(r.rv.focus).trim() ? ` · focus: ${esc(trunc(r.rv.focus.trim(), 70))}` : '';
    return `<button type="button" class="jn-rv-row ${r.status}" data-jn-review="${esc(r.key)}">
      <span class="jn-rv-ic">${ico(ST[0])}</span>
      <span class="jn-rv-m"><b>${r.kind === 'month' ? 'Month' : 'Week'} · ${esc(periodLabel(r))}</b>
        <span class="jn-sub">${r.sm.n ? `${plural(r.sm.n, 'trade')} · <span class="${plClass(v)}">${unitHtml(r.sm.tot)}</span>` : 'no trades'}${focus}</span></span>
      <span class="jn-rv-st">${stars}${ST[1]}</span></button>`;
  }
  function reviewsCard(x) {
    const rows = periodsFor(cur.y, cur.m, x), due = rows.filter(r => r.status === 'due').length;
    return `<div class="card jn-rev-card">
      <div class="card-title">${ico('book')}Reviews · ${esc(new Date(cur.y, cur.m, 1, 12).toLocaleDateString('en-US', { month: 'long' }))}<span class="aside">${due ? `<span class="badge warn sm">${due} due</span>` : ''}</span></div>
      <p class="card-sub">Ten minutes a week: what worked, what didn't, and ONE focus for next week.</p>
      ${rows.length ? `<div class="jn-list">${rows.map(reviewRow).join('')}</div>` : '<div class="jn-empty">Reviews for this month open once it starts.</div>'}
    </div>`;
  }

  /* ═══ Page: review queue ═══════════════════════════════ */
  function queueCard(x) {
    const list = x.gs.filter(g => !Metrics.isReviewed(g.trade)).sort((a, b) => b.exitMs - a.exitMs);
    const shown = list.slice(0, queueAll ? 60 : 6);
    const pct = x.gs.length ? (x.gs.length - list.length) / x.gs.length : null;
    const rows = shown.map(g => {
      const id = esc(g.trade.id), v = unit() === 'R' ? g.R : unit() === '%' ? g.changePct : g.netPL;
      return `<div class="jn-q">
        <button type="button" class="jn-q-main" data-jn-view="${id}" title="Open trade">${coinIcon(str(g.coin))}
          <span class="jn-q-m"><span class="row tight"><b>${esc(g.coin || '—')}</b>${sideBadge(g.side)}${resultBadge(g)}</span>
            <span class="jn-sub dim">${esc(fmtDateShort(g.exitMs))} · ${esc(stratTxt(g.strategyId))}</span></span>
          <span class="jn-q-v mono ${plClass(v)}">${unitHtml(gObj(g))}</span></button>
        <button type="button" class="btn btn-ghost btn-xs" data-jn-rev="${id}" aria-label="${esc(`Review ${g.coin || ''} trade closed ${fmtDateShort(g.exitMs)}`)}">Review</button></div>`;
    }).join('');
    const body = list.length ? `<div class="jn-list">${rows}</div>
        <div class="jn-more">${list.length > 6 ? `<button type="button" class="link-btn" data-jn="queue-more">${queueAll ? 'Show fewer' : `Show ${Math.min(list.length, 60) - shown.length} more`}</button>` : ''}
          <button type="button" class="link-btn" data-jn="queue-ledger">Open the review list in Trades →</button></div>`
      : x.gs.length ? `<div class="jn-allgood" role="status">${ico('check')}All trades reviewed ✓</div>`
        : '<div class="jn-empty">Closed trades wait here until you review them — tag mistakes (or mark the trade clean) and grade your process.</div>';
    return `<div class="card jn-queue-card">
      <div class="card-title">${ico('check')}To review<span class="aside">${list.length ? `<span class="badge warn sm">${list.length}</span>` : ''}${pct != null ? `<span>${fmtPct(pct, { dp: 0 })} reviewed</span>` : ''}</span></div>
      <p class="card-sub">About 30 seconds a trade: mistakes (or clean), process grade, one lesson.</p>
      ${body}</div>`;
  }

  /* ═══ Page: missed trades ══════════════════════════════ */
  const missDate = (t) => { const ms = Date.parse(t.at); return isFinite(ms) ? fmtDateTime(ms) : '—'; };
  function missedCard(x) {
    const all = missedRO(), mk = monthKeyOf(cur.y, cur.m);
    const list = (missScope === 'all' ? all : all.filter(t => str(t.at).slice(0, 7) === mk)).slice().sort((a, b) => str(b.at).localeCompare(str(a.at)));
    // Passes your rules asked for are not "missed money", so they stay out of the ≈ R total
    const known = list.filter(t => isNum(t.outcomeR) && missWhy(t.reason) !== 'rules');
    const worth = sum(known.map(t => t.outcomeR)), passes = list.filter(t => missWhy(t.reason) === 'rules').length;
    const by = MISS_WHY.map(w => ({ ...w, n: list.filter(t => missWhy(t.reason) === w.id).length })).filter(w => w.n);
    const shown = list.slice(0, missMore ? 200 : 6);
    const why = (id) => (MISS_WHY.find(w => w.id === missWhy(id)) || MISS_WHY[3]).label;
    const rows = shown.map(t => `<div class="jn-q jn-mi">
      <button type="button" class="jn-q-main" data-jn-miss="${esc(t.id)}" title="Edit">${coinIcon(str(t.coin))}
        <span class="jn-q-m"><span class="row tight"><b>${esc(t.coin || '—')}</b>${t.side === 'long' || t.side === 'short' ? sideBadge(t.side) : ''}<span class="badge sm ${missWhy(t.reason) === 'rules' ? 'ok' : 'cat'}">${missWhy(t.reason) === 'rules' ? '✓ ' : ''}${esc(why(t.reason))}</span></span>
          <span class="jn-sub dim">${esc(missDate(t))}${t.strategyId ? ' · ' + esc(stratName(t.strategyId)) : ''}${isNum(t.plannedR) ? ' · planned ' + fmtR(t.plannedR, 1) : ''}</span>
          ${str(t.notes).trim() ? `<span class="jn-mi-n">${esc(t.notes)}</span>` : ''}</span>
        <span class="jn-q-v mono ${plClass(t.outcomeR)}">${isNum(t.outcomeR) ? fmtR(t.outcomeR, 1) : '<span class="dim" title="Outcome not recorded">?</span>'}</span></button>
      <button type="button" class="btn btn-quiet btn-icon btn-xs" data-jn-mdel="${esc(t.id)}" aria-label="${esc(`Delete missed ${t.coin || 'trade'} from ${missDate(t)}`)}">${ico('trash')}</button></div>`).join('');
    const summary = list.length ? `<div class="jn-msum">
        ${known.length ? `<div class="jn-msum-v">${ico('flag')}<span><b>${plural(known.length, 'missed trade')}</b> worth ≈ <b class="${plClass(worth)}">${fmtR(worth, 1)}</b> <span class="dim">(outcomes you recorded · hindsight)</span></span></div>` : ''}
        ${passes ? `<div class="jn-msum-v ok">${ico('check')}<span><b>${plural(passes, 'correct pass', 'correct passes')}</b> — your rules said no, and you listened.</span></div>` : ''}
        ${by.length ? `<div class="chip-row">${by.map(w => `<span class="badge cat sm">${esc(w.label)} · ${w.n}</span>`).join('')}</div>` : ''}
      </div>` : '';
    return `<div class="card jn-miss-card">
      <div class="card-title">${ico('flag')}Missed trades<span class="aside"><span class="seg sm inline" id="jn-mscope" role="group" aria-label="Missed trades period"></span></span></div>
      <p class="card-sub">Setups you saw but didn't take. They expose hesitation — and praise the passes your rules asked for.</p>
      ${summary}
      ${list.length ? `<div class="jn-list">${rows}</div>${list.length > 6 ? `<div class="jn-more"><button type="button" class="link-btn" data-jn="miss-more">${missMore ? 'Show fewer' : `Show all ${list.length}`}</button></div>` : ''}`
        : `<div class="jn-empty">${missScope === 'all' ? 'No missed trades logged yet.' : 'No missed trades logged this month.'} Log one when you hesitate or skip a setup.</div>`}
      <div class="jn-more"><button type="button" class="btn btn-ghost btn-sm" data-jn="missed">${ico('plus')}Log missed trade</button>${all.length && missScope !== 'all' ? `<span class="dim">${plural(all.length, 'missed trade')} all time</span>` : ''}</div>
    </div>`;
  }

  /* ═══ Render + page-level events ═══════════════════════ */
  function render(el) {
    if (!C && typeof recompute === 'function') recompute();
    if (!C) { el.innerHTML = '<div class="card"><div class="muted">Loading your journal…</div></div>'; return; }
    if (lastMode !== db.mode) { lastMode = db.mode; queueAll = false; missMore = false; }
    const x = buildCtx(), now = new Date();
    const showToday = cur.y === now.getFullYear() && cur.m === now.getMonth();
    el.innerHTML = `<div class="jn">${showToday ? todayCard(x) : ''}${calCard(x)}
      <div class="jn-cols">${reviewsCard(x)}${queueCard(x)}${missedCard(x)}</div></div>`;
    const vs = el.querySelector('#jn-view');
    if (vs) seg(vs, [{ id: 'cal', label: 'Calendar' }, { id: 'year', label: 'Year' }], view, (v) => { view = v; lsSet(LS_VIEW, v); rerender('#jn-view button.on'); });
    const msc = el.querySelector('#jn-mscope');
    if (msc) seg(msc, [{ id: 'month', label: 'This month' }, { id: 'all', label: 'All' }], missScope, (v) => { missScope = v; missMore = false; lsSet(LS_MISS, v); rerender('#jn-mscope button.on'); });
    if (view === 'year') drawYear(el, x); else drawMonth(el, x);
    stampFids(el);
    el.onclick = (ev) => onPageClick(ev, el);
  }
  function onPageClick(ev, el) {
    const t = ev.target.closest('[data-jn],[data-jn-day],[data-jn-review],[data-jn-view],[data-jn-rev],[data-jn-miss],[data-jn-mdel],[data-jn-month]');
    if (!t || !el.contains(t) || t.disabled) return;
    const d = t.dataset, today = todayISO();
    if (d.jnDay) return openDay(d.jnDay);
    if (d.jnReview) return openReview(d.jnReview);
    if (d.jnView) return viewTrade(d.jnView);
    if (d.jnRev) return reviewTrade(d.jnRev);
    if (d.jnMiss) return logMissed({ id: d.jnMiss });
    if (d.jnMdel) return deleteMissed(d.jnMdel);
    if (d.jnMonth != null) { cur = { y: cur.y, m: +d.jnMonth }; view = 'cal'; lsSet(LS_VIEW, 'cal'); return rerender('[data-jn="prev"]'); }
    switch (d.jn) {
      case 'prev': case 'next': {
        const s = d.jn === 'prev' ? -1 : 1;
        if (view === 'year') cur = { y: cur.y + s, m: cur.m };
        else { const nd = new Date(cur.y, cur.m + s, 1); cur = { y: nd.getFullYear(), m: nd.getMonth() }; }
        return rerender(`[data-jn="${d.jn}"]`);
      }
      case 'today': { const n = new Date(); cur = { y: n.getFullYear(), m: n.getMonth() }; return rerender('[data-jn="prev"]'); }
      case 'plan': return openDay(today, 'pre');
      case 'checkin': return openDay(today, 'checkin');
      case 'close': return openDay(today, 'post');
      case 'open-today': return openDay(today);
      case 'tomorrow': return openDay(addDays(today, 1), 'pre');
      case 'missed': return logMissed();
      case 'queue-more': queueAll = !queueAll; return rerender('[data-jn="queue-more"]');
      case 'queue-ledger': return toLedger({ status: 'review' });
      case 'miss-more': missMore = !missMore; return rerender('[data-jn="miss-more"]');
      default: return undefined;
    }
  }

  /* ═══ Day drawer ═══════════════════════════════════════ */
  function valuesFrom(rec) {
    const p = preOf(rec), q = postOf(rec), r = isO(p.readiness) ? p.readiness : {}, halt = isO(r.halt) ? r.halt : {};
    const sc = (n) => (isNum(n) && n >= 1 && n <= 5 ? Math.round(n) : null);
    const t = txt;
    return {
      plan: t(p.plan), bias: ['long', 'short', 'neutral'].includes(p.bias) ? p.bias : '', levels: t(p.levels),
      maxTrades: isNum(p.maxTrades) ? p.maxTrades : null, goal: t(p.goal),
      sleep: sc(r.sleep), stress: sc(r.stress), mood: sc(r.mood),
      halt: { hungry: !!halt.hungry, angry: !!halt.angry, lonely: !!halt.lonely, tired: !!halt.tired },
      summary: t(q.summary), wentWell: t(q.wentWell), improve: t(q.improve),
      followedPlan: ['yes', 'partly', 'no'].includes(q.followedPlan) ? q.followedPlan : '',
      grade: ['A', 'B', 'C'].includes(q.grade) ? q.grade : '',
      goalMet: q.goalMet === true ? 'yes' : q.goalMet === false ? 'no' : ['yes', 'partly', 'no'].includes(q.goalMet) ? q.goalMet : '',
      notes: t(isO(rec) ? rec.notes : ''),
    };
  }
  // Merge known fields into a DayRec section, keeping unknown keys (other modules / future versions)
  function mergeSection(old, vals, nowIso) {
    const base = isO(old) ? { ...old } : {};
    const snap = () => JSON.stringify(Object.keys(vals).map(k => (base[k] == null ? null : base[k])));
    const before = snap();
    for (const [k, v] of Object.entries(vals)) { if (v == null || v === '') delete base[k]; else base[k] = v; }
    if (!Object.keys(vals).some(k => base[k] != null)) { delete base.at; return Object.keys(base).length ? base : null; }
    if (before !== snap() || !base.at) base.at = nowIso;
    return base;
  }
  function writeDay(key, vals) {
    let rec = dayRec(key, true);
    if (!isO(rec)) { rec = {}; storeFor('days', db.mode)[key] = rec; }   // a hand-edited / corrupt value can't break the save
    const nowIso = new Date().toISOString();
    const halt = { hungry: !!vals.halt.hungry, angry: !!vals.halt.angry, lonely: !!vals.halt.lonely, tired: !!vals.halt.tired };
    const score = readinessScore({ sleep: vals.sleep, stress: vals.stress, mood: vals.mood, halt });
    let readiness = null;
    if (score != null) {
      const old = isO(preOf(rec).readiness) ? preOf(rec).readiness : {};
      readiness = {};
      for (const [k, v] of Object.entries(old)) if (!['sleep', 'stress', 'mood', 'halt', 'score'].includes(k)) readiness[k] = v;
      for (const k of ['sleep', 'stress', 'mood']) if (isNum(vals[k])) readiness[k] = vals[k];
      readiness.halt = halt; readiness.score = score;
    }
    const pre = mergeSection(rec.pre, { plan: vals.plan, bias: vals.bias, levels: vals.levels, maxTrades: isNum(vals.maxTrades) ? vals.maxTrades : null, goal: vals.goal, readiness }, nowIso);
    const post = mergeSection(rec.post, { summary: vals.summary, wentWell: vals.wentWell, improve: vals.improve, followedPlan: vals.followedPlan, grade: vals.grade, goalMet: vals.goalMet }, nowIso);
    if (pre) rec.pre = pre; else delete rec.pre;
    if (post) rec.post = post; else delete rec.post;
    if (vals.notes) rec.notes = vals.notes; else delete rec.notes;
    if (!Object.keys(rec).length) delete storeFor('days', db.mode)[key];
    // Celebrate process, never profit
    const n = journalStreak({ today: todayISO(), days: daysRO(), dm: Metrics.dailyMap(Metrics.filterGroups(C.groups, {}), resetHour()) });
    const base = vals.followedPlan === 'yes' ? 'Day saved — plan followed ✓' : 'Day saved';
    return n >= 2 ? `${base} · ${n}-day journal streak` : base;
  }

  // Single-choice segmented control; clicking the active option clears it (core seg() can't deselect)
  function pickSeg(el, options, value, onChange) {
    if (!el) return;
    let v = value == null ? '' : String(value);
    el.classList.add('seg', 'sm');
    el.innerHTML = options.map(o => `<button type="button" data-v="${esc(o.id)}" class="${o.id === v ? 'on' : ''}" aria-pressed="${o.id === v}"${o.aria ? ` aria-label="${esc(o.aria)}"` : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>${esc(o.label)}</button>`).join('');
    el.onclick = (ev) => {
      const b = ev.target.closest('button[data-v]'); if (!b) return;
      v = v === b.dataset.v ? '' : b.dataset.v;
      el.querySelectorAll('button[data-v]').forEach(x => { const on = x.dataset.v === v; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      if (onChange) onChange(v);
    };
  }
  function scaleCtl(el, kind, value, onChange) {
    const sc = SCALES[kind];
    pickSeg(el, [1, 2, 3, 4, 5].map(n => ({ id: String(n), label: String(n), title: sc.words[n], aria: `${sc.label} ${n} of 5 — ${sc.words[n]}` })), value == null ? '' : String(value), (x) => onChange(x ? +x : null));
  }

  function tradeRow(g, kind, flags) {
    const em = entryMs(g);
    const when = kind === 'closed' ? `Closed ${fmtTime(g.exitMs)}` : g.closed && isNum(g.exitMs) ? `Opened ${isFinite(em) ? fmtTime(em) : ''} · closed ${fmtDateShort(g.exitMs)}` : `Opened ${isFinite(em) ? fmtTime(em) : ''}`;
    const fl = (flags || []).map(f => FLAG_LABELS[f] || f);
    return `<button type="button" class="jn-q-main jn-tr" data-d-view="${esc(g.trade.id)}" title="Open trade">${coinIcon(str(g.coin))}
      <span class="jn-q-m"><span class="row tight"><b>${esc(g.coin || '—')}</b>${sideBadge(g.side)}${resultBadge(g)}${g.closed && !Metrics.isReviewed(g.trade) ? '<span class="badge warn sm">REVIEW</span>' : ''}</span>
        <span class="jn-sub dim">${esc(when)} · ${esc(stratTxt(g.strategyId))}${g.trade.grade ? ' · grade ' + esc(g.trade.grade) : ''}</span>
        ${fl.length ? `<span class="jn-sub warn-c">! ${esc(fl.join(', '))}</span>` : ''}</span>
      <span class="jn-q-v mono ${plClass(g.netPL)}">${g.closed ? `${money(g.netPL, { sign: true })}${isNum(g.R) ? `<small>${fmtR(g.R)}</small>` : ''}` : '<span class="dim">open</span>'}</span></button>`;
  }
  function daySummaryHtml(o) {
    const d = o.d, tile = (l, v, sub, cls) => `<div class="jn-ds"><span class="l">${l}</span><b class="${cls || ''}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const tiles = [
      tile('P/L', d ? `${glyph(d.pl)} ${money(d.pl, { sign: true })}` : '—', d ? [d.rN ? fmtR(d.r) : 'no stop → no R', retCount(d) ? fmtPct(d.ret, { sign: true }) : ''].filter(Boolean).join(' · ') : 'nothing closed', d ? plClass(d.pl) : 'dim'),
      tile('Trades', d ? String(d.n) : '0', o.opened.length ? `+${o.opened.length} opened` : 'closed'),
      // one day is always a tiny sample: dimmed (like the month strip below 20 trades), the W/L count carries it
      tile('Win rate', d ? fmtPct(d.wins / d.n, { dp: 0 }) : '—', d ? `${d.wins}W · ${d.losses}L` : '', d && d.n < 20 ? 'jn-gated' : d ? '' : 'dim'),
      tile('Rules', d ? (o.flaggedN ? `! ${o.flaggedN}` : '✓ clean') : '—', d ? (o.flaggedN ? plural(o.flaggedN, 'trade') + ' flagged' : 'no rule flags') : '', o.flaggedN ? 'warn-c' : d ? '' : 'dim'),
    ].join('');
    let auto = '';
    if (o.flaggedN || o.ovs.length) {
      const fchips = Object.entries(o.flagCounts).map(([k, n]) => `<span class="badge warn sm">${esc(FLAG_LABELS[k] || k)}${n > 1 ? ' ×' + n : ''}</span>`).join('');
      const ruleName = (r) => (typeof r === 'string' && Object.prototype.hasOwnProperty.call(RULE_LABELS, r) ? RULE_LABELS[r] : str(r) || 'rule');
      const ov = o.ovs.map(v => `<div class="jn-ov">${ico('alert')}<span><b>Guardrail override:</b> ${esc(ruleName(v.rule))}${v.reason ? ` — “${esc(v.reason)}”` : ''}</span></div>`).join('');
      auto = `<div class="jn-auto" role="note">${o.flaggedN ? `<div class="jn-auto-h">${ico('flag')}<b>${plural(o.flaggedN, 'trade')} broke a rule</b><span class="dim">found automatically</span></div><div class="chip-row">${fchips}</div>` : ''}${ov}</div>`;
    }
    return `<div class="jn-dsum">${tiles}</div>${auto}`;
  }
  function anchorHtml(o) {
    if (o.isFuture) return 'Fill this in after the session.';
    const lead = o.isToday ? 'So far today' : 'That day';
    if (!o.d && !o.taken) return `${lead}: no trades. A day without trades can still be a good day — if your rules said no, that is discipline.`;
    const parts = [];
    if (o.d) parts.push(`<b>${plural(o.d.n, 'trade')}</b> closed`, `<b class="${plClass(o.d.pl)}">${money(o.d.pl, { sign: true })}</b>${o.d.rN ? ` (${fmtR(o.d.r)})` : ''}`);
    parts.push(`${plural(o.taken, 'trade')} taken${isNum(o.v0.maxTrades) ? ` of ${o.v0.maxTrades} planned` : ''}`);
    if (o.d) parts.push(o.flaggedN ? `<span class="warn-c">${plural(o.flaggedN, 'rule break')}</span>` : 'no rule flags');
    return `${lead}: ${parts.join(' · ')}`;
  }
  function dayHtml(o) {
    const v = o.v, risk = S().risk || {};
    const preOpen = o.draft || o.focus === 'pre' || o.focus === 'checkin' || (!o.focus && (o.isFuture || (o.isToday && (!planDone(o.stored) || o.h < 16)) || (o.isPast && preDone(o.stored))));
    const postOpen = o.draft || o.focus === 'post' || (!o.focus && !o.isFuture && (o.isPast || o.h >= 16 || postDone(o.stored)));
    const carry = [];
    if (o.carry.focus) carry.push(`<div class="jn-carry">${ico('flag')}<span><b>This ${o.carry.focus.kind}'s focus</b> (from your review): “${esc(o.carry.focus.text)}”</span><button type="button" class="link-btn" data-d="use-goal" data-text="${esc(o.carry.focus.text)}">Use as goal</button></div>`);
    if (o.carry.improve) carry.push(`<div class="jn-carry">${ico('undo')}<span><b>Last session</b> (${esc(fmtShort(o.carry.improve.key))}) you wanted to improve: “${esc(trunc(o.carry.improve.text, 160))}”</span></div>`);
    if (o.routine) carry.push(`<div class="jn-carry jn-rt">${ico('routine')}<span><b>Daily routine</b> ${o.routine.done} of ${plural(o.routine.total, 'task')} ticked${o.isToday ? ' so far' : ''}</span><button type="button" class="link-btn" data-d="routine">Open routine →</button></div>`);
    const ideas = goalIdeas(o.carry.focus ? [o.carry.focus.text] : []);
    const trades = o.closed.length + o.opened.length;
    return `<div class="jn-day">
      ${o.draft ? `<div class="banner info jn-draft">${ico('edit')}<div class="grow">Restored your unsaved draft for this day.</div><div class="acts"><button type="button" class="btn btn-ghost btn-xs" data-d="discard">Discard draft</button></div></div>` : ''}
      ${daySummaryHtml(o)}
      <section class="jn-sec" aria-labelledby="jn-d-tr-h">
        <div class="jn-sec-h"><h4 id="jn-d-tr-h">${ico('trades')}Trades</h4><span class="aside">${trades ? '<button type="button" class="link-btn" data-d="ledger">Open in ledger →</button>' : ''}</span></div>
        <div class="jn-sec-b">
          ${trades ? `<div class="jn-list">${o.closed.map(g => tradeRow(g, 'closed', o.flagsBy.get(g.trade.id))).join('')}${o.opened.map(g => tradeRow(g, 'opened')).join('')}</div>`
            : `<div class="jn-empty">${o.isFuture ? 'Planning ahead — trades you close this day will show here.' : 'No trades closed or opened this day.'}</div>`}
          <div class="row tight jn-tr-acts">${o.isToday ? `<button type="button" class="btn btn-ghost btn-xs" data-d="new">${ico('plus')}Log a trade</button>` : ''}<button type="button" class="btn btn-quiet btn-xs" data-d="missed">${ico('flag')}Log a missed trade</button></div>
        </div>
      </section>
      <details class="jn-sec" id="jn-d-pre"${preOpen ? ' open' : ''}>
        <summary class="jn-sec-h"><h4>${ico('target')}Pre-market plan</h4><span class="aside">${planDone(o.stored) ? '✓ planned' : 'before your first trade'}</span></summary>
        <div class="jn-sec-b form-grid">
          ${carry.join('')}
          <div class="field full"><label for="jn-d-plan">Plan <span class="opt">setups you're watching, when you'd trade</span></label>
            <textarea class="input" id="jn-d-plan" rows="3" maxlength="4000" placeholder="BTC ranging under 69k — only long a retest of 66.8k with a 1H close above it.">${esc(v.plan)}</textarea></div>
          <div class="field"><label id="jn-d-bias-l">Market bias</label><div id="jn-d-bias" role="group" aria-labelledby="jn-d-bias-l"></div></div>
          <div class="field"><label for="jn-d-max">Max trades today</label>
            <input class="input mono" id="jn-d-max" type="number" min="0" max="100" step="1" inputmode="numeric" value="${isNum(v.maxTrades) ? v.maxTrades : ''}" placeholder="${esc(risk.maxTradesDay || '')}" aria-describedby="jn-d-max-h">
            <div class="hint" id="jn-d-max-h"></div></div>
          <div class="field full"><label for="jn-d-levels">Key levels <span class="opt">optional</span></label>
            <input class="input" id="jn-d-levels" maxlength="300" value="${esc(v.levels)}" placeholder="BTC 66.8k support · 69k resistance · ETH 2.45k"></div>
          <div class="field full"><label for="jn-d-goal">ONE process goal for the day</label>
            <input class="input" id="jn-d-goal" maxlength="140" value="${esc(v.goal)}" placeholder="e.g. Only A+ setups" aria-describedby="jn-d-goal-h">
            <div class="chip-row jn-ideas" role="group" aria-label="Goal ideas">${ideaChips(ideas)}</div>
            <div class="hint" id="jn-d-goal-h">Something you control — a behaviour, not a P/L target.</div></div>
          <div class="form-section">Readiness check-in ${infoTip('How fit you are to trade today. Bad sleep, stress, a low mood or any HALT box makes rule-breaking more likely. It is a self-check, not a proven signal — and not your paper → live readiness, which is the evidence checklist on the Readiness page.')}</div>
          <div class="field full jn-scales">${['sleep', 'stress', 'mood'].map(k => `<div class="jn-scale">
            <span class="jn-scale-l" id="jn-d-${k}-l">${SCALES[k].label}</span>
            <div class="jn-scale-s" id="jn-d-${k}" role="group" aria-labelledby="jn-d-${k}-l"></div>
            <span class="jn-scale-e" aria-hidden="true"><span>1 · ${esc(SCALES[k].lo)}</span><span>${esc(SCALES[k].hi)} · 5</span></span></div>`).join('')}</div>
          <fieldset class="field full jn-halt"><legend>HALT check ${infoTip('HALT comes from recovery practice: when you are Hungry, Angry, Lonely or Tired you are more likely to break your rules. A sensible self-check, not a proven trading signal.')}</legend>
            <div class="jn-halt-g">${HALT.map(hh => `<label class="check"><input type="checkbox" data-halt="${hh.id}"${v.halt[hh.id] ? ' checked' : ''}> ${hh.label}</label>`).join('')}</div></fieldset>
          <div class="field full"><div class="jn-ready" id="jn-d-ready" aria-live="polite"></div></div>
        </div>
      </details>
      <details class="jn-sec" id="jn-d-post"${postOpen ? ' open' : ''}>
        <summary class="jn-sec-h"><h4>${ico('check')}Post-session review</h4><span class="aside">${postDone(o.stored) ? '✓ reviewed' : o.isFuture ? 'after the session' : ''}</span></summary>
        <div class="jn-sec-b form-grid">
          <div class="field full"><div class="jn-anchor">${anchorHtml(o)}</div></div>
          <div class="field full"><label for="jn-d-sum">Session summary</label>
            <textarea class="input" id="jn-d-sum" rows="2" maxlength="4000" placeholder="Choppy morning, one clean breakout, stopped after two losses as planned.">${esc(v.summary)}</textarea></div>
          <div class="field full"><label for="jn-d-well">What went well</label>
            <textarea class="input" id="jn-d-well" rows="2" maxlength="4000" aria-describedby="jn-d-well-h">${esc(v.wentWell)}</textarea>
            <div class="hint" id="jn-d-well-h">Write the wins too — a journal of only mistakes breeds frustration.</div></div>
          <div class="field full"><label for="jn-d-imp">What to improve</label>
            <textarea class="input" id="jn-d-imp" rows="2" maxlength="4000" aria-describedby="jn-d-imp-h">${esc(v.improve)}</textarea>
            <div class="hint" id="jn-d-imp-h">It shows up in your next session's plan.</div></div>
          <div class="field"><label id="jn-d-fp-l">Followed my plan?</label><div id="jn-d-fp" role="group" aria-labelledby="jn-d-fp-l"></div>
            ${o.flaggedN ? `<div class="hint warn">${plural(o.flaggedN, 'trade')} had a rule flag — be honest with yourself.</div>` : ''}</div>
          <div class="field"><label id="jn-d-gr-l">Day grade ${infoTip('Grade your process, not the P/L. A = followed every rule, B = minor slips, C = broke an important rule. A red day can be an A day.')}</label><div id="jn-d-gr" role="group" aria-labelledby="jn-d-gr-l"></div></div>
          <div class="field full"><label id="jn-d-gm-l">Goal met?</label><div class="jn-goal-echo" id="jn-d-goal-echo"></div><div id="jn-d-gm" role="group" aria-labelledby="jn-d-gm-l"></div></div>
        </div>
      </details>
      <details class="jn-sec" id="jn-d-notes-s" open>
        <summary class="jn-sec-h"><h4>${ico('journal')}Notes</h4></summary>
        <div class="jn-sec-b"><div class="field"><label for="jn-d-notes" class="sr-only">Notes for the day</label>
          <textarea class="input" id="jn-d-notes" rows="3" maxlength="8000" placeholder="Anything else — news, how you felt, ideas to test.">${esc(v.notes)}</textarea></div></div>
      </details>
      <div class="jn-dfoot"><span class="dim jn-kbd"><kbd>Ctrl</kbd> <kbd>Enter</kbd> saves</span><span class="sp"></span>
        <button type="button" class="btn btn-ghost" data-d="cancel">Close</button>
        <button type="button" class="btn btn-primary" data-d="save">${ico('check')}Save day</button></div>
    </div>`;
  }
  // Wires the drawer's controls; returns read() → current form values (same key order as valuesFrom)
  function mountDay(body, o, ctl) {
    const q = (s) => body.querySelector(s);
    const picks = { bias: o.v.bias, sleep: o.v.sleep, stress: o.v.stress, mood: o.v.mood, followedPlan: o.v.followedPlan, grade: o.v.grade, goalMet: o.v.goalMet };
    const val = (id) => { const e = q('#' + id); return e ? e.value.trim() : ''; };
    const read = () => ({
      plan: val('jn-d-plan'), bias: picks.bias || '', levels: val('jn-d-levels'), maxTrades: numField(q('#jn-d-max')), goal: val('jn-d-goal'),
      sleep: picks.sleep, stress: picks.stress, mood: picks.mood,
      halt: HALT.reduce((a, hh) => { const c = q(`[data-halt="${hh.id}"]`); a[hh.id] = !!(c && c.checked); return a; }, {}),
      summary: val('jn-d-sum'), wentWell: val('jn-d-well'), improve: val('jn-d-imp'),
      followedPlan: picks.followedPlan || '', grade: picks.grade || '', goalMet: picks.goalMet || '', notes: val('jn-d-notes'),
    });
    // Readiness meter (live)
    const readyEl = q('#jn-d-ready');
    const drawReady = () => {
      if (!readyEl) return;
      const halt = read().halt, sc = readinessScore({ sleep: picks.sleep, stress: picks.stress, mood: picks.mood, halt }), b = readinessBand(sc);
      readyEl.innerHTML = sc == null ? '<span class="dim">Rate sleep, stress and mood (or tick a HALT box) to see your readiness score.</span>'
        : `<div class="meter"><div class="ml"><span>Today's readiness · <b class="jn-rd-w ${b.cls}">${b.word}</b></span><b>${sc}<span class="dim"> / 100</span></b></div>
          <div class="progress-track" role="progressbar" aria-label="Today's readiness score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sc}"><div class="progress-fill ${b.cls === 'ok' ? '' : b.cls}" style="width:${sc}%"></div></div></div>
          <div class="jn-ready-a ${b.cls}">${esc(b.advice)}</div>`;
    };
    pickSeg(q('#jn-d-bias'), BIAS, picks.bias, (x) => { picks.bias = x; });
    ['sleep', 'stress', 'mood'].forEach(k => scaleCtl(q('#jn-d-' + k), k, picks[k], (x) => { picks[k] = x; drawReady(); }));
    body.querySelectorAll('[data-halt]').forEach(c => { c.onchange = drawReady; });
    drawReady();
    pickSeg(q('#jn-d-fp'), YPN, picks.followedPlan, (x) => { picks.followedPlan = x; });
    pickSeg(q('#jn-d-gr'), GRADES, picks.grade, (x) => { picks.grade = x; });
    pickSeg(q('#jn-d-gm'), YPN, picks.goalMet, (x) => { picks.goalMet = x; });
    // Goal: idea chips fill it; the post-session section echoes it
    const goalEl = q('#jn-d-goal'), echo = q('#jn-d-goal-echo');
    const drawEcho = () => {
      if (!echo) return;
      const g = goalEl ? goalEl.value.trim() : '';
      echo.innerHTML = g ? `${ico('target')}<span>${esc(g)}</span>` : '<span class="dim">No goal set for this day — add one in the pre-market plan.</span>';
    };
    const setGoal = (t) => { if (!goalEl) return; goalEl.value = t; drawEcho(); goalEl.focus(); };
    if (goalEl) goalEl.addEventListener('input', drawEcho);
    drawEcho();
    body.querySelectorAll('[data-goal]').forEach(b => { b.onclick = () => setGoal(b.dataset.goal); });
    // Max trades hint vs the guardrail
    const maxEl = q('#jn-d-max'), maxH = q('#jn-d-max-h'), rule = (S().risk || {}).maxTradesDay || 0;
    const drawMax = () => {
      if (!maxEl || !maxH) return;
      maxEl.classList.remove('invalid');
      const n = numField(maxEl), over = isNum(n) && rule > 0 && n > rule;
      maxH.textContent = over ? `Above your guardrail of ${rule} a day — the guardrail still applies.` : rule ? `Your guardrail allows ${rule} a day. Planning fewer is a good habit.` : 'No daily trade limit is set (Settings → Risk).';
      maxH.classList.toggle('warn', over);
    };
    if (maxEl) maxEl.addEventListener('input', drawMax);
    drawMax();
    const doSave = () => {
      const vals = read();
      if (Number.isNaN(vals.maxTrades) || (isNum(vals.maxTrades) && (vals.maxTrades < 0 || vals.maxTrades > 100 || Math.round(vals.maxTrades) !== vals.maxTrades))) {
        if (maxEl) { const det = maxEl.closest('details'); if (det) det.open = true; maxEl.classList.add('invalid'); maxEl.focus(); }
        toast('Max trades must be a whole number from 0 to 100', 'err');
        return;
      }
      if (db.mode !== ctl.mode) { toast(`You switched accounts — switch back to ${modeLabel(ctl.mode)} to save this day`, 'warn'); return; }
      const msg = writeDay(o.key, vals);
      ctl.onSaved(true);
      // commit (re-render) first, so the drawer's focusBack() lands on the fresh twin of its opener.
      // If the write failed, save() has said why — keep the drawer and the typed text open.
      if (!commitOk(msg)) { ctl.onSaved(false); return; }
      drafts.delete(ctl.dKey);
      Drawer.close();
      refocus(`[data-day="${o.key}"]`);
    };
    body.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-d],[data-d-view]');
      if (!t || t.disabled) return;
      if (t.dataset.dView) {
        // TradeForm.view replaces this drawer; its Ledger fallback navigates, so close the drawer first
        const tf = mod(() => TradeForm);
        if (!(tf && tf.view)) Drawer.close();
        viewTrade(t.dataset.dView); return;
      }
      const a = t.dataset.d;
      if (a === 'save') doSave();
      else if (a === 'cancel') Drawer.close();
      else if (a === 'discard') { ctl.onSaved(); drafts.delete(ctl.dKey); Drawer.close(); openDay(o.key, o.focus); }
      else if (a === 'ledger') { Drawer.close(); toLedger({ day: o.key }); }
      else if (a === 'new') {
        const tf = mod(() => TradeForm);
        if (!(tf && tf.open)) { toast('The trade form is not available — reload the app and try again', 'err'); return; }
        Drawer.close(); call(() => tf.open(null));
      }
      else if (a === 'missed') logMissed({ day: o.key });
      else if (a === 'use-goal') setGoal(t.dataset.text || '');
      else if (a === 'routine') { Drawer.close(); Router.go('routine'); }
    });
    body.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); doSave(); } });
    // Focus intent from the caller ('pre' | 'checkin' | 'post' | 'notes') — after Drawer's own focus on ✕
    const target = { pre: '#jn-d-plan', checkin: '#jn-d-sleep button', post: '#jn-d-sum', notes: '#jn-d-notes' }[o.focus];
    if (target) setTimeout(() => { const t = q(target); if (t) { t.scrollIntoView({ block: 'center' }); t.focus({ preventScroll: true }); } }, 90);
    return read;
  }
  // Journal.openDay('YYYY-MM-DD', focus?) — the day drawer
  function openDay(key, focus) {
    if (key == null || key === '') key = todayISO();
    if (!validDay(key)) return null;
    if (!C && typeof recompute === 'function') recompute();
    if (!C) return null;
    // Close an open drawer first: its onClose stores any unsaved edits as a draft, which this drawer then
    // restores. (Reading drafts before that would rebuild the form from stale values and drop the edits.)
    if (Drawer.isOpen) Drawer.close();
    const mode = db.mode, mctx = metricsCtx(), today = todayISO();
    const closed = Metrics.filterGroups(C.groups, {}).filter(g => tdKey(g.exitMs) === key);
    const ids = new Set(closed.map(g => g.trade.id));
    const enteredToday = C.groups.filter(g => isFinite(entryMs(g)) && tdKey(entryMs(g)) === key);
    const opened = enteredToday.filter(g => !ids.has(g.trade.id)).sort((a, b) => entryMs(a) - entryMs(b));
    const flagsBy = new Map(closed.map(g => [g.trade.id, call(() => Metrics.flagsFor(g, mctx)) || []]));
    const flagCounts = {};
    let flaggedN = 0;
    for (const f of flagsBy.values()) { if (f.length) flaggedN++; for (const k of f) flagCounts[k] = (flagCounts[k] || 0) + 1; }
    const stored = dayRec(key, false);
    const dKey = `${mode}|day|${key}`, draft = drafts.get(dKey) || null;
    const v0 = valuesFrom(stored), v = draft ? clone(draft) : clone(v0);
    const o = {
      key, v, v0, draft: !!draft, closed, opened, taken: enteredToday.length,
      d: Metrics.dailyMap(closed, resetHour()).get(key) || null,
      flagsBy, flagCounts, flaggedN, ovs: overridesIn(key, key), stored,
      isToday: key === today, isFuture: key > today, isPast: key < today,
      carry: carryFor(key), focus: typeof focus === 'string' ? focus : '', h: new Date().getHours(),
      // routine ticks only exist for days that have started; the link needs the Routine page loaded
      routine: key <= today && Pages.has('routine') ? routineFor(key) : null,
    };
    const savedJSON = JSON.stringify(v0), openJSON = JSON.stringify(v);
    let saved = false, read = null;
    Drawer.open({
      title: fmtLong(key),
      sub: `${modeLabel(mode)} account${o.isToday ? ' · today' : o.isFuture ? ' · planning ahead' : ''}${resetHour() ? ` · trading day starts ${pad2(resetHour())}:00` : ''}`,
      width: 560, html: dayHtml(o),
      onMount: (body) => { read = mountDay(body, o, { mode, dKey, onSaved: (v) => { saved = v !== false; } }); },
      onClose: () => {
        if (saved || !read) return;
        const now = JSON.stringify(read());
        if (now === savedJSON) { drafts.delete(dKey); return; }
        drafts.set(dKey, JSON.parse(now));
        if (now !== openJSON) toast('Unsaved changes kept as a draft', 'warn', { action: { label: 'Reopen', run: () => openDay(key) } });
      },
    });
    return true;
  }

  /* ═══ Weekly / monthly review (modal) ══════════════════ */
  function parsePeriod(key) {
    if (typeof key !== 'string') return null;
    let m = /^W:(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (m) {
      if (!validDay(m[1])) return null;
      const wk = Metrics.weekKey(parseDay(m[1]).getTime());
      return { kind: 'week', key: 'W:' + wk, from: wk, to: addDays(wk, 6) };
    }
    m = /^M:(\d{4})-(\d{2})$/.exec(key);
    if (m) {
      const y = +m[1], mo = +m[2] - 1;
      if (mo < 0 || mo > 11) return null;
      return { kind: 'month', key: `M:${m[1]}-${m[2]}`, from: firstDayKey(y, mo), to: lastDayKey(y, mo) };
    }
    return null;
  }
  function prevPeriodKey(p) {
    if (p.kind === 'week') return 'W:' + addDays(p.from, -7);
    const d = parseDay(p.from), pm = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12);
    return 'M:' + monthKeyOf(pm.getFullYear(), pm.getMonth());
  }
  // Numbers for a period, frozen into the review when saved (later edits to trades don't rewrite history)
  function snapshotFor(p) {
    const ctx = metricsCtx();
    const gs = Metrics.filterGroups(C.groups, {}).filter(g => { const k = tdKey(g.exitMs); return k >= p.from && k <= p.to; });
    const s = Metrics.summary(gs, ctx), mr = Metrics.mistakeReport(gs), rs = gs.map(g => g.R).filter(isNum);
    const byCost = mr.rows.filter(r => isNum(r.costR) && r.costR > 0).sort((a, b) => b.costR - a.costR);
    const byPl = mr.rows.filter(r => r.pl < 0).sort((a, b) => a.pl - b.pl);
    const top = byCost[0] || byPl[0] || [...mr.rows].sort((a, b) => b.n - a.n)[0] || null;
    const best = gs.length ? gs.reduce((a, g) => (g.netPL > a.netPL ? g : a)) : null;
    const worst = gs.length ? gs.reduce((a, g) => (g.netPL < a.netPL ? g : a)) : null;
    const dm = Metrics.dailyMap(gs, resetHour()), store = daysRO();
    const brief = (g) => (g ? { id: g.trade.id, coin: g.coin || '', pl: g.netPL, R: isNum(g.R) ? g.R : null } : null);
    return {
      n: s.n, pl: s.pl, R: rs.length ? sum(rs) : null, rN: rs.length, expR: s.expR, winRate: s.winRate,
      adherence: s.adherence ? s.adherence.pct : null, clean: gs.filter(g => !(call(() => Metrics.flagsFor(g, ctx)) || []).length).length,
      wins: s.wins, losses: s.losses, days: dm.size, greenDays: s.greenDays,
      journaled: [...dm.keys()].filter(k => filled(store[k])).length, overrides: overridesIn(p.from, p.to).length,
      reviewed: mr.reviewed, unreviewed: mr.unreviewed,
      top: top ? { id: top.key, n: top.n, costR: isNum(top.costR) ? top.costR : null, pl: top.pl } : null,
      best: brief(best), worst: best === worst ? null : brief(worst),
      takenAt: new Date().toISOString(),
    };
  }
  // A stored snapshot comes from an older version, demo data or a restored / hand-edited backup: keep only
  // typed fields before anything reaches innerHTML (a string `n` or `overrides` would otherwise be injected
  // raw). The stored object itself is never rewritten — this is a read-only view of it.
  function cleanSnap(s) {
    if (!isO(s)) return { n: 0 };
    const nm = (v) => (isNum(v) ? v : null), out = {};
    for (const k of ['n', 'pl', 'R', 'rN', 'expR', 'winRate', 'adherence', 'clean', 'wins', 'losses', 'days', 'greenDays', 'journaled', 'overrides', 'reviewed', 'unreviewed']) out[k] = nm(s[k]);
    if (!isNum(out.n) || out.n < 0) out.n = 0;
    const tr = (b) => (isO(b) ? { id: str(b.id), coin: str(b.coin), pl: nm(b.pl), R: nm(b.R) } : null);
    // undefined = "this snapshot never had mistake data" (shown as —), null = "no mistake tagged"
    out.top = s.top === undefined ? undefined : isO(s.top) && (typeof s.top.id === 'string' || isNum(s.top.id))
      ? { id: String(s.top.id), n: isNum(s.top.n) ? s.top.n : 0, costR: nm(s.top.costR), pl: nm(s.top.pl) } : null;
    out.best = tr(s.best); out.worst = tr(s.worst); out.takenAt = str(s.takenAt);
    return out;
  }
  function snapReading(s, per) {
    if (!s.n) return '';
    const parts = [`You closed ${plural(s.n, 'trade')} this ${per}${isNum(s.clean) ? ` and ${s.clean} followed every rule` : ''}.`];
    if (isO(s.top)) parts.push(`Your costliest mistake was “${mistakeLabel(s.top.id)}” (${plural(s.top.n, 'trade')}${isNum(s.top.costR) ? `, ≈ ${fmtR(-s.top.costR, 1)} vs. your clean trades` : ''}).`);
    else if (s.top === undefined) { /* snapshot from elsewhere without mistake data — say nothing rather than guess */ }
    else if (s.unreviewed) parts.push(`${plural(s.unreviewed, 'trade')} still need a review — tag mistakes (or mark them clean) to see what is costing you.`);
    else parts.push('No mistakes tagged — check that is honest, then keep doing what you did.');
    if (s.n < 20) parts.push(`Small sample — judge your process this ${per}, not the P/L.`);
    return parts.join(' ');
  }
  function snapHtml(s, p, live, stale) {
    s = cleanSnap(s);
    const per = p.kind === 'week' ? 'week' : 'month';
    const when = s && s.takenAt && isFinite(Date.parse(s.takenAt)) ? `numbers as of ${fmtDateTime(Date.parse(s.takenAt))}` : '';
    const head = `<div class="jn-snap-h">${ico('stats')}Your numbers<span class="dim">${esc(when)}</span></div>`;
    const staleH = stale ? `<div class="jn-stale">${ico('info')}<span>Your trades for this ${per} changed since this snapshot (${plural(s.n || 0, 'trade')} then, ${live.n} now).</span><button type="button" class="link-btn" data-r="recalc">Update the numbers</button></div>` : '';
    if (!s || !s.n) return `<div class="jn-snap">${head}<div class="jn-empty">No closed trades this ${per}. You can still reflect on your routine, your plans and any missed trades.</div>${staleH}</div>`;
    const early = s.n < 20;
    const tile = (l, v, sub, cls) => `<div class="jn-ds"><span class="l">${l}</span><b class="${cls || ''}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const tiles = [
      tile('Trades', String(s.n), confBadge(s.n)),
      tile('Net P/L', `${glyph(s.pl)} ${money(s.pl, { sign: true })}`, isNum(s.R) ? `${fmtR(s.R)} total` : 'no trades with a stop', plClass(s.pl)),
      tile(`Expectancy ${tipFor('expR', 'Average net R per trade — what one trade is worth.')}`, fmtR(s.expR), early ? 'needs 20+ trades to judge' : 'per trade', early ? 'jn-gated' : plClass(s.expR)),
      tile('Win rate', isNum(s.winRate) ? fmtPct(s.winRate, { dp: 0 }) : '—', `${s.wins || 0}W · ${s.losses || 0}L${early ? ' · early' : ''}`, early ? 'jn-gated' : ''),
      tile(`Rule adherence ${tipFor('adherence', 'Share of trades with a stop, risk within your limit, a strategy, no mistakes and no guardrail override.')}`, isNum(s.adherence) ? fmtPct(s.adherence, { dp: 0 }) : '—', isNum(s.clean) ? `${s.clean} of ${s.n} clean` : 'clean trades'),
      tile('Journaled', isNum(s.journaled) && isNum(s.days) ? `${s.journaled}/${s.days}` : '—', 'trading days with an entry'),
    ].join('');
    const tr = (b) => (b ? `${esc(b.coin || 'Trade')} <span class="${plClass(b.pl)}">${money(b.pl, { sign: true })}</span>${isNum(b.R) ? ` · ${fmtR(b.R)}` : ''}` : '—');
    // Snapshots saved elsewhere (demo data, older versions) may not carry the mistake fields — show "—", never a false "None ✓"
    const top = isO(s.top) ? `${esc(mistakeLabel(s.top.id))} ×${s.top.n}${isNum(s.top.costR) ? ` · <span class="neg">≈ ${fmtR(-s.top.costR, 1)}</span>` : isNum(s.top.pl) ? ` · ${money(s.top.pl, { sign: true })}` : ''}`
      : s.top === undefined ? '<span class="dim">—</span>'
        : s.unreviewed ? `<span class="dim">${plural(s.unreviewed, 'trade')} not reviewed</span>` : 'None tagged ✓';
    const row = (l, v) => `<div class="stat-row"><span class="sl">${l}</span><span class="sv">${v}</span></div>`;
    return `<div class="jn-snap">${head}<div class="jn-snap-g">${tiles}</div>
      <div class="stat-rows">${row(`Top mistake by cost ${tipFor('mistakeCost', 'How much worse trades with this mistake did than your clean trades, in R, times how often it happened.')}`, top)}${row('Best trade', tr(s.best))}${s.worst ? row('Worst trade', tr(s.worst)) : ''}${s.overrides ? row('Guardrail overrides', `<span class="warn-c">${s.overrides}</span>`) : ''}</div>
      <div class="reading">${esc(snapReading(s, per))}</div>${staleH}</div>`;
  }
  // Printable report card (→ "Save as PDF" for OneDrive or a mentor): a clean sheet outside the app
  // shell; journal.css prints only that sheet while body has .jn-printing.
  function printSheet(html) {
    const old = document.querySelector('.jn-print-sheet'); if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'jn-print-sheet'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = html;
    document.body.appendChild(el); document.body.classList.add('jn-printing');
    let done = false;
    const end = () => { if (done) return; done = true; window.removeEventListener('afterprint', end); document.body.classList.remove('jn-printing'); el.remove(); };
    window.addEventListener('afterprint', end);
    try { window.print(); } catch (e) { /* printing unavailable */ }
    setTimeout(end, 1500);   // print() blocks in Chromium; this only cleans up where it doesn't
  }
  function reviewSheet(p, snap, vals, prevFocus, mode) {
    const per = p.kind === 'week' ? 'week' : 'month';
    const sec = (h, txt) => (txt ? `<section><h3>${esc(h)}</h3><p>${esc(txt)}</p></section>` : '');
    const met = (YPN.find(o => o.id === vals.prevFocusMet) || {}).label;
    const rt = isNum(vals.rating) ? Math.max(1, Math.min(5, Math.round(vals.rating))) : 0;
    return `<header><div class="jn-ps-k">CryptoJournal · ${esc(modeLabel(mode))} account</div><h2>${p.kind === 'week' ? 'Weekly' : 'Monthly'} review · ${esc(periodLabel(p))}</h2></header>
      ${snapHtml(snap, p, snap, false)}
      ${prevFocus ? sec(`Last ${per}'s focus: “${prevFocus}”`, met ? `Stuck to it: ${met}` : 'Not answered') : ''}
      ${sec('What went well', vals.wins)}${sec('Mistakes & patterns', vals.mistakes)}${sec('Lessons', vals.lessons)}${sec(`ONE focus for next ${per}`, vals.focus)}
      ${rt ? sec('Self-rating (process, not P/L)', `${'★'.repeat(rt)}${'☆'.repeat(5 - rt)}  ${rt} of 5`) : ''}
      <footer>Printed ${esc(fmtDateTime(Date.now()))}</footer>`;
  }
  // Journal.openReview('W:YYYY-MM-DD' | 'M:YYYY-MM')
  function openReview(key) {
    const p = parsePeriod(key);
    if (!p) { toast('That review period is not valid', 'err'); return null; }
    if (!C && typeof recompute === 'function') recompute();
    if (!C) return null;
    const mode = db.mode, per = p.kind === 'week' ? 'week' : 'month', today = todayISO();
    const ex = isO(reviewsRO()[p.key]) ? reviewsRO()[p.key] : null;
    const live = snapshotFor(p);
    let snap = ex && isO(ex.snapshot) ? ex.snapshot : live;
    // > 1¢ so snapshots rounded to cents (demo data) don't look stale
    const isStale = (s) => { if (s === live) return false; const c = cleanSnap(s); return c.n !== live.n || Math.abs((c.pl || 0) - (live.pl || 0)) > 0.01; };
    const prevRv = reviewsRO()[prevPeriodKey(p)], prevFocus = isO(prevRv) ? str(prevRv.focus).trim() : '';
    const rKey = `${mode}|review|${p.key}`, draft = drafts.get(rKey) || null;
    const t = txt;
    // rating clamped to 1–5: imported / hand-edited data must not light up 9 stars or be saved back out of range
    const v0 = { wins: t(ex && ex.wins), mistakes: t(ex && ex.mistakes), lessons: t(ex && ex.lessons), focus: t(ex && ex.focus), rating: ex && isNum(ex.rating) ? Math.max(1, Math.min(5, Math.round(ex.rating))) : null, prevFocusMet: ex && ['yes', 'partly', 'no'].includes(ex.prevFocusMet) ? ex.prevFocusMet : '' };
    const v = draft ? { ...v0, ...draft } : { ...v0 };
    const status = ex ? '<span class="badge ok sm">✓ Reviewed</span>' : today > p.to ? '<span class="badge warn sm">! Due</span>' : '<span class="badge cat sm">In progress</span>';
    const sv = cleanSnap(snap), topIdea = isO(sv.top) ? focusIdea(sv.top.id) : '';
    const ideas = goalIdeas([topIdea, prevFocus], true).slice(0, 5);
    const body = `<div class="jn-rv">
      <div class="jn-rv-per">${ico('calendar')}<b>${esc(periodLabel(p))}</b>${status}<span class="badge mode sm">${esc(modeLabel(mode))}</span></div>
      ${draft ? `<div class="banner info jn-draft">${ico('edit')}<div class="grow">Restored your unsaved draft.</div></div>` : ''}
      <div id="jn-r-snap">${snapHtml(snap, p, live, isStale(snap))}</div>
      ${prevFocus ? `<div class="jn-prev"><div class="jn-prev-t">${ico('target')}<span><b>Last ${per}'s focus:</b> “${esc(prevFocus)}”</span></div>
        <div class="field"><label id="jn-r-pm-l">Did you stick to it?</label><div id="jn-r-pm" role="group" aria-labelledby="jn-r-pm-l"></div></div></div>` : ''}
      <div class="form-grid">
        <div class="field full"><label for="jn-r-wins">What went well</label>
          <textarea class="input" id="jn-r-wins" rows="3" maxlength="4000" placeholder="Three things you did well — process, not profit.">${esc(v.wins)}</textarea></div>
        <div class="field full"><label for="jn-r-mis">Mistakes &amp; patterns</label>
          <textarea class="input" id="jn-r-mis" rows="3" maxlength="4000" placeholder="${esc(isO(sv.top) ? `e.g. what triggered “${mistakeLabel(sv.top.id)}” this ${per}?` : 'Which mistake showed up most, and what triggered it?')}">${esc(v.mistakes)}</textarea></div>
        <div class="field full"><label for="jn-r-les">Lessons</label>
          <textarea class="input" id="jn-r-les" rows="2" maxlength="4000" placeholder="What will you keep doing, or do differently?">${esc(v.lessons)}</textarea></div>
        <div class="field full"><label for="jn-r-focus">ONE focus for next ${per}</label>
          <input class="input" id="jn-r-focus" maxlength="140" value="${esc(v.focus)}" placeholder="e.g. zero trades within 30 min of a loss" aria-describedby="jn-r-focus-h">
          <div class="chip-row jn-ideas" role="group" aria-label="Focus ideas">${ideaChips(ideas)}</div>
          <div class="hint" id="jn-r-focus-h">Specific and measurable. It shows on your Today card and in each day's plan next ${per}.</div></div>
        <div class="field full"><label id="jn-r-rate-l">Rate your ${per} — process, not P/L</label><div class="stars jn-stars" id="jn-r-rate" role="group" aria-labelledby="jn-r-rate-l"></div></div>
      </div></div>`;
    const foot = `<span class="dim jn-kbd"><kbd>Ctrl</kbd> <kbd>Enter</kbd> saves</span>
      <button type="button" class="btn btn-quiet btn-sm" data-r="print" title="Print this review or save it as a PDF">${ico('download')}Print / PDF</button><div class="sp"></div>
      <button type="button" class="btn btn-ghost" data-r="cancel">Close</button><button type="button" class="btn btn-primary" data-r="save">${ico('check')}Save review</button>`;
    let read = null;
    return Modal.open({
      title: p.kind === 'week' ? 'Weekly review' : 'Monthly review', width: 680, body, foot,
      onClose: (val) => {
        if (val === 'saved' || !read) return;
        const now = JSON.stringify(read());
        if (now === JSON.stringify(v0)) { drafts.delete(rKey); return; }
        drafts.set(rKey, JSON.parse(now));
        if (now !== JSON.stringify(v)) toast('Unsaved review kept as a draft', 'warn', { action: { label: 'Reopen', run: () => openReview(p.key) } });
      },
      onMount(m, close) {
        const q = (s) => m.querySelector(s);
        m.classList.add('printable');   // Ctrl+P prints this review instead of the page (styles.css); the button prints a cleaner sheet
        let rating = isNum(v.rating) ? v.rating : null, prevMet = v.prevFocusMet || '';
        pickSeg(q('#jn-r-pm'), YPN, prevMet, (x) => { prevMet = x; });
        const starEl = q('#jn-r-rate');
        const drawStars = () => {
          starEl.innerHTML = [1, 2, 3, 4, 5].map(i => `<button type="button" class="${rating && i <= rating ? 'on' : ''}" data-star="${i}" aria-pressed="${rating === i}" aria-label="${i} of 5"><svg><use href="#i-star"/></svg></button>`).join('');
        };
        drawStars();
        starEl.onclick = (ev) => {
          const b = ev.target.closest('[data-star]'); if (!b) return;
          const i = +b.dataset.star; rating = rating === i ? null : i; drawStars();
          const nb = starEl.querySelector(`[data-star="${i}"]`); if (nb) nb.focus();
        };
        const focusEl = q('#jn-r-focus');
        m.querySelectorAll('[data-goal]').forEach(b => { b.onclick = () => { focusEl.value = b.dataset.goal; focusEl.focus(); }; });
        read = () => ({ wins: q('#jn-r-wins').value.trim(), mistakes: q('#jn-r-mis').value.trim(), lessons: q('#jn-r-les').value.trim(), focus: focusEl.value.trim(), rating, prevFocusMet: prevMet });
        const doSave = () => {
          const vals = read();
          if (!vals.wins && !vals.mistakes && !vals.lessons && !vals.focus && !vals.rating) { toast('Write at least one line (or give a rating) before saving', 'warn'); q('#jn-r-wins').focus(); return; }
          if (db.mode !== mode) { toast(`You switched accounts — switch back to ${modeLabel(mode)} to save this review`, 'warn'); return; }
          const store = storeFor('reviews', mode), prev = isO(store[p.key]) ? store[p.key] : {}, nowIso = new Date().toISOString();
          store[p.key] = {
            ...prev, kind: p.kind, wins: vals.wins, mistakes: vals.mistakes, lessons: vals.lessons, focus: vals.focus,
            rating: vals.rating || null, prevFocusMet: vals.prevFocusMet || null, snapshot: snap,
            createdAt: prev.createdAt || nowIso, updatedAt: nowIso,
          };
          if (!commitOk(vals.focus ? `Review saved — focus set for next ${per}` : 'Review saved')) return;   // save() said why — keep the modal open
          drafts.delete(rKey);
          close('saved');
          refocus(`[data-jn-review="${p.key}"]`);
        };
        m.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-r]'); if (!b) return;
          if (b.dataset.r === 'save') doSave();
          else if (b.dataset.r === 'cancel') close();
          else if (b.dataset.r === 'recalc') { snap = live; const sn = q('#jn-r-snap'); if (sn) sn.innerHTML = snapHtml(snap, p, live, false); }
          else if (b.dataset.r === 'print') printSheet(reviewSheet(p, snap, read(), prevFocus, mode));
        });
        m.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); doSave(); } });
      },
    });
  }

  /* ═══ Missed-trade log (modal) ═════════════════════════ */
  // Journal.logMissed({ day?, id? }) — new entry (optionally dated to a day) or edit an existing one
  function logMissed(opts) {
    opts = isO(opts) ? opts : {};
    const mode = db.mode, list = missedRO();
    const ex = opts.id ? list.find(t => t.id === opts.id) || null : null;
    if (opts.id && !ex) { toast('That missed trade no longer exists', 'err'); return null; }
    const today = todayISO();
    const at0 = ex && str(ex.at) ? ex.at.slice(0, 16) : validDay(opts.day) && opts.day !== today ? `${opts.day}T12:00` : nowLocalInput();
    const strats = (db.strategies || []).filter(s => isO(s) && (!s.archived || (ex && s.id === ex.strategyId)));
    // Form values as strings (exactly what the fields hold), so an accidental backdrop click or Esc keeps the
    // typing as a draft — like the day drawer and the review — instead of throwing it away
    const init = {
      at: at0, coin: ex ? str(ex.coin) : '', side: ex && (ex.side === 'long' || ex.side === 'short') ? ex.side : '',
      strategyId: ex && ex.strategyId && strats.some(s => s.id === ex.strategyId) ? ex.strategyId : '',
      reason: ex && ex.reason ? missWhy(ex.reason) : '',
      plannedR: ex && isNum(ex.plannedR) ? String(ex.plannedR) : '', outcomeR: ex && isNum(ex.outcomeR) ? String(ex.outcomeR) : '',
      notes: ex ? txt(ex.notes) : '',
    };
    const mKey = `${mode}|missed|${ex ? 'id:' + ex.id : 'new:' + (validDay(opts.day) ? opts.day : '')}`, draft = drafts.get(mKey) || null;
    const v = draft ? { ...init, ...draft } : init;
    let side = v.side, reason = v.reason, read = null;
    const body = `${draft ? `<div class="banner info jn-draft">${ico('edit')}<div class="grow">Restored your unsaved draft.</div></div>` : ''}<form class="form-grid jn-mm" novalidate autocomplete="off">
      <div class="field"><label for="jn-m-at">When</label><input class="input" id="jn-m-at" type="datetime-local" value="${esc(v.at)}"></div>
      <div class="field"><label for="jn-m-coin">Coin</label><input class="input mono" id="jn-m-coin" maxlength="20" value="${esc(v.coin)}" placeholder="BTC" autocapitalize="characters" spellcheck="false" autofocus></div>
      <div class="field"><label id="jn-m-side-l">Side <span class="opt">optional</span></label><div id="jn-m-side" role="group" aria-labelledby="jn-m-side-l"></div></div>
      <div class="field"><label for="jn-m-strat">Strategy <span class="opt">optional</span></label><select class="input" id="jn-m-strat"></select></div>
      <div class="field full"><label id="jn-m-why-l">Why did you miss it?</label><div class="chip-row" id="jn-m-why" role="group" aria-labelledby="jn-m-why-l"></div><div class="hint" id="jn-m-why-h" aria-live="polite"></div></div>
      <div class="field"><label for="jn-m-plan">Planned R <span class="opt">target ÷ risk</span></label>
        <div class="input-group"><input class="input mono" id="jn-m-plan" type="number" step="0.1" min="0" max="100" inputmode="decimal" value="${esc(v.plannedR)}" placeholder="2"><span class="addon">R</span></div></div>
      <div class="field"><label for="jn-m-out">Outcome R <span class="opt">if known</span></label>
        <div class="input-group"><input class="input mono" id="jn-m-out" type="number" step="0.1" min="-100" max="100" inputmode="decimal" value="${esc(v.outcomeR)}" placeholder="e.g. 2 or -1" aria-describedby="jn-m-out-h"><span class="addon">R</span></div>
        <div class="hint" id="jn-m-out-h">Where it would have ended: 2 = a +2R winner, −1 = hit the stop. Hindsight — don't trade from it.</div></div>
      <div class="field full"><label for="jn-m-notes">Notes <span class="opt">optional</span></label><textarea class="input" id="jn-m-notes" rows="3" maxlength="2000" placeholder="What did you see, and what stopped you?">${esc(v.notes)}</textarea></div>
    </form>`;
    const foot = `${ex ? `<button type="button" class="btn btn-danger btn-sm" data-m="del">${ico('trash')}Delete</button>` : ''}<div class="sp"></div>
      <button type="button" class="btn btn-ghost" data-m="cancel">Cancel</button><button type="button" class="btn btn-primary" data-m="save">${ex ? 'Save changes' : 'Log missed trade'}</button>`;
    return Modal.open({
      title: ex ? 'Edit missed trade' : 'Log a missed trade', width: 580, body, foot,
      onClose: (val) => {
        if (val === 'done' || !read) { drafts.delete(mKey); return; }
        const now = JSON.stringify(read());
        if (now === JSON.stringify(init)) { drafts.delete(mKey); return; }
        drafts.set(mKey, JSON.parse(now));
        if (now !== JSON.stringify(v)) toast('Unsaved missed trade kept as a draft', 'warn', { action: { label: 'Reopen', run: () => logMissed(opts) } });
      },
      onMount(m, close) {
        const q = (s) => m.querySelector(s);
        const sel = q('#jn-m-strat');
        fillSelect(sel, strats.map(s => [s.id, s.name || s.id]), 'No strategy');
        sel.value = v.strategyId && strats.some(s => s.id === v.strategyId) ? v.strategyId : '';
        pickSeg(q('#jn-m-side'), [{ id: 'long', label: '↗ Long' }, { id: 'short', label: '↘ Short' }], side, (x) => { side = x; });
        const hint = q('#jn-m-why-h'), drawHint = () => { hint.textContent = MISS_HINT[reason] || MISS_HINT['']; hint.classList.toggle('ok-c', reason === 'rules'); };
        chips(q('#jn-m-why'), MISS_WHY, reason ? [reason] : [], { onChange: (s) => { reason = s[0] || ''; drawHint(); } });
        drawHint();
        // same keys / order as init, so "nothing changed" compares equal
        read = () => ({
          at: q('#jn-m-at').value, coin: q('#jn-m-coin').value.trim(), side: side || '', strategyId: sel.value || '', reason: reason || '',
          plannedR: q('#jn-m-plan').value.trim(), outcomeR: q('#jn-m-out').value.trim(), notes: q('#jn-m-notes').value.trim(),
        });
        m.querySelectorAll('input, textarea').forEach(x => x.addEventListener('input', () => x.classList.remove('invalid')));
        const bad = (el, msg) => { if (el) { el.classList.add('invalid'); el.focus(); } toast(msg, 'err'); };
        let createdId = null;
        const doSave = () => {
          const atEl = q('#jn-m-at'), coinEl = q('#jn-m-coin'), planEl = q('#jn-m-plan'), outEl = q('#jn-m-out');
          const at = atEl.value;
          if (!at || !isFinite(Date.parse(at))) return bad(atEl, 'Pick when you saw the setup');
          const coin = coinEl.value.trim().toUpperCase().replace(/\s+/g, '');
          if (!coin) return bad(coinEl, 'Which coin was it?');
          if (!reason) { const f = q('#jn-m-why button'); if (f) f.focus(); toast('Pick why you missed it — that is the useful part', 'err'); return undefined; }
          const pr = numField(planEl), oc = numField(outEl);
          if (Number.isNaN(pr) || (isNum(pr) && (pr < 0 || pr > 100))) return bad(planEl, 'Planned R must be a number from 0 to 100');
          if (Number.isNaN(oc) || (isNum(oc) && Math.abs(oc) > 100)) return bad(outEl, 'Outcome R must be a number from −100 to 100');
          if (db.mode !== mode) { toast(`You switched accounts — switch back to ${modeLabel(mode)} to save this`, 'warn'); return undefined; }
          const nowIso = new Date().toISOString();
          const rec = {
            at: at.slice(0, 16), coin, side: side || null, strategyId: sel.value || null, reason,
            plannedR: isNum(pr) ? pr : null, outcomeR: isNum(oc) ? oc : null, notes: q('#jn-m-notes').value.trim(), updatedAt: nowIso,
          };
          const store = storeFor('missed', mode), tid = ex ? ex.id : createdId;
          const target = tid ? store.find(t => isO(t) && t.id === tid) : null;
          if (target) Object.assign(target, rec);
          else { createdId = uid('m'); store.push({ id: createdId, ...rec, createdAt: nowIso }); }
          // A failed write (save() says why) keeps the modal open; a retry updates the same entry, never a duplicate
          if (!commitOk(ex && target ? 'Missed trade updated' : rec.reason === 'rules' ? 'Logged — a pass your rules asked for ✓' : 'Missed trade logged')) return undefined;
          close('done');
          return undefined;
        };
        m.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-m]'); if (!b) return;
          if (b.dataset.m === 'save') doSave();
          else if (b.dataset.m === 'cancel') close();
          else if (b.dataset.m === 'del' && ex) { close('done'); deleteMissed(ex.id); }
        });
        m.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); doSave(); } });
        const form = q('form'); if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); doSave(); });
        // Modal focuses the first field (the date, which is pre-filled) — the coin is what you type first
        if (!ex) setTimeout(() => { const c = q('#jn-m-coin'); if (c && document.activeElement !== c) c.focus({ preventScroll: true }); }, 50);
      },
    });
  }
  // Delete with Undo (the toast puts it back in the same account and position)
  function deleteMissed(id) {
    const mode = db.mode, list = isO(db.missed) && Array.isArray(db.missed[mode]) ? db.missed[mode] : null;
    if (!list) return;
    const i = list.findIndex(t => isO(t) && t.id === id);
    if (i < 0) return;
    const [item] = list.splice(i, 1);
    // Write failed (save() said why): put it back so the screen matches what is stored
    if (!commitOk()) { list.splice(i, 0, item); refresh(); return; }
    refocus('.jn-miss-card [data-jn="missed"]');   // the deleted row's button is gone
    toast(`Missed ${str(item.coin) || 'trade'} deleted`, 'ok', {
      ms: 9000,
      action: {
        label: 'Undo', run: () => {
          const l = storeFor('missed', mode);
          if (l.some(t => isO(t) && t.id === item.id)) return;
          l.splice(Math.min(i, l.length), 0, item);
          commitOk('Restored');
        },
      },
    });
  }

  /* ═══ Public helpers ═══════════════════════════════════ */
  // Journal.show('YYYY-MM' | {month:'YYYY-MM', view:'cal'|'year'}) — jump to a month
  function show(arg) {
    const o = isO(arg) ? arg : { month: arg };
    const m = typeof o.month === 'string' ? /^(\d{4})-(\d{2})$/.exec(o.month) : null;
    if (m && +m[2] >= 1 && +m[2] <= 12) cur = { y: +m[1], m: +m[2] - 1 };
    if (o.view === 'cal' || o.view === 'year') { view = o.view; lsSet(LS_VIEW, view); }
    if (Router.active === 'journal') Router.render(); else Router.go('journal');
  }
  // Journal.readinessFor(key?) → { score, word, advice, cls } | null — e.g. for a pre-trade banner
  function readinessFor(key) {
    const k = validDay(key) ? key : todayISO(), sc = scoreOf(daysRO()[k]);
    const b = readinessBand(sc);
    return b ? { key: k, score: sc, word: b.word, advice: b.advice, cls: b.cls } : null;
  }
  function streak() {
    if (!C) return 0;
    return journalStreak({ today: todayISO(), days: daysRO(), dm: Metrics.dailyMap(Metrics.filterGroups(C.groups, {}), resetHour()) });
  }
  function sub() {
    // same set as the "To review" card (closed with a valid exit time), so the two counts always agree
    const n = C ? Metrics.filterGroups(C.groups, {}).filter(g => !Metrics.isReviewed(g.trade)).length : 0;
    return n ? `Daily notebook · P&L calendar · ${plural(n, 'trade')} to review` : 'Daily notebook · P&L calendar · weekly reviews';
  }

  if (typeof Pages !== 'undefined') Pages.register('journal', { title: 'Journal', sub, render, onLeave() { queueAll = false; missMore = false; } });

  // Journal.focusFor(key?) → { kind:'week'|'month', text } | null — the review focus that applies to that day
  const focusFor = (key) => carryFor(validDay(key) ? key : todayISO()).focus;

  return { openDay, openReview, logMissed, show, readinessFor, streak, focusFor };
})();
