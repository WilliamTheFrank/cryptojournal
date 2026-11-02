/* ═══════════════════════════════════════════════════════════
   CryptoJournal — Analytics page
   One filter row scopes eight tabs: Overview · Risk & drawdown ·
   Timing · Process · Efficiency · What-if · Paper vs Live · Advanced.
   Every statistic comes from metrics.js; this file shapes it, gates
   it by sample size and explains it in plain language for a beginner.
   Public: Analytics.show(tab, filter)
   ═══════════════════════════════════════════════════════════ */
const Analytics = (() => {
  const LS_KEY = 'cj.an';
  const DAY = 86400000;
  const TABS = [
    { id: 'overview', label: 'Overview' }, { id: 'risk', label: 'Risk & drawdown' }, { id: 'timing', label: 'Timing' },
    { id: 'process', label: 'Process' }, { id: 'efficiency', label: 'Efficiency' }, { id: 'scenarios', label: 'What-if' },
    { id: 'compare', label: 'Paper vs Live' }, { id: 'advanced', label: 'Advanced' },
  ];
  const TAB_ALIAS = { whatif: 'scenarios', 'what-if': 'scenarios', paper: 'compare', live: 'compare', drawdown: 'risk', psychology: 'process', mae: 'efficiency', mistakes: 'process', time: 'timing' };
  const PRESETS = [{ id: 'all', label: 'All' }, { id: 'ytd', label: 'YTD' }, { id: '90d', label: '90d' }, { id: '30d', label: '30d' }, { id: 'week', label: 'Week' }];
  const F_KEYS = ['strategyId', 'coin', 'side', 'market', 'tag', 'mistake', 'grade'];
  const FLAGS = [['noStop', 'No stop set'], ['overRisk', 'Risk above your limit'], ['stopBlown', 'Lost more than 1.2R (stop moved or slipped)'],
    ['noStrategy', 'No strategy chosen'], ['mistakes', 'Mistake tagged'], ['override', 'Guardrail overridden']];
  const BD = [{ id: 'strategy', label: 'Strategy' }, { id: 'coin', label: 'Coin' }, { id: 'side', label: 'Side' }, { id: 'market', label: 'Market' }];
  const blankFilter = () => ({ preset: 'all', from: null, to: null, strategyId: '', coin: '', side: '', market: '', tag: '', mistake: '', grade: '' });
  const blankWhatIf = () => ({ mk: 'keep', mkIds: [], grade: '', cap: false, dropBest: 0, dropWorst: 0, wd: [], sess: [] });

  /* ── Small helpers ─────────────────────────────────────── */
  const R = (g) => (isNum(g.R) ? g.R : null);
  const sumOf = (a) => a.reduce((x, v) => x + v, 0);
  const meanOf = (a) => (a.length ? sumOf(a) / a.length : null);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // Another module's global. A script that threw while loading leaves its const in the temporal dead
  // zone, where even `typeof X` throws — so read it inside try/catch (same pattern as readiness.js).
  const mod = (get) => { try { return get() || null; } catch (e) { return null; } };
  // core's tipFor() reads Glossary (pages/learn.js, loaded later); if that script failed to load the read
  // throws, which would take every tab down with it — fall back to the plain sentence instead.
  const tipSafe = (key, fallback) => { try { return tipFor(key, fallback); } catch (e) { return infoTip(fallback || ''); } };
  const goPage = (id, label) => { if (Pages.has(id)) Router.go(id); else toast(`The ${label} page is not available right now`, 'warn'); };
  const fixed = (v, dp) => (isNum(v) ? (v < 0 ? MINUS : '') + Math.abs(v).toFixed(dp == null ? 2 : dp) : '—');
  const P0 = (v) => { if (!isNum(v)) return '—'; const r = Math.round(v * 100); return (r < 0 ? MINUS : '') + Math.abs(r) + '%'; };
  const P1 = (v) => fmtPct(v, { dp: 1 });
  const X2 = (v) => (isNum(v) ? fixed(v, 2) + '×' : '—');
  const R1 = (v) => (isNum(v) ? fixed(v, 2) + 'R' : '—');            // unsigned-style R amount (sizes, costs, spreads)
  const pfTxt = (pf) => (pf == null ? '—' : pf === Infinity ? 'n/a' : fixed(pf, 2));
  const daysOf = (ms) => (isNum(ms) ? Math.round(ms / DAY) : null);
  const daysTxt = (ms) => { const d = daysOf(ms); return !ms || d == null ? '—' : d < 1 ? 'under a day' : plural(d, 'day'); };
  const holdTxt = (ms) => (isNum(ms) ? fmtDuration(ms) : '—');
  const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pTxt = (p) => (!isNum(p) ? '—' : p < 0.001 ? '&lt; 0.001' : p.toFixed(p < 0.1 ? 3 : 2));   // HTML
  const pctWords = (p) => (p < 0.01 ? 'less than 1% of the time' : `about ${Math.round(p * 100)}% of the time`);
  // $ text for canvas tooltips/labels — canvases cannot be blurred, so privacy mode masks them
  const moneyTxt = (v, o) => (View.privacy ? '•••' : fmtMoney(v, { sign: true, ...(o || {}) }));
  const tk = () => Charts.tokens();
  const tzLabel = () => { const m = -new Date().getTimezoneOffset(), h = Math.floor(Math.abs(m) / 60), mm = Math.abs(m) % 60; return 'UTC' + (m < 0 ? MINUS : '+') + h + (mm ? ':' + String(mm).padStart(2, '0') : ''); };
  const stratLabel = (id) => (id === '__none__' ? 'No strategy' : stratName(id));
  const marketLabel = (id) => { const m = MARKETS.find(x => x.id === id); return m ? m.label : id; };
  const emoLabel = (id) => { const e = EMOTIONS_PRE.find(x => x.id === id); return e ? e.label : id; };
  const costRof = (list) => meanOf(list.filter(g => isNum(g.risk) && g.risk > 0).map(g => (g.costs || 0) / g.risk));
  // memo-scoped cache for heavier per-tab computations (cleared whenever C or the filter changes)
  const cached = (v, k, f) => (has(v.extra, k) ? v.extra[k] : (v.extra[k] = f()));

  /* ── Unit view ($ / % / R) ─────────────────────────────── */
  const units = () => (S().units === 'R' || S().units === '%' ? S().units : '$');
  const unitVal = (o) => (units() === 'R' ? o.R : units() === '%' ? o.changePct : o.netPL);
  const unitWord = () => (units() === 'R' ? 'Total R' : units() === '%' ? 'Return' : 'Net P/L');
  // Result of a set of groups: R = sum of net R; % = compounded account change (flow-neutral)
  // No trade with a % change (account without a starting balance) → null ('—'), never a fake "0%"
  function totalObj(list) {
    let idx = 1, pctN = 0; for (const g of list) if (isNum(g.changePct)) { idx *= 1 + g.changePct; pctN++; }
    const rs = list.map(R).filter(isNum);
    return { netPL: sumOf(list.map(g => g.netPL || 0)), changePct: pctN ? idx - 1 : null, R: rs.length ? sumOf(rs) : null };
  }
  const avgObj = (list) => ({ netPL: meanOf(list.map(g => g.netPL)), changePct: meanOf(list.map(g => g.changePct).filter(isNum)), R: meanOf(list.map(R).filter(isNum)) });
  function unitHtml(o, opts) { const t = fmtUnit(o, opts); return units() === '$' ? `<span class="money">${t}</span>` : t; }
  // Headline P/L: sign + colour + ▲/▼ glyph (colour is never the only cue)
  function plHtml(o, withGlyph) { const v = unitVal(o); return `<span class="${plClass(v)}">${withGlyph && glyph(v) ? glyph(v) + ' ' : ''}${unitHtml(o)}</span>`; }
  // A raw value that is already in the current unit
  function fmtU(v) { const u = units(); return u === 'R' ? fmtR(v) : u === '%' ? fmtPct(v, { sign: true, dp: 2 }) : `<span class="money">${fmtMoney(v, { sign: true })}</span>`; }
  const fmtUTxt = (v) => { const u = units(); return u === 'R' ? fmtR(v) : u === '%' ? fmtPct(v, { sign: true, dp: 2 }) : moneyTxt(v); };
  const axisU = (v) => { const u = units(); return u === 'R' ? fmtR(v, 1) : u === '%' ? fmtPct(v, { sign: true, dp: 0 }) : View.axisMoney(v); };

  /* ── Markup helpers ────────────────────────────────────── */
  const box = (name, cls) => `<div class="chart-box ${cls || ''}"><canvas data-cv="${name}"></canvas><div class="chart-tip"></div></div>`;
  function cvOf(el, name) { const cv = el.querySelector(`canvas[data-cv="${name}"]`); return { cv, tip: cv ? cv.parentElement.querySelector('.chart-tip') : null }; }
  const gate = (ttl, text) => `<div class="an-gate"><svg aria-hidden="true"><use href="#i-lock"/></svg><div><b>${esc(ttl)}</b><span>${esc(text)}</span></div></div>`;
  const note = (html) => `<div class="an-note">${html}</div>`;
  const title = (icon, text, tip, aside) => `<div class="card-title"><svg aria-hidden="true"><use href="#i-${icon}"/></svg>${esc(text)}${tip || ''}${aside ? `<span class="aside">${aside}</span>` : ''}</div>`;
  function kpi(o) {
    return `<div class="kpi ${o.cls || ''} ${o.gated ? 'gated' : ''}"><div class="k-lbl">${esc(o.lbl)}${o.tip || ''}</div>
      <div class="k-val ${o.vcls || ''}">${o.val}</div>${o.extra || ''}${o.sub ? `<div class="k-sub">${o.sub}</div>` : ''}</div>`;
  }
  function row(label, value, o) {
    o = o || {};
    return `<div class="stat-row ${o.gated ? 'gated' : ''}"><span class="sl">${esc(label)}${o.tip || ''}</span><span class="sv ${o.cls || ''}">${value}${o.small ? `<small>${o.small}</small>` : ''}</span></div>`;
  }
  // items: { label, color, dash? } lines, or { band:true } for a shaded range (same ~20% wash Charts.multi draws)
  const legend = (items) => `<div class="legend an-legend">${items.map(i => (i.band
    ? `<span><i class="an-band" style="background:${Charts.alpha(i.color, 0.22)}"></i>${esc(i.label)}</span>`
    : `<span><i class="ln ${i.dash ? 'dash' : ''}" style="background:${i.color};color:${i.color}"></i>${esc(i.label)}</span>`)).join('')}</div>`;
  const tile = (lbl, val, sub, cls) => `<div class="an-tile"><div class="an-tile-l">${esc(lbl)}</div><div class="an-tile-v ${cls || ''}">${val}</div>${sub ? `<div class="an-tile-s">${esc(sub)}</div>` : ''}</div>`;
  const readingsHtml = (lines) => `<div class="readings">${lines.map(t => `<div class="reading">${t}</div>`).join('')}</div>`;
  // Per-bucket minimum (contract §1.6: 10 trades): buckets below it are grey and tagged; under 3 is "n too small"
  const thinTag = (n) => (n && n < 3 ? ' · n too small' : n && n < 10 ? ' · needs 10+' : '');
  // Charts.hbars has no per-row colour: grey the bar and dim the value of rows under 10 trades after it draws
  function dimThinHbars(el, rows) {
    if (!el) return;
    const grey = Charts.alpha(tk().flat, 0.55);
    el.querySelectorAll('.hb-row').forEach((rEl, i) => {
      if (!rows[i] || !(rows[i].n < 10)) return;
      const bar = rEl.querySelector('.hb-bar'); if (bar) bar.style.background = grey;
      const val = rEl.querySelector('.hb-v'); if (val) { val.classList.remove('pos', 'neg'); val.classList.add('dim'); }
    });
  }
  // seg()/chips() redraw their buttons on click; put focus back on the same option for keyboard users
  function keepFocus(el) {
    if (!el) return;
    el.addEventListener('click', (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest('button[data-id]') : null; if (!b) return;
      const nb = [...el.querySelectorAll('button[data-id]')].find(x => x.dataset.id === b.dataset.id);
      if (nb && el.isConnected && nb !== document.activeElement) nb.focus({ preventScroll: true });
    });
  }
  function segK(el, options, value, onChange) { if (!el) return; seg(el, options, value, onChange); keepFocus(el); }
  function chipsK(el, options, selected, onChange) { if (!el) return; chips(el, options, selected, { multi: true, onChange }); keepFocus(el); }

  /* ── State (module vars, mirrored to localStorage 'cj.an') ── */
  const st = { tab: 'overview', f: blankFilter(), eq: 'pl', utc: false, bd: 'strategy', mcRisk: null, mcStress: true, wi: blankWhatIf() };
  function parseDay(v, end) {
    if (isNum(v)) return v;
    if (typeof v !== 'string' || !v) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) { const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime(); return end ? t + DAY - 1 : t; }
    const t = Date.parse(v); return isFinite(t) ? t : null;
  }
  // Accepts the analytics filter plus Ledger-style keys ({day, from, to} as ms or 'YYYY-MM-DD', range)
  function normFilter(o) {
    const f = blankFilter(); o = o || {};
    // values are kept exactly as stored: Metrics.filterGroups compares them exactly, so upper-casing a
    // legacy / imported lower-case coin here would make a saved filter match nothing after a reload
    for (const k of F_KEYS) if (typeof o[k] === 'string') f[k] = o[k];
    const pre = typeof o.preset === 'string' ? o.preset : typeof o.range === 'string' ? o.range : '';
    if (PRESETS.some(p => p.id === pre)) f.preset = pre;
    let from = parseDay(o.from, false), to = parseDay(o.to, true);
    if (typeof o.day === 'string') { from = parseDay(o.day, false); to = parseDay(o.day, true); }
    if ((from != null || to != null) && (pre === 'custom' || !pre || o.day)) { f.preset = 'custom'; f.from = from; f.to = to; }
    return f;
  }
  function normWhatIf(o) {
    const w = blankWhatIf(); if (!o || typeof o !== 'object') return w;
    if (['keep', 'all', 'pick'].includes(o.mk)) w.mk = o.mk;
    if (Array.isArray(o.mkIds)) w.mkIds = o.mkIds.filter(x => typeof x === 'string');
    if (o.grade === 'A' || o.grade === 'B') w.grade = o.grade;
    w.cap = !!o.cap;
    w.dropBest = isNum(o.dropBest) ? clampN(Math.round(o.dropBest), 0, 50) : 0;
    w.dropWorst = isNum(o.dropWorst) ? clampN(Math.round(o.dropWorst), 0, 50) : 0;
    if (Array.isArray(o.wd)) w.wd = o.wd.filter(x => typeof x === 'string');
    if (Array.isArray(o.sess)) w.sess = o.sess.filter(x => typeof x === 'string');
    return w;
  }
  (() => {
    try {
      const o = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (!o || typeof o !== 'object') return;
      if (TABS.some(t => t.id === o.tab)) st.tab = o.tab;
      if (o.f && typeof o.f === 'object') st.f = normFilter(o.f.preset === 'custom' ? o.f : { ...o.f, from: null, to: null });
      if (['pl', 'pct', 'r'].includes(o.eq)) st.eq = o.eq;
      st.utc = !!o.utc;
      if (BD.some(b => b.id === o.bd)) st.bd = o.bd;
      if (isNum(o.mcRisk) && o.mcRisk > 0) st.mcRisk = clampN(o.mcRisk, 0.05, 10);
      if (typeof o.mcStress === 'boolean') st.mcStress = o.mcStress;
      st.wi = normWhatIf(o.wi);
    } catch (e) { /* private window / blocked storage — defaults are fine */ }
  })();
  function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) { /* per-viewer convenience only */ } }

  /* ── Filtered view (memoised per C + filter: resize re-renders stay cheap) ── */
  function range() { return st.f.preset === 'custom' ? { from: st.f.from, to: st.f.to } : Metrics.rangeFor(st.f.preset); }
  function filterObj() { const r = range(), o = { from: r.from, to: r.to }; for (const k of F_KEYS) if (st.f[k]) o[k] = st.f[k]; return o; }
  const extraFilters = () => F_KEYS.filter(k => st.f[k]).length;
  let memo = null;
  function view() {
    // rolling presets (30d, week…) move with the clock: re-slice at most every 10 minutes
    const tick = st.f.preset === 'all' || st.f.preset === 'custom' ? '' : Math.floor(Date.now() / 600000);
    // risk rules / costs / ramp feed metricsCtx (flags, haircut, ramp) — a settings edit must invalidate too
    const key = JSON.stringify(st.f) + '|' + Metrics.config.sessionScheme + '|' + tick + '|' + JSON.stringify([S().risk, S().costs, S().ramp]);
    if (memo && memo.c === C && memo.key === key) return memo;
    const ctx = metricsCtx(C);
    const gs = Metrics.filterGroups(C.groups, filterObj());
    // Drawdown %, Sharpe, the % index… divide by the balance before each trade. With no starting balance,
    // deposit or set-balance row (the live account starts at $0) they are meaningless — core's
    // balanceMeasurable(), the same rule as Readiness and the Dashboard.
    memo = { c: C, key, gs, ctx, s: Metrics.summary(gs, ctx), extra: {}, pctOk: balanceMeasurable(C) };
    return memo;
  }

  /* ── Drill-down into the ledger ────────────────────────── */
  let drills = [];
  const drill = (f) => { drills.push(f); return drills.length - 1; };
  function dateRange() {
    if (st.f.preset === 'all') return {};
    const r = range(), o = {};
    if (r.from != null) o.from = r.from;
    if (r.to != null) o.to = r.to;
    return o;
  }
  // A semantic Ledger filter while only the date scopes the view; otherwise the exact trade ids
  function drillFor(semantic, groups) { return extraFilters() || !semantic ? { ids: groups.map(g => g.trade.id) } : { ...semantic, ...dateRange() }; }
  function toLedger(f) { const L = mod(() => Ledger); if (L && L.show) L.show({ source: 'Analytics', ...f }); else toast('The trade list is not available right now', 'warn'); }
  function openTrade(id) { const TF = mod(() => TradeForm); if (TF && TF.view) TF.view(id); else toLedger({ ids: [id] }); }
  function bindDrills(el) {
    el.querySelectorAll('[data-drill]').forEach(b => { b.onclick = (ev) => { ev.stopPropagation(); const f = drills[+b.dataset.drill]; if (f) toLedger(f); }; });
    el.querySelectorAll('tr[data-rowdrill]').forEach(tr => { tr.onclick = () => { const f = drills[+tr.dataset.rowdrill]; if (f) toLedger(f); }; });
    el.querySelectorAll('[data-learn]').forEach(b => { b.onclick = () => { const Ln = mod(() => Learn); if (Ln && Ln.show) Ln.show('metrics', b.dataset.learn); else goPage('patterns', 'Learn'); }; });
  }
  const reviewBtn = (label) => `<button type="button" class="link-btn" data-drill="${drill({ status: 'review' })}">${esc(label || 'Open the review queue')}</button>`;
  // When the account has no balance to measure against, every drawdown/return % is noise
  const noBalanceBanner = () => `<div class="banner" role="note"><svg aria-hidden="true"><use href="#i-alert"/></svg><div class="grow"><b>Drawdown % needs a starting balance.</b> This ${esc(db.mode)} account has no starting balance or deposit, so percentages of the account cannot be measured. Dollar and R results are still correct.</div><button type="button" class="btn btn-ghost btn-sm" data-act="acct-settings">Set it in Settings</button></div>`;
  function bindBalanceBtn(el) { const b = el.querySelector('[data-act="acct-settings"]'); if (b) b.onclick = () => { const St = mod(() => Settings); if (St && St.show) St.show('account'); else goPage('settings', 'Settings'); }; }
  // Screen-reader route to the same trades the bars show (doubles as the n under each label);
  // Charts.bars itself handles click, and Enter on the arrow-key-focused bar, via opts.onClick
  function bucketChips(items) {
    const list = items.filter(i => i.n && i.drill >= 0);
    return list.length ? `<div class="an-buckets" role="group" aria-label="Open the trades behind a bar">${list.map(i => `<button type="button" class="an-bk ${i.n < 3 ? 'thin' : ''}" data-drill="${i.drill}" aria-label="${esc(`${i.label}: ${plural(i.n, 'trade')} — show in the trade list`)}">${esc(i.label)} <span>${i.n}</span></button>`).join('')}</div>` : '';
  }

  /* ── Page shell: filter row + tabs + panel ─────────────── */
  let root = null;
  function filterOptions() {
    const gs = C.groups, uniq = (a) => [...new Set(a.filter(Boolean))];
    const usedStrat = uniq(gs.map(g => g.strategyId));
    const strategies = db.strategies.filter(s => !s.archived || usedStrat.includes(s.id)).map(s => [s.id, s.name]);
    for (const id of usedStrat) if (!strategies.some(p => p[0] === id)) strategies.push([id, stratName(id)]);
    const coins = uniq(gs.map(g => g.coin)).sort().map(c => [c, c]);
    const tags = uniq([...db.tagGroups.flatMap(t => t.tags), ...gs.flatMap(g => g.trade.tags || [])]).map(t => [t, t]);
    // retired (hidden) mistakes only while a trade still carries them — same rule as the pickers
    const mk = db.mistakes.filter(m => !m.hidden).map(m => [m.id, m.label]);
    for (const id of uniq(gs.flatMap(g => Metrics.realMistakes(g.trade)))) if (!mk.some(p => p[0] === id)) mk.push([id, mistakeLabel(id)]);
    return {
      strategyId: ['Strategy', strategies], coin: ['Coin', coins], side: ['Side', [['long', 'Long'], ['short', 'Short']]],
      market: ['Market', MARKETS.map(m => [m.id, m.label])], tag: ['Tag', tags],
      // '__clean__' (Metrics.filterGroups) = no mistake tagged, which includes trades not reviewed yet
      mistake: ['Mistake', [['__clean__', 'Clean trades (no mistake tagged)'], ...mk]], grade: ['Grade', [['A', 'A'], ['B', 'B'], ['C', 'C']]],
    };
  }
  function headerHtml(v) {
    const opts = filterOptions();
    const sel = (key) => {
      const [label, pairs] = opts[key], cur = st.f[key];
      if (cur && !pairs.some(p => p[0] === cur)) pairs.push([cur, key === 'mistake' ? mistakeLabel(cur) : key === 'strategyId' ? stratName(cur) : cur]);
      if (!pairs.length && !cur) return '';
      return `<select class="input an-sel ${cur ? 'on' : ''}" data-f="${key}" aria-label="${esc(label)} filter">
        <option value="">${esc(label)}: all</option>${pairs.map(([a, b]) => `<option value="${esc(a)}" ${a === cur ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
    };
    const custom = st.f.preset === 'custom'
      ? `<span class="chip sm on an-custom">${esc(st.f.from != null ? fmtDate(st.f.from) : 'Start')} – ${esc(st.f.to != null ? fmtDate(st.f.to) : 'now')}<button type="button" class="x" data-act="nocustom" aria-label="Remove custom date range"><svg width="11" height="11"><use href="#i-x"/></svg></button></span>` : '';
    const n = v.gs.length, any = extraFilters() || st.f.preset !== 'all';
    return `<div class="filterbar an-filter" role="group" aria-label="Analytics filters">
      <div class="seg sm inline" data-seg="preset" role="group" aria-label="Date range"></div>${custom}
      ${F_KEYS.map(sel).join('')}
      ${any ? '<button type="button" class="btn btn-quiet btn-xs" data-act="clear">Clear filters</button>' : ''}
      <span class="an-meta"><span class="count">${plural(n, 'closed trade')} in view</span>${confBadge(n)}</span>
      <span class="sr-only" role="status" data-el="an-live"></span></div>`;
  }
  function render(el) {
    root = el; drills = [];
    if (!C || !mod(() => Metrics) || !mod(() => Charts)) { el.innerHTML = ''; return; }
    const v = view();
    el.innerHTML = `<div class="an">${headerHtml(v)}
      <div class="tabs an-tabs" role="tablist" aria-label="Analytics sections">${TABS.map(t => `<button type="button" role="tab" id="an-tab-${t.id}" aria-controls="an-panel" aria-selected="${t.id === st.tab}" tabindex="${t.id === st.tab ? 0 : -1}" class="${t.id === st.tab ? 'on' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div>
      <div class="an-panel" id="an-panel" role="tabpanel" tabindex="-1" aria-labelledby="an-tab-${st.tab}"></div></div>`;
    bindHeader(el);
    bindTabs(el);
    drawTab();
  }
  // Re-render after a filter change, keeping keyboard focus on the control the user just used
  function changed(focusSel) {
    persist(); render(root);
    if (focusSel) { const f = root.querySelector(focusSel); if (f) f.focus({ preventScroll: true }); }
    // the whole header is rebuilt, so a live region inside it is new every time and never announced —
    // fill this (empty) status region only once it is in the DOM so "n trades in view" is read out
    const live = root.querySelector('[data-el="an-live"]'), cnt = root.querySelector('.an-meta .count');
    if (live && cnt) { const t = cnt.textContent; setTimeout(() => { if (live.isConnected) live.textContent = t; }, 120); }
  }
  function redrawTab(focusSel) {
    drawTab();
    if (focusSel && root) { const f = root.querySelector(focusSel); if (f) f.focus({ preventScroll: true }); }
  }
  function bindHeader(el) {
    const pe = el.querySelector('[data-seg="preset"]');
    if (pe) seg(pe, PRESETS, st.f.preset, (id) => { st.f.preset = id; st.f.from = st.f.to = null; changed(`[data-seg="preset"] button[data-id="${id}"]`); });
    el.querySelectorAll('select[data-f]').forEach(s => { s.onchange = () => { st.f[s.dataset.f] = s.value; changed(`select[data-f="${s.dataset.f}"]`); }; });
    const clr = el.querySelector('[data-act="clear"]');
    if (clr) clr.onclick = () => { st.f = blankFilter(); changed('[data-seg="preset"] button[data-id="all"]'); };
    const nc = el.querySelector('[data-act="nocustom"]');
    if (nc) nc.onclick = () => { st.f.preset = 'all'; st.f.from = st.f.to = null; changed('[data-seg="preset"] button[data-id="all"]'); };
  }
  function bindTabs(el) {
    const btns = [...el.querySelectorAll('[role="tab"]')];
    btns.forEach((b, i) => {
      b.onclick = () => selectTab(b.dataset.tab, false);
      b.onkeydown = (ev) => {
        const k = ev.key, j = k === 'ArrowRight' ? (i + 1) % btns.length : k === 'ArrowLeft' ? (i - 1 + btns.length) % btns.length : k === 'Home' ? 0 : k === 'End' ? btns.length - 1 : null;
        if (j == null) return;
        ev.preventDefault(); selectTab(btns[j].dataset.tab, true);
      };
    });
  }
  function selectTab(id, focus) {
    if (!TABS.some(t => t.id === id) || !root) return;
    st.tab = id; persist();
    root.querySelectorAll('[role="tab"]').forEach(b => {
      const on = b.dataset.tab === id;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus({ preventScroll: true });
    });
    const p = root.querySelector('.an-panel'); if (p) p.setAttribute('aria-labelledby', 'an-tab-' + id);
    drawTab();
  }
  function drawTab() {
    const body = root && root.querySelector('.an-panel'); if (!body) return;
    drills = []; mcToken++;
    const v = view();
    if (st.tab !== 'compare' && !C.closedGroups.length) { emptyAll(body); return; }
    if (st.tab !== 'compare' && !v.gs.length) {
      body.innerHTML = `<div class="card">${emptyHtml('No trades match these filters', `Your ${db.mode} account has ${plural(C.closedGroups.length, 'closed trade')}, but none fit the current filter.`, [{ id: 'clear', label: 'Clear filters', primary: true }])}</div>`;
      bindEmpty(body, { clear: () => { st.f = blankFilter(); changed('[data-seg="preset"] button[data-id="all"]'); } });
      return;
    }
    try { TAB_FN[st.tab](body, v); bindDrills(body); }
    catch (err) {
      console.error('[analytics:' + st.tab + ']', err);
      body.innerHTML = `<div class="card"><div class="card-title">This section hit an error</div><div class="muted">${esc(err && err.message)}</div></div>`;
    }
  }
  function emptyAll(body) {
    const open = C.openRows.length, acts = [{ id: 'new', label: db.mode === 'live' ? 'Log a trade' : 'Log a paper trade', icon: 'plus', primary: true }];
    if (db.mode !== 'demo') acts.push({ id: 'demo', label: 'Explore with demo data' });
    body.innerHTML = `<div class="card">${emptyHtml(open ? 'No closed trades yet' : 'Nothing to analyse yet',
      open ? `You have ${plural(open, 'open position')}. Analytics fill in as soon as a trade closes.` : 'Log and close a few trades — always with a stop — and this page turns them into plain-language statistics: your edge, drawdowns, best times and costliest habits.', acts)}</div>`;
    bindEmpty(body, {
      new: () => { const TF = mod(() => TradeForm); if (TF && TF.open) TF.open(null); else toast('The trade form is not available right now', 'warn'); },
      demo: () => { const A = mod(() => App); if (A && A.switchMode) A.switchMode('demo'); else toast('Demo mode is not available right now', 'warn'); },
    });
  }

  /* ── Plain-language pieces shared by several tabs ───────── */
  // Expectancy verdict from the 95% CI — never "probability the edge is random".
  // "Consistent with no edge" is always safe to say; a firm verdict waits for 30 trades (contract: CI ≥ 30).
  function edgeWords(s) {
    if (!s.ci95 || s.rN < 20) return null;
    const firm = s.rN >= 30;
    if (s.ci95.lo > 0) return firm ? { cls: 'pos', txt: '✓ likely a real edge' } : { cls: 'warn-c', txt: 'promising — confirm at 30+ trades' };
    if (s.ci95.hi < 0) return firm ? { cls: 'neg', txt: '✕ losing beyond bad luck' } : { cls: 'neg', txt: '▼ negative so far' };
    return { cls: 'warn-c', txt: s.edgeVerdict === 'suggestive' ? 'leaning positive, but consistent with no edge' : 'consistent with no edge' };
  }
  const ciTxt = (ci) => (ci ? `likely ${fmtR(ci.lo)} to ${fmtR(ci.hi)}` : '');
  const EDGE_TXT = { green: ['✓', 'above breakeven even at the low end'], amber: ['≈', 'straddles breakeven — not proven'], red: ['✕', 'below the breakeven win rate'] };
  // Wilson interval as a range bar, with a tick at the breakeven win rate
  function winBar(s) {
    if (!s.winCI || !isNum(s.winRate)) return '';
    const pc = (x) => (clampN(x, 0, 1) * 100).toFixed(1) + '%';
    const be = s.beWinRate;
    return `<div class="an-wbar ${s.winEdge ? 'an-edge-' + s.winEdge : ''}" role="img" aria-label="${esc(`Win rate ${P0(s.winRate)}; likely between ${P0(s.winCI.lo)} and ${P0(s.winCI.hi)}${isNum(be) ? `; breakeven ${P0(be)}` : ''}`)}">
      <div class="an-wbar-trk"><span class="an-wbar-ci" style="left:${pc(s.winCI.lo)};width:${pc(s.winCI.hi - s.winCI.lo)}"></span>
        <span class="an-wbar-pt" style="left:${pc(s.winRate)}"></span>${isNum(be) ? `<span class="an-wbar-be" style="left:${pc(be)}"></span>` : ''}</div>
      <div class="an-wbar-lbl"><span>${P0(s.winCI.lo)}–${P0(s.winCI.hi)}</span>${isNum(be) ? `<span>breakeven ${P0(be)}</span>` : ''}</div></div>`;
  }
  // Two or more magnitudes on ONE scale (e.g. avg win vs avg loss)
  function cmpBars(items) {
    const mx = Math.max(1e-9, ...items.map(i => Math.abs(isNum(i.v) ? i.v : 0)));
    return `<div class="an-cmp">${items.map(i => `<div class="an-cmp-row"><span class="an-cmp-l">${esc(i.label)}</span>
      <span class="an-cmp-trk"><span class="an-cmp-bar ${i.cls || ''}" style="width:${((isNum(i.v) ? Math.abs(i.v) : 0) / mx * 100).toFixed(1)}%"></span></span>
      <span class="an-cmp-v ${plClass(i.v)}">${i.html}</span></div>`).join('')}</div>`;
  }

  /* ── Breakdown tables (strategy / coin / side / market) ── */
  const BD_FN = {
    strategy: { head: 'Strategy', key: (g) => g.strategyId || '__none__', name: stratLabel, sem: (k) => (k === '__none__' ? null : { strategyId: k }) },
    coin: { head: 'Coin', key: (g) => g.coin || null, name: (k) => k, sem: (k) => ({ coin: k }) },
    side: { head: 'Side', key: (g) => (g.side === 'short' ? 'short' : 'long'), name: (k) => (k === 'short' ? 'Short' : 'Long'), sem: (k) => ({ side: k }) },
    market: { head: 'Market', key: (g) => g.trade.market || 'spot', name: marketLabel, sem: (k) => ({ market: k }) },
  };
  function bdTableHtml(gs, by) {
    const d = BD_FN[by] || BD_FN.strategy;
    const rows = Metrics.groupBy(gs, d.key);
    if (!rows.length) return '<div class="an-empty">No trades in this view.</div>';
    return `<div class="table-wrap bare"><table class="compact-t an-table"><thead><tr>
      <th scope="col">${esc(d.head)}</th><th scope="col" class="num">Trades</th><th scope="col" class="num">Win %</th><th scope="col" class="num">Exp. R</th><th scope="col" class="num">${esc(unitWord())}</th><th scope="col" class="num">PF</th></tr></thead><tbody>
      ${rows.map(r => {
        const sem = d.sem(r.key), i = drill(drillFor(sem ? { ...sem, status: 'closed' } : null, r.groups)), thin = r.n < 10;
        return `<tr class="clickable ${thin ? 'an-thin' : ''}" data-rowdrill="${i}"${thin ? ' title="Fewer than 10 trades — too few to read"' : ''}>
          <td><button type="button" class="an-rowbtn" data-drill="${i}">${esc(d.name(r.key))}</button></td>
          <td class="num">${confBadge(r.n)}</td><td class="num">${P0(r.winRate)}</td>
          <td class="num ${plClass(r.expR)}">${fmtR(r.expR)}</td>
          <td class="num">${plHtml(totalObj(r.groups))}</td><td class="num">${pfTxt(r.pf)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  /* ═══ Overview ═════════════════════════════════════════ */
  function tabOverview(body, v) {
    const { gs, s } = v, T = tk();
    const wins = gs.filter(g => g.win), losses = gs.filter(g => g.loss);
    const aw = unitVal(avgObj(wins)), al = unitVal(avgObj(losses));
    const pay = isNum(s.payoffR) ? s.payoffR : s.payoff;
    const pf = s.profitFactor, ew = edgeWords(s), early = s.n < 20, expEarly = s.rN < 20;
    const edge = s.winEdge ? EDGE_TXT[s.winEdge] : null;
    const rs = gs.map(R).filter(isNum);
    const rd = Metrics.readings(s);
    const READ = [['expR', 'Expectancy'], ['winRate', 'Win rate'], ['payoff', 'Payoff'], ['pf', 'Profit factor'], ['dd', 'Drawdown'], ['streak', 'Streaks'], ['sqn', 'System quality'], ['adh', 'Discipline']];
    // Below their minimums (contract §1.6) a reading is tagged early instead of read as signal; the
    // "normal losing streak" needs a handful of trades or it can come out as "about 0"
    const earlyTag = { winRate: early ? 'needs 20+ trades' : '', payoff: early ? 'needs 20+ trades' : '',
      pf: !s.pfReliable && pf !== Infinity ? 'needs 20 trades &amp; 5 losses' : '' };
    const reads = READ.filter(([k]) => rd[k] && (k !== 'dd' || v.pctOk) && (k !== 'streak' || (s.n >= 10 && s.expLongestLossRun >= 1)))
      .map(([k, l]) => `<b>${esc(l)}.</b> ${esc(rd[k])}${earlyTag[k] ? ` <span class="dim">(early — ${earlyTag[k]})</span>` : ''}`);
    const planned = meanOf(gs.map(g => g.plannedR).filter(isNum));
    // $ at the stop ÷ balance before the trade (all legs) — the habit that decides survival
    const riskPcts = v.pctOk ? gs.map(g => (isNum(g.risk) && g.trade.prevBalance > 0 ? g.risk / g.trade.prevBalance : null)).filter(isNum) : [];
    const avgRiskPct = meanOf(riskPcts), riskCap = effectiveMaxRisk() / 100;
    const overCap = riskPcts.filter(p => p > riskCap * 1.1).length;
    const selfDisc = meanOf(gs.map(g => g.avgDiscipline).filter(isNum));
    // Normal swing of a 20-trade average around the whole-view expectancy (±1 standard error of a 20-trade
    // mean): a rolling line inside the band is ordinary noise, not a change in edge
    const swing = isNum(s.expR) && isNum(s.sdR) && s.rN >= 20 ? s.sdR / Math.sqrt(20) : null;
    // A CI range is quoted only from 30 trades with a stop (contract §1.6: CI ≥ 30); at 20–29 the average
    // stands alone with "confirm at 30+ trades" (skipped when the edge words already say it)
    const ewHtml = ew ? `<span class="${ew.cls}">${ew.txt}</span>` : '';
    const expSub = s.rN >= 30 ? [ciTxt(s.ci95), ewHtml].filter(Boolean).join(' · ')
      : [`avg of ${plural(s.rN, 'trade')} with a stop`, ew && ew.txt.includes('30+') ? '' : 'confirm at 30+ trades', ewHtml].filter(Boolean).join(' · ');
    body.innerHTML = `
      <div class="kpis an-kpis">
        ${kpi({ lbl: 'Net P/L', tip: tipSafe('netPL', 'Profit or loss of closed trades after fees, funding and gas.'), val: plHtml(totalObj(gs), true), sub: `after fees, funding &amp; gas · avg ${fmtU(unitVal(avgObj(gs)))} per trade` })}
        ${kpi({ lbl: 'Expectancy', tip: tipSafe('expR', 'Average net R per trade — what one trade is worth in units of risk.'), gated: expEarly,
          val: !isNum(s.expR) ? '—' : expEarly ? fmtR(s.expR) : `<span class="${plClass(s.expR)}">${fmtR(s.expR)}</span>`,
          sub: !isNum(s.expR) ? 'needs trades with a stop' : expEarly ? `early — needs 20+ trades with a stop (${s.rN} so far)` : expSub })}
        ${kpi({ lbl: 'Win rate', tip: tipSafe('winRate', 'Share of closed trades that made money after costs.'), gated: early, val: P0(s.winRate), extra: winBar(s),
          sub: early ? `early — needs 20+ trades (${s.n} so far)` : edge ? `<span class="an-edge-t an-edge-${s.winEdge}">${edge[0]}</span> ${edge[1]}` : `${s.wins}W · ${s.be}BE · ${s.losses}L` })}
        ${kpi({ lbl: 'Payoff ratio', tip: tipSafe('payoff', 'Average win divided by average loss. With a payoff of 2 you break even winning only 1 trade in 3.'), gated: early, val: X2(pay),
          sub: isNum(pay) ? `avg win ÷ avg loss (${isNum(s.payoffR) ? 'in R' : 'in $'})${early ? ' · early' : ''}` : 'needs a win and a loss' })}
        ${kpi({ lbl: 'Profit factor', tip: tipSafe('profitFactor', 'Gross wins ÷ gross losses. Above 1 makes money.'), gated: !s.pfReliable || pf === Infinity,
          val: pf == null ? '—' : pf === Infinity ? 'n/a' : s.pfReliable ? `<span class="${pf >= 1 ? 'pos' : 'neg'}">${pfTxt(pf)}</span>` : pfTxt(pf),
          sub: pf === Infinity ? 'n/a — no losses yet' : pf == null ? 'needs closed trades' : !s.pfReliable ? `needs 20 trades &amp; 5 losses (${s.n} · ${s.losses})` : pf >= 1 ? `$${pfTxt(pf)} won per $1 lost` : 'losing more than winning' })}
        ${kpi({ lbl: 'Avg win vs loss', tip: tipSafe('payoff', 'Your average winning trade next to your average losing trade.'),
          val: `<span class="an-pair"><span class="${plClass(aw)}">${wins.length ? fmtU(aw) : '—'}</span><span class="an-slash" aria-hidden="true">/</span><span class="${plClass(al)}">${losses.length ? fmtU(al) : '—'}</span></span>`,
          sub: `${plural(s.wins, 'win')} · ${plural(s.losses, 'loss', 'losses')}${s.be ? ` · ${s.be} breakeven` : ''}` })}
      </div>
      <div class="an-g an-g2">
        <div class="card">${title('brain', 'What your numbers say', '', confBadge(s.n))}
          ${reads.length ? readingsHtml(reads) : '<div class="an-empty">Close a few more trades to get readings.</div>'}</div>
        <div class="card">${title('stats', 'R-multiple distribution', tipSafe('rMultiple', 'Each bar counts trades by result in units of risk. Losses should cluster at −1R; hatched bars went past the planned stop.'), confBadge(rs.length, 'trades with a stop'))}
          ${box('hist', 'md')}
          <div class="chart-cap"><span>Median <b>${fmtR(s.medianR)}</b></span><span>Std dev <b>${R1(s.sdR)}</b></span>
            <span>Losses past −1.1R <b class="${s.stopViolationRate > 0.25 ? 'neg' : ''}">${P0(s.stopViolationRate)}</b></span>
            ${s.noStop ? `<span class="warn-c">${plural(s.noStop, 'trade')} without a stop (no R)</span>` : ''}</div></div>
      </div>
      <div class="an-g an-g2">
        <div class="card">${title('scale', 'Wins, losses & size', '', '')}
          <div data-el="stack"></div>
          ${cmpBars([{ label: 'Avg win', v: aw, cls: 'pos', html: wins.length ? fmtU(aw) : '—' }, { label: 'Avg loss', v: al, cls: 'neg', html: losses.length ? fmtU(al) : '—' }])}
          <div class="chart-cap"><span>Payoff <b>${X2(pay)}</b></span><span>Breakeven win rate <b>${P0(s.beWinRate)}</b></span><span>Your win rate <b>${P0(s.winRate)}</b></span></div></div>
        <div class="card">${title('trend-up', 'Is the edge holding?', tipSafe('rolling', 'Expectancy over a moving window of your last 20 trades — it shows whether the edge is stable, improving or fading.'), gs.length >= 25 ? 'rolling 20 trades' : '')}
          ${gs.length >= 25 ? `${box('roll', 'md')}${legend([{ label: 'Rolling 20-trade expectancy', color: T.s1 }].concat(isNum(s.expR) ? [{ label: 'Average for the whole view', color: T.s3, dash: true }] : [], isNum(swing) ? [{ label: 'Normal swing for 20 trades', color: T.s1, band: true }] : []))}<div class="chart-cap" data-el="rollcap"></div>
            ${isNum(swing) ? note('The shaded band is how much a 20-trade average normally wobbles around your overall expectancy (±1 standard error). A line inside it is noise; a long stretch below it is a real change.') : ''}`
            : gate(`Appears at 25 trades (you have ${gs.length})`, 'A 20-trade window needs a few windows before a trend means anything.')}</div>
      </div>
      <div class="an-g an-g-bd">
        <div class="card" data-card="bd">${title('layers', 'Breakdown', '', '<span class="seg sm inline" data-seg="bd" role="group" aria-label="Break down by"></span>')}
          <div data-el="bd">${bdTableHtml(gs, st.bd)}</div>
          ${note('Select a row to open those trades. Rows with fewer than 10 trades are greyed out — too few to read.')}</div>
        <div class="card">${title('list', 'Totals & extremes', '', '')}
          <div class="stat-rows">
            ${row('Largest win', money(s.largestWin, { sign: true }), { cls: plClass(s.largestWin) })}
            ${row('Largest loss', money(s.largestLoss, { sign: true }), { cls: plClass(s.largestLoss) })}
            ${row('Best day', money(s.bestDay, { sign: true }), { cls: plClass(s.bestDay) })}
            ${row('Worst day', money(s.worstDay, { sign: true }), { cls: plClass(s.worstDay) })}
            ${row('Green days', P0(s.greenDayPct), { tip: tipSafe('greenDays', 'Share of trading days that ended with a profit.'), small: `${s.greenDays} of ${plural(s.tradingDays, 'trading day')}` })}
            ${row('Trades per trading day', isNum(s.tradesPerDay) ? s.tradesPerDay.toFixed(1) : '—')}
            ${row('Median hold — winners', holdTxt(s.medHoldWin))}
            ${row('Median hold — losers', holdTxt(s.medHoldLoss))}
            ${row('Avg planned reward:risk', isNum(planned) ? `1 : ${planned.toFixed(2)}` : '—', { small: isNum(s.expR) ? `achieved ${fmtR(s.expR)} per trade` : '' })}
            ${row('Avg risk per trade', isNum(avgRiskPct) ? fmtPct(avgRiskPct, { dp: 2 }) : '—', { tip: infoTip('Dollars lost if the stop is hit, divided by the account balance before the trade. Beginners keep this at 0.5–1%.'), cls: isNum(avgRiskPct) && avgRiskPct > riskCap * 1.1 ? 'neg' : '', small: isNum(avgRiskPct) ? `limit ${fmtPct(riskCap, { dp: 2 })}${overCap ? ` · ${plural(overCap, 'trade')} above it` : ''}` : v.pctOk ? 'needs trades with a stop' : 'needs a starting balance' })}
            ${row('Costs paid', money(s.costs.total), { small: 'fees + funding + gas' })}
            ${isNum(selfDisc) ? row('Self-rated discipline', `${selfDisc.toFixed(1)} / 5`, { small: 'your star ratings — the Process tab measures it from your rules' }) : ''}
          </div></div>
      </div>`;
    // R histogram (0R, −1R "planned stop" and the mean are drawn by Charts.histogram)
    const h = cvOf(body, 'hist');
    Charts.histogram(h.cv, h.tip, rs, { mean: s.expR, binW: 0.5, min: -3, max: 5 });
    Charts.label(h.cv, rs.length ? `R-multiple histogram of ${rs.length} trades with a stop: average ${fmtR(s.expR)}, median ${fmtR(s.medianR)}; ${P0(s.stopViolationRate)} of losses went past −1.1R.` : 'R-multiple histogram: no trades with a stop yet.');
    Charts.stack(body.querySelector('[data-el="stack"]'), [{ label: 'Wins', short: 'W', v: s.wins, cls: 'pos' }, { label: 'Breakeven', short: 'BE', v: s.be, cls: 'flat' }, { label: 'Losses', short: 'L', v: s.losses, cls: 'neg' }], { legend: true });
    // Rolling-20 expectancy with a 0R baseline
    if (gs.length >= 25) {
      const roll = cached(v, 'roll20', () => Metrics.rolling(gs, 20));
      const vals = roll.map(x => x.expR);
      const series = [{ name: 'Last 20 trades', color: T.s1, values: vals }];
      if (isNum(s.expR)) series.push({ name: 'Whole view', color: T.s3, values: roll.map(() => s.expR), dash: true });
      const r = cvOf(body, 'roll');
      const band = isNum(swing) ? { lo: roll.map(() => s.expR - swing), hi: roll.map(() => s.expR + swing), color: T.s1 } : null;
      Charts.multi(r.cv, r.tip, series, roll.map(x => '#' + (x.i + 1)), { fmtY: (y) => fmtR(y), fmtAxis: (y) => fmtR(y, 1), baseline: 0, band, emptyMsg: 'Needs trades with a stop' });
      const valid = vals.filter(isNum), last = valid[valid.length - 1], below = valid.filter(x => x < 0).length;
      const faded = isNum(s.expR) && s.expR > 0 && vals.length >= 10 && vals.slice(-10).every(x => isNum(x) && x < 0);
      Charts.label(r.cv, valid.length ? `Rolling 20-trade expectancy over ${valid.length} windows; latest ${fmtR(last)}; ${below} windows below zero${band ? `; normal swing ${fmtR(s.expR - swing)} to ${fmtR(s.expR + swing)}` : ''}.` : 'Rolling expectancy: no trades with a stop yet.');
      const cap = body.querySelector('[data-el="rollcap"]');
      if (cap) cap.innerHTML = valid.length ? `<span>Latest window <b class="${plClass(last)}">${fmtR(last)}</b></span><span><b>${below}</b> of ${valid.length} windows below 0R</span>${band ? `<span>Normal swing <b>${fmtR(s.expR - swing)} to ${fmtR(s.expR + swing)}</b></span>` : ''}${faded ? '<span class="warn-c">▼ Recent edge has faded — review recent setups and market conditions</span>' : ''}` : '<span class="dim">Needs trades with a stop.</span>';
    }
    // Breakdown switcher re-renders only the table
    const bdCard = body.querySelector('[data-card="bd"]');
    segK(bdCard.querySelector('[data-seg="bd"]'), BD, st.bd, (id) => { st.bd = id; persist(); bdCard.querySelector('[data-el="bd"]').innerHTML = bdTableHtml(v.gs, id); bindDrills(bdCard); });
  }

  /* ═══ Risk & drawdown ══════════════════════════════════ */
  let mcToken = 0;
  const mcRisk = () => (isNum(st.mcRisk) && st.mcRisk > 0 ? st.mcRisk : effectiveMaxRisk());
  const recoveryWord = (x) => (x >= 3.5 ? 'excellent (≥ 3.5)' : x >= 2 ? 'decent (2–3.5)' : x >= 1 ? 'weak (1–2)' : 'net P/L smaller than the worst drop');
  function tabRisk(body, v) {
    const { gs, s } = v;
    const rs = gs.map(R).filter(isNum);
    const q = s.n ? s.losses / s.n : null;
    let cur = 0, kind = '';
    for (let i = gs.length - 1; i >= 0; i--) { const k = gs[i].win ? 'W' : gs[i].loss ? 'L' : 'B'; if (!kind) kind = k; if (k !== kind) break; cur++; }
    const exp100 = isNum(q) ? Metrics.expLongestRun(100, q) : null;
    const p5 = isNum(q) ? Metrics.pLosingRun(q, 5, 100) : null;
    const dd = -s.maxDDPct, pctOk = v.pctOk;
    const pctV = (x) => (pctOk ? fmtPct(x, { dp: 1 }) : '—');
    const ddRead = !pctOk ? 'Drawdown in % of the account cannot be measured without a starting balance or deposit. The dollar drawdown and the R results are still correct.'
      : !(dd > 0) ? 'No drawdown yet — every closed trade so far ended at or above the previous peak.'
      : dd < 0.1 ? `A worst drop of ${P1(dd)} is healthy for 0.5–1% risk per trade.`
        : dd < 0.2 ? `A worst drop of ${P1(dd)} is in the caution zone (10–20%). Check your risk per trade and losing streaks.`
          : `A worst drop of ${P1(dd)} is large — risk per trade or discipline is probably off. Consider halving your size.`;
    const kindTxt = kind === 'W' ? plural(cur, 'win') + ' in a row' : kind === 'L' ? plural(cur, 'loss', 'losses') + ' in a row' : kind === 'B' ? 'last trade was breakeven' : '—';
    const nExp = isNum(exp100) ? Math.round(exp100) : null;
    let streakRead = !isNum(nExp) ? (q > 0 ? 'Every closed trade in view lost, so a normal-streak estimate is not possible yet.' : 'No losses yet, so there is no losing-streak estimate.')
      : kind === 'L' && cur >= 2 ? (cur > exp100 ? `${cur} losses in a row is more than the ~${nExp} that is normal for your win rate. Review recent setups and cut size until it settles.` : `${cur} losses in a row is within normal variance — a streak of ~${nExp} is normal for your win rate. Stick to the plan.`)
        : `With a ${P0(s.winRate)} win rate, a losing streak of ~${nExp} is normal over 100 trades. Expect it and size for it, so it never pushes you into revenge trades.`;
    if (s.n < 20) streakRead += ` (Based on only ${plural(s.n, 'trade')} — the streak maths firms up after 20+.)`;
    const c = s.costs, costR = costRof(gs), cost$ = meanOf(gs.map(g => g.costs || 0));
    const maxCostR = S().risk && isNum(S().risk.maxCostR) ? S().risk.maxCostR : 0.25;
    const costRead = !c.total ? (db.mode === 'live' ? 'No costs recorded — add fees, funding and gas to your trades so results stay honest.' : 'No costs recorded. Paper fills are free, so paper results look better than live will — the Readiness page applies a fee & slippage haircut.')
      : isNum(costR) && costR > maxCostR ? `Costs average ${R1(costR)} per trade — above your ${maxCostR}R limit. Wider stops, maker orders or fewer, better trades shrink this.`
        : `Costs take ${P0(s.costDrag)} of your gross profit${isNum(costR) ? ` (${R1(costR)} per trade)` : ''}.`;
    const cur$ = s.perf && isNum(s.perf.currentDD$) ? s.perf.currentDD$ : null;
    body.innerHTML = `${pctOk ? '' : noBalanceBanner()}
      <div class="card">${title('trend-up', 'Equity & drawdown', tipSafe('maxDD', 'Largest drop from a peak, measured on returns so deposits and withdrawals do not count.'), '<span class="seg sm inline" data-seg="eq" role="group" aria-label="Curve shows"></span>')}
        ${box('eq', 'lg')}
        <div class="chart-cap">
          <span>Max DD <b class="${s.maxDDPct < 0 || (!pctOk && s.maxDD$ < 0) ? 'neg' : ''}">${pctOk ? fmtPct(s.maxDDPct, { dp: 1 }) : money(s.maxDD$, { sign: true })}</b></span>
          <span>Current <b class="${(pctOk ? s.currentDDPct < -0.0005 : cur$ < 0) ? 'neg' : ''}">${pctOk ? fmtPct(s.currentDDPct, { dp: 1 }) : money(cur$, { sign: true })}</b></span>
          <span>Longest <b>${pctOk ? daysTxt(s.longestDDms) : '—'}</b></span>
          <span>Time underwater <b>${pctOk ? P0(s.timeUnderwater) : '—'}</b></span></div>
        ${pctOk ? note('Drawdown is measured on a flow-neutral return index, so deposits and withdrawals never look like gains or losses.') : ''}</div>
      <div class="an-g an-g3">
        <div class="card">${title('trend-down', 'Drawdown & recovery', '', confBadge(s.n))}
          <div class="stat-rows">
            ${row('Max drawdown', pctV(s.maxDDPct), { tip: tipSafe('maxDD', 'Largest peak-to-trough drop of your trading results.'), cls: s.maxDDPct < 0 && pctOk ? 'neg' : '', small: money(s.maxDD$, { sign: true }) })}
            ${row('Current drawdown', pctV(s.currentDDPct), { tip: tipSafe('currentDD', 'How far below your best point you are right now.'), cls: s.currentDDPct < -0.0005 && pctOk ? 'neg' : '', small: !pctOk ? money(cur$, { sign: true }) : s.underwaterSince ? 'below the peak of ' + esc(fmtDate(s.underwaterSince)) : 'at a new high' })}
            ${row('Longest drawdown', pctOk ? daysTxt(s.longestDDms) : '—', { small: 'from a peak to the next new high' })}
            ${row('Time underwater', pctOk ? P0(s.timeUnderwater) : '—', { tip: tipSafe('timeUnderwater', 'Share of calendar days spent below a previous peak.'), small: 'of calendar days below a peak' })}
            ${row('Recovery factor', isNum(s.recovery) ? fixed(s.recovery, 2) : '—', { tip: tipSafe('recovery', 'Net profit divided by the largest $ drawdown.'), small: isNum(s.recovery) ? recoveryWord(s.recovery) : 'no drawdown yet' })}
            ${row('Return ÷ max drawdown', pctOk ? X2(s.retToDD) : '—', { tip: tipSafe('retToDD', 'Total return divided by the worst drop — how much you earned per unit of pain.') })}
          </div><div class="reading">${esc(ddRead)}</div></div>
        <div class="card">${title('flag', 'Streaks', tipSafe('streak', 'Runs of wins or losses in a row — and how long a losing run is normal for your win rate.'), '')}
          <div class="stat-rows">
            ${row('Current streak', esc(kindTxt), { cls: kind === 'W' ? 'pos' : kind === 'L' ? 'neg' : '' })}
            ${row('Longest losing streak', String(s.maxLossStreak), { small: s.n >= 10 && s.expLongestLossRun >= 1 ? `~${Math.round(s.expLongestLossRun)} expected over ${plural(s.n, 'trade')}` : '' })}
            ${row('Longest winning streak', String(s.maxWinStreak))}
            ${row('Normal longest losing run', isNum(nExp) ? '~' + nExp : '—', { small: 'over the next 100 trades' })}
            ${row('Chance of 5 losses in a row', P0(p5), { small: 'at least once in the next 100 trades' })}
          </div><div class="reading">${esc(streakRead)}</div></div>
        <div class="card">${title('scale', 'Cost drag', tipSafe('costDrag', 'Fees, funding and gas as a share of what your winners made before costs.'), '')}
          <div class="stat-rows">
            ${row('Fees', money(c.fees))}
            ${row('Funding', money(c.funding, { sign: true }), { tip: tipSafe('funding', 'Perpetual-futures funding: + paid, − received.'), small: '+ paid · − received' })}
            ${row('Gas', money(c.gas))}
            ${row('Total costs', money(c.total), { small: isNum(cost$) ? `${money(cost$)} per trade on average` : '' })}
            ${row('Share of gross profit', P0(s.costDrag), { cls: s.costDrag > 0.25 ? 'neg' : '' })}
            ${row('Average cost per trade', R1(costR), { cls: isNum(costR) && costR > maxCostR ? 'neg' : '', small: `your limit ${maxCostR}R` })}
          </div><div class="reading">${esc(costRead)}</div></div>
      </div>
      <div class="card" data-card="mc">${title('layers', 'Monte Carlo: the next 100 trades', tipSafe('monteCarlo', 'Thousands of reshuffles of your own results show the range of drawdowns and streaks to be ready for.'), confBadge(rs.length, 'trades with a stop'))}
        <div class="card-sub">Your own trade results (in R), reshuffled 5,000 times at a chosen risk per trade. It shows the range of drawdowns and losing streaks to be ready for — a range, not a forecast.</div>
        ${rs.length < 50 ? gate(`Needs 50 trades with a stop (you have ${rs.length})`, 'Reshuffling a small sample can never produce a loss worse than the worst one you have already had, so it would look safer than reality.') : `
        <div class="an-mc-ctl">
          <div class="field an-mc-risk"><label for="an-mc-risk">Risk per trade</label><div class="input-group"><input id="an-mc-risk" class="input sm mono" type="number" min="0.05" max="10" step="0.05" inputmode="decimal" value="${mcRisk()}" data-mc="risk"><span class="addon">%</span></div></div>
          <label class="check"><input type="checkbox" data-mc="stress" ${st.mcStress ? 'checked' : ''}> Add a −3R stress trade <span class="dim">(gap or slippage)</span></label>
        </div><div data-el="mcout"></div>`}</div>`;
    const eqOpts = [{ id: 'pl', label: 'Trading P/L' }].concat(pctOk ? [{ id: 'pct', label: '% return' }] : [], [{ id: 'r', label: 'R' }]);
    segK(body.querySelector('[data-seg="eq"]'), eqOpts, eqMode(v), (id) => { st.eq = id; persist(); drawEquity(body, v); });
    bindBalanceBtn(body);
    drawEquity(body, v);
    if (rs.length >= 50) bindMC(body.querySelector('[data-card="mc"]'), v);
  }
  // '% return' is only offered when the account has a balance to measure against
  const eqMode = (v) => (st.eq === 'pct' && !v.pctOk ? 'pl' : st.eq);
  function drawEquity(el, v) {
    const { cv, tip } = cvOf(el, 'eq'); if (!cv) return;
    const { gs, s } = v, mode = eqMode(v), pctOk = v.pctOk;
    const t0 = gs.length ? Math.min(Date.parse(gs[0].trade.entryAt) || gs[0].exitMs, gs[0].exitMs) : Date.now();
    // dd: null (no balance) hides the underwater panel instead of drawing a meaningless one
    const pts = [{ t: t0, y: 0, dd: pctOk ? 0 : null, label: 'Start of this view' }];
    let cumR = 0;
    for (const p of s.perf.pts) {
      if (isNum(p.g.R)) cumR += p.g.R;
      pts.push({
        t: p.t, y: mode === 'pct' ? (p.idx - 1) * 100 : mode === 'r' ? cumR : p.cum, dd: pctOk ? p.ddPct : null,
        label: `${p.g.coin || 'Trade'} · ${fmtDateShort(p.t)}`, extra: `This trade ${moneyTxt(p.g.netPL)}${isNum(p.g.R) ? ' · ' + fmtR(p.g.R) : ''}`,
      });
    }
    const fmtY = mode === 'pct' ? (y) => fmtPct(y / 100, { sign: true }) : mode === 'r' ? (y) => fmtR(y) : (y) => moneyTxt(y);
    const fmtAxis = mode === 'pct' ? (y) => (y > 0 ? '+' : y < 0 ? MINUS : '') + Math.abs(y).toFixed(Math.abs(y) < 10 ? 1 : 0) + '%'
      : mode === 'r' ? (y) => fmtR(y, Math.abs(y) < 10 ? 1 : 0) : (y) => View.axisMoney(y);
    Charts.equity(cv, tip, pts, { fmtY, fmtAxis, color: tk().s1, emptyMsg: 'Close a trade to start the curve' });
    const last = pts[pts.length - 1];
    Charts.label(cv, gs.length ? `Equity curve of ${plural(gs.length, 'closed trade')}: ${mode === 'pct' ? 'return' : mode === 'r' ? 'cumulative R' : 'trading P/L'} ${fmtY(last.y)}${pctOk ? `; max drawdown ${fmtPct(s.maxDDPct, { dp: 1 })}, now ${fmtPct(s.currentDDPct, { dp: 1 })}` : ''}.` : 'Equity curve: no closed trades in view.');
  }
  function bindMC(card, v) {
    if (!card) return;
    const ri = card.querySelector('[data-mc="risk"]'), sc = card.querySelector('[data-mc="stress"]');
    if (ri) ri.onchange = () => { const x = parseFloat(ri.value); st.mcRisk = isNum(x) && x > 0 ? clampN(x, 0.05, 10) : null; ri.value = String(mcRisk()); persist(); fillMC(card, v); };
    if (sc) sc.onchange = () => { st.mcStress = sc.checked; persist(); fillMC(card, v); };
    fillMC(card, v);
  }
  // Lazy: only runs while the Risk tab is open, cached per filter (memo) + risk + stress, and after a paint
  function fillMC(card, v) {
    const out = card.querySelector('[data-el="mcout"]'); if (!out) return;
    const risk = mcRisk(), stress = !!st.mcStress, key = `mc|${risk}|${stress ? 1 : 0}`;
    const token = ++mcToken;
    if (has(v.extra, key)) { paintMC(out, v.extra[key], risk, stress); return; }
    out.innerHTML = '<div class="an-loading" role="status"><span class="an-spin" aria-hidden="true"></span>Running 5,000 simulations…</div>';
    setTimeout(() => {
      if (token !== mcToken || !out.isConnected) return;
      let mc = null;
      try { mc = Metrics.monteCarlo(v.gs.map(R).filter(isNum), { sims: 5000, trades: 100, riskPct: risk, stress, seed: 1337 }); } catch (e) { console.error('[analytics:mc]', e); }
      v.extra[key] = mc;
      paintMC(out, mc, risk, stress);
    }, 30);
  }
  function paintMC(out, mc, risk, stress) {
    if (!mc) { out.innerHTML = gate('Simulation unavailable', 'Needs at least 50 trades with a stop.'); return; }
    const T = tk();
    const pr = (th) => { const x = mc.probDD.find(d => d.th === th); return x ? x.p : null; };
    const P = (x) => (!isNum(x) ? '—' : x > 0 && x < 0.005 ? '&lt; 1%' : x > 0.995 && x < 1 ? '&gt; 99%' : P0(x));
    const smaller = Math.max(0.25, Math.round(risk / 2 * 4) / 4);
    const text = `At ${risk}% risk per trade, a worst drop of about ${P0(mc.maxDD.p50)} is typical over the next 100 trades, and 1 run in 20 sees ${P0(mc.maxDD.p95)} or more.`
      + (mc.maxDD.p95 > 0.2 ? ` That bad case is above 20% — a smaller risk per trade${smaller < risk ? ` (try ${smaller}%)` : ''} would shrink it roughly in proportion.` : ' That is a survivable range for a beginner.');
    out.innerHTML = `<div class="an-mc-grid">
        <div class="an-mc-chart">${box('mc', 'md')}<div class="an-axis-note">trades from now →</div>
          ${legend([{ label: 'Median path', color: T.s1 }, { label: 'Good case (95th pct)', color: T.s3, dash: true }, { label: 'Bad case (5th pct)', color: T.s2, dash: true }, { label: 'Middle 90% of runs', color: T.s1, band: true }])}</div>
        <div class="an-tiles">
          ${tile('Typical worst drop', fmtPct(-mc.maxDD.p50, { dp: 1 }), 'median max drawdown', 'neg')}
          ${tile('Bad-case worst drop', fmtPct(-mc.maxDD.p95, { dp: 1 }), '1 run in 20 is worse', 'neg')}
          ${tile('Drop of 10%+', P(pr(0.1)), 'chance over 100 trades')}
          ${tile('Drop of 20%+', P(pr(0.2)), 'chance over 100 trades')}
          ${tile('Drop of 30%+', P(pr(0.3)), 'chance over 100 trades')}
          ${tile('Ending below start', P(mc.probLoss), 'after 100 trades')}
          ${tile('Losing streak, bad case', isNum(mc.streakP95) ? Math.round(mc.streakP95) + ' in a row' : '—', '95th percentile')}
          ${tile('Typical result', fmtPct(mc.final.p50 - 1, { sign: true, dp: 1 }), `range ${fmtPct(mc.final.p5 - 1, { sign: true, dp: 0 })} to ${fmtPct(mc.final.p95 - 1, { sign: true, dp: 0 })}`, plClass(mc.final.p50 - 1))}
        </div></div>
      <div class="reading">${esc(text)}</div>
      ${note(`Based on ${plural(stress ? mc.n - 1 : mc.n, 'trade result')}${stress ? ' plus one −3R stress trade' : ''}, ${mc.sims.toLocaleString('en-US')} runs. It assumes future trades look like past ones and ignores streaky markets — real drawdowns can be deeper.`)}`;
    const { cv, tip } = cvOf(out, 'mc');
    const toPct = (x) => (x - 1) * 100;
    const lo = mc.bands.map(b => toPct(b.p5)), mid = mc.bands.map(b => toPct(b.p50)), hi = mc.bands.map(b => toPct(b.p95));
    Charts.multi(cv, tip, [
      { name: 'Good case (95th pct)', color: T.s3, values: hi, dash: true, width: 1.5 },
      { name: 'Median', color: T.s1, values: mid },
      { name: 'Bad case (5th pct)', color: T.s2, values: lo, dash: true, width: 1.5 },
    ], mc.bands.map(b => String(b.trade)), {
      band: { lo, hi, color: T.s1 }, baseline: 0,
      fmtY: (y) => fmtPct(y / 100, { sign: true, dp: 1 }), fmtAxis: (y) => (y > 0 ? '+' : y < 0 ? MINUS : '') + Math.abs(y).toFixed(0) + '%',
    });
    Charts.label(cv, `Fan chart of ${mc.sims} simulated paths over ${mc.trades} trades at ${risk}% risk: median result ${fmtPct(mc.final.p50 - 1, { sign: true, dp: 1 })}, 90% of paths between ${fmtPct(mc.final.p5 - 1, { sign: true, dp: 0 })} and ${fmtPct(mc.final.p95 - 1, { sign: true, dp: 0 })}.`);
  }

  /* ═══ Timing ═══════════════════════════════════════════ */
  function tabTiming(body, v) {
    const { gs, s } = v, T = tk();
    const useR = s.rN > 0 && s.rN >= s.n / 2;
    const fmtV = useR ? (x) => fmtR(x) : (x) => moneyTxt(x);
    const axV = useR ? (x) => fmtR(x, 1) : (x) => View.axisMoney(x);
    const sess = Metrics.sessionList();
    const tz = st.utc ? 'UTC' : `your local time (${tzLabel()})`;
    const emptyRow = (k) => ({ key: k, n: 0, wins: 0, winRate: null, pl: 0, avgPL: null, expR: null, rN: 0, pf: null, groups: [] });
    function rowsFor(keys, labels, fn) {
      const got = Metrics.groupBy(gs, fn);
      return keys.map((k, i) => ({ ...(got.find(r => r.key === k) || emptyRow(k)), label: labels[i] }));
    }
    const valOf = (r) => (!r.n ? 0 : useR ? (isNum(r.expR) ? r.expR : 0) : (isNum(r.avgPL) ? r.avgPL : 0));
    const barOf = (r) => ({
      v: valOf(r), label: r.label,
      sub: r.n ? `n=${r.n}${thinTag(r.n)}` : 'no trades',
      extra: r.n ? `Win rate ${P0(r.winRate)} · net ${moneyTxt(r.pl)}${useR && r.rN < r.n ? ` · ${r.n - r.rN} without a stop` : ''}` : '',
      color: r.n && r.n < 10 ? Charts.alpha(T.flat, 0.55) : undefined,
    });
    // Trade number of the day (overtrading check): the order of entry among ALL trades of that trading day
    // in the account, open ones included — a coin or strategy filter must not renumber a day's 4th trade as its 1st
    const r0 = S().risk || {}, resetH = r0.dayResetHour || 0, maxT = isNum(r0.maxTradesDay) && r0.maxTradesDay > 0 ? r0.maxTradesDay : null;
    const nthMap = cached(v, 'nth', () => {
      const m = new Map(), per = new Map();
      const all = C.groups.map(g => ({ g, t: Date.parse(g.trade.entryAt) })).filter(x => isFinite(x.t)).sort((a, b) => a.t - b.t);
      for (const x of all) { const k = Metrics.tradingDayKey(x.t, resetH), c = (per.get(k) || 0) + 1; per.set(k, c); m.set(x.g.trade.id, c); }
      return m;
    });
    const NTH = ['1st', '2nd', '3rd', '4th+'];
    const nthRows = rowsFor(NTH, NTH, (g) => { const o = nthMap.get(g.trade.id); return o ? NTH[Math.min(o, 4) - 1] : null; });
    const nFirst = nthRows[0], nLater = Metrics.bucket(nthRows.slice(2).flatMap(r => r.groups));
    let nthRead = 'Needs 10+ trades that were the first of their day and 10+ that were the 3rd or later to compare.';
    if (nFirst.n >= 10 && nLater.n >= 10) {
      const a = useR ? nFirst.expR : nFirst.avgPL, b = useR ? nLater.expR : nLater.avgPL;
      if (isNum(a) && isNum(b)) nthRead = `Your first trade of the day averages ${fmtV(a)}; your 3rd and later trades average ${fmtV(b)}. `
        + (b < 0 && b < a ? `Later trades lose money — a lower daily trade limit${maxT ? ` (now ${maxT})` : ''} could protect you.` : b < a ? 'Later trades are weaker — fatigue and chasing are common after the first few.' : 'Later trades hold up so far.');
    }
    const sets = [
      { id: 'wd', icon: 'calendar', ttl: 'By weekday', rows: rowsFor(Metrics.WEEKDAYS, Metrics.WEEKDAYS, Metrics.weekdayOf), sem: (k) => ({ weekday: k }), nt: `Weekday of entry in your local time.` },
      { id: 'sess', icon: 'clock', ttl: 'By market session', rows: rowsFor(sess.map(x => x.key), sess.map(x => x.key), Metrics.sessionOf), sem: (k) => ({ session: k }),
        nt: `${Metrics.config.sessionScheme === 'utc' ? 'Fixed UTC blocks' : 'Exchange opening hours — follows daylight saving'}: ${sess.map(x => esc(x.label)).join(' · ')}. <button type="button" class="link-btn" data-act="sess-settings">Change in Settings</button>` },
      { id: 'blk', icon: 'clock', ttl: 'By 4-hour block', rows: rowsFor(Metrics.BLOCKS, Metrics.BLOCKS, (g) => Metrics.block4h(g, st.utc)), sem: null, nt: `Entry time in ${esc(tz)}.` },
      { id: 'hold', icon: 'clock', ttl: 'By holding time', rows: rowsFor(Metrics.HOLD.map(h => h.key), Metrics.HOLD.map(h => h.key), Metrics.holdOf), sem: (k) => ({ hold: k }), nt: 'Time from entry to the final exit.' },
      { id: 'nth', icon: 'layers', ttl: 'By trade number of the day', rows: nthRows, sem: null, read: nthRead,
        nt: `Order of entry within the trading day${resetH ? ` (your day starts at ${String(resetH).padStart(2, '0')}:00)` : ''}. Every trade that day counts, including ones outside this filter.${maxT ? ` Your limit is ${maxT} a day.` : ''}` },
    ];
    // Month by month (ported from v1's monthly chart) — total result in the current unit
    const mKeys = [...new Set(gs.map(g => Metrics.monthKey(g.exitMs)))].sort().slice(-24);
    const months = mKeys.map(k => { const list = gs.filter(g => Metrics.monthKey(g.exitMs) === k), [y, m] = k.split('-'); return { key: k, label: new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), groups: list, o: totalObj(list), n: list.length }; });
    // '%' needs a balance to measure against (as the equity toggle): without one the months show $, not a fake 0%
    const monMoney = units() === '%' && !v.pctOk;
    const mVal = (m) => (monMoney ? m.o.netPL : unitVal(m.o)), mFmt = monMoney ? (x) => moneyTxt(x) : fmtUTxt, mAx = monMoney ? (x) => View.axisMoney(x) : axisU;
    const we = gs.filter(g => Metrics.isWeekend(g)), wk = gs.filter(g => !Metrics.isWeekend(g));
    const bw = Metrics.bucket(wk), be = Metrics.bucket(we);
    let weRead = 'Needs 10+ trades on both weekdays and weekends to compare.';
    if (bw.n >= 10 && be.n >= 10 && isNum(bw.expR) && isNum(be.expR)) {
      const d = be.expR - bw.expR;
      weRead = `Weekend trades average ${fmtR(be.expR)} vs ${fmtR(bw.expR)} on weekdays. ` + (Math.abs(d) < 0.1 ? 'About the same so far.' : d < 0 ? 'Weekends are weaker — liquidity is thinner and sudden moves are common.' : 'Weekends have been better so far.');
    }
    const weCol = (b, list) => { const i = list.length ? drill({ ids: list.map(g => g.trade.id) }) : -1; return { b, i }; };
    const cw = weCol(bw, wk), ce = weCol(be, we);
    const weRow = (label, f) => `<tr><th scope="row">${esc(label)}</th><td class="num">${f(cw.b, wk)}</td><td class="num">${f(ce.b, we)}</td></tr>`;
    const chartCard = (x) => `<div class="card" data-card="${x.id}">${title(x.icon, x.ttl, '', confBadge(sumOf(x.rows.map(r => r.n))))}${box(x.id, 'sm')}<div data-el="${x.id}-bk"></div>${x.read ? `<div class="reading">${esc(x.read)}</div>` : ''}${note(x.nt)}</div>`;
    body.innerHTML = `
      <div class="an-toolbar"><span class="an-tb-l">Times in</span><span class="seg sm inline" data-seg="tz" role="group" aria-label="Time zone"></span>
        <span class="an-tb-x">Bars show <b>${useR ? 'average R per trade' : 'average $ per trade'}</b>${useR ? '' : ' (most trades have no stop, so R is unavailable)'}; bars with fewer than 10 trades are grey and marked “needs 10+” (“n too small” under 3).</span></div>
      <div class="an-g an-g2">${chartCard(sets[0])}${chartCard(sets[1])}</div>
      <div class="an-g an-g2">${chartCard(sets[2])}${chartCard(sets[3])}</div>
      <div class="an-g an-g2">${chartCard(sets[4])}
        <div class="card">${title('calendar', 'Weekdays vs weekends', '', '')}
          <div class="table-wrap bare"><table class="compact-t an-table an-two"><thead><tr><th scope="col"><span class="sr-only">Measure</span></th><th scope="col" class="num">Mon–Fri</th><th scope="col" class="num">Sat–Sun</th></tr></thead><tbody>
            ${weRow('Trades', (b) => confBadge(b.n))}
            ${weRow('Win rate', (b) => P0(b.winRate))}
            ${weRow('Avg R', (b) => `<span class="${b.n >= 10 ? plClass(b.expR) : ''}">${fmtR(b.expR)}</span>`)}
            ${weRow(unitWord(), (b, list) => (list.length ? plHtml(totalObj(list)) : '—'))}
            ${weRow('Profit factor', (b) => pfTxt(b.pf))}
            <tr><th scope="row"></th><td class="num">${cw.i >= 0 ? `<button type="button" class="link-btn" data-drill="${cw.i}">view trades</button>` : ''}</td><td class="num">${ce.i >= 0 ? `<button type="button" class="link-btn" data-drill="${ce.i}">view trades</button>` : ''}</td></tr>
          </tbody></table></div>
          <div class="reading">${esc(weRead)}</div>${note('Weekend = Saturday or Sunday in UTC. Crypto trades 24/7, but weekend liquidity is thinner.')}</div>
      </div>
      <div class="card" data-card="mon">${title('calendar', 'Month by month', '', esc(monMoney ? 'Net P/L' : unitWord()))}${box('mon', 'sm')}<div data-el="mon-bk"></div>${note('Total result of trades closed in each month (last 24 months).')}</div>
      <div class="card">${title('grid', 'Weekday × hour', tipSafe('sample', 'Average result for each hour of each weekday. Hatched cells have fewer than 3 trades.'), gs.length >= 50 ? esc(st.utc ? 'UTC' : tzLabel()) : '')}
        ${gs.length >= 50 ? `<div class="an-hg-wrap" data-el="hg"></div>
          <div class="hg-legend"><span>${useR ? '−2R' : 'loss'}</span><span class="sw" aria-hidden="true"></span><span>${useR ? '+2R' : 'gain'}</span><span>· hatched = fewer than 3 trades${useR ? ' with a stop' : ''} · select a cell to open its trades</span></div>`
          : gate(`Appears at 50 trades (you have ${gs.length})`, 'With 168 hour-by-day cells, a small sample mostly shows noise — a few lucky trades can make any hour look great.')}</div>`;
    segK(body.querySelector('[data-seg="tz"]'), [{ id: 'local', label: 'Local' }, { id: 'utc', label: 'UTC' }], st.utc ? 'utc' : 'local', (id) => { st.utc = id === 'utc'; persist(); redrawTab(`[data-seg="tz"] button[data-id="${id}"]`); });
    const sb = body.querySelector('[data-act="sess-settings"]');
    if (sb) sb.onclick = () => { const St = mod(() => Settings); if (St && St.show) St.show('appearance'); else goPage('settings', 'Settings'); };
    // Bar charts with click-through (canvas) + bucket buttons (keyboard / screen reader)
    for (const x of sets) {
      const card = body.querySelector(`[data-card="${x.id}"]`); if (!card) continue;
      const { cv, tip } = cvOf(card, x.id);
      const drillOf = (r) => drillFor(x.sem ? { ...x.sem(r.key), status: 'closed' } : null, r.groups);
      Charts.bars(cv, tip, x.rows.map(barOf), { fmtY: fmtV, fmtAxis: axV, emptyMsg: 'No trades in this view', onClick: (i) => { const r = x.rows[i]; if (r && r.n) toLedger(drillOf(r)); } });
      Charts.label(cv, `${x.ttl}, ${useR ? 'average R' : 'average $'} per trade: ` + (x.rows.filter(r => r.n).map(r => `${r.label} ${fmtV(valOf(r))} (n=${r.n})`).join(', ') || 'no trades'));
      const bk = card.querySelector(`[data-el="${x.id}-bk"]`);
      if (bk) bk.innerHTML = bucketChips(x.rows.map(r => ({ label: r.label, n: r.n, drill: r.n ? drill(drillOf(r)) : -1 })));
    }
    const monCard = body.querySelector('[data-card="mon"]');
    if (monCard) {
      const { cv, tip } = cvOf(monCard, 'mon');
      Charts.bars(cv, tip, months.map(m => ({ v: mVal(m) || 0, label: m.label, sub: plural(m.n, 'trade'), extra: `Win rate ${P0(m.groups.filter(g => g.win).length / m.n)} · net ${moneyTxt(m.o.netPL)}` })), {
        fmtY: mFmt, fmtAxis: mAx, emptyMsg: 'No closed trades in view', onClick: (i) => { if (months[i]) toLedger({ ids: months[i].groups.map(g => g.trade.id) }); },
      });
      Charts.label(cv, 'Result by month: ' + (months.map(m => `${m.label} ${mFmt(mVal(m))}`).join(', ') || 'no trades'));
      const bk = monCard.querySelector('[data-el="mon-bk"]');
      if (bk) bk.innerHTML = bucketChips(months.map(m => ({ label: m.label, n: m.n, drill: drill({ ids: m.groups.map(g => g.trade.id) }) })));
    }
    // 7×24 heat grid (gated at 50 trades): avg R, or avg $ when most trades lack a stop
    const hg = body.querySelector('[data-el="hg"]');
    if (hg) {
      const grid = Metrics.weekdayHourGrid(gs, { hours: 24, utc: st.utc });
      const cells = grid.cells.map(rw => rw.map(c => (!c ? null : useR ? { v: c.rN ? c.r / c.rN : 0, n: c.rN } : { v: c.pl / c.n, n: c.n })));
      Charts.heatgrid(hg, { rows: grid.rows, cols: grid.cols, cells }, {
        fmt: useR ? (x) => fmtR(x) : (x) => moneyTxt(x), clamp: useR ? 2 : undefined, minN: 3,
        onCell: (ri, ci) => {
          const list = gs.filter(g => { const d = new Date(Date.parse(g.trade.entryAt)); return (d.getDay() + 6) % 7 === ri && (st.utc ? d.getUTCHours() : d.getHours()) === ci; });
          if (list.length) toLedger({ ids: list.map(g => g.trade.id) });
        },
      });
      // In R mode a cell's n counts trades WITH a stop, so Charts.heatgrid would call a cell whose trades
      // all lack a stop "no trades" — name them truthfully (children: corner, column heads, then per row
      // a label + one cell per column)
      const kids = useR && hg.firstElementChild ? hg.firstElementChild.children : null, nc = grid.cols.length;
      if (kids) grid.cells.forEach((rw, ri) => rw.forEach((c, ci) => {
        if (!c || !c.n || c.rN) return;
        const x = kids[1 + nc + ri * (nc + 1) + 1 + ci];
        if (x) { const t = `${grid.rows[ri]} ${grid.cols[ci]}: ${plural(c.n, 'trade')}, none with a stop (no R)`; x.title = t; x.setAttribute('aria-label', t); }
      }));
    }
  }

  /* ═══ Process (mistakes, grades, emotions, discipline) ═══ */
  function tabProcess(body, v) {
    const { gs, s, ctx } = v, T = tk();
    const mr = cached(v, 'mr', () => Metrics.mistakeReport(gs));
    const reviewed = gs.filter(g => Metrics.isReviewed(g.trade));
    const dirty = reviewed.filter(g => Metrics.realMistakes(g.trade).length);
    const dirtyR = dirty.map(R).filter(isNum);
    const avgRisk = meanOf(gs.map(g => g.risk).filter(isNum));
    // Total cost over trades with ≥1 mistake (per-tag costs overlap and must not be summed)
    const gap = isNum(mr.Eclean) && dirtyR.length ? mr.Eclean - meanOf(dirtyR) : null;
    const totR = isNum(gap) ? gap * dirtyR.length : null, tot$ = isNum(totR) && avgRisk ? totR * avgRisk : null;
    const ck = (r) => (isNum(r.costR) ? r.costR : -1e9);
    const rows = [...mr.rows].sort((a, b) => ck(b) - ck(a) || b.n - a.n);
    const top = rows.find(r => isNum(r.costR) && r.costR > 0);
    let head;
    if (!mr.reviewed) head = { cls: 'info', t: 'Review your trades to see what mistakes cost', x: `None of the ${plural(gs.length, 'trade')} in view has been reviewed yet. After a trade closes, tag its mistakes — or mark it clean.` };
    else if (!dirty.length) head = { cls: 'ok', t: `No mistakes tagged in ${plural(reviewed.length, 'reviewed trade')} ✓`, x: 'Clean process. Keep tagging honestly — this report only works when mistakes get logged.' };
    else if (!isNum(gap)) head = { cls: 'info', t: `${plural(dirty.length, 'trade')} with mistakes`, x: 'Mark clean trades as “Clean” when you review them (and set a stop), so mistakes can be compared with your clean baseline.' };
    else if (totR > 0) head = { cls: 'warn', t: `Mistakes cost you ${fixed(totR, 1)}R${isNum(tot$) ? ` (≈ ${money(tot$)})` : ''}${top ? ` — your top leak is ${esc(mistakeLabel(top.key))}` : ''}`, x: `Clean trades average ${fmtR(mr.Eclean)}; the ${plural(dirtyR.length, 'trade')} with mistakes average ${fmtR(meanOf(dirtyR))}.${top ? ' Make fixing the top leak your one process goal for next week.' : ''}` };
    else head = { cls: 'ok', t: 'Trades with mistakes have not cost you more than clean ones — yet', x: `Clean ${fmtR(mr.Eclean)} vs with mistakes ${fmtR(meanOf(dirtyR))} per trade. Small samples swing, so keep tagging.` };
    const mkTable = rows.length ? `<div class="table-wrap bare"><table class="compact-t an-table"><thead><tr><th scope="col">Mistake</th><th scope="col" class="num">Trades</th><th scope="col" class="num">% of trades</th><th scope="col" class="num">Exp. R</th><th scope="col" class="num">vs clean</th><th scope="col" class="num">Cost (R)</th><th scope="col" class="num">Cost ($)</th></tr></thead><tbody>
      ${rows.map(r => {
        const i = drill(drillFor({ mistake: r.key, status: 'closed' }, r.groups)), thin = r.n < 10;
        return `<tr class="clickable ${thin ? 'an-thin' : ''}" data-rowdrill="${i}"${thin ? ' title="Fewer than 10 trades — early data"' : ''}><td><button type="button" class="an-rowbtn" data-drill="${i}">${esc(mistakeLabel(r.key))}</button></td>
          <td class="num">${r.n}</td><td class="num">${P0(r.share)}</td><td class="num ${plClass(r.expR)}">${fmtR(r.expR)}</td>
          <td class="num ${isNum(r.gapR) ? plClass(-r.gapR) : ''}">${isNum(r.gapR) ? fmtR(-r.gapR) : '—'}</td>
          <td class="num ${isNum(r.costR) ? plClass(-r.costR) : ''}">${isNum(r.costR) ? fmtR(-r.costR, 1) : '—'}</td>
          <td class="num ${isNum(r.cost$) ? plClass(-r.cost$) : ''}">${isNum(r.cost$) ? money(-r.cost$, { sign: true }) : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>
      ${note('A trade with two mistakes counts under both, so per-mistake costs overlap — the headline total counts each trade once. $ cost ≈ R cost × your average $ risk.')}` : '';
    // by mistake count, grades, emotions
    const CNT = { 0: 'No mistakes', 1: '1 mistake', '2+': '2 or more' };
    const byCount = mr.byCount.map(r => ({ label: CNT[r.key] || r.key, v: isNum(r.expR) ? r.expR : 0, n: r.n, sub: `n=${r.n} · win ${P0(r.winRate)}${thinTag(r.n)}` }));
    const b0 = mr.byCount.find(r => r.key === '0'), b2 = mr.byCount.find(r => r.key === '2+');
    const cntRead = b0 && b0.n >= 5 && isNum(b0.expR) && b0.expR < 0 ? `Even clean trades lose on average (${fmtR(b0.expR)}) — that points at the strategy itself, not just discipline.`
      : b0 && b2 && b0.n >= 5 && b2.n >= 5 && isNum(b0.expR) && isNum(b2.expR) ? `Clean trades average ${fmtR(b0.expR)}; trades with 2+ mistakes average ${fmtR(b2.expR)}.` : 'Needs 5+ reviewed trades in a bucket to compare.';
    const grades = Metrics.gradeReport(gs);
    const gA = grades.find(r => r.key === 'A'), gC = grades.find(r => r.key === 'C');
    const ungraded = gs.length - sumOf(grades.map(r => r.n));
    let gradeRead = 'Grade each trade A/B/C for process (not result) to see whether good process pays.';
    if (gA && gC && gA.n >= 5 && gC.n >= 5 && isNum(gA.expR) && isNum(gC.expR)) {
      gradeRead = gA.expR > gC.expR ? `A-grade trades beat C-grade by ${R1(gA.expR - gC.expR)} per trade — good process pays.` : 'C-grade trades are doing as well as A-grade so far — check your grading, or it is luck that will not last.';
      if (gC.n >= 10 && gC.expR > 0) gradeRead += ' Profitable C trades teach the wrong lesson.';
    }
    const gradeRows = grades.map(r => { const i = drill(drillFor({ grade: r.key, status: 'closed' }, r.groups)); return `<tr class="clickable ${r.n < 10 ? 'an-thin' : ''}" data-rowdrill="${i}"><td><button type="button" class="an-rowbtn" data-drill="${i}"><span class="badge grade-${esc(r.key)} sm">${esc(r.key)}</span></button></td><td class="num">${r.n}</td><td class="num">${P0(r.winRate)}</td><td class="num ${plClass(r.expR)}">${fmtR(r.expR)}</td><td class="num">${plHtml(totalObj(r.groups))}</td></tr>`; }).join('');
    const er = Metrics.emotionReport(gs);
    // mistake rate per feeling = share of its REVIEWED trades that carry a real mistake tag
    const mkRate = (list) => { const rv = list.filter(g => Metrics.isReviewed(g.trade)); return rv.length ? rv.filter(g => Metrics.realMistakes(g.trade).length).length / rv.length : null; };
    const emoRows = [...er.pre].sort((a, b) => b.n - a.n).map(r => {
      const i = drill(drillFor({ emotion: r.key, status: 'closed' }, r.groups)), mrt = mkRate(r.groups);
      return `<tr class="clickable ${r.n < 10 ? 'an-thin' : ''}" data-rowdrill="${i}"><td><button type="button" class="an-rowbtn" data-drill="${i}">${esc(emoLabel(r.key))}</button></td><td class="num">${r.n}</td><td class="num">${P0(r.winRate)}</td><td class="num ${plClass(r.expR)}">${fmtR(r.expR)}</td><td class="num ${isNum(mrt) && mrt >= 0.5 ? 'warn-c' : ''}">${P0(mrt)}</td></tr>`;
    }).join('');
    const intensity = er.intensity.map(r => ({ label: r.key, v: isNum(r.expR) ? r.expR : 0, n: r.n, sub: `n=${r.n} · win ${P0(r.winRate)}${thinTag(r.n)}` }));
    // Journal readiness check-in vs results: a trade belongs to the check-in of the trading day it was OPENED on
    const dayStore = db.days && db.days[db.mode] && typeof db.days[db.mode] === 'object' ? db.days[db.mode] : {};
    const resetH = (S().risk && S().risk.dayResetHour) || 0;
    const scoreOn = (g) => {
      const t = Date.parse(g.trade.entryAt); if (!isFinite(t)) return null;
      const rec = dayStore[Metrics.tradingDayKey(t, resetH)], r = rec && rec.pre && rec.pre.readiness;
      return r && isNum(r.score) ? r.score : null;
    };
    // Bands of the Journal's daily self-check (sleep, stress, mood) — worded so they are never mistaken
    // for the paper → live Readiness verdict, which has no score
    const RB = [['ready', 'Felt good (80+)'], ['off', 'A bit off (60–79)'], ['low', 'Low (under 60)']];
    const rdRows = Metrics.groupBy(gs, (g) => { const sc = scoreOn(g); return !isNum(sc) ? null : sc >= 80 ? 'ready' : sc >= 60 ? 'off' : 'low'; }, RB.map(b => b[0]));
    const rdChecked = sumOf(rdRows.map(r => r.n));
    const rdBars = rdRows.map(r => ({ label: RB.find(b => b[0] === r.key)[1], v: isNum(r.expR) ? r.expR : 0, n: r.n, sub: `n=${r.n} · win ${P0(r.winRate)}${isNum(r.expR) ? '' : ' · no R'}${thinTag(r.n)}` }));
    const rdReady = rdRows.find(r => r.key === 'ready'), rdLow = Metrics.bucket(rdRows.filter(r => r.key !== 'ready').flatMap(r => r.groups));
    let rdRead = `${plural(rdChecked, 'trade')} matched to a check-in so far — a band needs 5+ trades before it can be compared.`;
    if (rdReady && rdReady.n >= 5 && rdLow.n >= 5 && isNum(rdReady.expR) && isNum(rdLow.expR)) {
      rdRead = `Trades on days you felt good average ${fmtR(rdReady.expR)}; on below-par days ${fmtR(rdLow.expR)}. ` + (rdLow.expR < rdReady.expR - 0.1 ? 'Sizing down or sitting out on low check-in days looks worth it.' : 'No clear penalty so far — keep checking in honestly.');
    }
    // process × outcome 2×2
    const pm = Metrics.processMatrix(gs);
    const graded = pm.deserved.length + pm.badBreak.length + pm.dumbLuck.length + pm.poetic.length;
    const cell = (k, name, desc) => {
      const list = pm[k], i = list.length ? drill({ ids: list.map(g => g.trade.id) }) : -1, ar = meanOf(list.map(R).filter(isNum));
      return `<button type="button" class="an-mx-c an-mx-${k}" ${i >= 0 ? `data-drill="${i}"` : 'disabled'} aria-label="${esc(`${name}: ${plural(list.length, 'trade')}${isNum(ar) ? `, average ${fmtR(ar)}` : ''}`)}">
        <span class="an-mx-n">${esc(name)}</span><span class="an-mx-d">${esc(desc)}</span>
        <b class="an-mx-v">${list.length}</b><span class="an-mx-s">${graded ? P0(list.length / graded) : '—'} · avg ${fmtR(ar)}</span></button>`;
    };
    const mxRead = !graded ? '' : [pm.dumbLuck.length ? `${plural(pm.dumbLuck.length, 'win')} came from poor process (dumb luck) — they reward habits that cost money later.` : '',
      pm.badBreak.length ? `${plural(pm.badBreak.length, 'loss', 'losses')} were bad breaks — good process, bad result. That is normal; keep doing it.` : ''].filter(Boolean).join(' ');
    // discipline: tiltmeter, adherence & flags, disposition, stop violations, review coverage
    const scores = cached(v, 'disc', () => gs.map(g => Metrics.discScore(g)));
    const tiltPts = [];
    for (let i = 9; i < scores.length; i++) tiltPts.push({ y: meanOf(scores.slice(i - 9, i + 1)), label: '#' + (i + 1), sub: fmtDateShort(gs[i].exitMs) });
    const adh = s.adherence, tilt = adh.tiltmeter;
    const tw = !isNum(tilt) ? null : tilt >= 80 ? ['pos', '▲', 'Disciplined'] : tilt >= 60 ? ['warn-c', '●', 'Slipping'] : ['neg', '▼', 'On tilt'];
    const flagged = cached(v, 'flags', () => gs.map(g => ({ g, f: Metrics.flagsFor(g, ctx) })));
    const cleanN = flagged.filter(x => !x.f.length).length;
    // Rule-following vs rule-breaking trades side by side: what discipline is worth in this view
    const okGs = flagged.filter(x => !x.f.length).map(x => x.g), badGs = flagged.filter(x => x.f.length).map(x => x.g);
    const bOk = Metrics.bucket(okGs), bBad = Metrics.bucket(badGs);
    const okI = okGs.length ? drill({ ids: okGs.map(g => g.trade.id) }) : -1, badI = badGs.length ? drill({ ids: badGs.map(g => g.trade.id) }) : -1;
    const cmpRow = (label, f) => `<tr><th scope="row">${esc(label)}</th><td class="num">${f(bOk, okGs)}</td><td class="num">${f(bBad, badGs)}</td></tr>`;
    const ruleGap = isNum(bOk.expR) && isNum(bBad.expR) ? bOk.expR - bBad.expR : null;
    const ruleRead = bOk.n >= 10 && bBad.n >= 10 && isNum(ruleGap)
      ? (ruleGap > 0.05 ? `Trades that followed every rule average ${fmtR(bOk.expR)} vs ${fmtR(bBad.expR)} when a rule was broken — about ${fixed(ruleGap * bBad.rN, 1)}R given away over ${plural(bBad.rN, 'trade')}.`
        : `Rule-breaking trades (${fmtR(bBad.expR)}) have not done worse than rule-following ones (${fmtR(bOk.expR)}) yet. That is usually luck — the rules protect you from the big losses that have not happened yet.`)
      : '';
    const flagList = FLAGS.map(([k, label]) => {
      const list = flagged.filter(x => x.f.includes(k)).map(x => x.g), i = list.length ? drill({ ids: list.map(g => g.trade.id) }) : -1;
      return `<li class="an-flag ${list.length ? '' : 'zero'}"><span class="an-flag-l">${esc(label)}</span><b>${list.length}</b><span class="an-flag-p">${P0(list.length / gs.length)}</span>${i >= 0 ? `<button type="button" class="link-btn" data-drill="${i}" aria-label="${esc('Show trades: ' + label)}">view</button>` : '<span></span>'}</li>`;
    }).join('');
    const lossesR = gs.filter(g => g.loss && isNum(g.R)), blown = lossesR.filter(g => g.R < -1.1);
    const blownI = blown.length ? drill({ ids: blown.map(g => g.trade.id) }) : -1;
    const discRead = [s.dispositionReliable && s.disposition > 1.5 ? `You hold losers ${X2(s.disposition)} longer than winners — the classic “cut winners, ride losers” habit. Exit at the stop.` : '',
      isNum(s.stopViolationRate) && s.stopViolationRate > 0.25 ? `${P0(s.stopViolationRate)} of your losses went past −1.1R. Moved or ignored stops (or thin DEX liquidity) are costing you.` : '',
      isNum(s.reviewed) && s.reviewed < 0.8 ? `Only ${P0(s.reviewed)} of trades are reviewed — the mistake and grade reports are only as good as your reviews.` : ''].filter(Boolean);
    body.innerHTML = `
      <div class="card">${title('flag', 'Cost of mistakes', tipSafe('mistakeCost', 'How much worse trades tagged with a mistake do than your clean trades, in R and $.'), `${confBadge(mr.reviewed, 'reviewed trades')}`)}
        <div class="an-headline ${head.cls}"><div class="an-hl-t">${head.t}</div><div class="an-hl-x">${esc(head.x)}</div></div>
        ${mkTable}
        <div class="an-note">${plural(mr.reviewed, 'reviewed trade')}${mr.unreviewed ? ` · ${mr.unreviewed} not reviewed yet — ${reviewBtn('open the review queue')}` : ''}${dirty.length ? ' · <button type="button" class="link-btn" data-act="wi-clean">See your curve without these trades (What-if)</button>' : ''}</div></div>
      <div class="an-g an-g2">
        <div class="card">${title('layers', 'Results by number of mistakes', '', '')}<div data-el="bycount"></div><div class="reading">${esc(cntRead)}</div></div>
        <div class="card">${title('star', 'Process grade A / B / C', tipSafe('grade', 'A process grade judges how well you followed your plan — separate from whether the trade made money.'), ungraded ? `${ungraded} ungraded` : '')}
          ${grades.length ? `<div class="table-wrap bare"><table class="compact-t an-table"><thead><tr><th scope="col">Grade</th><th scope="col" class="num">Trades</th><th scope="col" class="num">Win %</th><th scope="col" class="num">Exp. R</th><th scope="col" class="num">${esc(unitWord())}</th></tr></thead><tbody>${gradeRows}</tbody></table></div>` : ''}
          <div class="reading">${esc(gradeRead)}</div>${note('Healthy pattern: A beats B beats C.')}</div>
      </div>
      <div class="an-g an-g2">
        <div class="card">${title('grid', 'Process × outcome', tipSafe('processMatrix', 'Good or poor process (grade A/B vs C) against a good or bad result.'), graded ? `${plural(graded, 'graded trade')}` : '')}
          ${graded ? `<div class="an-mx" role="group" aria-label="Process versus outcome">
              <span></span><span class="an-mx-h">Won</span><span class="an-mx-h">Lost</span>
              <span class="an-mx-h an-mx-rh">Good process<small>grade A or B</small></span>${cell('deserved', 'Deserved success', 'good process, good result')}${cell('badBreak', 'Bad break', 'good process, bad result')}
              <span class="an-mx-h an-mx-rh">Poor process<small>grade C</small></span>${cell('dumbLuck', 'Dumb luck', 'poor process, good result')}${cell('poetic', 'Poetic justice', 'poor process, bad result')}
            </div>${mxRead ? `<div class="reading">${esc(mxRead)}</div>` : ''}` : gate('Grade your trades to fill this in', 'Each reviewed trade gets an A/B/C process grade; this matrix separates skill from luck.')}</div>
        <div class="card">${title('brain', 'Tiltmeter', tipSafe('tiltmeter', 'Rolling 10-trade discipline score: rules met, no mistakes, no guardrail overrides. 80+ disciplined, 60–79 slipping, below 60 on tilt.'), tw ? `<span class="an-tilt ${tw[0]}">${tw[1]} ${Math.round(tilt)} · ${tw[2]}</span>` : '')}
          ${tiltPts.length >= 2 ? `${box('tilt', 'sm')}${note('Score per trade = 50% rules met + 30% no mistakes + 20% no guardrail override; line = average of the last 10. Dashed line = 80 (disciplined).')}`
            : gate(`Appears at 11 trades (you have ${gs.length})`, 'The tiltmeter averages your last 10 trades, so it needs a few windows to draw a line.')}</div>
      </div>
      <div class="an-g an-g2">
        <div class="card">${title('brain', 'Emotions & daily check-in', '', er.pre.length ? confBadge(sumOf(er.pre.map(r => r.n)), 'tags') : '')}
          ${er.pre.length ? `<div class="table-wrap bare"><table class="compact-t an-table"><thead><tr><th scope="col">Feeling before</th><th scope="col" class="num">Trades</th><th scope="col" class="num">Win %</th><th scope="col" class="num">Exp. R</th><th scope="col" class="num" title="Share of reviewed trades with at least one mistake tagged">Mistakes</th></tr></thead><tbody>${emoRows}</tbody></table></div>
            ${intensity.length ? `<div class="an-sub-h">By intensity</div><div data-el="intensity"></div>` : ''}${note('A trade can carry two feelings and counts under both. Mistakes = share of its reviewed trades with a mistake tagged. Rows under 10 trades are greyed.')}`
            : gate('No emotions logged yet', 'Tag how you felt before a trade (trade form → Psychology). After a few weeks you will see which states cost you money.')}
          <div class="an-sub-h">By daily check-in (Journal)${tipSafe('checkin', 'Your daily self-check in the Journal: sleep, stress, mood and HALT, before the first trade.')}</div>
          ${rdChecked ? `<div data-el="readiness"></div><div class="reading">${esc(rdRead)}</div>${note('Check-in = your Journal self-check (sleep, stress, mood, HALT) for the day the trade was opened. A self-check, not a proven trading signal.')}`
            : note('Do the daily check-in in the Journal before your first trade. After a few weeks this shows whether tired or stressed days cost you money.')}</div>
        <div class="card">${title('shield', 'Rule adherence', tipSafe('adherence', 'Share of trades with a stop, risk within your limit, a strategy, no mistakes and no overrides.'), confBadge(gs.length))}
          <div class="stat-rows">
            ${row('Followed every rule', P0(adh.pct), { cls: isNum(adh.pct) ? (adh.pct >= 0.9 ? 'pos' : adh.pct >= 0.75 ? 'warn-c' : 'neg') : '', small: `${cleanN} of ${plural(gs.length, 'trade')} · last ${adh.n30}: ${P0(adh.pct30)}` })}
            ${row('Stop violations', P0(s.stopViolationRate), { tip: tipSafe('stopViolation', 'Losing trades that lost more than 1.1R — the stop was moved, ignored or slipped.'), cls: s.stopViolationRate > 0.25 ? 'neg' : s.stopViolationRate > 0.1 ? 'warn-c' : '', small: `${blown.length} of ${plural(lossesR.length, 'loss', 'losses')} past −1.1R${blownI >= 0 ? ` · <button type="button" class="link-btn" data-drill="${blownI}">view</button>` : ''}` })}
            ${row('Disposition ratio', s.dispositionReliable ? X2(s.disposition) : 'needs 10 wins & 10 losses', { gated: !s.dispositionReliable, tip: tipSafe('disposition', 'Median hold time of losers ÷ winners. Above 1 means you hold losers longer.'), cls: s.dispositionReliable && s.disposition > 1.2 ? 'warn-c' : '', small: s.dispositionReliable ? `losers ${holdTxt(s.medHoldLoss)} vs winners ${holdTxt(s.medHoldWin)} (median)` : '' })}
            ${row('Reviewed', P0(s.reviewed), { tip: tipSafe('reviewed', 'Share of closed trades you reviewed (mistakes tagged or marked clean).'), small: `${reviewed.length} of ${gs.length} · ${reviewBtn('review queue')}` })}
          </div>
          <div class="an-sub-h">Followed every rule vs broke one</div>
          <div class="table-wrap bare"><table class="compact-t an-table an-two"><thead><tr><th scope="col"><span class="sr-only">Measure</span></th><th scope="col" class="num">All rules kept</th><th scope="col" class="num">A rule broken</th></tr></thead><tbody>
            ${cmpRow('Trades', (b) => String(b.n))}
            ${cmpRow('Win rate', (b) => P0(b.winRate))}
            ${cmpRow('Exp. R', (b) => `<span class="${b.n >= 10 ? plClass(b.expR) : ''}">${fmtR(b.expR)}</span>`)}
            ${cmpRow(unitWord(), (b, list) => (list.length ? plHtml(totalObj(list)) : '—'))}
            <tr><th scope="row"></th><td class="num">${okI >= 0 ? `<button type="button" class="link-btn" data-drill="${okI}">view trades</button>` : ''}</td><td class="num">${badI >= 0 ? `<button type="button" class="link-btn" data-drill="${badI}">view trades</button>` : ''}</td></tr>
          </tbody></table></div>
          ${ruleRead ? `<div class="reading">${esc(ruleRead)}</div>` : note('Needs 10+ trades on each side to compare.')}
          <div class="an-sub-h">Automatic flags</div><ul class="an-flags">${flagList}</ul>
          ${discRead.length ? readingsHtml(discRead.map(esc)) : ''}</div>
      </div>`;
    const bce = body.querySelector('[data-el="bycount"]');
    Charts.hbars(bce, byCount, { fmt: (x) => fmtR(x), emptyMsg: 'Review trades (tag mistakes or mark clean) to fill this in.' });
    dimThinHbars(bce, byCount);
    const ie = body.querySelector('[data-el="intensity"]');
    if (ie) { Charts.hbars(ie, intensity, { fmt: (x) => fmtR(x) }); dimThinHbars(ie, intensity); }
    const re = body.querySelector('[data-el="readiness"]');
    if (re) { Charts.hbars(re, rdBars, { fmt: (x) => fmtR(x) }); dimThinHbars(re, rdBars); }
    // Psychology research: show the "clean trades only" curve next to the real one — via What-if, labelled hindsight
    const wc = body.querySelector('[data-act="wi-clean"]');
    if (wc) wc.onclick = () => { st.wi = { ...blankWhatIf(), mk: 'all' }; selectTab('scenarios', true); };
    if (tiltPts.length >= 2) {
      const { cv, tip } = cvOf(body, 'tilt');
      Charts.line(cv, tip, tiltPts, { color: T.s1, fmtY: (y) => Math.round(y) + ' / 100', fmtAxis: (y) => String(Math.round(y)), baseline: 80 });
      Charts.label(cv, `Tiltmeter over ${tiltPts.length} rolling windows; latest ${Math.round(tiltPts[tiltPts.length - 1].y)} out of 100${tw ? ' (' + tw[2] + ')' : ''}.`);
    }
  }

  /* ═══ Efficiency (MAE / MFE) ═══════════════════════════ */
  function tabEfficiency(body, v) {
    const { gs, s } = v;
    const withHL = gs.filter(g => isNum(g.trade.highDuring) && isNum(g.trade.lowDuring));
    const pts = cached(v, 'exc', () => gs.map(g => ({ g, x: Metrics.excursion(g) })).filter(p => p.x && isNum(p.x.maeR) && isNum(p.x.mfeR)));
    const howTo = `<ul class="an-how"><li><b>By hand:</b> open a closed trade, choose Edit and fill in <i>High during trade</i> and <i>Low during trade</i> (Advanced section of the trade form).</li>
      <li><b>Automatically:</b> open the trade's chart and use <i>Auto-fill from candles</i> — it reads the high and low from price history while you are online.</li>
      <li>The trade also needs a stop, so the moves can be measured in R.</li></ul>`;
    if (pts.length < 10) {
      // the newest single-leg trade with a stop but no high/low: the quickest one to fill in
      const next = [...gs].reverse().find(g => g.portions.length === 1 && isNum(g.trade.stopPrice) && !(isNum(g.trade.highDuring) && isNum(g.trade.lowDuring)));
      body.innerHTML = `<div class="card">${title('target', 'How far did price go for and against you?', tipSafe('mae', 'MAE is the worst move against you during a trade; MFE is the best move in your favour. Both measured in R.'), confBadge(pts.length, 'trades with high/low'))}
        ${gate(`Needs 10 trades with a high/low recorded (you have ${pts.length})`, 'MAE (worst move against you) and MFE (best move in your favour) show whether your stop and exits are well placed.')}
        <div class="an-sub-h">How to record them</div>${howTo}
        ${next ? `<div class="an-eff-next"><button type="button" class="btn btn-ghost btn-sm" data-act="fill-hl"><svg aria-hidden="true"><use href="#i-candles"/></svg>Fill in your latest trade</button><span class="dim">${esc(next.coin || 'Trade')} · ${esc(fmtDateShort(next.exitMs))}</span></div>` : ''}
        ${withHL.length > pts.length ? note(`${plural(withHL.length - pts.length, 'trade')} have a high/low but no stop, or were scaled in/out, so they cannot be measured in R.`) : ''}</div>`;
      const fb = body.querySelector('[data-act="fill-hl"]');
      if (fb && next) fb.onclick = () => { const TC = mod(() => TradeChart); if (TC && TC.open) TC.open(next.trade.id); else openTrade(next.trade.id); };
      return;
    }
    const ex = s.exc;
    const winPts = pts.filter(p => p.g.win), losePts = pts.filter(p => p.g.loss);
    const left = meanOf(winPts.filter(p => isNum(p.x.R)).map(p => p.x.mfeR - p.x.R));
    const greenFirst = losePts.filter(p => p.x.mfeR >= 1);
    const coarse = withHL.filter(g => /^candles:/.test(g.trade.excursionSource || '')).length;
    const p80 = ex && ex.winnerMaeP80;
    const lines = [];
    if (isNum(p80)) lines.push(p80 < 0.7 ? `80% of your winners never went more than ${fixed(p80, 1)}R against you — your stop could be tighter. Re-check after 30–50 more trades before changing it.`
      : p80 >= 0.9 ? `80% of winners stayed within ${fixed(p80, 1)}R against you, so many come close to the stop — it is not too wide; a tighter stop would cut winners.`
        : `80% of winners stayed within ${fixed(p80, 1)}R against you — your stop looks about right.`);
    else lines.push(`The stop-placement insight appears at 20 winners with a high/low recorded (you have ${winPts.length}).`);
    if (ex && isNum(ex.exitEff)) lines.push(ex.exitEff < 0.3 ? `Winners keep only ${P0(ex.exitEff)} of the best available move — exits look early (fear?) or targets timid.` : ex.exitEff >= 0.6 ? `Winners keep ${P0(ex.exitEff)} of the best available move — strong exits.` : `Winners keep ${P0(ex.exitEff)} of the best available move.`);
    if (isNum(s.captureRatio)) lines.push(s.captureRatio < 0.6 ? `Winners reach only ${P0(s.captureRatio)} of the R you planned — you may be taking profit too early.` : `Winners reach ${P0(s.captureRatio)} of the R you planned.`);
    if (greenFirst.length >= 2) lines.push(`${greenFirst.length} losing trades were up at least 1R before they turned into losses. A rule like “move the stop to break-even at +1R” is worth testing.`);
    const allI = drill({ ids: pts.map(p => p.g.trade.id) });
    body.innerHTML = `
      <div class="an-g an-g-bd">
        <div class="card">${title('target', 'MAE vs MFE', tipSafe('mae', 'Each dot is a trade: how far price went against you (x) and in your favour (y), in R.'), confBadge(pts.length, 'trades with high/low'))}
          ${box('sc', 'lg')}
          <div class="legend an-legend"><span><i class="dot pos"></i>Winner</span><span><span class="an-x" aria-hidden="true">✕</span>Loser or breakeven</span><span><i class="ln dash" style="color:var(--amber)"></i>Your stop (1R)</span></div>
          <div class="an-sc-acts"><button type="button" class="link-btn" data-drill="${allI}">Show these ${pts.length} trades in the list</button><span class="dim"> · select a dot to open that trade</span></div></div>
        <div class="card">${title('zap', 'Efficiency', tipSafe('exitEff', 'How much of the available move your entries and exits captured.'), '')}
          <div class="stat-rows">
            ${row('Avg MAE (against you)', R1(ex && ex.maeR), { tip: tipSafe('mae', 'Average worst move against you, in R.') })}
            ${row('Avg MFE (in your favour)', R1(ex && ex.mfeR), { tip: tipSafe('mfe', 'Average best move in your favour, in R.') })}
            ${row('Entry efficiency', P0(ex && ex.entryEff), { tip: tipSafe('entryEff', 'How close to the best possible entry you got.'), small: 'how close to the best entry' })}
            ${row('Exit efficiency (winners)', P0(ex && ex.exitEff), { tip: tipSafe('exitEff', 'Share of the best available move your winners kept.'), small: 'share of the best move you kept' })}
            ${row('Total efficiency', P0(ex && ex.totalEff), { small: 'result vs the full high–low range' })}
            ${row('Capture ratio', P0(s.captureRatio), { tip: tipSafe('captureRatio', 'On winners: actual R ÷ planned R.'), small: 'winners: actual R ÷ planned R' })}
            ${row('R left on the table', R1(left), { small: 'winners: best move − result, average' })}
            ${row('Losers that were up 1R+ first', String(greenFirst.length), { small: greenFirst.length ? 'a break-even rule could save some' : '' })}
          </div></div>
      </div>
      <div class="card">${title('brain', 'What it means', '', '')}${readingsHtml(lines.map(esc))}
        ${coarse ? note(`${plural(coarse, 'trade')} use candle data for the high/low. Coarse candles (4h or daily) can overstate MAE and MFE for short trades.`) : ''}</div>`;
    const sc = cvOf(body, 'sc');
    const data = pts.map(p => ({ x: p.x.maeR, y: p.x.mfeR, win: !!p.g.win, id: p.g.trade.id, label: `${p.g.coin || 'Trade'} · ${fmtDateShort(p.g.exitMs)}`, extra: `Result ${fmtR(p.x.R)} · ${p.g.win ? 'winner' : p.g.loss ? 'loser' : 'breakeven'}` }));
    Charts.scatter(sc.cv, sc.tip, data, {
      fmtX: (x) => fixed(x, 1) + 'R', fmtY: (y) => fixed(y, 1) + 'R', xLabel: 'MAE — worst move against you (R)', yLabel: 'MFE — best move for you (R)',
      vlines: [{ x: 1, label: 'stop' }], xMin: 0, yMin: 0, onClick: (p) => openTrade(p.id),
    });
    Charts.label(sc.cv, `Scatter of ${pts.length} trades: average MAE ${R1(ex && ex.maeR)}, average MFE ${R1(ex && ex.mfeR)}; ${winPts.length} winners, ${pts.length - winPts.length} losers or breakeven.`);
  }

  /* ═══ What-if (hindsight) ══════════════════════════════ */
  // gs = trades in view: a drop count or picked mistake saved under another filter can never do more
  // than the controls on screen show (only mistakes present in the view are offered as chips)
  function scenario(gs) {
    const w = st.wi, o = {}, maxDrop = Math.max(0, Math.min(50, gs.length - 1));
    const present = new Set(gs.flatMap(g => Metrics.realMistakes(g.trade))), picked = w.mkIds.filter(id => present.has(id));
    if (w.mk === 'all') o.excludeMistakes = true;
    else if (w.mk === 'pick' && picked.length) o.excludeMistakes = picked;
    if (w.grade) o.minGrade = w.grade;
    if (w.cap) o.capLossR = 1;
    if (Math.min(w.dropBest, maxDrop) > 0) o.dropBest = Math.min(w.dropBest, maxDrop);
    if (Math.min(w.dropWorst, maxDrop) > 0) o.dropWorst = Math.min(w.dropWorst, maxDrop);
    if (w.wd.length) o.excludeWeekdays = w.wd.slice();
    if (w.sess.length) o.excludeSessions = w.sess.slice();
    return o;
  }
  function tabScenarios(body, v) {
    const { gs } = v, w = st.wi;
    const mkOpts = [...new Set(gs.flatMap(g => Metrics.realMistakes(g.trade)))].map(id => ({ id, label: mistakeLabel(id), tone: 'neg' }));
    const maxDrop = Math.max(0, Math.min(50, gs.length - 1));
    body.innerHTML = `
      <div class="banner an-hind" role="note"><svg aria-hidden="true"><use href="#i-alert"/></svg><div class="grow"><b>Hindsight — not a strategy.</b> Removing past trades always makes the curve look better. Use this to see which habit costs the most, then prove the fix on new trades.</div></div>
      <div class="an-g an-g-wi">
        <div class="card an-wi-ctl">${title('filter', 'Scenario', '', '<button type="button" class="btn btn-quiet btn-xs" data-wi="reset">Reset</button>')}
          <div class="an-wi-f"><div class="an-wi-l" id="an-wi-mk-l">Trades with mistakes</div><div class="seg sm" data-seg="wi-mk" role="group" aria-labelledby="an-wi-mk-l"></div>
            <div class="chip-row an-wi-chips ${w.mk === 'pick' ? '' : 'hidden'}" data-chips="wi-mk" role="group" aria-label="Mistakes to skip"></div></div>
          <div class="an-wi-f"><div class="an-wi-l" id="an-wi-gr-l">Process grade</div><div class="seg sm" data-seg="wi-grade" role="group" aria-labelledby="an-wi-gr-l"></div>
            <div class="an-note ${w.grade ? '' : 'hidden'}" data-el="wi-gnote">Ungraded trades are left out.</div></div>
          <div class="an-wi-f"><label class="check"><input type="checkbox" data-wi="cap" ${w.cap ? 'checked' : ''}> Cap every loss at −1R <span class="dim">(honour the stop)</span></label></div>
          <div class="an-wi-f an-wi-nums">
            <div class="field"><label for="an-wi-best">Drop best trades</label><input id="an-wi-best" class="input sm mono" type="number" min="0" max="${maxDrop}" step="1" value="${Math.min(w.dropBest, maxDrop)}" data-wi="dropBest"></div>
            <div class="field"><label for="an-wi-worst">Drop worst trades</label><input id="an-wi-worst" class="input sm mono" type="number" min="0" max="${maxDrop}" step="1" value="${Math.min(w.dropWorst, maxDrop)}" data-wi="dropWorst"></div></div>
          <div class="an-wi-f"><div class="an-wi-l" id="an-wi-wd-l">Skip weekdays</div><div class="chip-row" data-chips="wi-wd" role="group" aria-labelledby="an-wi-wd-l"></div></div>
          <div class="an-wi-f"><div class="an-wi-l" id="an-wi-se-l">Skip sessions</div><div class="chip-row" data-chips="wi-sess" role="group" aria-labelledby="an-wi-se-l"></div></div>
        </div>
        <div class="an-wi-out" data-el="wi-out"></div>
      </div>`;
    const upd = () => { persist(); drawWhatIfOut(body, v); };
    const mkCh = body.querySelector('[data-chips="wi-mk"]');
    segK(body.querySelector('[data-seg="wi-mk"]'), [{ id: 'keep', label: 'Keep all' }, { id: 'all', label: 'Skip all' }, { id: 'pick', label: 'Pick…' }], w.mk, (id) => { st.wi.mk = id; if (mkCh) mkCh.classList.toggle('hidden', id !== 'pick'); upd(); });
    if (mkCh) {
      if (mkOpts.length) chipsK(mkCh, mkOpts, w.mkIds.filter(id => mkOpts.some(o => o.id === id)), (sel) => { st.wi.mkIds = sel; upd(); });
      else mkCh.innerHTML = '<span class="dim">No mistakes are tagged in this view.</span>';
    }
    segK(body.querySelector('[data-seg="wi-grade"]'), [{ id: '', label: 'Any' }, { id: 'B', label: 'A + B' }, { id: 'A', label: 'A only' }], w.grade, (id) => { st.wi.grade = id; const gn = body.querySelector('[data-el="wi-gnote"]'); if (gn) gn.classList.toggle('hidden', !id); upd(); });
    const cap = body.querySelector('[data-wi="cap"]');
    if (cap) cap.onchange = () => { st.wi.cap = cap.checked; upd(); };
    body.querySelectorAll('input[data-wi="dropBest"], input[data-wi="dropWorst"]').forEach(inp => {
      inp.onchange = () => { const x = clampN(Math.round(parseFloat(inp.value) || 0), 0, maxDrop); inp.value = String(x); st.wi[inp.dataset.wi] = x; upd(); };
    });
    chipsK(body.querySelector('[data-chips="wi-wd"]'), Metrics.WEEKDAYS.map(d => ({ id: d, label: d })), w.wd, (sel) => { st.wi.wd = sel; upd(); });
    chipsK(body.querySelector('[data-chips="wi-sess"]'), Metrics.sessionList().map(x => ({ id: x.key, label: x.key, title: x.label })), w.sess, (sel) => { st.wi.sess = sel; upd(); });
    const rs = body.querySelector('[data-wi="reset"]');
    if (rs) rs.onclick = () => { st.wi = blankWhatIf(); persist(); redrawTab('[data-wi="reset"]'); };
    drawWhatIfOut(body, v);
  }
  function drawWhatIfOut(body, v) {
    const out = body.querySelector('[data-el="wi-out"]'); if (!out) return;
    const { gs, s, ctx } = v, T = tk();
    const sc = scenario(gs), active = Object.keys(sc).length > 0;
    // only the latest scenario is kept (resize/unit re-renders reuse it; toggles recompute)
    const wkey = JSON.stringify(sc);
    if (active && !(v.extra.wi && v.extra.wi.key === wkey)) { const l = Metrics.whatIf(gs, sc); v.extra.wi = { key: wkey, list: l, h: Metrics.summary(l, ctx) }; }
    const sim = active ? v.extra.wi : null;
    const list = sim ? sim.list : gs, h = sim ? sim.h : s;
    const a0 = totalObj(gs), h0 = totalObj(list);
    const dCell = (d, fmt) => (isNum(d) && Math.abs(d) > 1e-9 ? `<span class="${plClass(d)}">${glyph(d)} ${fmt(d)}</span>` : '<span class="dim">—</span>');
    const nd = h.n - s.n;
    const rowsT = [
      ['Trades', String(s.n), String(h.n), nd ? `<span class="dim">${nd > 0 ? '+' : MINUS}${Math.abs(nd)}</span>` : '<span class="dim">—</span>'],
      [unitWord(), plHtml(a0), plHtml(h0), dCell(isNum(unitVal(h0)) && isNum(unitVal(a0)) ? unitVal(h0) - unitVal(a0) : null, (d) => fmtU(d))],
      ['Expectancy', fmtR(s.expR), fmtR(h.expR), dCell(isNum(h.expR) && isNum(s.expR) ? h.expR - s.expR : null, (d) => fmtR(d))],
      ['Win rate', P0(s.winRate), P0(h.winRate), dCell(isNum(h.winRate) && isNum(s.winRate) ? h.winRate - s.winRate : null, (d) => `${Math.abs(Math.round(d * 100))} pts`)],
      ['Profit factor', pfTxt(s.profitFactor), pfTxt(h.profitFactor), dCell(isNum(h.profitFactor) && isNum(s.profitFactor) ? h.profitFactor - s.profitFactor : null, (d) => Math.abs(d).toFixed(2))],
      v.pctOk ? ['Max drawdown', fmtPct(s.maxDDPct, { dp: 1 }), fmtPct(h.maxDDPct, { dp: 1 }), dCell(h.maxDDPct - s.maxDDPct, (d) => `${Math.abs(d * 100).toFixed(1)} pts`)]
        : ['Max drawdown ($)', money(s.maxDD$, { sign: true }), money(h.maxDD$, { sign: true }), dCell(h.maxDD$ - s.maxDD$, (d) => `<span class="money">${fmtMoney(Math.abs(d))}</span>`)],
    ];
    const why = [];
    if (sc.excludeMistakes) why.push('The gap is roughly what those mistakes cost — fix the habit rather than filtering the past.');
    if (sc.capLossR) why.push('Capping losses at −1R shows what honouring every stop is worth.');
    if (sc.dropBest) why.push('Dropping your best trades is a fragility test: if the edge vanishes, it rests on a few outliers.');
    if (sc.dropWorst) why.push('Dropping your worst trades only helps if you can name what made them avoidable.');
    if (sc.minGrade) why.push('Grade filters show whether good process pays.');
    if (sc.excludeWeekdays || sc.excludeSessions) why.push('Time filters overfit easily — trust them only with 10+ trades per removed slot.');
    const read = active ? `This scenario moves expectancy from ${fmtR(s.expR)} to ${fmtR(h.expR)}${v.pctOk ? ` and the worst drawdown from ${fmtPct(s.maxDDPct, { dp: 1 })} to ${fmtPct(h.maxDDPct, { dp: 1 })}` : ''}. ${why.join(' ')}` : '';
    const useR = s.rN > 0;
    out.innerHTML = `<div class="card">${title('scale', 'Actual vs what-if', '', active ? '<span class="badge warn sm">HINDSIGHT</span>' : '')}
        ${active ? '' : note('Pick a rule to see how your past results would have looked.')}
        <div class="table-wrap bare"><table class="compact-t an-table an-wi-t"><thead><tr><th scope="col"><span class="sr-only">Measure</span></th><th scope="col" class="num">Actual</th><th scope="col" class="num">What-if</th><th scope="col" class="num">Change</th></tr></thead>
          <tbody>${rowsT.map(r => `<tr><th scope="row">${esc(r[0])}</th><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td></tr>`).join('')}</tbody></table></div>
        ${active && h.n < 20 ? note(`Only ${plural(h.n, 'trade')} left — too few to read.`) : ''}
        ${read ? `<div class="reading">${esc(read)}</div>` : ''}</div>
      <div class="card">${title('trend-up', useR ? 'Cumulative R' : 'Cumulative P/L', '', '')}${box('wi', 'md')}
        ${legend([{ label: 'Actual', color: T.s1 }, { label: 'What-if (hindsight)', color: T.s2, dash: true }])}
        ${note('Removed trades leave the what-if line flat; capped losses are drawn at −1R. No extra fees or slippage are modelled.')}</div>`;
    const hm = new Map(list.map(g => [g.trade.id, g]));
    const A = [0], B = [0], labels = ['Start'];
    let a = 0, b = 0;
    gs.forEach((g, i) => {
      const hv = hm.get(g.trade.id);
      a += useR ? (R(g) || 0) : (g.netPL || 0);
      if (hv) b += useR ? (R(hv) || 0) : (hv.netPL || 0);
      A.push(a); B.push(b); labels.push('#' + (i + 1));
    });
    const { cv, tip } = cvOf(out, 'wi');
    Charts.multi(cv, tip, [{ name: 'Actual', color: T.s1, values: A }, { name: 'What-if', color: T.s2, values: B, dash: true }], labels, {
      fmtY: useR ? (y) => fmtR(y) : (y) => moneyTxt(y), fmtAxis: useR ? (y) => fmtR(y, Math.abs(y) < 10 ? 1 : 0) : (y) => View.axisMoney(y), baseline: 0,
    });
    Charts.label(cv, `Cumulative ${useR ? 'R' : 'P/L'} over ${plural(gs.length, 'trade')}: actual ${useR ? fmtR(a) : moneyTxt(a)}, what-if ${useR ? fmtR(b) : moneyTxt(b)}.`);
  }

  /* ═══ Paper vs Live ════════════════════════════════════ */
  // Entry slippage in R: the fill vs the planned entry price (trade form → Advanced), measured against the
  // planned stop distance. Positive = a worse fill than planned. Paper fills are usually perfect, live ones are not.
  function slipR(list) {
    const xs = list.map(g => {
      const e = g.trade, pe = e.plannedEntry, en = e.entryPrice, sp = e.stopPrice;
      if (![pe, en, sp].every(isNum) || !(pe > 0) || pe === sp) return null;
      return ((en - pe) * (g.side === 'short' ? -1 : 1)) / Math.abs(pe - sp);
    }).filter(isNum);
    return { n: xs.length, avg: meanOf(xs) };
  }
  const slipCell = (x) => (x.n ? `<span class="${plClass(-x.avg)}">${fmtR(-x.avg)}</span><small>${plural(x.n, 'trade')} with a planned entry</small>` : '<span class="dim">—</span><small>no planned entries</small>');
  function tabCompare(body, v) {
    const f = filterObj();
    const data = cached(v, 'cmp', () => {
      const pc = computeFor('paper'), lc = computeFor('live');
      const pg = Metrics.filterGroups(pc.groups, f), lg = Metrics.filterGroups(lc.groups, f);
      const lctx = metricsCtx(lc, 'live');
      // The ramp judges ALL live trades of the stage against ALL paper trades after costs — the same
      // inputs Readiness uses, so both pages always suggest the same step
      const paperAllCost = Metrics.mean(Metrics.filterGroups(pc.groups, {}).map(g => Metrics.haircut(g, S().costs).R).filter(isNum));
      return {
        pg, lg, lctx, cmp: Metrics.compare(pg, lg, metricsCtx(pc, 'paper')), liveAdh: Metrics.adherence(lg, lctx), liveAll: Metrics.filterGroups(lc.groups, {}),
        paperAllCost, paperOk: balanceMeasurable(pc), liveOk: balanceMeasurable(lc), slipP: slipR(pg), slipL: slipR(lg),
      };
    });
    const { pg, lg, cmp } = data, a = cmp.a, b = cmp.b;
    const ddCell = (x, ok) => (ok ? `<span class="${x.maxDDPct < 0 ? 'neg' : ''}">${fmtPct(x.maxDDPct, { dp: 1 })}</span>` : `${money(x.maxDD$, { sign: true })}<small>no starting balance — $ only</small>`);
    const demo = db.mode === 'demo' ? `<div class="banner info"><svg aria-hidden="true"><use href="#i-info"/></svg><div class="grow">You are in the demo account — this tab compares your real <b>Paper</b> and <b>Live</b> journals.</div></div>` : '';
    if (!pg.length && !lg.length) {
      body.innerHTML = `${demo}<div class="card">${emptyHtml('Nothing to compare yet', `This tab puts your Paper and Live accounts side by side — win rate, expectancy, costs and drawdown — once both have closed trades${extraFilters() || st.f.preset !== 'all' ? ' that match the current filter' : ''}.`, [])}</div>`;
      return;
    }
    const early = a.rN < 30 || b.rN < 30;
    const both = (label, pa, pb, tipH) => `<tr><th scope="row">${esc(label)}${tipH || ''}</th><td class="num">${pa}</td><td class="num">${pb}</td></tr>`;
    const wr = (x) => `${P0(x.winRate)}${x.winCI && x.n >= 5 ? `<small>${P0(x.winCI.lo)}–${P0(x.winCI.hi)}</small>` : ''}`;
    // CI range only from 30 trades with a stop (contract §1.6); 20–29 shows the average alone
    const er = (x) => `<span class="${x.rN >= 20 ? plClass(x.expR) : ''}">${fmtR(x.expR)}</span>${x.rN >= 30 ? `<small>${x.ci95 ? ciTxt(x.ci95) : `${x.rN} with a stop`}</small>` : x.rN >= 20 ? `<small>${x.rN} with a stop · confirm at 30+ trades</small>` : x.rN ? `<small>early · ${x.rN} with a stop</small>` : ''}`;
    const tr = cmp.transfer;
    let trHtml;
    if (!lg.length) trHtml = gate('Needs live trades', 'Once you trade live, this shows how much of your paper edge survives real money.');
    else if (!pg.length) trHtml = gate('Needs paper trades', 'There are no paper trades in this view to compare your live results with.');
    else if (!isNum(cmp.paperAfterCost)) trHtml = note('Paper trades need a stop so their R can be compared with live.');
    else if (!(cmp.paperAfterCost > 0)) trHtml = note('Your paper expectancy after fees & slippage is not positive, so there is no paper edge to carry over yet.');
    else if (!isNum(tr)) trHtml = note('Live trades need a stop so their R can be compared with paper.');
    else {
      // one verdict scale for every page: Metrics.TRANSFER / transferVerdict (as Readiness)
      const tv = Metrics.transferVerdict(tr), hiT = Metrics.TRANSFER[0][0], loT = Metrics.TRANSFER[1][0];
      const band = { good: ['pos', 'Good transfer', 'Live keeps most of the paper edge.'], decay: ['warn-c', 'Typical decay', 'Some edge is lost to execution, slippage and nerves — common when moving to real money.'], investigate: ['neg', 'Investigate', 'Live keeps little of the paper edge. Compare mistakes, costs and position sizes between the two accounts.'] }[tv.key];
      trHtml = `<div class="an-big ${band[0]}">${X2(tr)}</div>
        <div class="an-big-s"><b class="${band[0]}">${esc(band[1])}</b> — live expectancy ${fmtR(b.expR)} ÷ paper after costs ${fmtR(cmp.paperAfterCost)}. ${esc(band[2])}</div>
        <div class="an-scale"><span class="${tv.key === 'good' ? 'on' : ''}">≥ ${hiT} good</span><span class="${tv.key === 'decay' ? 'on' : ''}">${loT}–${hiT} typical decay</span><span class="${tv.key === 'investigate' ? 'on' : ''}">&lt; ${loT} investigate</span></div>
        ${early ? note('Fewer than 30 trades with a stop in at least one account — treat this as a first impression.') : ''}`;
    }
    const w = cmp.welch;
    let wHtml;
    if (!w) wHtml = note('Needs at least 2 trades with a stop in each account.');
    else {
      const d = w.diff, sig = w.p < 0.05, gapTxt = `Live averages <b>${R1(Math.abs(d))}</b> ${d < 0 ? 'less' : 'more'} per trade than paper`;
      // Below 30 trades with a stop on either side the test is not read: t/p dimmed, no verdict either way.
      // From 30 a side, neutral wording — a p-value never makes a gap "probably real".
      wHtml = early
        ? `<div class="reading">${gapTxt} <span class="dim">(t = ${fixed(w.t, 2)}, p = ${pTxt(w.p)} — needs 30+ trades a side)</span>.</div>
        ${note('With fewer than 30 trades with a stop in either account small samples swing widely, so the test is not read yet — no verdict either way.')}`
        : `<div class="reading">${gapTxt} (t = ${fixed(w.t, 2)}, p = ${pTxt(w.p)}). ${sig ? 'A gap this large is unlikely to be chance alone if both accounts had the same true edge — compare execution, costs and discipline between them.' : 'A gap this size is consistent with no real difference between paper and live — chance alone could produce it.'}</div>`;
    }
    const ramp = S().ramp || {};
    let rampHtml;
    if (!ramp.enabled) rampHtml = `${note('The staged live ramp is off — your full max risk applies in live mode.')}<button type="button" class="btn btn-ghost btn-sm" data-act="risk-settings">Risk settings</button>`;
    else {
      // the real cap is the stage size or the max-risk rule, whichever is smaller (as in Readiness)
      const maxR = isNum(S().risk.maxRiskPct) && S().risk.maxRiskPct > 0 ? S().risk.maxRiskPct : 1;
      const stage = clampN(Math.round(ramp.stage || 1), 1, 4), cap = Math.min(maxR, RAMP_STAGES[stage]);
      const sinceRaw = isNum(ramp.stageStartAt) ? ramp.stageStartAt : ramp.stageStartAt ? Date.parse(ramp.stageStartAt) : null;
      const since = isNum(sinceRaw) ? sinceRaw : null;
      let rsx = Metrics.rampStatus(data.liveAll, stage, since, data.paperAllCost, { ...data.lctx, riskPerTradePct: cap });
      // No live balance: the drawdown % (and every promote / step-back call built on it) is meaningless
      if (!data.liveOk) rsx = { ...rsx, dd: null, action: 'hold' };
      const ACT = { hold: ['', 'Hold at this size'], promote: ['pos', '▲ Ready to step up'], demote: ['warn-c', '▼ Step back a stage'], backToPaper: ['neg', '▼ Back to paper'] }[rsx.action] || ['', '—'];
      rampHtml = `<div class="an-ramp" role="list" aria-label="Ramp stages">${[1, 2, 3, 4].map(i => `<span role="listitem" class="an-ramp-s ${i < stage ? 'done' : i === stage ? 'on' : ''}"${i === stage ? ' aria-current="step"' : ''}><b>${i}</b>${RAMP_STAGES[i]}%</span>`).join('')}</div>
        <div class="stat-rows">
          ${row('Current stage', `${stage} of 4`, { tip: tipSafe('rampStage', 'Live risk starts small and grows one stage per 25 good live trades.'), small: `risk capped at ${cap}% per trade` })}
          ${row('Live trades at this stage', String(rsx.n), { small: rsx.need ? `${rsx.need} more until the next review` : 'review due' })}
          ${row('Drawdown at this stage', fmtPct(rsx.dd, { dp: 1 }), { cls: isNum(rsx.dd) && rsx.dd <= -0.05 ? 'neg' : '', small: data.liveOk ? '' : 'set a live starting balance to measure it' })}
          ${row('Suggested action', `<span class="${ACT[0]}">${esc(ACT[1])}</span>`)}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="readiness">Open the ramp plan</button>`;
    }
    body.innerHTML = `${demo}
      <div class="an-g an-g-bd">
        <div class="card">${title('columns', 'Side by side', '', 'same filter on both accounts')}
          <div class="table-wrap bare"><table class="compact-t an-table an-pv"><thead><tr><th scope="col"><span class="sr-only">Measure</span></th><th scope="col" class="num">Paper</th><th scope="col" class="num">Live</th></tr></thead><tbody>
            ${both('Closed trades', confBadge(a.n), confBadge(b.n))}
            ${both('Win rate', wr(a), wr(b))}
            ${both('Expectancy (net R)', er(a), er(b), tipSafe('expR', 'Average net R per trade.'))}
            ${both('After fees & slippage', `<span class="${plClass(cmp.paperAfterCost)}">${fmtR(cmp.paperAfterCost)}</span><small>paper haircut</small>`, '<span class="dim">real fills</span>', tipSafe('haircut', 'Paper results with realistic fees and slippage subtracted.'))}
            ${both('Profit factor', `${pfTxt(a.profitFactor)}${a.pfReliable ? '' : '<small>early</small>'}`, `${pfTxt(b.profitFactor)}${b.pfReliable ? '' : '<small>early</small>'}`)}
            ${both('Avg cost per trade', R1(costRof(pg)), R1(costRof(lg)))}
            ${data.slipP.n || data.slipL.n ? both('Avg entry slippage', slipCell(data.slipP), slipCell(data.slipL), tipSafe('slippage', 'How far your fill was from the price you planned, in R. A negative number is a worse fill than planned.')) : ''}
            ${both('Max drawdown', ddCell(a, data.paperOk), ddCell(b, data.liveOk))}
            ${both('Rule adherence', P0(a.adherence.pct), P0(data.liveAdh.pct), tipSafe('adherence', 'Share of trades that followed every rule.'))}
          </tbody></table></div></div>
        <div class="card">${title('trend-up', 'How much edge survives?', tipSafe('transfer', 'Live expectancy divided by paper expectancy after costs.'), '')}${trHtml}</div>
      </div>
      <div class="an-g an-g2">
        <div class="card">${title('scale', 'Is the gap real?', tipSafe('welch', 'Welch’s t-test compares the average R of the two accounts.'), early ? confBadge(Math.min(a.rN, b.rN), 'trades with a stop (smaller account)') : '')}${wHtml}</div>
        <div class="card">${title('shield', 'Live ramp', '', ramp.enabled ? `stage ${clampN(Math.round(ramp.stage || 1), 1, 4)} of 4` : 'off')}${rampHtml}</div>
      </div>`;
    const ra = body.querySelector('[data-act="readiness"]');
    if (ra) ra.onclick = () => { const Rd = mod(() => Readiness); if (Rd && Rd.show) Rd.show('ramp'); else goPage('readiness', 'Readiness'); };
    const rk = body.querySelector('[data-act="risk-settings"]');
    if (rk) rk.onclick = () => { const St = mod(() => Settings); if (St && St.show) St.show('risk'); else goPage('settings', 'Settings'); };
  }

  /* ═══ Advanced (collapsed explanations) ════════════════ */
  function sqnScale(sqn) {
    const B = [['< 1.6', 'poor'], ['1.6–2', 'below avg'], ['2–2.5', 'average'], ['2.5–3', 'good'], ['3–5', 'excellent'], ['5–7', 'superb'], ['7+', 'check data']];
    const idx = isNum(sqn) ? Metrics.SQN_SCALE.findIndex(x => sqn < x[0]) : -1;
    return `<div class="an-sqn" role="list" aria-label="Van Tharp SQN scale">${B.map((b, i) => `<span role="listitem" class="an-sqn-b ${i === idx ? 'on' : ''}"${i === idx ? ' aria-current="true"' : ''}><b>${esc(b[0])}</b>${esc(b[1])}</span>`).join('')}</div>`;
  }
  // open explanations survive re-renders (unit switch, resize, a commit elsewhere)
  const advOpen = new Set();
  function advItem(o) {
    return `<details class="an-adv ${o.gated ? 'gated' : ''}" data-adv="${o.key}"${advOpen.has(o.key) ? ' open' : ''}><summary><span class="an-adv-n">${esc(o.name)}</span><span class="an-adv-v ${o.gated ? '' : o.cls || ''}">${o.gated ? esc(o.gateTxt) : o.value}</span></summary>
      <div class="an-adv-b">${o.body}${o.key ? `<button type="button" class="link-btn an-adv-more" data-learn="${o.key}">More in Learn → Metrics</button>` : ''}</div></details>`;
  }
  function tabAdvanced(body, v) {
    const { s } = v;
    const band = isNum(s.sqn) ? (Metrics.SQN_SCALE.find(x => s.sqn < x[0]) || [0, ''])[1] : '';
    const fr = s.fragility || {};
    const fragile = isNum(s.expR) && s.expR > 0 && [fr.drop1, fr.drop2, fr.drop3].some(x => isNum(x) && x <= 0);
    const bc = s.bootCI;
    const sharpeNoise = isNum(s.sharpe) && isNum(s.sharpeSE) && s.sharpeSE >= Math.abs(s.sharpe);
    const noBal = 'needs a starting balance';
    const items = [
      { key: 'sqn', name: 'System Quality Number (SQN)', gated: s.sqnGated || !isNum(s.sqn), gateTxt: `needs 30 trades with a stop (${s.rN})`,
        value: `${fixed(s.sqn, 2)} · ${esc(band)}`, cls: s.sqn >= 2 ? 'pos' : '',
        body: `<p>SQN = √N × average R ÷ standard deviation of R — the expectancy t-statistic in Van Tharp's packaging.</p>${sqnScale(s.sqn)}
          <p class="an-small">The √N part is capped at 100 trades (Van Tharp's rule), because otherwise SQN rises just from adding trades. Uncapped: ${fixed(s.sqnRaw, 2)}. Values of 7+ usually mean too little data or an error.</p>` },
      { key: 'tStat', name: 't-statistic & p-value', gated: s.sqnGated || !isNum(s.tStat), gateTxt: `needs 30 trades with a stop (${s.rN})`,
        value: `t = ${fixed(s.tStat, 2)} · p = ${pTxt(s.pValue)}`, cls: s.tStat >= 2 ? 'pos' : '',
        body: `<p>A one-tailed test of “my average net R is above zero”.${isNum(s.pValue) && !s.sqnGated ? ` p = ${pTxt(s.pValue)} means: if your true edge were zero, a result at least this good would turn up ${pctWords(s.pValue)} by luck alone.` : ''} It is <b>not</b> the probability that your edge is random.</p>
          <p>${s.ci95 && !s.sqnGated ? `95% range for your average: ${ciTxt(s.ci95)} — ${s.ci95.lo > 0 ? 'above zero, so the edge is distinguishable from nothing.' : 'it includes zero, so the result is consistent with no edge.'}` : ''}${isNum(s.tradesNeeded) && s.tradesNeeded > 0 ? ` About ${s.tradesNeeded} more trades at this edge would settle it (t ≈ 2).` : ''}</p>
          <p class="an-small">Assumes independent, roughly bell-shaped trades. Crypto results have fat tails, so check the bootstrap range too.</p>` },
      { key: 'ci', name: 'Bootstrap range of your average', gated: s.rN < 30 || !bc, gateTxt: `needs 30 trades with a stop (${s.rN})`,
        value: bc ? `likely ${fmtR(bc.lo)} to ${fmtR(bc.hi)}` : '—', cls: bc && bc.lo > 0 ? 'pos' : '',
        body: `<p>Your trades resampled 2,000 times with replacement; the middle 95% of the resampled averages is the range shown.${bc && s.rN >= 30 ? ` ${P0(bc.pPos)} of resampled averages were above zero.` : ''} ${!bc || s.rN < 30 ? '' : bc.lo <= 0 ? 'The range includes zero — consistent with no edge yet.' : 'The whole range is above zero.'}</p>
          <p class="an-small">Unlike the t-test it does not assume bell-shaped results, which suits fat-tailed crypto R.</p>` },
      { key: 'sharpe', name: 'Sharpe ratio (daily, × √365)', gated: !isNum(s.sharpe) || !v.pctOk, gateTxt: v.pctOk ? `needs 30 calendar days (${s.spanDays})` : noBal,
        value: `${fixed(s.sharpe, 2)} ± ${fixed(s.sharpeSE, 2)}`, cls: sharpeNoise ? 'dim' : '',
        body: `<p>Average daily return ÷ its standard deviation, counting every calendar day (crypto never closes), annualised with √365. “±” is the standard error (Lo 2002).</p>
          <p>${sharpeNoise ? '<b>The uncertainty is as large as the value itself — not meaningful yet.</b> ' : ''}Rough scale: below 0 losing · 0–1 subpar · 1–2 good · 2–3 very good · above 3 suspicious on a short history.</p>` },
      { key: 'sortino', name: 'Sortino ratio', gated: !isNum(s.sortino) || !v.pctOk, gateTxt: v.pctOk ? `needs 30 calendar days (${s.spanDays})` : noBal,
        value: fixed(s.sortino, 2), cls: '',
        body: '<p>Like Sharpe, but only downside days count as risk (target downside deviation over all days). Usually higher than Sharpe when winners are larger than losers. Read on the same scale; its uncertainty is at least as large as Sharpe’s.</p>' },
      { key: 'ulcer', name: 'Ulcer index', gated: !isNum(s.ulcer) || !v.pctOk, gateTxt: v.pctOk ? `needs 90 calendar days (${s.spanDays})` : noBal,
        value: fixed(s.ulcer, 1), cls: '',
        body: '<p>Root-mean-square of the daily drawdown in % — it punishes drawdowns that are deep <i>and</i> long. Lower is better; it is most useful for comparing periods of your own trading.</p>' },
      { key: 'retToDD', name: isNum(s.cagr) ? 'CAGR & MAR ratio' : 'Return ÷ max drawdown', gated: !v.pctOk, gateTxt: noBal,
        value: isNum(s.cagr) ? `CAGR ${fmtPct(s.cagr, { sign: true, dp: 1 })} · MAR ${fixed(s.mar, 2)}` : X2(s.retToDD), cls: '',
        body: isNum(s.cagr) ? `<p>Annualised growth from ${s.spanDays} days of history, and MAR = CAGR ÷ max drawdown. Above 1 is decent, above 2 strong.</p>`
          : `<p>Annualised CAGR and MAR appear after 180 days of history (you have ${s.spanDays}) — annualising a short history gives absurd numbers. Until then: total return ${fmtPct(s.totalReturn, { sign: true, dp: 1 })} ÷ max drawdown ${fmtPct(s.maxDDPct, { dp: 1 })}.</p>` },
      { key: 'kelly', name: 'Kelly — edge strength, not a position size', gated: s.kellyGated, gateTxt: `needs 200 trades (${s.n})`,
        value: !isNum(s.kelly) ? '—' : s.kelly <= 0 ? 'no positive edge yet' : `${P0(s.kelly)} (pessimistic ${P0(s.kellyPess)})`, cls: '',
        body: `<p><b>Never use this to size trades.</b> Kelly = win rate − loss rate ÷ payoff. It is shown only as a measure of how strong the edge is; the pessimistic value uses the low end of your win-rate range.</p>
          <p class="an-small">Full-Kelly bets are far too large for real trading, and small errors in the inputs make them dangerous. Keep risk at 0.5–1% per trade regardless.</p>` },
      { key: 'fragility', name: 'Fragility — without your best trades', gated: s.rN < 10, gateTxt: `needs 10 trades with a stop (${s.rN})`,
        value: `${fmtR(fr.drop1)} · ${fmtR(fr.drop2)} · ${fmtR(fr.drop3)}`, cls: fragile ? 'neg' : '',
        body: `<p>Expectancy after removing your single best trade, best 2 and best 3.${fragile ? ' <b>Your edge depends on a few outliers</b> — without them it disappears.' : isNum(s.expR) && s.expR > 0 ? ' It survives losing your best trades, which is a good sign.' : ''}</p>` },
      // with a handful of winners "top 3 = 100% of profit" is arithmetic, not a finding
      { key: 'bestDayShare', name: 'Concentration of profit', gated: s.n < 20, gateTxt: `needs 20 trades (${s.n})`,
        value: `top 3 trades ${P0(s.top3Share)} · best day ${P0(s.bestDayShare)}`, cls: s.top3Share > 0.5 || s.bestDayShare > 0.5 ? 'warn-c' : '',
        body: `<p>How much of your profit came from your three best trades (${P0(s.top3Share)} of net profit) and from your single best day (${P0(s.bestDayShare)} of all green-day profit). Above 50% means results hinge on a few lucky moments; consistent traders keep the best day under half.</p>` },
      // below 20 trades the spread itself is unreliable: 2–3 lucky trades would "need 0 more"
      { key: 'tradesNeeded', name: 'Trades still needed', gated: !isNum(s.tradesNeeded) || s.rN < 20, gateTxt: isNum(s.expR) && s.expR <= 0 ? 'no positive edge to confirm' : `needs 20 trades with a stop (${s.rN})`,
        value: s.tradesNeeded > 0 ? `~${s.tradesNeeded} more` : 'enough to confirm', cls: '',
        body: '<p>How many more trades at your current average and spread it would take for the edge to reach t ≈ 2 — the usual bar for “probably not luck”. It changes as your results change.</p>' },
    ];
    const half = Math.ceil(items.length / 2);
    body.innerHTML = `
      <div class="card an-intro">${title('flask', 'Advanced statistics', '', confBadge(s.rN, 'trades with a stop'))}
        <div class="card-sub">For curiosity and later. Most of these need far more trades than a beginner has — each one says when it becomes meaningful. Expectancy with its range, drawdown and discipline matter more right now. Select a row for the explanation.</div></div>
      <div class="an-g an-g2 an-advs"><div class="an-adv-col">${items.slice(0, half).map(advItem).join('')}</div><div class="an-adv-col">${items.slice(half).map(advItem).join('')}</div></div>`;
    body.querySelectorAll('details[data-adv]').forEach(d => d.addEventListener('toggle', () => { if (d.open) advOpen.add(d.dataset.adv); else advOpen.delete(d.dataset.adv); }));
  }

  /* ── Registration & public API ─────────────────────────── */
  const TAB_FN = { overview: tabOverview, risk: tabRisk, timing: tabTiming, process: tabProcess, efficiency: tabEfficiency, scenarios: tabScenarios, compare: tabCompare, advanced: tabAdvanced };
  Pages.register('analytics', {
    title: 'Analytics',
    sub: () => { const n = C ? C.closedGroups.length : 0; return `${plural(n, 'closed trade')} · ${db.mode} account — every number with its uncertainty, in plain language`; },
    render,
    onLeave() { mcToken++; },
  });
  // Analytics.show(tab, filter): tab ids above (aliases ok); a filter object (even {}) replaces the current one
  function show(tab, filter) {
    const t = TAB_ALIAS[tab] || tab;
    if (TABS.some(x => x.id === t)) st.tab = t;
    if (filter && typeof filter === 'object') st.f = normFilter(filter);
    persist();
    // already here (palette, an in-page link): just swap tab/filter, without a page cross-fade
    Router.go('analytics', { instant: Router.active === 'analytics' });
  }
  return { show };
})();
