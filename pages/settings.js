/* ═══════════════════════════════════════════════════════════
   CryptoJournal — Settings page
   Sections: account · risk · costs · journal (tags & mistakes) ·
   appearance · data (backups, snapshots, storage, CSV, prices) ·
   trash · demo · danger · about.
   Also owns the storage-recovery banner app.js shows when the saved
   journal could not be parsed (Settings.recoveryBanner/bindRecovery).
   Every change mutates db.settings (or the account) and commit()s;
   appearance-only changes use save() + applyTheme() + Bus 'settings'.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Settings = (() => {
  const LS_KEY = 'cj.settings.section';
  const TRASH_DAYS = 30, DAY = 86400000;
  const MODE_LABEL = { paper: 'Paper', live: 'Live', demo: 'Demo' };
  const SECTIONS = [
    { id: 'account', label: 'Account', icon: 'wallet', lead: 'Starting balance, start date and which account you are working in.' },
    { id: 'risk', label: 'Risk rules', icon: 'shield', lead: 'Soft circuit breakers. When one trips, the trade form asks you to stop — you can still override with a written reason, which is logged.' },
    { id: 'costs', label: 'Fees & costs', icon: 'scale', lead: 'Paper fills are perfect; real trades pay fees and slippage. These numbers make paper results honest.' },
    { id: 'journal', label: 'Tags & mistakes', icon: 'journal', lead: 'The words you use to label trades. Consistent labels make the reports meaningful.' },
    { id: 'appearance', label: 'Appearance', icon: 'eye', lead: 'Colours, density, default units and how trading sessions are defined.' },
    { id: 'data', label: 'Data & backups', icon: 'download', lead: 'Your journal lives in this browser (cloud sync keeps your devices in step, but it is not a backup). Back it up, keep snapshots and check storage here.' },
    { id: 'sync', label: 'Sync & devices', icon: 'refresh', lead: 'One journal on your iPhone and PC: each device keeps a full copy, works offline and syncs in the background when online.' },
    { id: 'trash', label: 'Trash', icon: 'trash', lead: `Deleted entries stay here for ${TRASH_DAYS} days before they are removed for good.` },
    { id: 'demo', label: 'Demo data', icon: 'sparkle', lead: 'A separate sample account to explore every chart without touching your own journal.' },
    { id: 'danger', label: 'Danger zone', icon: 'alert', lead: 'Irreversible-looking actions. Each one saves a snapshot first.' },
    { id: 'about', label: 'About', icon: 'info', lead: 'Version, shortcuts, where the ideas come from — and what this app is not.' },
  ];
  const ALIAS = { tags: 'journal', mistakes: 'journal', taxonomy: 'journal', fees: 'costs', breakeven: 'costs', scratch: 'costs', beBandR: 'costs', backup: 'data', backups: 'data', storage: 'data', snapshots: 'data', theme: 'appearance', rules: 'risk', guardrails: 'risk', ramp: 'risk', wipe: 'danger', cloud: 'sync', devices: 'sync', iphone: 'sync' };

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  let section = lsGet(LS_KEY) || 'account';
  if (!SECTIONS.some(s => s.id === section)) section = 'account';
  let root = null, tok = 0, flashT = null, csvScope = 'mode';

  /* ── Small helpers ─────────────────────────────────────── */
  const isO = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const ic = (id, cls) => `<svg class="${cls || ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r2 = (v) => String(Math.round(v * 100) / 100);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const fmtBytes = (n) => (!isNum(n) ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');
  const getPath = (path) => path.reduce((o, k) => (o == null ? undefined : o[k]), S());
  function setPath(path, v) {
    let o = S();
    for (let i = 0; i < path.length - 1; i++) { if (!isO(o[path[i]])) o[path[i]] = {}; o = o[path[i]]; }
    o[path[path.length - 1]] = v;
  }
  const hasStore = () => typeof Store !== 'undefined';
  const ageOf = () => (hasStore() && Store.backupAgeDays ? Store.backupAgeDays() : null);
  function ageText(d) { if (d == null) return 'never'; if (d < 1) return 'today'; if (d < 2) return 'yesterday'; return `${Math.floor(d)} days ago`; }
  // >30 days (or never, once there is something to lose) red · >7 days amber
  const ageTone = (d) => (d == null ? (totalTrades() ? 'stop' : 'warn') : d > 30 ? 'stop' : d > 7 ? 'warn' : 'ok');
  // Paper + live only: demo is sample data, nothing to lose
  const totalTrades = () => realTradeCount();
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayText = (iso) => { const t = Date.parse(String(iso || '') + 'T00:00'); return isFinite(t) ? fmtDate(t) : '—'; };   // 'YYYY-MM-DD' as local midnight
  const fmtMins = (m) => (m < 60 ? `${m} min` : `${r2(m / 60)} h`);
  const backupOverdue = () => { if (totalTrades() < 5) return false; const a = ageOf(); return a == null || a > 7; };
  const trashCount = () => MODES.reduce((s, m) => s + db.accounts[m].entries.filter(e => e.deletedAt).length, 0);
  const go = (page) => { if (Pages.has(page)) Router.go(page); };
  const visible = (id) => Router.active === 'settings' && section === id && root && root.isConnected;
  const panelEl = () => (root ? $('#st-panel', root) : null);

  /* ── Change plumbing: commit, keep focus, announce "Saved" ── */
  // What has focus inside `within` (by id, else by the data-fid that buttons without an id carry), as a selector
  // that finds its re-rendered twin. Many row buttons (tags, snapshots, trash) only have a data-fid.
  function focusSel(within) {
    const a = document.activeElement, box = within || root;
    if (!a || !box || a === box || !box.contains(a)) return null;
    const cssEsc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
    if (a.id) return '#' + cssEsc(a.id);
    return a.dataset && a.dataset.fid ? `[data-fid="${cssEsc(a.dataset.fid)}"]` : null;
  }
  // commit() re-renders the page; deferring one tick lets Tab move focus first, then we restore it.
  // 'settings' goes out first so caches keyed on settings (Readiness, Calc) are fresh for the re-render.
  function apply(o) {
    o = o || {};
    setTimeout(() => {
      const cur = focusSel(), want = o.focus || cur;
      Bus.emit('settings');
      // = commit(msg, kind), spelled out so a refused save (storage full, unreadable journal) is never
      // followed by a "Saved" pill or a success toast — save() has already said what went wrong
      const ok = save(); refresh();
      if (ok && o.msg) toast(o.msg, o.kind);
      // The control may be gone or disabled now (e.g. "Restore missing defaults"): land on the heading
      refocus(null, want, want ? '#st-h' : null);
      if (ok && !o.msg) flash(o.flash);
      // after() shows the success / Undo toast: never after a refused save (as softDelete does)
      if (ok && o.after) o.after();
    }, 0);
  }
  // Appearance-only: no recompute needed
  function applyView(o) {
    o = o || {};
    const ok = save(); applyTheme();
    if (o.view) Bus.emit('view');
    Bus.emit('settings');
    rerender(o.focus);
    if (ok) flash();
  }
  function rerender(sel) {
    if (Router.active !== 'settings' || !root) return;
    const cur = focusSel();
    render(root);
    refocus(null, sel || cur);
  }
  // Run something that commit()s (re-rendering the page), then put focus back on the same control,
  // or on the section heading when that control is gone or disabled (e.g. the trash just emptied)
  function keepFocus(fn) {
    const cur = focusSel();
    fn();
    if (Router.active !== 'settings' || !root) return;
    const n = cur ? root.querySelector(cur) : null;
    refocus(null, n && !n.disabled ? cur : '#st-h');
  }
  // Replace an async block's content without dropping keyboard focus that was inside it
  function swapHtml(el, html) {
    const sel = focusSel(el);
    el.innerHTML = html;
    if (sel) { const n = el.querySelector(sel); if (n && typeof n.focus === 'function') n.focus({ preventScroll: true }); }
  }
  // A stored ISO time that may be missing or garbled (hand-edited / imported backups)
  const whenText = (iso, none) => { const t = Date.parse(iso); return iso && isFinite(t) ? esc(fmtDateTime(t)) : (none || 'never'); };
  function refocus(fid, sel, fallback) {
    let n = sel ? (root && root.querySelector(sel)) : (fid ? document.getElementById(fid) : null);
    if ((!n || n.disabled) && fallback) n = root && root.querySelector(fallback);
    if (n && typeof n.focus === 'function') n.focus({ preventScroll: true });
  }
  // One live region on <body> that outlives re-renders: a region created by the same render that
  // fills it is often not announced by screen readers.
  function savedEl() {
    let s = document.getElementById('st-saved');
    if (!s) {
      s = document.createElement('div');
      s.id = 'st-saved'; s.className = 'st-saved';
      s.setAttribute('role', 'status'); s.setAttribute('aria-live', 'polite');
      document.body.appendChild(s);
    }
    return s;
  }
  function flash(msg) {
    // While the storage warning is unresolved save() refuses (and says so) — never claim "Saved" then
    if (StorageGuard.loadError) return;
    clearTimeout(flashT);
    const s = savedEl();
    s.textContent = '';
    // Next frame, so the same message twice in a row is still announced
    requestAnimationFrame(() => { s.textContent = msg || 'Saved'; s.classList.add('on'); });
    flashT = setTimeout(() => { s.classList.remove('on'); s.textContent = ''; }, 1800);
  }

  /* ── Field kit ─────────────────────────────────────────── */
  // f: { id, path | get/set, label, unit, min, max, step, int, dp, def, nullable, tip, hint(v) → {text (HTML), cls} }
  const val = (f) => (f.get ? f.get() : getPath(f.path));
  const put = (f, v) => (f.set ? f.set(v) : setPath(f.path, v));
  function numField(f) {
    const v = val(f), h = f.hint ? f.hint(v) : null;
    return `<div class="field st-f">
      <label for="st-${f.id}">${esc(f.label)}${f.def != null ? `<span class="opt">default ${esc(String(f.def))}</span>` : ''}${f.tip ? infoTip(f.tip) : ''}</label>
      <div class="input-group"><input class="input mono" id="st-${f.id}" data-num="${f.id}" type="number" inputmode="decimal" step="${f.step}" min="${f.min}" max="${f.max}" value="${v == null || !isNum(v) ? '' : esc(String(v))}"${f.nullable ? ' placeholder="not set"' : ''} aria-describedby="st-${f.id}-h">${f.unit ? `<span class="addon">${esc(f.unit)}</span>` : ''}</div>
      <div class="hint ${h && h.cls ? h.cls : ''}" id="st-${f.id}-h">${h ? h.text : ''}</div>
    </div>`;
  }
  function bindNums(panel, fields) {
    const map = new Map(fields.map(f => [f.id, f]));
    panel.querySelectorAll('[data-num]').forEach((inp) => {
      const f = map.get(inp.dataset.num); if (!f) return;
      const hintEl = panel.querySelector(`#st-${f.id}-h`);
      const parse = () => { const raw = inp.value.trim(); if (raw === '') return f.nullable ? null : NaN; const n = Number(raw); return isFinite(n) ? n : NaN; };
      inp.addEventListener('input', () => {
        const n = parse(), bad = n !== null && (!isNum(n) || n < f.min || n > f.max);
        inp.classList.toggle('invalid', bad);
        inp.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (!hintEl) return;
        if (bad) { hintEl.className = 'hint err'; hintEl.textContent = isNum(n) ? `Allowed: ${f.min} to ${f.max}${f.unit ? ' ' + f.unit : ''}. It will be adjusted when you leave the field.` : 'Enter a number.'; }
        else { const h = f.hint ? f.hint(n) : null; hintEl.className = 'hint ' + (h && h.cls ? h.cls : ''); hintEl.innerHTML = h ? h.text : ''; }
      });
      inp.addEventListener('change', () => {
        const n = parse();
        if (n === null) { if (val(f) == null) return; put(f, null); apply({ after: f.after }); return; }
        if (!isNum(n)) { const cur = val(f); inp.value = isNum(cur) ? String(cur) : ''; inp.classList.remove('invalid'); return; }
        const c = clampN(n, f.min, f.max);
        const v = f.int ? Math.round(c) : +c.toFixed(f.dp != null ? f.dp : 4);
        // Only an out-of-range value is worth a toast; rounding to the field's precision is silent
        if (c !== n) toast(`${f.label} adjusted to ${v}${f.unit ? ' ' + f.unit : ''} (allowed ${f.min} to ${f.max})`, 'warn');
        if (v === val(f)) { inp.value = String(v); inp.classList.remove('invalid'); return; }
        const prev = val(f);
        put(f, v);
        apply({ after: f.after ? () => f.after(v, prev) : null });
      });
    });
  }
  // Accessible on/off switch built on a real checkbox
  function toggle(id, label, on, sub) {
    return `<label class="st-sw" for="st-${id}"><input type="checkbox" role="switch" id="st-${id}" data-tg="${id}"${on ? ' checked' : ''}><span class="st-sw-ui" aria-hidden="true"></span><span class="st-sw-t"><b>${esc(label)}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  }
  function bindToggles(panel, map) {
    panel.querySelectorAll('[data-tg]').forEach((cb) => { const fn = map[cb.dataset.tg]; if (fn) cb.addEventListener('change', () => fn(cb.checked)); });
  }
  const card = (title, icon, body, o) => `<section class="card st-card ${o && o.cls ? o.cls : ''}"${o && o.id ? ` id="${o.id}"` : ''}><h3 class="card-title">${ic(icon)}${title}${o && o.aside ? `<span class="aside">${o.aside}</span>` : ''}</h3>${o && o.sub ? `<p class="card-sub">${o.sub}</p>` : ''}${body}</section>`;
  // data-fid: core's focusBack() finds the re-rendered button when a dialog it opened closes after a commit()
  const btn = (id, label, o) => `<button type="button" class="btn ${(o && o.cls) || 'btn-ghost'} btn-sm" id="st-b-${id}" data-fid="st-b-${id}"${o && o.disabled ? ' disabled' : ''}${o && o.title ? ` title="${esc(o.title)}"` : ''}${o && o.aria ? ` aria-label="${esc(o.aria)}"` : ''}>${o && o.icon ? ic(o.icon) : ''}${label}</button>`;
  function onBtn(panel, map) { for (const [id, fn] of Object.entries(map)) { const b = panel.querySelector('#st-b-' + id); if (b) b.addEventListener('click', fn); } }
  function segHere(panel, id, options, value, onChange) {
    const el = panel.querySelector('#st-seg-' + id); if (!el) return;
    seg(el, options, value, onChange);
    el.setAttribute('role', 'group');
  }

  /* ── Layout ────────────────────────────────────────────── */
  function navBtn(s) {
    const on = s.id === section;
    let badge = '';
    if (s.id === 'data' && backupOverdue()) badge = '<span class="st-nb dot" title="Backup is overdue"><span class="sr-only">Backup overdue</span></span>';
    if (s.id === 'trash') { const n = trashCount(); if (n) badge = `<span class="st-nb">${n}<span class="sr-only"> entries</span></span>`; }
    return `<button type="button" role="tab" class="st-tab${on ? ' on' : ''}${s.id === 'danger' ? ' st-tab-danger' : ''}" id="st-tab-${s.id}" data-sec="${s.id}" aria-selected="${on}" aria-controls="st-panel" tabindex="${on ? 0 : -1}">${ic(s.icon)}<span>${esc(s.label)}</span>${badge}</button>`;
  }
  function render(el) {
    root = el; tok++;
    const sec = SECTIONS.find(s => s.id === section) || SECTIONS[0];
    let view = VIEWS[sec.id], body;
    // One broken section must not take the section list down with it
    try { body = view.html(); }
    catch (err) { console.error('[settings:' + sec.id + ']', err); body = `<div class="banner err" role="alert">${ic('alert')}<div class="grow">This section hit an error: ${esc(err && err.message)}</div></div>`; view = null; }
    const locked = StorageGuard.loadError && sec.id !== 'data'
      ? `<div class="banner err st-locked">${ic('lock')}<div class="grow"><b>Saving is paused.</b> Your saved journal could not be read, so changes made here are not stored until you resolve the warning at the top of the page (Data &amp; backups has the options).</div></div>` : '';
    // The list is a column on desktop and a horizontal strip on phones (settings.css, 860px); app.js re-renders on width changes
    let strip = false;
    try { strip = typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches; } catch (e) { strip = false; }
    el.innerHTML = `<div class="st-wrap">
      <nav class="st-nav" aria-label="Settings sections"><div class="st-tabs" role="tablist" aria-orientation="${strip ? 'horizontal' : 'vertical'}">${SECTIONS.map(navBtn).join('')}</div></nav>
      <div class="st-panel" id="st-panel" role="tabpanel" aria-labelledby="st-tab-${sec.id}">
        <header class="st-ph"><h2 class="st-h" id="st-h" tabindex="-1">${ic(sec.icon)}${esc(sec.label)}</h2><p class="st-lead">${esc(sec.lead)}</p></header>
        ${locked}${body}
      </div>
    </div>`;
    bindNav(el);
    if (view) { try { view.bind($('#st-panel', el)); } catch (err) { console.error('[settings:' + sec.id + ']', err); } }
  }
  function bindNav(el) {
    const tabs = $$('[role="tab"]', el);
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => open(b.dataset.sec));
      b.addEventListener('keydown', (ev) => {
        const k = ev.key; let j = null;
        if (k === 'ArrowDown' || k === 'ArrowRight') j = (i + 1) % tabs.length;
        else if (k === 'ArrowUp' || k === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        else if (k === 'Home') j = 0;
        else if (k === 'End') j = tabs.length - 1;
        if (j == null) return;
        ev.preventDefault(); open(tabs[j].dataset.sec);
      });
    });
  }
  // Switch section from the tab list: keep focus on the (re-rendered) tab, bring the panel top into view
  function open(id) {
    if (!SECTIONS.some(s => s.id === id)) return;
    section = id; lsSet(LS_KEY, id);
    render(root);
    refocus('st-tab-' + id);
    const p = panelEl(), nav = $('.st-nav', root);
    // On phones the tab strip is sticky across the top, so "out of view" starts below it
    const nr = nav ? nav.getBoundingClientRect() : null, lim = nr && nr.width > window.innerWidth * 0.6 ? nr.bottom : 0;
    if (p && p.getBoundingClientRect().top < lim) p.scrollIntoView({ block: 'start' });
    const t = $('#st-tab-' + id, root);
    if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* ═══ Account ═══════════════════════════════════════════ */
  const MODE_DESC = {
    paper: 'Practice account — simulated trades, no real money. Build evidence here first.',
    live: 'Real-money account. Kept completely separate from paper.',
    demo: 'Sample data for exploring the app. Never mixes with your own trades.',
  };
  const ACC_FIELDS = [
    {
      id: 'a-start', label: 'Starting balance', unit: 'USD', min: 0, max: 1e9, step: 'any', dp: 2,
      get: () => acct().startingBalance, set: (v) => { acct().startingBalance = v; },
      hint: () => ({ text: 'Changing this shifts <b>every running balance</b>, % return and the equity curve. To record money you added or withdrew, use a deposit or withdrawal instead.', cls: '' }),
      after: (v, prev) => {
        const m = db.mode;
        toast('Starting balance updated', 'ok', { ms: 9000, action: { label: 'Undo', run: () => { db.accounts[m].startingBalance = prev; commit('Starting balance restored'); } } });
      },
    },
    {
      id: 'a-live', label: 'Planned live capital', unit: 'USD', min: 0, max: 1e9, step: 'any', dp: 2, nullable: true,
      // 0 means "not planned" — stored as null, like Readiness does (it only accepts amounts above 0)
      get: () => (isNum(S().plannedLiveCapital) && S().plannedLiveCapital > 0 ? S().plannedLiveCapital : null),
      set: (v) => { S().plannedLiveCapital = isNum(v) && v > 0 ? v : null; },
      tip: 'How much real money you plan to trade with. Readiness compares your paper balance with it.',
      hint: (v) => {
        if (!isNum(v) || v <= 0) return { text: 'Optional. Practise with roughly the size you will really trade — a $100k paper account builds habits a $1k live account cannot use.', cls: '' };
        const pb = db.accounts.paper.startingBalance, ratio = pb > 0 ? pb / v : null;
        if (ratio == null) return { text: 'Set a paper starting balance to compare.', cls: '' };
        const ok = ratio >= 0.5 && ratio <= 2;
        return { text: `Your paper account is <b>${r2(ratio)}×</b> this. ${ok ? 'Realistic — good.' : 'Aim for 0.5×–2× so position sizes feel the same when you go live.'}`, cls: ok ? '' : 'warn' };
      },
    },
  ];
  function accountHtml() {
    const m = db.mode, a = acct(), c = computeFor(m);
    const flows = a.entries.filter(e => !e.deletedAt && (e.type === 'deposit' || e.type === 'withdrawal' || e.type === 'adjustment')).length;
    const modeBtns = MODES.map(x => `<button type="button" class="st-mode${x === m ? ' on' : ''}" id="st-b-mode-${x}" data-fid="st-b-mode-${x}" data-mode="${x}" aria-pressed="${x === m}"><span class="st-mode-dot st-md-${x}" aria-hidden="true"></span><b>${MODE_LABEL[x]}</b><small>${x === 'paper' ? 'Practice' : x === 'live' ? 'Real money' : 'Sample data'}</small></button>`).join('');
    const rows = MODES.map((x) => {
      const cx = computeFor(x), ax = db.accounts[x], open = cx.groups.filter(g => !g.closed).length;
      return `<tr${x === m ? ' class="st-cur"' : ''}><th scope="row"><span class="badge sm st-mb-${x}">${MODE_LABEL[x]}</span></th><td class="num">${money(cx.startingBalance)}</td><td class="num">${money(cx.balance)}</td><td class="num">${cx.closedGroups.length}</td><td class="num">${open}</td><td>${esc(dayText(ax.startDate))}</td></tr>`;
    }).join('');
    return `<div class="st-grid">
      ${card(`Current account <span class="badge mode">${MODE_LABEL[m]}</span>`, 'wallet', `
        <p class="st-p">${esc(MODE_DESC[m])}</p>
        <div class="st-stats">
          <div><span>Balance now</span><b class="mono">${money(c.balance)}</b></div>
          <div><span>Started with</span><b class="mono">${money(c.startingBalance)}</b></div>
          <div><span>Closed trades</span><b class="mono">${c.closedGroups.length}</b></div>
          <div><span>Deposits &amp; adjustments</span><b class="mono">${flows}</b></div>
        </div>
        <div class="st-modes" role="group" aria-label="Switch account">${modeBtns}</div>
        <p class="hint st-note">Switching to Live asks for confirmation. Paper, Live and Demo never share trades.</p>`)}
      ${card('Starting point', 'flag', `
        <div class="form-grid">
          ${numField(ACC_FIELDS[0])}
          <div class="field st-f"><label for="st-a-date">Start date</label><input class="input" type="date" id="st-a-date" value="${esc(a.startDate || '')}" max="${todayISO()}" aria-describedby="st-a-date-h"><div class="hint" id="st-a-date-h">Where the equity curve and monthly table begin.</div></div>
        </div>
        <div class="row st-acts">${btn('adjust', 'Adjust balance', { icon: 'edit', title: 'Set the balance to match your exchange — recorded as an adjustment' })}${btn('flow', 'Deposit / withdrawal', { icon: 'wallet' })}</div>`)}
      ${card('Going live', 'target', `${numField(ACC_FIELDS[1])}
        <p class="st-p dim">Live risk is capped by the staged ramp (Risk rules → Live ramp) while you prove the edge with real fills.</p>`)}
      ${card('All accounts', 'layers', `<div class="table-wrap bare"><table class="compact-t st-t"><thead><tr><th scope="col">Account</th><th scope="col" class="num">Start</th><th scope="col" class="num">Balance</th><th scope="col" class="num">Closed</th><th scope="col" class="num">Open</th><th scope="col">Since</th></tr></thead><tbody>${rows}</tbody></table></div>`)}
    </div>`;
  }
  function bindAccount(panel) {
    bindNums(panel, ACC_FIELDS);
    panel.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (m === db.mode) return;
      if (typeof App !== 'undefined' && App.switchMode) App.switchMode(m);
      else toast('Use the account switch in the sidebar', 'warn');
    }));
    const d = $('#st-a-date', panel);
    if (d) d.addEventListener('change', () => {
      const v = d.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !isFinite(Date.parse(v))) { d.value = acct().startDate || ''; toast('Pick a valid date', 'warn'); return; }
      // max= is not enforced on typed dates; a future start would put the curve's origin after every trade
      if (v > todayISO()) { d.value = acct().startDate || ''; toast('The start date cannot be in the future', 'warn'); return; }
      if (v === acct().startDate) return;
      acct().startDate = v;
      apply();
    });
    onBtn(panel, {
      adjust: () => { if (typeof TradeForm !== 'undefined' && TradeForm.adjust) TradeForm.adjust(); else toast('The trade form is not available', 'err'); },
      flow: () => { if (typeof TradeForm !== 'undefined' && TradeForm.flow) TradeForm.flow(); else toast('The trade form is not available', 'err'); },
    });
  }

  /* ── Shared bits for the sections below ────────────────── */
  const nz = (v) => (isNum(v) ? v : 0);
  const nn = (v) => (isNum(v) ? v : null);
  const mLabel = (id) => ((MARKETS.find(m => m.id === id) || {}).label || String(id || ''));
  // A number input that lives in a table cell: same data-num plumbing as numField, label via aria-label
  function cellNum(f) {
    const v = val(f);
    return `<input class="input sm mono st-num" id="st-${f.id}" data-num="${f.id}" type="number" inputmode="decimal" step="${f.step}" min="${f.min}" max="${f.max}" value="${isNum(v) ? esc(String(v)) : ''}" aria-label="${esc(f.label)} (%)"${f.nullable ? ' placeholder="—"' : ''}>`;
  }
  // Small text prompt (rename) on top of Modal.open → Promise<string|null>
  function promptText(o) {
    return new Promise((resolve) => {
      let done = false;
      Modal.open({
        title: o.title, width: 420,
        body: `<div class="field"><label for="st-prompt">${esc(o.label)}</label><input class="input" id="st-prompt" maxlength="${o.max || 60}" value="${esc(o.value || '')}" autocomplete="off">${o.hint ? `<div class="hint">${esc(o.hint)}</div>` : ''}</div>`,
        foot: `<button class="btn btn-ghost" type="button" data-act="no">Cancel</button><button class="btn btn-primary" type="button" data-act="yes">${esc(o.confirmText || 'Save')}</button>`,
        onClose: () => { if (!done) resolve(null); },
        onMount: (el, close) => {
          const inp = el.querySelector('#st-prompt');
          const ok = () => { done = true; resolve(inp.value); close(); };
          el.querySelector('[data-act=no]').onclick = () => close();
          el.querySelector('[data-act=yes]').onclick = ok;
          inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } });
          setTimeout(() => inp.select(), 40);
        },
      });
    });
  }
  // Every destructive action snapshots first. If that fails, offer a JSON download instead of silently going ahead.
  // Resolves 'snapshot' | 'download' (both truthy: go ahead) or false (stop).
  async function snapFirst(reason) {
    if (hasStore() && Store.snapshot) {
      try { await Store.snapshot(reason); return 'snapshot'; }
      catch (e) { return noSnap(e && e.message); }
    }
    return noSnap('the backup service did not load');
  }
  async function noSnap(why) {
    const ok = await confirmDialog({
      title: 'No safety snapshot', danger: true, confirmText: 'Download a backup and continue',
      html: `<p>A snapshot could not be saved first (${esc(why || 'unknown error')}).</p><p class="st-cm-note">Download a JSON backup now, so this can still be undone by importing it?</p>`,
    });
    if (!ok) return false;
    if (hasStore() && Store.exportJSON) Store.exportJSON();
    return 'download';
  }
  const savedFirst = (how) => (how === 'download' ? 'A backup file was downloaded first.' : 'A snapshot was saved first.');
  const afterRecovered = () => { if (typeof App !== 'undefined') { if (App.renderBanners) App.renderBanners(); if (App.updateChrome) App.updateChrome(); } };
  // Background changes (daily snapshot, automatic folder backup) must not wipe what the user is typing on the
  // Data page (e.g. the CoinGecko key): while a text field has focus only the async blocks are refreshed.
  const laterData = debounce(() => {
    if (!visible('data')) return;
    const a = document.activeElement;
    const typing = a && root.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|file|button)$/i.test(a.type || '')));
    if (!typing) { rerender(); return; }
    const t = tok, bad = (what) => (e) => console.error('[settings:data:' + what + ']', e);
    fillFolder(t).catch(bad('folder')); fillSnaps(t).catch(bad('snapshots')); fillUsage(t).catch(bad('usage'));
  }, 150);
  // A new backup also changes the top banner ("not backed up yet") and the topbar subtitle, which app.js owns
  const backupChanged = debounce(() => { laterData(); afterRecovered(); }, 200);
  // Last HTML of the async Data blocks: a re-render (resize, commit) shows it instead of flashing "Loading…"
  const lastFill = {};

  /* ═══ Risk rules ════════════════════════════════════════ */
  const RD = DEFAULT_SETTINGS.risk;
  // % of the account gone after n full losses in a row at pct each (compounding)
  const streakCost = (pct, n) => (1 - Math.pow(1 - pct / 100, n)) * 100;
  const RISK_FIELDS = [
    {
      id: 'r-max', path: ['risk', 'maxRiskPct'], label: 'Max risk per trade', unit: '%', min: 0.05, max: 10, step: 0.05, dp: 2, def: RD.maxRiskPct,
      tip: 'The most of your account one trade may lose if the stop is hit. Position size comes from this and the stop distance, not from leverage.',
      hint: (v) => (isNum(v) ? { text: `Ten losses in a row (it happens to every trader) would cost about <b>${r2(streakCost(v, 10))}%</b> of the account.${v > 2 ? ' Above 2% a normal losing streak does lasting damage; most professionals risk 0.5–1%.' : ''}`, cls: v > 2 ? 'warn' : '' } : null),
    },
    {
      id: 'r-day', path: ['risk', 'maxDailyLossPct'], label: 'Daily loss limit', unit: '%', min: 0.25, max: 25, step: 0.25, dp: 2, def: RD.maxDailyLossPct,
      tip: "When the day's net loss reaches this share of the account, the journal asks you to stop until tomorrow.",
      hint: (v) => {
        const r = S().risk.maxRiskPct; if (!isNum(v) || !(r > 0)) return null;
        const low = v < r, n = v / r;
        return { text: low ? "Smaller than one trade's risk, so the first full loss would already stop you." : `About <b>${r2(n)}</b> full losing trade${n === 1 ? '' : 's'} at your max risk.`, cls: low ? 'warn' : '' };
      },
    },
    {
      id: 'r-week', path: ['risk', 'maxWeeklyLossPct'], label: 'Weekly loss limit', unit: '%', min: 0.5, max: 50, step: 0.5, dp: 2, def: RD.maxWeeklyLossPct,
      tip: 'A second, slower brake: when the week (Monday to Sunday) is down this much, stop until next week and review what went wrong.',
      hint: (v) => {
        const d = S().risk.maxDailyLossPct; if (!isNum(v)) return null;
        const low = isNum(d) && v < d;
        return { text: low ? 'Smaller than your daily limit, so the daily limit can never trip first.' : isNum(d) && d > 0 ? `About <b>${r2(v / d)}</b> maximum-loss days.` : '', cls: low ? 'warn' : '' };
      },
    },
    {
      id: 'r-streak', path: ['risk', 'maxConsecLosses'], label: 'Max losses in a row', unit: 'trades', min: 1, max: 20, step: 1, int: true, def: RD.maxConsecLosses,
      tip: 'After this many losing trades in a row on one day, take a break. Losing streaks are where revenge trading starts.',
      hint: (v) => (isNum(v) ? { text: `After <b>${v}</b> loss${v === 1 ? '' : 'es'} in a row the trade form asks you to stop for the day.`, cls: '' } : null),
    },
    {
      id: 'r-cool', path: ['risk', 'cooldownMin'], label: 'Cooldown after a loss', unit: 'min', min: 0, max: 1440, step: 5, int: true, def: RD.cooldownMin,
      tip: 'Minutes to wait after a losing trade before you open the next one.',
      hint: (v) => (isNum(v) ? { text: v === 0 ? 'Off: no waiting after a loss.' : `Wait <b>${fmtMins(v)}</b> after a loss: long enough to breathe, re-read your plan and let the urge to "win it back" pass.`, cls: '' } : null),
    },
    {
      id: 'r-trades', path: ['risk', 'maxTradesDay'], label: 'Max trades per day', unit: 'trades', min: 1, max: 100, step: 1, int: true, def: RD.maxTradesDay,
      tip: 'Overtrading is the most common beginner mistake. A few planned trades beat many impulsive ones.',
      hint: (v) => (isNum(v) && v > 10 ? { text: 'More than 10 a day is scalping territory, and fees add up fast (see Fees & costs).', cls: 'warn' } : { text: 'Quality over quantity: only A-setups from your playbook.', cls: '' }),
    },
    {
      id: 'r-open', path: ['risk', 'maxOpenRiskPct'], label: 'Max open risk, all positions', unit: '%', min: 0.25, max: 50, step: 0.25, dp: 2, def: RD.maxOpenRiskPct,
      tip: 'What you would lose if every open position hit its stop at the same time ("portfolio heat").',
      hint: (v) => { const r = S().risk.maxRiskPct; return isNum(v) && r > 0 ? { text: `Room for about <b>${r2(v / r)}</b> full-risk positions open at once.`, cls: v < r ? 'warn' : '' } : null; },
    },
    {
      id: 'r-cluster', path: ['risk', 'maxClusterRiskPct'], label: 'Max risk in one correlated group', unit: '%', min: 0.25, max: 50, step: 0.25, dp: 2, def: RD.maxClusterRiskPct,
      tip: 'Coins that move together count as one bet. A BTC long plus an ETH long is close to one big long.',
      hint: (v) => { const o = S().risk.maxOpenRiskPct, hi = isNum(v) && isNum(o) && v > o; return { text: hi ? 'Higher than the open-risk cap, so it can never bind.' : 'The groups are listed below.', cls: hi ? 'warn' : '' }; },
    },
    {
      id: 'r-lev', path: ['risk', 'maxLeverage'], label: 'Max leverage', unit: '×', min: 1, max: 125, step: 1, dp: 1, def: RD.maxLeverage,
      tip: 'When size comes from the stop, leverage does not change what you lose at the stop. It changes how close the liquidation price sits.',
      hint: (v) => (isNum(v) ? { text: v > 10 ? 'Above 10× liquidation can sit inside a normal wick. Keep the stop well before the liquidation price.' : v === 1 ? 'Spot only: no borrowed money.' : 'Only matters for perpetuals. Spot trades are always 1×.', cls: v > 10 ? 'warn' : '' } : null),
    },
    {
      id: 'r-cost', path: ['risk', 'maxCostR'], label: 'Max trading cost per trade', unit: 'R', min: 0.01, max: 2, step: 0.05, dp: 2, def: RD.maxCostR,
      tip: 'Warn when estimated fees plus slippage eat more than this share of what you risk. Tight stops make costs large in R.',
      hint: (v) => (isNum(v) ? { text: `Warns when costs exceed <b>${Math.round(v * 100)}%</b> of the amount at risk.${v > 0.5 ? ' That is a lot: a 0.5R cost needs a big edge just to break even.' : ''}`, cls: v > 0.5 ? 'warn' : '' } : null),
    },
  ];
  const rf = (id) => numField(RISK_FIELDS.find(f => f.id === id));
  function rulesSentence() {
    const r = S().risk;
    const parts = [
      `risk at most <b>${r2(r.maxRiskPct)}%</b> per trade`,
      `stop for the day at <b>${MINUS}${r2(r.maxDailyLossPct)}%</b> or after <b>${r.maxConsecLosses}</b> losses in a row`,
      `stop for the week at <b>${MINUS}${r2(r.maxWeeklyLossPct)}%</b>`,
      `take at most <b>${r.maxTradesDay}</b> trades a day`,
      r.cooldownMin > 0 ? `wait <b>${fmtMins(r.cooldownMin)}</b> after a loss` : null,
      `keep open risk under <b>${r2(r.maxOpenRiskPct)}%</b>`,
      r.requireStop ? 'always set a stop' : null,
    ].filter(Boolean);
    return `<b>Your rules in plain words:</b> ${parts.join(' · ')}.`;
  }
  const hourOpts = (cur) => Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === cur ? ' selected' : ''}>${pad2(h)}:00${h === 0 ? ' (midnight)' : ''}</option>`).join('');
  function clustersHtml() {
    return `<div class="st-cls">${Object.values(CLUSTERS).map(c => `<div class="st-cl"><b>${esc(c.label)}</b><div class="tag-list">${c.coins.map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div></div>`).join('')}
      <div class="st-cl"><b>Everything else</b><div class="tag-list"><span class="tag">Alts</span></div></div></div>
      <p class="hint st-note">Any coin not listed shares one "Alts" group: altcoins tend to fall together when Bitcoin drops.</p>`;
  }
  const rampStage = () => clampN(Math.round(S().ramp.stage) || 1, 1, 4);
  function rampHtml() {
    const rp = S().ramp, stage = rampStage(), max = S().risk.maxRiskPct;
    const cap = rp.enabled ? Math.min(max, RAMP_STAGES[stage]) : max;
    const since = Date.parse(rp.stageStartAt);
    const live = computeFor('live').closedGroups;
    const nStage = isFinite(since) ? live.filter(g => g.exitMs >= since).length : live.length;
    const steps = [1, 2, 3, 4].map(i => `<li class="${i < stage ? 'done' : i === stage ? 'on' : ''}"${i === stage ? ' aria-current="step"' : ''}><b>${RAMP_STAGES[i]}%</b><small>Stage ${i}</small></li>`).join('');
    return `${toggle('ramp', 'Staged live ramp', rp.enabled, 'Live risk starts small and steps up 0.25 → 0.5 → 0.75 → 1% per trade as real fills confirm your edge. Readiness reviews it every 25 live trades.')}
      <ol class="st-ramp${rp.enabled ? '' : ' off'}" aria-label="Ramp stages">${steps}</ol>
      <div class="st-stats">
        <div><span>Live risk cap now</span><b class="mono">${r2(cap)}%</b></div>
        <div><span>Current stage</span><b class="mono">${stage} of 4</b></div>
        <div><span>Live trades this stage</span><b class="mono">${nStage} / 25</b></div>
        <div><span>Stage since</span><b>${isFinite(since) ? esc(fmtDate(since)) : '—'}</b></div>
      </div>
      ${rp.enabled ? (max < RAMP_STAGES[stage] ? `<p class="hint st-note">Your max risk per trade (${r2(max)}%) is lower than this stage, so it is the cap.</p>` : '') : '<p class="hint warn st-note">The ramp is off: live trades may use your full max risk straight away. Beginners usually keep it on.</p>'}
      <div class="field st-f"><span class="st-lbl" id="st-stage-l">Set the stage by hand</span><div id="st-seg-stage" aria-labelledby="st-stage-l"></div><div class="hint">Readiness suggests when to step up or back. Change it here only if you know why.</div></div>
      <div class="row st-acts">${btn('readiness', 'Open Readiness', { icon: 'shield' })}</div>`;
  }
  function riskHtml() {
    const r = S().risk;
    return `<div class="reading st-reading">${rulesSentence()}</div>
    <div class="st-grid">
      ${card('Per trade', 'target', `<div class="form-grid">${rf('r-max')}${rf('r-cost')}${rf('r-lev')}</div>
        <div class="st-sws">${toggle('reqstop', 'Require a stop-loss', r.requireStop, 'Without a stop there is no R and no defined risk. Strongly recommended.')}${toggle('reqstrat', 'Require a strategy', r.requireStrategy, 'Every trade should come from a playbook setup; otherwise it is a guess.')}</div>
        <p class="hint st-note">Which small results count as breakeven ("scratch") is set under <button type="button" class="link-btn" id="st-b-to-costs" data-fid="st-b-to-costs">Fees &amp; costs → Breakeven band</button>.</p>`)}
      ${card('Daily & weekly brakes', 'shield', `<div class="form-grid">${rf('r-day')}${rf('r-week')}${rf('r-streak')}${rf('r-cool')}${rf('r-trades')}
        <div class="field st-f"><label for="st-r-reset">Trading day starts at</label><select class="input" id="st-r-reset" aria-describedby="st-r-reset-h">${hourOpts(r.dayResetHour)}</select><div class="hint" id="st-r-reset-h">Crypto never closes. Daily limits and the calendar day roll over at this local hour, so pick a time you are usually not trading.</div></div></div>`)}
      ${card('Open positions & correlation', 'layers', `<div class="form-grid">${rf('r-open')}${rf('r-cluster')}</div>${clustersHtml()}`)}
      ${card('Live ramp', 'trend-up', rampHtml(), { aside: db.mode === 'live' ? '<span class="badge mode sm">Live now</span>' : '' })}
    </div>
    <div class="row st-acts st-foot">${btn('r-defaults', 'Reset rules to beginner defaults', { icon: 'refresh' })}<span class="hint">${r2(RD.maxRiskPct)}% per trade · ${r2(RD.maxDailyLossPct)}% a day · ${r2(RD.maxWeeklyLossPct)}% a week · ${RD.maxConsecLosses} losses · ${RD.cooldownMin} min · ${RD.maxTradesDay} trades</span></div>`;
  }
  function bindRisk(panel) {
    bindNums(panel, RISK_FIELDS);
    bindToggles(panel, {
      reqstop: (on) => { S().risk.requireStop = on; apply(); },
      reqstrat: (on) => { S().risk.requireStrategy = on; apply(); },
      ramp: (on) => {
        S().ramp.enabled = on;
        if (on && !S().ramp.stageStartAt) S().ramp.stageStartAt = new Date().toISOString();
        apply({ msg: on ? 'Live ramp on' : 'Live ramp off: live trades may use your full max risk', kind: on ? 'ok' : 'warn' });
      },
    });
    const rs = $('#st-r-reset', panel);
    if (rs) rs.addEventListener('change', () => {
      const h = clampN(parseInt(rs.value, 10) || 0, 0, 23);
      if (h === S().risk.dayResetHour) return;
      S().risk.dayResetHour = h; apply();
    });
    segHere(panel, 'stage', [1, 2, 3, 4].map(i => ({ id: String(i), label: `${i} · ${RAMP_STAGES[i]}%` })), String(rampStage()), (v) => {
      const st = clampN(parseInt(v, 10) || 1, 1, 4);
      if (st === S().ramp.stage) return;
      S().ramp.stage = st; S().ramp.stageStartAt = new Date().toISOString();
      apply({ msg: `Ramp set to stage ${st} (${RAMP_STAGES[st]}% per trade)`, focus: '#st-seg-stage button.on' });
    });
    onBtn(panel, {
      'to-costs': () => {
        open('costs');
        // Land on the band itself rather than the top of the costs section
        const f = root && $('#st-c-be', root);
        if (f) { f.scrollIntoView({ block: 'center' }); f.focus({ preventScroll: true }); }
      },
      readiness: () => { if (typeof Readiness !== 'undefined' && Readiness.show) Readiness.show('ramp'); else go('readiness'); },
      'r-defaults': async () => {
        const ok = await confirmDialog({ title: 'Reset risk rules?', message: 'Every rule on this page goes back to the beginner defaults. The live ramp stage is not changed.', confirmText: 'Reset rules' });
        if (!ok) return;
        S().risk = clone(DEFAULT_SETTINGS.risk);
        apply({ msg: 'Risk rules reset to beginner defaults' });
      },
    });
  }

  /* ═══ Fees & costs ══════════════════════════════════════ */
  const CD = DEFAULT_SETTINGS.costs;
  const COST_FIELDS = [
    { id: 'c-cexfee', path: ['costs', 'cexFeePct'], label: 'Exchange fee per side', unit: '%', min: 0, max: 2, step: 0.01, dp: 3, def: CD.cexFeePct, tip: 'What a centralised exchange (Binance, Coinbase, Kraken…) charges each time you buy or sell, as a % of the position.' },
    { id: 'c-cexslip', path: ['costs', 'cexSlipPct'], label: 'Exchange slippage per side', unit: '%', min: 0, max: 5, step: 0.01, dp: 3, def: CD.cexSlipPct, tip: 'How much worse than the screen price a market order usually fills.' },
    { id: 'c-dexfee', path: ['costs', 'dexFeePct'], label: 'DEX swap fee per side', unit: '%', min: 0, max: 5, step: 0.01, dp: 3, def: CD.dexFeePct, tip: 'PulseX takes 0.29% per swap. Real swaps already include it in the price; this only haircuts paper trades.' },
    { id: 'c-dexslip', path: ['costs', 'dexSlipPct'], label: 'DEX price impact per side', unit: '%', min: 0, max: 20, step: 0.05, dp: 3, def: CD.dexSlipPct, tip: 'Thin PulseChain pools move against bigger orders. 0.5% is a cautious default for small sizes.' },
  ];
  const BE_FIELD = {
    id: 'c-be', path: ['beBandR'], label: 'Scratch band', unit: 'R', min: 0, max: 0.5, step: 0.01, dp: 2, def: 0,
    tip: 'Trades whose net result is within ± this many R count as breakeven, so a tiny fee-driven loss is not called a loss.',
    hint: (v) => (isNum(v) ? { text: v === 0 ? `Off: any net loss counts as a loss, even ${MINUS}$0.30 of fees on a flat trade. 0.05–0.1R is typical.` : `Trades between <b>${MINUS}${r2(v)}R</b> and <b>+${r2(v)}R</b> count as breakeven ("scratch"). This changes win rate and streaks everywhere.`, cls: v > 0.25 ? 'warn' : '' } : null),
  };
  // Round trip = fee + slippage on the way in and again on the way out; in R it divides by the stop distance.
  function rtLine(fee, slip) {
    const rt = 2 * (nz(fee) + nz(slip));
    return `Round trip ≈ <b>${r2(rt)}%</b> of the position = <b>${r2(rt)}R</b> with a 1% stop, <b>${r2(rt / 3)}R</b> with a 3% stop.`;
  }
  const dexCoins = () => (Array.isArray(S().costs.dexCoins) ? S().costs.dexCoins : (S().costs.dexCoins = []));
  function dexCoinsHtml() {
    return `<div class="field st-f st-mt"><span class="st-lbl">Coins treated as DEX trades</span>
      <div class="tag-list">${dexCoins().map((c, i) => `<span class="tag">${esc(c)}<button type="button" data-dex-del="${i}" aria-label="Remove ${esc(c)}">${ic('x')}</button></span>`).join('') || '<span class="dim">None</span>'}</div>
      <div class="st-add"><input class="input sm mono" id="st-dex-add" maxlength="15" placeholder="e.g. PLSX" aria-label="Add a coin traded on a DEX" autocomplete="off" spellcheck="false"><button type="button" class="btn btn-ghost btn-xs" id="st-b-dex-add">${ic('plus')}Add</button></div>
      <div class="hint">Paper trades in these coins (or marked as DEX swaps) get the DEX costs; everything else gets exchange costs.</div></div>`;
  }
  function presetList() {
    if (!isO(S().fees.presets)) S().fees.presets = {};
    return Object.keys(S().fees.presets).map((k, i) => { const [venue, market] = k.split('|'); return { k, i, venue: venue || k, market: market || 'spot', p: S().fees.presets[k] || {} }; });
  }
  function presetFields() {
    const out = [];
    for (const x of presetList()) {
      const name = `${x.venue} ${mLabel(x.market)}`;
      const leg = (key, label) => ({
        id: `fp-${x.i}-${key}`, label: `${name} ${label}`, unit: '%', min: 0, max: 5, step: 0.005, dp: 4, nullable: key === 'swap',
        get: () => { const p = S().fees.presets[x.k]; return p && isNum(p[key]) ? p[key] : null; },
        // A cleared rate is stored as null (core keeps it), so a built-in default does not come back on reload
        set: (v) => { const p = S().fees.presets[x.k] || (S().fees.presets[x.k] = {}); p[key] = v == null ? null : v; },
      });
      out.push(leg('maker', 'maker fee'), leg('taker', 'taker fee'));
      if (x.market === 'dex') out.push(leg('swap', 'swap fee'));
    }
    return out;
  }
  function checkedInfo() {
    const c = String(S().fees.checked || ''), m = /^(\d{4})-(\d{2})/.exec(c);
    if (!m) return { text: c || 'never', old: true };
    const d = new Date(+m[1], +m[2] - 1, 1), now = new Date();
    const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
    return { text: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), old: months > 6 };
  }
  // Built-in presets always come back on the next load (core merges the defaults in), so they can be
  // edited and reset but not removed; presets the user added can be removed.
  const isDefPreset = (k) => Object.prototype.hasOwnProperty.call(FEE_PRESETS, k);
  const presetEdited = (k) => {
    const d = FEE_PRESETS[k], p = S().fees.presets[k] || {};
    return ['maker', 'taker', 'swap'].some(f => (isNum(d[f]) ? d[f] : null) !== (isNum(p[f]) ? p[f] : null));
  };
  function feeTable() {
    const list = presetList(), fields = presetFields(), F = (id) => fields.find(f => f.id === id);
    const rows = list.map((x) => {
      const p = x.p, dex = x.market === 'dex', name = `${esc(x.venue)} ${esc(mLabel(x.market))}`;
      const rt = 2 * (dex ? nz(p.swap) : nz(p.taker));
      const act = !isDefPreset(x.k)
        ? `<button type="button" class="btn btn-quiet btn-xs st-icon" data-fp-del="${x.i}" data-fid="st-fp-del-${x.i}" aria-label="Remove the ${name} preset">${ic('trash')}</button>`
        : presetEdited(x.k)
          ? `<button type="button" class="btn btn-quiet btn-xs st-icon" data-fp-reset="${x.i}" aria-label="Reset the ${name} preset to the built-in rates" title="Reset to the built-in rates">${ic('undo')}</button>`
          : '<span class="st-def" title="Built-in base-tier rates">default</span>';
      return `<tr><th scope="row"><span class="st-venue">${esc(x.venue)}</span> <span class="badge cat sm">${esc(mLabel(x.market))}</span></th>
        <td>${cellNum(F(`fp-${x.i}-maker`))}</td><td>${cellNum(F(`fp-${x.i}-taker`))}</td>
        <td>${dex ? cellNum(F(`fp-${x.i}-swap`)) : '<span class="dim">—</span>'}</td>
        <td class="num">${r2(rt)}%</td>
        <td class="st-ra">${act}</td></tr>`;
    }).join('');
    return `<div class="table-wrap bare st-fees"><table class="compact-t st-t"><thead><tr><th scope="col">Venue</th><th scope="col">Maker %</th><th scope="col">Taker %</th><th scope="col">Swap %</th><th scope="col" class="num">Round trip${infoTip('Taker fee on the way in and again on the way out (or the swap fee twice on a DEX), as a % of the position.')}</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="dim">No presets yet. Add one below.</td></tr>'}</tbody></table></div>`;
  }
  function costsHtml() {
    const c = S().costs, fe = S().fees, ck = checkedInfo(), F = (id) => numField(COST_FIELDS.find(f => f.id === id));
    const venues = !fe.defaultVenue || VENUES.includes(fe.defaultVenue) ? VENUES : [String(fe.defaultVenue), ...VENUES];
    return `<div class="st-grid">
      ${card('Paper-trade haircut', 'scale', `<p class="st-p">Paper fills are perfect. To show what your results would look like live, Readiness and Analytics subtract these costs from every paper trade.</p>
        <div class="form-grid">${F('c-cexfee')}${F('c-cexslip')}</div>
        <div class="reading st-rt"><b>Exchange:</b> ${rtLine(c.cexFeePct, c.cexSlipPct)}</div>
        <div class="form-grid st-mt">${F('c-dexfee')}${F('c-dexslip')}</div>
        <div class="reading st-rt"><b>DEX:</b> ${rtLine(c.dexFeePct, c.dexSlipPct)}</div>
        ${dexCoinsHtml()}`)}
      ${card('Breakeven band', 'minus', `${numField(BE_FIELD)}<p class="st-p dim">Fees turn many flat trades into tiny losses. Without a band they drag your win rate down even though nothing really went wrong.</p>`)}
      ${card('Exchange fee presets', 'wallet', `<p class="st-p">Used to estimate fees when you log a trade and in the position-size calculator. <b>Verify on your exchange's fee page: these are base-tier defaults.</b> Rates change (Kraken and Coinbase re-tiered in 2026, and Coinbase differs by region), and VIP tiers or token discounts lower them. Built-in rows can be edited and reset; rows you add can be removed.</p>
        ${feeTable()}
        <div class="st-add st-add-fp"><select class="input sm" id="st-fp-venue" aria-label="Venue for a new preset">${VENUES.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select><select class="input sm" id="st-fp-market" aria-label="Market for a new preset">${MARKETS.map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</select>${btn('fp-add', 'Add preset', { icon: 'plus' })}</div>
        <div class="row st-acts">${btn('fp-checked', 'I checked these today', { icon: 'check' })}${btn('fp-defaults', 'Restore default presets', { icon: 'refresh' })}</div>
        <p class="hint st-note ${ck.old ? 'warn' : ''}">Last checked: <b>${esc(ck.text)}</b>${ck.old ? ', more than 6 months ago, so worth a re-check.' : '.'} DEX swap fees are already inside the executed price and are never added on top of a real swap.</p>
        <div class="form-grid st-mt">
          <div class="field st-f"><label for="st-fp-dv">Default venue</label><select class="input" id="st-fp-dv">${venues.map(v => `<option value="${esc(v)}"${v === fe.defaultVenue ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
          <div class="field st-f"><label for="st-fp-dm">Default market</label><select class="input" id="st-fp-dm" aria-describedby="st-fp-dm-h">${MARKETS.map(m => `<option value="${esc(m.id)}"${m.id === fe.defaultMarket ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select><div class="hint" id="st-fp-dm-h">New trades start here. Beginners: spot.</div></div>
        </div>
        <div class="st-sws">${toggle('autofill', 'Fill in fees automatically on paper trades', fe.autoFillPaper, "Uses the preset for the trade's venue, market and maker/taker legs. A fee you type yourself is never overwritten.")}</div>`,
        { cls: 'st-wide', aside: `<span class="badge ${ck.old ? 'warn' : 'cat'} sm">checked ${esc(ck.text)}</span>` })}
    </div>`;
  }
  function bindCosts(panel) {
    bindNums(panel, [...COST_FIELDS, BE_FIELD, ...presetFields()]);
    // DEX coin chips
    const addDex = () => {
      const inp = $('#st-dex-add', panel); if (!inp) return;
      const v = inp.value.trim().toUpperCase().replace(/\s+/g, '');
      if (!v) return;
      if (!/^[A-Z0-9.$_-]{1,15}$/.test(v)) { toast('Use the coin symbol, e.g. PLSX', 'warn'); return; }
      if (dexCoins().includes(v)) { toast(`${v} is already in the list`, 'warn'); inp.select(); return; }
      dexCoins().push(v);
      apply({ focus: '#st-dex-add' });
    };
    const di = $('#st-dex-add', panel);
    if (di) di.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addDex(); } });
    panel.querySelectorAll('[data-dex-del]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.dexDel; if (dexCoins()[i] == null) return;
      dexCoins().splice(i, 1);
      apply({ focus: '#st-dex-add' });
    }));
    // Fee presets
    panel.querySelectorAll('[data-fp-del]').forEach(b => b.addEventListener('click', () => {
      const x = presetList()[+b.dataset.fpDel]; if (!x || isDefPreset(x.k)) return;
      const prev = clone(x.p);
      delete S().fees.presets[x.k];
      apply({ focus: '#st-fp-venue', after: () => toast(`Removed the ${x.venue} ${mLabel(x.market)} preset`, 'ok', { ms: 8000, action: { label: 'Undo', run: () => { S().fees.presets[x.k] = prev; commit(); } } }) });
    }));
    panel.querySelectorAll('[data-fp-reset]').forEach(b => b.addEventListener('click', () => {
      const x = presetList()[+b.dataset.fpReset]; if (!x || !isDefPreset(x.k)) return;
      const prev = clone(x.p);
      S().fees.presets[x.k] = clone(FEE_PRESETS[x.k]);
      apply({ focus: `#st-fp-${x.i}-maker`, after: () => toast(`${x.venue} ${mLabel(x.market)} reset to the built-in rates`, 'ok', { ms: 8000, action: { label: 'Undo', run: () => { S().fees.presets[x.k] = prev; commit(); } } }) });
    }));
    onBtn(panel, {
      'dex-add': addDex,
      'fp-add': () => {
        const v = ($('#st-fp-venue', panel) || {}).value, m = ($('#st-fp-market', panel) || {}).value;
        if (!v || !m) return;
        const k = `${v}|${m}`;
        if (S().fees.presets[k]) { toast(`${v} ${mLabel(m)} is already in the table`, 'warn'); return; }
        S().fees.presets[k] = m === 'dex' ? { maker: 0, taker: 0, swap: 0.3 } : { maker: 0.1, taker: 0.1 };
        apply({ msg: `Added ${v} ${mLabel(m)}: enter the rates from your account's fee page` });
      },
      'fp-checked': () => { const d = new Date(); S().fees.checked = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; apply({ msg: 'Fee presets marked as checked this month' }); },
      'fp-defaults': async () => {
        const ok = await confirmDialog({ title: 'Restore default fee presets?', message: 'Your edits and any presets you added are replaced by the base-tier defaults.', confirmText: 'Restore defaults' });
        if (!ok) return;
        S().fees.presets = clone(FEE_PRESETS); S().fees.checked = DEFAULT_SETTINGS.fees.checked;
        apply({ msg: 'Default fee presets restored' });
      },
    });
    const dv = $('#st-fp-dv', panel), dm = $('#st-fp-dm', panel);
    if (dv) dv.addEventListener('change', () => { S().fees.defaultVenue = dv.value; apply(); });
    if (dm) dm.addEventListener('change', () => { S().fees.defaultMarket = MARKETS.some(m => m.id === dm.value) ? dm.value : 'spot'; apply(); });
    bindToggles(panel, { autofill: (on) => { S().fees.autoFillPaper = on; apply(); } });
  }

  /* ═══ Tags & mistakes ═══════════════════════════════════ */
  const MK_GROUPS = [['entry', 'Entry'], ['risk', 'Risk'], ['management', 'Trade management'], ['exit', 'Exit'], ['mindset', 'Mindset'], ['execution', 'Execution'], ['other', 'Other']];
  const WEIGHTS = [['minor', 'Minor'], ['normal', 'Normal'], ['severe', 'Severe']];
  const weightOf = (m) => (m.severe ? 'severe' : m.minor ? 'minor' : 'normal');
  const gname = (g) => String((g && g.name) || 'Untitled');
  const cleanTag = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 32);
  // How often each tag / mistake id is used — every account, trash included (a restored trade must keep its meaning)
  function usage(field) {
    const out = new Map();
    for (const m of MODES) for (const e of db.accounts[m].entries) {
      if (!Array.isArray(e[field])) continue;
      for (const t of e[field]) out.set(t, (out.get(t) || 0) + 1);
    }
    return out;
  }
  const grpOpts = (cur) => {
    const list = MK_GROUPS.some(([id]) => id === cur) ? MK_GROUPS : [...MK_GROUPS, [cur, cur]];
    return list.map(([id, l]) => `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  };
  const missingDefaults = () => DEFAULT_MISTAKES.filter(d => !db.mistakes.some(m => m.id === d.id));
  function tagGroupsHtml(tu) {
    const body = db.tagGroups.map((g, gi) => {
      const tags = Array.isArray(g.tags) ? g.tags : [];
      const chipsHtml = tags.map((t, ti) => {
        const n = tu.get(t) || 0, ts = esc(String(t));
        return `<span class="tag st-tag"><button type="button" class="st-tag-t" data-tag-ren="${gi}:${ti}" data-fid="st-tagren-${gi}-${ti}" aria-label="Rename tag ${ts}${n ? `, used ${n} time${n === 1 ? '' : 's'}` : ''}">${ts}</button>${n ? `<span class="st-use" aria-hidden="true">${n}</span>` : ''}<button type="button" data-tag-del="${gi}:${ti}" aria-label="Remove ${ts} from the list">${ic('x')}</button></span>`;
      }).join('');
      return `<div class="st-tg">
        <div class="st-tg-h"><input class="input sm st-tg-name" id="st-tg-${gi}-n" data-tg-name="${gi}" value="${esc(gname(g))}" maxlength="40" aria-label="Name of tag group ${gi + 1}"><span class="dim st-tg-c">${plural(tags.length, 'tag')}</span>
          <button type="button" class="btn btn-quiet btn-xs st-icon" data-tg-del="${gi}" data-fid="st-tgdel-${gi}" aria-label="Delete the ${esc(gname(g))} group">${ic('trash')}</button></div>
        <div class="tag-list">${chipsHtml || '<span class="dim st-none">No tags yet</span>'}</div>
        <div class="st-add"><input class="input sm" id="st-tg-${gi}-add" data-tag-add="${gi}" maxlength="32" placeholder="Add a tag…" aria-label="New tag in ${esc(gname(g))}" autocomplete="off"><button type="button" class="btn btn-ghost btn-xs" data-tag-addb="${gi}">${ic('plus')}Add</button></div>
      </div>`;
    }).join('');
    return `<div class="st-tgs">${body || '<p class="dim">No tag groups yet.</p>'}</div>
      <div class="st-add st-add-g"><input class="input sm" id="st-tg-new" maxlength="40" placeholder="New group, e.g. Setup quality" aria-label="New tag group name" autocomplete="off">${btn('tg-new', 'Add group', { icon: 'plus' })}</div>
      <p class="hint st-note">Removing a tag from a list keeps it on past trades; it just stops being suggested. Renaming updates every trade that uses it.</p>`;
  }
  function mistakesHtml(mu) {
    const rows = db.mistakes.map((m, i) => {
      const n = mu.get(m.id) || 0, w = weightOf(m), lbl = esc(String(m.label || ''));
      const acts = [
        m.hidden ? `<button type="button" class="btn btn-quiet btn-xs" data-mk-hide="${i}" aria-label="Show ${lbl} again">${ic('eye')}Show</button>`
          : n ? `<button type="button" class="btn btn-quiet btn-xs" data-mk-hide="${i}" aria-label="Hide ${lbl} from the trade form">${ic('eye-off')}Hide</button>` : '',
        n ? '' : `<button type="button" class="btn btn-quiet btn-xs st-icon" data-mk-del="${i}" aria-label="Delete ${lbl}">${ic('trash')}</button>`,
      ].join('');
      return `<div class="st-mk-row${m.hidden ? ' st-hid' : ''}">
        <input class="input sm st-mk-l" id="st-mk-${i}-l" data-mk-label="${i}" value="${lbl}" maxlength="60" aria-label="Mistake name">
        <select class="input sm" id="st-mk-${i}-g" data-mk-group="${i}" aria-label="Group of ${lbl}">${grpOpts(String(m.group || 'other'))}</select>
        <select class="input sm st-w-${w}" id="st-mk-${i}-w" data-mk-weight="${i}" aria-label="Weight of ${lbl}">${WEIGHTS.map(([id, l]) => `<option value="${id}"${id === w ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <span class="st-mk-n mono" title="Used on ${n} entr${n === 1 ? 'y' : 'ies'}">${n ? `${n}<span class="sr-only"> uses</span>` : '<span class="dim">0</span>'}</span>
        <span class="st-mk-a">${m.hidden ? '<span class="badge cat sm">Hidden</span>' : ''}${acts}</span>
      </div>`;
    }).join('');
    const miss = missingDefaults().length;
    return `<div class="st-mk" role="group" aria-label="Mistake list">
        <div class="st-mk-row st-mk-head" aria-hidden="true"><span>Mistake</span><span>Group</span><span>Weight</span><span>Used</span><span></span></div>
        ${rows || '<p class="dim">No mistakes defined.</p>'}
      </div>
      <div class="st-add st-add-mk"><input class="input sm" id="st-mk-new" maxlength="60" placeholder="New mistake, e.g. Traded during news" aria-label="New mistake name" autocomplete="off"><select class="input sm" id="st-mk-new-g" aria-label="Group of the new mistake">${grpOpts('mindset')}</select>${btn('mk-new', 'Add mistake', { icon: 'plus' })}</div>
      <div class="row st-acts">${btn('mk-defaults', miss ? `Restore ${plural(miss, 'missing default')}` : 'All defaults present', { icon: 'refresh', disabled: !miss })}</div>`;
  }
  function emotionsHtml() {
    const row = (list) => `<div class="chip-row st-emo">${list.map(e => `<span class="chip sm">${esc(e.label)}</span>`).join('')}</div>`;
    return `<p class="st-p">These two lists are fixed, so your emotion reports stay comparable over months of trading.</p>
      <div class="chip-group-l">Before the trade</div>${row(EMOTIONS_PRE)}<div class="chip-group-l">After the trade</div>${row(EMOTIONS_POST)}`;
  }
  function journalHtml() {
    const tu = usage('tags'), mu = usage('mistakes');
    const ns = (Array.isArray(db.strategies) ? db.strategies : []).filter(s => s && !s.archived).length;
    return `<div class="st-grid">
      ${card('Tag groups', 'list', tagGroupsHtml(tu), { cls: 'st-wide', sub: 'Tags describe the context of a trade: market condition, timeframe, setup quality. Click a tag to rename it everywhere.' })}
      ${card('Mistakes', 'alert', mistakesHtml(mu), { cls: 'st-wide', sub: 'This list drives the "cost of mistakes" report. Severe mistakes count most in grades and reports. A mistake already used on a trade can be hidden but not deleted, so old reviews keep their meaning.' })}
      ${card('Emotions', 'brain', emotionsHtml())}
      ${card('Strategies', 'book', `<p class="st-p">${ns ? `Your ${plural(ns, 'strategy', 'strategies')}, with their entry and exit rules and the pre-trade checklist built from them, live` : 'No strategies yet. Strategies, with their entry and exit rules and the pre-trade checklist built from them, live'} in the <b>Playbook</b>, next to each strategy's own results.</p>
        <div class="row st-acts">${btn('playbook', 'Open the Playbook', { icon: 'book' })}</div>`)}
    </div>`;
  }
  function bindJournal(panel) {
    const gs = db.tagGroups;
    /* tag groups */
    panel.querySelectorAll('[data-tg-name]').forEach(inp => inp.addEventListener('change', () => {
      const g = gs[+inp.dataset.tgName]; if (!g) return;
      const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!v) { inp.value = gname(g); toast('A group needs a name', 'warn'); return; }
      if (v === g.name) return;
      g.name = v; apply();
    }));
    panel.querySelectorAll('[data-tg-del]').forEach(b => b.addEventListener('click', async () => {
      const g = gs[+b.dataset.tgDel]; if (!g) return;
      if (g.tags.length) {
        const ok = await confirmDialog({ title: `Delete the "${gname(g)}" group?`, html: `<p>Its ${plural(g.tags.length, 'tag')} stop being suggested. Trades that already use them keep them.</p>`, confirmText: 'Delete group', danger: true });
        if (!ok) return;
      }
      const i = gs.indexOf(g); if (i < 0) return;
      gs.splice(i, 1);
      // Focus goes to "new group", never to the next group's delete button (an empty group deletes without asking)
      apply({ focus: '#st-tg-new', after: () => toast(`Deleted the "${gname(g)}" group`, 'ok', { ms: 8000, action: { label: 'Undo', run: () => { db.tagGroups.splice(Math.min(i, db.tagGroups.length), 0, g); commit(); } } }) });
    }));
    const addTag = (gi) => {
      const g = gs[gi], inp = $(`#st-tg-${gi}-add`, panel); if (!g || !inp) return;
      const v = cleanTag(inp.value); if (!v) return;
      const dupe = gs.find(x => x.tags.some(t => String(t).toLowerCase() === v.toLowerCase()));
      if (dupe) { toast(`"${v}" already exists in ${gname(dupe)}`, 'warn'); inp.select(); return; }
      g.tags.push(v);
      apply({ focus: `#st-tg-${gi}-add` });
    };
    panel.querySelectorAll('[data-tag-add]').forEach(inp => inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addTag(+inp.dataset.tagAdd); } }));
    panel.querySelectorAll('[data-tag-addb]').forEach(b => b.addEventListener('click', () => addTag(+b.dataset.tagAddb)));
    panel.querySelectorAll('[data-tag-del]').forEach(b => b.addEventListener('click', () => {
      const [gi, ti] = b.dataset.tagDel.split(':').map(Number), g = gs[gi];
      if (!g || g.tags[ti] == null) return;
      const [t] = g.tags.splice(ti, 1);
      apply({ focus: `#st-tg-${gi}-add`, after: () => toast(`Removed "${t}" from ${gname(g)}`, 'ok', { ms: 8000, action: { label: 'Undo', run: () => { g.tags.splice(Math.min(ti, g.tags.length), 0, t); commit(); } } }) });
    }));
    panel.querySelectorAll('[data-tag-ren]').forEach(b => b.addEventListener('click', async () => {
      const [gi, ti] = b.dataset.tagRen.split(':').map(Number), g = gs[gi];
      if (!g || g.tags[ti] == null) return;
      const old = g.tags[ti], n = usage('tags').get(old) || 0;
      const nu = await promptText({ title: 'Rename tag', label: 'New name', value: String(old), max: 32, confirmText: 'Rename', hint: n ? `Updates ${plural(n, 'entry', 'entries')} that use "${old}".` : 'Not used on any trade yet.' });
      if (nu == null) return;
      const v = cleanTag(nu);
      if (!v || v === old) return;
      if (gs.some(x => x.tags.some(t => t !== old && String(t).toLowerCase() === v.toLowerCase()))) { toast(`"${v}" already exists; pick another name`, 'warn'); return; }
      const i = g.tags.indexOf(old); if (i >= 0) g.tags[i] = v;
      let hit = 0;
      for (const m of MODES) for (const e of db.accounts[m].entries) {
        if (!Array.isArray(e.tags) || !e.tags.includes(old)) continue;
        e.tags = [...new Set(e.tags.map(t => (t === old ? v : t)))]; hit++;
      }
      apply({ msg: hit ? `Tag renamed: ${plural(hit, 'entry', 'entries')} updated` : 'Tag renamed' });
    }));
    const addGroup = () => {
      const inp = $('#st-tg-new', panel); if (!inp) return;
      const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!v) { inp.focus(); return; }
      if (gs.some(g => gname(g).toLowerCase() === v.toLowerCase())) { toast(`A group called "${v}" already exists`, 'warn'); inp.select(); return; }
      gs.push({ id: 'tg' + Date.now().toString(36), name: v, tags: [] });
      apply({ focus: `#st-tg-${gs.length - 1}-add` });
    };
    const ng = $('#st-tg-new', panel);
    if (ng) ng.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addGroup(); } });
    /* mistakes */
    const ms = db.mistakes;
    panel.querySelectorAll('[data-mk-label]').forEach(inp => inp.addEventListener('change', () => {
      const m = ms[+inp.dataset.mkLabel]; if (!m) return;
      const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!v) { inp.value = String(m.label || ''); toast('A mistake needs a name', 'warn'); return; }
      if (v === m.label) return;
      m.label = v; apply();
    }));
    panel.querySelectorAll('[data-mk-group]').forEach(sel => sel.addEventListener('change', () => { const m = ms[+sel.dataset.mkGroup]; if (!m) return; m.group = sel.value; apply(); }));
    panel.querySelectorAll('[data-mk-weight]').forEach(sel => sel.addEventListener('change', () => {
      const m = ms[+sel.dataset.mkWeight]; if (!m) return;
      delete m.severe; delete m.minor;
      if (sel.value === 'severe') m.severe = true; else if (sel.value === 'minor') m.minor = true;
      apply();
    }));
    panel.querySelectorAll('[data-mk-hide]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.mkHide, m = ms[i]; if (!m) return;
      if (m.hidden) delete m.hidden; else m.hidden = true;
      apply({ focus: `#st-mk-${i}-l` });
    }));
    panel.querySelectorAll('[data-mk-del]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.mkDel, m = ms[i]; if (!m) return;
      if (usage('mistakes').get(m.id)) { toast('This mistake is used on a trade; hide it instead', 'warn'); return; }
      ms.splice(i, 1);
      apply({ focus: '#st-mk-new', after: () => toast(`Deleted "${m.label}"`, 'ok', { ms: 8000, action: { label: 'Undo', run: () => { db.mistakes.splice(Math.min(i, db.mistakes.length), 0, m); commit(); } } }) });
    }));
    const addMistake = () => {
      const inp = $('#st-mk-new', panel), gsel = $('#st-mk-new-g', panel); if (!inp) return;
      const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!v) { inp.focus(); return; }
      if (ms.some(m => String(m.label || '').toLowerCase() === v.toLowerCase())) { toast(`"${v}" is already in the list`, 'warn'); inp.select(); return; }
      const base = v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'mistake';
      let id = 'u_' + base;
      while (ms.some(m => m.id === id)) id = 'u_' + base + '_' + Math.random().toString(36).slice(2, 5);
      ms.push({ id, label: v, group: (gsel && gsel.value) || 'other' });
      apply({ focus: '#st-mk-new' });
    };
    const nm = $('#st-mk-new', panel);
    if (nm) nm.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addMistake(); } });
    onBtn(panel, {
      'tg-new': addGroup,
      'mk-new': addMistake,
      playbook: () => go('playbook'),
      'mk-defaults': () => {
        const miss = missingDefaults(); if (!miss.length) return;
        for (const d of miss) ms.push(clone(d));
        apply({ msg: `Restored ${plural(miss.length, 'default mistake')}` });
      },
    });
  }

  /* ═══ Appearance ════════════════════════════════════════ */
  const PALS = [
    { id: 'classic', label: 'Classic', sub: 'Green for profit, red for loss.' },
    { id: 'cvd', label: 'Colour-blind safe', sub: 'Blue for profit, orange for loss. Clear with red-green colour blindness (about 1 in 12 men).' },
  ];
  const UNIT_HINT = {
    '$': 'Profit or loss in dollars.',
    '%': 'Profit or loss as a % of the account balance before each trade.',
    R: 'Multiples of what you risked: +2R means you made twice your planned loss. The fairest way to compare trades of different sizes.',
  };
  function appearanceHtml() {
    const s = S();
    let now = '', sess = [];
    try { if (typeof Metrics !== 'undefined') { now = Metrics.sessionAt ? Metrics.sessionAt(Date.now()) : ''; sess = Metrics.sessionList ? Metrics.sessionList() : []; } } catch (e) { now = ''; sess = []; }
    return `<div class="st-grid">
      ${card('Profit & loss colours', 'eye', `<div class="st-pals" role="group" aria-label="Profit and loss colours">${PALS.map(p => `<button type="button" class="st-pal st-pv-${p.id}${s.palette === p.id ? ' on' : ''}" data-pal="${p.id}" aria-pressed="${s.palette === p.id}">
          <span class="st-pal-sw" aria-hidden="true"><span class="u">▲ +$120</span><span class="d">▼ ${MINUS}$80</span></span>
          <b>${esc(p.label)}</b><small>${esc(p.sub)}</small></button>`).join('')}</div>
        <p class="hint st-note">Every profit or loss also carries a sign and ▲/▼, so colour is never the only cue. Charts switch too.</p>`)}
      ${card('Numbers & tables', 'stats', `
        <div class="field st-f"><span class="st-lbl" id="st-units-l">Show results in</span><div id="st-seg-units" aria-labelledby="st-units-l"></div><div class="hint">${esc(UNIT_HINT[s.units] || UNIT_HINT.$)} The $ / % / R switch in the top bar changes this too.</div></div>
        <div class="field st-f st-mt"><span class="st-lbl" id="st-density-l">Table density</span><div id="st-seg-density" aria-labelledby="st-density-l"></div><div class="hint">Compact fits more trades on screen in the ledger.</div></div>
        <div class="st-sws">${toggle('privacy', 'Privacy mode', View.privacy, 'Blurs dollar amounts for screenshots and screen sharing; R and % stay visible. Shortcut: Shift+P.')}</div>`)}
      ${card('Trading sessions', 'clock', `
        <div id="st-seg-sess" aria-label="How sessions are defined"></div>
        <p class="st-p st-mt">${s.sessionScheme === 'utc' ? 'Fixed UTC blocks never move. Simple, but London and New York really open an hour earlier or later in UTC when the clocks change.' : "Market hours follow each city's local time, daylight saving included: the most accurate view of when Asia, London and New York are really trading."}</p>
        ${sess.length ? `<ul class="st-sess">${sess.map(x => `<li${x.key === now ? ' class="on"' : ''}><span>${esc(x.label)}</span>${x.key === now ? '<span class="badge open sm">now</span>' : ''}</li>`).join('')}</ul>` : ''}
        <p class="hint st-note">Used by Analytics → Timing. Weekends are flagged separately.</p>`)}
      ${card('Trade form & dashboard', 'edit', `<div class="st-sws">
          ${toggle('adv', 'Show advanced trade fields by default', s.advancedFields, 'Perpetual and DEX fields, leverage, funding, gas and the high/low during the trade. Off keeps the form short for spot trading.')}
          ${toggle('onb', 'Show the getting-started checklist', !s.onboardingDismissed, 'The setup steps at the top of the dashboard.')}
        </div>`)}
    </div>`;
  }
  function bindAppearance(panel) {
    panel.querySelectorAll('[data-pal]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.pal === 'cvd' ? 'cvd' : 'classic';
      if (S().palette === id) return;
      S().palette = id;
      applyView({ view: true, focus: `[data-pal="${id}"]` });
    }));
    segHere(panel, 'units', [{ id: '$', label: '$ Dollars' }, { id: '%', label: '% Account' }, { id: 'R', label: 'R Multiples' }], S().units, (v) => {
      S().units = ['$', '%', 'R'].includes(v) ? v : '$';
      applyView({ view: true, focus: '#st-seg-units button.on' });
    });
    segHere(panel, 'density', [{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }], S().density === 'compact' ? 'compact' : 'comfortable', (v) => {
      S().density = v === 'compact' ? 'compact' : 'comfortable';
      applyView({ focus: '#st-seg-density button.on' });
    });
    segHere(panel, 'sess', [{ id: 'dst', label: 'Market hours (DST-aware)' }, { id: 'utc', label: 'Fixed UTC blocks' }], S().sessionScheme === 'utc' ? 'utc' : 'dst', (v) => {
      S().sessionScheme = v === 'utc' ? 'utc' : 'dst';
      applyView({ focus: '#st-seg-sess button.on' });
    });
    bindToggles(panel, {
      privacy: (on) => { View.setPrivacy(on); refocus('st-privacy'); },   // setPrivacy re-renders the page itself
      adv: (on) => { S().advancedFields = on; applyView(); },
      onb: (on) => { S().onboardingDismissed = !on; applyView(); },
    });
  }

  /* ═══ Data & backups ════════════════════════════════════ */
  const TONE_LBL = { ok: 'Up to date', warn: 'Due', stop: 'Overdue' };
  const countsHtml = (c) => MODES.filter(m => c && c[m]).map(m => `<span class="badge sm st-mb-${m}">${MODE_LABEL[m]} ${c[m]}</span>`).join(' ') || '<span class="dim">no trades</span>';
  function browserName() {
    const ua = navigator.userAgent || '';
    const b = /Edg\//.test(ua) ? 'Microsoft Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Google Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
    let app = false;
    try { app = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches; } catch (e) { app = false; }
    return b + (app ? ' · app window' : '');
  }
  // Raw copies core.js stashed when the saved journal would not parse ('cj.corrupt.<ms>')
  function corruptCopies() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('cj.corrupt.') === 0) out.push({ k, at: +k.slice(11) || null, size: (localStorage.getItem(k) || '').length });
      }
    } catch (e) { /* storage blocked */ }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  function exportCSV(scope) {
    const modes = scope === 'all' ? MODES : [db.mode];
    const rows = [['Account', 'Type', 'Entry time', 'Exit time', 'Coin', 'Side', 'Strategy', 'Market', 'Venue', 'Entry price', 'Exit price', 'Amount', 'Stop', 'Target',
      'Fees', 'Funding', 'Gas', 'Net P/L', 'Net R', 'Balance after', 'Status', 'Grade', 'Mistakes', 'Tags', 'Thesis', 'Notes', 'Flow amount', 'Flow note', 'Id', 'Parent id']];
    for (const m of modes) {
      for (const r of computeFor(m).rows) {
        const flow = r.type === 'deposit' || r.type === 'withdrawal' || r.type === 'adjustment';
        rows.push([MODE_LABEL[m], r.type || '', r.entryAt || '', r.exitAt || '', flow ? '' : (r.coin || ''), flow ? '' : (r.side || ''), flow || !r.strategyId ? '' : stratName(r.strategyId),
          r.market || '', r.venue || '', nn(r.entryPrice), nn(r.exitPrice), nn(r.amount), nn(r.stopPrice), nn(r.targetPrice),
          nn(r.fees), nn(r.funding), nn(r.gas), flow ? null : nn(r.netPL), flow ? null : nn(r.netR), nn(r.balance), flow ? '' : (r.closed ? 'closed' : 'open'),
          r.grade || '', Array.isArray(r.mistakes) ? r.mistakes.map(mistakeLabel).join('; ') : '', Array.isArray(r.tags) ? r.tags.join('; ') : '',
          r.thesis || '', r.notes || '', flow ? nn(r.flowAmount) : null, r.flowNote || '', r.id || '', r.parentId || '']);
      }
    }
    if (rows.length === 1) { toast('Nothing to export yet', 'warn'); return; }
    download(`cryptojournal-${scope === 'all' ? 'all-accounts' : db.mode}-${todayISO()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
    toast(`Exported ${plural(rows.length - 1, 'row')}`, 'ok');
  }
  function backupCardHtml() {
    const b = S().backup, age = ageOf(), tone = ageTone(age);
    return `<div class="st-bk st-bk-${tone}">
        <span class="st-bk-ic" aria-hidden="true">${ic(tone === 'ok' ? 'check' : 'alert')}</span>
        <div class="st-bk-b"><div class="st-bk-t">Last backup: <b>${ageText(age)}</b> <span class="badge ${tone} sm">${TONE_LBL[tone]}</span></div>
          <div class="st-bk-s">File export: ${whenText(b.lastExportAt)} · Backup folder: ${whenText(b.lastFolderAt)}</div></div>
      </div>
      <div class="row st-acts">${btn('export', 'Export JSON backup', { cls: 'btn-primary', icon: 'download' })}${btn('import', 'Import JSON backup…', { icon: 'upload' })}<input type="file" id="st-imp-file" accept="application/json,.json" hidden></div>
      <p class="st-p dim">One file holds everything: all three accounts, settings, playbook, routine and journal (screenshots are not included). Keep copies off this computer: OneDrive, a USB stick, or email it to yourself. Importing replaces all current data, after a safety snapshot.</p>`;
  }
  function csvHtml() {
    return `<p class="st-p">Every trade, scale leg, deposit and withdrawal as a spreadsheet for Excel or Google Sheets, with net P/L, net R and the running balance. Text that Excel could run as a formula is made safe.</p>
      <div class="field st-f"><span class="st-lbl" id="st-csv-l">Accounts</span><div id="st-seg-csv" aria-labelledby="st-csv-l"></div></div>
      <div class="row st-acts">${btn('csv', 'Download CSV', { icon: 'download' })}</div>`;
  }
  function pricesHtml() {
    const key = String(S().cgDemoKey || ''), n = Object.keys(isO(db.coinIds) ? db.coinIds : {}).length;
    const attr = typeof Market !== 'undefined' && Market.attribution ? Market.attribution : 'Prices: CoinGecko · DexScreener';
    return `<div class="field st-f"><label for="st-cg-key">CoinGecko Demo key <span class="opt">optional · free</span></label>
        <div class="input-group"><input class="input mono" id="st-cg-key" type="password" autocomplete="off" spellcheck="false" maxlength="80" value="${esc(key)}" placeholder="CG-…" aria-describedby="st-cg-h"><button type="button" class="addon st-eye" id="st-b-cgshow" aria-label="Show key" aria-pressed="false">${ic('eye')}</button></div>
        <div class="hint" id="st-cg-h">Not needed: prices work without it. Without a key CoinGecko allows roughly 10–30 requests a minute, shared with everyone on your connection; a free Demo key from coingecko.com raises that to 100. The key stays on this device, but it is included in JSON backups.</div></div>
      <div class="row st-acts">${key ? btn('cgclear', 'Remove key', { icon: 'x' }) : ''}${btn('coinreset', 'Reset coin price cache', { icon: 'refresh' })}</div>
      <p class="hint st-note">${n ? `${plural(n, 'coin lookup')} cached. ` : ''}Reset if a coin shows the wrong price, for example a copycat token with the same symbol. ${esc(attr)} · Data provided by CoinGecko.</p>`;
  }
  function whereHtml() {
    const cc = corruptCopies();
    const rows = cc.map((c, i) => {
      const cur = c.k === StorageGuard.corruptKey;
      return `<div class="stat-row"><span class="sl">${ic('alert')}${c.at ? esc(fmtDateTime(c.at)) : esc(c.k)}${cur ? ' <span class="badge warn sm">current</span>' : ''}</span><span class="sv">${fmtBytes(c.size)}</span>
        <button type="button" class="btn btn-ghost btn-xs" data-cc-dl="${i}">${ic('download')}Download</button>${cur && StorageGuard.loadError ? '' : `<button type="button" class="btn btn-quiet btn-xs st-icon" data-cc-del="${i}" aria-label="Delete this unreadable copy">${ic('trash')}</button>`}</div>`;
    }).join('');
    return `<div class="st-kvs">
        <div class="st-kv"><span>Address</span><b class="mono">${esc(location.origin)}</b></div>
        <div class="st-kv"><span>Browser</span><b>${esc(browserName())}</b></div>
        <div class="st-kv"><span>Storage key</span><b class="mono">${esc(DB_KEY)}</b></div>
      </div>
      <p class="st-p">Your journal is stored inside <b>this browser profile, at this address</b>, and nowhere else. Opening the app on another port, in another browser or profile, or after "Clear browsing data" shows an empty journal. Nothing is lost if you have a backup: import the file, or reconnect the backup folder.</p>
      ${cc.length ? `<div class="chip-group-l">Unreadable copies kept safe</div><div class="stat-rows">${rows}</div><p class="hint st-note">Copies of a journal that could not be read. They use browser storage: download them, then delete them.</p>` : ''}`;
  }
  function dataHtml() {
    const sup = hasStore() && Store.folder && Store.folder.supported;
    return `${StorageGuard.loadError ? `<div class="banner err">${ic('alert')}<div class="grow"><b>Your saved journal could not be read.</b> Use the red banner at the top of the page to download the unreadable copy or start fresh, or restore one of the snapshots below.</div></div>` : ''}
    <div class="st-grid">
      ${card('Backups', 'download', backupCardHtml(), { cls: 'st-wide' })}
      ${card('Backup folder', 'folder', `<div id="st-folder">${lastFill.folder || '<p class="dim">Checking the backup folder…</p>'}</div>`, { aside: sup ? '<span class="badge cat sm">Automatic</span>' : '' })}
      ${card('Storage', 'grid', `<div id="st-usage">${lastFill.usage || '<p class="dim">Measuring storage…</p>'}</div>`)}
      ${card('Snapshots', 'layers', `<div id="st-snaps">${lastFill.snaps || '<p class="dim">Loading snapshots…</p>'}</div>`, { cls: 'st-wide', aside: btn('snap-now', 'Take a snapshot now', { icon: 'plus' }) })}
      ${card('Export trades (CSV)', 'file-in', csvHtml())}
      ${card('Live prices', 'zap', pricesHtml())}
      ${card('Where your data lives', 'lock', whereHtml(), { cls: 'st-wide' })}
    </div>`;
  }
  function folderHtml(st, files) {
    const b = S().backup;
    if (!st.supported) return `<p class="st-p">This browser cannot write to a folder by itself. Use <b>Export JSON backup</b> and save the file into OneDrive, or open the app in Microsoft Edge or Google Chrome to get automatic folder backups.</p>`;
    if (!st.connected) {
      return `<p class="st-p">Pick a folder once and the journal writes <span class="mono">cryptojournal-YYYY-MM-DD.json</span> into it automatically, at most once a day, after you save something.</p>
        <div class="reading st-tip">${ic('info')}<span><b>Tip:</b> choose a folder <b>inside OneDrive</b> (for example <span class="mono">OneDrive\\Documents\\CryptoJournal backups</span>). OneDrive then copies every backup off this computer for free.</span></div>
        <div class="row st-acts">${btn('fold-connect', 'Choose backup folder…', { cls: 'btn-primary', icon: 'folder' })}</div>`;
    }
    const perm = st.permission;
    const badge = perm === 'granted' ? '<span class="badge ok sm">Access allowed</span>' : perm === 'prompt' ? '<span class="badge warn sm">Needs your OK</span>' : '<span class="badge stop sm">Blocked</span>';
    const list = files.length ? `<div class="chip-group-l">Newest backups in this folder</div><div class="stat-rows">${files.map((f, i) => `<div class="stat-row"><span class="sl mono st-fname">${esc(f.name)}</span><span class="sv">${esc(fmtDateTime(f.at))}<small>${fmtBytes(f.size)}</small></span><button type="button" class="btn btn-ghost btn-xs" data-fold-restore="${i}" aria-label="Restore ${esc(f.name)}">${ic('undo')}Restore</button></div>`).join('')}</div>` : '';
    return `<div class="st-fold"><div class="st-fold-n">${ic('folder')}<b>${esc(st.name || b.folderName || 'Backup folder')}</b>${badge}</div>
        <div class="st-fold-s">Last written: ${whenText(b.lastFolderAt, 'not yet')}</div></div>
      ${perm !== 'granted' ? '<p class="hint warn st-note">Browsers ask again after a restart. Click <b>Re-allow</b> to resume automatic backups.</p>' : ''}
      <div class="st-sws">${toggle('autofold', 'Write a backup automatically', !!b.autoFolder, 'Once a day, the first time you save something.')}</div>
      <div class="row st-acts">${perm === 'granted' ? btn('fold-write', 'Write backup now', { cls: 'btn-primary', icon: 'download' }) : btn('fold-allow', 'Re-allow', { cls: 'btn-primary', icon: 'lock' })}${btn('fold-connect', 'Change folder…', { icon: 'folder' })}${btn('fold-off', 'Disconnect', { cls: 'btn-quiet' })}</div>
      ${list}`;
  }
  async function fillFolder(t) {
    const get = () => (tok === t && root && root.isConnected ? $('#st-folder', root) : null);
    if (!hasStore() || !Store.folder) { const e = get(); if (e) e.innerHTML = '<p class="dim">The backup service did not load.</p>'; return; }
    const F = Store.folder;
    let st, files = [];
    try { st = await F.status(); } catch (e) { st = { supported: F.supported, connected: false }; }
    if (st.connected && st.permission === 'granted') { try { files = await F.list(5); } catch (e) { files = []; } }
    const el = get(); if (!el) return;
    swapHtml(el, lastFill.folder = folderHtml(st, files));
    onBtn(el, {
      'fold-connect': async () => { await F.connect(); laterData(); },
      // Permission prompts need this click (user activation), so reallow() runs straight from the handler
      'fold-allow': async () => {
        const ok = await F.reallow();
        if (ok) { const r = await F.write({}); toast(r.ok ? `Access allowed: wrote ${r.name}` : 'Access allowed, but writing failed: ' + r.reason, r.ok ? 'ok' : 'warn'); }
        else toast('The browser did not allow access to the folder', 'warn');
        laterData();
      },
      'fold-write': async () => { const r = await F.write({ ask: true }); toast(r.ok ? `Backup written: ${r.name}` : 'Backup failed: ' + r.reason, r.ok ? 'ok' : 'err', { ms: 4500 }); laterData(); },
      'fold-off': async () => {
        const ok = await confirmDialog({ title: 'Disconnect the backup folder?', message: 'Automatic folder backups stop. Files already in the folder are not deleted.', confirmText: 'Disconnect' });
        if (!ok) return;
        await F.disconnect(); toast('Backup folder disconnected', 'ok'); laterData();
      },
    });
    bindToggles(el, { autofold: (on) => { S().backup.autoFolder = on; if (save()) flash(on ? 'Automatic backups on' : 'Automatic backups off'); if (on && F.auto) F.auto(); } });
    el.querySelectorAll('[data-fold-restore]').forEach(b => b.addEventListener('click', async () => { const f = files[+b.dataset.foldRestore]; if (f && await F.restore(f.name)) afterRecovered(); }));
  }
  async function fillSnaps(t) {
    const get = () => (tok === t && root && root.isConnected ? $('#st-snaps', root) : null);
    if (!hasStore()) { const e = get(); if (e) e.innerHTML = '<p class="dim">The snapshot service did not load.</p>'; return; }
    await Store.ready;   // never rejects
    let list = [];
    if (Store.available) { try { list = await Store.listSnapshots(); } catch (e) { list = []; } }
    const el = get(); if (!el) return;
    if (!Store.available) { swapHtml(el, lastFill.snaps = `<div class="banner err">${ic('alert')}<div class="grow">${esc(Store.error || 'Snapshots are unavailable in this browser.')} Use <b>Export JSON backup</b> instead.</div></div>`); return; }
    if (!list.length) { swapHtml(el, lastFill.snaps = '<p class="dim">No snapshots yet. One is taken automatically each day you use the app, and before every import, restore, wipe or permanent delete.</p>'); return; }
    swapHtml(el, lastFill.snaps = `<div class="table-wrap bare"><table class="compact-t st-t st-snaps"><thead><tr><th scope="col">When</th><th scope="col">Why</th><th scope="col">Trades</th><th scope="col" class="num">Size</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map((s, i) => `<tr>
        <td class="st-nw">${esc(fmtDateTime(s.at))}</td><td class="st-why">${esc(s.reason || '')}</td><td class="st-nw">${countsHtml(s.counts)}</td><td class="num">${fmtBytes(s.size)}</td>
        <td class="st-nw st-ra"><button type="button" class="btn btn-ghost btn-xs" data-snap-restore="${i}" data-fid="st-snapres-${i}" aria-label="Restore the snapshot from ${esc(fmtDateTime(s.at))}">${ic('undo')}Restore</button><button type="button" class="btn btn-quiet btn-xs st-icon" data-snap-dl="${i}" aria-label="Download the snapshot from ${esc(fmtDateTime(s.at))}">${ic('download')}</button><button type="button" class="btn btn-quiet btn-xs st-icon" data-snap-del="${i}" data-fid="st-snapdel-${i}" aria-label="Delete the snapshot from ${esc(fmtDateTime(s.at))}">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div>
      <p class="hint st-note">The newest ${Store.KEEP || 20} are kept. Snapshots live in this browser: they undo mistakes, but they do not protect against losing this computer. That is what the backup file or folder is for.</p>`);
    el.querySelectorAll('[data-snap-restore]').forEach(b => b.addEventListener('click', async () => { const s = list[+b.dataset.snapRestore]; if (s && await Store.restoreSnapshot(s.id)) afterRecovered(); }));
    el.querySelectorAll('[data-snap-dl]').forEach(b => b.addEventListener('click', () => { const s = list[+b.dataset.snapDl]; if (s) Store.downloadSnapshot(s.id); }));
    el.querySelectorAll('[data-snap-del]').forEach(b => b.addEventListener('click', async () => {
      const s = list[+b.dataset.snapDel]; if (!s) return;
      const ok = await confirmDialog({ title: 'Delete this snapshot?', html: `<p>${esc(fmtDateTime(s.at))} · ${esc(s.reason || '')}</p>`, confirmText: 'Delete snapshot', danger: true });
      if (!ok) return;
      try { await Store.deleteSnapshot(s.id); toast('Snapshot deleted', 'ok'); } catch (e) { toast('Could not delete it: ' + (e && e.message), 'err'); }
    }));
  }
  async function fillUsage(t) {
    const get = () => (tok === t && root && root.isConnected ? $('#st-usage', root) : null);
    if (!hasStore()) { const e = get(); if (e) e.innerHTML = '<p class="dim">The storage service did not load.</p>'; return; }
    let u = null;
    try { u = await Store.usage(); } catch (e) { u = null; }
    const el = get(); if (!el) return;
    if (!u) { swapHtml(el, lastFill.usage = '<p class="dim">Storage could not be measured.</p>'); return; }
    // ~5 MB of localStorage per origin in Chromium; the journal JSON is the part that can fill up
    const share = u.localStorageBytes / 5e6, tone = share > 0.8 ? 'stop' : share > 0.6 ? 'warn' : 'ok', pct = Math.round(share * 100);
    swapHtml(el, lastFill.usage = `<div class="meter st-meter"><div class="ml"><span>Journal: trades, settings, notes</span><b>${fmtBytes(u.localStorageBytes)}</b></div>
        <div class="progress-track" role="img" aria-label="${pct}% of the roughly 5 MB browser limit"><div class="progress-fill ${tone}" style="width:${Math.min(100, Math.max(1, share * 100)).toFixed(1)}%"></div></div>
        <div class="hint ${tone === 'ok' ? '' : 'warn'}">${pct}% of the ~5 MB this browser allows for the journal itself.${tone === 'ok' ? '' : ' Getting full: export a backup and empty the trash.'}</div></div>
      <div class="stat-rows st-mt">
        <div class="stat-row"><span class="sl">${ic('image')}Screenshots</span><span class="sv">${u.mediaCount} · ${fmtBytes(u.mediaBytes)}</span></div>
        <div class="stat-row"><span class="sl">${ic('layers')}Snapshots</span><span class="sv">${u.snapshotCount} · ${fmtBytes(u.snapshotBytes)}</span></div>
        <div class="stat-row"><span class="sl">${ic('folder')}All storage for this app</span><span class="sv">${isNum(u.usage) ? fmtBytes(u.usage) : '—'}<small>${isNum(u.quota) ? 'of ' + fmtBytes(u.quota) + ' available' : ''}</small></span></div>
        <div class="stat-row"><span class="sl">${ic('lock')}Persistent storage</span><span class="sv">${u.persisted === true ? '<span class="badge ok sm">On</span>' : u.persisted === false ? '<span class="badge warn sm">Off</span>' : '<span class="badge cat sm">Not supported</span>'}</span></div>
      </div>
      ${u.available ? '' : `<p class="hint warn st-note">${esc(u.error || 'The local database is unavailable')}: screenshots and snapshots cannot be stored.</p>`}
      <div class="row st-acts">${u.persisted === false ? btn('persist', 'Ask the browser to keep my data', { icon: 'lock' }) : ''}${u.mediaCount ? btn('media-clean', 'Remove unused screenshots', { icon: 'trash' }) : ''}</div>
      <p class="hint st-note">${u.persisted === true ? "The browser will not clear this app's data to free up disk space." : 'Without persistent storage the browser may clear app data when the disk is nearly full. The browser decides by itself; backups matter either way.'}</p>`);
    onBtn(el, {
      persist: async () => {
        const ok = await Store.persist();
        toast(ok ? 'Persistent storage is on: the browser will keep your data' : 'The browser declined for now. It usually agrees once the app is installed or used often. Keep backups either way.', ok ? 'ok' : 'warn', { ms: 6000 });
        laterData();
      },
      'media-clean': async () => {
        const list = await Store.unusedMedia();
        if (!list.length) { toast('Every screenshot is still attached to an entry', 'ok'); return; }
        const bytes = list.reduce((s, m) => s + (m.size || 0), 0);
        const ok = await confirmDialog({
          title: 'Remove unused screenshots?', danger: true, confirmText: `Remove ${list.length}`,
          html: `<p><b>${plural(list.length, 'screenshot')}</b> (${fmtBytes(bytes)}) are no longer attached to any entry, trash included.</p><p class="st-cm-note">Older snapshots may still point to them: restoring such a snapshot brings the trades back without these images.</p>`,
        });
        if (!ok) return;
        let n = 0;
        for (const m of list) { try { await Store.deleteMedia(m.id); n++; } catch (e) { /* skip that one */ } }
        toast(`Removed ${plural(n, 'screenshot')}`, 'ok'); laterData();
      },
    });
  }
  function bindData(panel) {
    const t = tok;
    onBtn(panel, {
      export: () => { if (hasStore() && Store.exportJSON()) afterRecovered(); },
      import: () => { const f = $('#st-imp-file', panel); if (f) f.click(); },
      'snap-now': async () => {
        if (!hasStore()) return;
        try { await Store.snapshot('Manual snapshot'); toast('Snapshot saved', 'ok'); } catch (e) { toast('Could not save a snapshot: ' + (e && e.message), 'err'); }
      },
      csv: () => exportCSV(csvScope),
      cgshow: () => {
        const k = $('#st-cg-key', panel), b = $('#st-b-cgshow', panel); if (!k || !b) return;
        const show = k.type === 'password';
        k.type = show ? 'text' : 'password';
        b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Hide key' : 'Show key'); b.innerHTML = ic(show ? 'eye-off' : 'eye');
      },
      cgclear: () => { S().cgDemoKey = ''; const ok = save(); if (typeof CG !== 'undefined' && CG.resetBackoff) CG.resetBackoff(); Bus.emit('settings'); rerender('#st-cg-key'); if (ok) flash('Key removed'); },
      coinreset: () => { db.coinIds = {}; if (typeof CG !== 'undefined' && CG.resetBackoff) CG.resetBackoff(); apply({ msg: 'Coin price cache reset: coins are looked up again' }); },
    });
    const fi = $('#st-imp-file', panel);
    if (fi) fi.addEventListener('change', async () => { const f = fi.files && fi.files[0]; fi.value = ''; if (f && hasStore() && await Store.importJSON(f)) afterRecovered(); });
    segHere(panel, 'csv', [{ id: 'mode', label: `${MODE_LABEL[db.mode]} only` }, { id: 'all', label: 'All accounts' }], csvScope, (v) => { csvScope = v === 'all' ? 'all' : 'mode'; });
    const k = $('#st-cg-key', panel);
    if (k) k.addEventListener('change', () => {
      const v = k.value.trim();
      if (v && !/^[A-Za-z0-9_-]{8,80}$/.test(v)) {
        k.classList.add('invalid'); k.setAttribute('aria-invalid', 'true');
        const h = $('#st-cg-h', panel); if (h) { h.className = 'hint err'; h.textContent = 'That does not look like a CoinGecko key (letters, digits and dashes, like CG-abc123…). Not saved.'; }
        return;
      }
      if (v === String(S().cgDemoKey || '')) return;
      S().cgDemoKey = v;
      const ok = save();
      if (typeof CG !== 'undefined' && CG.resetBackoff) CG.resetBackoff();
      Bus.emit('settings');
      rerender(); if (ok) flash(v ? 'Key saved' : 'Key removed');
    });
    const cc = corruptCopies();
    panel.querySelectorAll('[data-cc-dl]').forEach(b => b.addEventListener('click', () => {
      const c = cc[+b.dataset.ccDl]; if (!c) return;
      let raw = null; try { raw = localStorage.getItem(c.k); } catch (e) { raw = null; }
      if (raw == null) { toast('That copy is gone', 'err'); return; }
      download(`cryptojournal-unreadable-${c.at ? new Date(c.at).toISOString().slice(0, 10) : todayISO()}.json`, raw, 'application/json');
    }));
    panel.querySelectorAll('[data-cc-del]').forEach(b => b.addEventListener('click', async () => {
      const c = cc[+b.dataset.ccDel]; if (!c) return;
      const ok = await confirmDialog({ title: 'Delete this unreadable copy?', message: 'Download it first if you might want to repair it by hand. This cannot be undone.', confirmText: 'Delete copy', danger: true });
      if (!ok) return;
      try { localStorage.removeItem(c.k); } catch (e) { /* blocked */ }
      rerender(); toast('Copy deleted', 'ok');
    }));
    // Async fills never reject into the void: a failure leaves the block's last content and logs why
    const bad = (what) => (e) => console.error('[settings:data:' + what + ']', e);
    fillFolder(t).catch(bad('folder')); fillSnaps(t).catch(bad('snapshots')); fillUsage(t).catch(bad('usage'));
  }

  /* ═══ Sync & devices ════════════════════════════════════ */
  // Drawn by sync-ui.js (SyncUI); Sync.renderSettings hands off to it and has a small stand-in of its own
  const syncHtml = () => '<div class="st-sync" id="st-sync"></div>';
  function bindSync(panel) {
    const host = $('#st-sync', panel);
    if (!host) return;
    // a module whose script threw while loading stays in the TDZ, where typeof throws too
    const mod = (get) => { try { return get(); } catch (e) { return null; } };
    const eng = mod(() => (typeof Sync !== 'undefined' ? Sync : null)), ui = mod(() => (typeof SyncUI !== 'undefined' ? SyncUI : null));
    if (eng && typeof eng.renderSettings === 'function') eng.renderSettings(host);
    else if (ui && typeof ui.renderSettings === 'function') ui.renderSettings(host);
    else host.innerHTML = card('Cloud sync', 'refresh', '<p class="st-p">Cloud sync couldn’t load in this copy of the app. Reload the page — the journal on this device isn’t affected.</p>');
  }

  /* ═══ Trash ═════════════════════════════════════════════ */
  const FLOW = { deposit: 'Deposit', withdrawal: 'Withdrawal', adjustment: 'Balance adjustment' };
  // Trashed entries of every account; scale legs deleted together with their trashed trade (same deletedAt)
  // travel with it. A leg deleted at another time is its own item, so restoring the trade brings back only its own legs.
  function trashItems() {
    const out = [];
    for (const m of MODES) {
      const del = db.accounts[m].entries.filter(e => e.deletedAt);
      const byId = new Map(del.map(e => [e.id, e])), kids = new Map();
      const withParent = (e) => { const p = e.parentId ? byId.get(e.parentId) : null; return !!p && e.deletedAt === p.deletedAt; };
      for (const e of del) if (withParent(e)) { if (!kids.has(e.parentId)) kids.set(e.parentId, []); kids.get(e.parentId).push(e); }
      for (const e of del) if (!withParent(e)) out.push({ m, e, kids: kids.get(e.id) || [] });
    }
    return out.sort((a, b) => String(b.e.deletedAt).localeCompare(String(a.e.deletedAt)));
  }
  // Engine skips trashed rows, so net P/L is worked out here the same way (gross − fees − funding − gas)
  function rowPL(e) {
    if (FLOW[e.type]) return isNum(e.flowAmount) ? (e.type === 'withdrawal' ? -e.flowAmount : e.flowAmount) : null;
    if (!isNum(e.entryPrice) || !isNum(e.exitPrice) || !isNum(e.amount)) return null;
    return (e.exitPrice - e.entryPrice) * e.amount * (e.side === 'short' ? -1 : 1) - nz(e.fees) - nz(e.funding) - nz(e.gas);
  }
  const itemPL = (x) => { const all = [x.e, ...x.kids].map(rowPL); return all.every(isNum) ? all.reduce((s, v) => s + v, 0) : null; };
  const idsOf = (x) => [x.e.id, ...x.kids.map(k => k.id)];
  // A scale leg listed on its own (its trade is live, or was trashed at another time) reads "leg of <coin> trade"
  const describe = (x) => (FLOW[x.e.type] ? FLOW[x.e.type] : x.e.type === 'scale' ? `Leg of ${String(x.e.coin || '?').toUpperCase()} trade` : `${String(x.e.coin || '?').toUpperCase()} ${x.e.side === 'short' ? 'short' : 'long'}`);
  function trashWhat(x) {
    const e = x.e;
    if (FLOW[e.type]) return `<span class="badge ${e.type === 'deposit' ? 'dep' : e.type === 'withdrawal' ? 'wd' : 'adj'} sm">${FLOW[e.type]}</span>${e.flowNote ? ` <span class="dim">${esc(String(e.flowNote).slice(0, 40))}</span>` : ''}`;
    const side = e.side === 'short' ? '<span class="badge short sm">↘ SHORT</span>' : '<span class="badge long sm">↗ LONG</span>';
    return `<span class="st-coin">${coinIcon(e.coin)}<b>${esc(String(e.coin || '?').toUpperCase())}</b></span> ${side}${e.type === 'scale' ? ` <span class="badge scale sm">leg of ${esc(String(e.coin || '?').toUpperCase())} trade</span>` : ''}${x.kids.length ? ` <span class="dim">+ ${plural(x.kids.length, 'scale leg')}</span>` : ''}`;
  }
  function trashHtml() {
    const items = trashItems();
    if (!items.length) return card('Trash', 'trash', emptyHtml('Trash is empty', `Deleted trades, deposits and adjustments wait here for ${TRASH_DAYS} days, so a slip of the finger is never permanent.`));
    const now = Date.now(), n = items.reduce((s, x) => s + 1 + x.kids.length, 0);
    const rows = items.map((x, i) => {
      const e = x.e, flow = !!FLOW[e.type], v = flow ? rowPL(e) : itemPL(x);
      const delAt = Date.parse(e.deletedAt), t = Date.parse(e.entryAt);
      const left = isFinite(delAt) ? Math.max(0, Math.ceil(TRASH_DAYS - (now - delAt) / DAY)) : TRASH_DAYS;
      const res = v == null ? '<span class="badge open sm">open</span>'
        : flow ? `<span class="mono">${money(v, { sign: true })}</span>`
        : `<span class="mono ${plClass(v)}">${glyph(v)} ${money(v, { sign: true })}</span>`;
      return `<tr>
        <td><span class="badge sm st-mb-${x.m}">${MODE_LABEL[x.m]}</span></td>
        <td class="st-nw">${isFinite(t) ? esc(fmtDate(t)) : '—'}</td>
        <td class="st-nw">${trashWhat(x)}</td>
        <td class="num">${res}</td>
        <td class="st-nw">${isFinite(delAt) ? esc(fmtDateTime(delAt)) : '—'}</td>
        <td class="num"><span class="${left <= 3 ? 'warn-c' : ''}">${left} day${left === 1 ? '' : 's'}</span></td>
        <td class="st-nw st-ra"><button type="button" class="btn btn-ghost btn-xs" data-tr-restore="${i}" data-fid="st-trres-${i}" aria-label="Restore ${esc(describe(x))}">${ic('undo')}Restore</button><button type="button" class="btn btn-quiet btn-xs" data-tr-kill="${i}" data-fid="st-trkill-${i}" aria-label="Delete ${esc(describe(x))} forever">${ic('trash')}<span class="st-hide-s">Delete forever</span></button></td>
      </tr>`;
    }).join('');
    return card(`Trash <span class="badge cat sm">${n}</span>`, 'trash', `<p class="st-p">Restore puts an entry back exactly where it was; balances, stats and charts update. Entries are removed for good ${TRASH_DAYS} days after you delete them (a snapshot is taken first).</p>
      <div class="table-wrap bare"><table class="compact-t st-t st-trash"><thead><tr><th scope="col">Account</th><th scope="col">Date</th><th scope="col">Entry</th><th scope="col" class="num">Result</th><th scope="col">Deleted</th><th scope="col" class="num">Days left</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row st-acts">${btn('tr-all', 'Restore all', { icon: 'undo' })}${btn('tr-empty', 'Empty trash…', { cls: 'btn-danger', icon: 'trash' })}</div>`, { cls: 'st-wide' });
  }
  async function purge(list) {
    if (!list.length) return;
    const n = list.reduce((s, x) => s + 1 + x.kids.length, 0), what = list.length === 1 && !list[0].kids.length ? describe(list[0]) : plural(n, 'entry', 'entries');
    const ok = await confirmDialog({
      title: list.length === 1 ? 'Delete forever?' : `Empty the trash (${plural(n, 'entry', 'entries')})?`, danger: true, confirmText: 'Delete forever',
      html: `<p><b>${esc(what)}</b> will be removed for good.</p><p class="st-cm-note">A snapshot is saved first, so you can still undo this from Data &amp; backups → Snapshots.</p>`,
    });
    if (!ok) return;
    if (!(await snapFirst(`Before deleting ${plural(n, 'trashed entry', 'trashed entries')} forever`))) return;
    const kill = new Map();   // mode → ids
    for (const x of list) { if (!kill.has(x.m)) kill.set(x.m, new Set()); for (const id of idsOf(x)) kill.get(x.m).add(id); }
    const gone = new Set();
    for (const [m, ids] of kill) { const a = db.accounts[m]; a.entries = a.entries.filter(e => { const out = !!e.deletedAt && ids.has(e.id); if (out) gone.add(e.id); return !out; }); }
    // Guardrail overrides of the removed trades go with them (ramp overrides have tradeId null and stay), as core's 30-day purge does
    if (gone.size && Array.isArray(db.overrides)) db.overrides = db.overrides.filter(o => !o || !o.tradeId || !gone.has(o.tradeId));
    keepFocus(() => commit(`Deleted ${plural(n, 'entry', 'entries')} forever`, 'ok'));
  }
  function bindTrash(panel) {
    const items = trashItems();
    panel.querySelectorAll('[data-tr-restore]').forEach(b => b.addEventListener('click', () => { const x = items[+b.dataset.trRestore]; if (x) keepFocus(() => restoreEntries(idsOf(x))); }));
    panel.querySelectorAll('[data-tr-kill]').forEach(b => b.addEventListener('click', () => { const x = items[+b.dataset.trKill]; if (x) purge([x]); }));
    onBtn(panel, {
      'tr-all': () => { const ids = items.flatMap(idsOf); if (ids.length) keepFocus(() => restoreEntries(ids)); },
      'tr-empty': () => purge(items),
    });
  }

  /* ═══ Demo data ═════════════════════════════════════════ */
  const backTo = () => (db.prevMode && db.prevMode !== 'demo' ? db.prevMode : 'paper');
  function demoHtml() {
    const n = liveEntries('demo').filter(e => e.type === 'trade').length, inDemo = db.mode === 'demo', has = typeof Demo !== 'undefined';
    return `<div class="st-grid">${card('The demo account', 'sparkle', `
      <p class="st-p">Demo is a <b>separate third account</b> filled with realistic sample trades (wins, losses, mistakes, reviews), so you can see what every chart and report looks like before you have enough data of your own.</p>
      <ul class="st-ul"><li>It never mixes with your paper or live trades.</li><li>Anything you change in demo stays in demo.</li><li>You can remove it any time; a snapshot is saved first.</li></ul>
      <div class="st-stats"><div><span>Demo trades</span><b class="mono">${n}</b></div><div><span>You are in</span><b>${MODE_LABEL[db.mode]}</b></div></div>
      ${has ? '' : '<p class="hint warn st-note">The demo module did not load, so demo data is unavailable right now.</p>'}
      <div class="row st-acts">${inDemo ? btn('demo-leave', `Back to ${MODE_LABEL[backTo()]}`, { cls: 'btn-primary', icon: 'undo' }) : btn('demo-load', n ? 'Open the demo account' : 'Load demo data', { cls: 'btn-primary', icon: 'sparkle', disabled: !has })}${btn('demo-clear', 'Remove demo data…', { cls: 'btn-danger', icon: 'trash', disabled: !has || !n })}</div>`, { cls: 'st-wide' })}</div>`;
  }
  function bindDemo(panel) {
    onBtn(panel, {
      'demo-load': () => {
        if (typeof Demo !== 'undefined' && Demo.ensure) {
          try { Demo.ensure(); } catch (e) { console.error('[settings:demo]', e); toast('The demo data could not be created: ' + (e && e.message), 'err'); return; }
        }
        if (typeof App !== 'undefined' && App.switchMode) App.switchMode('demo');
        else toast('Use the "Demo" link in the sidebar', 'warn');
      },
      'demo-leave': () => { if (typeof App !== 'undefined' && App.leaveDemo) App.leaveDemo(); else if (typeof App !== 'undefined' && App.switchMode) App.switchMode(backTo()); },
      'demo-clear': async () => {
        if (typeof Demo === 'undefined' || !Demo.clear) return;
        const ok = await confirmDialog({ title: 'Remove demo data?', message: 'The demo account is emptied. Your paper and live journals are not touched. A snapshot is saved first.', confirmText: 'Remove demo data', danger: true });
        if (!ok) return;
        if (!(await snapFirst('Before removing demo data'))) return;
        // Demo.clear() commits; the emptied account disables this button, so focus falls back to the heading
        keepFocus(() => {
          Demo.clear();
          if (db.mode === 'demo' && typeof App !== 'undefined' && App.leaveDemo) App.leaveDemo();
        });
      },
    });
  }

  /* ═══ Danger zone ═══════════════════════════════════════ */
  function dangerHtml() {
    const m = db.mode, a = acct(), L = MODE_LABEL[m];
    const trades = a.entries.filter(e => e.type === 'trade' && !e.deletedAt).length;
    const days = Object.keys(db.days[m] || {}).length, revs = Object.keys(db.reviews[m] || {}).length, missed = (db.missed[m] || []).length;
    const empty = !a.entries.length && !days && !revs && !missed;
    return `<div class="st-grid">
      ${card(`Wipe ${L} data`, 'alert', `<p class="st-p">Removes everything recorded in the <b>${L}</b> account: <b>${plural(trades, 'trade')}</b> (${plural(a.entries.length, 'entry', 'entries')} in total, trash included), ${plural(days, 'journal day')}, ${plural(revs, 'review')} and ${plural(missed, 'missed trade')}. The start date resets to today.</p>
        <p class="st-p">Kept: your settings, risk rules, playbook, routine, tags and mistakes, the other accounts, and the starting balance (${money(a.startingBalance)}).${m === 'live' ? ' The live ramp starts again at stage 1, because the live record it was judged on is gone.' : m === 'paper' ? ' The readiness history is cleared too: it was built from these paper trades.' : ''}</p>
        <p class="st-p dim">A snapshot is saved first, so this can be undone from Data &amp; backups → Snapshots. You will be asked to type <b>${esc(m)}</b> to confirm.</p>
        <div class="row st-acts">${btn('wipe', `Wipe ${L} data…`, { cls: 'btn-danger', icon: 'trash', disabled: empty })}</div>`, { cls: 'st-danger' })}
      ${card('Reset all settings', 'refresh', `<p class="st-p">Puts every setting back to the beginner defaults: risk rules, costs and fee presets, appearance and units.</p>
        <p class="st-p">Kept: all trades and journals, playbook, tags and mistakes, planned live capital, the live ramp stage, the backup folder and your CoinGecko key. A snapshot is saved first.</p>
        <div class="row st-acts">${btn('setreset', 'Reset all settings…', { cls: 'btn-warn', icon: 'refresh' })}</div>`, { cls: 'st-danger' })}
    </div>`;
  }
  function bindDanger(panel) {
    onBtn(panel, {
      wipe: async () => {
        const m = db.mode, L = MODE_LABEL[m];
        const ok = await confirmDialog({
          title: `Wipe all ${L} data?`, danger: true, requireText: m, confirmText: `Wipe ${L}`,
          html: `<p>Every ${L} trade, deposit, journal day, review and missed trade is removed.</p><p class="st-cm-note">A snapshot is saved first. Other accounts and your settings are not touched.</p>`,
        });
        if (!ok) return;
        const how = await snapFirst(`Before wiping ${L} data`);
        if (!how) return;
        const a = db.accounts[m];
        a.entries = []; a.startDate = todayISO();
        db.days[m] = {}; db.reviews[m] = {}; db.missed[m] = [];
        db.overrides = (Array.isArray(db.overrides) ? db.overrides : []).filter(x => !x || x.mode !== m);
        if (m === 'paper') db.readinessHistory = [];   // readiness is judged on paper trades
        if (m === 'live') { S().ramp.stage = 1; S().ramp.stageStartAt = null; }   // the ramp restarts with the live record
        keepFocus(() => commit(`${L} data wiped. ${savedFirst(how)}`, 'ok'));
      },
      setreset: async () => {
        const ok = await confirmDialog({ title: 'Reset all settings?', message: 'Risk rules, costs, fee presets, appearance and units go back to the beginner defaults. Your trades and journals are kept.', confirmText: 'Reset settings', danger: true });
        if (!ok) return;
        if (!(await snapFirst('Before resetting settings'))) return;
        const s = S();
        const keep = { backup: clone(s.backup), cgDemoKey: s.cgDemoKey, ramp: clone(s.ramp), ledgerCols: s.ledgerCols, onboardingDismissed: s.onboardingDismissed, plannedLiveCapital: s.plannedLiveCapital };
        // Keys other modules added to settings (not in the defaults) are their state, not preferences: keep them
        const extra = {};
        for (const k of Object.keys(s)) if (!(k in DEFAULT_SETTINGS)) extra[k] = s[k];
        db.settings = Object.assign(clone(DEFAULT_SETTINGS), extra, keep);
        applyTheme(); Bus.emit('view'); Bus.emit('settings');
        keepFocus(() => commit('Settings reset to beginner defaults', 'ok'));
      },
    });
  }

  /* ═══ About ═════════════════════════════════════════════ */
  function aboutHtml() {
    const attr = typeof Market !== 'undefined' && Market.attribution ? Market.attribution : 'Prices: CoinGecko · DexScreener';
    return `<div class="st-grid">
      ${card('CryptoJournal v2', 'info', `<div class="st-ver"><b>CryptoJournal v2</b><span class="badge cat sm">Data format v${DB_VERSION}</span><span class="badge cat sm">Works offline</span></div>
        <p class="st-p">A trading journal for building evidence on paper before risking real money: net-R analytics, honest sample sizes, risk guardrails and a staged path to live trading. Everything stays on this device unless you turn on cloud sync (Sync &amp; devices).</p>
        <div class="row st-acts">${btn('keys', 'Keyboard shortcuts', { icon: 'cmd' })}${btn('learn', 'Metric guide', { icon: 'book' })}</div>`)}
      ${card('Not financial advice', 'alert', `<p class="st-p">CryptoJournal records and measures <b>your own</b> trading. Nothing in it (readings, the readiness checklist, the live ramp, insights or calculators) is financial, investment or tax advice, and none of it is a recommendation to buy or sell anything.</p>
        <p class="st-p">Crypto is highly volatile. Only trade money you can afford to lose. Statistics from a few dozen trades are noisy, which is why every number shows its sample size.</p>`, { cls: 'tint-warn' })}
      ${card('Where the ideas come from', 'book', `<ul class="st-credits">
          <li><b>R-multiples and expectancy:</b> Van K. Tharp's position-sizing framework and the System Quality Number (SQN).</li>
          <li><b>Honest statistics:</b> Wilson score intervals for win rate, bootstrap confidence intervals on mean R, Monte Carlo resampling, and Welch's t-test for paper vs live.</li>
          <li><b>Risk guardrails:</b> prop-firm style daily and weekly loss limits, loss-streak cooldowns and correlated-exposure ("portfolio heat") caps.</li>
          <li><b>Process over outcome:</b> mistake tags, A/B/C process grades and the deserved-win / dumb-luck matrix from trading-psychology practice.</li>
          <li><b>Design and accessibility:</b> WCAG 2.2 AA contrast, the Okabe–Ito colour-blind-safe palette, and no celebrations for winning trades (following the plan is what gets celebrated).</li>
          <li><b>Market data:</b> ${esc(attr)} (free tiers). Fee presets from the Binance, Bybit, OKX, Kraken and Coinbase base tiers, checked Oct 2026; verify yours.</li>
          <li><b>Data safety:</b> rolling snapshots, a File System Access backup folder, and a quarantine for unreadable storage.</li>
        </ul>`, { cls: 'st-wide' })}
    </div>`;
  }
  function bindAbout(panel) {
    onBtn(panel, {
      keys: () => { if (typeof Palette !== 'undefined' && Palette.shortcuts) Palette.shortcuts(); else toast('Shortcuts are unavailable right now', 'warn'); },
      learn: () => { if (typeof Learn !== 'undefined' && Learn.show) Learn.show('metrics'); else go('patterns'); },
    });
  }

  const VIEWS = {
    account: { html: accountHtml, bind: bindAccount },
    risk: { html: riskHtml, bind: bindRisk },
    costs: { html: costsHtml, bind: bindCosts },
    journal: { html: journalHtml, bind: bindJournal },
    appearance: { html: appearanceHtml, bind: bindAppearance },
    data: { html: dataHtml, bind: bindData },
    sync: { html: syncHtml, bind: bindSync },
    trash: { html: trashHtml, bind: bindTrash },
    demo: { html: demoHtml, bind: bindDemo },
    danger: { html: dangerHtml, bind: bindDanger },
    about: { html: aboutHtml, bind: bindAbout },
  };

  /* ═══ Storage-recovery banner (shown by app.js) ═════════ */
  function rawCorrupt() {
    try { return (StorageGuard.corruptKey && localStorage.getItem(StorageGuard.corruptKey)) || localStorage.getItem(DB_KEY); } catch (e) { return null; }
  }
  // app.js rebuilds the banners on every refresh: announce the problem once, then keep it a labelled region
  let recAnnounced = false;
  function recoveryBanner() {
    if (!StorageGuard.loadError) return '';
    const role = recAnnounced ? 'role="region" aria-label="Storage problem"' : 'role="alert"';
    recAnnounced = true;
    return `<div class="banner err st-rec" ${role}>${ic('alert')}<div class="grow"><b>Your saved journal could not be read.</b> Nothing has been overwritten: the unreadable copy is kept safe, and saving is paused until you choose what to do.<div class="st-rec-err">Reason: ${esc(StorageGuard.loadError)}</div></div>
      <div class="acts">
        <button type="button" class="btn btn-ghost btn-xs" data-st-rec="download">${ic('download')}Download the unreadable copy</button>
        <button type="button" class="btn btn-ghost btn-xs" data-st-rec="snapshot">${ic('undo')}Restore from a snapshot</button>
        <button type="button" class="btn btn-ghost btn-xs" data-st-rec="file">${ic('upload')}Restore a backup file</button>
        <button type="button" class="btn btn-quiet btn-xs" data-st-rec="fresh">Start fresh</button>
        <input type="file" accept="application/json,.json" data-st-rec-file hidden>
      </div></div>`;
  }
  async function openSnapPicker() {
    if (!hasStore()) { toast('Snapshots are unavailable', 'err'); return; }
    await Store.ready;
    const list = Store.available ? await Store.listSnapshots() : [];
    const body = !Store.available ? `<p class="confirm-msg">${esc(Store.error || 'Snapshots are unavailable in this browser.')}</p>`
      : list.length ? `<div class="st-pick">${list.map((s, i) => `<button type="button" class="st-pick-o" data-i="${i}"><span class="st-pick-t"><b>${esc(fmtDateTime(s.at))}</b><small>${esc(s.reason || '')}</small></span><span class="st-pick-c">${countsHtml(s.counts)}</span></button>`).join('')}</div>`
      : '<p class="confirm-msg">No snapshots are stored in this browser. Restore a backup file instead, or start fresh.</p>';
    Modal.open({
      title: 'Restore from a snapshot', width: 560, body,
      foot: '<button class="btn btn-ghost" type="button" data-x>Close</button>',
      onMount: (el, close) => {
        el.querySelector('[data-x]').onclick = () => close();
        el.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => { const s = list[+b.dataset.i]; close(); if (s && await Store.restoreSnapshot(s.id)) afterRecovered(); });
      },
    });
  }
  async function startFresh() {
    const ok = await confirmDialog({
      title: 'Start with an empty journal?', danger: true, confirmText: 'Start fresh',
      html: '<p>A new, empty journal starts and saving resumes.</p><p class="st-cm-note">The unreadable copy is not deleted: it is saved as a snapshot and stays in this browser (Settings → Data &amp; backups → Where your data lives). Download it first if you want to try to repair it.</p>',
    });
    if (!ok) return;
    const raw = rawCorrupt();
    let kept = false;
    try { kept = !!(StorageGuard.corruptKey && localStorage.getItem(StorageGuard.corruptKey)); } catch (e) { kept = false; }
    if (raw && hasStore()) { try { await Store.snapshot('Unreadable journal, kept when starting fresh', raw); kept = true; } catch (e) { /* best effort */ } }
    // The next save overwrites the main key: never let the only copy go without a download
    if (raw && !kept) { download(`cryptojournal-unreadable-${todayISO()}.json`, raw, 'application/json'); toast('The unreadable copy was downloaded, because the browser had no room to keep it', 'warn', { ms: 7000 }); }
    resolveLoadError();
    refresh();
    afterRecovered();
    toast('Started a fresh journal', 'ok');
  }
  function bindRecovery(el) {
    if (!el) return;
    const fi = el.querySelector('[data-st-rec-file]');
    el.querySelectorAll('[data-st-rec]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.stRec;
      if (a === 'download') {
        const raw = rawCorrupt();
        if (!raw) { toast('The unreadable copy could not be found in this browser', 'err'); return; }
        download(`cryptojournal-unreadable-${todayISO()}.json`, raw, 'application/json');
        toast('Saved the unreadable copy. Keep it: it may be repairable by hand.', 'ok', { ms: 4500 });
      } else if (a === 'snapshot') openSnapPicker();
      else if (a === 'file') { if (fi) fi.click(); }
      else if (a === 'fresh') startFresh();
    }));
    if (fi) fi.addEventListener('change', async () => { const f = fi.files && fi.files[0]; fi.value = ''; if (f && hasStore() && await Store.importJSON(f)) afterRecovered(); });
  }

  /* ── Public: navigate to a section ─────────────────────── */
  function show(sec) {
    const id = ALIAS[sec] || sec;
    if (id && SECTIONS.some(s => s.id === id)) { section = id; lsSet(LS_KEY, id); }
    if (typeof Router === 'undefined') return;
    // Already on Settings: just swap the section, without a page cross-fade
    Router.go('settings', { instant: Router.active === 'settings' });
    // Move focus to the section heading so screen readers announce where they landed
    setTimeout(() => { const h = document.getElementById('st-h'); if (h && Router.active === 'settings') h.focus({ preventScroll: true }); }, 80);
  }

  if (typeof Pages !== 'undefined') Pages.register('settings', {
    title: 'Settings',
    sub: () => `Rules, costs, backups and appearance · last backup ${ageText(ageOf())}`,
    render,
  });
  // Snapshot / backup-folder changes come from store.js (sometimes in the background): refresh the Data view
  if (typeof Bus !== 'undefined') { Bus.on('snapshots', laterData); Bus.on('backup', backupChanged); }

  return { show, recoveryBanner, bindRecovery, get section() { return section; }, sections: SECTIONS.map(s => s.id) };
})();
