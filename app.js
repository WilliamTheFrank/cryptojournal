/* ═══════════════════════════════════════════════════════════
   CryptoJournal — app shell + dashboard
   Owns: navigation, PAPER/LIVE/DEMO switching, topbar (units,
   privacy, ticker, net status, balance), global banners, price
   refresh loop, and the Dashboard page. Every other page lives in
   its own module and registers itself with Pages.register().
   ═══════════════════════════════════════════════════════════ */
const App = (() => {
  const MODE_LABEL = { paper: 'Paper', live: 'Live', demo: 'Demo' };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  let eqMode = lsGet('cj.eq', 'pnl');       // 'pnl' | 'balance' | 'pct'
  let calOffset = 0;                         // months from today on the dashboard calendar
  let priceTimer = null;

  /* ── Small formatting helpers (unit/privacy aware) ── */
  const units = () => S().units || '$';
  const unitHtml = (obj, opts) => (units() === '$' ? `<span class="money">${fmtUnit(obj, opts)}</span>` : fmtUnit(obj, opts));
  const moneyText = (v, opts) => (View.privacy ? '•••' : fmtMoney(v, opts));
  // Calendar cells are ~35px wide on the dashboard, so $ values drop the symbol there (sign + colour carry P/L)
  function compactUnit(v, bare) {
    if (!isNum(v)) return '—';
    const u = units();
    if (u === 'R') return fmtR(v, 1);
    if (u === '%') return fmtPct(v, { sign: true, dp: 1 });
    if (View.privacy) return '•••';
    const a = Math.abs(v);
    return signed(v, (bare ? '' : '$') + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : a.toFixed(0)), { sign: true });
  }
  const sideBadge = (side) => `<span class="badge ${side === 'short' ? 'short' : 'long'}">${side === 'short' ? '↘ SHORT' : '↗ LONG'}</span>`;
  const resultBadge = (g) => (!g.closed ? '<span class="badge open">OPEN</span>' : g.win ? '<span class="badge win">✓ WIN</span>' : g.loss ? '<span class="badge loss">✕ LOSS</span>' : '<span class="badge be">– BE</span>');
  const call = (fn) => { try { return fn(); } catch (e) { console.error(e); return undefined; } };

  /* ── Mode switching (PAPER ↔ LIVE needs confirmation) ── */
  async function switchMode(mode) {
    if (!MODES.includes(mode) || mode === db.mode) return;
    if (mode === 'live') {
      const live = computeFor('live');
      const stage = S().ramp && S().ramp.enabled ? S().ramp.stage : null;
      const r = typeof Readiness !== 'undefined' && Readiness.evaluate ? call(() => Readiness.evaluate()) : null;
      const verdict = r ? { ready: 'Your paper evidence supports a small live start.', close: 'Readiness: getting close — evidence is still building.', keep: 'Readiness: keep paper trading — at least one gate is not met yet.' }[r.verdict] : '';
      const ok = await confirmDialog({
        title: 'Switch to LIVE trading?',
        html: `Live mode records <b>real-money</b> trades in a separate account. Your paper journal stays untouched.<br><br>
          Live balance: <b class="money">${fmtMoney(live.balance)}</b> (starting <span class="money">${fmtMoney(live.startingBalance)}</span>).<br>
          ${stage ? `Risk per trade is capped at <b>${RAMP_STAGES[stage]}%</b> by your ramp stage ${stage} of 4.` : 'The staged risk ramp is off.'}
          ${verdict ? `<br><br>${esc(verdict)}` : ''}`,
        confirmText: 'Switch to Live', cancelText: 'Stay in ' + MODE_LABEL[db.mode],
      });
      if (!ok) { updateChrome(); return; }
    }
    if (mode === 'demo' && typeof Demo !== 'undefined') call(() => Demo.ensure());
    if (db.mode !== 'demo') db.prevMode = db.mode;
    db.mode = mode;
    save(); applyTheme(); recompute();
    Bus.emit('mode', mode);
    updateChrome(); renderBanners(); Router.render();
    toast(mode === 'live' ? 'Live mode — real money, real rules' : mode === 'demo' ? 'Demo account — sample data, explore freely' : 'Paper trading mode', mode === 'live' ? 'warn' : 'ok');
  }
  const leaveDemo = () => switchMode(db.prevMode && db.prevMode !== 'demo' ? db.prevMode : 'paper');

  /* ── Chrome: topbar, nav badges, mode card ── */
  function updateChrome() {
    const m = db.mode;
    const sw = $('#mode-switch');
    if (sw) { sw.dataset.mode = m; $$('#mode-switch [data-mode-btn]').forEach(b => { b.classList.toggle('on', b.dataset.modeBtn === m); b.setAttribute('aria-pressed', b.dataset.modeBtn === m); }); }
    const note = $('#mode-note');
    if (note) note.textContent = m === 'live' ? (S().ramp.enabled ? `Real money · risk cap ${RAMP_STAGES[S().ramp.stage]}% (stage ${S().ramp.stage}/4)` : 'Real money') : m === 'demo' ? 'Sample data — nothing here is real' : 'Practice account — no real money';
    const dl = $('#demo-link'); if (dl) dl.textContent = m === 'demo' ? 'Exit demo' : 'Demo';
    const pill = $('#mode-pill'); if (pill) pill.textContent = MODE_LABEL[m];
    $('#balance-lbl').textContent = MODE_LABEL[m] + ' Balance';
    $('#balance-val').textContent = C ? fmtMoney(C.balance) : '—';
    // units + privacy
    $$('#unit-seg [data-unit]').forEach(b => { const on = b.dataset.unit === units(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const pv = $('#unit-seg [data-privacy]');
    if (pv) { pv.classList.toggle('on', View.privacy); pv.setAttribute('aria-pressed', View.privacy); pv.innerHTML = `<svg><use href="#i-${View.privacy ? 'eye-off' : 'eye'}"/></svg>`; }
    // nav badges
    if (C) {
      const n = C.groups.length;
      const tc = $('#nav-trade-count'); if (tc) tc.textContent = n;
      const unrev = C.closedGroups.filter(g => !Metrics.isReviewed(g.trade)).length;
      const jb = $('#nav-journal-badge');
      if (jb) { jb.textContent = unrev; jb.classList.toggle('hidden', !unrev); jb.classList.add('warn'); jb.title = `${unrev} closed trade${unrev === 1 ? '' : 's'} to review`; }
    }
    const sb = $('#nav-settings-badge');
    if (sb) sb.classList.toggle('hidden', !backupOverdue());
    // hide nav items whose module failed to load
    $$('.nav-item[data-page]').forEach(b => b.classList.toggle('hidden', !Pages.has(b.dataset.page)));
    // title
    const def = Pages.get(Router.active);
    if (def) {
      $('#topbar-title').textContent = def.title || '';
      $('#topbar-sub').textContent = def.sub ? (call(() => def.sub()) || '') : '';
      document.title = (def.title ? def.title + ' · ' : '') + 'CryptoJournal';
    }
  }

  /* ── Banners: storage recovery, demo, backup reminder ── */
  function backupAgeDays() { return typeof Store !== 'undefined' && Store.backupAgeDays ? call(() => Store.backupAgeDays()) : null; }
  function backupOverdue() {
    if (realTradeCount() < 5) return false; // demo trades don't need backing up
    const age = backupAgeDays();
    return age == null || age > 7;
  }
  function renderBanners() {
    const el = $('#banners'); if (!el) return;
    let html = '';
    if (StorageGuard.loadError) {
      html += typeof Settings !== 'undefined' && Settings.recoveryBanner ? call(() => Settings.recoveryBanner()) || ''
        : `<div class="banner err" role="alert"><svg><use href="#i-alert"/></svg><div class="grow"><b>Your saved journal could not be read.</b> A copy was kept safe and nothing has been overwritten. Open Settings → Data to recover it.</div></div>`;
    }
    if (db.mode === 'demo') {
      html += `<div class="banner info db-demo"><svg><use href="#i-sparkle"/></svg><div class="grow"><b>You're exploring demo data.</b> Nothing here touches your paper or live journal.</div>
        <div class="acts"><button class="btn btn-ghost btn-xs" type="button" data-bn="leave-demo">Back to ${MODE_LABEL[db.prevMode && db.prevMode !== 'demo' ? db.prevMode : 'paper']}</button></div></div>`;
    }
    const snooze = +lsGet('cj.bkSnooze', 0);
    if (!StorageGuard.loadError && backupOverdue() && Date.now() > snooze) {
      const age = backupAgeDays();
      html += `<div class="banner"><svg><use href="#i-download"/></svg><div class="grow"><b>${age == null ? "You haven't backed up your journal yet." : `Last backup was ${Math.floor(age)} days ago.`}</b> Your data lives only in this browser — keep a copy somewhere safe (a OneDrive folder works well).</div>
        <div class="acts"><button class="btn btn-primary btn-xs" type="button" data-bn="backup">Back up now</button><button class="btn btn-ghost btn-xs" type="button" data-bn="auto">Automatic backups</button><button class="btn btn-quiet btn-xs" type="button" data-bn="snooze">Later</button></div></div>`;
    }
    el.innerHTML = html;
    if (StorageGuard.loadError && typeof Settings !== 'undefined' && Settings.bindRecovery) call(() => Settings.bindRecovery(el));
    el.querySelectorAll('[data-bn]').forEach(b => b.onclick = () => {
      const a = b.dataset.bn;
      if (a === 'leave-demo') leaveDemo();
      else if (a === 'backup' && typeof Store !== 'undefined') { call(() => Store.exportJSON()); setTimeout(() => { renderBanners(); updateChrome(); }, 400); }
      else if (a === 'auto' && typeof Settings !== 'undefined') Settings.show('data');
      else if (a === 'snooze') { lsSet('cj.bkSnooze', String(Date.now() + 3 * 86400000)); renderBanners(); }
    });
  }

  /* ── Connectivity + live prices ── */
  function updateNetStatus(reconnected) {
    const el = $('#net-status'); if (!el) return;
    el.classList.remove('offline', 'reconnect');
    if (!navigator.onLine) {
      el.classList.add('offline'); $('#net-status-text').textContent = 'Offline';
      el.title = 'You are offline — live prices are paused. Everything else works.';
    } else if (reconnected) {
      el.classList.add('reconnect'); $('#net-status-text').textContent = 'Back online — updating prices';
      el.title = 'Connection restored — refreshing the live price feed.';
    }
  }
  const watchSymbols = () => [...new Set(['BTC', 'ETH', ...(C ? C.openRows.map(r => (r.coin || '').toUpperCase()).filter(Boolean) : []), 'PLS'])].slice(0, 8);
  function quote(sym) {
    if (typeof Market !== 'undefined' && Market.cached) return call(() => Market.cached(sym)) || null;
    return null;
  }
  function renderTicker() {
    const el = $('#ticker'); if (!el) return;
    if (typeof Market !== 'undefined' && Market.attribution) el.setAttribute('aria-label', 'Live prices. ' + Market.attribution);
    el.title = typeof Market !== 'undefined' && Market.attribution ? Market.attribution : '';
    el.innerHTML = ['BTC', 'ETH', 'SOL', 'PLS'].map(s => {
      const q = quote(s); if (!q || !isNum(q.usd)) return '';
      const chg = isNum(q.chg) ? q.chg : 0;
      return `<div class="tick ${q.stale ? 'stale' : ''}" title="${esc(s)} ${esc(fmtPriceText(q.usd))}${q.at ? ' · as of ' + esc(fmtTime(q.at)) : ''}${q.source ? ' · ' + esc(q.source) : ''}"><span class="sym">${esc(s)}</span><span class="mono">${fmtPrice(q.usd)}</span>
        <span class="chg ${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(1)}%</span></div>`;
    }).join('');
  }
  async function refreshPrices() {
    if (navigator.onLine === false || document.hidden) return;
    const syms = [...new Set([...watchSymbols(), 'SOL'])];
    if (typeof Market !== 'undefined' && Market.prices) await call(() => Market.prices(syms));
    else if (typeof CG !== 'undefined') await call(() => CG.fetchPrices(syms.map(s => CG.idFor(s)).filter(Boolean)));
    renderTicker();
  }

  /* ═══ Dashboard ═══════════════════════════════════════ */
  function kpi(o) {
    return `<div class="kpi ${o.cls || ''}" ${o.onclick ? `role="button" tabindex="0" data-kpi="${o.onclick}"` : ''}>
      <div class="k-lbl">${o.label}${o.tip || ''}</div>
      <div class="k-val ${o.valCls || ''}">${o.value}</div>
      ${o.delta ? `<div class="k-delta">${o.delta}</div>` : ''}
      ${o.sub ? `<div class="k-sub">${o.sub}</div>` : ''}
      ${o.foot ? `<div class="k-foot">${o.foot}</div>` : ''}</div>`;
  }

  function onboarding() {
    // The checklist is about the paper account (balance, first trades) — only shown there
    if (S().onboardingDismissed || db.mode !== 'paper') return '';
    const ob = db.onboard || {};
    const paper = acct('paper');
    const trades = liveEntries().filter(e => e.type === 'trade');
    const steps = [
      { id: 'balance', label: 'Confirm your paper balance', sub: `Starts at ${fmtMoney(paper.startingBalance)} — match the money you plan to trade live.`, done: !!ob.balance, act: 'balance' },
      { id: 'risk', label: 'Set your risk rules', sub: `Max ${S().risk.maxRiskPct}% per trade, ${S().risk.maxDailyLossPct}% daily loss limit.`, done: !!ob.risk, act: 'risk' },
      { id: 'playbook', label: 'Write one strategy in the Playbook', sub: 'Entry and exit rules turn into your pre-trade checklist.', done: db.strategies.some(s => (s.entry || []).length || (s.checklist || []).length), act: 'playbook' },
      { id: 'trade', label: 'Log a paper trade with a stop', sub: 'Every trade needs a stop — it is what R is measured against.', done: trades.some(e => isNum(e.stopPrice)), act: 'trade' },
      { id: 'journal', label: "Plan today's session", sub: 'A 2-minute pre-market plan and readiness check-in.', done: !!dayRec(todayISO()), act: 'journal' },
      { id: 'review', label: 'Review a closed trade', sub: 'Tag mistakes (or mark it clean) and grade your process.', done: C.closedGroups.some(g => Metrics.isReviewed(g.trade)), act: 'review' },
    ];
    const done = steps.filter(s => s.done).length;
    if (done === steps.length) return '';
    return `<div class="card onboard db-onboard">
      <div class="card-title"><svg><use href="#i-flag"/></svg>Get set up · ${done} of ${steps.length} done
        <span class="aside"><button class="btn btn-ghost btn-xs" type="button" data-ob="demo"><svg><use href="#i-sparkle"/></svg>Explore with demo data</button><button class="btn btn-quiet btn-xs" type="button" data-ob="dismiss">Hide</button></span></div>
      <div class="progress-track" style="margin:-4px 0 14px"><div class="progress-fill" style="width:${done / steps.length * 100}%"></div></div>
      <div class="ob-steps">${steps.map((s, i) => `<button type="button" class="ck ${s.done ? 'done' : ''}" data-ob="${s.act}">
        <span class="cb">${s.done ? '<svg><use href="#i-check"/></svg>' : `<span class="dim" style="font-size:11px;font-weight:800">${i + 1}</span>`}</span>
        <span><span class="ct">${esc(s.label)}</span><span class="cs" style="display:block">${esc(s.sub)}</span></span></button>`).join('')}</div></div>`;
  }
  function bindOnboarding(root) {
    root.querySelectorAll('[data-ob]').forEach(b => b.onclick = () => {
      const a = b.dataset.ob, ob = db.onboard || (db.onboard = {});
      if (a === 'dismiss') { S().onboardingDismissed = true; commit(); return; }
      if (a === 'demo') { switchMode('demo'); return; }
      if (a === 'balance') { ob.balance = true; save(); if (typeof Settings !== 'undefined') Settings.show('account'); return; }
      if (a === 'risk') { ob.risk = true; save(); if (typeof Settings !== 'undefined') Settings.show('risk'); return; }
      if (a === 'playbook') return Router.go('playbook');
      if (a === 'trade') return typeof TradeForm !== 'undefined' && TradeForm.open(null);
      if (a === 'journal') return typeof Journal !== 'undefined' ? Journal.openDay(todayISO()) : Router.go('journal');
      if (a === 'review') { const g = C.closedGroups.find(x => !Metrics.isReviewed(x.trade)); if (g && typeof TradeForm !== 'undefined') TradeForm.review(g.trade.id); else Router.go('trades'); }
    });
  }

  function heroKpis(gs, s) {
    const rs = gs.map(g => g.R).filter(isNum);
    const sumR = rs.reduce((a, v) => a + v, 0);
    const heroObj = { netPL: s.pl, changePct: s.totalReturn, R: rs.length ? sumR : null };
    // trend vs the previous 20 trades (needs 40 to compare like with like)
    let delta = '';
    if (gs.length >= 40) {
      const a = Metrics.summary(gs.slice(-20)), b = Metrics.summary(gs.slice(-40, -20));
      if (isNum(a.expR) && isNum(b.expR)) { const d = a.expR - b.expR; delta = `<span class="${plClass(d)}">${glyph(d)} ${fmtR(d)}</span><span class="dim">expectancy vs prior 20 trades</span>`; }
    } else if (gs.length >= 10) {
      const a = Metrics.summary(gs.slice(-10));
      if (isNum(a.expR)) delta = `<span class="${plClass(a.expR)}">${fmtR(a.expR)}</span><span class="dim">avg over your last 10 trades</span>`;
    }
    const sparkVals = []; let acc = 0;
    for (const g of gs.slice(-30)) { acc += rs.length ? (isNum(g.R) ? g.R : 0) : g.netPL; sparkVals.push(acc); }
    const spark = sparkVals.length > 1 ? Charts.spark(sparkVals, { w: 110, h: 30, color: acc >= 0 ? Charts.tokens().up : Charts.tokens().down }) : '';
    const tips = (k, f) => tipFor(k, f);
    // % figures need money in the account; with a $0 balance show drawdown in $ instead
    const measurable = balanceMeasurable(C);
    const ddAlert = measurable && s.maxDDPct < -0.1;
    // sign/colour follow the value actually shown (R or % can disagree with $ after costs/flows)
    const uv = units() === 'R' ? heroObj.R : units() === '%' && measurable ? heroObj.changePct : s.pl;
    const heroVal = units() === '%' && !measurable ? `<span class="money">${fmtMoney(s.pl, { sign: true })}</span>` : unitHtml(heroObj);
    const expGated = s.rN < 20, winGated = s.n < 20;
    return `<div class="kpis db-kpis">
      ${kpi({ cls: 'hero', label: 'Net P/L', tip: tips('netPL', 'Profit or loss of closed trades after fees, funding and gas.'), value: gs.length ? `<span class="${plClass(uv)}">${glyph(uv)} ${heroVal}</span>` : '—', delta, sub: gs.length ? `${s.n} closed trade${s.n === 1 ? '' : 's'} · ${confBadge(s.n)}` : 'No closed trades yet', foot: spark })}
      ${kpi({ label: 'Expectancy', tip: tips('expR', 'Average net R per trade — what one trade is worth.'), cls: expGated ? 'gated' : '', value: isNum(s.expR) ? `<span class="${expGated ? '' : plClass(s.expR)}">${fmtR(s.expR)}</span>` : '—', valCls: '', sub: !isNum(s.expR) ? 'Needs trades with a stop' : expGated ? `needs 20+ trades with a stop (${s.rN} so far)` : s.ci95 && s.rN >= 30 ? `likely ${fmtR(s.ci95.lo)} to ${fmtR(s.ci95.hi)}` : `${money(s.avgPL, { sign: true })} per trade · ${s.rN} with a stop`, onclick: 'analytics' })}
      ${kpi({ label: 'Win rate', tip: tips('winRate', 'Share of closed trades that made money after costs.'), cls: winGated ? 'gated' : '', value: isNum(s.winRate) ? fmtPct(s.winRate, { dp: 0 }) : '—', sub: winGated ? `${s.wins}W · ${s.losses}L · ${s.be}BE — needs 20+ trades` : s.beWinRate != null ? `<span class="${s.winEdge === 'green' ? 'pos' : s.winEdge === 'red' ? 'neg' : 'warn-c'}">●</span> need ${fmtPct(s.beWinRate, { dp: 0 })} to break even` : `${s.wins}W · ${s.losses}L · ${s.be}BE` })}
      ${kpi({ label: 'Profit factor', tip: tips('profitFactor', 'Gross wins ÷ gross losses. Above 1 makes money.'), cls: s.pfReliable ? '' : 'gated', value: s.profitFactor == null ? '—' : s.profitFactor === Infinity ? 'n/a' : `<span class="${s.profitFactor >= 1 ? 'pos' : 'neg'}">${s.profitFactor.toFixed(2)}</span>`, sub: s.profitFactor === Infinity ? 'no losing trades yet' : s.pfReliable ? (s.profitFactor >= 1 ? `$${s.profitFactor.toFixed(2)} won per $1 lost` : 'losing more than winning') : 'needs 20 trades & 5 losses' })}
      ${measurable
        ? kpi({ label: 'Max drawdown', tip: tips('maxDD', 'Largest drop from a peak, ignoring deposits and withdrawals.'), cls: ddAlert ? 'alert' : '', value: gs.length ? `<span class="${s.maxDDPct < 0 ? 'neg' : ''}">${fmtPct(s.maxDDPct, { dp: 1 })}</span>` : '—', sub: gs.length ? (s.currentDDPct < -0.0005 ? `now ${fmtPct(s.currentDDPct, { dp: 1 })} below peak` : 'at a new high') : '', onclick: 'risk' })
        : kpi({ label: 'Max drawdown', tip: tips('maxDD', 'Largest drop from a peak in P/L.'), value: gs.length ? `<span class="${s.maxDD$ < 0 ? 'neg' : ''}">${money(s.maxDD$, { sign: true })}</span>` : '—', sub: 'set a starting balance to see it in %', onclick: 'risk' })}
      ${kpi({ label: 'Discipline', tip: tips('adherence', 'Share of recent trades that followed every rule: stop set, risk within limit, no overrides, no mistakes.'), value: s.adherence && s.adherence.pct30 != null ? `<span class="${s.adherence.pct30 >= 0.9 ? 'pos' : s.adherence.pct30 >= 0.7 ? 'warn-c' : 'neg'}">${fmtPct(s.adherence.pct30, { dp: 0 })}</span>` : '—', sub: s.adherence && s.adherence.n30 ? `clean trades (last ${s.adherence.n30})${s.adherence.tiltmeter != null ? ` · tilt ${Math.round(s.adherence.tiltmeter)}` : ''}` : 'rule-following score', onclick: 'process' })}
    </div>`;
  }

  function equityCard(gs, s) {
    return `<div class="card db-eq">
      <div class="card-title"><svg><use href="#i-trend-up"/></svg>Equity & drawdown
        <span class="aside"><span class="seg sm inline" id="db-eq-seg"></span></span></div>
      <div class="chart-box lg"><canvas id="db-eq-cv"></canvas><div class="chart-tip" id="db-eq-tip"></div></div>
      <div class="chart-cap">${gs.length && !balanceMeasurable(C) ? `
        <span>Max drawdown <b class="neg">${money(s.maxDD$, { sign: true })}</b></span>
        <span class="dim">Set a starting balance (Settings → Account) to measure returns and drawdown in %.</span>` : gs.length ? `
        <span>Max drawdown <b class="neg">${fmtPct(s.maxDDPct, { dp: 1 })}</b></span>
        <span>Current <b class="${s.currentDDPct < 0 ? 'neg' : ''}">${fmtPct(s.currentDDPct, { dp: 1 })}</b></span>
        <span>Longest <b>${s.longestDDms ? Math.max(1, Math.round(s.longestDDms / 86400000)) + ' days' : '—'}</b></span>
        ${s.timeUnderwater != null ? `<span>Time underwater <b>${fmtPct(s.timeUnderwater, { dp: 0 })}</b></span>` : ''}
        <span class="dim">Drawdown is measured on returns, so deposits and withdrawals don't distort it.</span>` : '<span class="dim">Your equity curve and drawdown appear after your first closed trade.</span>'}</div></div>`;
  }
  function drawEquity(gs, s) {
    const cv = $('#db-eq-cv'), tip = $('#db-eq-tip'); if (!cv) return;
    const segEl = $('#db-eq-seg');
    const canPct = balanceMeasurable(C);
    if (!canPct && eqMode === 'pct') eqMode = 'pnl';
    if (segEl) seg(segEl, [{ id: 'pnl', label: 'Trading P/L' }, { id: 'balance', label: 'Balance' }].concat(canPct ? [{ id: 'pct', label: '% return' }] : []), eqMode, (v) => { eqMode = v; lsSet('cj.eq', v); drawEquity(gs, s); });
    const perf = s.perf || Metrics.performance(gs, Date.now());
    const startT = gs.length ? Math.min(Date.parse(gs[0].trade.entryAt) || gs[0].exitMs, gs[0].exitMs) : Date.now();
    let pts = [], flows = [], fmtY, fmtAxis;
    if (eqMode === 'balance') {
      const ddAt = (t) => { let d = 0; for (const p of perf.pts) { if (p.t <= t) d = p.ddPct; else break; } return d; };
      pts = C.equity.map(p => ({ t: p.t, y: p.bal, dd: ddAt(p.t), label: p.row ? (p.row.type === 'deposit' ? 'Deposit' : p.row.type === 'withdrawal' ? 'Withdrawal' : p.row.type === 'adjustment' ? 'Balance adjustment' : (p.row.coin || 'Trade')) + ' · ' + fmtDateShort(p.t) : 'Start' }));
      flows = C.rows.filter(r => r.type === 'deposit' || r.type === 'withdrawal').map(r => ({ t: Date.parse(r.entryAt), amt: r.flowAmount, kind: r.type }));
      fmtY = (v) => moneyText(v); fmtAxis = (v) => View.axisMoney(v);
    } else {
      pts = [{ t: startT, y: 0, dd: 0, label: 'Start' }].concat(perf.pts.map(p => ({
        t: p.t, y: eqMode === 'pct' ? (p.idx - 1) * 100 : p.cum, dd: p.ddPct,
        label: `${p.g.coin || 'Trade'} · ${fmtDateShort(p.t)}`,
        extra: `Trade ${p.g.netPL >= 0 ? '+' : MINUS}${View.privacy ? '•••' : fmtMoney(Math.abs(p.g.netPL))}${isNum(p.g.R) ? ' · ' + fmtR(p.g.R) : ''}`,
      })));
      fmtY = eqMode === 'pct' ? (v) => fmtPct(v / 100, { sign: true }) : (v) => moneyText(v, { sign: true });
      fmtAxis = eqMode === 'pct' ? (v) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0) + '%' : (v) => View.axisMoney(v);
    }
    Charts.equity(cv, tip, pts, { fmtY, fmtAxis, flows, ghost: true, emptyMsg: 'Close your first trade to start the curve', color: Charts.tokens().accent });
    Charts.label(cv, gs.length ? `Equity curve: ${gs.length} closed trades, net ${View.privacy ? 'hidden' : fmtMoney(s.pl, { sign: true })}, max drawdown ${fmtPct(s.maxDDPct, { dp: 1 })}` : 'Equity curve: no closed trades yet');
  }

  function calendarCard() {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + calOffset);
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `<div class="card db-cal">
      <div class="card-title"><svg><use href="#i-calendar"/></svg>
        <button class="btn btn-quiet btn-icon btn-xs" type="button" data-cal="-1" aria-label="Previous month"><svg width="14" height="14"><use href="#i-chevron-l"/></svg></button>
        <span class="db-cal-m">${esc(label)}</span>
        <button class="btn btn-quiet btn-icon btn-xs" type="button" data-cal="1" aria-label="Next month" ${calOffset >= 0 ? 'disabled' : ''}><svg width="14" height="14"><use href="#i-chevron-r"/></svg></button>
        <span class="aside"><button class="link-btn" type="button" data-cal="open">Journal →</button></span></div>
      <div id="db-cal-grid"></div><div class="db-cal-sum" id="db-cal-sum"></div></div>`;
  }
  function drawCalendar(gs) {
    const el = $('#db-cal-grid'); if (!el) return;
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + calOffset);
    const y = d.getFullYear(), m = d.getMonth();
    const dm = Metrics.dailyMap(gs, S().risk.dayResetHour);
    const u = units();
    const notes = new Set(Object.entries(db.days[db.mode] || {}).filter(([, v]) => v && (v.pre || v.post || v.notes)).map(([k]) => k));
    Charts.calendar(el, dm, {
      year: y, month: m, today: todayISO(), notes, clickAll: true,
      // null = no value in this unit (no stop for R, no balance for %) → the cell shows '—', not 0
      value: (x) => (u === 'R' ? (x.rN ? x.r : null) : u === '%' ? (x.groups.some(g => isNum(g.changePct)) ? x.ret : null) : x.pl), fmt: (v) => compactUnit(v, true),
      onDay: (k) => (typeof Journal !== 'undefined' ? Journal.openDay(k) : typeof Ledger !== 'undefined' && Ledger.show({ day: k })),
    });
    // month summary (days without a value in the current unit are left out)
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    const days = [...dm.values()].filter(x => x.key.startsWith(prefix));
    const has = (x) => (u === 'R' ? x.rN > 0 : u === '%' ? x.groups.some(g => isNum(g.changePct)) : true);
    const valued = days.filter(has);
    const tot = u === '%' ? valued.reduce((a, x) => a * (1 + x.ret), 1) - 1 : valued.reduce((a, x) => a + (u === 'R' ? x.r : x.pl), 0);
    const green = days.filter(x => x.pl > 0).length, red = days.filter(x => x.pl < 0).length;
    $('#db-cal-sum').innerHTML = days.length ? `<span>Month <b class="${valued.length ? plClass(tot) : ''}">${valued.length ? compactUnit(tot) : '—'}</b></span><span><b>${days.length}</b> days traded</span><span><b class="pos">${green}</b> green · <b class="neg">${red}</b> red</span>` : '<span class="dim">No trades closed this month yet.</span>';
  }

  function todayCard() {
    const g = Metrics.riskGuard(C, S().risk, Date.now());
    const head = g.state === 'stop' ? { cls: 'stop', t: 'Stop trading for now', s: 'A circuit breaker is tripped. Step away — revenge trades are the most expensive.' }
      : g.state === 'warn' ? { cls: 'warn', t: 'Trade with caution', s: "You're close to one of your limits." }
        : { cls: 'ok', t: 'All clear to trade your plan', s: 'Every guardrail is within limits.' };
    const tasks = db.routine.tasks || [];
    const wk = (db.routine.weeks || {})[Metrics.weekKey(Date.now())] || {};
    const di = (new Date().getDay() + 6) % 7;
    const doneT = tasks.filter(t => (wk[t.id] || [])[di]).length;
    const rec = dayRec(todayISO());
    const fmtVal = (c) => {
      if (c.key === 'daily' || c.key === 'weekly') return `${fmtPct(c.value, { sign: true, dp: 1 })} / ${fmtPct(Math.abs(c.limit), { dp: 0 })} max loss`;
      if (c.key === 'heat' || c.key === 'cluster') return `${fmtPct(c.value, { dp: 1 })} / ${fmtPct(c.limit, { dp: 0 })}`;
      if (c.key === 'cooldown') return c.value == null ? '—' : c.value < c.limit ? `${Math.ceil(c.limit - c.value)} min left` : 'done';
      return `${c.value} / ${c.limit}`;
    };
    return `<div class="card db-today">
      <div class="card-title"><svg><use href="#i-shield"/></svg>Today<span class="aside"><span class="badge ${head.cls === 'stop' ? 'stop' : head.cls === 'warn' ? 'warn' : 'ok'}">${head.cls === 'ok' ? '✓ OK' : head.cls === 'warn' ? '! CAUTION' : '✕ STOP'}</span></span></div>
      <div class="db-today-head ${head.cls}"><b>${head.t}</b><span>${head.s}</span></div>
      <div class="db-today-stats">
        <div><span class="dim">P/L today</span><b class="${plClass(g.plToday)}">${units() === '%' ? fmtPct(g.dayPct, { sign: true }) : money(g.plToday, { sign: true })}</b></div>
        <div><span class="dim">Trades</span><b>${g.tradesToday}${S().risk.maxTradesDay ? ` / ${S().risk.maxTradesDay}` : ''}</b></div>
        <div><span class="dim">Routine</span><b>${tasks.length ? Math.round(doneT / tasks.length * 100) + '%' : '—'}</b></div>
      </div>
      <div class="guard-list">${g.checks.map(c => `<div class="guard ${c.state}" title="${esc(c.hint || '')}"><span class="gi">${c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : '✕'}</span><span class="gl">${esc(c.label)}</span><span class="gv">${fmtVal(c)}</span></div>`).join('')}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-ghost btn-sm" type="button" data-today="plan"><svg><use href="#i-journal"/></svg>${rec && rec.pre ? 'Edit today’s plan' : 'Plan your day'}</button>
        <button class="btn btn-quiet btn-sm" type="button" data-today="routine">Routine</button>
      </div></div>`;
  }

  function openCard() {
    const open = C.groups.filter(g => !g.closed);
    const guard = Metrics.riskGuard(C, S().risk, Date.now());
    if (!open.length) {
      return `<div class="card db-open"><div class="card-title"><svg><use href="#i-clock"/></svg>Open positions</div>
        ${emptyHtml('No open positions', 'Open trades show live P/L and the risk you have on.', [{ id: 'new', label: 'Log a trade', icon: 'plus', primary: true }, { id: 'calc', label: 'Size a position', icon: 'calc' }])}</div>`;
    }
    const rows = open.map(g => {
      const rowsOpen = g.portions.filter(p => !p.closed);
      const q = quote(g.coin);
      const dir = g.side === 'short' ? -1 : 1;
      const upl = q && isNum(q.usd) ? rowsOpen.reduce((a, p) => a + (q.usd - p.entryPrice) * (p.amount || 0) * dir - (p.fees || 0), 0) : null;
      const risk = rowsOpen.reduce((a, p) => a + (isNum(p.riskDollar) ? p.riskDollar : 0), 0);
      const noStop = rowsOpen.some(p => !isNum(p.riskDollar));
      const uR = isNum(upl) && risk > 0 ? upl / risk : null;
      return `<div class="db-pos" data-view="${esc(g.trade.id)}" role="button" tabindex="0">
        <div class="db-pos-l">${coinIcon(g.coin)}<div><div class="row tight"><b>${esc(g.coin || '—')}</b>${sideBadge(g.side)}</div>
          <div class="dim mono db-pos-sub">@ ${fmtPrice(g.trade.entryPrice)}${q && isNum(q.usd) ? ` → ${fmtPrice(q.usd)}${q.stale ? ' <span class="warn-c" title="Price may be stale">(as of ' + esc(fmtTime(q.at)) + ')</span>' : ''}` : ''}</div></div></div>
        <div class="db-pos-r"><div class="mono ${plClass(upl)}">${isNum(upl) ? `${money(upl, { sign: true })}${isNum(uR) ? ` <small>${fmtR(uR)}</small>` : ''}` : '<span class="dim">no live price</span>'}</div>
          <div class="dim db-pos-sub">${noStop ? '<span class="neg">no stop — unlimited risk</span>' : `risk ${money(risk)} · ${fmtPct(C.balance > 0 ? risk / C.balance : null, { dp: 2 })}`}</div></div>
        <button class="btn btn-ghost btn-xs" type="button" data-close="${esc(rowsOpen[0] ? rowsOpen[0].id : '')}">Close</button></div>`;
    }).join('');
    const heatPct = guard.openRiskPct, lim = S().risk.maxOpenRiskPct / 100;
    const heatCls = guard.noStop || heatPct > lim ? 'stop' : heatPct > lim * 0.75 ? 'warn' : 'ok';
    const wc = guard.worstCluster;
    return `<div class="card db-open"><div class="card-title"><svg><use href="#i-clock"/></svg>Open positions<span class="aside">${open.length} open</span></div>
      <div class="meter db-heat"><div class="ml"><span>Open risk (heat) ${tipFor('openRisk', 'Total you would lose if every open stop were hit, as % of your balance.')}</span><b>${guard.noStop ? 'unlimited' : fmtPct(heatPct, { dp: 2 })} <span class="dim">/ ${fmtPct(lim, { dp: 0 })}</span></b></div>
        <div class="progress-track"><div class="progress-fill ${heatCls}" style="width:${Math.min(100, lim ? heatPct / lim * 100 : 0)}%"></div></div>
        ${wc && wc.key !== 'alts' && wc.pct > 0 ? `<div class="dim" style="font-size:11.5px">Largest correlated group: ${esc((CLUSTERS[wc.key] || {}).label || wc.key)} ${fmtPct(wc.pct, { dp: 2 })} of balance${S().risk.maxClusterRiskPct && wc.pct * 100 > S().risk.maxClusterRiskPct ? ' — <span class="warn-c">above your ' + S().risk.maxClusterRiskPct + '% limit</span>' : ''}</div>` : ''}</div>
      <div class="db-pos-list">${rows}</div></div>`;
  }

  function insightsCard(gs) {
    const list = gs.length >= 3 ? (call(() => Metrics.insights(gs, C, metricsCtx())) || []) : [];
    const body = list.length ? `<div class="insights">${list.slice(0, 4).map(x => `<div class="insight ${x.sev}">
        <span class="ii" aria-hidden="true">${x.sev === 'stop' ? '!' : x.sev === 'warn' ? '!' : 'i'}</span>
        <div><div class="it">${esc(x.title)}</div><div class="ix">${esc(x.text)}</div>
        ${x.ids || x.day || x.filter ? `<div class="ia"><button class="link-btn" type="button" data-ins="${esc(x.id)}">View trades</button></div>` : ''}</div></div>`).join('')}</div>`
      : `<div class="empty-state sm"><div class="big">${gs.length < 3 ? 'Insights appear after a few trades' : 'Nothing worrying in your recent trades'}</div><div class="small">The coach looks for tilt days, revenge trades, oversizing, moved stops and weak time slots.</div></div>`;
    return { html: `<div class="card db-ins"><div class="card-title"><svg><use href="#i-brain"/></svg>Coach insights${list.length ? `<span class="aside">${list.length} found</span>` : ''}</div>${body}</div>`, list };
  }

  function readinessCard() {
    if (db.mode === 'live') {
      const st = S().ramp;
      return `<div class="card db-ready"><div class="card-title"><svg><use href="#i-shield"/></svg>Live ramp</div>
        <div class="db-ready-v"><b>${st.enabled ? `Stage ${st.stage} of 4` : 'Ramp off'}</b><span>${st.enabled ? `Risk per trade capped at ${RAMP_STAGES[st.stage]}%. Review after every 25 live trades.` : 'Your full max risk applies in live mode.'}</span></div>
        <button class="btn btn-ghost btn-sm" type="button" data-go="readiness">Open readiness</button></div>`;
    }
    const r = typeof Readiness !== 'undefined' && Readiness.evaluate ? call(() => Readiness.evaluate()) : null;
    if (!r) return `<div class="card db-ready"><div class="card-title"><svg><use href="#i-shield"/></svg>Go-live readiness</div><div class="dim">Open the Readiness page to see your paper → live checklist.</div></div>`;
    const total = r.checks.length;
    const V = { ready: ['ok', 'Evidence supports a small live start'], close: ['warn', 'Getting close — evidence still building'], keep: ['stop', 'Keep paper trading'] }[r.verdict] || ['warn', ''];
    const next = r.gates.find(g => !g.pass) || r.checks.find(c => c.state === 'fail') || r.checks.find(c => c.state === 'partial');
    return `<div class="card db-ready"><div class="card-title"><svg><use href="#i-shield"/></svg>Go-live readiness<span class="aside">paper account</span></div>
      <div class="db-ready-row"><div class="gauge-wrap">${Charts.gauge(total ? r.passed / total : 0, { size: 92, stroke: 9, color: r.verdict === 'ready' ? Charts.tokens().up : r.verdict === 'close' ? Charts.tokens().accentL : Charts.tokens().amber })}<div class="gv"><b>${r.passed}</b><span>of ${total}</span></div></div>
        <div class="db-ready-v"><span class="badge ${V[0]}">${esc(V[1])}</span><span>Gates passed <b>${r.gatesPassed}/${r.gates.length}</b> · ${r.summary.n} paper trades</span>
        ${next ? `<span class="dim">Next: ${esc(next.label)}${next.value ? ` (${esc(next.value)})` : ''}</span>` : ''}</div></div>
      <button class="btn btn-ghost btn-sm" type="button" data-go="readiness" style="margin-top:12px">See the full checklist</button></div>`;
  }

  function recentCard() {
    const list = [...C.groups].sort((a, b) => (b.closed ? b.exitMs : Date.parse(b.trade.entryAt)) - (a.closed ? a.exitMs : Date.parse(a.trade.entryAt))).slice(0, 8);
    if (!list.length) return `<div class="card db-recent"><div class="card-title"><svg><use href="#i-trades"/></svg>Recent trades</div>${emptyHtml('No trades yet', db.mode === 'paper' ? 'Paper trade first — every trade with a stop builds your evidence for going live.' : 'Log your first trade.', [{ id: 'new', label: 'Log a trade', icon: 'plus', primary: true }, { id: 'quick', label: 'Quick log' }, { id: 'demo', label: 'Explore demo data' }])}</div>`;
    return `<div class="card db-recent"><div class="card-title"><svg><use href="#i-trades"/></svg>Recent trades<span class="aside"><button class="link-btn" type="button" data-go="trades">All trades →</button></span></div>
      <div class="db-recent-list">${list.map(g => `<div class="db-rt" role="button" tabindex="0" data-view="${esc(g.trade.id)}">
        ${coinIcon(g.coin)}<div class="db-rt-m"><div class="row tight"><b>${esc(g.coin || '—')}</b>${sideBadge(g.side)}${resultBadge(g)}${g.closed && !Metrics.isReviewed(g.trade) ? '<span class="badge warn sm">REVIEW</span>' : ''}</div>
        <div class="dim db-rt-s">${esc(stratName(g.strategyId))} · ${fmtDateShort(g.closed ? g.exitMs : Date.parse(g.trade.entryAt))}${g.trade.grade ? ` · grade ${esc(g.trade.grade)}` : ''}</div></div>
        <div class="db-rt-v mono ${plClass(g.netPL)}">${g.closed ? unitHtml({ netPL: g.netPL, changePct: g.changePct, R: g.R }) : '<span class="dim">open</span>'}</div></div>`).join('')}</div></div>`;
  }

  function renderDash(el) {
    const gs = Metrics.filterGroups(C.groups, {});
    const s = Metrics.summary(gs, metricsCtx());
    const ins = insightsCard(gs);
    el.innerHTML = `${onboarding()}${heroKpis(gs, s)}
      <div class="db-grid">
        <div class="db-a">${equityCard(gs, s)}</div>
        <div class="db-b">${calendarCard()}</div>
        <div class="db-c">${todayCard()}</div>
        <div class="db-d">${openCard()}</div>
        <div class="db-e">${ins.html}</div>
        <div class="db-f">${readinessCard()}</div>
        <div class="db-g">${recentCard()}</div>
      </div>`;
    bindOnboarding(el);
    drawEquity(gs, s);
    drawCalendar(gs);
    // interactions
    el.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => {
      const v = b.dataset.cal;
      if (v === 'open') return Router.go('journal');
      calOffset = Math.min(0, calOffset + (+v)); Router.render();
    });
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => Router.go(b.dataset.go));
    el.querySelectorAll('[data-kpi]').forEach(k => {
      const go = () => (typeof Analytics !== 'undefined' ? Analytics.show(k.dataset.kpi === 'analytics' ? 'overview' : k.dataset.kpi, {}) : Router.go('analytics'));
      k.onclick = go; k.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } };
    });
    el.querySelectorAll('[data-view]').forEach(r => {
      const open = () => typeof TradeForm !== 'undefined' && TradeForm.view(r.dataset.view);
      r.onclick = (ev) => { if (ev.target.closest('button')) return; open(); };
      r.onkeydown = (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === r) { ev.preventDefault(); open(); } };
    });
    el.querySelectorAll('[data-close]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); if (typeof TradeForm !== 'undefined' && b.dataset.close) TradeForm.close(b.dataset.close); });
    el.querySelectorAll('[data-today]').forEach(b => b.onclick = () => (b.dataset.today === 'plan' ? (typeof Journal !== 'undefined' ? Journal.openDay(todayISO()) : Router.go('journal')) : Router.go('routine')));
    el.querySelectorAll('[data-ins]').forEach(b => b.onclick = () => {
      const x = ins.list.find(i => i.id === b.dataset.ins); if (!x || typeof Ledger === 'undefined') return;
      Ledger.show(x.ids ? { ids: x.ids } : x.day ? { day: x.day } : x.filter || {});
    });
    bindEmpty(el, {
      new: () => typeof TradeForm !== 'undefined' && TradeForm.open(null),
      quick: () => typeof TradeForm !== 'undefined' && TradeForm.quick(),
      calc: () => Router.go('calc'),
      demo: () => switchMode('demo'),
    });
  }

  Pages.register('dash', {
    title: 'Dashboard',
    sub: () => {
      const n = C ? C.closedGroups.length : 0;
      return db.mode === 'paper' ? `Paper trading · ${n} closed trade${n === 1 ? '' : 's'} — build the evidence before risking money` : db.mode === 'live' ? `Live trading · ${n} closed trade${n === 1 ? '' : 's'}` : 'Demo account · sample data';
    },
    render: renderDash,
  });

  /* ── Init ── */
  function bindChrome() {
    $$('.nav-item[data-page]').forEach(b => b.onclick = () => Router.go(b.dataset.page));
    $$('#mode-switch [data-mode-btn]').forEach(b => b.onclick = () => switchMode(b.dataset.modeBtn));
    const dl = $('#demo-link');
    if (dl) { const f = () => (db.mode === 'demo' ? leaveDemo() : switchMode('demo')); dl.onclick = f; dl.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); f(); } }; }
    $$('#unit-seg [data-unit]').forEach(b => b.onclick = () => { View.setUnits(b.dataset.unit); updateChrome(); });
    const pv = $('#unit-seg [data-privacy]'); if (pv) pv.onclick = () => { View.setPrivacy(!View.privacy); updateChrome(); };
    const bp = $('#balance-pill');
    if (bp) { const f = () => typeof TradeForm !== 'undefined' && TradeForm.adjust(); bp.onclick = f; bp.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); f(); } }; }
    const nt = $('#btn-new-trade-top'); if (nt) nt.onclick = () => typeof TradeForm !== 'undefined' && TradeForm.open(null);
    const ck = $('#btn-cmdk'); if (ck && !ck.onclick) ck.onclick = () => typeof Palette !== 'undefined' && Palette.open();
  }
  function init() {
    applyTheme();
    recompute();
    bindChrome();
    Bus.on('page', (id) => { updateChrome(); try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// */ } });
    Bus.on('refresh', () => { updateChrome(); renderBanners(); });
    Bus.on('saved', () => { const sb = $('#nav-settings-badge'); if (sb) sb.classList.toggle('hidden', !backupOverdue()); });
    Bus.on('view', () => updateChrome());
    Bus.on('settings', () => { applyTheme(); updateChrome(); });
    // live prices re-render the dashboard (debounced) and the ticker
    const rePrice = debounce(() => { renderTicker(); if (Router.active === 'dash' && !document.querySelector('.modal-backdrop.open')) Router.render(); }, 400);
    Bus.on('prices', rePrice);
    // Only a real width change re-renders (a phone keyboard opening changes height and would steal focus)
    let lastW = window.innerWidth;
    window.addEventListener('resize', debounce(() => { if (Math.abs(window.innerWidth - lastW) < 2) return; lastW = window.innerWidth; Router.render(); }, 180));
    window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (Pages.has(h) && h !== Router.active) Router.go(h); });
    // Cross-window sync: another window wrote the journal → reload instead of clobbering it.
    // A modal/drawer may be editing the old data: the redraw waits until it closes.
    let pendingSync = false;
    const applySync = () => { pendingSync = false; updateChrome(); renderBanners(); Router.render(); };
    window.addEventListener('storage', (ev) => {
      if (ev.key !== DB_KEY || ev.newValue == null) return;
      const prevMode = db.mode;
      db = load({ fromSync: true }); applyTheme(); recompute();
      if (db.mode !== prevMode) Bus.emit('mode', db.mode);
      Bus.emit('refresh');
      if (document.querySelector('.modal-backdrop.open, .drawer-wrap')) pendingSync = true; else applySync();
      toast('Journal updated from another window');
    });
    // Cloud sync (sync.js) applied changes from another device: same redraw rules as a cross-window update
    Bus.on('remote', () => { if (document.querySelector('.modal-backdrop.open, .drawer-wrap')) pendingSync = true; else applySync(); });
    // run a deferred sync once the last layer closes
    new MutationObserver(() => { if (pendingSync && !document.querySelector('.modal-backdrop.open, .drawer-wrap')) applySync(); })
      .observe(document.body, { childList: true });
    // Connectivity: the app runs fully offline; the live price feed upgrades when online.
    updateNetStatus();
    window.addEventListener('offline', () => { updateNetStatus(); Bus.emit('net', { online: false }); });
    window.addEventListener('online', () => {
      updateNetStatus(true); Bus.emit('net', { online: true });
      if (typeof CG !== 'undefined') call(() => CG.resetBackoff());
      refreshPrices();
      setTimeout(updateNetStatus, 4000);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPrices(); });
    const start = location.hash.slice(1);
    Router.go(Pages.has(start) ? start : 'dash', { instant: true });
    updateChrome(); renderBanners(); renderTicker();
    refreshPrices();
    priceTimer = setInterval(refreshPrices, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { go: (id) => Router.go(id), switchMode, leaveDemo, refreshPrices, updateChrome, renderBanners };
})();
