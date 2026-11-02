/* ═══════════════════════════════════════════════════════════
   CryptoJournal — command palette (Ctrl+K / ⌘K) + global shortcuts
   An accelerator on top of the sidebar, never a replacement:
   grouped commands with their key hints, recent commands when the
   input is empty, fuzzy subsequence matching with <mark>ed letters,
   and search across trades, strategies, patterns and metric terms.
   Owns every single-key shortcut (N, Q, C, /, G-chords, ?, Shift+P).
   ═══════════════════════════════════════════════════════════ */
const Palette = (() => {
  const LS_RECENT = 'cj.recentCmds', MAX_RECENT = 5, CHORD_MS = 1200;
  const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);
  const MAC = /Mac|iPhone|iPad/.test(String(navigator.platform || '') + ' ' + String(navigator.userAgent || ''));
  const ok = (f, d) => { try { return f(); } catch (e) { return d; } };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

  /* ── Other modules (later scripts may be missing or have failed to load) ── */
  const M = {
    TradeForm: () => (typeof TradeForm !== 'undefined' ? TradeForm : null),
    Journal: () => (typeof Journal !== 'undefined' ? Journal : null),
    Ledger: () => (typeof Ledger !== 'undefined' ? Ledger : null),
    Analytics: () => (typeof Analytics !== 'undefined' ? Analytics : null),
    Settings: () => (typeof Settings !== 'undefined' ? Settings : null),
    Discipline: () => (typeof Discipline !== 'undefined' ? Discipline : null),
    Learn: () => (typeof Learn !== 'undefined' ? Learn : null),
    Store: () => (typeof Store !== 'undefined' ? Store : null),
    Importer: () => (typeof Importer !== 'undefined' ? Importer : null),
    App: () => (typeof App !== 'undefined' ? App : null),
    Sync: () => (typeof Sync !== 'undefined' ? Sync : null),
    SyncUI: () => (typeof SyncUI !== 'undefined' ? SyncUI : null),
  };
  // fn('TradeForm', 'open') → bound function or null; call() resolves at run time and toasts when missing
  const fn = (mod, name) => { const m = ok(M[mod], null); return m && typeof m[name] === 'function' ? m[name].bind(m) : null; };
  function call(mod, name, ...args) {
    const f = fn(mod, name);
    if (!f) { toast('That feature isn’t available right now', 'warn'); return undefined; }
    return f(...args);
  }
  const go = (id) => { if (!Pages.has(id)) return; const g = fn('App', 'go'); if (g) g(id); else Router.go(id); };

  /* ── Static tables ── */
  const NAV_ORDER = ['dash', 'journal', 'trades', 'analytics', 'readiness', 'calc', 'patterns', 'playbook', 'routine', 'backtest', 'import', 'settings'];
  const NAV = {
    dash: { name: 'Dashboard', icon: 'dash', keys: 'G D', kw: 'home overview kpi' },
    journal: { name: 'Journal', icon: 'journal', keys: 'G J', kw: 'calendar diary day plan review' },
    trades: { name: 'Trades', icon: 'trades', keys: 'G T', kw: 'ledger history list positions' },
    analytics: { name: 'Analytics', icon: 'stats', keys: 'G A', kw: 'stats statistics reports performance' },
    readiness: { name: 'Readiness', icon: 'shield', keys: 'G R', kw: 'go live ready evidence checklist ramp' },
    calc: { name: 'Position size', icon: 'calc', keys: 'C', kw: 'calculator risk leverage liquidation size' },
    patterns: { name: 'Learn', icon: 'pattern', keys: 'G L', kw: 'chart patterns metrics guide glossary lessons crypto basics' },
    playbook: { name: 'Playbook', icon: 'book', keys: 'G P', kw: 'strategies setups rules' },
    routine: { name: 'Daily routine', icon: 'routine', kw: 'habits checklist prepare reflect' },
    backtest: { name: 'Backtesting', icon: 'flask', kw: 'backtest simulate points' },
    import: { name: 'Import', icon: 'file-in', kw: 'csv exchange binance bybit okx kraken coinbase mexc' },
    settings: { name: 'Settings', icon: 'gear', keys: 'G S', kw: 'preferences options backup data' },
  };
  const CHORD = { d: 'dash', j: 'journal', t: 'trades', a: 'analytics', r: 'readiness', p: 'playbook', l: 'patterns', s: 'settings' };
  const MODE_INFO = {
    paper: { label: 'Switch to Paper trading', icon: 'journal', sub: 'Practice account — no real money' },
    live: { label: 'Switch to Live trading', icon: 'zap', sub: 'Real-money account — asks you to confirm' },
    demo: { label: 'Explore demo data', icon: 'sparkle', sub: 'Sample account, separate from your journal' },
  };
  const UNIT_INFO = { '$': 'Show results in dollars ($)', '%': 'Show results as % of account', R: 'Show results in R (multiples of risk)' };
  const SETTINGS = [
    ['account', 'Account & balances', 'starting balance start date planned live capital'],
    ['risk', 'Risk rules & ramp', 'max risk daily loss weekly leverage cooldown guardrails ramp reset hour'],
    ['costs', 'Costs & fee presets', 'fees maker taker slippage haircut funding'],
    ['journal', 'Tags & mistakes', 'taxonomy tags mistakes labels emotions'],
    ['appearance', 'Appearance', 'colour color blind palette density theme'],
    ['data', 'Data & backups', 'backup restore snapshot folder export import json'],
    ['trash', 'Trash', 'deleted restore undo'],
    ['demo', 'Demo data', 'sample demo account explore remove'],
    ['danger', 'Danger zone', 'wipe reset delete all erase'],
    ['about', 'About', 'version help'],
  ];
  const ANALYTICS = [
    ['overview', 'Overview', 'summary kpi histogram expectancy win rate'],
    ['risk', 'Risk & drawdown', 'drawdown monte carlo streaks underwater'],
    ['timing', 'Timing', 'sessions weekday hour heat map weekend'],
    ['process', 'Process & mistakes', 'mistakes grades emotions discipline tilt'],
    ['efficiency', 'Efficiency (MAE / MFE)', 'mae mfe exit entry efficiency'],
    ['scenarios', 'What-if scenarios', 'hindsight what if cap loss'],
    ['compare', 'Paper vs live', 'compare transfer welch'],
    ['advanced', 'Advanced stats', 'sharpe sortino sqn kelly ulcer fragility'],
  ];
  // display order when the input is empty; search results are ordered by their best match
  const GROUP_ORDER = ['Recent', 'Actions', 'Go to', 'View', 'Data', 'Help'];
  const CAP = { Trades: 8, Strategies: 5, Patterns: 5, 'Metric guide': 5, Settings: 4, Analytics: 4 };

  /* ── State ── */
  let root = null, input = null, list = null, crumb = null, live = null;
  let isOpen = false, ret = null, cache = null, stack = [], flat = [], sel = 0;
  let gAt = 0, chordEl = null, chordTimer = null;

  /* ── Formatting helpers ── */
  const sideTxt = (s) => (s === 'short' ? 'short' : 'long');
  const pageTitle = (id) => (Pages.get(id) && Pages.get(id).title) || (NAV[id] && NAV[id].name) || id;
  // Unit-aware result that privacy mode can blur ($ only — R and % stay readable)
  function unitVal(g) {
    const v = ok(() => fmtUnit(g), '—');
    return S().units === '$' ? `<span class="money">${esc(v)}</span>` : esc(v);
  }
  function resultMeta(g) {
    if (!g.closed) return '<span class="badge open sm">OPEN</span>';
    // R view of a trade without a stop has no value: show a plain dash, not "▲ —" in green
    if (ok(() => fmtUnit(g), '—') === '—') return '<span class="pl-res dim">—</span>';
    const v = unitVal(g), gl = glyph(g.netPL);
    return `<span class="pl-res ${plClass(g.netPL)}">${gl ? gl + ' ' : ''}${v}</span>`;
  }
  // 'Ctrl+K' → keys pressed together · 'G D' → a sequence · '↑|↓' → alternatives
  function kbds(spec) {
    return String(spec).split(' ').map(step => step.split('|').map(alt => alt.split('+').map(k => `<kbd>${esc(MAC && k === 'Ctrl' ? '⌘' : k)}</kbd>`).join('')).join('<span class="pl-or">/</span>'))
      .join('<span class="pl-then">then</span>');
  }

  /* ── Fuzzy subsequence scorer ── */
  const BOUND = /[\s\-_/·:(“"']/;
  function fuzzy(q, s) {
    if (!s) return null;
    const ql = q.toLowerCase(), sl = String(s).toLowerCase();
    if (!ql) return null;
    const at = sl.indexOf(ql);
    if (at >= 0) {   // contiguous substring beats any scattered match
      const idx = []; for (let i = 0; i < ql.length; i++) idx.push(at + i);
      const boundary = at === 0 || BOUND.test(sl[at - 1]);
      return { score: 100 + (at === 0 ? 30 : boundary ? 18 : 0) + ql.length * 2 - Math.min(at, 20) * 0.5 - Math.min(sl.length, 60) * 0.1, idx };
    }
    const qs = ql.replace(/\s+/g, '');
    if (qs.length < 2) return null;
    let best = null;
    // try a few start positions for the first letter; greedy from an earlier start fails ⇒ later ones fail too
    for (let st = sl.indexOf(qs[0]), tries = 0; st >= 0 && tries < 8; st = sl.indexOf(qs[0], st + 1), tries++) {
      const idx = []; let j = st, hit = true;
      for (const ch of qs) { while (j < sl.length && sl[j] !== ch) j++; if (j >= sl.length) { hit = false; break; } idx.push(j++); }
      if (!hit) break;
      let sc = 0;
      idx.forEach((p, k) => { sc += 6; if (k && p === idx[k - 1] + 1) sc += 9; if (p === 0 || BOUND.test(sl[p - 1])) sc += 10; });
      sc -= (idx[idx.length - 1] - idx[0] + 1 - idx.length) * 1.2 + Math.min(sl.length, 60) * 0.1;
      if (!best || sc > best.score) best = { score: sc, idx };
    }
    return best && best.score >= qs.length * 7 ? best : null;   // reject scattered noise
  }
  // Damerau–Levenshtein distance ≤ 1: one missing, extra, wrong or swapped letter
  function oneEdit(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0; while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  // Typo fallback (4+ letters): the query is one edit away from the start of a word ('dashbaord', 'setings').
  // Scores sit below every exact or subsequence match, so typos never outrank a real hit.
  function typo(q, s) {
    const ql = q.toLowerCase().replace(/\s+/g, ''), sl = String(s || '').toLowerCase();
    if (ql.length < 4 || sl.length !== String(s || '').length) return null;
    const re = /[a-z0-9]+/g; let m, best = null;
    while ((m = re.exec(sl))) {
      const w = m[0];
      for (const len of [ql.length, ql.length + 1, ql.length - 1]) {
        if (len > w.length || len < 3 || !oneEdit(ql, w.slice(0, len))) continue;
        const sc = 24 + ql.length - (m.index ? 4 : 0);
        if (!best || sc > best.score) best = { score: sc, idx: Array.from({ length: len }, (_, k) => m.index + k) };
        break;
      }
    }
    return best;
  }
  // Escape every character first, then wrap matched positions — user text can never inject markup
  function mark(s, idx) {
    s = String(s);
    if (!idx || !idx.length || s.toLowerCase().length !== s.length) return esc(s);
    const set = new Set(idx); let out = '', on = false;
    for (let i = 0; i < s.length; i++) { const m = set.has(i); if (m !== on) { out += m ? '<mark>' : '</mark>'; on = m; } out += esc(s[i]); }
    return on ? out + '</mark>' : out;
  }
  function snippet(text, at, len) {
    const a = Math.max(0, at - 28), b = Math.min(text.length, at + len + 44);
    return `${a > 0 ? '…' : ''}${esc(text.slice(a, at))}<mark>${esc(text.slice(at, at + len))}</mark>${esc(text.slice(at + len, b))}${b < text.length ? '…' : ''}`;
  }
  // loose: also accept one-typo matches (rank() only asks when the strict pass found almost nothing)
  function match(q, it, loose) {
    let best = null;
    const a = fuzzy(q, it.label);
    if (a) best = { score: a.score, html: mark(it.label, a.idx) };
    if (it.kw) { const b = fuzzy(q, it.kw); if (b && (!best || b.score * 0.7 > best.score)) best = { score: b.score * 0.7, html: best ? best.html : esc(it.label) }; }
    if (!best && it.text && q.length >= 2) {
      const low = it.text.toLowerCase(), at = low.indexOf(q.toLowerCase());
      if (at >= 0 && low.length === it.text.length) best = { score: 40 - Math.min(20, at / 20), html: esc(it.label), sub: snippet(it.text, at, q.length) };
    }
    if (!best && loose) {
      const t = typo(q, it.label);
      if (t) best = { score: t.score, html: mark(it.label, t.idx) };
      else if (it.kw) { const k = typo(q, it.kw); if (k) best = { score: k.score * 0.7, html: esc(it.label) }; }
    }
    return best;
  }

  /* ── Command & search items (built once per opening) ── */
  function allItems() {
    if (cache) return cache;
    const out = [], add = (o) => { out.push(o); return o; };
    const groups = typeof C !== 'undefined' && C ? C.groups : [];
    const opens = groups.filter(g => !g.closed);

    // Actions
    if (fn('TradeForm', 'open')) add({ id: 'act:new', group: 'Actions', label: 'New trade', icon: 'plus', keys: 'N', kw: 'add log enter open position buy sell long short', run: () => call('TradeForm', 'open', null) });
    if (fn('TradeForm', 'quick')) add({ id: 'act:quick', group: 'Actions', label: 'Quick log', icon: 'zap', keys: 'Q', kw: 'fast minimal 3 field log', sub: 'Coin, side and price now — the rest later', run: () => call('TradeForm', 'quick') });
    const last = groups.length ? groups[groups.length - 1] : null;
    if (fn('TradeForm', 'duplicateLast') && last) add({ id: 'act:dup', group: 'Actions', label: 'Duplicate last trade', icon: 'copy', kw: 'copy repeat same again clone', sub: `${esc(last.coin || '?')} ${sideTxt(last.side)} · ${esc(stratName(last.strategyId))}`, run: () => call('TradeForm', 'duplicateLast') });
    if (fn('TradeForm', 'close') && opens.length) {
      add({
        id: 'act:close', group: 'Actions', label: 'Close a position…', icon: 'target', kw: 'exit sell take profit stop out partial',
        sub: `${opens.length} open position${opens.length === 1 ? '' : 's'}`,
        children: () => opens.map(g => {
          const row = g.portions.find(p => !p.closed) || g.trade, t = Date.parse(g.trade.entryAt);
          return {
            id: 'close:' + row.id, group: 'Open positions', label: `${g.coin || '?'} ${sideTxt(g.side)}`, iconHtml: coinIcon(String(g.coin || '?')),
            kw: `${g.coin || ''} ${stratName(g.strategyId)}`, sub: `opened ${isFinite(t) ? esc(fmtDateTime(t)) : '—'} · entry ${fmtPrice(row.entryPrice)}${isNum(row.stopPrice) ? ` · stop ${fmtPrice(row.stopPrice)}` : ' · <span class="warn-c">no stop</span>'}`,
            run: () => call('TradeForm', 'close', row.id),
          };
        }),
      });
    }
    if (fn('TradeForm', 'flow')) {
      add({ id: 'act:deposit', group: 'Actions', label: 'Record a deposit', icon: 'download', kw: 'deposit add funds money in transfer', run: () => call('TradeForm', 'flow', 'deposit') });
      add({ id: 'act:withdraw', group: 'Actions', label: 'Record a withdrawal', icon: 'upload', kw: 'withdraw withdrawal money out cash out', run: () => call('TradeForm', 'flow', 'withdrawal') });
    }
    if (fn('TradeForm', 'adjust')) add({ id: 'act:adjust', group: 'Actions', label: 'Adjust balance', icon: 'wallet', kw: 'balance correction set reconcile', run: () => call('TradeForm', 'adjust') });
    if (fn('Journal', 'openDay')) add({ id: 'act:today', group: 'Actions', label: 'Open today’s journal', icon: 'journal', kw: 'day plan pre market readiness check-in post session', run: () => call('Journal', 'openDay', todayISO()) });
    if (fn('Journal', 'openReview')) {
      // Mon–Thu you are usually reviewing the week that just ended; from Friday on, the current one
      const wk = (ms) => ok(() => Metrics.weekKey(ms), null), now = Date.now(), late = (new Date(now).getDay() + 6) % 7 >= 4;
      const thisW = wk(now), lastW = wk(now - 7 * 86400000);
      const weekOf = (k) => { const t = Date.parse(k + 'T00:00'); return isFinite(t) ? 'Week of ' + fmtDateShort(t) : ''; };
      const main = late ? thisW : lastW, other = late ? lastW : thisW;
      if (main) add({ id: 'act:week', group: 'Actions', label: 'Weekly review', icon: 'calendar', kw: 'week review reflect report card', sub: esc(`${late ? 'This week' : 'Last week'} · ${weekOf(main)}`), run: () => call('Journal', 'openReview', 'W:' + main) });
      if (other && other !== main) add({ id: 'act:week2', group: 'Actions', label: late ? 'Last week’s review' : 'This week’s review', icon: 'calendar', kw: 'week review previous current', sub: esc(weekOf(other)), searchOnly: true, run: () => call('Journal', 'openReview', 'W:' + other) });
    }
    const unrev = groups.filter(g => g.closed && !ok(() => Metrics.isReviewed(g.trade), true));
    if (fn('Ledger', 'show')) add({ id: 'act:queue', group: 'Actions', label: 'Review queue', icon: 'list', kw: 'unreviewed needs review mistakes tag', sub: unrev.length ? `${unrev.length} closed trade${unrev.length === 1 ? '' : 's'} to review` : 'Nothing waiting', run: () => call('Ledger', 'show', { status: 'review' }) });
    if (fn('TradeForm', 'review') && unrev.length) { const g = unrev[0]; add({ id: 'act:revnext', group: 'Actions', label: 'Review next trade', icon: 'edit', kw: 'review oldest unreviewed tag mistakes grade', sub: `${esc(g.coin || '?')} ${sideTxt(g.side)} · ${isNum(g.exitMs) ? esc(fmtDateShort(g.exitMs)) : '—'}`, run: () => call('TradeForm', 'review', g.trade.id) }); }
    if (fn('Journal', 'logMissed')) add({ id: 'act:missed', group: 'Actions', label: 'Log a missed trade', icon: 'flag', kw: 'missed passed setup hesitation fear', searchOnly: true, run: () => call('Journal', 'logMissed') });
    if (fn('Importer', 'open')) add({ id: 'act:import', group: 'Actions', label: 'Import exchange CSV', icon: 'file-in', kw: 'csv binance bybit okx kraken coinbase mexc import file', searchOnly: true, run: () => call('Importer', 'open') });

    // Go to — every registered page, sidebar order first
    const ids = ok(() => Pages.ids(), []);
    for (const id of NAV_ORDER.filter(x => ids.includes(x)).concat(ids.filter(x => !NAV_ORDER.includes(x)))) {
      const meta = NAV[id] || {};
      add({ id: 'go:' + id, group: 'Go to', label: pageTitle(id), icon: meta.icon || 'chevron-r', keys: meta.keys, kw: 'go to page open ' + (meta.kw || ''), sub: Router.active === id ? 'You are here' : '', run: () => go(id) });
    }
    if (fn('Analytics', 'show')) for (const [t, label, kw] of ANALYTICS) add({ id: 'an:' + t, group: 'Analytics', label: 'Analytics · ' + label, icon: 'stats', kw: 'analytics ' + kw, searchOnly: true, run: () => call('Analytics', 'show', t) });

    // View — no mode switch while a form modal is open underneath (its save would land in the other account)
    const formOpen = !!document.querySelector('.modal-backdrop.open');
    if (fn('App', 'switchMode') && !formOpen) for (const m of MODES) if (m !== db.mode && MODE_INFO[m]) add({ id: 'mode:' + m, group: 'View', label: MODE_INFO[m].label, icon: MODE_INFO[m].icon, kw: 'mode account switch ' + m, sub: MODE_INFO[m].sub, run: () => call('App', 'switchMode', m) });
    const priv = !!ok(() => View.privacy, false);
    add({ id: 'view:privacy', group: 'View', label: priv ? 'Turn privacy mode off' : 'Turn privacy mode on', icon: priv ? 'eye' : 'eye-off', keys: 'Shift+P', kw: 'privacy blur hide money amounts screenshare', sub: priv ? 'Show $ amounts again' : 'Blur $ amounts — R and % stay visible', run: togglePrivacy });
    for (const u of ['$', '%', 'R']) if (u !== S().units) add({ id: 'units:' + u, group: 'View', label: UNIT_INFO[u], icon: 'stats', kw: 'units display results unit', run: () => View.setUnits(u) });

    // Data
    // Ledger.exportCSV exports the rows its own filters select — say so, so a filtered export is never mistaken for a full one
    const csvScope = fn('Ledger', 'exportCSV') ? 'uses the Trades page filters, if any' : 'every trade and cash flow';
    add({ id: 'data:csv', group: 'Data', label: 'Export trades to CSV', icon: 'download', kw: 'excel spreadsheet export download csv', sub: `${MODE_INFO[db.mode] ? db.mode[0].toUpperCase() + db.mode.slice(1) : ''} account · ${csvScope}`, run: exportCSV });
    add({ id: 'data:json', group: 'Data', label: 'Back up journal (JSON)', icon: 'download', kw: 'backup save export json file copy', sub: 'Everything — all accounts and settings', run: backup });
    // Cloud sync (sync.js + sync-ui.js) — only in a copy that has it set up; signed out (or expired) it opens the
    // sign-in, and its label says so
    if (fn('Sync', 'now') && ok(() => M.Sync().enabled, false)) {
      const st = ok(() => M.Sync().state, 'off'), label = st === 'off' ? 'Sign in to sync' : st === 'auth' ? 'Sign in again to sync' : 'Sync now';
      add({ id: 'data:sync', group: 'Data', label, icon: 'refresh', kw: 'sync now cloud iphone phone pc devices upload download refresh sign in', sub: esc(ok(() => M.SyncUI().summary(), '') || ''), run: () => (fn('SyncUI', 'syncNow') ? call('SyncUI', 'syncNow') : call('Sync', 'now')) });
    }
    if (fn('Settings', 'show')) for (const [s, label, kw] of SETTINGS) add({ id: 'set:' + s, group: 'Settings', label: 'Settings · ' + label, icon: 'gear', kw: 'settings preferences ' + kw, searchOnly: true, run: () => call('Settings', 'show', s) });
    if (fn('Settings', 'show') && ok(() => M.Settings().sections.includes('sync'), false)) add({ id: 'set:sync', group: 'Settings', label: 'Sync & devices settings', icon: 'gear', kw: 'settings sync cloud devices iphone phone pc account sign in sign out email password delete', searchOnly: true, run: () => call('Settings', 'show', 'sync') });

    // Help
    add({ id: 'help:keys', group: 'Help', label: 'Keyboard shortcuts', icon: 'cmd', keys: '?', kw: 'hotkeys keys help keyboard', run: shortcuts });
    if (fn('Learn', 'show')) {
      add({ id: 'help:metrics', group: 'Help', label: 'Metrics guide', icon: 'info', kw: 'glossary definitions formulas learn', sub: 'What every number means', run: () => call('Learn', 'show', 'metrics') });
      add({ id: 'help:crypto', group: 'Help', label: 'Crypto basics', icon: 'book', kw: 'lessons leverage liquidation funding fees learn', sub: 'R, stops, leverage, fees, going live', run: () => call('Learn', 'show', 'crypto') });
      add({ id: 'help:patterns', group: 'Help', label: 'Chart patterns', icon: 'pattern', kw: 'patterns candlesticks divergence learn', run: () => call('Learn', 'show', 'patterns') });
    }

    // Searchable content (only while typing). A hit opens the trade's detail drawer, or — while the
    // trade form module is unavailable — the trade list filtered to that one trade.
    const openTrade = fn('TradeForm', 'view') ? (id) => call('TradeForm', 'view', id) : fn('Ledger', 'show') ? (id) => call('Ledger', 'show', { ids: [id] }) : null;
    if (openTrade) {
      for (let i = groups.length - 1; i >= 0; i--) {   // newest first, so equal scores favour recent trades
        const g = groups[i], t = g.trade, ms = Date.parse(t.entryAt);
        // imported rows can carry odd shapes — only arrays of strings are indexed
        const tags = Array.isArray(t.tags) ? t.tags.map(String) : [], mks = Array.isArray(t.mistakes) ? t.mistakes : [];
        const str = (v) => (typeof v === 'string' ? v : '');
        const text = [str(t.notes), str(t.thesis), str(t.invalidation), tags.join(' '), stratName(g.strategyId), str(t.venue), t.review && str(t.review.lesson),
          mks.filter(m => m && m !== 'none').map(mistakeLabel).join(' ')].filter(Boolean).join(' · ').replace(/\s+/g, ' ');
        add({
          id: 'trade:' + t.id, group: 'Trades', searchOnly: true, label: `${g.coin || '?'} ${sideTxt(g.side)}`, iconHtml: coinIcon(String(g.coin || '?')),
          kw: `${g.coin || ''} ${str(t.market)} ${isFinite(ms) ? fmtDate(ms) : ''}`, text,
          sub: `${isFinite(ms) ? esc(fmtDateShort(ms)) : '—'} · ${esc(stratName(g.strategyId))}${tags.length ? ' · ' + esc(tags.slice(0, 2).join(', ')) : ''}`,
          meta: resultMeta(g), boost: (groups.length - i) > 50 ? 0 : 1,
          run: () => openTrade(t.id),
        });
      }
    }
    if (fn('Discipline', 'editStrategy')) for (const s of db.strategies || []) if (s && !s.archived) add({ id: 'strat:' + s.id, group: 'Strategies', searchOnly: true, label: s.name || 'Untitled strategy', icon: 'book', kw: `strategy playbook setup ${s.tf || ''} ${s.indicators || ''}`, sub: esc([s.tf, s.indicators].filter(Boolean).join(' · ') || 'Edit rules & checklist'), run: () => call('Discipline', 'editStrategy', s.id) });
    // typeof inside ok(): a global whose script threw while loading stays in the TDZ and typeof would throw
    const pats = ok(() => (typeof PATTERNS !== 'undefined' && Array.isArray(PATTERNS) ? PATTERNS : []), []).filter(p => p && p.id);
    const gloss = ok(() => (typeof Glossary !== 'undefined' && Glossary ? Glossary : null), null);
    if (fn('Learn', 'show')) for (const p of pats) add({ id: 'pat:' + p.id, group: 'Patterns', searchOnly: true, label: p.name, icon: 'pattern', kw: `${p.category} ${p.bias} pattern`, sub: esc(p.summary), run: () => call('Learn', 'show', 'patterns', p.id) });
    if (fn('Learn', 'show') && gloss) for (const k of Object.keys(gloss)) { const g = gloss[k]; if (!g || !g.title) continue; add({ id: 'term:' + k, group: 'Metric guide', searchOnly: true, label: g.title, icon: 'info', kw: k, text: g.plain, sub: esc(g.plain), run: () => call('Learn', 'show', 'metrics', k) }); }
    cache = out;
    return out;
  }

  /* ── Ranking & drawing ── */
  const recentIds = () => ok(() => { const a = JSON.parse(lsGet(LS_RECENT, '[]')); return Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, MAX_RECENT) : []; }, []);
  function remember(id) { lsSet(LS_RECENT, JSON.stringify([id].concat(recentIds().filter(x => x !== id)).slice(0, MAX_RECENT))); }

  function rank(q) {
    const top = stack[stack.length - 1];
    const base = top ? top.items : allItems();
    if (!q) {
      if (top) return [{ name: top.title, items: base }];
      const recent = recentIds().map(id => base.find(x => x.id === id)).filter(Boolean).map(x => ({ ...x, group: 'Recent' }));
      return GROUP_ORDER.map(name => ({ name, items: name === 'Recent' ? recent : base.filter(x => x.group === name && !x.searchOnly) }));
    }
    if (q === '?' && !top) return [{ name: 'Help', items: base.filter(x => x.group === 'Help') }];
    const collect = (loose) => {
      const byGroup = new Map();
      for (const it of base) {
        const m = match(q, it, loose); if (!m) continue;
        const row = { ...it, score: m.score + (it.boost || 0), html: m.html, sub: m.sub || it.sub };
        if (!byGroup.has(it.group)) byGroup.set(it.group, []);
        byGroup.get(it.group).push(row);
      }
      return byGroup;
    };
    let byGroup = collect(false);
    if ([...byGroup.values()].reduce((n, l) => n + l.length, 0) < 3) {   // nearly nothing: retry tolerating one typo
      const loose = collect(true);
      if ([...loose.values()].reduce((n, l) => n + l.length, 0) > 0) byGroup = loose;
    }
    let out = [...byGroup.entries()].map(([name, items]) => {
      items.sort((a, b) => b.score - a.score);
      return { name, items: items.slice(0, CAP[name] || 8), best: items[0].score };
    }).sort((a, b) => b.best - a.best);
    // hand off to the ledger's own search, which also covers fields the palette doesn't index
    if (!top && q.length >= 2 && fn('Ledger', 'show')) {
      const finder = { id: 'ledger:q', group: 'Trades', noRecent: true, label: `Find “${q}” in the trade list`, icon: 'search', run: () => call('Ledger', 'show', { q }) };
      const tr = out.find(g => g.name === 'Trades');
      if (tr) tr.items.push(finder); else out.push({ name: 'Trades', items: [finder], best: 0 });
    }
    return out;
  }
  function optionHtml(it, i) {
    const icon = it.iconHtml ? `<span class="pl-ic pl-coin" aria-hidden="true">${it.iconHtml}</span>` : `<span class="pl-ic" aria-hidden="true"><svg><use href="#i-${esc(it.icon || 'chevron-r')}"/></svg></span>`;
    return `<div class="pl-item" role="option" id="pl-o-${i}" data-i="${i}" aria-selected="false">${icon}
      <span class="pl-tx"><span class="pl-lb">${it.html || esc(it.label)}</span>${it.sub ? `<span class="pl-sb">${it.sub}</span>` : ''}</span>
      ${it.meta ? `<span class="pl-meta">${it.meta}</span>` : ''}${it.keys ? `<span class="pl-keys">${kbds(it.keys)}</span>` : ''}
      ${it.children ? '<span class="pl-more" aria-hidden="true"><svg><use href="#i-chevron-r"/></svg></span>' : ''}</div>`;
  }
  const announce = debounce((t) => { if (live) live.textContent = t; }, 350);
  function draw() {
    if (!root) return;
    const q = input.value.trim(), top = stack[stack.length - 1];
    crumb.hidden = !top;
    if (top) crumb.innerHTML = `<span>${esc(top.title)}</span><button type="button" class="pl-crumb-x" data-back aria-label="Back to all commands"><svg aria-hidden="true"><use href="#i-x"/></svg></button>`;
    input.placeholder = top ? 'Filter…' : 'Type a command, or search trades, patterns and terms…';
    const groups = rank(q).filter(g => g.items.length);
    flat = [];
    let html = '';
    groups.forEach((g, gi) => {
      html += `<div class="pl-group" role="group" aria-labelledby="pl-g-${gi}"><div class="pl-gh" id="pl-g-${gi}" role="presentation">${esc(g.name)}</div>`;
      for (const it of g.items) { html += optionHtml(it, flat.length); flat.push(it); }
      html += '</div>';
    });
    list.innerHTML = html || `<div class="pl-empty"><div class="big">No matches for “${esc(q)}”</div><div class="small">Try a coin (BTC), a pattern (flag), a metric (drawdown) or a command (export).</div></div>`;
    setSel(Math.min(sel, flat.length - 1), false);
    list.scrollTop = 0;
    announce(flat.length ? `${flat.length} result${flat.length === 1 ? '' : 's'}` : 'No results');
  }
  function setSel(i, scroll) {
    const prev = list.querySelector('.pl-item.on');
    if (prev) { prev.classList.remove('on'); prev.setAttribute('aria-selected', 'false'); }
    if (!flat.length) { sel = 0; input.removeAttribute('aria-activedescendant'); return; }
    sel = Math.max(0, Math.min(flat.length - 1, i));
    const cur = list.querySelector('#pl-o-' + sel);
    if (!cur) return;
    cur.classList.add('on'); cur.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', cur.id);
    if (scroll) cur.scrollIntoView({ block: 'nearest' });
  }
  function move(d) {
    if (!flat.length) return;
    let i = sel + d;
    if (Math.abs(d) === 1) i = (i + flat.length) % flat.length;   // arrows wrap; page keys clamp
    setSel(i, true);
  }
  function runAt(i) {
    const it = flat[i]; if (!it) return;
    if (it.children) {   // drill into a sub-list (e.g. pick which position to close)
      if (!stack.length) remember(it.id);
      stack.push({ title: it.label.replace(/…$/, ''), items: ok(() => it.children(), []) });
      input.value = ''; sel = 0; draw(); input.focus();
      return;
    }
    if (!stack.length && !it.noRecent) remember(it.id);
    close();
    // run after focus has returned, so a dialog the command opens remembers the right element
    setTimeout(() => { try { it.run(); } catch (e) { console.error('[palette]', e); toast('That command could not run', 'err'); } }, 0);
  }
  function pop() { stack.pop(); input.value = ''; sel = 0; draw(); input.focus(); }

  /* ── Open / close ── */
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'pl-backdrop';
    root.hidden = true;
    root.innerHTML = `<div class="pl-dialog" role="dialog" aria-modal="true" aria-labelledby="pl-title">
      <h2 class="sr-only" id="pl-title">Command palette</h2>
      <div class="pl-search">
        <svg class="pl-sicon" aria-hidden="true"><use href="#i-search"/></svg>
        <span class="pl-crumb" hidden></span>
        <input class="pl-input" type="text" role="combobox" aria-expanded="true" aria-controls="pl-list" aria-autocomplete="list" aria-haspopup="listbox"
          aria-label="Search commands, trades, patterns and metric terms" autocomplete="off" autocapitalize="off" spellcheck="false">
        <kbd class="pl-esc" aria-hidden="true">Esc</kbd>
        <button type="button" class="pl-x" aria-label="Close command palette"><svg aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="pl-list" id="pl-list" role="listbox" aria-label="Results"></div>
      <div class="pl-foot" aria-hidden="true"><span>${kbds('↑|↓')} move</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span><span class="sp"></span><span>${kbds('Ctrl+K')} toggle</span></div>
      <div class="sr-only" role="status" aria-live="polite"></div>
    </div>`;
    document.body.appendChild(root);
    input = root.querySelector('.pl-input'); list = root.querySelector('.pl-list');
    crumb = root.querySelector('.pl-crumb'); live = root.querySelector('[role="status"]');
    input.addEventListener('input', () => { sel = 0; draw(); });
    list.addEventListener('mousedown', (ev) => ev.preventDefault());   // keep focus in the input
    list.addEventListener('mousemove', (ev) => { const el = ev.target.closest('.pl-item'); if (el && +el.dataset.i !== sel) setSel(+el.dataset.i, false); });
    list.addEventListener('click', (ev) => { const el = ev.target.closest('.pl-item'); if (el) runAt(+el.dataset.i); });
    crumb.addEventListener('mousedown', (ev) => ev.preventDefault());
    crumb.addEventListener('click', (ev) => { if (ev.target.closest('[data-back]')) pop(); });
    // touch screens have no Esc key and the dialog can fill the screen: a visible close button (CSS shows it there)
    const x = root.querySelector('.pl-x');
    x.addEventListener('mousedown', (ev) => ev.preventDefault());
    x.addEventListener('click', () => close());
    root.addEventListener('mousedown', (ev) => { if (ev.target === root) { ev.preventDefault(); close(); } });
  }
  function open(query) {
    build();
    if (!isOpen) {
      ret = document.activeElement;
      isOpen = true; stack = []; cache = null;
      hideChord();
      // an open info popover (z 95) would float over the palette, and our Esc never reaches core's popover
      // handler — close it through core's own scroll listener so its state stays consistent
      if (document.querySelector('.popover')) ok(() => window.dispatchEvent(new Event('scroll')));
      root.hidden = false;
    }
    input.value = query != null ? String(query) : '';
    sel = 0; draw();
    input.focus({ preventScroll: true });
    const n = input.value.length; ok(() => input.setSelectionRange(n, n));
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; stack = []; cache = null; flat = [];
    root.hidden = true;
    input.removeAttribute('aria-activedescendant');
    // core's focusBack() also finds a re-rendered opener by its data-fid
    if (ret) ok(() => { if (typeof focusBack === 'function') focusBack(ret); else if (ret.isConnected && ret.focus) ret.focus({ preventScroll: true }); });
    ret = null;
  }

  // Capture phase on window: runs before core's Escape/Tab handler, so one Esc closes only the palette
  function onPaletteKey(ev) {
    if (!isOpen) return;
    const k = ev.key;
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (ev.isComposing) { ev.stopPropagation(); return; }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (k === 'k' || k === 'K')) { stop(); close(); return; }
    if (k === 'Escape') { stop(); if (stack.length) pop(); else close(); return; }
    if (k === 'ArrowDown') { stop(); move(1); return; }
    if (k === 'ArrowUp') { stop(); move(-1); return; }
    if (k === 'PageDown') { stop(); move(5); return; }
    if (k === 'PageUp') { stop(); move(-5); return; }
    if (k === 'Enter') { stop(); runAt(sel); return; }
    if (k === 'Tab') { stop(); input.focus(); return; }   // focus stays inside the dialog
    if (k === 'Backspace' && !input.value && stack.length) { stop(); pop(); return; }
    ev.stopPropagation();   // typing here must not trigger page or global shortcuts
  }
  // Keep focus inside while open (e.g. a toast button grabbing focus)
  function onFocusIn(ev) { if (isOpen && root && !root.contains(ev.target)) input.focus({ preventScroll: true }); }

  /* ── Commands with their own logic ── */
  function togglePrivacy() {
    const on = !ok(() => View.privacy, false);
    View.setPrivacy(on);
    toast(on ? 'Privacy on — $ amounts are blurred' : 'Privacy off', 'ok');
  }
  function exportCSV() {
    const viaLedger = fn('Ledger', 'exportCSV');
    if (viaLedger) { viaLedger(); return; }
    const rows = typeof C !== 'undefined' && C ? C.rows : [];
    const trades = rows.filter(r => r.type === 'trade' || r.type === 'scale');
    if (!trades.length) { toast('No trades to export yet', 'warn'); return; }
    const n = (v) => (isNum(v) ? v : null), arr = (v) => (Array.isArray(v) ? v : []);
    const out = [['Type', 'Entry time', 'Exit time', 'Coin', 'Side', 'Strategy', 'Market', 'Venue', 'Entry', 'Amount', 'Stop', 'Target', 'Exit',
      'Fees', 'Funding', 'Gas', 'Net P/L', 'Net R', 'Grade', 'Mistakes', 'Tags', 'Notes', 'Flow amount', 'Flow note']];
    for (const r of rows) {
      if (r.type === 'trade' || r.type === 'scale') {
        out.push([r.type, r.entryAt || '', r.exitAt || '', r.coin || '', r.side || '', stratName(r.strategyId), r.market || 'spot', r.venue || '',
          n(r.entryPrice), n(r.amount), n(r.stopPrice), n(r.targetPrice), n(r.exitPrice), n(r.fees), n(r.funding), n(r.gas), n(r.netPL), n(r.netR),
          r.grade || '', arr(r.mistakes).map(mistakeLabel).join(' | '), arr(r.tags).join(' | '), r.notes || '', null, '']);
      } else if (r.type === 'deposit' || r.type === 'withdrawal' || r.type === 'adjustment') {
        out.push([r.type, r.entryAt || '', '', '', '', '', '', '', null, null, null, null, null, null, null, null, null, null, '', '', '', '', n(r.flowAmount), r.flowNote || '']);
      }
    }
    download(`cryptojournal-${db.mode}-trades-${todayISO()}.csv`, toCSV(out), 'text/csv;charset=utf-8');
    toast(`Exported ${trades.length} trade row${trades.length === 1 ? '' : 's'}`);
  }
  function backup() {
    const f = fn('Store', 'exportJSON');
    if (f) { Promise.resolve().then(f).catch((e) => { console.error('[palette] backup', e); toast('Backup failed — try Settings → Data', 'err'); }); return; }
    download(`cryptojournal-backup-${todayISO()}.json`, JSON.stringify(db, null, 2), 'application/json');
    toast('Backup downloaded');
  }

  /* ── Shortcut sheet ── */
  function shortcuts() {
    const nav = Object.entries(CHORD).filter(([, id]) => Pages.has(id)).map(([k, id]) => ['G ' + k.toUpperCase(), pageTitle(id)]);
    const sheet = [
      ['Anywhere', [['Ctrl+K', 'Command palette — search everything'], ['N', 'New trade'], ['Q', 'Quick log'], ['C', 'Position size calculator'],
        ['/', 'Jump to this page’s search box'], ['Shift+P', 'Privacy mode (blur $ amounts)'], ['?', 'This list'], ['Esc', 'Close the top dialog, drawer or palette']]],
      ['Go to (press G, then…)', nav],
      ['In the palette', [['↑|↓', 'Move through results'], ['Enter', 'Run the highlighted command'], ['Backspace', 'Back out of a sub-list'], ['Esc', 'Close']]],
    ];
    Modal.open({
      title: 'Keyboard shortcuts', width: 680,
      body: `<div class="pl-sheet">${sheet.filter(([, rows]) => rows.length).map(([h, rows]) => `<section class="pl-sheet-g"><h4>${esc(h)}</h4>
          ${rows.map(([k, t]) => `<div class="kbd-row"><span>${esc(t)}</span><span class="k">${kbds(k)}</span></div>`).join('')}</section>`).join('')}</div>
        <p class="pl-sheet-note">Single-key shortcuts pause while you type in a field. Every shortcut, ${MAC ? '⌘' : 'Ctrl'}+K included, pauses while a dialog or drawer is open.${MAC ? ' ⌘ replaces Ctrl on a Mac.' : ''}</p>`,
      foot: '<button class="btn btn-primary" type="button" data-act="ok">Got it</button>',
      onMount: (el, done) => { const b = el.querySelector('[data-act="ok"]'); if (b) b.onclick = () => done(); },
    });
  }

  /* ── Global single-key shortcuts ── */
  function typing(t) {
    if (!t || t === document.body || t === document.documentElement) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }
  const layerOpen = () => !!document.querySelector('.modal-backdrop.open, .drawer-wrap');
  function showChord() {
    if (!chordEl) { chordEl = document.createElement('div'); chordEl.className = 'pl-chord'; chordEl.setAttribute('role', 'status'); document.body.appendChild(chordEl); }
    const items = Object.entries(CHORD).filter(([, id]) => Pages.has(id)).map(([k, id]) => `<span><kbd>${k.toUpperCase()}</kbd>${esc(pageTitle(id))}</span>`).join('');
    chordEl.innerHTML = `<b>Go to…</b>${items}`;
    chordEl.classList.add('on');
    clearTimeout(chordTimer); chordTimer = setTimeout(hideChord, CHORD_MS);
  }
  function hideChord() { gAt = 0; clearTimeout(chordTimer); if (chordEl) chordEl.classList.remove('on'); }
  function onGlobalKey(ev) {
    if (isOpen || ev.defaultPrevented || ev.isComposing) return;
    const k = ev.key || '';
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && k.toLowerCase() === 'k') {
      ev.preventDefault();
      // Not over an open dialog or drawer: a command run from here would stack a second form on a
      // half-filled one (or navigate behind it). Close the layer first.
      if (layerOpen()) { toast('Close this dialog first, then press ' + (MAC ? '⌘' : 'Ctrl') + '+K', 'warn'); return; }
      open(); return;
    }
    // AltGr (reported as Ctrl+Alt on Windows) is how some layouts type '/' or '?' — not a modifier shortcut
    const altGr = !!(ev.getModifierState && ok(() => ev.getModifierState('AltGraph'), false));
    if (!altGr && (ev.ctrlKey || ev.altKey || ev.metaKey)) return;
    if (typing(ev.target) || layerOpen()) { if (gAt) hideChord(); return; }
    if (ev.repeat || MODIFIERS.has(k)) return;   // a lone Shift / Ctrl press must not cancel a pending G-chord
    if (gAt) {   // second key of a G-chord
      const fresh = Date.now() - gAt <= CHORD_MS, id = CHORD[k.toLowerCase()];
      hideChord();
      if (fresh && id && Pages.has(id)) { ev.preventDefault(); go(id); }
      return;
    }
    if (k === '?') { ev.preventDefault(); shortcuts(); return; }
    if (k === '/') { const inp = document.querySelector('.page.active .search-box input'); if (inp) { ev.preventDefault(); inp.focus(); ok(() => inp.select()); } return; }
    if (k.toLowerCase() === 'p' && ev.shiftKey) { ev.preventDefault(); togglePrivacy(); return; }
    if (ev.shiftKey) return;
    switch (k.toLowerCase()) {
      case 'g': ev.preventDefault(); gAt = Date.now(); showChord(); break;
      case 'n': if (fn('TradeForm', 'open')) { ev.preventDefault(); call('TradeForm', 'open', null); } break;
      case 'q': if (fn('TradeForm', 'quick')) { ev.preventDefault(); call('TradeForm', 'quick'); } break;
      case 'c': if (Pages.has('calc')) { ev.preventDefault(); go('calc'); } break;
      default: break;
    }
  }

  /* ── Wiring (scripts load at the end of <body>, so the topbar exists) ── */
  window.addEventListener('keydown', onPaletteKey, true);
  document.addEventListener('keydown', onGlobalKey);
  document.addEventListener('focusin', onFocusIn);
  const btn = document.getElementById('btn-cmdk');
  if (btn) {
    btn.onclick = () => open();   // app.js only binds it when onclick is still empty
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    const k = btn.querySelector('kbd'); if (k && MAC) k.textContent = '⌘ K';
  }

  return { open, close, shortcuts, get isOpen() { return isOpen; } };
})();
