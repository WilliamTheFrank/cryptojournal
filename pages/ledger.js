/* ═══════════════════════════════════════════════════════════
   CryptoJournal — Trades ledger (pages/ledger.js, page 'trades')
   One row per trade GROUP (parent + scale legs). The caret opens
   the legs plus a detail panel: planned vs actual R, thesis and
   notes, review, screenshots and quick actions. Toolbar: new /
   quick log / cash flow, search, filter chips, saved views,
   column chooser, density, CSV. Open trades show live unrealised
   P/L from Market.cached() — always labelled "unrealised".
   Design research: Carbon data-table density, column priority,
   sticky first column, R data bars, sticky totals; features
   research: global filters + saved views; critic: review queue,
   "% reviewed", formula-safe CSV, honest "no stop" R.
   Public: Ledger.show(filter) · Ledger.focusSearch() ·
           Ledger.exportCSV() · Ledger.clearFilters()
   ═══════════════════════════════════════════════════════════ */
const Ledger = (() => {
  'use strict';

  /* ── Constants ─────────────────────────────────────────── */
  const PAGE = 200;                 // trade groups per page — keeps a 500+ trade journal snappy
  const LS_KEY = 'cj.ledger';       // per-browser UI prefs only (sort order, cash-flow toggle)
  const FLOW_TYPES = ['deposit', 'withdrawal', 'adjustment'];
  const PRESETS = [['', 'All dates'], ['today', 'Today'], ['week', 'This week'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['ytd', 'Year to date']];
  const MK_SHORT = { spot: 'Spot', perp: 'Perp', dex: 'DEX' };
  const SHOT_KIND = { before: 'Before', after: 'After', other: 'Shot' };
  const FLAG_TXT = { noStop: 'No stop', overRisk: 'Risk above your limit', stopBlown: 'Lost more than 1.2R', noStrategy: 'No strategy', override: 'Guardrail overridden' };
  const STATUS_TXT = { open: 'Open', closed: 'Closed', review: 'Needs review' };
  const RESULT_TXT = { win: 'Wins', loss: 'Losses', be: 'Breakeven' };
  // Drill-down keys that have no control of their own in the filter row (set by Ledger.show from the
  // calendar, insights or Analytics): shown as removable chips plus the "Filtered from" banner.
  const PROG_KEYS = ['day', 'session', 'weekday', 'grade', 'venue', 'emotion', 'hold'];
  // One-click starting points (not stored) — the views a beginner reaches for most
  const QUICK = [
    { name: 'Open positions', hint: 'Live unrealised P/L', filter: { status: 'open' } },
    { name: 'Review queue', hint: 'Closed, not reviewed yet', filter: { status: 'review' } },
    { name: 'Losses · last 30 days', hint: 'Look for repeat mistakes', filter: { result: 'loss', range: '30d' } },
    { name: 'This week', hint: 'Every trade since Monday', filter: { range: 'week' } },
  ];
  // Column priority (design research): 'always' cannot be hidden · 'default' shown until the
  // user picks columns · 'optional' via the Columns popover (saved in S().ledgerCols).
  const COLS = [
    { id: 'date', label: 'Date', tier: 'always', sort: 'date' },
    { id: 'coin', label: 'Coin', tier: 'always', sort: 'coin' },
    { id: 'side', label: 'Side', tier: 'always' },
    { id: 'strategy', label: 'Strategy', tier: 'default' },
    { id: 'entry', label: 'Entry', tier: 'default', num: true, full: 'Entry price (size-weighted across legs)' },
    { id: 'exit', label: 'Exit', tier: 'default', num: true, full: 'Exit price (size-weighted across legs)' },
    { id: 'size', label: 'Size', tier: 'default', num: true, full: 'Position size in coins' },
    { id: 'stop', label: 'Stop', tier: 'optional', num: true },
    { id: 'target', label: 'Target', tier: 'optional', num: true },
    { id: 'planR', label: 'Plan R', tier: 'optional', num: true, full: 'Planned reward ÷ risk' },
    { id: 'pl', label: 'Net P/L', tier: 'always', num: true, sort: 'pl', full: 'Net P/L after fees, funding and gas' },
    { id: 'r', label: 'R', tier: 'always', num: true, sort: 'r', full: 'Net R' },
    { id: 'acct', label: 'Acct %', tier: 'optional', num: true, full: 'Account change %' },
    { id: 'costs', label: 'Costs', tier: 'optional', num: true, full: 'Fees, funding & gas' },
    { id: 'dur', label: 'Duration', tier: 'optional', sort: 'dur' },
    { id: 'bal', label: 'Balance', tier: 'optional', num: true, full: 'Balance after the trade' },
    { id: 'status', label: 'Status', tier: 'always' },
    { id: 'grade', label: 'Grade', tier: 'default', full: 'Process grade' },
    { id: 'disc', label: 'Discipline', tier: 'default' },
    { id: 'mistakes', label: 'Mistakes', tier: 'optional' },
    { id: 'tags', label: 'Tags', tier: 'optional' },
    { id: 'venue', label: 'Venue', tier: 'optional' },
    { id: 'lev', label: 'Lev.', tier: 'optional', num: true, full: 'Leverage' },
    { id: 'emo', label: 'Emotion', tier: 'optional', full: 'Emotion before the trade' },
    { id: 'acts', label: 'Actions', tier: 'always' },
  ];

  /* ── Small helpers ─────────────────────────────────────── */
  const isN = (v) => typeof v === 'number' && isFinite(v);
  // Own-key lookups only: saved views / entries can come from imported backups, and a key like
  // 'constructor' must never resolve to an Object.prototype member.
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const pick = (o, k, fb) => (own(o, k) ? o[k] : fb);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && isFinite(v) ? String(v) : '');
  const clip = (s, n) => { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const costOf = (p) => (isN(p.fees) ? p.fees : 0) + (isN(p.funding) ? p.funding : 0) + (isN(p.gas) ? p.gas : 0);
  const realMk = (e) => arr(e.mistakes).filter(m => m && m !== 'none');
  // Closed and not reviewed yet (no mistakes tagged, not marked clean): the same test the dashboard, the
  // journal's review queue and Analytics use, so every "needs review" count in the app agrees.
  const needsReview = (g) => !!g.closed && !Metrics.isReviewed(g.trade);
  const domId = (id) => 'lg-d-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_');
  const cssEsc = (s) => (window.CSS && typeof CSS.escape === 'function' ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));
  const units = () => (S().units === 'R' || S().units === '%' ? S().units : '$');
  function safeUrl(u) { const s = typeof u === 'string' ? u.trim() : ''; return /^(https?:|blob:|data:image\/)/i.test(s) ? s : null; }
  // Size-weighted average of a price across legs (falls back to a plain mean without sizes)
  function wavg(list, key) {
    let q = 0, v = 0; const plain = [];
    for (const p of list) {
      if (!isN(p[key])) continue;
      plain.push(p[key]);
      if (isN(p.amount) && p.amount > 0) { q += p.amount; v += p.amount * p[key]; }
    }
    return q > 0 ? v / q : plain.length ? sum(plain) / plain.length : null;
  }
  // ms | Date | 'YYYY-MM-DD' (local day; end=true → last ms of that day) | parseable string → ms
  function toMs(v, end) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v instanceof Date) return isFinite(v.getTime()) ? v.getTime() : null;
    const s = String(v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return end ? new Date(+m[1], +m[2] - 1, +m[3] + 1).getTime() - 1 : new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const t = Date.parse(s);
    return isFinite(t) ? t : null;
  }
  const dayMs = (key) => toMs(key, false);
  function whenText(ms) {
    if (!ms) return '—';
    return new Date(ms).getFullYear() === new Date().getFullYear() ? fmtDateTime(ms) : fmtDate(ms);
  }
  function fullWhen(ms) { return ms ? new Date(ms).toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  const rangeLabel = (from, to) => `${from != null ? fmtDateShort(from) : '…'} – ${to != null ? fmtDateShort(to) : 'now'}`;
  function normWeekday(v) {
    const s = typeof v === 'string' ? v.trim().slice(0, 3).toLowerCase() : '';
    return s ? (Metrics.WEEKDAYS.find(w => w.toLowerCase() === s) || '') : '';
  }
  // Another module's global, or null. `typeof X` alone is not enough: a module whose IIFE threw while
  // loading leaves its const in the temporal dead zone, where even `typeof X` throws a ReferenceError.
  const mod = (get) => { try { return get() || null; } catch (e) { return null; } };
  const fnOf = (get, name) => { const m = mod(get); return m && typeof m[name] === 'function' ? m : null; };
  // tipFor() reads Learn's Glossary with `typeof` — that throws too when learn.js failed to load (TDZ), and the
  // header / totals would take the whole page down with it: fall back to the plain sentence.
  const tip = (key, fb) => { try { return tipFor(key, fb); } catch (e) { return infoTip(fb || ''); } };
  function quote(sym) {
    const M = fnOf(() => Market, 'cached');
    if (!sym || !M) return null;
    try { return M.cached(sym) || null; } catch (e) { return null; }
  }
  // fmtUnit text, wrapped for privacy blur only when it is a $ amount
  function unitHtml(o) { const t = fmtUnit(o); return units() === '$' ? `<span class="money">${t}</span>` : t; }
  function unitCls(o) {
    const u = units(), shown = u === 'R' ? o.R : u === '%' ? o.changePct : o.netPL;
    return isN(shown) ? plClass(o.netPL) : '';   // win/loss colour follows NET P/L (contract rule 5)
  }

  /* ── Sorting ───────────────────────────────────────────── */
  // first = direction of the first click (Carbon three-state: first → flipped → back to default)
  const SORTS = {
    date: { name: 'date', first: 'desc', val: (it) => it.t },
    coin: { name: 'coin', first: 'asc', val: (it) => (it.g && it.g.coin ? String(it.g.coin).toUpperCase() : null) },
    // follows the topbar unit so the order matches the numbers the column shows ($ / % / R)
    pl: { name: 'net P/L', first: 'desc', val: (it) => {
      if (!it.g) return null;
      const u = units(), g = it.g, lv = it.d.lv && it.d.lv.q ? it.d.lv : null;
      if (g.closed) return u === 'R' ? g.R : u === '%' ? g.changePct : g.netPL;
      return lv ? (u === 'R' ? lv.R : u === '%' ? lv.pct : lv.tot) : null;
    } },
    r: { name: 'R', first: 'desc', val: (it) => (!it.g ? null : it.g.closed ? it.g.R : (it.d.lv && it.d.lv.q ? it.d.lv.R : null)) },
    dur: { name: 'duration', first: 'desc', val: (it) => (it.g ? it.d.held : null) },
  };
  const sortDef = () => pick(SORTS, sort.key, SORTS.date);
  function sortItems(items) {
    const s = sortDef(), dir = sort.dir === 'asc' ? 1 : -1;
    const bad = (v) => v == null || (typeof v === 'number' && !isFinite(v));
    return items.sort((a, b) => {
      const va = s.val(a), vb = s.val(b), na = bad(va), nb = bad(vb);
      if (na !== nb) return na ? 1 : -1;                      // missing values always last
      if (!na) { const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb; if (c) return c * dir; }
      return b.t - a.t;                                        // tie-break: newest first
    });
  }

  /* ── Module state (transient UI; filters reset on reload) ─ */
  const F0 = () => ({ q: '', status: '', result: '', side: '', coin: '', strategyId: '', market: '', tag: '', mistake: '', range: '', from: null, to: null, day: '', ids: null, session: '', weekday: '', grade: '', venue: '', emotion: '', hold: '' });
  let f = F0();
  let searchDirty = false;    // typed into the search box but the debounce has not applied it yet
  let focusAfterShow = false; // Ledger.show → move focus to the "Filtered from" banner once drawn
  let source = null;          // where a programmatic filter came from (banner text)
  let sort = { key: 'date', dir: 'desc' };
  let showFlows = true;
  let filtersOpen = false;    // phone widths: filter row collapsed behind a toggle
  let limit = PAGE;
  let host = null;            // the page <section>
  let bound = null;           // section the delegated listeners are attached to
  let lastMode = null;
  let lastPriceReq = 0;
  let openShown = false;      // any open trade currently rendered → re-render on 'prices'
  let rovingId = null;        // data-fid of the row that owns tabindex=0
  let resetScroll = false;
  let lastAnnounce = '';
  let pop = null;             // open popover { el, trigger, off }
  let last = null;            // last collect() result (bulk bar, "select all matching")
  const expanded = new Set(); // trade ids with the detail row open
  const sel = new Set();      // selected trade ids
  const media = new Map();    // Store media id → object URL

  (() => {
    try {
      const p = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (p && p.sort && own(SORTS, p.sort.key) && (p.sort.dir === 'asc' || p.sort.dir === 'desc')) sort = { key: p.sort.key, dir: p.sort.dir };
      if (p && typeof p.showFlows === 'boolean') showFlows = p.showFlows;
    } catch (e) { /* private window / blocked storage — defaults are fine */ }
  })();
  const savePrefs = () => { try { localStorage.setItem(LS_KEY, JSON.stringify({ sort, showFlows })); } catch (e) { /* storage blocked — prefs stay in memory */ } };

  /* ── Filter normalisation (Ledger.show, saved views) ───── */
  function normFilter(src) {
    const o = F0();
    if (!src || typeof src !== 'object') return o;
    const status = str(src.status).toLowerCase(), result = str(src.result).toLowerCase(), side = str(src.side).toLowerCase();
    if (status === 'needsreview' || status === 'unreviewed') o.status = 'review';
    else if (own(STATUS_TXT, status)) o.status = status;
    if (own(RESULT_TXT, result)) o.result = result;
    if (side === 'long' || side === 'short') o.side = side;
    o.coin = str(src.coin).toUpperCase();
    o.strategyId = str(src.strategyId);
    o.market = str(src.market);
    o.tag = str(src.tag);
    o.mistake = str(src.mistake);
    o.q = typeof src.q === 'string' ? src.q.slice(0, 120) : '';
    const day = str(src.day);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) o.day = day;
    o.session = str(src.session);
    o.weekday = normWeekday(src.weekday);
    const gr = str(src.grade).toUpperCase();
    if (['A', 'B', 'C'].includes(gr)) o.grade = gr;
    o.venue = str(src.venue);
    o.emotion = str(src.emotion);
    const hold = str(src.hold);
    if (Metrics.HOLD.some(h => h.key === hold)) o.hold = hold;
    const preset = str(src.range || src.preset);
    if (PRESETS.some(p => p[0] && p[0] === preset)) o.range = preset;
    const from = toMs(src.from, false), to = toMs(src.to, true);
    if (from != null || to != null) { o.from = from; o.to = to; o.range = 'custom'; }
    if (Array.isArray(src.ids)) o.ids = src.ids.filter(x => typeof x === 'string' || typeof x === 'number').map(String);
    return o;
  }
  const storable = (o) => { const out = { ...o }; delete out.ids; return out; };   // picked ids are one-off
  const progOn = () => !!(f.ids || PROG_KEYS.some(k => f[k]));
  const tradeFilterOn = () => !!(f.status || f.result || f.side || f.coin || f.strategyId || f.market || f.tag || f.mistake || f.ids || PROG_KEYS.some(k => k !== 'day' && f[k]));
  const emoLabel = (id) => { const e = EMOTIONS_PRE.find(x => x.id === id); return e ? e.label : id; };
  // Chip / banner text for the drill-down keys (PROG_KEYS order)
  function progParts(o) {
    const p = [];
    if (o.day) p.push(fmtDateShort(dayMs(o.day)));
    if (o.session) p.push(o.session + ' session');
    if (o.weekday) p.push(o.weekday);
    if (o.grade) p.push('Grade ' + o.grade);
    if (o.venue) p.push(o.venue);
    if (o.emotion) p.push('Felt ' + emoLabel(o.emotion).toLowerCase());
    if (o.hold) p.push('Held ' + o.hold);
    return p;
  }
  function activeCount() {
    let n = 0;
    for (const k of ['status', 'result', 'side', 'coin', 'strategyId', 'market', 'tag', 'mistake', 'range'].concat(PROG_KEYS)) if (f[k]) n++;
    if (f.ids) n++;
    if (f.q.trim()) n++;
    return n;
  }
  const savable = () => activeCount() - (f.ids ? 1 : 0) > 0;   // picked ids are stripped from saved views
  function describe(o) {
    const p = [];
    if (o.status) p.push(pick(STATUS_TXT, o.status, ''));
    if (o.result) p.push(pick(RESULT_TXT, o.result, ''));
    if (o.side) p.push(o.side === 'short' ? 'Shorts' : 'Longs');
    if (o.coin) p.push(o.coin);
    if (o.strategyId) p.push(stratName(o.strategyId));
    if (o.market) p.push(pick(MK_SHORT, o.market, o.market));
    if (o.tag) p.push('#' + o.tag);
    if (o.mistake) p.push(o.mistake === '__clean__' ? 'No mistakes' : mistakeLabel(o.mistake));
    if (o.range === 'custom') p.push(rangeLabel(o.from, o.to));
    else if (o.range) { const pr = PRESETS.find(x => x[0] === o.range); if (pr) p.push(pr[1]); }
    p.push(...progParts(o));
    if (o.q && o.q.trim()) p.push(`“${o.q.trim()}”`);
    return p.filter(Boolean).join(' · ') || 'All trades';
  }

  /* ── Data: derive, filter, sort ────────────────────────── */
  // Live unrealised P/L for an open group: open legs at the last cached price minus their recorded
  // costs, plus whatever legs already closed (scale-outs). Never mixed into the realised totals.
  function liveFor(g) {
    const q = quote(g.coin);
    if (!q || !isN(q.usd) || q.usd <= 0) return { q: null };
    const dir = g.side === 'short' ? -1 : 1;
    let upl = 0, priced = false;
    for (const p of g.portions) {
      if (p.closed || !isN(p.entryPrice) || !isN(p.amount)) continue;
      upl += (q.usd - p.entryPrice) * p.amount * dir - costOf(p); priced = true;
    }
    if (!priced) return { q: null };
    const realised = sum(g.portions.filter(p => p.closed).map(p => (isN(p.netPL) ? p.netPL : 0)));
    const tot = upl + realised, at = isN(q.at) ? q.at : null;
    return {
      q, upl, realised, tot, at,
      R: g.risk ? tot / g.risk : null,
      pct: g.trade.prevBalance > 0 ? tot / g.trade.prevBalance : null,
      stale: !!q.stale || (at != null && Date.now() - at > 5 * 60000) || navigator.onLine === false,
    };
  }
  function derive(g, now) {
    const t = g.trade, ps = g.portions, closedPs = ps.filter(p => p.closed);
    const t0 = Date.parse(t.entryAt), sizes = ps.filter(p => isN(p.amount));
    return {
      t: isFinite(t0) ? t0 : 0,
      amt: sizes.length ? sum(sizes.map(p => p.amount)) : null,
      costs: sum(ps.map(costOf)),
      entry: ps.length > 1 ? wavg(ps, 'entryPrice') : (isN(t.entryPrice) ? t.entryPrice : null),
      exit: closedPs.length ? wavg(closedPs, 'exitPrice') : null,
      bal: g.closed && ps.length ? ps[ps.length - 1].balance : null,
      realised: sum(closedPs.map(p => (isN(p.netPL) ? p.netPL : 0))),
      lv: g.closed ? null : liveFor(g),
      rv: needsReview(g),
      held: g.closed ? (isN(g.durationMs) ? g.durationMs : null) : (isFinite(t0) ? Math.max(0, now - t0) : null),
      openLeg: ps.find(p => !p.closed) || null,
    };
  }
  // Search haystack: coin, strategy, venue, notes/thesis, tags, mistake labels, review text
  function hay(g) {
    const t = g.trade, rv = t.review && typeof t.review === 'object' ? t.review : {};
    const parts = [g.coin, g.strategyId ? stratName(g.strategyId) : '', t.venue, t.market, t.thesis, t.invalidation, t.notes, rv.lesson, rv.wentWell, rv.improve];
    for (const p of g.portions) if (p !== t) parts.push(p.notes);
    for (const x of arr(t.tags)) parts.push(x);
    for (const m of realMk(t)) parts.push(mistakeLabel(m));
    return parts.filter(v => typeof v === 'string' && v).join('\n').toLowerCase();
  }
  function filterCtx() {
    let from = null, to = null;
    if (f.range === 'custom') { from = f.from; to = f.to; }
    else if (f.range) { const r = Metrics.rangeFor(f.range, Date.now()); from = r.from; to = r.to; }
    return { from, to, reset: (S().risk && S().risk.dayResetHour) || 0, ids: f.ids ? new Set(f.ids) : null, q: f.q.trim().toLowerCase() };
  }
  // Closed trades are dated by EXIT (same as the calendar & analytics), open trades by entry.
  function matchGroup(g, x) {
    const t = g.trade;
    if (x.ids && !(x.ids.has(t.id) || g.portions.some(p => x.ids.has(p.id)))) return false;
    if (f.status === 'open' && g.closed) return false;
    if (f.status === 'closed' && !g.closed) return false;
    if (f.status === 'review' && !needsReview(g)) return false;
    if (f.result) {
      if (!g.closed) return false;
      if ((f.result === 'win' && !g.win) || (f.result === 'loss' && !g.loss) || (f.result === 'be' && !g.be)) return false;
    }
    if (f.side && (g.side || 'long') !== f.side) return false;
    if (f.coin && String(g.coin || '').toUpperCase() !== f.coin.toUpperCase()) return false;   // legacy / imported rows may not be upper-case
    if (f.strategyId && g.strategyId !== f.strategyId) return false;
    if (f.market && (t.market || 'spot') !== f.market) return false;
    if (f.tag && !arr(t.tags).includes(f.tag)) return false;
    // '__clean__' follows Metrics.filterGroups: no mistake tagged (so Analytics drill-downs match)
    if (f.mistake === '__clean__' && realMk(t).length) return false;
    if (f.mistake && f.mistake !== '__clean__' && !arr(t.mistakes).includes(f.mistake)) return false;
    const when = g.closed && isN(g.exitMs) ? g.exitMs : Date.parse(t.entryAt);
    if (x.from != null && !(when >= x.from)) return false;
    if (x.to != null && !(when <= x.to)) return false;
    if (f.day && (!isFinite(when) || Metrics.tradingDayKey(when, x.reset) !== f.day)) return false;
    if (f.session && Metrics.sessionOf(g) !== f.session) return false;
    if (f.weekday && Metrics.weekdayOf(g) !== f.weekday) return false;
    // same semantics as Metrics.filterGroups / Metrics.holdOf so Analytics drill-downs match
    if (f.grade && (t.grade || '') !== f.grade) return false;
    if (f.venue && (t.venue || '') !== f.venue) return false;
    if (f.emotion && !arr(t.emoPre).includes(f.emotion)) return false;
    if (f.hold && Metrics.holdOf(g) !== f.hold) return false;    // open trades have no hold time yet
    if (x.q && !hay(g).includes(x.q)) return false;
    return true;
  }
  // Cash flows ride along only when no trade-specific filter is active and the list is in date order
  function flowMatch(r, x) {
    if (!showFlows || sort.key !== 'date' || tradeFilterOn()) return false;
    const t = Date.parse(r.entryAt);
    if (x.from != null && !(t >= x.from)) return false;
    if (x.to != null && !(t <= x.to)) return false;
    if (f.day && (!isFinite(t) || Metrics.tradingDayKey(t, x.reset) !== f.day)) return false;
    if (x.q && !`${r.type} ${typeof r.flowNote === 'string' ? r.flowNote : ''}`.toLowerCase().includes(x.q)) return false;
    return true;
  }
  function collect() {
    const now = Date.now(), x = filterCtx(), gs = [], items = [];
    const liveIds = new Set(C.groups.map(g => g.trade.id));
    for (const id of [...sel]) if (!liveIds.has(id)) sel.delete(id);        // deleted / other mode
    for (const id of [...expanded]) if (!liveIds.has(id)) expanded.delete(id);
    for (const g of C.groups) {
      if (!matchGroup(g, x)) continue;
      const d = derive(g, now);
      gs.push(g); items.push({ kind: 'g', g, d, t: d.t });
    }
    let nFlows = 0;
    for (const r of C.rows) {
      if (!FLOW_TYPES.includes(r.type) || !flowMatch(r, x)) continue;
      const t = Date.parse(r.entryAt);
      items.push({ kind: 'f', r, t: isFinite(t) ? t : 0 }); nFlows++;
    }
    sortItems(items);
    return { gs, items, nFlows };
  }

  /* ── Small renderers ───────────────────────────────────── */
  const sideBadge = (side) => (side === 'short' ? '<span class="badge short sm">↘ SHORT</span>' : '<span class="badge long sm">↗ LONG</span>');
  const gradeBadge = (gr) => (['A', 'B', 'C'].includes(gr) ? `<span class="badge grade-${gr} sm" title="Process grade — how well you followed your plan, not the result">${gr}</span>` : '<span class="dim">—</span>');
  const dash = '<span class="dim">—</span>';
  // Mini chips; items are strings or { label, f, v } (clickable → filter the ledger by that value)
  function minis(list, kind, max) {
    max = max || 2;
    if (!list.length) return dash;
    const one = (x) => {
      const o = typeof x === 'string' ? { label: x } : x;
      return o.f ? `<button type="button" class="lg-mini ${kind}" data-f="${o.f}" data-v="${esc(o.v)}" title="Show only trades with “${esc(o.label)}”">${esc(o.label)}</button>`
        : `<span class="lg-mini ${kind}">${esc(o.label)}</span>`;
    };
    const names = list.map(x => (typeof x === 'string' ? x : x.label));
    return `<span class="lg-minis">${list.slice(0, max).map(one).join('')}${list.length > max ? `<span class="lg-mini more" title="${esc(names.join(', '))}">+${list.length - max}</span>` : ''}</span>`;
  }
  const tagItems = (t) => arr(t.tags).filter(x => typeof x === 'string' && x).map(x => ({ label: x, f: 'tag', v: x }));
  function mistakesHtml(g, max) {
    const ms = g.trade.mistakes;
    if (!Array.isArray(ms) || !ms.length) return g.closed ? '<span class="dim">not reviewed</span>' : dash;
    const real = realMk(g.trade);
    if (!real.length) return '<span class="lg-mini clean">✓ Clean</span>';
    return minis(real.map(m => ({ label: mistakeLabel(m), f: 'mistake', v: m })), 'mk', max);
  }
  const labelsOf = (ids, list) => arr(ids).map(x => { const m = list.find(e => e.id === x); return m ? m.label : String(x); });
  function stars(n) {
    const k = Math.max(0, Math.min(5, Math.round(n)));
    return `<span class="lg-stars" role="img" aria-label="Discipline ${k} of 5">${'★'.repeat(k)}<span class="lg-stars-off">${'★'.repeat(5 - k)}</span></span>`;
  }
  // Discipline: score dot (psychology research: ≥80 disciplined · 60–79 slipping · <60 on tilt)
  // only when there is real process data; legacy stars otherwise; override flag always.
  function discHtml(g) {
    const t = g.trade, parts = [];
    const ds = isN(g.avgDiscipline) ? g.avgDiscipline : isN(t.discipline) ? t.discipline : null;
    let sc = null;
    if (g.closed && (isN(t.rulesMetPct) || Metrics.isReviewed(t))) { try { sc = Math.round(Metrics.discScore(g)); } catch (e) { sc = null; } }
    if (isN(sc)) {
      const cls = sc >= 80 ? 'ok' : sc >= 60 ? 'warn' : 'stop';
      const why = `Discipline ${sc}/100 — ${isN(t.rulesMetPct) ? Math.round(t.rulesMetPct * 100) + '% of playbook rules met' : 'rules not checked'}, ${realMk(t).length ? 'mistakes tagged' : 'no mistakes'}, ${arr(t.violations).length ? 'guardrail overridden' : 'no overrides'}`;
      parts.push(`<span class="lg-disc ${cls}" title="${esc(why)}"><i aria-hidden="true"></i>${sc}</span>`);
    } else if (ds) parts.push(stars(ds));
    const v = arr(t.violations);
    if (v.length) parts.push(`<span class="badge stop sm" title="${esc('Guardrail overridden: ' + v.map(x => (x && x.rule) || 'rule').join(', '))}">⚑ ${v.length}</span>`);
    return parts.join(' ') || dash;
  }
  function emoHtml(t) {
    const l = labelsOf(t.emoPre, EMOTIONS_PRE);
    if (!l.length) return dash;
    return minis(l, 'emo', 1) + (isN(t.emoPreInt) ? ` <small class="lg-int">${t.emoPreInt}/5</small>` : '');
  }

  /* ── Table cells: trade group rows ─────────────────────── */
  function dateCell(g, d) {
    const id = g.trade.id, ex = expanded.has(id), legs = g.portions.length;
    const lbl = `${g.coin || 'trade'} ${whenText(d.t)}`;
    return `<td class="sticky-col lg-c-date"><div class="lg-first">
      <input type="checkbox" class="lg-cb" data-sel="${esc(id)}" data-fid="sel-${esc(id)}"${sel.has(id) ? ' checked' : ''} aria-label="Select ${esc(lbl)}">
      <button type="button" class="lg-caret${ex ? ' on' : ''}" data-exp="${esc(id)}" data-fid="exp-${esc(id)}" aria-expanded="${ex}"${ex ? ` aria-controls="${domId(id)}"` : ''} aria-label="${ex ? 'Hide' : 'Show'} details${legs > 1 ? ` and ${legs} legs` : ''} for ${esc(lbl)}"><svg aria-hidden="true"><use href="#i-chevron-r"/></svg></button>
      <span class="lg-when" title="${esc(fullWhen(d.t))}">${esc(whenText(d.t))}</span></div></td>`;
  }
  function coinCell(g) {
    const t = g.trade, sub = [], mk = str(t.market), vn = str(t.venue);
    if (mk) sub.push(pick(MK_SHORT, mk, mk));
    if (vn) sub.push(vn);
    const legs = g.portions.length > 1 ? `<span class="lg-legs">${g.portions.length} legs</span>` : '';
    const subHtml = sub.map(s => esc(s)).join(' · ');
    // coinIcon() slices its argument: a hand-edited / imported backup can hold a numeric coin
    const sym = g.coin == null ? '' : String(g.coin);
    return `<td><div class="coin-cell lg-coin">${coinIcon(sym)}<div class="lg-coin-t"><span class="lg-sym">${esc(sym || '—')}</span>${subHtml || legs ? `<small>${subHtml}${subHtml && legs ? ' · ' : ''}${legs}</small>` : ''}</div></div></td>`;
  }
  function exitHtml(g, d) {
    if (d.exit != null) return fmtPrice(d.exit) + (!g.closed ? '<small>partial</small>' : '');
    if (!g.closed && d.lv && d.lv.q) return `<span class="lg-now" title="Live price${d.lv.stale ? ' (stale)' : ''} — the trade is still open">${fmtPrice(d.lv.q.usd)}<small>now</small></span>`;
    return dash;
  }
  function stopHtml(t) {
    if (!isN(t.stopPrice)) return '<span class="lg-nostop" title="No stop set — risk is unlimited and R cannot be measured">none</span>';
    const moved = isN(t.stopFinal) && t.stopFinal !== t.stopPrice;
    return fmtPrice(t.stopPrice) + (moved ? `<small class="lg-warn" title="${esc('Stop moved to ' + fmtPriceText(t.stopFinal))}">moved</small>` : '');
  }
  function plCell(g, d) {
    if (g.closed) {
      const o = { netPL: g.netPL, changePct: g.changePct, R: g.R };
      if (units() === 'R' && !isN(g.R)) return '<td class="num"><span class="dim" title="At least one leg has no stop, so R cannot be measured">—<small>no stop</small></span></td>';
      if (units() === '%' && !isN(g.changePct)) return '<td class="num"><span class="dim" title="Account % needs a balance before the trade — set a starting balance or log a deposit">—<small>no balance</small></span></td>';
      return `<td class="num ${unitCls(o)}">${unitHtml(o)}</td>`;
    }
    const lv = d.lv;
    if (!lv || !lv.q) return '<td class="num"><span class="dim" title="Unrealised P/L appears once a live price is available">—<small>no live price</small></span></td>';
    const o = { netPL: lv.tot, changePct: lv.pct, R: lv.R };
    if (units() === 'R' && !isN(lv.R)) return '<td class="num"><span class="dim" title="No stop on this position, so its R cannot be measured">—<small>no stop</small></span></td>';
    if (units() === '%' && !isN(lv.pct)) return '<td class="num"><span class="dim" title="Account % needs a balance before the trade">—<small>no balance</small></span></td>';
    // lv.tot = open legs at the live price + legs already closed (scale-outs): say so when that applies
    const part = g.anyClosed ? ' + closed legs' : '';
    const as = `Unrealised at ${fmtPriceText(lv.q.usd)}${part ? ', plus the realised result of closed legs' : ''}${lv.at ? ' · as of ' + fmtTime(lv.at) : ''}${lv.stale ? ' · stale price' : ''}${lv.q.source ? ' · ' + lv.q.source : ''}`;
    return `<td class="num ${unitCls(o)}"><span class="lg-unreal${lv.stale ? ' stale' : ''}" title="${esc(as)}">≈ ${unitHtml(o)}<small>unrealised${part}${lv.stale ? ' · stale' : ''}</small></span></td>`;
  }
  // R data bar: centred track, ±3R full scale (design research)
  const rbar = (R) => `<span class="trk" aria-hidden="true"><span class="fill ${R >= 0 ? 'pos' : 'neg'}" style="width:${(Math.min(Math.abs(R), 3) / 3 * 50).toFixed(1)}%"></span></span>`;
  function rCell(g, d) {
    if (g.closed) {
      if (!isN(g.R)) return '<td class="num"><span class="dim" title="At least one leg has no stop, so R cannot be measured. It counts as “no stop”.">—<small class="lg-nostop">no stop</small></span></td>';
      // same line as Metrics.flagsFor('stopBlown'): R is net, so a clean stop-out plus normal costs can land a bit below −1R
      const past = g.R < -1.2 ? '<small class="lg-warn" title="Lost more than 1.2R — more than a stop-out plus normal costs: the stop moved, was ignored or slipped">past stop</small>' : '';
      return `<td class="num"><span class="rbar">${rbar(g.R)}<span class="${plClass(g.R)}">${fmtR(g.R)}</span></span>${past}</td>`;
    }
    if (d.lv && d.lv.q && isN(d.lv.R)) return `<td class="num ${plClass(d.lv.R)}"><span class="lg-unreal" title="Unrealised R at the live price">≈ ${fmtR(d.lv.R)}</span></td>`;
    return `<td class="num">${g.risk ? '<span class="dim">open</span>' : '<span class="lg-nostop" title="No stop on this position — risk is unlimited">no stop</span>'}</td>`;
  }
  function costsCell(g, d) {
    if (!d.costs) return `<td class="num">${dash}</td>`;
    const r = g.risk ? d.costs / g.risk : null;
    return `<td class="num lg-cost">${money(d.costs)}${r != null ? `<small title="Costs as a share of the $ you risked">${r.toFixed(2)}R</small>` : ''}</td>`;
  }
  function statusCell(g, d) {
    let b;
    if (!g.closed) b = `<span class="badge open sm">OPEN${g.anyClosed ? ' · PART' : ''}</span>`;
    else if (g.win) b = '<span class="badge win sm">✓ WIN</span>';
    else if (g.loss) b = '<span class="badge loss sm">✕ LOSS</span>';
    else b = '<span class="badge be sm">– BE</span>';
    const rv = d.rv ? `<button type="button" class="badge warn sm lg-rv" data-act="review" data-id="${esc(g.trade.id)}" data-fid="rv-${esc(g.trade.id)}" aria-label="${esc(`Review ${g.coin != null && g.coin !== '' ? g.coin : 'this'} trade — not reviewed yet`)}" title="Not reviewed yet — tag mistakes (or mark it clean) and grade the process">Review</button>` : '';
    return `<td><span class="lg-status">${b}${rv}</span></td>`;
  }
  function actsCell(g, d) {
    const id = esc(g.trade.id), coin = esc(g.coin || 'trade');
    return `<td class="lg-acts-c"><div class="lg-acts">
      ${d.openLeg ? `<button type="button" class="btn btn-ghost btn-xs" data-act="close" data-row="${esc(d.openLeg.id)}" data-fid="close-${id}" aria-label="Close ${coin} position">Close</button>` : ''}
      <button type="button" class="lg-ib" data-act="edit" data-id="${id}" data-fid="edit-${id}" aria-label="Edit ${coin} trade" title="Edit"><svg aria-hidden="true"><use href="#i-edit"/></svg></button>
      <button type="button" class="lg-ib" data-act="view" data-id="${id}" data-fid="view-${id}" aria-label="Open ${coin} trade" title="Open"><svg aria-hidden="true"><use href="#i-eye"/></svg></button>
    </div></td>`;
  }
  function cellHtml(c, g, d) {
    const t = g.trade;
    switch (c.id) {
      case 'date': return dateCell(g, d);
      case 'coin': return coinCell(g);
      case 'side': return `<td>${sideBadge(g.side)}</td>`;
      // max-width is ignored on table cells, so the ellipsis lives on an inner span
      case 'strategy': { const nm = g.strategyId ? stratName(g.strategyId) : ''; return `<td>${nm ? `<span class="lg-strat" title="${esc(nm)}">${esc(nm)}</span>` : dash}</td>`; }
      case 'entry': return `<td class="num">${fmtPrice(d.entry)}</td>`;
      case 'exit': return `<td class="num">${exitHtml(g, d)}</td>`;
      case 'size': return `<td class="num">${isN(d.amt) ? fmtQty(d.amt) : '—'}</td>`;
      case 'stop': return `<td class="num">${stopHtml(t)}</td>`;
      case 'target': return `<td class="num">${fmtPrice(t.targetPrice)}</td>`;
      case 'planR': return `<td class="num">${isN(g.plannedR) ? g.plannedR.toFixed(2) + 'R' : dash}</td>`;
      case 'pl': return plCell(g, d);
      case 'r': return rCell(g, d);
      case 'acct': return `<td class="num ${g.closed ? plClass(g.changePct) : ''}">${g.closed ? fmtPct(g.changePct, { sign: true }) : dash}</td>`;
      case 'costs': return costsCell(g, d);
      case 'dur': return `<td class="lg-dur">${d.held != null ? esc(fmtDuration(d.held)) : '—'}${!g.closed ? '<small>open</small>' : ''}</td>`;
      case 'bal': return `<td class="num">${isN(d.bal) ? money(d.bal) : dash}</td>`;
      case 'status': return statusCell(g, d);
      case 'grade': return `<td>${gradeBadge(t.grade)}</td>`;
      case 'disc': return `<td>${discHtml(g)}</td>`;
      case 'mistakes': return `<td>${mistakesHtml(g, 2)}</td>`;
      case 'tags': return `<td>${minis(tagItems(t), 'tag', 2)}</td>`;
      case 'venue': return `<td>${str(t.venue) ? esc(str(t.venue)) : dash}</td>`;
      case 'lev': return `<td class="num">${isN(t.leverage) && t.leverage > 1 ? esc(String(+t.leverage.toFixed(2))) + '×' : dash}</td>`;
      case 'emo': return `<td>${emoHtml(t)}</td>`;
      case 'acts': return actsCell(g, d);
      default: return '<td></td>';
    }
  }

  /* ── Scale legs (child rows) ───────────────────────────── */
  function legCell(c, p, i) {
    const closed = !!p.closed, ms = Date.parse(p.entryAt);
    switch (c.id) {
      case 'date': return `<td class="sticky-col lg-c-date"><div class="lg-first lg-legf"><span class="lg-legn">${i === 0 ? 'Entry' : 'Leg ' + (i + 1)}</span><span class="lg-when">${esc(whenText(isFinite(ms) ? ms : 0))}</span></div></td>`;
      case 'coin': return `<td><span class="badge scale sm">${i === 0 ? 'INITIAL' : 'SCALE'}</span></td>`;
      case 'entry': return `<td class="num">${fmtPrice(p.entryPrice)}</td>`;
      case 'exit': return `<td class="num">${closed ? fmtPrice(p.exitPrice) : '<span class="dim">open</span>'}</td>`;
      case 'size': return `<td class="num">${fmtQty(p.amount)}</td>`;
      case 'stop': return `<td class="num">${fmtPrice(p.stopPrice)}</td>`;
      case 'target': return `<td class="num">${fmtPrice(p.targetPrice)}</td>`;
      case 'planR': return `<td class="num">${isN(p.plannedR) ? p.plannedR.toFixed(2) + 'R' : '—'}</td>`;
      case 'pl': {
        if (!closed || !isN(p.netPL)) return '<td class="num"><span class="dim">open</span></td>';
        const o = { netPL: p.netPL, changePct: p.accountChangePct, R: p.netR };
        return `<td class="num ${unitCls(o)}">${unitHtml(o)}</td>`;
      }
      case 'r': return `<td class="num ${closed ? plClass(p.netR) : ''}">${closed && isN(p.netR) ? fmtR(p.netR) : '—'}</td>`;
      case 'acct': return `<td class="num ${closed ? plClass(p.accountChangePct) : ''}">${closed ? fmtPct(p.accountChangePct, { sign: true }) : '—'}</td>`;
      case 'costs': { const v = costOf(p); return `<td class="num">${v ? money(v) : '—'}</td>`; }
      case 'dur': return `<td>${closed && isN(p.durationMs) ? esc(fmtDuration(p.durationMs)) : '—'}</td>`;
      case 'bal': return `<td class="num">${closed && isN(p.balance) ? money(p.balance) : '—'}</td>`;
      case 'status': return `<td>${closed ? '<span class="lg-legst">closed</span>' : '<span class="badge open sm">OPEN</span>'}</td>`;
      case 'acts': return `<td class="lg-acts-c"><div class="lg-acts">${!closed ? `<button type="button" class="btn btn-ghost btn-xs" data-act="close" data-row="${esc(p.id)}" data-fid="lclose-${esc(p.id)}" aria-label="Close leg ${i + 1}">Close</button>` : ''}<button type="button" class="lg-ib" data-act="editrow" data-row="${esc(p.id)}" data-fid="ledit-${esc(p.id)}" aria-label="Edit leg ${i + 1}" title="Edit leg"><svg aria-hidden="true"><use href="#i-edit"/></svg></button></div></td>`;
      default: return '<td></td>';
    }
  }
  function legsHtml(g, cols) {
    if (g.portions.length < 2) return '';
    return g.portions.map((p, i) => `<tr class="child lg-child" data-leg="${esc(p.id)}">${cols.map(c => legCell(c, p, i)).join('')}</tr>`).join('');
  }

  /* ── Detail row ────────────────────────────────────────── */
  // Planned vs actual R as two bars on one zero-anchored scale
  function rrHtml(g, d) {
    const plan = isN(g.plannedR) ? g.plannedR : null;
    const act = g.closed ? (isN(g.R) ? g.R : null) : (d.lv && d.lv.q && isN(d.lv.R) ? d.lv.R : null);
    if (plan == null && act == null) return `<p class="lg-note dim">${g.risk ? 'Add a target to compare planned vs actual R.' : 'Set a stop (and a target) to measure this trade in R.'}</p>`;
    const lo = Math.min(0, act != null ? act : 0, -1), hi = Math.max(plan != null ? plan : 0, act != null ? act : 0, 1), span = hi - lo;
    const z = (-lo / span * 100).toFixed(1);
    const seg = (v) => { const a = Math.min(v, 0), b = Math.max(v, 0); return `left:${((a - lo) / span * 100).toFixed(1)}%;width:${((b - a) / span * 100).toFixed(1)}%`; };
    const row = (lbl, v, cls, txt, txtCls) => `<div class="lg-rr-row"><span class="lg-rr-l">${lbl}</span><span class="lg-rr-trk"><i class="lg-rr-z" style="left:${z}%"></i>${v != null ? `<i class="lg-rr-f ${cls}" style="${seg(v)}"></i>` : ''}</span><b class="${txtCls || ''}">${txt}</b></div>`;
    let cap = '';
    if (g.closed && act != null && plan && act > 0) cap = `<p class="lg-cap">Captured ${Math.round(act / plan * 100)}% of the planned move.</p>`;
    else if (g.closed && act != null && act < -1.2) cap = '<p class="lg-cap lg-warn">Lost more than 1.2R — more than a stop-out plus costs. Check whether the stop moved or slipped.</p>';
    else if (!g.closed && act != null) cap = '<p class="lg-cap dim">“Now” is unrealised, at the last live price.</p>';
    return `<div class="lg-rr" role="img" aria-label="${esc(`Planned ${plan != null ? plan.toFixed(2) + 'R' : 'not set'}, ${g.closed ? 'actual' : 'now'} ${act != null ? fmtR(act) : 'not measurable'}`)}">
      ${row('Planned', plan, 'plan', plan != null ? plan.toFixed(2) + 'R' : '—')}
      ${row(g.closed ? 'Actual' : 'Now', act, act != null && act < 0 ? 'dn' : 'up', act != null ? fmtR(act) : '—', act != null ? plClass(act) : '')}</div>${cap}`;
  }
  function shotList(t) {
    const out = [];
    for (const s of arr(t.shots)) {
      if (!s || typeof s !== 'object') continue;
      const o = { id: s.id ? String(s.id) : null, url: safeUrl(s.url), kind: s.kind, caption: typeof s.caption === 'string' ? s.caption : '' };
      if (o.id || o.url) out.push(o);
    }
    if (safeUrl(t.shotBefore)) out.push({ id: null, url: safeUrl(t.shotBefore), kind: 'before', caption: '' });
    if (safeUrl(t.shotAfter)) out.push({ id: null, url: safeUrl(t.shotAfter), kind: 'after', caption: '' });
    return out;
  }
  function shotsHtml(t) {
    const list = shotList(t);
    if (!list.length) return `<p class="lg-note dim">No screenshots. <button type="button" class="link-btn" data-act="edit" data-id="${esc(t.id)}" data-fid="dshot-${esc(t.id)}">Add one</button> — a before/after chart makes reviews faster.</p>`;
    return `<div class="lg-shots">${list.slice(0, 8).map((s, i) => {
      const kind = pick(SHOT_KIND, s.kind, 'Shot'), label = kind + (s.caption ? ' — ' + s.caption : '');
      // A v1 web link is not fetched as a thumbnail (offline-first: no network call the user did not ask
      // for, and it is often a TradingView page, not an image) — it opens on click instead.
      const web = !s.id && isWeb(s.url);
      const src = s.id && media.has(s.id) ? media.get(s.id) : s.id || web ? null : s.url;
      return `<button type="button" class="lg-shot${web ? ' link' : ''}" data-shot="${esc(t.id)}" data-ix="${i}" data-fid="shot-${esc(t.id)}-${i}" aria-label="${esc('Open screenshot: ' + label)}" title="${esc(label)}"><img alt=""${src ? ` src="${esc(src)}"` : ''}${!src && s.id ? ` data-media="${esc(s.id)}"` : ''} loading="lazy" decoding="async"><span aria-hidden="true">${esc(kind)}</span></button>`;
    }).join('')}</div>`;
  }
  function detailHtml(g, d, n) {
    const t = g.trade, id = esc(t.id), rv = t.review && typeof t.review === 'object' ? t.review : {};
    const reviewed = Metrics.isReviewed(t), lv = d.lv;
    let flags = [];
    if (g.closed) { try { flags = Metrics.flagsFor(g, metricsCtx()).filter(k => k !== 'mistakes'); } catch (e) { flags = []; } }
    const riskPct = g.risk && t.prevBalance > 0 ? g.risk / t.prevBalance : null;
    // Plan vs result
    const kv = [['Risked', g.risk ? `${money(g.risk)}${riskPct != null ? ` <small>${fmtPct(riskPct, { dp: 2 })} of account</small>` : ''}` : '<span class="lg-warn">No stop — risk unknown</span>']];
    if (d.costs) {
      const bits = [['fees', g.portions.map(p => p.fees)], ['funding', g.portions.map(p => p.funding)], ['gas', g.portions.map(p => p.gas)]].filter(([, v]) => v.some(isN)).map(([k]) => k);
      kv.push(['Costs', `${money(d.costs)}${g.risk ? ` <small>${(d.costs / g.risk).toFixed(2)}R · ${bits.join(', ')}</small>` : ` <small>${bits.join(', ')}</small>`}`]);
    }
    if (!g.closed && g.anyClosed) kv.push(['Realised', `<span class="${plClass(d.realised)}">${money(d.realised, { sign: true })}</span> <small>closed legs</small>`]);
    // Unrealised = open legs only (lv.upl); lv.tot adds the realised legs above, so it gets its own line
    if (lv && lv.q) {
      kv.push(['Unrealised', `<span class="${plClass(lv.upl)}">≈ ${money(lv.upl, { sign: true })}</span> <small>open ${g.anyClosed ? 'legs ' : ''}at ${fmtPrice(lv.q.usd)}${lv.at ? ' · ' + esc(fmtTime(lv.at)) : ''}${lv.stale ? ' · stale' : ''}</small>`]);
      if (g.anyClosed) kv.push(['Trade so far', `<span class="${plClass(lv.tot)}">≈ ${money(lv.tot, { sign: true })}</span> <small>realised + unrealised${isN(lv.R) ? ' · ' + fmtR(lv.R) : ''}</small>`]);
    } else if (!g.closed) kv.push(['Unrealised', '<small>No live price yet (offline or unknown coin)</small>']);
    if (g.closed && isN(g.durationMs)) kv.push(['Held', esc(fmtDuration(g.durationMs))]);
    const sec1 = `<section class="lg-dsec" aria-label="Plan versus result"><h4 class="lg-dh">Plan vs result</h4>${rrHtml(g, d)}
      <div class="lg-kv">${kv.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
      ${flags.length ? `<div class="lg-flags">${flags.map(k => `<span class="badge stop sm">${esc(pick(FLAG_TXT, k, k))}</span>`).join('')}</div>` : ''}</section>`;
    // Thesis & notes
    const notes = [['Thesis', t.thesis], ['Invalidation', t.invalidation], ['Notes', t.notes]].filter(x => typeof x[1] === 'string' && x[1].trim());
    g.portions.slice(1).forEach((p, i) => { if (typeof p.notes === 'string' && p.notes.trim()) notes.push([`Leg ${i + 2}`, p.notes]); });
    const sec2 = `<section class="lg-dsec" aria-label="Thesis and notes"><h4 class="lg-dh">Thesis &amp; notes</h4>${notes.length
      ? notes.slice(0, 4).map(([k, v]) => `<p class="lg-note"><span>${k}</span>${esc(clip(v, 360))}</p>`).join('')
      : `<p class="lg-note dim">Nothing written yet. <button type="button" class="link-btn" data-act="edit" data-id="${id}" data-fid="dnote-${id}">Add a thesis or notes</button></p>`}</section>`;
    // Review
    const plan = pick({ yes: 'Plan followed ✓', partly: 'Plan partly followed', no: 'Plan not followed' }, rv.followedPlan, '');
    const lines = [['Lesson', rv.lesson], ['Went well', rv.wentWell], ['Improve', rv.improve]].filter(x => typeof x[1] === 'string' && x[1].trim());
    const pre = labelsOf(t.emoPre, EMOTIONS_PRE), post = labelsOf(t.emoPost, EMOTIONS_POST);
    const ds = isN(g.avgDiscipline) ? g.avgDiscipline : isN(t.discipline) ? t.discipline : null;
    const sec3 = `<section class="lg-dsec" aria-label="Review"><h4 class="lg-dh">Review</h4>
      ${plan ? `<span class="lg-plan ${rv.followedPlan === 'yes' ? 'yes' : 'meh'}">${plan}</span>` : ''}
      ${lines.map(([k, v]) => `<p class="lg-note"><span>${k}</span>${esc(clip(v, 240))}</p>`).join('')}
      <div class="lg-chipline"><span class="lg-cl">Mistakes</span>${mistakesHtml(g, 6)}</div>
      <div class="lg-chipline"><span class="lg-cl">Tags</span>${minis(tagItems(t), 'tag', 6)}</div>
      ${pre.length || post.length ? `<div class="lg-chipline"><span class="lg-cl">Feelings</span>${pre.length ? minis(pre, 'emo', 2) : ''}${pre.length && post.length ? '<span class="dim" aria-label="then">→</span>' : ''}${post.length ? minis(post, 'emo', 2) : ''}</div>` : ''}
      <div class="lg-chipline"><span class="lg-cl">Process</span>${gradeBadge(t.grade)}${isN(t.rulesMetPct) ? ` <span class="lg-rules">${Math.round(t.rulesMetPct * 100)}% rules met</span>` : ''}${ds ? ' ' + stars(ds) : ''}</div>
      ${g.closed && !reviewed ? `<div class="lg-chipline"><button type="button" class="btn btn-primary btn-xs" data-act="review" data-id="${id}" data-fid="drev-${id}"><svg aria-hidden="true"><use href="#i-flag"/></svg>Review this trade</button><span class="dim">mistakes, grade and one lesson</span></div>` : ''}</section>`;
    const sec4 = `<section class="lg-dsec" aria-label="Screenshots"><h4 class="lg-dh">Screenshots</h4>${shotsHtml(t)}</section>`;
    // Quick actions (stable data-fid → focus survives price ticks and commits)
    const qa = (act, icon, label, extra) => `<button type="button" class="btn ${act === 'del' ? 'btn-quiet' : 'btn-ghost'} btn-xs${act === 'del' ? ' lg-del' : ''}" data-act="${act}" ${extra || `data-id="${id}"`} data-fid="dact-${act}-${id}"><svg aria-hidden="true"><use href="#i-${icon}"/></svg>${label}</button>`;
    const acts = [qa('view', 'eye', 'Open'), qa('edit', 'edit', 'Edit')];
    if (d.openLeg) acts.push(qa('close', 'check', g.portions.length > 1 ? 'Close a leg' : 'Close trade', `data-row="${esc(d.openLeg.id)}"`));
    if (!g.closed && t.type === 'trade') acts.push(qa('scale', 'layers', 'Add leg'));
    if (g.closed) acts.push(qa('review', 'flag', reviewed ? 'Edit review' : 'Review'));
    if (fnOf(() => TradeChart, 'open')) acts.push(qa('chart', 'candles', 'Chart'));
    acts.push(qa('del', 'trash', 'Delete'));
    return `<tr class="detail lg-detail" id="${domId(t.id)}"><td colspan="${n}"><div class="lg-dgrid">${sec1}${sec2}${sec3}${sec4}<div class="lg-dacts">${acts.join('')}</div></div></td></tr>`;
  }

  /* ── Cash-flow rows ────────────────────────────────────── */
  function flowHtml(r, cols) {
    const adj = r.type === 'adjustment', dep = r.type === 'deposit';
    const amt = adj ? (isN(r.adjustDelta) ? r.adjustDelta : 0) : (isN(r.flowAmount) ? r.flowAmount : 0) * (dep ? 1 : -1);
    const badge = adj ? '<span class="badge adj sm">⇄ ADJUST</span>' : dep ? '<span class="badge dep sm">↓ DEPOSIT</span>' : '<span class="badge wd sm">↑ WITHDRAW</span>';
    const noteTxt = typeof r.flowNote === 'string' ? r.flowNote : '';
    const note = adj ? `Balance set to ${money(r.balance)}${noteTxt ? ' · ' + esc(noteTxt) : ''}` : (noteTxt ? esc(noteTxt) : `<span class="dim">${dep ? 'Deposit' : 'Withdrawal'} — not counted as trading P/L</span>`);
    const ms = Date.parse(r.entryAt), id = esc(r.id);
    const iSide = cols.findIndex(c => c.id === 'side'), iPl = cols.findIndex(c => c.id === 'pl');
    let h = '';
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (i === iSide && iPl > iSide) { h += `<td colspan="${iPl - iSide}" class="lg-flow-note">${note}</td>`; i = iPl - 1; continue; }
      switch (c.id) {
        case 'date': h += `<td class="sticky-col lg-c-date"><div class="lg-first"><span class="lg-cb-sp" aria-hidden="true"></span><span class="lg-caret-sp" aria-hidden="true"></span><span class="lg-when" title="${esc(fullWhen(isFinite(ms) ? ms : 0))}">${esc(whenText(isFinite(ms) ? ms : 0))}</span></div></td>`; break;
        case 'coin': h += `<td>${badge}</td>`; break;
        // Neutral colour on purpose: cash flows are not profit or loss
        case 'pl': h += `<td class="num"><span class="lg-flow-amt">${amt < 0 ? MINUS : '+'}${money(Math.abs(amt))}</span></td>`; break;
        case 'bal': h += `<td class="num">${isN(r.balance) ? money(r.balance) : dash}</td>`; break;
        case 'acts': h += `<td class="lg-acts-c"><div class="lg-acts"><button type="button" class="lg-ib" data-act="flowedit" data-id="${id}" data-fid="fedit-${id}" aria-label="Edit this ${esc(r.type)}" title="Edit"><svg aria-hidden="true"><use href="#i-edit"/></svg></button><button type="button" class="lg-ib" data-act="flowdel" data-id="${id}" data-fid="fdel-${id}" aria-label="Delete this ${esc(r.type)}" title="Delete"><svg aria-hidden="true"><use href="#i-trash"/></svg></button></div></td>`; break;
        default: h += '<td></td>';
      }
    }
    return `<tr class="lg-row lg-flow clickable" data-flow="${id}" data-fid="row-${id}" tabindex="-1">${h}</tr>`;
  }

  /* ── Header, totals, bulk bar, banners ─────────────────── */
  // Column ids the user picked (or the defaults) — what the Columns popover shows as ticked
  function chosenCols() {
    const ch = Array.isArray(S().ledgerCols) ? new Set(S().ledgerCols) : null;
    return new Set(COLS.filter(c => c.tier === 'always' || (ch ? ch.has(c.id) : c.tier === 'default')).map(c => c.id));
  }
  // The sorted column always shows, so the order on screen is never invisible (a saved view can sort by
  // Duration while that optional column is hidden)
  function visibleCols() { const on = chosenCols(); return COLS.filter(c => on.has(c.id) || (c.sort && c.sort === sort.key)); }
  const ariaSort = (key) => (key && sort.key === key ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '');
  const sortBtn = (key, label) => `<button type="button" class="sort" data-sort="${key}" data-fid="sort-${key}">${esc(label)}<span class="lg-si" aria-hidden="true">${sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span></button>`;
  function headHtml(c) {
    if (c.id === 'date') return `<th scope="col" class="sticky-col lg-h-date"${ariaSort('date')}><div class="lg-first"><input type="checkbox" class="lg-cb" data-selall data-fid="selall" aria-label="Select all shown trades"><span class="lg-caret-sp" aria-hidden="true"></span>${sortBtn('date', 'Date')}</div></th>`;
    if (c.id === 'acts') return '<th scope="col" class="lg-h-acts"><span class="sr-only">Actions</span></th>';
    const info = c.id === 'r' ? ' ' + tip('rMultiple', 'R = net P/L ÷ the $ you risked at the stop (fees included). “—” means no stop was set, so R cannot be measured.')
      : c.id === 'pl' ? ' ' + tip('netPL', 'Profit or loss after fees, funding and gas. Open trades show an unrealised estimate at the live price.') : '';
    const label = c.id === 'pl' && units() !== '$' ? `${c.label} (${units()})` : c.label;   // the column follows the unit switch
    return `<th scope="col"${c.num ? ' class="num"' : ''}${c.full ? ` title="${esc(c.full)}"` : ''}${ariaSort(c.sort)}>${c.sort ? sortBtn(c.sort, label) : esc(label)}${info}</th>`;
  }
  function totalsHtml(res, n) {
    const gs = res.gs, closed = gs.filter(g => g.closed), nC = closed.length, nO = gs.length - nC;
    const pl = sum(closed.map(g => (isN(g.netPL) ? g.netPL : 0)));
    const pct = sum(closed.map(g => (isN(g.changePct) ? g.changePct : 0)));
    const rs = closed.map(g => g.R).filter(isN), rN = rs.length, sumR = rN ? sum(rs) : null, avgR = rN ? sumR / rN : null;
    const wins = closed.filter(g => g.win).length, wr = nC ? wins / nC : null;
    const costs = sum(res.items.filter(it => it.kind === 'g').map(it => it.d.costs));
    const u = units();
    const plVal = u === 'R' ? sumR : u === '%' ? pct : pl;
    const plTxt = u === 'R' ? fmtR(sumR) : u === '%' ? fmtPct(pct, { sign: true }) : fmtMoney(pl, { sign: true });
    const plSub = u === 'R' ? `sum of ${rN} with a stop` : u === '%' ? 'sum of account % changes' : 'closed trades · realised';
    // Open positions at the last live price — a separate, clearly unrealised figure, never added to Net P/L
    const lvs = res.items.filter(it => it.kind === 'g' && !it.g.closed && it.d.lv && it.d.lv.q).map(it => it.d.lv);
    let openTile = '';
    if (lvs.length) {
      const uv = u === 'R' ? lvs.map(l => l.R).filter(isN) : u === '%' ? lvs.map(l => l.pct).filter(isN) : lvs.map(l => l.tot);
      const ov = uv.length ? sum(uv) : null;
      const oTxt = u === 'R' ? fmtR(ov) : u === '%' ? fmtPct(ov, { sign: true }) : fmtMoney(ov, { sign: true });
      const stale = lvs.some(l => l.stale), part = lvs.some(l => l.realised);
      openTile = `<div class="lg-ti lg-ti-open"><span class="lg-tl">Open P/L</span><b class="${isN(ov) ? plClass(ov) : ''}">${isN(ov) ? `≈ ${glyph(ov)} ${u === '$' ? `<span class="money">${oTxt}</span>` : oTxt}` : '—'}</b><small>unrealised${part ? ' + closed legs' : ''} · ${u === 'R' ? `${uv.length} with a stop` : `${lvs.length} of ${nO} open`}${stale ? ' · <span class="lg-warn">stale price</span>' : ''}</small></div>`;
    }
    return `<tfoot><tr><td colspan="${n}"><div class="lg-tot" role="group" aria-label="Totals for the filtered trades">
      <div class="lg-ti"><span class="lg-tl">Trades</span><b>${gs.length}</b><small>${nC} closed · ${nO} open</small>${confBadge(nC)}</div>
      <div class="lg-ti"><span class="lg-tl">Net P/L</span><b class="${nC ? plClass(plVal) : ''}">${nC && isN(plVal) ? `${glyph(plVal)} ${u === '$' ? `<span class="money">${plTxt}</span>` : plTxt}` : '—'}</b><small>${plSub}</small></div>
      ${openTile}
      <div class="lg-ti${rN < 20 ? ' gated' : ''}"><span class="lg-tl">Avg net R ${tip('expR', 'Average net R per closed trade with a stop — what you make or lose per unit of risk, after costs.')}</span><b class="${rN >= 20 ? plClass(avgR) : ''}">${fmtR(avgR)}</b><small>n=${rN} with a stop${rN < 20 ? ' · needs 20+ trades' : ''}</small></div>
      <div class="lg-ti${nC < 20 ? ' gated' : ''}"><span class="lg-tl">Win rate ${tip('winRate', 'Share of closed trades that made money after costs.')}</span><b>${wr == null ? '—' : fmtPct(wr, { dp: 0 })}</b><small>${wins} of ${nC}${nC < 20 ? ' · needs 20+ trades' : ''}</small></div>
      <div class="lg-ti"><span class="lg-tl">Costs ${tip('fees', 'Exchange fees, perp funding and DEX gas on these trades.')}</span><b>${money(costs)}</b><small>fees · funding · gas</small></div>
    </div></td></tr></tfoot>`;
  }
  function bulkHtml() {
    if (!sel.size) return '';
    const nMatch = last ? last.gs.length : 0;
    const inView = last ? last.gs.filter(g => sel.has(g.trade.id)).length : sel.size;
    const hidden = sel.size - inView;
    return `<div class="lg-bulk" role="region" aria-label="Bulk actions for selected trades">
      <span class="lg-bulk-n"><b>${sel.size}</b> selected${hidden > 0 ? ` <span class="dim">(${hidden} hidden by filters)</span>` : ''}</span>
      ${inView < nMatch ? `<button type="button" class="link-btn" data-bulk="all" data-fid="bulk-all">Select all ${nMatch} matching</button>` : ''}
      <span class="sp"></span>
      <button type="button" class="btn btn-ghost btn-xs" data-bulk="tag" data-fid="bulk-tag"><svg aria-hidden="true"><use href="#i-flag"/></svg>Add tag</button>
      <button type="button" class="btn btn-ghost btn-xs" data-bulk="clean" data-fid="bulk-clean"><svg aria-hidden="true"><use href="#i-check"/></svg>Mark reviewed (clean)</button>
      <button type="button" class="btn btn-ghost btn-xs" data-bulk="csv" data-fid="bulk-csv"><svg aria-hidden="true"><use href="#i-download"/></svg>Export selected</button>
      <button type="button" class="btn btn-danger btn-xs" data-bulk="del" data-fid="bulk-del"><svg aria-hidden="true"><use href="#i-trash"/></svg>Delete</button>
      <button type="button" class="lg-ib" data-bulk="none" data-fid="bulk-none" aria-label="Clear selection" title="Clear selection"><svg aria-hidden="true"><use href="#i-x"/></svg></button>
    </div>`;
  }
  // "Filtered from <source>: n trades · Clear" for programmatic drill-downs (calendar, insights…)
  function bannerHtml(n) {
    if (!progOn()) return '';
    const what = progParts(f);
    if (f.day) what[0] = fmtDate(dayMs(f.day));    // full date in the banner, short one on the chip
    if (f.ids) what.push(plural(f.ids.length, 'picked trade'));
    const from = source || (f.ids ? 'an insight' : f.day ? 'the calendar' : 'Analytics');
    return `<div class="banner info lg-banner" role="status"><svg aria-hidden="true"><use href="#i-filter"/></svg>
      <div class="grow">Filtered from <b>${esc(from)}</b>${what.length ? ' — ' + esc(what.join(' · ')) : ''}: <b>${plural(n, 'trade')}</b>${f.day ? ' <span class="dim">(closed trades by exit day)</span>' : ''}</div>
      <div class="acts"><button type="button" class="btn btn-ghost btn-xs" data-banner-clear data-fid="banner-clear">Clear</button></div></div>`;
  }
  // Review queue (critic: "% of trades reviewed" + a review-later queue)
  function queueHtml() {
    if (f.status === 'review') return '';
    const closed = C.closedGroups.length; if (!closed) return '';
    const n = C.groups.filter(needsReview).length; if (!n) return '';
    const pct = Math.round(C.closedGroups.filter(g => Metrics.isReviewed(g.trade)).length / closed * 100);
    return `<div class="lg-queue" role="note"><svg aria-hidden="true"><use href="#i-flag"/></svg>
      <span class="grow"><b>${n}</b> closed trade${n === 1 ? '' : 's'} still need${n === 1 ? 's' : ''} a review — tag mistakes (or mark clean) and grade the process. That is what turns results into lessons.</span>
      <span class="lg-qpct" title="Share of closed trades you have reviewed">${pct}% reviewed</span>
      <button type="button" class="btn btn-ghost btn-xs" data-queue data-fid="queue">Show them</button></div>`;
  }
  function firstRunHtml() {
    const m = db.mode, acts = [
      { id: 'first', label: m === 'live' ? 'Log your first live trade' : 'Log your first trade', icon: 'plus', primary: true },
      { id: 'quick', label: 'Quick log', icon: 'zap' },
      { id: 'import', label: 'Import exchange CSV', icon: 'file-in' },
      m === 'demo' ? { id: 'gen', label: 'Generate demo trades', icon: 'sparkle' } : { id: 'demo', label: 'Explore with demo data', icon: 'sparkle' },
    ];
    const small = m === 'demo' ? 'The demo account is empty. Generate sample trades to explore every screen — they never mix with your paper or live journal.'
      : m === 'live' ? 'Your live journal is empty. Log every real trade with its stop — risk, R and discipline stats build from here.'
      : 'Every paper trade you log lands here with its result in $ and R and your review. Start with one trade — a stop is all R needs.';
    const li = (icon, html) => `<li><svg aria-hidden="true"><use href="#i-${icon}"/></svg><span>${html}</span></li>`;
    return `<div class="card lg-first-run">${emptyHtml(m === 'demo' ? 'No demo trades yet' : 'No trades yet', small, acts)}
      <ul class="lg-tips">${li('zap', '<b>Quick log</b> takes three fields. Fill in the review later — it waits in the review queue.')}${li('shield', '<b>Always set a stop.</b> Without one, risk is unlimited and R cannot be measured.')}${li('file-in', '<b>Imported trades</b> arrive marked “Review” so nothing slips through.')}</ul></div>`;
  }

  /* ── Page assembly ─────────────────────────────────────── */
  function shellHtml() {
    const dens = S().density === 'compact' ? 'compact' : 'comfortable';
    const dBtn = (v, l) => `<button type="button" data-tb="dens" data-v="${v}" data-fid="dens-${v}" class="${dens === v ? 'on' : ''}" aria-pressed="${dens === v}">${l}</button>`;
    return `<div class="lg-bar">
      <div class="lg-main-acts">
        <button type="button" class="btn btn-primary btn-sm" data-tb="new" title="New trade (N)"><svg aria-hidden="true"><use href="#i-plus"/></svg>New trade</button>
        <button type="button" class="btn btn-ghost btn-sm" data-tb="quick" aria-label="Quick log" title="Quick log — coin, side, entry/stop/size"><svg aria-hidden="true"><use href="#i-zap"/></svg><span class="lg-lbl">Quick log</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-tb="flow" aria-label="Deposit / Withdraw" title="Record a deposit, withdrawal or balance adjustment"><svg aria-hidden="true"><use href="#i-wallet"/></svg><span class="lg-lbl">Deposit / Withdraw</span></button>
      </div>
      <div class="search-box lg-search"><svg aria-hidden="true"><use href="#i-search"/></svg><input class="input" id="lg-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search coin, notes, tags, strategy…" aria-label="Search trades" value="${esc(f.q)}"></div>
      <div class="lg-tools">
        <button type="button" class="tb-btn lg-ftoggle" data-tb="filters" aria-expanded="${filtersOpen}" aria-controls="lg-filters"><svg aria-hidden="true"><use href="#i-filter"/></svg>Filters<span class="lg-fcount"></span></button>
        <button type="button" class="tb-btn" data-tb="views" aria-haspopup="dialog" aria-expanded="false" aria-label="Saved views"><svg aria-hidden="true"><use href="#i-layers"/></svg><span class="lg-lbl">Views</span></button>
        <button type="button" class="tb-btn" data-tb="cols" aria-haspopup="dialog" aria-expanded="false" aria-label="Choose columns"><svg aria-hidden="true"><use href="#i-columns"/></svg><span class="lg-lbl">Columns</span></button>
        <div class="seg sm inline lg-dens" role="group" aria-label="Row density">${dBtn('comfortable', 'Comfortable')}${dBtn('compact', 'Compact')}</div>
        <button type="button" class="tb-btn" data-tb="csv" aria-label="Export filtered trades as CSV" title="Export the filtered trades as CSV (opens in Excel)"><svg aria-hidden="true"><use href="#i-download"/></svg><span class="lg-lbl">CSV</span></button>
      </div>
    </div>
    <div class="filterbar lg-filters${filtersOpen ? ' open' : ''}" id="lg-filters" role="group" aria-label="Filter trades"></div>
    <div class="lg-body"></div>
    <div class="sr-only" aria-live="polite" id="lg-live"></div>`;
  }
  function filtersHtml(res) {
    const all = C.groups, nOpen = all.filter(g => !g.closed).length, nRev = all.filter(needsReview).length;
    const cnt = (k, cls) => (k ? ` <span class="lg-cn${cls ? ' ' + cls : ''}">${k}</span>` : '');
    const chip = (key, v, label, extra) => { const on = f[key] === v; return `<button type="button" class="chip sm${on ? ' on' : ''}" data-f="${key}" data-v="${esc(v)}" data-fid="f-${key}-${esc(v)}" aria-pressed="${on}">${esc(label)}${extra || ''}</button>`; };
    const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
    const select = (key, label, pairs, blank) => `<select class="input${f[key] ? ' lg-on' : ''}" data-fs="${key}" data-fid="fs-${key}" aria-label="${esc(label)}">${opt('', blank, f[key])}${pairs.map(([v, t]) => opt(v, t, f[key])).join('')}</select>`;
    const coins = [...new Set(all.map(g => (g.coin ? String(g.coin).toUpperCase() : '')).filter(Boolean))].sort();
    if (f.coin && !coins.includes(f.coin)) coins.unshift(f.coin);
    // a drill-down can name a market outside the standard list (legacy / imported rows): keep the select truthful
    const mkts = MARKETS.map(m => [m.id, m.label]);
    if (f.market && !mkts.some(m => m[0] === f.market)) mkts.push([f.market, f.market]);
    const used = new Set(all.map(g => g.strategyId).filter(Boolean));
    const strats = db.strategies.filter(s => s && s.id && (!s.archived || used.has(s.id))).map(s => [s.id, s.name || s.id]);
    if (f.strategyId && !strats.some(s => s[0] === f.strategyId)) strats.push([f.strategyId, stratName(f.strategyId)]);
    const tags = allTags(); if (f.tag && !tags.includes(f.tag)) tags.push(f.tag);
    // retired (hidden) mistakes stay listed only while a trade still carries them
    const usedMk = new Set(); for (const g of all) for (const m of realMk(g.trade)) usedMk.add(m);
    const mks = [['__clean__', 'No mistakes tagged'], ...arr(db.mistakes).filter(m => m && (!m.hidden || usedMk.has(m.id))).map(m => [m.id, m.label])];
    if (f.mistake && !mks.some(m => m[0] === f.mistake)) mks.push([f.mistake, mistakeLabel(f.mistake)]);
    const ranges = PRESETS.slice(1).concat(f.range === 'custom' ? [['custom', 'Custom: ' + rangeLabel(f.from, f.to)]] : []);
    const extra = [];
    if (f.day) extra.push(['day', 'Day: ' + fmtDateShort(dayMs(f.day))]);
    if (f.session) extra.push(['session', 'Session: ' + f.session]);
    if (f.weekday) extra.push(['weekday', 'Weekday: ' + f.weekday]);
    if (f.grade) extra.push(['grade', 'Grade: ' + f.grade]);
    if (f.venue) extra.push(['venue', 'Venue: ' + f.venue]);
    if (f.emotion) extra.push(['emotion', 'Felt: ' + emoLabel(f.emotion)]);
    if (f.hold) extra.push(['hold', 'Held: ' + f.hold]);
    if (f.ids) extra.push(['ids', plural(f.ids.length, 'picked trade')]);
    const act = activeCount(), notDate = sort.key !== 'date';
    // flows ride along only in date order and without a trade-specific filter (flowMatch): say why when hidden
    const hasFlows = C.rows.some(r => FLOW_TYPES.includes(r.type));
    const flowWhy = notDate ? 'date sort only' : showFlows && tradeFilterOn() ? 'hidden by trade filters' : '';
    return `<div class="lg-fg" role="group" aria-label="Status">${chip('status', '', 'All')}${chip('status', 'open', 'Open', cnt(nOpen))}${chip('status', 'closed', 'Closed')}${chip('status', 'review', 'Needs review', cnt(nRev, 'warn'))}</div>
      <div class="lg-fg" role="group" aria-label="Result">${chip('result', 'win', 'Win')}${chip('result', 'loss', 'Loss')}${chip('result', 'be', 'Breakeven')}</div>
      <div class="lg-fg" role="group" aria-label="Side">${chip('side', 'long', 'Long')}${chip('side', 'short', 'Short')}</div>
      ${select('coin', 'Coin', coins.map(c => [c, c]), 'All coins')}
      ${select('strategyId', 'Strategy', strats, 'All strategies')}
      ${select('market', 'Market', mkts, 'All markets')}
      ${select('tag', 'Tag', tags.map(t => [t, t]), 'All tags')}
      ${select('mistake', 'Mistake', mks, 'Mistake: any or none')}
      ${select('range', 'Date range', ranges, 'All dates')}
      ${extra.map(([k, t]) => `<button type="button" class="chip sm on lg-xchip" data-unset="${k}" data-fid="un-${k}" aria-label="${esc('Remove filter ' + t)}">${esc(t)}<span class="x" aria-hidden="true"><svg><use href="#i-x"/></svg></span></button>`).join('')}
      ${hasFlows ? `<label class="check lg-flows" title="Deposits, withdrawals and balance adjustments, interleaved by date"><input type="checkbox" data-flows data-fid="flows"${showFlows ? ' checked' : ''}${notDate ? ' disabled' : ''}>Show cash flows${flowWhy ? ` <span class="dim">(${flowWhy})</span>` : ''}</label>` : ''}
      <span class="sp"></span>
      <span class="count">${res.gs.length} of ${plural(all.length, 'trade')}</span>
      ${act ? `<span class="active-n" title="${plural(act, 'filter')} active">${act}</span><button type="button" class="btn btn-quiet btn-xs" data-clear data-fid="clear">Clear</button>` : ''}`;
  }
  const hasData = () => !!C && (C.groups.length > 0 || C.rows.some(r => FLOW_TYPES.includes(r.type)));
  function bodyHtml(res) {
    openShown = false;
    if (!hasData()) return firstRunHtml();
    const head = bannerHtml(res.gs.length) + queueHtml() + `<div class="lg-bulkhost">${bulkHtml()}</div>`;
    if (!res.items.length) {
      // only deposits / withdrawals so far, and they are hidden (toggle off or a non-date sort): nothing to "clear"
      if (!activeCount() && !C.groups.length) return head + `<div class="card lg-none">${emptyHtml('No trades yet', 'Only cash flows are recorded so far. Tick “Show cash flows” (date sort) to list them.', [{ id: 'first', label: 'Log a trade', icon: 'plus', primary: true }, { id: 'quick', label: 'Quick log', icon: 'zap' }])}</div>`;
      return head + `<div class="card lg-none">${emptyHtml('No trades match these filters', 'Try removing a filter or clearing the search.', [{ id: 'clear', label: 'Clear filters', icon: 'x', primary: true }])}</div>`;
    }
    const cols = visibleCols(), rows = [];
    let shown = 0;
    for (const it of res.items) {
      if (it.kind === 'f') { rows.push(flowHtml(it.r, cols)); continue; }
      if (shown >= limit) break;
      shown++;
      if (!it.g.closed) openShown = true;
      const g = it.g, id = g.trade.id, ex = expanded.has(id);
      const cls = ['lg-row', 'clickable'];
      if (sel.has(id)) cls.push('sel');
      if (!g.closed) cls.push('lg-open');
      if (ex) cls.push('lg-ex');
      rows.push(`<tr class="${cls.join(' ')}" data-id="${esc(id)}" data-fid="row-${esc(id)}" tabindex="-1">${cols.map(c => cellHtml(c, g, it.d)).join('')}</tr>`);
      if (ex) rows.push(legsHtml(g, cols) + detailHtml(g, it.d, cols.length));
    }
    const remaining = res.gs.length - shown;
    const s = sortDef();
    return head + `<div class="lg-tc"><div class="table-wrap lg-wrap">
      <table class="lg-t"><caption class="sr-only">Trades: ${shown} of ${res.gs.length} shown, sorted by ${esc(s.name)} ${sort.dir === 'asc' ? 'ascending' : 'descending'}. Enter opens a row, Space expands it, X selects it.</caption>
        <thead><tr>${cols.map(headHtml).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
        ${totalsHtml(res, cols.length)}
      </table></div>
      ${remaining > 0 ? `<div class="lg-more"><span class="dim">Showing ${shown} of ${res.gs.length} trades</span><button type="button" class="btn btn-ghost btn-sm" data-more data-fid="more">Show ${Math.min(PAGE, remaining)} more</button></div>` : ''}</div>`;
  }
  function allTags() {
    const s = new Set();
    for (const tg of arr(db.tagGroups)) for (const t of arr(tg && tg.tags)) if (typeof t === 'string' && t) s.add(t);
    if (C) for (const g of C.groups) for (const t of arr(g.trade.tags)) if (typeof t === 'string' && t) s.add(t);
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  /* ── Drawing (render = full rebuild; draw* = in-place) ─── */
  // Focus snapshot taken before a redraw: the control's data-fid plus the index of the trade row it sat in
  function focusSnap() {
    const a = document.activeElement;
    if (!a || !host || a === document.body || !host.contains(a)) return null;
    let tr = a.closest ? a.closest('tr') : null;
    while (tr && !tr.classList.contains('lg-row')) tr = tr.previousElementSibling;   // leg / detail row → its trade row
    return { fid: (a.dataset && a.dataset.fid) || null, row: tr ? $$('tr.lg-row', host).indexOf(tr) : -1 };
  }
  // Put focus back after a redraw. When that control is gone (a chip that cleared itself, a deleted row, the
  // bulk bar after its action) land on `alt`, then the row at the same position, then the first row —
  // never drop a keyboard user onto <body>.
  function refocus(snap, alt) {
    if (!snap || !host) return;
    if (typeof snap === 'string') snap = { fid: snap, row: -1 };
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && host.contains(a)) return;   // it survived the redraw
    const vis = (el) => !!el && !el.disabled && el.getClientRects().length > 0;
    const q = (s) => { try { return host.querySelector(s); } catch (e) { return null; } };
    const rows = $$('tr.lg-row', host);
    const cands = [snap.fid ? q(`[data-fid="${cssEsc(snap.fid)}"]`) : null]
      .concat([].concat(alt || []).filter(s => typeof s === 'string').map(q))
      .concat(snap.row >= 0 && rows.length ? rows[Math.min(snap.row, rows.length - 1)] : null, rows[0] || null, $('#lg-search', host));
    const el = cands.find(vis);
    if (!el) return;
    if (el.matches('tr.lg-row')) el.tabIndex = 0;
    el.focus({ preventScroll: true });
  }
  // Something is layered over the page (trade form drawer, a modal, the palette): redrawing under it would
  // detach the element it returns focus to on close.
  const covered = () => (typeof Drawer !== 'undefined' && Drawer.isOpen) || !!document.querySelector('.modal-backdrop.open')
    || !!(mod(() => Palette) || {}).isOpen;
  function drawFilters(res) {
    const fl = host && $('#lg-filters', host); if (!fl) return;
    fl.innerHTML = filtersHtml(res);
    const n = activeCount(), fc = $('.lg-fcount', host);
    if (fc) fc.innerHTML = n ? ` <span class="active-n">${n}</span>` : '';
    // First run: nothing to search, filter or export yet — only the logging buttons sit above the empty state
    const bare = !hasData();
    fl.hidden = bare;
    const bar = $('.lg-bar', host); if (bar) bar.classList.toggle('lg-bare', bare);
  }
  function drawBody(keepScroll, res) {
    const body = host && $('.lg-body', host); if (!body || !C) return;
    res = res || (last = collect());
    const w = $('.lg-wrap', body), st = w ? w.scrollTop : 0, sl = w ? w.scrollLeft : 0;
    body.innerHTML = bodyHtml(res);
    const w2 = $('.lg-wrap', body);
    if (w2) { w2.scrollLeft = sl; if (keepScroll) w2.scrollTop = st; }
    afterBody(body, res);
  }
  function afterBody(body, res) {
    // roving tabindex: one row in the Tab order, arrows move between rows
    const rows = $$('tr.lg-row', body);
    const r0 = (rovingId && rows.find(r => r.dataset.fid === rovingId)) || rows[0];
    if (r0) r0.tabIndex = 0;
    headSel(body);
    hydrate(body);
    bindEmpty(body, {
      first: () => tfOrWarn('open', null), quick: () => tfOrWarn('quick'), import: goImport,
      demo: openDemo,
      gen: genDemo, clear: clearAll,
    });
    const live = $('#lg-live', host), msg = `${plural(res.gs.length, 'trade')} shown`;
    if (live && msg !== lastAnnounce) { live.textContent = msg; lastAnnounce = msg; }
    // Ask for fresh prices for the open coins at most once a minute (Market caches + rate-limits). The
    // 'prices' redraw passes through here too, but the one-minute gate keeps that to one fetch a minute.
    const M = openShown ? fnOf(() => Market, 'prices') : null;
    if (M && navigator.onLine !== false && Date.now() - lastPriceReq > 60000) {
      lastPriceReq = Date.now();
      const coins = [...new Set(res.gs.filter(g => !g.closed).map(g => g.coin).filter(c => typeof c === 'string' && c))];
      setTimeout(() => { try { Promise.resolve(M.prices(coins)).catch(() => {}); } catch (e) { /* offline */ } }, 0);
    }
  }
  function refilter(alt) {
    if (!host || !C || !host.isConnected) return;
    const snap = focusSnap();
    last = collect();
    drawFilters(last);
    drawBody(false, last);
    refocus(snap, alt);
  }
  function changed(alt) { limit = PAGE; refilter(alt); }
  // The toolbar shell is built once and then kept: later renders (window resize — which includes a phone
  // keyboard opening —, commits, unit / privacy switches) redraw only the filter row and the table, so the
  // search box keeps its focus, caret and anything typed inside the debounce window.
  function wireSearch(sec) {
    const q = $('#lg-search', sec); if (!q) return;
    const apply = debounce(() => { if (!q.isConnected) return; f.q = q.value; searchDirty = false; changed(); }, 180);
    q.addEventListener('input', () => { searchDirty = true; apply(); });
  }
  function syncShell(sec) {
    const dens = S().density === 'compact' ? 'compact' : 'comfortable';
    $$('[data-tb="dens"]', sec).forEach(b => { const on = b.dataset.v === dens; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const fl = $('#lg-filters', sec); if (fl) fl.classList.toggle('open', filtersOpen);
    const ft = $('[data-tb="filters"]', sec); if (ft) ft.setAttribute('aria-expanded', String(filtersOpen));
    const q = $('#lg-search', sec); if (q && q.value !== f.q) q.value = f.q;
  }
  function render(sec) {
    // focus inside an open popover returns to its trigger, which the kept toolbar shell still holds
    const popAlt = pop && pop.el.contains(document.activeElement) && pop.trigger.dataset.tb ? `[data-tb="${pop.trigger.dataset.tb}"]` : null;
    const snap = host === sec ? focusSnap() : null;
    closePop();
    host = sec;
    if (!C && typeof recompute === 'function') recompute();
    if (!C) { sec.innerHTML = ''; return; }
    if (lastMode !== db.mode) {
      // selection, expansion and picked-ids belong to the previous account
      if (lastMode !== null) { sel.clear(); expanded.clear(); f.ids = null; source = null; limit = PAGE; rovingId = null; }
      lastMode = db.mode;
    }
    bindOnce(sec);
    const ow = $('.lg-wrap', sec), keep = ow && !resetScroll ? [ow.scrollTop, ow.scrollLeft] : null, reset = resetScroll;
    resetScroll = false;
    const q0 = $('#lg-search', sec);
    if (q0 && searchDirty) f.q = q0.value;   // typed but not applied yet — keep it rather than reverting it
    searchDirty = false;
    if (q0 && $('#lg-filters', sec) && $('.lg-body', sec)) syncShell(sec);
    else { sec.innerHTML = shellHtml(); wireSearch(sec); }   // first paint, or the router replaced the page after an error
    last = collect();
    drawFilters(last);
    drawBody(false, last);
    const w = $('.lg-wrap', sec);
    if (w && keep) { w.scrollTop = keep[0]; w.scrollLeft = keep[1]; }
    else if (w && reset) { w.scrollTop = 0; w.scrollLeft = 0; }
    refocus(snap, popAlt);
    if (focusAfterShow) {
      // A drill-down replaced the page under the user's focus: land on the banner that explains the filter
      focusAfterShow = false;
      const b = !covered() && $('.lg-banner', sec);
      if (b) { b.tabIndex = -1; b.focus({ preventScroll: true }); }
    }
  }
  function sub() {
    if (!C) return '';
    const n = C.groups.length;
    if (!n) return 'Every trade you log, in $ and R';
    const o = C.groups.filter(g => !g.closed).length, r = C.groups.filter(needsReview).length;
    return `${plural(n, 'trade')} · ${o} open${r ? ` · ${r} to review` : ''}`;
  }

  /* ── Media (screenshots) ───────────────────────────────── */
  async function mediaUrl(id) {
    if (media.has(id)) return media.get(id);
    const St = fnOf(() => Store, 'mediaURL'); if (!St) return null;
    try { const u = safeUrl(await St.mediaURL(id)); if (u) media.set(id, u); return u; } catch (e) { return null; }
  }
  const isWeb = (u) => /^https?:/i.test(u || '');
  function hydrate(body) {
    // A thumbnail that fails to load shows "missing" (media not on this device, broken data URL) instead of a
    // broken image; v1 web links are never loaded here (shotsHtml marks them "link ↗" up front).
    $$('.lg-shot img', body).forEach(img => img.addEventListener('error', () => {
      const b = img.closest('.lg-shot'); if (b) b.classList.add(!img.dataset.media && isWeb(img.getAttribute('src')) ? 'link' : 'missing');
    }, { once: true }));
    $$('img[data-media]', body).forEach(img => {
      mediaUrl(img.dataset.media).then(u => {
        if (!img.isConnected) return;
        if (u) img.src = u; else { const b = img.closest('.lg-shot'); if (b) b.classList.add('missing'); }
      });
    });
  }
  async function openShot(tradeId, ix) {
    const e = entryById(tradeId); if (!e) return;
    const s = shotList(e)[ix]; if (!s) return;
    const url = (s.id ? await mediaUrl(s.id) : null) || s.url;
    if (!url) { toast('That screenshot is not available on this device', 'warn'); return; }
    const kind = pick(SHOT_KIND, s.kind, 'Screenshot');
    const h = Modal.open({
      title: `${e.coin || 'Trade'} · ${kind}`, body: '<figure class="lg-full"></figure>', width: 1000,
      // the body has no input for Modal to focus — put focus on Close so Esc / Tab / screen readers start inside
      onMount: (el) => setTimeout(() => { const x = el.querySelector('.x'); if (x && el.isConnected && !el.contains(document.activeElement)) x.focus({ preventScroll: true }); }, 40),
    });
    const fig = h.el.querySelector('.lg-full'); if (!fig) return;
    const img = document.createElement('img');
    img.alt = s.caption || `${kind} screenshot`;
    if (isWeb(url)) {
      img.addEventListener('error', () => { img.remove(); const p = document.createElement('p'); p.className = 'lg-mhint'; p.textContent = 'This link is not a direct image (for example a TradingView page). Open it in a new tab to see the chart.'; fig.prepend(p); }, { once: true });
    }
    img.src = url;     // set as a property — never parsed as HTML
    fig.appendChild(img);
    if (s.caption) { const c = document.createElement('figcaption'); c.textContent = s.caption; fig.appendChild(c); }
    if (isWeb(url)) {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'link-btn lg-ext'; a.textContent = 'Open the original link ↗';
      fig.appendChild(a);
    }
  }

  /* ── Cross-module actions (all guarded) ────────────────── */
  function tf(fn, ...args) {
    const TF = fnOf(() => TradeForm, fn); if (!TF) return false;
    try { TF[fn](...args); } catch (e) { console.error('[ledger] TradeForm.' + fn, e); toast('Could not open the trade form', 'err'); }
    return true;
  }
  const tfOrWarn = (fn, ...a) => { if (!tf(fn, ...a)) toast('The trade form is not available yet', 'warn'); };
  function goImport() {
    if (Pages.has('import')) Router.go('import');
    else if (fnOf(() => Importer, 'open')) Importer.open();
    else toast('Import is not available yet', 'warn');
  }
  // switchMode is async: a rejection (or a sync throw) must surface as a toast, not an unhandled error
  function openDemo() {
    const A = fnOf(() => App, 'switchMode');
    if (!A) { toast('Demo data is not available yet', 'warn'); return; }
    Promise.resolve().then(() => A.switchMode('demo')).catch((e) => { console.error('[ledger] demo mode', e); toast('Could not open the demo account', 'err'); });
  }
  function genDemo() {
    if (!fnOf(() => Demo, 'ensure')) { toast('Demo data is not available yet', 'warn'); return; }
    // Demo.ensure() saves on its own and returns false when the demo account already had trades
    Promise.resolve().then(() => Demo.ensure()).then((made) => commit(made === false ? null : 'Demo trades generated', 'ok'), (e) => { console.error('[ledger] demo', e); toast('Could not generate demo data', 'err'); });
  }
  function openRow(tr) {
    if (tr.dataset.flow) { const e = entryById(tr.dataset.flow); if (e) tfOrWarn('flow', e.type, e); return; }
    const id = tr.dataset.id; if (!id) return;
    if (!tf('view', id)) toggleExp(id);   // no trade form yet → the inline detail still works
  }
  function rowAction(act, ds) {
    const id = ds.id, row = ds.row;
    switch (act) {
      case 'view': if (!tf('view', id)) toggleExp(id); return;
      case 'edit': { const e = entryById(id); if (e) tfOrWarn('open', e); return; }
      case 'editrow': { const e = entryById(row); if (e) tfOrWarn('open', e); return; }
      case 'close': tfOrWarn('close', row); return;
      case 'review': tfOrWarn('review', id); return;
      case 'scale': tfOrWarn('scale', id); return;
      case 'chart':
        if (fnOf(() => TradeChart, 'open')) TradeChart.open(id);
        else toast('Trade charts are not available yet', 'warn');
        return;
      case 'del': sel.delete(id); expanded.delete(id); softDelete([id], 'Moved the trade to Trash'); return;
      case 'flowedit': { const e = entryById(id); if (e) tfOrWarn('flow', e.type, e); return; }
      case 'flowdel': softDelete([id], 'Moved the entry to Trash'); return;
      default:
    }
  }
  function toggleExp(id) {
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    const snap = focusSnap();
    drawBody(true);
    refocus(snap);
  }
  function setSort(key) {
    if (!own(SORTS, key)) return;
    const s = SORTS[key];
    if (sort.key !== key) sort = { key, dir: s.first };
    else if (sort.dir === s.first) sort = { key, dir: s.first === 'asc' ? 'desc' : 'asc' };
    else sort = { key: 'date', dir: 'desc' };   // third click → back to the default order
    savePrefs(); changed();
  }
  function unset(k) {
    if (k === 'ids') f.ids = null; else if (own(f, k) && k !== 'from' && k !== 'to') f[k] = '';
    if (!progOn()) source = null;
  }
  function clearAll(alt) {
    f = F0(); source = null; searchDirty = false;
    const q = host && $('#lg-search', host); if (q) q.value = '';
    changed(typeof alt === 'string' ? alt : null);
  }

  /* ── Selection & bulk actions ──────────────────────────── */
  function headSel(body) {
    const all = $('input[data-selall]', body); if (!all) return;
    const ids = $$('tr.lg-row[data-id]', body).map(tr => tr.dataset.id);
    const n = ids.filter(id => sel.has(id)).length;
    all.checked = ids.length > 0 && n === ids.length;
    all.indeterminate = n > 0 && n < ids.length;
  }
  function syncSel() {
    const body = host && $('.lg-body', host); if (!body) return;
    $$('tr.lg-row[data-id]', body).forEach(tr => {
      const on = sel.has(tr.dataset.id);
      tr.classList.toggle('sel', on);
      const cb = tr.querySelector('input[data-sel]'); if (cb) cb.checked = on;
    });
    const bh = $('.lg-bulkhost', body); if (bh) bh.innerHTML = bulkHtml();
    headSel(body);
  }
  function selectShown(on) {
    const body = host && $('.lg-body', host); if (!body) return;
    $$('tr.lg-row[data-id]', body).forEach(tr => { if (on) sel.add(tr.dataset.id); else sel.delete(tr.dataset.id); });
    syncSel();
  }
  const cleanTag = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  // Remember the fields a patch will overwrite, so a save that fails can put them back exactly
  function keepFields(e, keys) {
    const was = keys.map(k => [k, own(e, k), e[k]]);
    return () => { for (const [k, had, v] of was) { if (had) e[k] = v; else delete e[k]; } };
  }
  function bulkTag(gs) {
    const known = allTags();
    Modal.open({
      title: `Add a tag to ${plural(gs.length, 'trade')}`, width: 460,
      body: `<div class="field"><label for="lg-tag-in">Tag</label><input class="input" id="lg-tag-in" list="lg-tag-dl" maxlength="40" autocomplete="off" placeholder="e.g. Ranging, News / volatile"><datalist id="lg-tag-dl">${known.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
        ${known.length ? `<div class="chip-group-l" style="margin-top:14px">Your tags</div><div class="chip-row">${known.slice(0, 30).map(t => `<button type="button" class="chip sm" data-pick="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
        <p class="lg-mhint">Tags describe context (market condition, timeframe…). Mistakes are tagged in each trade's review.</p>`,
      foot: '<button type="button" class="btn btn-ghost" data-x>Cancel</button><button type="button" class="btn btn-primary" data-ok>Add tag</button>',
      onMount(el, close) {
        const inp = el.querySelector('#lg-tag-in');
        const go = () => { const tag = cleanTag(inp.value); if (!tag) { inp.classList.add('invalid'); inp.focus(); return; } close(); applyTag(gs, tag); };
        el.querySelector('[data-x]').onclick = () => close();
        el.querySelector('[data-ok]').onclick = go;
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        inp.addEventListener('input', () => inp.classList.remove('invalid'));
        el.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => { inp.value = b.dataset.pick; go(); }; });
      },
    });
  }
  function applyTag(gs, tag) {
    let n = 0, added = null;
    const undo = [];
    for (const g of gs) {
      const e = entryById(g.trade.id); if (!e) continue;
      // a hand-edited / imported "a, b" string must not be wiped by the array write
      const tags = Array.isArray(e.tags) ? e.tags : typeof e.tags === 'string' ? e.tags.split(/[,|]/).map(s => s.trim()).filter(Boolean) : [];
      if (!tags.includes(tag)) { undo.push(keepFields(e, ['tags', 'updatedAt'])); updateEntry(e.id, { tags: tags.concat(tag) }); n++; }
    }
    // a brand-new tag joins the Custom group so the trade form offers it next time
    if (Array.isArray(db.tagGroups) && !db.tagGroups.some(tg => arr(tg && tg.tags).includes(tag))) {
      const custom = db.tagGroups.find(tg => tg && tg.id === 'custom');
      if (custom && Array.isArray(custom.tags)) { custom.tags.push(tag); added = custom.tags; }
    }
    if (n) {
      // not written to disk (save() showed why): undo the in-memory tags and keep the selection for a retry
      if (!commit(`Tagged ${plural(n, 'trade')} “${tag}”`, 'ok')) {
        undo.forEach(fn => fn());
        if (added) { const i = added.lastIndexOf(tag); if (i >= 0) added.splice(i, 1); }
        refresh();
      }
    } else toast('Those trades already have that tag', 'warn');
  }
  async function bulkClean(gs) {
    const todo = gs.filter(needsReview), skipped = gs.length - todo.length;
    if (!todo.length) { toast('Nothing to mark — select closed trades that still need a review', 'warn'); return; }
    const ok = await confirmDialog({
      title: `Mark ${plural(todo.length, 'trade')} as reviewed?`, confirmText: 'Mark reviewed',
      html: `<b>${plural(todo.length, 'trade')}</b> will be marked <b>clean — no mistakes</b>.
        ${skipped ? `<br>${skipped} selected trade${skipped === 1 ? ' is' : 's are'} open or already reviewed and will be skipped.` : ''}
        <br><br>Only do this if you have looked at them: clean trades are the baseline your mistakes report compares against.`,
    });
    if (!ok) return;
    const now = new Date().toISOString();
    let n = 0;
    const undo = [];
    for (const g of todo) {
      const e = entryById(g.trade.id); if (!e || Metrics.isReviewed(e)) continue;   // reviewed while the dialog was open
      undo.push(keepFields(e, ['mistakes', 'needsReview', 'review', 'updatedAt']));
      // keep whatever the review already holds (lesson, went well…); clear the import / quick-log flag
      updateEntry(e.id, { mistakes: ['none'], needsReview: false, review: { ...(e.review && typeof e.review === 'object' ? e.review : {}), reviewedAt: now } });
      n++;
    }
    // not written to disk (save() showed why): put the trades back in the review queue, keep the selection
    if (n && !commit(`Marked ${plural(n, 'trade')} reviewed (clean)`, 'ok')) { undo.forEach(fn => fn()); refresh(); }
  }
  async function bulk(a) {
    // syncSel() rebuilds the bulk bar, so the clicked button is gone: keep keyboard focus nearby
    if (a === 'none') { const snap = focusSnap(); sel.clear(); syncSel(); refocus(snap, '[data-fid="selall"]'); return; }
    if (a === 'all') { const snap = focusSnap(); if (last) for (const g of last.gs) sel.add(g.trade.id); syncSel(); refocus(snap, '[data-fid="bulk-tag"]'); return; }
    const gs = C.groups.filter(g => sel.has(g.trade.id));
    if (!gs.length) { sel.clear(); syncSel(); return; }
    if (a === 'csv') { exportGroups(gs, []); return; }
    if (a === 'tag') { bulkTag(gs); return; }
    if (a === 'clean') { await bulkClean(gs); return; }
    if (a === 'del') {
      // Selection survives filter changes, so it can include trades the user can no longer see — never
      // delete those (or a large batch) without saying so first.
      const shown = new Set(last ? last.gs.map(g => g.trade.id) : []);
      const hidden = gs.filter(g => !shown.has(g.trade.id)).length;
      if (gs.length >= 20 || hidden) {
        const ok = await confirmDialog({
          title: `Delete ${plural(gs.length, 'trade')}?`, confirmText: 'Move to Trash', danger: true,
          message: `${hidden ? `${hidden} of them ${hidden === 1 ? 'is' : 'are'} hidden by the current filters. ` : ''}They move to Trash — restore them within 30 days in Settings → Trash, or undo right after.`,
        });
        if (!ok) return;
      }
      const ids = gs.map(g => g.trade.id);
      ids.forEach(id => { sel.delete(id); expanded.delete(id); });
      softDelete(ids, `Moved ${plural(ids.length, 'trade')} to Trash`);
    }
  }

  /* ── CSV export ────────────────────────────────────────── */
  // One line per leg (trade + scale rows) plus cash flows; numbers stay numeric (toCSV makes text
  // formula-safe and adds a BOM for Excel). Mistakes and tags are pipe-joined.
  const CSV_HEAD = ['entry_datetime', 'exit_datetime', 'type', 'trade_id', 'leg', 'coin', 'side', 'strategy', 'market', 'venue', 'leverage',
    'entry_price', 'amount', 'stop_loss', 'take_profit', 'exit_price', 'planned_rr', 'gross_pl', 'fees', 'funding', 'gas', 'net_pl', 'leg_net_r',
    'trade_net_r', 'result', 'account_change_pct', 'balance_after', 'duration_min', 'grade', 'discipline', 'rules_met_pct', 'mistakes', 'tags',
    'emotions_before', 'notes', 'thesis', 'lesson', 'flow_amount', 'flow_note'];
  const cn = (v) => (isN(v) ? +v.toPrecision(12) : null);
  const cpct = (v) => (isN(v) ? +(v * 100).toFixed(4) : null);
  // text cells: strings (and finite numbers) only — an odd imported value must not print "[object Object]"
  const txt = (v) => (typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '');
  function legCsv(g, p, i) {
    const t = g.trade, first = i === 0;
    const o = {
      entry_datetime: txt(p.entryAt), exit_datetime: txt(p.exitAt), type: txt(p.type), trade_id: txt(t.id), leg: i + 1,
      coin: txt(g.coin), side: g.side || 'long', strategy: g.strategyId ? stratName(g.strategyId) : '', market: txt(t.market), venue: txt(t.venue), leverage: cn(t.leverage),
      entry_price: cn(p.entryPrice), amount: cn(p.amount), stop_loss: cn(p.stopPrice), take_profit: cn(p.targetPrice), exit_price: cn(p.exitPrice), planned_rr: cn(p.plannedR),
      gross_pl: cn(p.grossPL), fees: cn(p.fees), funding: cn(p.funding), gas: cn(p.gas), net_pl: p.closed ? cn(p.netPL) : null, leg_net_r: p.closed ? cn(p.netR) : null,
      trade_net_r: first ? cn(g.R) : null, result: first ? (!g.closed ? 'open' : g.win ? 'win' : g.loss ? 'loss' : 'be') : '',
      account_change_pct: p.closed ? cpct(p.accountChangePct) : null, balance_after: p.closed ? cn(p.balance) : null, duration_min: isN(p.durationMs) ? +(p.durationMs / 60000).toFixed(1) : null,
      grade: first ? txt(t.grade) : '', discipline: cn(p.discipline), rules_met_pct: first ? cpct(t.rulesMetPct) : null,
      mistakes: first ? (Array.isArray(t.mistakes) ? (t.mistakes.length ? t.mistakes.map(mistakeLabel).join(' | ') : 'not reviewed') : '') : '',
      tags: first ? arr(t.tags).map(txt).join(' | ') : '', emotions_before: first ? labelsOf(t.emoPre, EMOTIONS_PRE).join(' | ') : '',
      notes: txt(p.notes), thesis: first ? txt(t.thesis) : '', lesson: first && t.review && typeof t.review === 'object' ? txt(t.review.lesson) : '',
    };
    return CSV_HEAD.map(h => (o[h] === undefined ? null : o[h]));
  }
  function flowCsv(r) {
    const o = { entry_datetime: txt(r.entryAt), type: txt(r.type), trade_id: txt(r.id), balance_after: cn(r.balance), flow_amount: cn(r.type === 'adjustment' ? r.adjustDelta : r.flowAmount), flow_note: txt(r.flowNote) };
    return CSV_HEAD.map(h => (o[h] === undefined ? null : o[h]));
  }
  function exportGroups(gs, flows, note) {
    const lines = [];
    for (const g of gs) { const k = Date.parse(g.trade.entryAt) || 0; g.portions.forEach((p, i) => lines.push({ k, i, row: legCsv(g, p, i) })); }
    for (const r of flows) lines.push({ k: Date.parse(r.entryAt) || 0, i: 0, row: flowCsv(r) });
    lines.sort((a, b) => a.k - b.k || a.i - b.i);    // chronological; legs stay under their trade
    download(`cryptojournal-${db.mode}-${todayISO()}.csv`, toCSV([CSV_HEAD].concat(lines.map(l => l.row))), 'text/csv;charset=utf-8');
    toast(`Exported ${plural(gs.length, 'trade')}${flows.length ? ` and ${plural(flows.length, 'cash flow')}` : ''}${note ? ' — ' + note : ''}`, 'ok', note ? { ms: 6000 } : undefined);
  }
  function exportCSV() {
    if (!C && typeof recompute === 'function') recompute();
    if (!C) return;
    const res = collect();   // always fresh: may be called from the palette while another page is open
    const flows = res.items.filter(it => it.kind === 'f').map(it => it.r);
    if (!res.gs.length && !flows.length) { toast('Nothing to export — no trades match the filters', 'warn'); return; }
    // the palette's "Export trades to CSV" lands here too: a filter left on from earlier must not pass for a full export
    const note = activeCount() && res.gs.length < C.groups.length ? `filtered to ${res.gs.length} of ${C.groups.length} (${clip(describe(f), 80)})` : '';
    exportGroups(res.gs, flows, note);
  }

  /* ── Popovers: saved views & columns ───────────────────── */
  function closePop(refocusTrigger) {
    if (!pop) return;
    const p = pop; pop = null;
    p.off(); p.el.remove();
    if (p.trigger.isConnected) { p.trigger.setAttribute('aria-expanded', 'false'); if (refocusTrigger) p.trigger.focus({ preventScroll: true }); }
  }
  function openPop(trigger, label, draw, onClick) {
    closePop();
    const el = document.createElement('div');
    el.className = 'lg-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', label);
    host.appendChild(el);   // inside the page section, outside any container-query box (fixed positioning)
    draw(el);
    const r = trigger.getBoundingClientRect(), w = el.offsetWidth, hgt = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    el.style.top = (r.bottom + 6 + hgt > window.innerHeight - 8 ? Math.max(8, r.top - hgt - 6) : r.bottom + 6) + 'px';
    trigger.setAttribute('aria-expanded', 'true');
    el.addEventListener('click', (ev) => onClick(ev, el));
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePop(true); } });
    el.addEventListener('focusout', (ev) => { const to = ev.relatedTarget; if (to && !el.contains(to) && to !== trigger) closePop(); });
    const down = (ev) => { if (!el.contains(ev.target) && !trigger.contains(ev.target)) closePop(); };
    const scroll = (ev) => { if (!(ev.target instanceof Node) || !el.contains(ev.target)) closePop(); };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', scroll, true);
    pop = { el, trigger, off: () => { document.removeEventListener('pointerdown', down, true); window.removeEventListener('scroll', scroll, true); } };
    const first = el.querySelector('button:not([disabled]), input');
    if (first) first.focus({ preventScroll: true });
    return el;
  }
  function applyView(filter, s, name) {
    f = normFilter(filter); searchDirty = false;
    // a saved drill-down (day / session / weekday…) shows the "Filtered from" banner: name the view, not "Analytics"
    source = progOn() && typeof name === 'string' && name.trim() ? `your view “${name.trim().slice(0, 48)}”` : null;
    if (s && own(SORTS, s.key) && (s.dir === 'asc' || s.dir === 'desc')) { sort = { key: s.key, dir: s.dir }; savePrefs(); }
    closePop(true);
    const q = $('#lg-search', host); if (q) q.value = f.q;
    changed();
  }
  function viewsPop(trigger) {
    const draw = (el) => {
      const views = arr(db.views).filter(v => v && v.page === 'trades');
      el.innerHTML = `<div class="lg-pop-h">Saved views</div>
        <div class="lg-vlist">${views.length ? views.map(v => `<div class="lg-vrow"><button type="button" class="lg-vbtn" data-view="${esc(v.id)}"><span>${esc(v.name || 'Untitled view')}</span><small>${esc(describe(normFilter(v.filter)))}</small></button><button type="button" class="lg-ib" data-vdel="${esc(v.id)}" aria-label="${esc('Delete view ' + (v.name || ''))}" title="Delete view"><svg aria-hidden="true"><use href="#i-trash"/></svg></button></div>`).join('')
          : '<p class="lg-pop-empty">No saved views yet. Set up filters, then save them here for one-click reuse.</p>'}</div>
        <div class="lg-pop-h sm">Quick views</div>
        <div class="lg-vlist">${QUICK.map((v, i) => `<div class="lg-vrow"><button type="button" class="lg-vbtn" data-quick="${i}"><span>${esc(v.name)}</span><small>${esc(v.hint)}</small></button></div>`).join('')}</div>
        <div class="lg-pop-f"><button type="button" class="btn btn-primary btn-xs" data-vsave${savable() ? '' : ` disabled title="${f.ids ? 'Picked trades are a one-off list — set a filter or search to save a view' : 'Set at least one filter first'}"`}><svg aria-hidden="true"><use href="#i-plus"/></svg>Save current filters…</button></div>`;
    };
    openPop(trigger, 'Saved views', draw, (ev, el) => {
      const b = ev.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.view) { const v = arr(db.views).find(x => x && String(x.id) === b.dataset.view); if (v) applyView(v.filter, v.sort, v.name || 'Untitled view'); }
      else if (b.dataset.quick != null) { const v = QUICK[+b.dataset.quick]; if (v) applyView(v.filter); }
      else if (b.dataset.vdel) {
        const list = arr(db.views), i = list.findIndex(x => x && String(x.id) === b.dataset.vdel); if (i < 0) return;
        const [gone] = list.splice(i, 1);
        if (!save()) { list.splice(i, 0, gone); return; }   // not written to disk (save() showed why): keep the view
        draw(el);
        const nb = el.querySelector('button:not([disabled])'); if (nb) nb.focus({ preventScroll: true });
        toast(`Deleted view “${gone.name || 'Untitled'}”`, 'ok', { action: { label: 'Undo', run: () => { if (!Array.isArray(db.views)) db.views = []; const at = Math.min(i, db.views.length); db.views.splice(at, 0, gone); if (!save()) db.views.splice(at, 1); } } });
      } else if (b.dataset.vsave != null) {
        closePop(true);   // refocus Views first: the modal hands focus back to whatever had it when it opened
        saveViewModal();
      }
    });
  }
  function saveViewModal() {
    Modal.open({
      title: 'Save this view', width: 440,
      body: `<div class="field"><label for="lg-vname">Name</label><input class="input" id="lg-vname" maxlength="48" autocomplete="off" value="${esc(describe(f).slice(0, 48))}"></div>
        <p class="lg-mhint">Saves the current filters${f.q.trim() ? ' and search' : ''} with the sort order. Find it under <b>Views</b>.</p>`,
      foot: '<button type="button" class="btn btn-ghost" data-x>Cancel</button><button type="button" class="btn btn-primary" data-ok>Save view</button>',
      onMount(el, close) {
        const inp = el.querySelector('#lg-vname');
        const go = () => {
          const name = inp.value.replace(/\s+/g, ' ').trim().slice(0, 48);
          if (!name) { inp.classList.add('invalid'); inp.focus(); return; }
          if (!Array.isArray(db.views)) db.views = [];
          db.views.push({ id: uid('v'), name, page: 'trades', filter: storable(f), sort: { key: sort.key, dir: sort.dir } });
          if (save()) toast(`Saved view “${name}”`, 'ok');
          close();
        };
        el.querySelector('[data-x]').onclick = () => close();
        el.querySelector('[data-ok]').onclick = go;
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        setTimeout(() => { if (inp.isConnected) inp.select(); }, 40);
      },
    });
  }
  function colsPop(trigger) {
    const draw = (el) => {
      const vis = chosenCols();
      const box = (c) => `<label class="check lg-colck"><input type="checkbox" data-col="${c.id}"${vis.has(c.id) ? ' checked' : ''}>${esc(c.full && c.full.length <= 22 ? c.full : c.label)}</label>`;
      el.innerHTML = `<div class="lg-pop-h">Columns</div>
        <div class="lg-pop-sub">Shown by default</div><div class="lg-colgrid">${COLS.filter(c => c.tier === 'default').map(box).join('')}</div>
        <div class="lg-pop-sub">More columns</div><div class="lg-colgrid">${COLS.filter(c => c.tier === 'optional').map(box).join('')}</div>
        <p class="lg-pop-note">Always shown: Date, Coin, Side, Net P/L, R and Status.</p>
        <div class="lg-pop-f"><button type="button" class="btn btn-ghost btn-xs" data-colreset>Reset to default</button></div>`;
    };
    // Hiding the column the table is sorted by drops back to the default order (newest first)
    // (the filter row redraws too: its cash-flow toggle depends on the sort)
    const redraw = () => {
      const sc = COLS.find(c => c.sort && c.sort === sort.key);
      if (sc && !chosenCols().has(sc.id)) { sort = { key: 'date', dir: 'desc' }; savePrefs(); refilter(); }
      else drawBody(true);
    };
    const el = openPop(trigger, 'Choose columns', draw, (ev, box) => {
      if (!ev.target.closest('[data-colreset]')) return;
      S().ledgerCols = null; save();
      draw(box); redraw();
      const b = box.querySelector('[data-colreset]'); if (b) b.focus({ preventScroll: true });
    });
    el.addEventListener('change', (ev) => {
      const t = ev.target; if (!(t instanceof Element) || !t.matches('input[data-col]')) return;
      S().ledgerCols = $$('input[data-col]', el).filter(x => x.checked).map(x => x.dataset.col);
      save(); redraw();
    });
  }

  /* ── Delegated events (bound once per section) ─────────── */
  function toolbar(id, el) {
    if (id === 'new') { tfOrWarn('open', null); return; }
    if (id === 'quick') { tfOrWarn('quick'); return; }
    if (id === 'flow') { tfOrWarn('flow'); return; }
    if (id === 'filters') {
      filtersOpen = !filtersOpen;
      const fl = $('#lg-filters', host); if (fl) fl.classList.toggle('open', filtersOpen);
      el.setAttribute('aria-expanded', String(filtersOpen));
      return;
    }
    if (id === 'views') { if (pop && pop.trigger === el) closePop(); else viewsPop(el); return; }
    if (id === 'cols') { if (pop && pop.trigger === el) closePop(); else colsPop(el); return; }
    if (id === 'csv') { exportCSV(); return; }
    if (id === 'dens') {
      const v = el.dataset.v === 'compact' ? 'compact' : 'comfortable';
      if (S().density === v) return;
      S().density = v; save(); applyTheme(); Router.render();
      refocus('dens-' + v);
    }
  }
  function onClick(ev) {
    const tgt = ev.target;
    if (!(tgt instanceof Element) || tgt.closest('.lg-pop, [data-empty-act], .info-tip')) return;
    const el = tgt.closest('[data-tb],[data-f],[data-unset],[data-clear],[data-sort],[data-exp],[data-act],[data-bulk],[data-more],[data-shot],[data-queue],[data-banner-clear]');
    if (el && host.contains(el)) {
      const ds = el.dataset;
      // second argument of changed(): where focus goes when the clicked control disappears with the redraw
      if (ds.tb != null) toolbar(ds.tb, el);
      else if (ds.f != null) { if (own(f, ds.f) && typeof f[ds.f] === 'string') { f[ds.f] = f[ds.f] === ds.v ? '' : (ds.v || ''); changed(el.classList.contains('lg-mini') ? `[data-fid="fs-${ds.f}"]` : null); } }
      else if (ds.unset != null) { unset(ds.unset); changed(['[data-fid="clear"]', '[data-fid="f-status-"]']); }
      else if (ds.clear != null) clearAll('[data-fid="f-status-"]');
      else if (ds.sort != null) setSort(ds.sort);
      else if (ds.exp != null) toggleExp(ds.exp);
      else if (ds.act != null) rowAction(ds.act, ds);
      else if (ds.bulk != null) bulk(ds.bulk);
      else if (ds.more != null) {
        // keyboard users land on the first newly shown trade (the button may be gone now)
        const prev = limit; limit += PAGE; drawBody(true);
        const nr = $$('tr.lg-row[data-id]', host)[prev];
        if (nr) { nr.tabIndex = 0; nr.focus(); }
      }
      else if (ds.shot != null) openShot(ds.shot, +ds.ix);
      else if (ds.queue != null) { f.status = 'review'; changed('[data-fid="f-status-review"]'); }
      else if (ds.bannerClear != null) { f.ids = null; for (const k of PROG_KEYS) f[k] = ''; source = null; changed('[data-fid="f-status-"]'); }
      return;
    }
    if (tgt.closest('input, select, label, a, button, textarea')) return;
    const tr = tgt.closest('tr.lg-row');
    if (tr && host.contains(tr)) openRow(tr);
  }
  function onChange(ev) {
    const t = ev.target;
    if (!(t instanceof Element) || t.closest('.lg-pop')) return;
    if (t.matches('select[data-fs]')) {
      const k = t.dataset.fs;
      if (!own(f, k) || typeof f[k] !== 'string') return;
      f[k] = t.value;
      if (k === 'range' && t.value !== 'custom') { f.from = null; f.to = null; }
      changed();
    } else if (t.matches('input[data-flows]')) { showFlows = t.checked; savePrefs(); changed(); }
    else if (t.matches('input[data-sel]')) { if (t.checked) sel.add(t.dataset.sel); else sel.delete(t.dataset.sel); syncSel(); }
    else if (t.matches('input[data-selall]')) selectShown(t.checked);
  }
  function onKey(ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    // Esc with focus back on the Views / Columns button still closes its popover (inside it, openPop handles Esc)
    if (ev.key === 'Escape' && pop && pop.trigger === t) { ev.preventDefault(); ev.stopPropagation(); closePop(true); return; }
    if (t.id === 'lg-search' && ev.key === 'Escape' && t.value) { ev.preventDefault(); ev.stopPropagation(); t.value = ''; f.q = ''; searchDirty = false; changed(); return; }
    if (!t.matches('tr.lg-row') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    if (k === 'Enter') { ev.preventDefault(); ev.stopPropagation(); openRow(t); }
    else if (k === ' ' || k === 'Spacebar') { ev.preventDefault(); ev.stopPropagation(); if (t.dataset.id) toggleExp(t.dataset.id); }
    else if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      ev.preventDefault(); ev.stopPropagation();
      const rows = $$('tr.lg-row', host), i = rows.indexOf(t);
      const j = k === 'Home' ? 0 : k === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (k === 'ArrowDown' ? 1 : -1)));
      if (rows[j]) rows[j].focus();
    } else if ((k === 'x' || k === 'X') && t.dataset.id) {
      ev.preventDefault(); ev.stopPropagation();
      const id = t.dataset.id;
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      syncSel();
    }
  }
  function onFocusIn(ev) {
    const tr = ev.target instanceof Element ? ev.target.closest('tr.lg-row') : null;
    if (!tr || !host.contains(tr)) return;
    $$('tr.lg-row[tabindex="0"]', host).forEach(r => { if (r !== tr) r.tabIndex = -1; });
    tr.tabIndex = 0; rovingId = tr.dataset.fid || null;
  }
  function bindOnce(sec) {
    if (bound === sec) return;
    bound = sec;
    sec.addEventListener('click', onClick);
    sec.addEventListener('change', onChange);
    sec.addEventListener('keydown', onKey);
    sec.addEventListener('focusin', onFocusIn);
  }

  /* ── Live prices: refresh open rows in place ───────────── */
  let priceTimer = 0;
  // Design research (motion): a price tick flashes the unrealised P/L cell once (colour wash only — the
  // value keeps its sign); no counting animation. Reduced motion is handled by the global CSS rule.
  function flashTicks(prev) {
    if (!prev || !last || !host) return;
    const before = new Map();
    for (const it of prev.items) if (it.kind === 'g' && it.d.lv && it.d.lv.q) before.set(it.g.trade.id, it.d.lv.tot);
    if (!before.size) return;
    const iPl = visibleCols().findIndex(c => c.id === 'pl'); if (iPl < 0) return;
    for (const it of last.items) {
      if (it.kind !== 'g' || !it.d.lv || !it.d.lv.q || !before.has(it.g.trade.id)) continue;
      const delta = it.d.lv.tot - before.get(it.g.trade.id);
      if (!isN(delta) || Math.abs(delta) < 1e-9) continue;
      let tr = null; try { tr = host.querySelector(`tr.lg-row[data-id="${cssEsc(it.g.trade.id)}"]`); } catch (e) { tr = null; }
      const td = tr && tr.children[iPl];
      if (td) td.classList.add(delta > 0 ? 'flash-up' : 'flash-down');
    }
  }
  // Quotes arrive in bursts (DexScreener + CoinGecko batches, other pages asking for one coin): one table
  // rebuild per burst, not one per emit.
  function onPrices() {
    if (priceTimer) return;   // a redraw (or a retry while covered) is already queued and reads the latest cache
    if (!host || !host.isConnected || Router.active !== 'trades' || !openShown) return;
    priceTimer = setTimeout(drawPrices, 250);
  }
  function drawPrices() {
    priceTimer = 0;
    if (!host || !host.isConnected || Router.active !== 'trades' || !openShown) return;
    // a drawer / modal is open over the ledger: try again once it has closed (see covered())
    if (covered()) { priceTimer = setTimeout(drawPrices, 2000); return; }
    const snap = focusSnap(), prev = last;
    drawBody(true);
    flashTicks(prev);
    refocus(snap);
  }
  Bus.on('prices', onPrices);

  /* ── Public API ────────────────────────────────────────── */
  // Ledger.show({ status, coin, strategyId, side, result, day, from, to, ids, mistake, tag, session, weekday, q,
  //               range?, market?, grade?, venue?, emotion?, hold?, source? })
  function show(filter) {
    const o = filter && typeof filter === 'object' ? filter : {};
    const prev = Pages.get(Router.active);
    f = normFilter(o);
    source = typeof o.source === 'string' && o.source.trim() ? o.source.trim().slice(0, 60)
      : Router.active !== 'trades' && prev && prev.title ? prev.title : null;
    limit = PAGE; sel.clear(); resetScroll = true; searchDirty = false; focusAfterShow = true;
    lastMode = db.mode;   // these filters belong to the current account — render() must not reset them
    if (f.ids && f.ids.length === 1) {   // a single picked trade opens expanded (a leg id → its parent trade)
      const g = C ? groupOfRow(f.ids[0]) : null;
      expanded.add(g ? g.trade.id : f.ids[0]);
    }
    if (f.status || f.result || f.coin || f.strategyId || f.market || f.tag || f.mistake || f.range) filtersOpen = true;
    // already on Trades (palette "find", a drill-down from a drawer): re-filter in place without the cross-fade
    Router.go('trades', { instant: Router.active === 'trades' });
  }
  function focusSearch() {
    if (Router.active !== 'trades') Router.go('trades');
    let tries = 0;
    const tryFocus = () => {
      const q = document.getElementById('lg-search');
      if (q && q.offsetParent !== null) { q.focus(); q.select(); }
      else if (++tries < 8) setTimeout(tryFocus, 40);   // the page may still be cross-fading in
    };
    tryFocus();
  }

  Pages.register('trades', { title: 'Trades', sub, render, onLeave: () => { closePop(); clearTimeout(priceTimer); priceTimer = 0; } });

  return { show, focusSearch, exportCSV, clearFilters: clearAll };
})();
