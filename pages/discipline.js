/* ═══════════════════════════════════════════════════════════
   CryptoJournal — Discipline: Playbook · Daily Routine · Backtesting
   Playbook  written setups (rules, pre-trade checklist, min R:R,
             max risk) with live results from the active mode's
             closed trades (net R, sample-size gated), beginner
             templates, archive instead of delete when in use.
   Routine   Prepare / Trade / Reflect weekly grid. The v1 data format
             is kept so old ticks survive:
             routine.weeks['YYYY-MM-DD' local Monday][taskId] = [7 booleans]
             plus streak, 12-week habit heat map and a today panel.
   Backtest  manual backtest log: the v1 points model (pts/1000,
             compounding, fixed-risk info column) and an R mode simulated
             at a chosen risk % (stored in db.backtestR, mirrored to
             db.backtest.rPoints).
   Public:   Discipline.editStrategy(id|null, {prefill, onSave}),
             checklistFor(id), activeStrategies(), routineProgress(key?),
             openTemplates(), templates()
   ═══════════════════════════════════════════════════════════ */
const Discipline = (() => {
  'use strict';

  /* ── Shared helpers ─────────────────────────────────────── */
  const isN = (v) => typeof v === 'number' && isFinite(v);
  const isRec = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : null);
  const lines = (v) => String(v == null ? '' : v).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const strList = (a) => (Array.isArray(a) ? a.map(x => String(x == null ? '' : x).trim()).filter(Boolean) : []);
  const pctTxt = (v) => (isN(v) ? Math.round(v * 100) + '%' : '—');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const ic = (id, sz) => `<svg width="${sz || 14}" height="${sz || 14}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const modeName = () => ({ paper: 'Paper', live: 'Live', demo: 'Demo' }[db.mode] || 'Paper');
  const comp = () => C || (typeof recompute === 'function' ? recompute() : null);
  const hasMetrics = () => typeof Metrics !== 'undefined';
  const tokens = () => (typeof Charts !== 'undefined' ? Charts.tokens() : {});
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* preference only */ } }
  // P/L carries sign + colour + glyph, so colour is never the only cue
  const plSpan = (v, inner) => `<span class="${plClass(v)}">${glyph(v) ? `<span aria-hidden="true">${glyph(v)}</span> ` : ''}${inner}</span>`;
  const kpi = (lbl, val, sub, cls, tip) => `<div class="kpi ${cls || ''}"><div class="k-lbl">${lbl}${tip || ''}</div><div class="k-val">${val}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;

  // Renders rebuild innerHTML, so the control that triggered a commit is re-focused by its data-fk key.
  let pendingFocus = null;
  function restoreFocus(root) {
    const key = pendingFocus; pendingFocus = null;
    if (!key || !root) return;
    const el = [...root.querySelectorAll('[data-fk]')].find(x => x.dataset.fk === key);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }
  // Re-renders we did not ask for (window resize, another tab's save) must not drop keyboard focus to <body>
  function keepFocus(root) {
    if (pendingFocus || !root) return;
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a) && a.dataset && a.dataset.fk) pendingFocus = a.dataset.fk;
  }
  const focusSel = (root, sel) => { const el = root && root.querySelector(sel); if (el) el.focus({ preventScroll: true }); };
  // commit() → false: the write never reached disk (save() already said why). Undo the in-memory change and
  // re-render, so the screen (and the next successful save) never carries what the user was told failed.
  function rollback(undo, fk) { undo(); pendingFocus = fk || null; refresh(); }
  // A modal action commits BEFORE closing, so a failed write keeps the dialog open (rolled back, focus back in it).
  // On success the dialog closes and focus lands where pendingFocus pointed — close() alone returns it to the opener.
  function commitModal(close, msg, undo) {
    const fk = pendingFocus, back = document.activeElement;
    if (!commit(msg)) {
      rollback(undo);
      if (back && back !== document.body && back.isConnected) back.focus({ preventScroll: true });
      return false;
    }
    close(true);
    if (fk) { pendingFocus = fk; restoreFocus(document.querySelector(`.page[data-page="${Router.active}"]`)); }
    return true;
  }
  // 'change' fires before focus moves (Tab): commit on the next tick and keep the newly focused control.
  // A mouse press also blurs the field first — re-rendering before mouseup would replace the pressed button
  // and swallow its click (e.g. edit "Starting account", then click Add), so wait for the release.
  let ptrDown = false;
  document.addEventListener('pointerdown', () => { ptrDown = true; }, true);
  document.addEventListener('pointerup', () => { ptrDown = false; }, true);
  document.addEventListener('pointercancel', () => { ptrDown = false; }, true);
  function commitKeep(msg) {
    const run = () => setTimeout(() => { const a = document.activeElement; pendingFocus = a && a.dataset ? a.dataset.fk || null : null; commit(msg); }, 0);
    if (!ptrDown) { run(); return; }
    // whichever comes first — release, cancel (touch scroll) or a fallback — commits exactly once, so the edit is never left unsaved
    let done = false, t = 0;
    const go = () => {
      if (done) return; done = true; clearTimeout(t);
      document.removeEventListener('pointerup', go, true); document.removeEventListener('pointercancel', go, true);
      run();
    };
    document.addEventListener('pointerup', go, true); document.addEventListener('pointercancel', go, true);
    t = setTimeout(go, 1500);
  }
  // Arrow keys move a line chart's crosshair (Charts.line() does not wire it itself). h = Charts.line() handle or null.
  function keyNav(cv, h) {
    if (!cv || !h || !(h.count > 0)) return;
    if (typeof Charts !== 'undefined' && typeof Charts.keyNav === 'function') { Charts.keyNav(cv, h.count, h.hover); return; }
    let i = -1; cv.tabIndex = 0;   // fallback for an older charts.js without a public keyNav
    cv.onkeydown = (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(ev.key)) return;
      ev.preventDefault();
      if (ev.key === 'Escape') { i = -1; h.hover(null); return; }
      i = ev.key === 'Home' ? 0 : ev.key === 'End' ? h.count - 1 : Math.max(0, Math.min(h.count - 1, (i < 0 ? h.count - 1 : i) + (ev.key === 'ArrowLeft' ? -1 : 1)));
      h.hover(i);
    };
    cv.onblur = () => { if (i >= 0) { i = -1; h.hover(null); } };
  }

  /* ── Playbook: templates ────────────────────────────────── */
  // Beginner setups with checkable rules (research: write the plan before the trade).
  const TEMPLATES = [
    {
      name: 'Trend pullback (EMA 20/50)',
      blurb: 'Join an existing uptrend after a dip instead of chasing green candles.',
      tf: '4H entries · 1D trend filter', indicators: 'EMA 20 & EMA 50, RSI 14, volume',
      entry: [
        'Daily trend is up: price above the 50 EMA and the 20 EMA above the 50',
        'On the 4H, price pulls back into the zone between the 20 and 50 EMA',
        'RSI (14) cools to 40–55 on the pullback — not below 30',
        'A bullish candle closes in the zone (hammer, engulfing or a higher low)',
        'A stop below the pullback low still gives at least 2R to the recent high',
      ],
      exit: [
        'Stop below the pullback swing low — never move it further away',
        'Take half at 2R and move the stop to breakeven',
        'Trail the rest under the 20 EMA; exit on a 4H close below the 50 EMA',
      ],
      notes: 'Works best in clean trends. Skip it when the daily chart chops around the 50 EMA or BTC is dumping. Spot longs only while you are learning.',
      minRR: 2, patterns: ['bull-flag', 'hammer', 'bull-engulfing'],
    },
    {
      name: 'Range breakout with volume',
      blurb: 'Trade the move out of a tight range — only when volume confirms it.',
      tf: '1H entries · 4H context', indicators: 'Horizontal support/resistance, volume with 20-bar average, ATR 14',
      entry: [
        'A clear range: support and resistance each touched at least twice',
        'A 1H candle closes above resistance — a wick through it does not count',
        'Breakout candle volume is at least 1.5× the 20-bar average',
        'Enter on the close or on the first retest of the broken level',
        'Not chasing: entry within 1 ATR of the breakout level',
      ],
      exit: [
        'Stop back inside the range, below the breakout candle low',
        'Target: the range height added to the breakout level (at least 1.5R)',
        'Exit at once if a candle closes back inside the range — the breakout failed',
      ],
      notes: 'Fake breakouts are common in crypto, especially on weekends and on low volume. Waiting for the retest means fewer trades but better ones.',
      minRR: 1.5, patterns: ['asc-triangle', 'sym-triangle', 'bull-flag'],
    },
    {
      name: 'Support bounce',
      blurb: 'Buy a proven support level after a pullback, with a tight and obvious stop.',
      tf: '4H entries · 1D levels', indicators: 'Horizontal support zones, RSI 14, volume',
      entry: [
        'The support zone has held at least twice before on the 4H or daily chart',
        'Price reaches it after an orderly pullback — not a news crash',
        'A rejection candle closes at support (long lower wick or bullish engulfing)',
        'RSI (14) below 40, or making a higher low while price makes a lower low',
        'The next resistance is at least 2× as far away as the stop',
      ],
      exit: [
        'Stop just below the support zone and the rejection wick',
        'Target: the next resistance level (at least 2R)',
        'Exit if a 4H candle closes below support — the idea is wrong',
      ],
      notes: 'Every test weakens a level, so the 2nd or 3rd touch is best. Avoid alt bounces while BTC is breaking down — alts usually follow BTC.',
      minRR: 2, patterns: ['double-bottom', 'hammer', 'rsi-bull-div'],
    },
  ];

  /* ── Playbook: data helpers ─────────────────────────────── */
  const strategies = () => (Array.isArray(db.strategies) ? db.strategies.filter(isRec) : []);
  const activeStrategies = () => strategies().filter(s => !s.archived);
  // dataset values are strings — compare as strings so hand-edited numeric ids still resolve
  const sById = (id) => (id == null || id === '' ? null : strategies().find(s => String(s.id) === String(id)) || null);
  // Pre-trade checklist for a setup: its own list, else its entry rules (an empty custom list falls back too)
  function checklistFor(id) {
    const s = sById(id);
    if (!s) return [];
    const ck = strList(s.checklist);
    return ck.length ? ck : strList(s.entry);
  }
  // Every reference that would lose its meaning if the strategy vanished (trash and missed trades too).
  // Paper/live references block a delete; demo ones don't — demo data is generated and disposable, and
  // the demo account uses the default playbook, so counting it would make those setups undeletable.
  // Ids compared as strings: a numeric id vs a string strategyId must still count as "in use" (never delete by accident).
  function usageOf(id) {
    const k = String(id), hit = (x) => !!x && x.strategyId != null && String(x.strategyId) === k;
    const out = { real: 0, demo: 0 };
    for (const m of MODES) {
      let n = 0;
      const a = db.accounts && db.accounts[m];
      if (a && Array.isArray(a.entries)) for (const e of a.entries) if (hit(e)) n++;
      const ms = db.missed && db.missed[m];
      if (Array.isArray(ms)) for (const x of ms) if (hit(x)) n++;
      out[m === 'demo' ? 'demo' : 'real'] += n;
    }
    return out;
  }
  function uniqueName(base) {
    const taken = new Set(strategies().map(s => String(s.name || '').trim().toLowerCase()));
    if (!taken.has(base.trim().toLowerCase())) return base;
    for (let k = 2; k < 100; k++) { const n = `${base} ${k}`; if (!taken.has(n.toLowerCase())) return n; }
    return `${base} ${Date.now().toString(36)}`;
  }
  // One pass over the active mode's closed groups (sorted by exit) → per-strategy lists + open counts
  function strategyGroups() {
    const closed = new Map(), open = new Map(), c = comp();
    if (!c) return { closed, open };
    const list = hasMetrics() ? Metrics.filterGroups(c.groups, {}) : c.closedGroups.filter(g => isN(g.exitMs)).sort((a, b) => a.exitMs - b.exitMs);
    // keyed by String(id), like sById/usageOf, so a numeric strategy id still finds its trades
    const kOf = (g) => (g.strategyId == null || g.strategyId === '' ? '' : String(g.strategyId));
    for (const g of list) { const k = kOf(g); if (!closed.has(k)) closed.set(k, []); closed.get(k).push(g); }
    for (const g of c.groups) { const k = kOf(g); if (!g.closed && k) open.set(k, (open.get(k) || 0) + 1); }
    return { closed, open };
  }
  function statFor(list) {
    const n = list.length, wins = list.filter(g => g.win).length, losses = list.filter(g => g.loss).length;
    const rs = list.map(g => g.R).filter(isN);
    const gw = sum(list.filter(g => g.netPL > 0).map(g => g.netPL)), gl = -sum(list.filter(g => g.netPL < 0).map(g => g.netPL));
    let cum = 0, idx = 1; const spark = [0];
    for (const g of list) {
      if (isN(g.R)) { cum += g.R; spark.push(cum); }
      idx *= 1 + (isN(g.changePct) ? g.changePct : 0);   // flow-neutral compounded return
    }
    const grades = list.map(g => g.trade && g.trade.grade).filter(x => x === 'A' || x === 'B' || x === 'C');
    const rules = list.map(g => g.trade && g.trade.rulesMetPct).filter(isN);
    return {
      n, wins, losses, be: n - wins - losses, winRate: n ? wins / n : null,
      pl: sum(list.map(g => (isN(g.netPL) ? g.netPL : 0))), expR: avg(rs), rN: rs.length, cumR: cum, ret: idx - 1,
      pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null), pfReliable: n >= 20 && losses >= 5, spark,
      grades, gScore: grades.length ? avg(grades.map(x => (x === 'A' ? 3 : x === 'B' ? 2 : 1))) : null,
      rulesPct: avg(rules), rulesN: rules.length, groups: list,
    };
  }
  // Per checklist rule: results when it was met vs not met ("which rules pay")
  function ruleStats(list) {
    const m = new Map(); let n = 0;
    for (const g of list) {
      const ck = g.trade && g.trade.checklist;
      if (!ck || !Array.isArray(ck.items) || !ck.items.length) continue;
      n++;
      for (const it of ck.items) {
        if (!it || typeof it.text !== 'string' || !it.text.trim()) continue;
        const r = m.get(it.text) || { text: it.text, met: [], miss: [] };
        (it.met ? r.met : r.miss).push(g); m.set(it.text, r);
      }
    }
    return { rows: [...m.values()], n };
  }

  /* ── Playbook: page ─────────────────────────────────────── */
  let pbView = lsGet('cj.pb.view', 'active') === 'archived' ? 'archived' : 'active';
  const SORTS = [['default', 'Playbook order'], ['n', 'Most traded'], ['exp', 'Best expectancy'], ['pl', 'Best result'], ['name', 'Name A–Z']];
  let pbSort = SORTS.some(x => x[0] === lsGet('cj.pb.sort', 'default')) ? lsGet('cj.pb.sort', 'default') : 'default';
  const pbOpenRs = new Set();   // strategy ids whose "which rules pay" panel is open

  function sortList(list, statOf) {
    const st = (s) => statOf.get(s.id), n = (s) => (st(s) ? st(s).n : 0);
    const exp = (s) => (st(s) && st(s).rN >= 20 && st(s).expR != null ? st(s).expR : null);   // greyed (< 20 with a stop) samples sort last
    // "Best result" follows the topbar unit, so the order matches the value each card shows ($ / % / R)
    const u = S().units;
    const res = (s) => { const x = st(s); return !x ? null : u === 'R' ? (x.rN ? x.cumR : null) : u === '%' ? x.ret : x.pl; };
    const desc = (x, y, tie) => { if (x == null && y == null) return tie; if (x == null) return 1; if (y == null) return -1; return y - x; };
    const by = {
      n: (a, b) => n(b) - n(a),
      exp: (a, b) => desc(exp(a), exp(b), n(b) - n(a)),
      pl: (a, b) => desc(res(a), res(b), 0),
      name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
    }[pbSort];
    return by ? list.slice().sort(by) : list;
  }
  // Result total in the topbar unit ($ / % / R)
  function unitTotal(st) {
    const u = S().units;
    // $ P/L stays visible (privacy-blurred) as the sub line when another unit is selected
    const usd = `<span class="${plClass(st.pl)}">${money(st.pl, { sign: true })}</span> net`;
    if (u === 'R') return { lbl: 'Total R', html: st.rN ? plSpan(st.cumR, esc(fmtR(st.cumR))) : '<span class="dim">—</span>', sub: st.rN ? usd : 'needs stops' };
    if (u === '%') return { lbl: 'Return', html: plSpan(st.ret, esc(fmtPct(st.ret, { sign: true }))), sub: usd };
    return { lbl: 'Net P/L', html: plSpan(st.pl, money(st.pl, { sign: true })), sub: 'after fees' };
  }
  const stat = (lbl, val, gated, sub, tip) => `<div class="pb-stat${gated ? ' gated' : ''}"><div class="pb-sl">${lbl}${tip || ''}</div><div class="pb-sv">${val}</div>${sub ? `<div class="pb-ss">${sub}</div>` : ''}</div>`;
  const ruleList = (arr, cls) => `<ul class="pb-rules">${arr.map(r => `<li class="rule ${cls}"><span class="bullet" aria-hidden="true"></span><span>${esc(r)}</span></li>`).join('')}</ul>`;
  const sec = (lbl, html) => `<div class="pb-sec"><div class="pb-sec-l">${lbl}</div>${html}</div>`;

  function resultsHtml(st, openN, T) {
    if (!st) return `<div class="pb-res empty"><span class="dim">No closed ${modeName()} trades with this setup yet${openN ? ` · ${plural(openN, 'open trade')}` : ''}.</span></div>`;
    // Below 10 trades the whole card is dimmed (per-bucket rule); win rate and expectancy also need 20 (contract §6),
    // so between 10 and 19 they stay dimmed and uncoloured — anecdotes, not evidence.
    // Expectancy averages only trades with a stop, so it is gated on that count (15 trades with 3 stops = 3 data points).
    const n = st.n, thin = n < 10, gWin = n < 20, gExp = st.rN < 20;
    // cumulative R is a P/L series → validated chart up/down marks; flat stays neutral
    const col = st.cumR > 0 ? T.up : st.cumR < 0 ? T.down : T.flat;
    const spark = st.spark.length > 2 && typeof Charts !== 'undefined' ? Charts.spark(st.spark, { w: 112, h: 30, color: col }) : '';
    const rTxt = (v) => (v == null ? '—' : gExp ? esc(fmtR(v)) : plSpan(v, esc(fmtR(v))));
    const wl = `${st.wins}W · ${st.losses}L${st.be ? ` · ${st.be}BE` : ''}`;
    const tot = unitTotal(st);
    const grade = st.gScore == null ? '—' : (() => { const g = st.gScore >= 2.5 ? 'A' : st.gScore >= 1.5 ? 'B' : 'C'; return `<span class="badge grade-${g}">${g}</span>`; })();
    const gCount = ['A', 'B', 'C'].map(g => `${g} ${st.grades.filter(x => x === g).length}`).join(' · ');
    return `<div class="pb-res">
      <div class="pb-res-h"><span class="pb-res-l">${modeName()} results</span>${confBadge(n)}${openN ? `<span class="dim pb-open">+${openN} open</span>` : ''}
        ${spark ? `<span class="pb-spark" title="Cumulative net R, trade by trade">${spark}<span class="sr-only">Cumulative ${esc(fmtR(st.cumR))} over ${plural(st.rN, 'trade')} with a stop.</span></span>` : ''}</div>
      <div class="pb-stats">
        ${stat('Win rate', pctTxt(st.winRate), gWin, gWin ? `${wl} · needs 20+` : wl, tipFor('winRate', 'Share of closed trades that made money after fees.'))}
        ${stat('Expectancy', rTxt(st.expR), gExp, st.rN === 0 ? 'no stops logged' : gExp ? `${st.rN} with a stop · needs 20+` : st.rN < n ? `${st.rN}/${n} with a stop` : 'net R per trade', tipFor('expR', 'Average result per trade in R — multiples of what you risked — after fees.'))}
        ${stat(tot.lbl, tot.html, false, tot.sub)}
        ${stat('Profit factor', st.pfReliable ? esc(fmtPF(st.pf)) : `<span class="dim">${esc(fmtPF(st.pf))}</span>`, !st.pfReliable, st.pfReliable ? 'won ÷ lost' : 'needs 20 trades & 5 losses', tipFor('profitFactor', 'Money won divided by money lost. Above 1 makes money.'))}
        ${stat('Avg grade', grade, false, st.grades.length ? gCount : 'not graded yet', tipFor('grade', 'Process grade A/B/C — did you follow the plan? Kept separate from profit.'))}
        ${stat('Rules met', pctTxt(st.rulesPct), st.rulesN < 10, st.rulesN ? plural(st.rulesN, 'checklist') : 'no checklists yet', infoTip('Average share of this setup’s checklist rules you ticked when logging the trade.'))}
      </div>
      ${thin ? `<div class="pb-gate">Greyed numbers need 10+ closed trades — so far ${n}. Treat them as anecdotes, not evidence.</div>`
        : gWin || gExp ? `<div class="pb-gate">Win rate and expectancy stay greyed until 20 closed trades${gExp && !gWin ? ' with a stop' : ''} — early numbers swing a lot.</div>` : ''}
    </div>`;
  }
  function ruleStatsHtml(s, st) {
    if (!st) return '';
    const rs = ruleStats(st.groups);
    if (!rs.rows.length) return '';
    const cell = (list) => { const e = avg(list.map(g => g.R).filter(isN)); return `<td class="num${list.length < 10 ? ' pb-thin' : ''}">${e == null ? '—' : plSpan(e, esc(fmtR(e)))}<small>n=${list.length}</small></td>`; };
    return `<details class="pb-rs" data-rs="${esc(s.id)}"${pbOpenRs.has(String(s.id)) ? ' open' : ''}>
      <summary>Which rules pay off? <span class="dim">from ${plural(rs.n, 'checklist')}</span></summary>
      <div class="pb-rs-body"><table class="compact-t"><thead><tr><th scope="col">Rule</th><th class="num" scope="col">Met</th><th class="num" scope="col">Not met</th></tr></thead>
        <tbody>${rs.rows.map(r => `<tr><td>${esc(r.text)}</td>${cell(r.met)}${cell(r.miss)}</tr>`).join('')}</tbody></table>
        <div class="hint">Average net R when the rule was ticked vs. skipped. Greyed values rest on fewer than 10 trades.</div></div>
    </details>`;
  }
  function cardHtml(s, st, openN, T) {
    const id = esc(s.id), name = esc(s.name || 'Untitled');
    const entry = strList(s.entry), exit = strList(s.exit), ck = strList(s.checklist);
    const meta = [s.tf, s.indicators].map(x => String(x == null ? '' : x).trim()).filter(Boolean).map(esc).join(' · ');
    const mr = isN(s.minRR) ? s.minRR : 1.5;
    const badges = [
      `<span class="badge cat" title="Minimum reward-to-risk to take this setup">${mr > 0 ? `min ${esc(+mr.toFixed(2))}R` : 'no min R:R'}</span>`,
      isN(s.maxRiskPct) ? `<span class="badge cat" title="Maximum risk per trade for this setup">max ${esc(+s.maxRiskPct.toFixed(2))}% risk</span>` : '',
      s.archived ? '<span class="badge warn">Archived</span>' : '',
    ].join('');
    const rules = [
      entry.length ? sec('Entry criteria', ruleList(entry, 'entry')) : '',
      exit.length ? sec('Exit criteria', ruleList(exit, 'exit')) : '',
      ck.length ? sec(`Pre-trade checklist · ${ck.length}`, ruleList(ck, 'ck')) : entry.length ? `<div class="pb-ck-note dim">Pre-trade checklist: your ${plural(entry.length, 'entry rule')}.</div>` : '',
      s.notes ? sec('Notes', `<p class="pb-notes">${esc(s.notes)}</p>`) : '',
    ].join('');
    const noRules = !entry.length && !exit.length
      ? `<div class="pb-norules">${ic('alert')}<span>No rules written yet. <button type="button" class="link-btn" data-pb="edit" data-id="${id}">Define this setup</button> so every trade follows a plan.</span></div>` : '';
    const pats = Array.isArray(s.patterns) && typeof PATTERNS !== 'undefined' && Array.isArray(PATTERNS)
      ? s.patterns.map(pid => PATTERNS.find(p => p && p.id === pid)).filter(Boolean) : [];
    const patHtml = pats.length ? sec('Chart patterns to study', `<div class="chip-row">${pats.map(p => `<button type="button" class="chip sm" data-pb="pattern" data-pid="${esc(p.id)}">${ic('pattern', 12)}${esc(p.name)}</button>`).join('')}</div>`) : '';
    return `<article class="card strategy-card pb-card${s.archived ? ' is-arch' : ''}" aria-label="${name}">
      <header class="pb-head"><div class="pb-hl"><h3 class="pb-name">${name}</h3>${meta ? `<div class="pb-meta">${meta}</div>` : ''}</div><div class="pb-badges">${badges}</div></header>
      ${resultsHtml(st, openN, T)}${noRules}${rules}${ruleStatsHtml(s, st)}${patHtml}
      <div class="pb-acts">
        <button type="button" class="btn btn-ghost btn-xs" data-pb="edit" data-id="${id}" data-fk="pb-edit-${id}" data-fid="pb-edit-${id}" aria-label="Edit ${name}">${ic('edit', 13)}Edit</button>
        <button type="button" class="btn btn-ghost btn-xs" data-pb="dup" data-id="${id}" aria-label="Duplicate ${name}">${ic('copy', 13)}Duplicate</button>
        <button type="button" class="btn btn-ghost btn-xs" data-pb="arch" data-id="${id}" aria-label="${s.archived ? 'Restore' : 'Archive'} ${name}">${ic(s.archived ? 'undo' : 'folder', 13)}${s.archived ? 'Restore' : 'Archive'}</button>
        <span class="sp"></span>
        <button type="button" class="btn btn-quiet btn-xs" data-pb="trades" data-id="${id}" aria-label="View trades for ${name}">${ic('trades', 13)}View trades</button>
        <button type="button" class="btn btn-quiet btn-xs" data-pb="analytics" data-id="${id}" aria-label="Analytics for ${name}">${ic('stats', 13)}Analytics</button>
      </div>
    </article>`;
  }
  function tplCards() {
    return `<div class="pb-tpls">${TEMPLATES.map((t, i) => `<article class="pb-tpl">
        <div class="pb-tpl-h"><h4>${esc(t.name)}</h4><span class="badge cat">min ${t.minRR}R</span></div>
        <p class="pb-tpl-d">${esc(t.blurb)}</p>
        <div class="pb-tpl-m">${esc(t.tf)}</div>
        ${ruleList(t.entry.slice(0, 3), 'entry')}
        <button type="button" class="btn btn-ghost btn-sm" data-tpl="${i}" aria-label="Use the ${esc(t.name)} template">${ic('plus')}Use this template</button>
      </article>`).join('')}</div>`;
  }
  const firstRunHtml = () => `<div class="card pb-first">
      <div class="pb-first-h"><h3>Write your first setup</h3><p class="muted">A playbook is a short list of setups you trade, each with rules you can check before you click buy. Start from a beginner template and adjust it, or write your own.</p></div>
      ${tplCards()}
      <div class="pb-first-f"><button type="button" class="btn btn-ghost btn-sm" data-pb="new">${ic('plus')}Start from a blank strategy</button></div>
    </div>`;
  function alertsHtml(all, statOf, closed) {
    const out = [];
    // Readiness gate: every strategy you trade must have written rules
    const bare = all.filter(s => statOf.has(s.id) && !strList(s.entry).length && !strList(s.exit).length);
    if (bare.length) out.push(`<div class="insight warn"><div class="ii" aria-hidden="true">!</div><div>
      <div class="it">${bare.length === 1 ? 'A setup you trade has' : `${bare.length} setups you trade have`} no written rules</div>
      <div class="ix">${bare.map(s => `${esc(s.name)} (${plural(statOf.get(s.id).n, 'trade')})`).join(', ')}. Write entry and exit rules — the go-live readiness check needs every setup you trade to be in the playbook.</div>
      <div class="ia">${bare.slice(0, 3).map(s => `<button type="button" class="link-btn" data-pb="edit" data-id="${esc(s.id)}">Write rules for ${esc(s.name)}</button>`).join('')}</div></div></div>`);
    const known = new Set(all.map(s => String(s.id)));
    let unlinked = 0; for (const [k, list] of closed) if (!k || !known.has(k)) unlinked += list.length;
    if (unlinked) out.push(`<div class="insight info"><div class="ii" aria-hidden="true">i</div><div>
      <div class="it">${plural(unlinked, 'closed trade')} ${unlinked === 1 ? 'has' : 'have'} no playbook setup</div>
      <div class="ix">Pick a strategy when you log a trade (or edit older ones) so every result counts toward a setup’s stats.</div></div></div>`);
    return out.length ? `<div class="insights pb-alerts">${out.join('')}</div>` : '';
  }

  function renderPlaybook(el) {
    keepFocus(el);
    const all = strategies(), { closed, open } = strategyGroups();
    const statOf = new Map();
    for (const s of all) { const list = closed.get(String(s.id)); if (list && list.length) statOf.set(s.id, statFor(list)); }
    const active = all.filter(s => !s.archived), arch = all.filter(s => s.archived);
    const shown = sortList(pbView === 'archived' ? arch : active, statOf);
    let grid;
    if (!all.length) grid = firstRunHtml();
    else if (!shown.length) grid = pbView === 'archived'
      ? `<div class="card">${emptyHtml('No archived strategies', 'Archive a setup you no longer trade — it disappears from new trades but its history stays in your stats.')}</div>`
      : `<div class="card">${emptyHtml('No active strategies', 'Every setup is archived. Restore one from the Archived view, or write a new one.', [{ id: 'new', label: 'New strategy', icon: 'plus', primary: true }, { id: 'tpl', label: 'From a template' }])}</div>`;
    else { const T = tokens(); grid = `<div class="pb-grid">${shown.map(s => cardHtml(s, statOf.get(s.id), open.get(String(s.id)) || 0, T)).join('')}</div>`; }   // one getComputedStyle pass per render
    // Default/v1 strategies have names but no rules — offer the templates until one setup is written down
    const noneWritten = all.length > 0 && pbView === 'active' && all.every(s => !strList(s.entry).length && !strList(s.exit).length);
    const tplStrip = noneWritten ? `<div class="card pb-first pb-tplstrip"><div class="pb-first-h"><h3>Start from a template</h3><p class="muted">None of your setups has written rules yet. Use a beginner template as a starting point — you can rename it and edit every rule.</p></div>${tplCards()}</div>` : '';
    el.innerHTML = `
      <div class="pb-bar">
        <button type="button" class="btn btn-primary btn-sm" data-pb="new" data-fk="pb-new" data-fid="pb-new">${ic('plus')}New strategy</button>
        <button type="button" class="btn btn-ghost btn-sm" data-pb="tpl" data-fk="pb-tpl" data-fid="pb-tpl">${ic('sparkle')}From a template</button>
        <span class="sp"></span>
        ${all.length ? `<div class="seg sm inline pb-view" data-pb-view role="group" aria-label="Show strategies"></div>
          <label class="sr-only" for="pb-sort">Sort strategies</label>
          <select class="input sm pb-sort" id="pb-sort" data-fk="pb-sort">${SORTS.map(([v, t]) => `<option value="${v}"${v === pbSort ? ' selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      </div>
      ${all.length ? `<p class="reading pb-intro">Trade only your system. Each card shows how the setup has really performed in <b>${modeName()}</b> — net of fees, in R. Numbers stay greyed until a setup has 10+ closed trades (20+ for win rate and expectancy).</p>` : ''}
      ${alertsHtml(all, statOf, closed)}
      ${tplStrip}${grid}`;
    const vEl = el.querySelector('[data-pb-view]');
    if (vEl) seg(vEl, [{ id: 'active', label: `Active · ${active.length}` }, { id: 'archived', label: `Archived · ${arch.length}` }], pbView, (v) => {
      pbView = v === 'archived' ? 'archived' : 'active'; lsSet('cj.pb.view', pbView);
      renderPlaybook(el); focusSel(el, `[data-pb-view] button[data-id="${pbView}"]`);
    });
    const sel = el.querySelector('[data-fk="pb-sort"]');
    if (sel) sel.onchange = () => { pbSort = sel.value; lsSet('cj.pb.sort', pbSort); pendingFocus = 'pb-sort'; renderPlaybook(el); };
    bindEmpty(el, { new: () => editStrategy(null), tpl: openTemplates });
    el.querySelectorAll('details[data-rs]').forEach(d => d.addEventListener('toggle', () => { if (d.open) pbOpenRs.add(d.dataset.rs); else pbOpenRs.delete(d.dataset.rs); }));
    el.onclick = (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-pb], [data-tpl]');
      if (!b || !el.contains(b)) return;
      if (b.dataset.tpl != null) { useTemplate(+b.dataset.tpl); return; }
      const id = b.dataset.id, act = b.dataset.pb;
      if (act === 'new') editStrategy(null);
      else if (act === 'tpl') openTemplates();
      else if (act === 'edit') editStrategy(id);
      else if (act === 'dup') duplicate(id);
      else if (act === 'arch') toggleArchive(id);
      else if (act === 'trades') { if (typeof Ledger !== 'undefined' && Ledger.show) Ledger.show({ strategyId: id }); else Router.go('trades'); }
      else if (act === 'analytics') { if (typeof Analytics !== 'undefined' && Analytics.show) Analytics.show('overview', { strategyId: id }); else Router.go('analytics'); }
      else if (act === 'pattern') { if (typeof Learn !== 'undefined' && Learn.show) Learn.show('patterns', b.dataset.pid); else Router.go('patterns'); }
    };
    restoreFocus(el);
  }

  /* ── Playbook: actions ──────────────────────────────────── */
  function toggleArchive(id) {
    const s = sById(id); if (!s) return;
    if (Router.active === 'playbook') pendingFocus = 'pb-new';   // the card leaves this view
    if (s.archived) { delete s.archived; commit(`“${s.name}” is active again`); return; }
    s.archived = true;
    if (!commit()) { rollback(() => { delete s.archived; }); return; }
    // look the strategy up again on Undo: a cross-window reload may have replaced db (and this object) meanwhile
    const sid = s.id;
    toast(`Archived “${s.name}” — hidden from new trades, history kept`, 'ok', { ms: 8000, action: { label: 'Undo', run: () => { const x = sById(sid); if (x) { delete x.archived; commit(); } } } });
  }
  function duplicate(id) {
    const s = sById(id); if (!s) return;
    const copy = clone(s); delete copy.id; delete copy.archived;
    copy.name = uniqueName(`${s.name || 'Strategy'} (copy)`);
    editStrategy(null, { prefill: copy });   // nothing is saved until the user presses Save
  }
  function useTemplate(i) {
    const t = TEMPLATES[i]; if (!t) return;
    const { blurb, ...rest } = clone(t);
    rest.name = uniqueName(rest.name);
    editStrategy(null, { prefill: rest });
  }
  function openTemplates() {
    Modal.open({
      title: 'Start from a template', width: 860,
      body: `<p class="muted pb-tpl-intro">Beginner-friendly setups with rules you can actually check. Pick one, then edit it to match how you trade — a template you don’t follow is worse than none.</p>${tplCards()}`,
      foot: '<button type="button" class="btn btn-ghost" data-cancel>Cancel</button>',
      onMount(m, close) {
        m.querySelector('[data-cancel]').onclick = () => close();
        m.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => { close(); useTemplate(+b.dataset.tpl); });
        // Modal.open only auto-focuses inputs / a primary button — this body has neither, so move focus into the dialog
        const first = m.querySelector('[data-tpl]'); if (first) first.focus({ preventScroll: true });
      },
    });
  }

  /* ── Strategy editor (Modal) ────────────────────────────── */
  // editStrategy(id|null, { prefill, onSave(strategy) }) → modal handle | null
  function editStrategy(id, opts) {
    opts = opts || {};
    const existing = id != null && id !== '' ? sById(id) : null;
    if (id != null && id !== '' && !existing) { toast('That strategy no longer exists', 'err'); return null; }
    const pre = isRec(opts.prefill) ? clone(opts.prefill) : {};
    delete pre.id; delete pre.archived;
    const s = existing || Object.assign({ name: '', tf: '', indicators: '', entry: [], exit: [], notes: '', minRR: 1.5 }, pre);
    const entry = strList(s.entry), exit = strList(s.exit), ck = strList(s.checklist);
    const v = (x) => esc(x == null ? '' : x);
    const maxR = typeof effectiveMaxRisk === 'function' ? effectiveMaxRisk() : (S().risk && S().risk.maxRiskPct) || 1;
    const riskHint = (r) => (isN(r) && r > maxR ? `Above your account limit of ${maxR}% — the lower limit applies when you log a trade.` : `Optional. Leave empty to use your account limit (${maxR}%).`);
    const body = `<form class="form-grid pb-form" novalidate autocomplete="off">
      <div class="field full"><label for="pbf-name">Name</label><input class="input" id="pbf-name" maxlength="60" value="${v(s.name)}" placeholder="e.g. Trend pullback" autofocus></div>
      <div class="field"><label for="pbf-tf">Timeframes <span class="opt">optional</span></label><input class="input" id="pbf-tf" maxlength="80" value="${v(s.tf)}" placeholder="e.g. 4H entry · 1D trend"></div>
      <div class="field"><label for="pbf-ind">Indicators <span class="opt">optional</span></label><input class="input" id="pbf-ind" maxlength="120" value="${v(s.indicators)}" placeholder="e.g. EMA 20/50, RSI 14, volume"></div>
      <div class="field full"><label for="pbf-entry">Entry criteria — one per line</label>
        <textarea class="input" id="pbf-entry" rows="5" placeholder="Price above the 50 EMA on the daily&#10;Pullback into the 20–50 EMA zone&#10;Bullish candle closes in the zone">${v(entry.join('\n'))}</textarea>
        <div class="hint">Write rules a stranger could check: “RSI (14) below 40”, not “oversold”.</div></div>
      <div class="field full"><label for="pbf-exit">Exit criteria — one per line</label>
        <textarea class="input" id="pbf-exit" rows="4" placeholder="Stop below the pullback low&#10;Take half at 2R, stop to breakeven&#10;Exit on a 4H close below the 50 EMA">${v(exit.join('\n'))}</textarea>
        <div class="hint">Where the stop goes, where you take profit, and what proves the idea wrong.</div></div>
      <div class="field full"><label for="pbf-ck">Pre-trade checklist — one per line <span class="opt">optional</span></label>
        <textarea class="input" id="pbf-ck" rows="4">${v(ck.join('\n'))}</textarea>
        <div class="pb-ck-row"><span class="hint">Ticked off in the trade form before you enter. Empty = your entry criteria.</span><button type="button" class="link-btn" data-copy>Copy entry criteria here</button></div></div>
      <div class="field"><label for="pbf-minrr">Minimum reward : risk</label>
        <div class="input-group"><input class="input mono" id="pbf-minrr" type="number" min="0" max="50" step="0.1" value="${v(isN(s.minRR) ? s.minRR : 1.5)}" aria-describedby="pbf-minrr-h"><span class="addon">R</span></div>
        <div class="hint" id="pbf-minrr-h">Skip trades whose target is closer than this. 0 = no minimum.</div></div>
      <div class="field"><label for="pbf-risk">Max risk per trade <span class="opt">optional</span></label>
        <div class="input-group"><input class="input mono" id="pbf-risk" type="number" min="0" max="100" step="0.05" value="${v(isN(s.maxRiskPct) ? s.maxRiskPct : '')}" placeholder="${v(maxR)}" aria-describedby="pbf-risk-h"><span class="addon">%</span></div>
        <div class="hint${isN(s.maxRiskPct) && s.maxRiskPct > maxR ? ' warn' : ''}" id="pbf-risk-h">${esc(riskHint(s.maxRiskPct))}</div></div>
      <div class="field full"><label for="pbf-notes">Notes <span class="opt">optional</span></label>
        <textarea class="input" id="pbf-notes" rows="3" placeholder="When it works best, market conditions to avoid, examples…">${v(s.notes)}</textarea></div>
      ${existing ? `<div class="field full"><label class="check"><input type="checkbox" id="pbf-arch"${existing.archived ? ' checked' : ''}> Archived — hidden when logging new trades; its history stays in your stats</label></div>` : ''}
    </form>`;
    const foot = `${existing ? `<button type="button" class="btn btn-danger btn-sm" data-del>${ic('trash')}Delete</button>` : ''}<div class="sp"></div>
      <button type="button" class="btn btn-ghost" data-cancel>Cancel</button><button type="button" class="btn btn-primary" data-save>Save strategy</button>`;
    return Modal.open({
      title: existing ? 'Edit strategy' : 'New strategy', width: 680, body, foot,
      onMount(m, close) {
        const q = (sel) => m.querySelector(sel);
        const form = q('form'), nameEl = q('#pbf-name'), entryEl = q('#pbf-entry'), exitEl = q('#pbf-exit'), ckEl = q('#pbf-ck');
        const minEl = q('#pbf-minrr'), riskEl = q('#pbf-risk'), riskH = q('#pbf-risk-h');
        const syncPh = () => {
          const en = lines(entryEl.value);
          ckEl.placeholder = en.length ? `Empty = use your ${plural(en.length, 'entry rule')}:\n${en.slice(0, 4).join('\n')}` : 'One check per line, e.g. “Stop placed before entry”.';
        };
        entryEl.addEventListener('input', syncPh); syncPh();
        q('[data-copy]').onclick = () => { ckEl.value = entryEl.value; ckEl.focus(); };
        riskEl.addEventListener('input', () => { const r = parseFloat(riskEl.value); riskH.textContent = riskHint(r); riskH.classList.toggle('warn', isN(r) && r > maxR); });
        [nameEl, minEl, riskEl].forEach(x => x.addEventListener('input', () => x.classList.remove('invalid')));
        const bad = (x, msg) => { x.classList.add('invalid'); x.focus(); toast(msg, 'err'); };
        // Another window's save (app.js storage sync) or a backup restore replaces the whole db while this modal
        // stays open — re-resolve the strategy by id, or the edit would land on a detached object and be lost.
        const current = () => (existing ? sById(existing.id) : null);
        const gone = () => { toast('This strategy was already removed (in another window or by a restore)', 'warn'); close(); };
        const doSave = () => {
          // vanished mid-edit → re-add it under the same id, so the typed edits survive and its trades relink
          const cur = current();
          const name = nameEl.value.trim().replace(/\s+/g, ' ');
          if (!name) return bad(nameEl, 'Give the strategy a name');
          if (strategies().some(x => x !== cur && String(x.name || '').trim().toLowerCase() === name.toLowerCase())) return bad(nameEl, `You already have a strategy called “${name}”`);
          // A number input reports a typo ("1..5") as value '' — without this check it would silently save "no minimum"
          // or wipe an existing max risk.
          if (minEl.validity && minEl.validity.badInput) return bad(minEl, 'Minimum R:R must be a number, e.g. 1.5');
          if (riskEl.validity && riskEl.validity.badInput) return bad(riskEl, 'Max risk must be a number, e.g. 1');
          const mr = minEl.value.trim() === '' ? 0 : parseFloat(minEl.value);
          if (!isN(mr) || mr < 0 || mr > 50) return bad(minEl, 'Minimum R:R must be between 0 and 50');
          const rRaw = riskEl.value.trim(), rk = parseFloat(rRaw);
          if (rRaw && (!isN(rk) || rk <= 0 || rk > 100)) return bad(riskEl, 'Max risk must be above 0% and at most 100%');
          const en = lines(entryEl.value), cl = lines(ckEl.value);
          const target = cur || { id: existing ? existing.id : uid('s') };
          const prev = cur ? clone(cur) : null, prevView = pbView;   // undo copy for a failed write
          Object.assign(target, {
            name, tf: q('#pbf-tf').value.trim(), indicators: q('#pbf-ind').value.trim(),
            entry: en, exit: lines(exitEl.value), notes: q('#pbf-notes').value.trim(), minRR: Math.round(mr * 100) / 100,
          });
          // Stored only when it differs from the entry rules, so later entry edits keep the checklist in sync
          if (cl.length && cl.join('\n') !== en.join('\n')) target.checklist = cl; else delete target.checklist;
          if (rRaw) target.maxRiskPct = Math.round(rk * 100) / 100; else delete target.maxRiskPct;
          const archEl = q('#pbf-arch');
          if (archEl) { if (archEl.checked) target.archived = true; else delete target.archived; }
          if (!cur) {
            if (Array.isArray(s.patterns)) target.patterns = s.patterns.filter(p => typeof p === 'string');
            db.strategies.push(target);
            pbView = 'active';
          }
          // archiving from the editor moves the card out of the current view → focus the toolbar instead
          if (Router.active === 'playbook') pendingFocus = (target.archived ? 'archived' : 'active') === pbView ? 'pb-edit-' + target.id : 'pb-new';
          // not written to disk → the editor stays open with the typed values, and db goes back to how it was
          if (!commitModal(close, cur ? 'Strategy saved' : existing ? `Saved — “${name}” had been removed in another window, so it was added back` : `Added “${name}” to your playbook`, () => {
            if (cur) { for (const k of Object.keys(cur)) delete cur[k]; Object.assign(cur, prev); }
            else { const j = db.strategies.indexOf(target); if (j >= 0) db.strategies.splice(j, 1); pbView = prevView; }
          })) return;
          if (opts.onSave) { try { opts.onSave(target); } catch (e) { console.error('[Discipline] onSave', e); } }
        };
        const doDelete = async () => {
          if (!existing) return;
          let cur = current(); if (!cur) return gone();
          const usage = usageOf(cur.id), used = usage.real;
          if (used) {
            if (cur.archived) {
              await confirmDialog({ title: 'Strategy in use', html: `<b>${esc(cur.name)}</b> is used by ${plural(used, 'logged trade')}, so it can’t be deleted. It stays archived so its history keeps counting.`, confirmText: 'OK', cancelText: 'Close' });
              return;
            }
            const ok = await confirmDialog({ title: 'Archive instead?', html: `<b>${esc(cur.name)}</b> is used by ${plural(used, 'logged trade')} (trash and missed trades included), so it can’t be deleted without breaking their history.<br><br>Archive it instead: it disappears from new trades, but its results stay in your stats.`, confirmText: 'Archive it' });
            if (!ok) return;
            cur = current(); if (!cur) return gone();   // the db may have been replaced while the dialog was open
            const wasArch = cur.archived;   // the re-resolved copy may already be archived (another window)
            cur.archived = true;
            if (Router.active === 'playbook') pendingFocus = 'pb-new';
            commitModal(close, `Archived “${cur.name}”`, () => { if (wasArch) cur.archived = wasArch; else delete cur.archived; });
            return;
          }
          const demoNote = usage.demo ? ` None of your paper or live trades use it; ${plural(usage.demo, 'demo trade')} will show no setup until you regenerate the demo data.` : ' No trades use it.';
          const ok = await confirmDialog({ title: 'Delete strategy?', html: `Delete <b>${esc(cur.name)}</b> from your playbook?${esc(demoNote)}`, confirmText: 'Delete', danger: true });
          if (!ok) return;
          cur = current(); if (!cur) return gone();
          const i = db.strategies.indexOf(cur);
          if (i < 0) { close(); return; }
          db.strategies.splice(i, 1);
          if (Router.active === 'playbook') pendingFocus = 'pb-new';
          if (!commitModal(close, null, () => { if (!sById(cur.id)) db.strategies.splice(Math.min(i, db.strategies.length), 0, cur); })) return;
          const removed = cur;
          toast(`Deleted “${removed.name}”`, 'ok', { ms: 9000, action: { label: 'Undo', run: () => {
            if (!sById(removed.id)) db.strategies.splice(Math.min(i, db.strategies.length), 0, removed);
            commit('Strategy restored');
          } } });
        };
        q('[data-save]').onclick = doSave;
        q('[data-cancel]').onclick = () => close();
        const del = q('[data-del]'); if (del) del.onclick = doDelete;
        form.addEventListener('submit', (ev) => { ev.preventDefault(); doSave(); });
        // Enter saves from single-line fields; Ctrl/⌘+Enter saves from a textarea
        form.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter' || ev.isComposing) return;   // Enter that confirms an IME composition must not save
          const t = ev.target, tag = t.tagName;
          if (!((tag === 'INPUT' && t.type !== 'checkbox') || (tag === 'TEXTAREA' && (ev.ctrlKey || ev.metaKey)))) return;
          ev.preventDefault(); doSave();
        });
      },
    });
  }

  /* ── Daily routine: dates & data (v1 format) ────────────── */
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const STAGES = [
    { id: 'prepare', label: 'Prepare', hint: 'before the session — study, plan, check in with yourself' },
    { id: 'trade', label: 'Trade', hint: 'during the session — follow the system and the risk rules' },
    { id: 'reflect', label: 'Reflect', hint: 'after the session — journal, review, share' },
  ];
  const STAGE_IDS = STAGES.map(s => s.id);
  const GOAL = 0.8;   // a day counts toward the streak at ≥ 80% done
  const pad2 = (n) => String(n).padStart(2, '0');
  const localKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dayIdx = (d) => (d.getDay() + 6) % 7;   // Monday = 0
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  function mondayOf(d) { const x = midnight(d); x.setDate(x.getDate() - dayIdx(x)); return x; }
  // v1 key = LOCAL date of that week's Monday (toISOString would shift UTC+ zones back to Sunday)
  const weekKeyOf = (d) => localKey(mondayOf(d));
  function weekKeyAt(offset) { const m = mondayOf(new Date()); m.setDate(m.getDate() + offset * 7); return localKey(m); }
  function parseKey(k) { const [y, m, d] = String(k).split('-').map(Number); const x = new Date(y, m - 1, d); return isFinite(x) ? x : midnight(new Date()); }
  const weeksObj = () => (isRec(db.routine) && isRec(db.routine.weeks) ? db.routine.weeks : {});
  // Task ids index plain objects (routine.weeks[key][taskId]) — an imported '__proto__' id must never reach them
  const okId = (id) => typeof id === 'string' && id !== '' && id !== '__proto__' && id !== 'constructor' && id !== 'prototype';
  const tasks = () => (isRec(db.routine) && Array.isArray(db.routine.tasks) ? db.routine.tasks.filter(t => isRec(t) && okId(t.id)) : []);
  const findTask = (id) => tasks().find(t => String(t.id) === String(id)) || null;
  const taskIndex = (id) => (Array.isArray(db.routine.tasks) ? db.routine.tasks.findIndex(t => isRec(t) && okId(t.id) && String(t.id) === String(id)) : -1);
  // v1 stores [7 booleans]; an object keyed by day index reads the same way. Own properties only (no prototype reads).
  const isDone = (week, taskId, di) => { const m = week && typeof week === 'object' && own(week, taskId) ? week[taskId] : null; return !!(m && typeof m === 'object' && own(m, di) && m[di]); };
  // Writes the state the user clicked on (not a blind flip), so a stale screen — another tab ticked it, or the
  // page was left open past midnight — can never invert a tick the user did not see. User actions only.
  function setTick(key, taskId, di, on) {
    if (!okId(taskId)) return;
    if (!isRec(db.routine.weeks)) db.routine.weeks = {};
    const weeks = db.routine.weeks;
    const wk = own(weeks, key) && isRec(weeks[key]) ? weeks[key] : (weeks[key] = {});
    // A missing / non-array entry becomes a fresh own [7 booleans] (defineProperty: never the inherited __proto__
    // setter); an object keyed by day index keeps its ticks.
    if (!own(wk, taskId) || !Array.isArray(wk[taskId])) {
      const prev = own(wk, taskId) ? wk[taskId] : null;
      const arr = [0, 1, 2, 3, 4, 5, 6].map(i => !!(prev && typeof prev === 'object' && own(prev, i) && prev[i]));
      Object.defineProperty(wk, taskId, { value: arr, writable: true, enumerable: true, configurable: true });
    }
    wk[taskId][di] = !!on;
  }
  // Tasks saved before stages existed: core default by id, then a keyword guess, else 'trade'
  const KEYWORDS = [['reflect', /journal|record|review|share|discord|reflect|lesson|recap/i], ['trade', /trade|risk|stop|system|criteria|entry|position|size/i], ['prepare', /read|watch|lecture|learn|plan|affirm|why|study|sleep|exercise|meditat|news|level/i]];
  function stageOf(t) {
    if (STAGE_IDS.includes(t.stage)) return t.stage;
    const d = (typeof DEFAULT_TASKS !== 'undefined' ? DEFAULT_TASKS : []).find(x => x.id === t.id);
    if (d && STAGE_IDS.includes(d.stage)) return d.stage;
    for (const [st, re] of KEYWORDS) if (re.test(t.name || '')) return st;
    return 'trade';
  }
  // Editor writes make inferred stages explicit (user action only — never from a render)
  function fixStages() { for (const t of db.routine.tasks) if (isRec(t) && okId(t.id) && !STAGE_IDS.includes(t.stage)) t.stage = stageOf(t); }
  const prefs = () => (isRec(db.routinePrefs) ? db.routinePrefs : {});
  const restDays = () => (Array.isArray(prefs().restDays) ? prefs().restDays.filter(i => Number.isInteger(i) && i >= 0 && i < 7) : []);

  // A task counts on a day from the day it was added (createdAt, stamped by the task editor) or on any day it was
  // ticked — so adding a 6th task never turns past 100% days into 67%, wiping the streak and greying the heat map.
  // v1/default tasks carry no createdAt and count on every day, exactly as before.
  const countsOn = (t, key, on) => on || !(typeof t.createdAt === 'string' && t.createdAt.slice(0, 10) > key);
  function dayStat(d, ts) {
    ts = ts || tasks();
    const week = weeksObj()[weekKeyOf(d)], di = dayIdx(d), key = localKey(d);
    let done = 0, total = 0;
    for (const t of ts) { const on = isDone(week, t.id, di); if (countsOn(t, key, on)) { total++; if (on) done++; } }
    return { done, total, pct: total ? done / total : null };
  }
  // One week: ticks per day and how many tasks counted that day (same rule as dayStat)
  function weekCounts(week, ts, dates) {
    const done = [], tot = [];
    dates.forEach((d, i) => {
      const key = localKey(d); let a = 0, b = 0;
      for (const t of ts) { const on = isDone(week, t.id, i); if (countsOn(t, key, on)) { b++; if (on) a++; } }
      done.push(a); tot.push(b);
    });
    return { done, tot };
  }
  // Consecutive days ≥ GOAL ending today. Today in progress never breaks it; rest days below the goal are skipped.
  function streakInfo(ts) {
    ts = ts || tasks();
    const out = { current: 0, todayCounted: false };
    if (!ts.length) return out;
    const rest = restDays(), d = midnight(new Date());
    if (dayStat(d, ts).pct >= GOAL) { out.current = 1; out.todayCounted = true; }
    for (let i = 0; i < 730; i++) {
      d.setDate(d.getDate() - 1);
      if (dayStat(d, ts).pct >= GOAL) out.current++;
      else if (!rest.includes(dayIdx(d))) break;
    }
    return out;
  }
  const lvl = (p) => (p == null || p <= 0 ? 0 : p < 0.4 ? 1 : p < 0.8 ? 2 : p < 1 ? 3 : 4);
  const HM_WEEKS = 12;
  let hmFocus = null;   // 'week-day' of the heat-map cell holding the roving tab stop (84 cells = one Tab stop)
  // 12-week habit heat map: rows Mon–Sun, columns weeks (oldest → this week)
  function heatData(ts) {
    const W = HM_WEEKS, rest = restDays(), today = midnight(new Date());
    const start = mondayOf(today); start.setDate(start.getDate() - (W - 1) * 7);
    const at = (w, di) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + di);
    const validCell = (k) => { const m = /^(\d+)-(\d)$/.exec(k || ''); return !!m && +m[1] < W && +m[2] < 7 && at(+m[1], +m[2]) <= today; };
    const stop = validCell(hmFocus) ? hmFocus : `${W - 1}-${dayIdx(today)}`;
    // chronological pass: average (from the first ticked day) and best streak in the window
    let best = 0, run = 0, tot = 0, cnt = 0, started = false;
    for (let k = 0; k < W * 7; k++) {
      const d = at(0, k); if (d > today) break;
      const st = dayStat(d, ts), isToday = +d === +today, isRest = rest.includes(dayIdx(d));
      if (st.done) started = true;
      if (started && !isToday && !(isRest && !st.done)) { tot += st.pct || 0; cnt++; }
      if (st.pct >= GOAL) { run++; if (run > best) best = run; } else if (!isRest && !isToday) run = 0;
    }
    const months = Array.from({ length: W }, (_, w) => at(w, 0));
    let html = '<div class="rt-hm" role="group" aria-label="Daily routine completion, last 12 weeks" aria-describedby="rt-hm-help"><span aria-hidden="true"></span>' + months.map((m, w) => `<span class="rt-hm-m" aria-hidden="true">${w === 0 || months[w - 1].getMonth() !== m.getMonth() ? esc(m.toLocaleDateString('en-US', { month: 'short' })) : ''}</span>`).join('');
    for (let di = 0; di < 7; di++) {
      html += `<span class="rt-hm-d" aria-hidden="true">${DAYS[di]}</span>`;
      for (let w = 0; w < W; w++) {
        const d = at(w, di);
        if (d > today) { html += '<span class="rt-hm-c future" aria-hidden="true"></span>'; continue; }
        const st = dayStat(d, ts), isRest = rest.includes(di), off = w - (W - 1), cell = `${w}-${di}`;
        const lab = `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}: ${pctTxt(st.pct)} done (${st.done} of ${st.total})${isRest ? ' · rest day' : ''}`;
        html += `<button type="button" class="rt-hm-c l${lvl(st.pct)}${+d === +today ? ' today' : ''}${isRest && !st.done ? ' rest' : ''}${off === rtOffset ? ' sel' : ''}" data-wk="${off}" data-cell="${cell}" data-fk="rt-hm-${cell}" tabindex="${cell === stop ? 0 : -1}" aria-label="${esc(lab)}" title="${esc(lab)}"></button>`;
      }
    }
    return { html: html + '</div>', avg: cnt ? tot / cnt : null, best };
  }
  // Read-only rule checks from today's trades (research: Progress Tracker auto rules) — not part of the routine %
  function autoChecks() {
    const c = comp();
    if (!c || !hasMetrics() || !Metrics.riskGuard) return [];
    const rules = S().risk || {};
    let guard; try { guard = Metrics.riskGuard(c, rules); } catch (e) { return []; }
    const reset = rules.dayResetHour || 0;
    const todays = c.groups.filter(g => { const t = Date.parse(g.trade.entryAt); return isFinite(t) && Metrics.tradingDayKey(t, reset) === guard.today; });
    if (!todays.length) return [{ state: 'idle', label: 'No trades logged today', hint: 'Stop, playbook and limit checks run on the trades you log.' }];
    const out = [];
    const noStop = todays.filter(g => g.portions.some(p => !isN(p.stopPrice))).length;
    out.push({ state: noStop ? 'stop' : 'ok', label: 'Stop loss on every trade', value: `${todays.length - noStop}/${todays.length}` });
    const noStrat = todays.filter(g => !g.strategyId).length;
    out.push({ state: noStrat ? 'warn' : 'ok', label: 'Every trade linked to a playbook setup', value: `${todays.length - noStrat}/${todays.length}` });
    const daily = guard.checks.find(x => x.key === 'daily');
    if (daily) out.push({ state: daily.state, label: 'Daily loss limit respected', value: `${fmtPct(guard.dayPct, { sign: true, dp: 1 })} / ${fmtPct(Math.abs(daily.limit), { dp: 1 })} max loss` });
    if (rules.maxTradesDay) out.push({ state: guard.tradesToday > rules.maxTradesDay ? 'stop' : guard.tradesToday === rules.maxTradesDay ? 'warn' : 'ok', label: 'Within your max trades per day', value: `${guard.tradesToday}/${rules.maxTradesDay}` });
    return out;
  }
  function routineProgress(dateKey) {
    const d = typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? parseKey(dateKey) : midnight(new Date());
    const ts = tasks(), st = dayStat(d, ts), week = weeksObj()[weekKeyOf(d)], di = dayIdx(d), key = localKey(d);
    return {
      done: st.done, total: st.total, pct: st.pct, streak: streakInfo(ts).current, goal: GOAL,
      stages: STAGES.map(s => {
        const l = ts.filter(t => stageOf(t) === s.id && countsOn(t, key, isDone(week, t.id, di)));
        return { id: s.id, label: s.label, done: l.filter(t => isDone(week, t.id, di)).length, total: l.length };
      }),
    };
  }

  /* ── Daily routine: page ────────────────────────────────── */
  let rtOffset = 0;   // 0 = this week, −1 = last week …

  function gridHtml(key, ts, dates, todayIdx, today) {
    const week = weeksObj()[key], rest = restDays();
    const head = `<thead><tr><th class="rt-n" scope="col">#</th><th scope="col">Task</th>${dates.map((d, i) => `<th scope="col" class="rt-dh${i === todayIdx ? ' today' : ''}"><span>${DAYS[i]}</span><small>${d.getDate()}${rest.includes(i) ? ' · rest' : ''}</small></th>`).join('')}</tr></thead>`;
    let n = 0, body = '';
    for (const st of STAGES) {
      const list = ts.filter(t => stageOf(t) === st.id);
      if (!list.length) continue;
      body += `<tbody><tr class="rt-stage"><th colspan="9" scope="rowgroup"><span class="rt-st-dot ${st.id}" aria-hidden="true"></span>${st.label}<small>${esc(st.hint)}</small></th></tr>`;
      for (const t of list) {
        n++;
        body += `<tr><td class="rt-n mono">${n}</td><th scope="row" class="routine-task">${esc(t.name)}${t.time ? `<span class="routine-time">${esc(t.time)}</span>` : ''}</th>${dates.map((d, i) => {
          const on = isDone(week, t.id, i), fut = d > today, pre = !countsOn(t, localKey(d), on);
          const lbl = `${t.name}, ${DAYS_LONG[i]} ${fmtDateShort(d)}: ${fut ? 'upcoming' : on ? 'done' : pre ? 'before this task was added' : 'not done'}`;
          return `<td class="rt-c${i === todayIdx ? ' today-bg' : ''}${pre && !fut ? ' rt-pre' : ''}"><button type="button" class="chk${on ? ' on' : ''}" data-tk="${esc(t.id)}" data-di="${i}" data-fk="rt-${esc(t.id)}-${i}" aria-pressed="${on}" aria-label="${esc(lbl)}"${fut ? ' disabled' : ''}>${ic('check', 13)}</button></td>`;
        }).join('')}</tr>`;
      }
      body += '</tbody>';
    }
    const { done: totals, tot } = weekCounts(week, ts, dates);
    const cls = (p) => (p >= 0.9 ? 'rt-p-hi' : p >= 0.5 ? 'rt-p-mid' : 'rt-p-lo');
    const cellTd = (i, html, extra) => `<td class="mono${extra ? ' ' + extra : ''}${i === todayIdx ? ' today-bg' : ''}">${html}</td>`;
    body += `<tbody class="rt-tot">
      <tr><td></td><th scope="row" class="rt-tl">Done</th>${totals.map((v, i) => cellTd(i, dates[i] > today ? '—' : String(v))).join('')}</tr>
      <tr><td></td><th scope="row" class="rt-tl">Completion</th>${totals.map((v, i) => { const p = tot[i] ? v / tot[i] : 0; return cellTd(i, dates[i] > today ? '—' : Math.round(p * 100) + '%', dates[i] > today ? 'rt-p-lo' : cls(p)); }).join('')}</tr>
    </tbody>`;
    return head + body;
  }

  function renderRoutine(el) {
    const ts = tasks();
    if (!ts.length) {
      el.onclick = el.onchange = el.onkeydown = null;
      el.innerHTML = `<div class="card">${emptyHtml('No routine tasks yet', 'Build a short daily routine: prepare before you trade, follow your rules while trading, reflect afterwards.', [{ id: 'defaults', label: 'Use the suggested routine', primary: true }, { id: 'edit', label: 'Add my own tasks', icon: 'plus' }])}</div>`;
      bindEmpty(el, {
        // Stamped like editor-added tasks (they count from today, so earlier days keep their history) and
        // appended, so rows this page cannot read (no id) are never dropped.
        defaults: () => {
          if (tasks().length || typeof DEFAULT_TASKS === 'undefined') return;
          const at = localKey(new Date()), keep = Array.isArray(db.routine.tasks) ? db.routine.tasks : [];
          db.routine.tasks = keep.concat(clone(DEFAULT_TASKS).map(t => ({ ...t, createdAt: at })));
          commit('Suggested routine added');
        },
        edit: openTaskEditor,
      });
      return;
    }
    keepFocus(el);
    const today = midnight(new Date()), key = weekKeyAt(rtOffset), monday = parseKey(key);
    const dates = DAYS.map((_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    const todayIdx = rtOffset === 0 ? dayIdx(today) : -1;
    const week = weeksObj()[key], rest = restDays();
    // v1: ticks ÷ (tasks × 7). Rest days leave the denominator; a task added mid-week counts from the day it was added.
    const { done: totals, tot } = weekCounts(week, ts, dates);
    const work = (i) => rest.length >= 7 || !rest.includes(i);
    const weekDen = sum(tot.filter((_, i) => work(i)));
    const weekPct = weekDen ? Math.min(1, sum(totals) / weekDen) : 0;
    let pace = null;   // current week: completion over the working days that have started
    if (rtOffset === 0) {
      const den = sum(tot.filter((_, i) => dates[i] <= today && work(i)));
      if (den) pace = Math.min(1, sum(totals.filter((_, i) => dates[i] <= today)) / den);
    }
    const msg = weekPct >= 0.9 ? '🏆 Reward unlocked — you earned it!' : weekPct >= 0.5 ? 'Solid — keep pushing to 90%' : 'Show up every day. Small reps win.';
    const sk = streakInfo(ts), hm = heatData(ts), tStat = dayStat(today, ts);
    const tKey = weekKeyOf(today), tDi = dayIdx(today), tWeek = weeksObj()[tKey];
    const stageCounts = STAGES.map(st => { const l = ts.filter(t => stageOf(t) === st.id); return { st, l, d: l.filter(t => isDone(tWeek, t.id, tDi)).length }; }).filter(x => x.l.length);
    const label = (rtOffset === 0 ? 'This week · ' : rtOffset === -1 ? 'Last week · ' : '')
      + `${fmtDateShort(dates[0])} – ${fmtDateShort(dates[6])}${dates[6].getFullYear() !== today.getFullYear() ? ', ' + dates[6].getFullYear() : ''}`;
    const need = Math.max(0, Math.ceil(GOAL * tStat.total) - tStat.done);
    const wp = Math.round(weekPct * 100);

    const kpis = `<div class="kpis rt-kpis">
      <div class="kpi rt-k-week"><div class="k-lbl">${rtOffset === 0 ? 'This week' : 'Week'}${infoTip('Ticks ÷ (tasks × working days). Above 90% for the week — reward yourself.')}</div>
        <div class="k-val">${wp}%</div>
        <div class="progress-track" role="progressbar" aria-label="Weekly routine completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${wp}"><div class="progress-fill${weekPct >= 0.9 ? ' gold' : ''}" style="width:${(weekPct * 100).toFixed(1)}%"></div></div>
        <div class="k-sub">${esc(msg)}${pace != null && weekPct < 0.9 ? ` · ${Math.round(pace * 100)}% of the days so far` : ''}</div></div>
      ${kpi('Current streak', `${sk.current}<small>${sk.current === 1 ? 'day' : 'days'}</small>`, sk.todayCounted ? 'Today counted ✓' : need && tStat.done ? `${need} more today to extend it` : 'Days in a row at 80%+', '', infoTip(`Days in a row with at least ${Math.round(GOAL * 100)}% of your routine done. Today joins once it reaches ${Math.round(GOAL * 100)}%; rest days you set never break it.`))}
      ${kpi('Today', `${tStat.done}<small>/ ${tStat.total}</small>`, stageCounts.map(x => `${x.st.label} ${x.d}/${x.l.length}`).join(' · '))}
      ${kpi('12-week average', pctTxt(hm.avg), hm.avg == null ? 'starts after your first full day' : `best streak ${plural(hm.best, 'day')}`)}
    </div>`;
    const todayHtml = stageCounts.map(({ st, l, d }) => `<div class="rt-tg"><div class="rt-tg-h"><span class="rt-st-dot ${st.id}" aria-hidden="true"></span>${st.label}<span class="rt-tg-n">${d}/${l.length}</span></div>
      ${l.map(t => { const on = isDone(tWeek, t.id, tDi); return `<label class="rt-ti${on ? ' done' : ''}"><input type="checkbox" data-today="${esc(t.id)}" data-fk="rt-td-${esc(t.id)}"${on ? ' checked' : ''}><span class="rt-tn">${esc(t.name)}</span>${t.time ? `<span class="rt-tt">${esc(t.time)}</span>` : ''}</label>`; }).join('')}</div>`).join('');
    const auto = autoChecks();
    const glyphOf = { ok: '✓', stop: '✕', warn: '!', idle: '–' }, srOf = { ok: 'passed', stop: 'broken', warn: 'at or near the limit', idle: '' };
    const autoHtml = auto.length ? `<div class="rt-auto"><div class="rt-auto-h">Auto-checked from today’s trades <span class="dim">· not part of your %</span></div>
      <div class="guard-list">${auto.map(a => `<div class="guard ${a.state === 'idle' ? '' : a.state}"><span class="gi" aria-hidden="true">${glyphOf[a.state] || '–'}</span><div><div class="gl">${esc(a.label)}${srOf[a.state] ? `<span class="sr-only"> — ${srOf[a.state]}</span>` : ''}</div>${a.hint ? `<div class="gh">${esc(a.hint)}</div>` : ''}</div>${a.value ? `<span class="gv">${esc(a.value)}</span>` : ''}</div>`).join('')}</div></div>` : '';

    el.innerHTML = `
      <div class="rt-bar">
        <button type="button" class="btn btn-ghost btn-icon" data-rt="prev" data-fk="rt-prev" aria-label="Previous week">${ic('chevron-l', 16)}</button>
        <div class="rt-week-l" aria-live="polite">${esc(label)}</div>
        <button type="button" class="btn btn-ghost btn-icon" data-rt="next" data-fk="rt-next" aria-label="Next week"${rtOffset >= 0 ? ' disabled' : ''}>${ic('chevron-r', 16)}</button>
        ${rtOffset !== 0 ? '<button type="button" class="btn btn-quiet btn-sm" data-rt="today" data-fk="rt-back">Back to this week</button>' : ''}
        <span class="sp"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-rt="edit" data-fk="rt-edit" data-fid="rt-edit">${ic('edit')}Edit tasks</button>
      </div>
      ${kpis}
      <div class="rt-main">
        <section class="card rt-gridcard" aria-label="Weekly routine grid">
          <div class="card-title">${ic('routine', 16)}Weekly routine<span class="aside">${sum(totals)} / ${sum(tot)} ticks</span></div>
          <div class="routine-grid"><table class="routine-table rt-table">${gridHtml(key, ts, dates, todayIdx, today)}</table></div>
          <p class="rt-reward">🏆 Above 90% weekly completion of the routine — reward yourself.</p>
        </section>
        <section class="card rt-today" aria-label="Today’s routine">
          <div class="card-title">${ic('check', 16)}Today<span class="aside">${esc(fmtDateShort(today))} · ${tStat.done}/${tStat.total}</span></div>
          ${todayHtml}${autoHtml}
        </section>
        <section class="card rt-heat" aria-label="Habit heat map, last 12 weeks">
          <div class="card-title">${ic('fire', 16)}Habit heat map<span class="aside">12 weeks</span></div>
          ${hm.html}
          <div class="rt-hm-leg" aria-hidden="true"><span>0%</span><i class="rt-hm-c l0"></i><i class="rt-hm-c l1"></i><i class="rt-hm-c l2"></i><i class="rt-hm-c l3"></i><i class="rt-hm-c l4"></i><span>100%</span></div>
          <div class="rt-hm-cap"><span>Average <b>${pctTxt(hm.avg)}</b></span><span>Best streak <b>${hm.best}d</b></span><span class="dim" id="rt-hm-help">Pick a day to open its week · arrow keys move between days</span></div>
        </section>
      </div>`;

    el.onclick = (ev) => {
      const b = ev.target.closest && ev.target.closest('button');
      if (!b || !el.contains(b) || b.disabled) return;
      if (b.dataset.tk != null) { setTick(key, b.dataset.tk, +b.dataset.di, b.getAttribute('aria-pressed') !== 'true'); pendingFocus = b.dataset.fk; commit(); return; }
      if (b.dataset.wk != null) { hmFocus = b.dataset.cell || null; rtOffset = Math.min(0, +b.dataset.wk || 0); pendingFocus = b.dataset.fk; renderRoutine(el); return; }
      const a = b.dataset.rt;
      if (a === 'prev') { rtOffset--; pendingFocus = 'rt-prev'; renderRoutine(el); }
      else if (a === 'next' && rtOffset < 0) { rtOffset++; pendingFocus = rtOffset < 0 ? 'rt-next' : 'rt-prev'; renderRoutine(el); }
      else if (a === 'today') { rtOffset = 0; pendingFocus = 'rt-prev'; renderRoutine(el); }
      else if (a === 'edit') openTaskEditor();
    };
    el.onchange = (ev) => {
      const cb = ev.target.closest && ev.target.closest('[data-today]');
      if (!cb) return;
      // the day this panel shows (its date is in the card title), even if midnight has passed since it rendered
      setTick(tKey, cb.dataset.today, tDi, cb.checked); pendingFocus = cb.dataset.fk; commit();
    };
    // Heat map keyboard: ←/→ week, ↑/↓ weekday, Home/End first/last week; Enter/Space opens the week (native button)
    el.onkeydown = (ev) => {
      const c = ev.target.closest && ev.target.closest('button[data-cell]');
      if (!c || !el.contains(c)) return;
      let [w, di] = c.dataset.cell.split('-').map(Number);
      const k = ev.key;
      if (k === 'ArrowLeft') w--; else if (k === 'ArrowRight') w++; else if (k === 'ArrowUp') di--; else if (k === 'ArrowDown') di++;
      else if (k === 'Home') w = 0; else if (k === 'End') w = HM_WEEKS - 1; else return;
      ev.preventDefault();
      w = Math.max(0, Math.min(HM_WEEKS - 1, w)); di = Math.max(0, Math.min(6, di));
      const pick = (ww) => el.querySelector(`button[data-cell="${ww}-${di}"]`);
      const n = pick(w) || (k === 'End' ? pick(w - 1) : null);   // only this week can hold future (non-button) days
      if (!n || n === c) return;
      c.tabIndex = -1; n.tabIndex = 0; n.focus(); hmFocus = n.dataset.cell;
    };
    restoreFocus(el);
  }

  /* ── Routine task editor (Modal, saves as you go) ───────── */
  const IDEAS = [
    { name: 'Pre-market plan: bias, key levels, max trades', time: '10 M', stage: 'prepare' },
    { name: 'Readiness check-in (sleep, HALT)', time: '2 M', stage: 'prepare' },
    { name: 'Stop loss set before every entry', time: '', stage: 'trade' },
    { name: 'Stop trading at the daily loss limit', time: '', stage: 'trade' },
    { name: 'Review and grade every closed trade', time: '10 M', stage: 'reflect' },
    { name: 'Write one lesson for tomorrow', time: '5 M', stage: 'reflect' },
  ];
  function openTaskEditor() {
    const stageOpts = (cur) => STAGES.map(s => `<option value="${s.id}"${s.id === cur ? ' selected' : ''}>${s.label}</option>`).join('');
    Modal.open({
      title: 'Edit routine tasks', width: 700,
      body: `<p class="muted rt-ed-intro">Group tasks by when you do them. Changes save as you go; removing a task keeps its past ticks.</p>
        <div class="rt-ed" data-list></div>
        <div class="rt-ed-add"><div class="rt-ed-l">Add a task</div>
          <div class="rt-ed-addrow">
            <input class="input sm" data-new-name maxlength="80" placeholder="e.g. Mark key levels on the BTC 4H" aria-label="New task name">
            <input class="input sm" data-new-time maxlength="12" placeholder="15 M" aria-label="Time needed (optional)">
            <select class="input sm" data-new-stage aria-label="Stage for the new task">${stageOpts('prepare')}</select>
            <button type="button" class="btn btn-ghost btn-sm" data-add>${ic('plus')}Add</button>
          </div>
          <div class="rt-ed-ideas" data-ideas></div></div>
        <div class="rt-ed-rest"><div class="rt-ed-l" id="rt-ed-rest-l">Rest days <span class="dim">— days you plan not to trade; they never break your streak</span></div><div class="chip-row" data-rest role="group" aria-labelledby="rt-ed-rest-l"></div></div>`,
      foot: '<button type="button" class="btn btn-primary" data-done>Done</button>',
      // the page re-rendered underneath, so the opener button is gone — refocus its replacement
      onClose: () => { if (Router.active === 'routine') focusSel(document, '.page[data-page="routine"] [data-fk="rt-edit"]'); },
      onMount(m, close) {
        const list = m.querySelector('[data-list]'), ideasEl = m.querySelector('[data-ideas]');
        const nEl = m.querySelector('[data-new-name]'), tEl = m.querySelector('[data-new-time]'), sEl = m.querySelector('[data-new-stage]');
        const focusE = (fk) => {
          if (!fk) return;
          const all = [...m.querySelectorAll('[data-efk]')];
          const alt = fk.startsWith('up-') ? 'dn-' + fk.slice(3) : fk.startsWith('dn-') ? 'up-' + fk.slice(3) : null;
          const f = all.find(x => x.dataset.efk === fk && !x.disabled) || all.find(x => x.dataset.efk === alt && !x.disabled);
          (f || nEl).focus();
        };
        const draw = (fk) => {
          const ts = tasks();
          list.innerHTML = ts.length ? STAGES.map(st => {
            const g = ts.filter(t => stageOf(t) === st.id);
            if (!g.length) return '';
            return `<div class="rt-ed-g"><div class="rt-ed-gh"><span class="rt-st-dot ${st.id}" aria-hidden="true"></span>${st.label}</div>${g.map((t, i) => {
              const tid = esc(t.id), tn = esc(t.name);
              return `<div class="rt-ed-row">
                <div class="rt-ed-mv"><button type="button" class="btn btn-quiet btn-icon btn-xs rt-up" data-up="${tid}" data-efk="up-${tid}" aria-label="Move ${tn} up"${i === 0 ? ' disabled' : ''}>${ic('chevron-d', 12)}</button><button type="button" class="btn btn-quiet btn-icon btn-xs" data-down="${tid}" data-efk="dn-${tid}" aria-label="Move ${tn} down"${i === g.length - 1 ? ' disabled' : ''}>${ic('chevron-d', 12)}</button></div>
                <input class="input sm rt-ed-name" data-name="${tid}" value="${tn}" maxlength="80" aria-label="Name of ${st.label} task ${i + 1}">
                <input class="input sm rt-ed-time" data-time="${tid}" value="${esc(t.time || '')}" maxlength="12" placeholder="time" aria-label="Time for ${tn}">
                <select class="input sm rt-ed-stage" data-stage="${tid}" data-efk="st-${tid}" aria-label="Stage for ${tn}">${stageOpts(st.id)}</select>
                <button type="button" class="btn btn-quiet btn-icon btn-xs rt-ed-del" data-del="${tid}" aria-label="Remove ${tn}">${ic('trash', 13)}</button>
              </div>`;
            }).join('')}</div>`;
          }).join('') : '<div class="muted">No tasks yet — add one below.</div>';
          const names = new Set(ts.map(t => String(t.name).trim().toLowerCase()));
          const ideas = IDEAS.map((x, i) => ({ x, i })).filter(o => !names.has(o.x.name.toLowerCase()));
          ideasEl.innerHTML = ideas.length ? `<span class="dim">Ideas:</span>${ideas.map(o => `<button type="button" class="chip sm" data-idea="${o.i}">${ic('plus', 11)}${esc(o.x.name)}</button>`).join('')}` : '';
          focusE(fk);
        };
        const move = (id, dir, fk) => {
          fixStages();
          const ts = db.routine.tasks, i = taskIndex(id); if (i < 0) return;
          let j = i + dir;
          while (j >= 0 && j < ts.length && !(isRec(ts[j]) && okId(ts[j].id) && ts[j].stage === ts[i].stage)) j += dir;
          if (j < 0 || j >= ts.length) return;
          [ts[i], ts[j]] = [ts[j], ts[i]];
          commit(); draw(fk);
        };
        const delTask = (id) => {
          const ts = db.routine.tasks, i = taskIndex(id); if (i < 0) return;
          const [gone] = ts.splice(i, 1);
          // not saved → put it back; the list was not redrawn yet, so the row and its focused button stay as they were
          if (!commit()) { rollback(() => { ts.splice(i, 0, gone); }); return; }
          draw(); nEl.focus();
          toast(`Removed “${gone.name}” — its past ticks are kept`, 'ok', { ms: 8000, action: { label: 'Undo', run: () => {
            if (!findTask(gone.id)) db.routine.tasks.splice(Math.min(i, db.routine.tasks.length), 0, gone);
            commit(); if (m.isConnected) draw();
          } } });
        };
        const addTask = (name, time, stage) => {
          name = String(name || '').trim().replace(/\s+/g, ' ');
          if (!name) { nEl.focus(); toast('Type a task name first', 'warn'); return false; }
          fixStages();
          // createdAt (local date): the task only counts toward days from today on, so past days and the streak stay as they were
          db.routine.tasks.push({ id: uid('t'), name: name.slice(0, 80), time: String(time || '').trim().slice(0, 12), stage: STAGE_IDS.includes(stage) ? stage : 'prepare', createdAt: localKey(new Date()) });
          commit(); draw();
          return true;
        };
        m.addEventListener('click', (ev) => {
          const b = ev.target.closest && ev.target.closest('button');
          if (!b || b.disabled) return;
          if (b.dataset.up) move(b.dataset.up, -1, 'up-' + b.dataset.up);
          else if (b.dataset.down) move(b.dataset.down, 1, 'dn-' + b.dataset.down);
          else if (b.dataset.del) delTask(b.dataset.del);
          else if (b.dataset.idea != null) { const x = IDEAS[+b.dataset.idea]; if (x && addTask(x.name, x.time, x.stage)) nEl.focus(); }
          else if (b.hasAttribute('data-add')) { if (addTask(nEl.value, tEl.value, sEl.value)) { nEl.value = ''; tEl.value = ''; nEl.focus(); } }
          else if (b.hasAttribute('data-done')) close();
        });
        m.addEventListener('change', (ev) => {
          const t = ev.target, ds = t.dataset || {};
          if (ds.name) {
            const task = findTask(ds.name); if (!task) return;
            const v = t.value.trim().replace(/\s+/g, ' ');
            if (!v) { t.value = task.name; toast('A task needs a name', 'warn'); return; }
            // pin inferred stages first, so a rename never moves the task to another stage group
            if (v !== task.name) { fixStages(); task.name = v.slice(0, 80); commit(); }
          } else if (ds.time) {
            const task = findTask(ds.time); if (!task) return;
            task.time = t.value.trim().slice(0, 12); fixStages(); commit();
          } else if (ds.stage) {
            const task = findTask(ds.stage); if (!task || !STAGE_IDS.includes(t.value)) return;
            fixStages(); task.stage = t.value; commit(); draw('st-' + task.id);
          }
        });
        nEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); if (addTask(nEl.value, tEl.value, sEl.value)) { nEl.value = ''; tEl.value = ''; nEl.focus(); } } });
        const restEl = m.querySelector('[data-rest]');
        let prevRest = restDays().map(String);
        chips(restEl, DAYS.map((d, i) => ({ id: String(i), label: d })), prevRest, { multi: true, onChange: (sel) => {
          const clicked = sel.find(x => !prevRest.includes(x)) || prevRest.find(x => !sel.includes(x));
          prevRest = sel.slice();
          db.routinePrefs = { ...prefs(), restDays: sel.map(Number).filter(i => i >= 0 && i < 7).sort((a, b) => a - b) };
          commit();
          if (clicked != null) focusSel(restEl, `[data-id="${clicked}"]`);   // chips() redraws its buttons
        } });
        draw();
      },
    });
  }

  /* ── Backtesting: data ──────────────────────────────────── */
  let btMode = lsGet('cj.bt.mode', '');
  let btShowAll = false, btScrollEnd = false;
  // Results are rewritten from this list on every add/delete, so a hand-edited or imported "25" (string) must be
  // read as 25 — dropping it here would silently delete it on the next write. Non-numbers (null, "abc") are skipped.
  // A typographic minus (U+2212, as the app's own formatters print) or an en dash reads as '-' too.
  const numList = (a) => (Array.isArray(a) ? a.map(v => (typeof v === 'string' && v.trim() !== '' ? Number(v.trim().replace(/^[−–]/, '-')) : v)).filter(isN) : []);
  function ptsData() {
    const b = isRec(db.backtest) ? db.backtest : {};
    return { start: isN(b.start) ? b.start : 1000, riskPct: isN(b.riskPct) ? b.riskPct : 1, points: numList(b.points) };
  }
  // R results live in db.backtestR (sanitize keeps unknown top-level keys); backtest.rPoints is an in-session mirror
  function rData() {
    const r = isRec(db.backtestR) ? db.backtestR : null;
    const b = isRec(db.backtest) ? db.backtest : {};
    const pts = r && Array.isArray(r.points) ? r.points : Array.isArray(b.rPoints) ? b.rPoints : [];
    return {
      points: numList(pts),
      riskPct: r && isN(r.riskPct) && r.riskPct > 0 ? r.riskPct : 1,
      start: r && isN(r.start) && r.start > 0 ? r.start : (isN(b.start) && b.start > 0 ? b.start : 1000),
    };
  }
  function writeR(d) {   // user actions only; keeps any extra fields a newer version may have added
    db.backtestR = { ...(isRec(db.backtestR) ? db.backtestR : {}), points: d.points.slice(), riskPct: d.riskPct, start: d.start };
    if (isRec(db.backtest)) db.backtest.rPoints = d.points.slice();
  }
  const btModeNow = () => (btMode === 'r' || btMode === 'points' ? btMode : (ptsData().points.length && !rData().points.length ? 'points' : 'r'));
  // v1 points model via Engine.backtest (pts/1000 = % move, compounding) + drawdown
  function simPts(d) {
    const bt = Engine.backtest({ start: d.start, riskPct: d.riskPct, points: d.points });
    let peak = d.start, maxDD = 0;
    for (const r of bt.rows) { if (r.after > peak) peak = r.after; r.dd = peak > 0 ? r.after / peak - 1 : 0; if (r.dd < maxDD) maxDD = r.dd; }
    return { ...bt, n: bt.rows.length, wins: bt.rows.filter(r => r.pl > 0).length, losses: bt.rows.filter(r => r.pl < 0).length, maxDD };
  }
  // R mode: each result × (balance × risk%), compounding; balance floors at 0 (ruin)
  function simR(d) {
    let bal = d.start, peak = d.start, maxDD = 0;
    const rows = d.points.map((r, i) => {
      const before = bal, risk = before * d.riskPct / 100, pl = r * risk;
      bal = Math.max(0, before + pl);
      if (bal > peak) peak = bal;
      const dd = peak > 0 ? bal / peak - 1 : 0; if (dd < maxDD) maxDD = dd;
      return { n: i + 1, r, risk, before, pl: bal - before, after: bal, dd };
    });
    const rs = d.points, n = rs.length, W = rs.filter(r => r > 0), L = rs.filter(r => r < 0);
    const gw = sum(W), gl = -sum(L), expR = n ? sum(rs) / n : null;
    const sdR = n >= 2 ? Math.sqrt(rs.reduce((s, r) => s + (r - expR) ** 2, 0) / (n - 1)) : null;
    const tc = n >= 2 ? (hasMetrics() && Metrics.tCrit ? Metrics.tCrit(n - 1) : 1.96) : null;
    const ci = n >= 30 && sdR ? { lo: expR - tc * sdR / Math.sqrt(n), hi: expR + tc * sdR / Math.sqrt(n) } : null;
    const payoff = W.length && L.length ? (gw / W.length) / (gl / L.length) : null;
    return {
      rows, n, wins: W.length, losses: L.length, winRate: n ? W.length / n : null, expR, sdR, ci, sumR: sum(rs),
      pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null), pfReliable: n >= 20 && L.length >= 5,
      payoff, beWin: payoff != null ? 1 / (1 + payoff) : null, maxDD, final: bal, totalPL: bal - d.start,
      growth: d.start > 0 ? bal / d.start - 1 : null,
      tradesNeeded: expR > 0 && sdR ? Math.max(0, Math.ceil((2 * sdR / expR) ** 2) - n) : null,
    };
  }
  function parseVals(raw) {
    const parts = String(raw == null ? '' : raw).replace(/[−–]/g, '-').split(/[\s,;]+/).filter(Boolean);
    const vals = [], bad = [];
    for (const p of parts) { const v = Number(p.replace(/r$/i, '')); if (p.replace(/r$/i, '') !== '' && isFinite(v)) vals.push(v); else bad.push(p); }
    return { vals, bad };
  }

  /* ── Backtesting: actions ───────────────────────────────── */
  function putList(isR, arr) { if (isR) writeR({ ...rData(), points: arr }); else db.backtest.points = arr; }
  const curList = (isR) => (isR ? rData().points.slice() : ptsData().points.slice());
  // Undo for a failed write: putList() swaps in new objects/arrays and never mutates the old ones, so putting the
  // old references back (or removing keys that were absent) restores the in-memory backtest exactly.
  function btUndo() {
    const b = db.backtest;
    const keep = [[db, 'backtestR'], [b, 'points'], [b, 'rPoints']].map(([o, k]) => [o, k, isRec(o) && own(o, k), isRec(o) ? o[k] : undefined]);
    return () => { for (const [o, k, had, v] of keep) if (isRec(o)) { if (had) o[k] = v; else delete o[k]; } };
  }
  function addResults(el) {
    const inp = el.querySelector('[data-bt-input]'); if (!inp) return;
    const isR = btModeNow() === 'r', { vals, bad } = parseVals(inp.value);
    if (bad.length) { toast(`Not a number: ${bad.slice(0, 3).join(', ')}`, 'err'); inp.focus(); return; }
    if (!vals.length) { toast(isR ? 'Enter a result in R, e.g. 2 or -1' : 'Enter a points value (10 pts = 1%)', 'err'); inp.focus(); return; }
    if (isR && vals.some(v => Math.abs(v) > 100)) { toast('Results beyond ±100R look like a typo — enter R multiples, e.g. 2 or -1', 'err'); inp.focus(); return; }
    if (!isR && vals.some(v => v <= -1000)) { toast('−1000 points is a −100% move — check the value', 'err'); inp.focus(); return; }
    putList(isR, curList(isR).concat(vals));
    inp.value = '';   // the re-render carries the input's text over, so clear it once added
    pendingFocus = 'bt-input'; btScrollEnd = true;
    commit(vals.length > 1 ? `Added ${vals.length} results` : null);
  }
  function delResult(i) {
    const isR = btModeNow() === 'r', list = curList(isR);
    if (!(i >= 0 && i < list.length)) return;
    const undo = btUndo();
    const [v] = list.splice(i, 1);
    putList(isR, list);
    pendingFocus = list.length ? 'bt-del-' + Math.min(i, list.length - 1) : 'bt-input';
    if (!commit()) { rollback(undo, 'bt-del-' + i); return; }
    toast(`Removed result #${i + 1} (${isR ? fmtR(v) : `${v > 0 ? '+' : ''}${fmtNum(v, 2)} pts`})`, 'ok', { ms: 8000, action: { label: 'Undo', run: () => {
      const cur = curList(isR); cur.splice(Math.min(i, cur.length), 0, v); putList(isR, cur); commit();
    } } });
  }
  async function clearAll() {
    const isR = btModeNow() === 'r', list = curList(isR);
    if (!list.length) return;
    const ok = await confirmDialog({ title: 'Clear all results?', message: `This removes all ${list.length} ${isR ? 'R-mode' : 'points'} results from your backtest log. The ${isR ? 'points' : 'R-mode'} log is not touched.`, confirmText: 'Clear all', danger: true });
    if (!ok) return;
    const undo = btUndo();
    putList(isR, []);
    pendingFocus = 'bt-input';
    if (!commit()) { rollback(undo, 'bt-clear'); return; }
    toast(`Cleared ${plural(list.length, 'result')}`, 'ok', { ms: 9000, action: { label: 'Undo', run: () => { putList(isR, list.concat(curList(isR))); commit('Results restored'); } } });
  }
  function setNum(inp, field) {
    const isR = btModeNow() === 'r', v = parseFloat(inp.value);
    const d = isR ? rData() : ptsData();
    const ok = field === 'start' ? isN(v) && v > 0 : isN(v) && v > 0 && v <= 100;
    if (!ok) { toast(field === 'start' ? 'Starting account must be above 0' : 'Risk per trade must be above 0% and at most 100%', 'err'); inp.value = String(d[field]); return; }
    if (isR) writeR({ ...d, [field]: v }); else db.backtest[field] = v;
    commitKeep();
  }

  /* ── Backtesting: page ──────────────────────────────────── */
  function btReadings(sim, d, isR) {
    if (!isR) return `<div class="readings bt-readings"><div class="reading">Points model from your original spreadsheet: each result’s points ÷ 10 = the % account move, compounding. Risk $ is shown for reference only — switch to <b>R mode</b> to size every result at your risk %.</div></div>`;
    if (!sim.n) return '';
    const out = [];
    if (sim.n < 20) out.push(`Too early to judge — ${plural(sim.n, 'result')}. Log at least 30–50 trades of the same setup before trusting the numbers.`);
    else if (sim.ci && sim.ci.lo > 0) out.push(`You average <b>${esc(fmtR(sim.expR))}</b> per trade (likely ${esc(fmtR(sim.ci.lo))} to ${esc(fmtR(sim.ci.hi))}). Promising — now confirm it with paper trades, where fees and slippage are real.`);
    else if (sim.expR > 0) out.push(`You average <b>${esc(fmtR(sim.expR))}</b> per trade, but ${sim.ci ? `the likely range (${esc(fmtR(sim.ci.lo))} to ${esc(fmtR(sim.ci.hi))}) still includes zero — consistent with no edge yet` : 'a reliable range needs 30+ results'}.${sim.tradesNeeded ? ` Roughly ${sim.tradesNeeded} more results would tell.` : ''}`);
    else if (sim.expR === 0) out.push('Your results average exactly 0R — breakeven before fees. Fees and slippage would turn that into a loss; tighten the rules before paper trading this setup.');
    else out.push(`You lose about <b>${esc(Math.abs(sim.expR).toFixed(2))}R</b> per trade on average. Tighten the rules before paper trading this setup.`);
    // win rate is gated at 20 results (contract §6) — the KPI tile is dimmed below that, so the reading stays quiet too
    if (sim.n >= 20 && sim.winRate != null && sim.beWin != null) out.push(`${pctTxt(sim.winRate)} of results win; with your average win vs. loss you need ${pctTxt(sim.beWin)} to break even.`);
    if (sim.maxDD < 0) out.push(`At ${esc(String(d.riskPct))}% risk per trade the deepest drop was ${esc(fmtPct(-sim.maxDD, { dp: 1 }))}. Expect live drawdowns to be deeper.`);
    out.push('Enter R after fees when you can — fees and slippage often cost 0.05–0.2R per trade.');
    return `<div class="readings bt-readings">${out.map(t => `<div class="reading">${t}</div>`).join('')}</div>`;
  }

  function renderBacktest(el) {
    keepFocus(el);
    const md = btModeNow(), isR = md === 'r';
    const prevInp = el.querySelector('[data-bt-input]'), keepVal = prevInp ? prevInp.value : '';   // half-typed result survives re-renders
    const d = isR ? rData() : ptsData();
    // a window resize or another window's save re-renders without a 'change' — keep a half-typed start / risk value too
    const typing = (sel, v) => { const x = el.querySelector(sel); return x && x === document.activeElement && x.value !== String(v) ? x.value : String(v); };
    const startVal = typing('[data-bt-start]', d.start), riskVal = typing('[data-bt-risk]', d.riskPct);
    const sim = isR ? simR(d) : simPts(d);
    const g20 = sim.n < 20;
    const colR = (v) => (v == null ? '—' : g20 ? esc(fmtR(v)) : plSpan(v, esc(fmtR(v))));
    const ddHtml = sim.maxDD < 0 ? plSpan(sim.maxDD, esc(fmtPct(sim.maxDD, { dp: 1 }))) : '0%';
    const ddTip = tipFor('maxDD', 'The deepest fall from a high point of the balance before a new high.');
    const kpis = isR ? [
      kpi('Final balance', money(sim.final), `from ${money(d.start)} at ${esc(String(d.riskPct))}% risk`, 'bt-k-main'),
      kpi('Total return', plSpan(sim.growth, esc(fmtPct(sim.growth, { sign: true }))), `${plSpan(sim.totalPL, money(sim.totalPL, { sign: true }))} · ${esc(fmtR(sim.sumR))}`),
      kpi('Results', String(sim.n), confBadge(sim.n, 'results')),
      kpi('Win rate', pctTxt(sim.winRate), g20 ? 'needs 20+ results' : sim.beWin != null ? `breakeven ${pctTxt(sim.beWin)}` : `${sim.wins}W · ${sim.losses}L`, g20 ? 'gated' : '', tipFor('winRate', 'Share of results above 0R.')),
      kpi('Expectancy', colR(sim.expR), sim.ci ? `95% range ${esc(fmtR(sim.ci.lo))} to ${esc(fmtR(sim.ci.hi))}` : g20 ? 'needs 20+ results' : 'range needs 30+ results', g20 ? 'gated' : '', tipFor('expR', 'Average result per trade in R.')),
      kpi('Profit factor', esc(fmtPF(sim.pf)), sim.pfReliable ? 'R won ÷ R lost' : 'needs 20 results & 5 losses', sim.pfReliable ? '' : 'gated', tipFor('profitFactor', 'Total won divided by total lost. Above 1 makes money.')),
      kpi('Max drawdown', ddHtml, 'deepest drop from a peak', '', ddTip),
    ] : [
      kpi('Final account', money(sim.final), `${plural(sim.n, 'result')} · from ${money(d.start)}`, 'bt-k-main'),
      kpi('Total P/L', plSpan(sim.totalPL, money(sim.totalPL, { sign: true })), `${esc(fmtPct(sim.growth, { sign: true }))} growth`),
      kpi('Win rate', pctTxt(sim.winRate), `${sim.wins}W · ${sim.losses}L · ${confBadge(sim.n, 'results')}`, g20 ? 'gated' : ''),
      kpi('Best / worst', sim.best == null ? '—' : plSpan(sim.best, money(sim.best, { sign: true })), sim.worst == null ? '' : `worst ${plSpan(sim.worst, money(sim.worst, { sign: true }))}`),
      kpi('Max drawdown', ddHtml, 'deepest drop from a peak', '', ddTip),
    ];
    const from = !btShowAll && sim.rows.length > 200 ? sim.rows.length - 200 : 0;
    const rowsShown = sim.rows.slice(from);
    const head = isR
      ? '<tr><th class="num" scope="col">#</th><th class="num" scope="col">Result</th><th class="num" scope="col" title="1R in dollars at your risk %">Risk $</th><th class="num" scope="col">Before</th><th class="num" scope="col">P/L $</th><th class="num" scope="col">After</th><th class="num" scope="col">From peak</th><th scope="col"><span class="sr-only">Delete</span></th></tr>'
      : '<tr><th class="num" scope="col">#</th><th class="num" scope="col">P/L (pts)</th><th class="num" scope="col">%</th><th class="num" scope="col" title="What your risk % would be in dollars — info only">Risk $</th><th class="num" scope="col">Account before</th><th class="num" scope="col">P/L $</th><th class="num" scope="col">Account after</th><th scope="col"><span class="sr-only">Delete</span></th></tr>';
    const rowsHtml = rowsShown.length ? rowsShown.map(r => `<tr>
        <td class="num dim">${r.n}</td>
        ${isR ? `<td class="num ${plClass(r.r)}">${esc(fmtR(r.r))}</td>` : `<td class="num ${plClass(r.pts)}">${r.pts > 0 ? '+' : ''}${esc(fmtNum(r.pts, 2))}</td><td class="num ${plClass(r.pct)}">${esc(fmtPct(r.pct, { sign: true }))}</td>`}
        <td class="num dim">${money(r.risk)}</td>
        <td class="num">${money(r.before)}</td>
        <td class="num ${plClass(r.pl)}">${money(r.pl, { sign: true })}</td>
        <td class="num">${money(r.after)}</td>
        ${isR ? `<td class="num ${r.dd < -1e-9 ? 'neg' : 'dim'}">${r.dd < -1e-9 ? esc(fmtPct(r.dd, { dp: 1 })) : '—'}</td>` : ''}
        <td class="bt-del"><button type="button" class="btn btn-quiet btn-icon btn-xs" data-bt="del" data-i="${r.n - 1}" data-fk="bt-del-${r.n - 1}" aria-label="Delete result #${r.n}">${ic('x', 12)}</button></td>
      </tr>`).join('')
      : `<tr><td colspan="8" class="bt-empty">${emptyHtml('No backtest results yet', isR ? 'Replay a setup on old charts and add each result in R: +2 = won twice your risk, -1 = a full stop loss.' : 'Add each historical trade result as points — 10 points = a 1% account move.')}</td></tr>`;
    const hint = isR ? '+2 = won twice your risk · -1 = full stop. Several at once: “2 -1 0.5” (dot for decimals).' : '10 points = 1% move · 20 = +2%, -10 = −1%. Several at once: “20 -10 15”.';

    el.innerHTML = `
      <div class="reading bt-intro"><b>This is a manual backtest log.</b> Replay old charts bar by bar, apply one playbook setup exactly as written, and type in each result — nothing is fetched or automated. Hindsight makes backtests look better than real trading: treat these numbers as a best case, then prove the setup with paper trades.</div>
      <section class="card bt-card" aria-label="Backtest simulator">
        <div class="card-title">${ic('flask', 16)}Backtest simulator<span class="aside"><span class="seg sm inline bt-mode" data-bt-mode role="group" aria-label="Backtest mode"></span></span></div>
        <div class="card-sub">${isR ? 'Each result is entered in R and sized at your risk % of the running balance, compounding.' : 'Your v1 spreadsheet model: enter each trade’s % move as points (10 pts = 1%), compounding.'}</div>
        <div class="bt-controls">
          <div class="field"><label for="bt-start">Starting account</label><input class="input mono" id="bt-start" data-bt-start data-fk="bt-start" type="number" step="any" min="0" value="${esc(startVal)}"></div>
          <div class="field"><label for="bt-risk">Risk per trade %</label><input class="input mono" id="bt-risk" data-bt-risk data-fk="bt-risk" type="number" step="any" min="0" max="100" value="${esc(riskVal)}" aria-describedby="bt-risk-h">
            <div class="hint${d.riskPct > 2 ? ' warn' : ''}" id="bt-risk-h">${d.riskPct > 2 ? 'Above 2%, normal losing streaks get painful fast.' : isR ? 'Most beginners use 0.5–1%.' : 'Info only in the points model.'}</div></div>
          <div class="field bt-add"><label for="bt-input">Add result ${isR ? 'in R' : 'in points'}</label>
            <div class="bt-addrow"><input class="input mono" id="bt-input" data-bt-input data-fk="bt-input" type="text" autocomplete="off" spellcheck="false" value="${esc(keepVal)}" placeholder="${isR ? 'e.g. 2 or -1' : 'e.g. 25'}" aria-describedby="bt-input-h"><button type="button" class="btn btn-primary btn-sm" data-bt="add" data-fk="bt-add">${ic('plus')}Add</button></div>
            <div class="hint" id="bt-input-h">${esc(hint)}</div></div>
          <button type="button" class="btn btn-ghost btn-sm" data-bt="clear" data-fk="bt-clear"${sim.n ? '' : ' disabled'}>${ic('trash')}Clear all</button>
        </div>
        <div class="bt-main">
          <div class="bt-charts">
            <div><div class="bt-ch-l">Simulated balance</div><div class="chart-box md"><canvas data-bt-cv></canvas><div class="chart-tip"></div></div></div>
            ${isR ? '<div><div class="bt-ch-l">R distribution</div><div class="chart-box sm"><canvas data-bt-hist></canvas><div class="chart-tip"></div></div></div>' : ''}
          </div>
          <div class="kpis bt-kpis">${kpis.join('')}</div>
        </div>
        ${btReadings(sim, d, isR)}
      </section>
      <div class="section-h">Results log<span class="aside">${plural(sim.n, 'result')} · ${isR ? 'R mode' : 'points model'}</span></div>
      <div class="table-wrap bt-tablewrap">
        ${from ? `<div class="bt-more"><button type="button" class="btn btn-ghost btn-xs" data-bt="all">Show all ${sim.n} results</button><span class="dim">showing the latest 200</span></div>` : ''}
        <table class="bt-table"><thead>${head}</thead><tbody>${rowsHtml}</tbody></table>
      </div>`;

    const mEl = el.querySelector('[data-bt-mode]');
    if (mEl) seg(mEl, [{ id: 'r', label: 'R mode' }, { id: 'points', label: 'Points (v1)' }], md, (v) => {
      btMode = v === 'points' ? 'points' : 'r'; lsSet('cj.bt.mode', btMode); btShowAll = false;
      const i = el.querySelector('[data-bt-input]'); if (i) i.value = '';   // R and points values mean different things
      renderBacktest(el); focusSel(el, `[data-bt-mode] button[data-id="${btMode}"]`);
    });
    if (typeof Charts !== 'undefined') {
      const T = tokens();
      const cv = el.querySelector('[data-bt-cv]');
      if (cv) {
        const pts = [{ y: d.start, label: 'Start' }].concat(sim.rows.map(r => ({
          y: r.after, label: '#' + r.n, sub: isR ? fmtR(r.r) : `${r.pts > 0 ? '+' : ''}${fmtNum(r.pts, 2)} pts`,
          extra: View.privacy ? '' : `P/L ${fmtMoney(r.pl, { sign: true })}`,
        })));
        // View.axisMoney goes compact from $1,000, so a $1,000–$1,200 range printed "$1.1K" on two ticks —
        // whole dollars keep each tick distinct for typical backtest balances
        const fmtAxis = (v) => (View.privacy ? '•••' : Math.abs(v) >= 100000 ? View.axisMoney(v) : fmtMoney(v, { dp: Math.abs(v) >= 100 ? 0 : 2 }));
        // a balance curve is a neutral series → validated s1 mark colour (green/red stay for P/L marks)
        const h = Charts.line(cv, cv.parentElement.querySelector('.chart-tip'), sim.n ? pts : [], {
          color: T.s1, baseline: d.start, emptyMsg: 'Add results to see the equity curve',
          fmtY: (v) => (View.privacy ? '•••' : fmtMoney(v)), fmtAxis,
        });
        Charts.label(cv, sim.n ? `Simulated balance over ${plural(sim.n, 'result')}: ${fmtPct(sim.growth, { sign: true })} in total, deepest drop ${fmtPct(sim.maxDD, { dp: 1 })}. Arrow keys step through the results.` : 'No backtest results yet.');
        keyNav(cv, h);
      }
      const hv = el.querySelector('[data-bt-hist]');
      if (hv) {
        Charts.histogram(hv, hv.parentElement.querySelector('.chart-tip'), d.points, { mean: sim.expR, unit: 'result', emptyMsg: 'Your R distribution appears here' });
        Charts.label(hv, sim.n ? `Distribution of ${plural(sim.n, 'result')} in R; average ${fmtR(sim.expR)}.` : 'No results yet.');
      }
    }
    el.onclick = (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-bt]');
      if (!b || !el.contains(b) || b.disabled) return;
      const a = b.dataset.bt;
      if (a === 'add') addResults(el);
      else if (a === 'clear') clearAll();
      else if (a === 'del') delResult(+b.dataset.i);
      else if (a === 'all') { btShowAll = true; renderBacktest(el); }
    };
    el.onkeydown = (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing && ev.target.matches && ev.target.matches('[data-bt-input]')) { ev.preventDefault(); addResults(el); }
    };
    el.onchange = (ev) => {
      const t = ev.target;
      if (!t.matches) return;
      if (t.matches('[data-bt-start]')) setNum(t, 'start');
      else if (t.matches('[data-bt-risk]')) setNum(t, 'riskPct');
    };
    if (btScrollEnd) { btScrollEnd = false; const w = el.querySelector('.bt-tablewrap'); if (w) w.scrollTop = w.scrollHeight; }
    restoreFocus(el);
  }

  /* ── Page registration ──────────────────────────────────── */
  if (typeof Pages !== 'undefined') {
    Pages.register('playbook', {
      title: 'Playbook',
      sub: () => { const n = activeStrategies().length; return `${plural(n, 'active setup')} · results from your ${modeName()} trades`; },
      render: renderPlaybook,
    });
    Pages.register('routine', {
      title: 'Daily Routine',
      sub: () => { const s = streakInfo().current; return s ? `Prepare · Trade · Reflect — ${s}-day streak` : 'Prepare · Trade · Reflect — small reps, every day'; },
      render: renderRoutine,
      onLeave: () => { rtOffset = 0; },
    });
    Pages.register('backtest', {
      title: 'Backtesting',
      sub: () => 'A manual log of replayed trades — prove a setup before you risk money',
      render: renderBacktest,
    });
  }

  return {
    editStrategy, checklistFor, activeStrategies, routineProgress, openTemplates,
    templates: () => clone(TEMPLATES),
  };
})();
