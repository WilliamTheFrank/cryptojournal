/* ═══════════════════════════════════════════════════════════
   CryptoJournal — cloud sync UI · global SyncUI
   What the person sees of sync.js (Sync): the topbar status chip,
   the sign-in / status dialog, Settings → Sync & devices and the
   "Set a new password" dialog after a reset link. sync.js hands
   off to SyncUI.open / renderSettings / recovery and keeps a small
   built-in UI for when this file is missing.
   Only the engine's public API and its Bus events ('sync' status,
   'sync-note' messages) are used. Tokens never pass through here,
   and a password only lives in its field until it is handed to
   Sync.signIn / signUp / updatePassword.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const SyncUI = (() => {
  /* ── Engine & config (sync.js may be missing or have failed) ── */
  // A const whose script threw while loading stays in the TDZ, where even typeof throws
  const E = () => { try { return typeof Sync !== 'undefined' && Sync ? Sync : null; } catch (e) { return null; } };
  const CFG = (() => { try { return typeof CJ_CONFIG !== 'undefined' && CJ_CONFIG ? CJ_CONFIG : {}; } catch (e) { return {}; } })();
  const enabled = () => { try { const s = E(); return !!(s && s.enabled); } catch (e) { return false; } };
  const status = () => { try { const s = E(); return s ? s.status : null; } catch (e) { return null; } };
  const appUrl = () => String(CFG.appUrl || '').trim();

  /* ── Small helpers ──────────────────────────────────────── */
  const H = (v) => esc(v);
  const ic = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const nf = (n) => Number(n || 0).toLocaleString('en-US');
  const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : (many || one + 's')}`;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const UA = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const IPHONE = /iPhone|iPod/.test(UA);
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  const touch = () => mq('(hover: none) and (pointer: coarse)');
  const standalone = () => { try { return navigator.standalone === true || mq('(display-mode: standalone)'); } catch (e) { return false; } };
  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
  const trades = () => { try { return realTradeCount(); } catch (e) { return 0; } };
  let nseq = 0;
  const nid = (p) => `sy-${p}-${++nseq}`;   // ids stay unique with the dialog and Settings both on screen
  function ago(t) {
    if (!t || !isFinite(t)) return 'not yet';
    const d = Date.now() - t;
    if (d < 45000) return 'just now';
    if (d < 3600000) return `${Math.round(d / 60000)} min ago`;
    return new Date(t).toDateString() === new Date().toDateString() ? 'today at ' + fmtTime(t) : fmtDateTime(t);
  }
  function goSettings() {
    try { if (typeof Settings !== 'undefined' && Settings && Settings.show) { Settings.show('sync'); return true; } } catch (e) { /* not loaded */ }
    return false;
  }

  /* ── Phones: our dialogs stay above the on-screen keyboard ── */
  // iOS Safari (and Chrome on Android) shrink only the visual viewport for the keyboard, so a bottom-sheet dialog
  // sits partly behind it with its buttons out of reach. While one of ours is open its backdrop follows the
  // visible part of the page instead.
  const fitted = new Set();
  let kbOn = false;
  const vvp = () => { try { const v = typeof window !== 'undefined' ? window.visualViewport : null; return v && typeof v.addEventListener === 'function' ? v : null; } catch (e) { return null; } };
  function fitKb() {
    const vv = vvp();
    for (const bd of [...fitted]) {
      if (!bd.isConnected) { fitted.delete(bd); continue; }
      // a keyboard: the visible part is much shorter than the layout viewport, at normal zoom
      const kb = !!vv && Math.abs((vv.scale || 1) - 1) < 0.01 && innerHeight - vv.height > 80;
      Object.assign(bd.style, kb ? { top: Math.round(vv.offsetTop) + 'px', bottom: 'auto', height: Math.round(vv.height) + 'px' } : { top: '', bottom: '', height: '' });
      bd.classList.toggle('sy-kb', kb);
      const m = bd.querySelector('.modal');
      if (m) m.style.maxHeight = kb ? Math.max(0, Math.round(vv.height) - 8) + 'px' : '';
    }
    if (!fitted.size && kbOn && vv) { vv.removeEventListener('resize', fitKb); vv.removeEventListener('scroll', fitKb); kbOn = false; }
  }
  function fitKeyboard(bd) {
    const vv = vvp();
    if (!bd || !vv) return;
    fitted.add(bd);
    if (!kbOn) { vv.addEventListener('resize', fitKb); vv.addEventListener('scroll', fitKb); kbOn = true; }
    fitKb();
  }

  /* ── Icons (the sprite in index.html has no cloud) ──────── */
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  const CLOUD = '<path d="M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.6 10.1 4.5 4.5 0 0 0 7 19z"/>';
  const I = {
    cloud: svg(CLOUD),
    synced: svg(CLOUD + '<path d="m9.4 14.4 2 2 3.8-4"/>'),
    cloudOff: svg(CLOUD + '<path d="m3 3 18 18"/>'),
    phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    pc: svg('<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8 20.5h8M12 16.5v4"/>'),
    devices: svg('<rect x="2" y="4" width="13" height="10" rx="1.8"/><path d="M6.5 18h4M8.5 14v4"/><rect x="17" y="8" width="5.5" height="11" rx="1.5"/>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7.5 8 5.5 8-5.5"/>'),
    up: svg('<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>'),
    down: svg('<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>'),
    share: svg('<path d="M12 14.5V3.5M8.5 7 12 3.5 15.5 7"/><path d="M8.5 10.5H7A1.5 1.5 0 0 0 5.5 12v7.5A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-1.5"/>'),
    // Drawn inline, not <use href>: core's focus trap counts every [href] — sprite icons after a dialog's last
    // control would be its "last" stop, and Tab would leave the dialog from the real last button
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>'),
    flag: svg('<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.4 4 2.4 4H5.5"/>'),
  };
  const stateIcon = (st) => (st === 'synced' ? I.synced : st === 'offline' ? I.cloudOff : st === 'syncing' ? ic('refresh') : st === 'auth' ? ic('lock') : st === 'error' ? ic('alert') : I.cloud);

  /* ── Words for each state ───────────────────────────────── */
  const LABEL = { off: 'Sync off', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', auth: 'Sign in again', error: 'Sync problem' };
  const TITLE = { off: 'Sync is off', syncing: 'Syncing…', synced: 'Up to date', offline: 'Offline', auth: 'Sign-in expired', error: 'Sync problem' };
  const chipText = (s, st) => (st === 'offline' && s.pending ? `Offline · ${nf(s.pending)} waiting` : LABEL[st] || 'Sync');
  // One plain sentence per state: tooltips, toasts and the status panels
  function sentence(s, st) {
    if (!s) return 'Cloud sync isn’t available right now.';
    const p = s.pending || 0;
    switch (st || s.state) {
      case 'off': return p ? `Sync is off — ${plural(p, 'change')} made here will upload when you sign in again.` : 'Sync is off on this device.';
      case 'syncing': return p ? `${plural(p, 'change')} left to upload.` : 'Sending and fetching the latest changes.';
      case 'synced': return s.lastSyncAt ? `Last synced ${ago(s.lastSyncAt)}.` : 'Everything here is in the cloud.';
      case 'offline': return p ? `${plural(p, 'change')} will sync when you’re back online.` : 'Changes are saved on this device and sync when you’re back online.';
      case 'auth': return 'Your sign-in has expired. Sign in again to keep syncing — nothing on this device is lost.';
      case 'error': return s.error || 'Sync hit a problem and tries again shortly.';
      default: return '';
    }
  }
  // One line for the command palette
  function summary() {
    if (!E()) return 'Cloud sync couldn’t load';
    if (!enabled()) return 'Cloud sync isn’t set up in this copy of the app';
    const s = status();
    if (!s) return '';
    switch (s.state) {
      case 'off': return 'Sign in to use one journal on your iPhone and PC';
      case 'synced': return 'Up to date · last synced ' + ago(s.lastSyncAt);
      case 'syncing': return 'Syncing now…';
      case 'offline': return s.pending ? `Offline · ${plural(s.pending, 'change')} waiting` : 'Offline';
      case 'auth': return 'Sign-in expired — sign in again to keep syncing';
      default: return 'Sync problem — ' + String(s.error || 'it tries again shortly').slice(0, 90);
    }
  }

  /* ── State shared by every view ─────────────────────────── */
  // flow: the first sync after a sign-in, shown as progress and then a summary
  // { t0, email, first, phase 'progress'|'done', snap, down, left, moved, msg, problem, warn, doneAt }
  let flow = null;
  // hosts: the dialog and the Settings section, each showing one view ('auth', 'progress', 'done', 'status', …)
  let dlg = null, setHost = null, setFocus = null, rec = null, delBusy = false;
  let chipEl = null, liveEl = null, shown = null, said = null, slowT = null;

  /* ── Topbar chip ────────────────────────────────────────── */
  function mountChip() {
    if (chipEl && chipEl.isConnected) return true;
    const ck = document.getElementById('btn-cmdk'), bar = ck ? ck.parentNode : document.querySelector('.topbar');
    if (!bar) return false;
    for (const id of ['cjs-chip', 'cjs-live']) { const x = document.getElementById(id); if (x) x.remove(); }   // the engine's stand-in
    chipEl = document.createElement('button');
    chipEl.type = 'button'; chipEl.id = 'sy-chip'; chipEl.className = 'tb-btn sy-chip';
    chipEl.setAttribute('aria-haspopup', 'dialog');
    chipEl.addEventListener('click', () => open());
    liveEl = document.createElement('span');
    liveEl.id = 'sy-live'; liveEl.className = 'sr-only';
    liveEl.setAttribute('role', 'status'); liveEl.setAttribute('aria-live', 'polite'); liveEl.setAttribute('aria-atomic', 'true');
    bar.insertBefore(chipEl, ck || null);
    bar.insertBefore(liveEl, ck || null);
    shown = null;
    return true;
  }
  function chip() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    if (!enabled()) { if (chipEl) chipEl.hidden = true; return; }
    if (!mountChip()) return;
    chipEl.hidden = false;
    const s = status();
    if (!s) return;
    const first = !!(flow && flow.phase === 'progress');
    // Right after a sign-in the engine reports "synced" until its first cycle starts — that is still setting up
    let st = first && (s.state === 'synced' || s.state === 'syncing') ? 'syncing' : s.state;
    if (st === 'auth' && offline()) st = 'offline';   // nothing to sign in to until the connection is back
    // A save is pushed within a few hundred ms: "Syncing…" only shows when it lasts, so the chip doesn't flicker
    if (st === 'syncing' && !first && shown && shown !== 'syncing') {
      if (!slowT) slowT = setTimeout(() => { slowT = null; const n = status(); if (n && n.state === 'syncing') paint(n, 'syncing'); }, 400);
      return;
    }
    clearTimeout(slowT); slowT = null;
    paint(s, st);
  }
  function paint(s, st) {
    const label = chipText(s, st), n = s.pending && (st === 'offline' || st === 'auth' || st === 'error') ? s.pending : 0;
    const more = st === 'offline' && s.pending ? ` · ${nf(s.pending)} waiting` : '';   // narrow screens drop it for the badge
    chipEl.dataset.state = st;
    chipEl.dataset.net = offline() ? 'off' : 'on';
    chipEl.innerHTML = `<span class="sy-ic">${stateIcon(st)}</span><span class="sy-lbl">${H(more ? 'Offline' : label)}${more ? `<span class="sy-more">${H(more)}</span>` : ''}</span>${n ? `<span class="sy-n" aria-hidden="true">${n > 99 ? '99+' : n}</span>` : ''}`;
    chipEl.setAttribute('aria-label', 'Cloud sync: ' + label);
    chipEl.title = st === 'synced' ? (s.lastSyncAt ? 'Last synced ' + fmtTime(s.lastSyncAt) : 'Up to date') + (s.realtime ? ' · live' : '')
      : st === 'off' ? (s.pending ? sentence(s, 'off') : 'Cloud sync is off — click to use one journal on your iPhone and PC') : st === 'syncing' ? 'Syncing your journal…' : sentence(s, st);
    shown = st;
    // Screen readers hear real changes (offline, signed out, a problem…) — never the "Syncing…" of every save,
    // and nothing while the page loads
    if (said === null) { if (st !== 'syncing') said = st; return; }
    if (st === 'syncing' || st === said) return;
    said = st;
    const t = `Cloud sync: ${label}.`;
    liveEl.textContent = '';
    setTimeout(() => { if (liveEl) liveEl.textContent = t; }, 80);
  }

  /* ── The first sync after signing in ────────────────────── */
  function beginFlow() {
    if (flow && flow.phase === 'progress') return;
    const s = status() || {};
    flow = { t0: Date.now(), email: (s.user && s.user.email) || '', first: !s.firstSyncDone, phase: 'progress', snap: false, down: 0, left: 0, moved: false, msg: null, problem: null, warn: null, doneAt: 0 };
  }
  function track(s) {
    if (!flow || flow.phase !== 'progress') return;
    if (!s || !s.user || s.state === 'off') { flow = null; return; }
    // the sign-in expired before the first sync got through: only the sign-in form helps now. A cloud copy deleted
    // from another device pauses sync without an error (nothing would ever finish): the status view explains it.
    if (s.state === 'auth' || s.cloudGone) { flow = null; return; }
    // a cycle finished after the sign-in (an 'error' here is a finished sync with something held back)
    if (s.lastSyncAt && s.lastSyncAt >= flow.t0 && (s.state === 'synced' || s.state === 'error')) {
      flow.phase = 'done'; flow.doneAt = Date.now(); flow.warn = s.state === 'error' ? s.error || null : null;
      // nobody is looking (dialog closed, Settings not on screen): the engine's own toast reports the result
      if (!hosts(true).length) flow = null;
      return;
    }
    if (s.state === 'syncing') { flow.problem = null; flow.left = s.pending || 0; if (flow.left) flow.moved = true; }
    else if (s.state === 'offline') flow.problem = 'The connection dropped — sync carries on by itself when you’re back online.';
    else if (s.state === 'auth' || s.state === 'error') flow.problem = sentence(s);
  }

  /* ── Hosts and their views ──────────────────────────────── */
  // seen: only hosts on screen (the Settings node stays connected inside a hidden page)
  const hosts = (seen) => [dlg, setHost].filter(h => h && h.root && h.root.isConnected && (!seen || h.root.getClientRects().length > 0));
  function want() {
    if (!E()) return 'missing';
    if (!enabled()) return 'unset';
    const s = status();
    // an old summary nobody closed · a first sync that can't go on (track() normally catches it)
    if (flow && (flow.phase === 'done' ? Date.now() - flow.doneAt > 600000 : !s || !s.user || s.state === 'auth' || s.state === 'off' || s.cloudGone)) flow = null;
    if (flow) return flow.phase;
    return s && s.user && s.state !== 'auth' && s.state !== 'off' ? 'status' : 'auth';
  }
  function titleFor(kind) {
    const s = status() || {};
    if (kind === 'auth') return s.state === 'auth' ? 'Sign in again' : 'Sync your iPhone and PC';
    if (kind === 'progress') return flow && !flow.first ? 'Signing you back in' : 'Setting up sync';
    if (kind === 'done') return flow && !flow.first ? 'You’re signed in' : 'Sync is on';
    return 'Cloud sync';
  }
  const card = (title, icon, body, o) => `<section class="card st-card sy-card${o && o.cls ? ' ' + o.cls : ''}"><h3 class="card-title">${icon[0] === '<' ? icon : ic(icon)}${H(title)}${o && o.aside ? `<span class="aside">${o.aside}</span>` : ''}</h3>${body}</section>`;
  // In Settings every view but the signed-in one sits in one wide card; the dialog has its own title bar
  function frame(h, kind, inner) {
    if (h.where !== 'settings' || kind === 'status') return inner;
    const t = kind === 'auth' ? 'One journal on your iPhone and PC' : kind === 'progress' || kind === 'done' ? titleFor(kind) : 'Cloud sync';
    return `<div class="st-grid"><section class="card st-card st-wide sy-card sy-box"><h3 class="card-title">${kind === 'done' ? I.synced : I.cloud}${H(t)}</h3>${inner}</section></div>`;
  }
  // data-af marks where focus goes. Not [autofocus]: Modal focuses the first input in DOM order whatever it says,
  // and Chrome complains about autofocus added after load.
  function focusIn(h) {
    const t = h.root.querySelector('[data-af]') || h.root.querySelector('input:not([type=hidden]):not([hidden]), button');
    if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  function draw(h) {
    const kind = want(), V = VIEWS[kind];
    const had = h.drawn && h.root.contains(document.activeElement);
    if (kind === 'auth' && h.kind !== 'auth') h.mode = null;   // back at the form (signed out…): pick the mode afresh
    h.kind = kind;
    if (h.where === 'modal') { h.head.textContent = titleFor(kind); if (h.panel) h.panel.style.maxWidth = (kind === 'auth' ? 760 : 540) + 'px'; }
    h.root.innerHTML = frame(h, kind, V.html(h));
    if (V.bind) V.bind(h);
    h.drawn = true;
    if (had) focusIn(h);   // the dialog's first draw is focused by open()
  }
  function update(h) {
    if (!h.root.isConnected) return;
    if (want() !== h.kind) { draw(h); return; }
    const V = VIEWS[h.kind];
    if (V.update) V.update(h);
  }
  // (the flow is settled first, so the chip never shows "Syncing…" for a first sync that has already stopped)
  function refreshAll() { track(status()); chip(); for (const h of hosts()) update(h); }
  // Swap a block's HTML only when it changed (keeps focus on buttons inside it)
  const put = (el, html) => { if (el && el._syH !== html) { el._syH = html; el.innerHTML = html; return true; } return false; };

  /* ── View: sign in / create account ─────────────────────── */
  const PW_HINT = 'At least 6 characters. You’ll type it on your other device too.';
  function ctxHtml(n) {
    const out = [];
    if (IPHONE && !standalone()) out.push(`<p class="sy-ctx">${I.phone}<span><b>Tip:</b> add CryptoJournal to your Home Screen first (Share → <b>Add to Home Screen</b>), open it from there and sign in inside it. The Home Screen app keeps its own data, separate from Safari.</span></p>`);
    out.push(n > 0
      ? `<p class="sy-ctx">${I.devices}<span>This device has <b>${plural(n, 'trade')}</b>. If it’s the first device you sign in on, they are uploaded; if your other device already syncs, the two journals are combined.</span></p>`
      : `<p class="sy-ctx">${I.devices}<span>This device has no trades yet. If your journal is on another device, sign in with the same account and it downloads here.</span></p>`);
    return out.join('');
  }
  const howHtml = () => `<h4 class="sy-sh">How it works</h4>
    <ul class="sy-pts">
      <li>${I.lock}<span><b>Private to you.</b> Only your account can read what you sync.</span></li>
      <li>${I.devices}<span><b>iPhone and PC.</b> The same trades, journal, playbook and settings on both.</span></li>
      <li>${I.cloudOff}<span><b>Offline-first.</b> Each device keeps its whole journal and works without internet; changes wait and sync when you’re back online.</span></li>
      <li>${I.flag}<span><b>Start on the PC that has your journal, then sign in on the iPhone.</b></span></li>
    </ul>
    <h4 class="sy-sh">What the first sync does</h4>
    <p class="sy-p sy-sm">First it saves a safety snapshot of this device’s journal, so you can always go back (Settings → Data &amp; backups → Snapshots). Then:</p>
    <ul class="sy-cases">
      <li><b>Nothing in the cloud yet</b> — this device’s journal is uploaded.</li>
      <li><b>This device is empty</b> (a new iPhone) — your journal is downloaded.</li>
      <li><b>Both have a journal</b> — they’re combined and items from both are kept. Where both have the same item, a trade keeps its newer edit; anything else (settings, playbook, a journal day) takes the cloud’s version.</li>
    </ul>
    <p class="sy-p sy-sm dim sy-mt">Demo data, table density and the backup folder stay separate on each device.</p>`;
  function authHtml(h) {
    const S = E(), s = status() || {}, expired = s.state === 'auth';
    let known = '';
    try { known = (s.user && s.user.email) || (S && S.email) || ''; } catch (e) { known = ''; }
    const n = trades();
    if (!h.mode) h.mode = known ? 'in' : n > 0 ? 'up' : 'in';   // the PC with a journal usually creates the account
    const up = h.mode === 'up', af = touch() ? 'lead' : known ? 'pw' : 'em';   // no keyboard popping up on phones
    const id = { em: nid('em'), emh: nid('emh'), pw: nid('pw'), pwh: nid('pwh') };
    return `<div class="sy-auth">
      <div class="sy-intro">
        <p class="sy-lead" tabindex="-1"${af === 'lead' ? ' data-af' : ''}>${expired ? '<b>Your sign-in has expired.</b> Sign in again to keep syncing — nothing on this device is lost.' : 'Use one journal on your iPhone and your PC: sign in on both with the same email. Each keeps its whole journal and works offline; changes sync in the background, within seconds when both are online.'}</p>
        ${expired ? '' : ctxHtml(n)}
      </div>
      <div class="sy-formwrap">
        <form class="sy-form" novalidate>
          <div class="seg sy-seg" role="group" aria-label="Sign in or create an account">
            <button type="button" data-m="in" class="${up ? '' : 'on'}" aria-pressed="${!up}">Sign in</button>
            <button type="button" data-m="up" class="${up ? 'on' : ''}" aria-pressed="${up}">Create account</button>
          </div>
          <div class="field">
            <label for="${id.em}">Email</label>
            <input class="input" id="${id.em}" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="254" value="${H(known)}" aria-describedby="${id.emh}"${af === 'em' ? ' data-af' : ''}>
            <div class="hint err" id="${id.emh}" data-e="em"></div>
          </div>
          <div class="field">
            <label for="${id.pw}">Password</label>
            <div class="input-group">
              <input class="input" id="${id.pw}" name="password" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="72" aria-describedby="${id.pwh}"${af === 'pw' ? ' data-af' : ''}>
              <button type="button" class="addon sy-eye" aria-label="Show password" aria-pressed="false" aria-controls="${id.pw}">${ic('eye')}</button>
            </div>
            <div class="hint" id="${id.pwh}" data-e="pw">${up ? PW_HINT : ''}</div>
          </div>
          <p class="sy-msg err" role="alert"></p>
          <p class="sy-msg ok" role="status"></p>
          <div class="sy-acts">
            <button type="submit" class="btn btn-primary sy-go">${up ? 'Create account' : 'Sign in'}</button>
            <button type="button" class="link-btn sy-forgot"${up ? ' hidden' : ''}>Forgot password?</button>
          </div>
        </form>
        <div class="sy-sent" hidden>
          <span class="sy-bigic">${I.mail}</span>
          <h4 class="sy-h2" tabindex="-1">Check your email</h4>
          <p class="sy-p" data-sent></p>
          <p class="sy-p sy-sm dim">Nothing after a few minutes? Look in your spam folder. Already have an account? Just sign in.</p>
          <div class="sy-acts"><button type="button" class="btn btn-primary" data-sy="back">I’ve confirmed — sign in</button></div>
        </div>
      </div>
      <div class="sy-how">${howHtml()}</div>
    </div>`;
  }
  function authBind(h) {
    const r = h.root, f = r.querySelector('.sy-form'), sent = r.querySelector('.sy-sent');
    const em = f.querySelector('[name=email]'), pw = f.querySelector('[name=password]'), eye = f.querySelector('.sy-eye');
    const go = f.querySelector('.sy-go'), forgot = f.querySelector('.sy-forgot');
    const err = f.querySelector('.sy-msg.err'), ok = f.querySelector('.sy-msg.ok');
    const emH = f.querySelector('[data-e=em]'), pwH = f.querySelector('[data-e=pw]');
    let busy = false, cool = 0, coolT = null;
    const creating = () => h.mode === 'up';
    const say = (t, good) => { err.textContent = good ? '' : t || ''; ok.textContent = good ? t || '' : ''; };
    const pwHint = () => { pwH.classList.remove('err'); pwH.textContent = creating() ? PW_HINT : ''; };
    function bad(inp, hint, t) { inp.setAttribute('aria-invalid', 'true'); hint.textContent = t; hint.classList.add('err'); inp.focus(); }
    function clear() { em.removeAttribute('aria-invalid'); pw.removeAttribute('aria-invalid'); emH.textContent = ''; pwHint(); say(''); }
    // Busy and cool-down use aria-disabled (not disabled): the pressed button keeps keyboard focus
    function lock(on, label) {
      busy = on;
      f.setAttribute('aria-busy', String(on));
      em.readOnly = on; pw.readOnly = on;
      for (const b of f.querySelectorAll('button')) b.setAttribute('aria-disabled', String(on || (cool > 0 && (b === go || b === forgot))));
      go.innerHTML = on && label ? `<span class="sy-spin" aria-hidden="true"></span>${H(label)}` : H(cool > 0 ? `Try again in ${cool} s` : creating() ? 'Create account' : 'Sign in');
    }
    function setMode(m, keep) {
      h.mode = m;
      for (const b of f.querySelectorAll('[data-m]')) { const on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
      pw.setAttribute('autocomplete', m === 'up' ? 'new-password' : 'current-password');
      forgot.hidden = m === 'up';
      if (keep) pwHint(); else clear();
      lock(false);
    }
    function cooldown(sec) {
      cool = sec; clearInterval(coolT); lock(false);
      coolT = setInterval(() => { cool = Math.max(0, cool - 1); if (!cool) clearInterval(coolT); if (!busy) lock(false); }, 1000);
    }
    const showPw = (on) => { pw.type = on ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(on)); eye.setAttribute('aria-label', on ? 'Hide password' : 'Show password'); eye.innerHTML = ic(on ? 'eye-off' : 'eye'); };
    for (const b of f.querySelectorAll('[data-m]')) b.addEventListener('click', () => { if (!busy && h.mode !== b.dataset.m) setMode(b.dataset.m); });
    eye.addEventListener('click', () => { if (!busy) showPw(pw.type === 'password'); });
    em.addEventListener('input', () => { if (em.hasAttribute('aria-invalid')) { em.removeAttribute('aria-invalid'); emH.textContent = ''; } });
    pw.addEventListener('input', () => { if (pw.hasAttribute('aria-invalid')) { pw.removeAttribute('aria-invalid'); pwHint(); } });

    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const S = E();
      if (busy || cool > 0 || !S) return;
      clear();
      const email = em.value.trim(), pass = pw.value, up = creating();
      if (!email) return bad(em, emH, 'Enter your email address.');
      if (!EMAIL_RE.test(email)) return bad(em, emH, 'That email address doesn’t look right — check for typos.');
      if (!pass) return bad(pw, pwH, 'Enter your password.');
      if (up && pass.length < 6) return bad(pw, pwH, 'Use at least 6 characters.');
      if (offline()) { say('You’re offline. Connect to the internet to sign in — the journal keeps working offline meanwhile.'); return; }
      if (pw.type !== 'password') showPw(false);   // password managers offer to save what was typed in a password field
      lock(true, up ? 'Creating account…' : 'Signing in…');
      let res = null;
      try { res = await (up ? S.signUp(email, pass) : S.signIn(email, pass)); } catch (e) { res = null; }
      lock(false);
      // the password has done its job (it stays only after a failure, to fix a typo)
      if (res && (res.ok || res.cancelled)) pw.value = '';
      if (res && res.ok && res.confirm) { showSent(res.email || email); return; }
      if (res && res.ok) { beginFlow(); refreshAll(); return; }   // the engine's 'signin' note usually began it already
      const m = (res && res.error) || 'Something went wrong — try again.';
      if (res && res.cancelled) { say(m, true); return; }
      say(m);
      if (/already exists/i.test(m)) setMode('in', true);
      else if (/wrong email or password/i.test(m)) { pw.focus(); try { pw.select(); } catch (e) { /* ok */ } }
      if (/too many/i.test(m)) cooldown(30);
    });
    forgot.addEventListener('click', async () => {
      const S = E();
      if (busy || cool > 0 || !S) return;
      clear();
      const email = em.value.trim();
      if (!EMAIL_RE.test(email)) return bad(em, emH, 'Type your email address here first, then press “Forgot password?” again.');
      if (offline()) { say('You’re offline. Connect to the internet to get a reset email.'); return; }
      lock(true); forgot.textContent = 'Sending…';
      let res = null;
      try { res = await S.resetPassword(email); } catch (e) { res = null; }
      forgot.textContent = 'Forgot password?'; lock(false);
      // reset links open wherever the app is published, so the advice holds on every device
      if (res && res.ok) { say(`If an account exists for ${email}, a reset link is on its way. Open it, choose a new password, then sign in with it on each device. Nothing after a few minutes? Look in your spam folder.`, true); return; }
      const m = (res && res.error) || 'Something went wrong — try again.';
      say(/too many/i.test(m) ? m + ' Reset emails are limited to a few per hour.' : m);
      if (/too many/i.test(m)) cooldown(60);
    });
    function showSent(email) {
      sent.querySelector('[data-sent]').innerHTML = `We sent a confirmation link to <b class="sy-em">${H(email)}</b>. Open it to activate your account, then come back here and sign in with the same email and password.`;
      setMode('in', true); say('');
      f.hidden = true; sent.hidden = false;
      sent.querySelector('.sy-h2').focus({ preventScroll: true });
    }
    sent.querySelector('[data-sy=back]').addEventListener('click', () => { sent.hidden = true; f.hidden = false; (em.value.trim() ? pw : em).focus(); });
  }

  /* ── View: the first sync is running ────────────────────── */
  function progHtml(h) {
    const again = flow && !flow.first;
    return `<div class="sy-prog">
      <p class="sy-lead" tabindex="-1" data-af>${again ? 'Signed in — catching up with your cloud copy.' : 'Signed in. The first sync can take a minute.'} ${h.where === 'modal' ? 'You can close this' : 'You can leave this page'}: sync carries on in the background, and the cloud button at the top shows when it’s done.</p>
      <ol class="sy-log" data-dyn="log"></ol>
      <div class="sy-acts" data-dyn="pacts"></div>
    </div>`;
  }
  function progBind(h) {
    const box = h.root.querySelector('.sy-prog');
    if (box) box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-sy]');
      if (!b) return;
      if (b.dataset.sy === 'hide') { if (dlg) dlg.close(); }
      // a problem holds the first sync up: the status view has Sync now and Sign out (it carries on by itself too)
      else if (b.dataset.sy === 'status') { flow = null; refreshAll(); }
    });
    progUpdate(h);
  }
  function progUpdate(h) {
    const log = h.root.querySelector('[data-dyn=log]');
    if (!log || !flow) return;
    const li = (cls, icon, html) => `<li class="${cls}"><span class="sy-li">${icon}</span><span>${html}</span></li>`;
    const spin = '<span class="sy-spin" aria-hidden="true"></span>', tick = ic('check');
    const out = [li('done', tick, `Signed in as <b>${H(flow.email || 'you')}</b>`)];
    let working = false;
    if (flow.first) {
      let can = true;
      try { can = typeof Store !== 'undefined' && !!Store.available; } catch (e) { can = false; }
      if (flow.snap) out.push(li('done', tick, 'Safety snapshot of this device saved'));
      else if (!can) out.push(li('skip', ic('minus'), 'No safety snapshot — this browser can’t store them'));
      else if (!flow.moved) { out.push(li('busy', spin, 'Saving a safety snapshot of this device…')); working = true; }
    }
    if (flow.down) out.push(li('done', I.down, `${plural(flow.down, 'item')} downloaded`));
    if (flow.left > 0) { out.push(li('busy', spin, `Uploading — ${plural(flow.left, 'item')} to go`)); working = true; }
    if (!working && !flow.problem) out.push(li('busy', spin, flow.moved ? 'Finishing up…' : 'Comparing with your cloud copy…'));
    if (flow.problem) out.push(li('warn', ic('alert'), H(flow.problem)));
    put(log, out.join(''));
    put(h.root.querySelector('[data-dyn=pacts]'), (flow.problem ? '<button type="button" class="btn btn-ghost" data-sy="status">Show sync status</button>' : '')
      + (h.where === 'modal' ? '<button type="button" class="btn btn-ghost" data-sy="hide">Continue in the background</button>' : ''));
  }

  /* ── View: the first sync finished ──────────────────────── */
  function phoneSteps(email) {
    const url = appUrl();
    let share = false;
    try { share = typeof navigator.share === 'function'; } catch (e) { share = false; }
    return `${url ? `<div class="sy-url"><input class="input mono" type="text" readonly value="${H(url)}" aria-label="CryptoJournal’s address for your iPhone" data-sy="url" spellcheck="false"><button type="button" class="btn btn-ghost btn-sm" data-sy="copy">${ic('copy')}Copy link</button>${share ? `<button type="button" class="btn btn-ghost btn-sm" data-sy="share">${I.share}Share…</button>` : ''}</div>`
      : '<p class="sy-p">The iPhone address appears here once the app is published online (<b>deploy → Publish CryptoJournal</b>). This PC’s copy runs on localhost, which an iPhone can’t open.</p>'}
      <ol class="sy-ol">
        <li>${url ? 'Open the link in <b>Safari</b> on your iPhone — send it to yourself in a message or email.' : 'Open the published address in <b>Safari</b> on your iPhone.'}</li>
        <li>Tap <b>Share</b> <span class="sy-gl">${I.share}</span> then <b>Add to Home Screen</b>.</li>
        <li>Open <b>CryptoJournal</b> from your Home Screen.</li>
        <li>Go to <b>Settings → Sync &amp; devices</b>.</li>
        <li>Sign in with ${email ? `<b class="sy-em">${H(email)}</b>` : 'the same email'} and the same password.</li>
      </ol>
      <p class="sy-p sy-sm dim">Sign in inside the Home Screen app, not a Safari tab — the iPhone keeps their data separate.</p>`;
  }
  function doneHtml(h) {
    const f = flow || {}, s = status() || {}, email = (s.user && s.user.email) || f.email || '';
    const msg = f.msg || (f.first ? 'Sync is on — your journal is up to date.' : 'You’re signed in and your journal is up to date.');
    const seeded = /uploaded/.test(msg) && !/downloaded/.test(msg);   // this device filled an empty cloud
    return `<div class="sy-done">
      <p class="sy-lead" tabindex="-1" data-af><b>${H(msg)}</b></p>
      ${f.snap ? '<p class="sy-p">A safety snapshot of this device’s journal was saved first — it’s under Settings → Data &amp; backups → Snapshots.</p>' : ''}
      ${f.warn ? `<div class="banner sy-alert">${ic('alert')}<div class="grow">${H(f.warn)}</div></div>` : ''}
      ${IPHONE ? '<p class="sy-p">This iPhone and your PC now share one journal: what you change on one shows up on the other.</p>'
        : `<div class="sy-next"><h4 class="sy-sh">${seeded ? 'Next: your iPhone' : 'On your iPhone'}</h4>${phoneSteps(email)}</div>`}
      <div class="sy-acts"><button type="button" class="btn btn-primary" data-sy="done">Done</button></div>
    </div>`;
  }
  function doneBind(h) {
    const b = h.root.querySelector('[data-sy=done]');
    if (b) b.addEventListener('click', () => { flow = null; if (h.where === 'modal' && dlg) dlg.close(); refreshAll(); });
    bindCopy(h.root);
  }

  /* ── View: signed in ────────────────────────────────────── */
  // How many documents this device knows the cloud holds. The public API has no count, so this reads the engine's
  // bookkeeping (read-only) and the row is simply left out when it isn't there.
  function cloudCount() {
    try {
      const S = E(), st = S && S._core && typeof S._core.state === 'function' ? S._core.state() : null;
      if (!st || !st.known || typeof st.known !== 'object') return 0;
      let n = 0;
      for (const id of Object.keys(st.known)) if (st.known[id] && st.known[id].h !== 'del') n++;
      return n;
    } catch (e) { return 0; }
  }
  const shownState = (s) => (flow && flow.phase === 'progress' ? 'syncing' : s.state);
  function stateHtml(s) {
    // "last synced" has its own row; a change saved a moment ago is still on its way
    const st = shownState(s), detail = st !== 'synced' ? sentence(s, st) : s.pending ? `${plural(s.pending, 'change')} on the way up.` : 'Everything on this device is in your cloud copy.';
    return `<div class="sy-state" data-state="${H(st)}"><span class="sy-ic">${stateIcon(st)}</span><div><b>${H(TITLE[st] || '')}</b><span class="sy-sd">${H(detail)}</span></div></div>`;
  }
  function rowsHtml(s, h) {
    const rows = [
      ['Last synced', ago(s.lastSyncAt)],
      ['Waiting to upload', s.pending ? plural(s.pending, 'change') : 'nothing'],
      ['Connection', offline() || s.state === 'offline' ? 'offline' : s.realtime ? 'live — changes arrive within seconds' : 'checking for changes every 30 seconds'],
    ];
    if (s.mediaPending) rows.push(['Screenshots to upload', nf(s.mediaPending)]);
    const n = cloudCount();
    if (n) rows.push(['Items in your cloud copy', nf(n)]);
    if (h.where === 'modal' && s.deviceName) rows.push(['This device', s.deviceName]);
    return rows.map(([l, v]) => `<div class="sy-row"><span class="sl">${H(l)}</span><span class="sv">${H(v)}</span></div>`).join('');
  }
  function alertsHtml(s) {
    const S = E(), out = [];
    let pend = false;
    try { pend = !!(S && S.pendingRecovery); } catch (e) { pend = false; }
    if (pend) out.push(`<div class="banner info sy-alert">${ic('lock')}<div class="grow"><b>Finish resetting your password.</b> You opened a reset link on this device — choose the new password.</div><div class="acts"><button type="button" class="btn btn-primary btn-xs" data-sy="newpw">Set a new password</button></div></div>`);
    if (s.cloudGone) out.push(`<div class="banner err sy-alert">${ic('alert')}<div class="grow"><b>Your cloud copy was deleted</b> (on another device), so sync is paused here. Press <b>Upload this journal again</b> to start over from this device’s journal — or sign out.</div></div>`);
    else if (!s.firstSyncDone && !flow && s.state !== 'error') out.push(`<div class="banner info sy-alert">${ic('info')}<div class="grow">The first sync on this device hasn’t finished yet — it carries on by itself while you’re online.</div></div>`);
    return out.join('');
  }
  const nowLabel = (s) => (s && s.cloudGone ? 'Upload this journal again' : 'Sync now');
  function otherCard(s) {
    const email = (s.user && s.user.email) || '';
    if (IPHONE) return card('Use it on your PC', I.pc, `<p class="sy-p">On your PC, open CryptoJournal, go to <b>Settings → Sync &amp; devices</b> and sign in with <b class="sy-em">${H(email)}</b>. Both devices then share one journal.</p>`);
    return card('Use it on your iPhone', I.phone, phoneSteps(email));
  }
  function statusHtml(h) {
    const s = status() || {}, email = (s.user && s.user.email) || '';
    const body = `<div class="sy-stat">
      <div class="sy-who"><span class="sy-av" aria-hidden="true">${H((email.trim()[0] || '?').toUpperCase())}</span><div class="sy-whot"><span class="dim">Signed in as</span><b class="sy-email">${H(email)}</b></div></div>
      <div data-dyn="state"></div>
      <div class="sy-rows" data-dyn="rows"></div>
      <div class="sy-alerts" data-dyn="alert"></div>
      <div class="sy-acts">
        <button type="button" class="btn btn-primary btn-sm" data-sy="now"${h.where === 'modal' ? ' data-af' : ''}>${ic('refresh')}<span>${nowLabel(s)}</span></button>
        ${h.where === 'modal' ? `<button type="button" class="btn btn-ghost btn-sm" data-sy="settings">${ic('gear')}Sync &amp; devices settings</button>` : ''}
        <button type="button" class="btn btn-quiet btn-sm" data-sy="out">Sign out</button>
      </div>
      <p class="sy-p sy-sm dim">Signing out keeps this device’s journal — it only stops syncing. Sign in again any time to carry on.</p>
    </div>`;
    if (h.where === 'modal') return body;
    const dev = nid('dev'), devh = nid('devh');
    return `<div class="st-grid">
      ${card('Cloud sync', 'refresh', body, { aside: '<span data-dyn="badge"></span>' })}
      ${otherCard(s)}
      ${card('This device', IPHONE ? I.phone : I.pc, `<div class="field">
        <label for="${dev}">Device name</label>
        <input class="input" id="${dev}" data-sy="dev" maxlength="40" autocomplete="off" spellcheck="false" value="${H(s.deviceName || '')}" aria-describedby="${devh}">
        <div class="hint" id="${devh}" data-sy="devh" aria-live="polite">Tells your devices apart: every change this device uploads carries its name.</div></div>`)}
      ${card('Delete cloud copy', 'trash', `<p class="sy-p">Removes everything this account stored in the cloud. <b>This device keeps its whole journal</b>; sync turns off here, and your other devices keep their own copies.</p>
        <div class="sy-acts st-acts"><button type="button" class="btn btn-danger btn-sm" data-sy="del">${ic('trash')}Delete cloud copy…</button></div>`, { cls: 'st-danger' })}
    </div>`;
  }
  function statusBind(h) {
    const r = h.root, on = (k, fn) => { for (const b of r.querySelectorAll(`[data-sy="${k}"]`)) b.addEventListener('click', fn); };
    on('now', (ev) => syncNow({ btn: ev.currentTarget }));
    on('out', () => signOut());
    on('settings', () => { if (dlg) dlg.close(); goSettings(); });
    on('del', (ev) => deleteCloud(ev.currentTarget));
    bindCopy(r);
    const dev = r.querySelector('[data-sy=dev]');
    if (dev) bindDevice(dev, r.querySelector('[data-sy=devh]'));
    statusUpdate(h);
  }
  function statusUpdate(h) {
    const s = status();
    if (!s) return;
    const q = (k) => h.root.querySelector(`[data-dyn="${k}"]`);
    put(q('badge'), `<span class="badge sy-badge" data-state="${H(shownState(s))}">${H(LABEL[shownState(s)] || '')}</span>`);
    put(q('state'), stateHtml(s));
    put(q('rows'), rowsHtml(s, h));
    const al = q('alert');
    if (put(al, alertsHtml(s))) { const b = al.querySelector('[data-sy=newpw]'); if (b) b.addEventListener('click', () => recovery()); }
    const now = h.root.querySelector('[data-sy=now]');
    if (now && !now.dataset.busy && !now.dataset.flash) put(now, `${ic('refresh')}<span>${nowLabel(s)}</span>`);
  }
  function bindDevice(inp, hint) {
    let last = inp.value;
    const save = async () => {
      const S = E();
      if (!S || inp.value.trim() === last.trim()) return;
      let ok = false;
      try { ok = !!(await S.setDeviceName(inp.value)); } catch (e) { ok = false; }
      let name = last;
      try { name = S.deviceName; } catch (e) { /* keep */ }
      last = name;
      if (document.activeElement !== inp) inp.value = name;
      if (hint) hint.textContent = ok ? `Saved — this device is now “${name}”.` : 'The name could not be saved — try again.';
    };
    inp.addEventListener('change', save);
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
  }
  function bindCopy(root) {
    const url = appUrl(), inp = root.querySelector('[data-sy=url]');
    for (const b of root.querySelectorAll('[data-sy=copy]')) b.addEventListener('click', () => copyLink(url, inp));
    for (const b of root.querySelectorAll('[data-sy=share]')) b.addEventListener('click', () => {
      try { Promise.resolve(navigator.share({ title: 'CryptoJournal', text: 'Open this in Safari on your iPhone, then Share → Add to Home Screen.', url })).catch(() => {}); } catch (e) { copyLink(url, inp); }
    });
    if (inp) inp.addEventListener('focus', () => { try { inp.select(); } catch (e) { /* ok */ } });
  }
  async function copyLink(url, inp) {
    if (!url) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); toast('Link copied — paste it into a message or email to your iPhone', 'ok', { ms: 4000 }); return; }
    } catch (e) { /* no clipboard permission: select it instead */ }
    // (iOS selects a field's text only through setSelectionRange)
    try { if (inp) { inp.focus({ preventScroll: true }); inp.select(); inp.setSelectionRange(0, inp.value.length); } if (document.execCommand && document.execCommand('copy')) { toast('Link copied', 'ok'); return; } } catch (e) { /* ok */ }
    toast(touch() ? 'Copying isn’t allowed here — the link is selected: tap it and choose Copy' : 'Copying isn’t allowed here — the link is selected, so press Ctrl+C (⌘C on a Mac)', 'warn', { ms: 6000 });
  }

  const VIEWS = {
    missing: { html: () => '<p class="sy-p">Cloud sync couldn’t load in this copy of the app. Reload the page — the journal on this device isn’t affected.</p>' },
    unset: { html: () => '<p class="sy-p">Cloud sync isn’t set up in this copy of the app (config.js has no cloud address). Everything else works as usual, on this device.</p>' },
    auth: { html: authHtml, bind: authBind },
    progress: { html: progHtml, bind: progBind, update: progUpdate },
    done: { html: doneHtml, bind: doneBind },
    status: { html: statusHtml, bind: statusBind, update: statusUpdate },
  };

  /* ── Actions ────────────────────────────────────────────── */
  // o: { btn (shows progress on it), toast (report the result — the palette has no other feedback) }
  async function syncNow(o) {
    o = o || {};
    const S = E();
    if (!S || !enabled()) { if (o.toast) toast(S ? 'Cloud sync isn’t set up in this copy of the app' : 'Cloud sync couldn’t load — reload the page', 'warn'); return false; }
    const s = status();
    if (!s || !s.user || s.state === 'auth') { open(); return false; }
    const b = o.btn;
    if (b && b.dataset.busy) return false;
    if (offline()) { toast(sentence(s, 'offline'), 'warn', { ms: 5000 }); return false; }
    if (b) { b.dataset.busy = '1'; b.setAttribute('aria-disabled', 'true'); b._syH = null; b.innerHTML = '<span class="sy-spin" aria-hidden="true"></span><span>Syncing…</span>'; }
    let ok = false;
    try { ok = !!(await S.now()); } catch (e) { ok = false; }
    const a = status() || {};
    if (b) {
      delete b.dataset.busy; b.removeAttribute('aria-disabled'); b._syH = null;
      b.innerHTML = ok ? `${ic('check')}<span>Up to date</span>` : `${ic('refresh')}<span>${nowLabel(a)}</span>`;
      if (ok) { b.dataset.flash = '1'; setTimeout(() => { delete b.dataset.flash; if (!b.dataset.busy) { b._syH = null; b.innerHTML = `${ic('refresh')}<span>${nowLabel(status())}</span>`; } }, 2500); }
    }
    if (o.toast) {
      if (ok) toast(a.pending ? `Synced — ${plural(a.pending, 'change')} still waiting` : 'Synced — your journal is up to date', 'ok');
      else toast(a.state === 'synced' ? 'Sync is catching up — try again in a moment.' : sentence(a), a.state === 'offline' || a.state === 'synced' ? 'warn' : 'err', { ms: 7000 });
    }
    refreshAll();
    return ok;
  }
  async function signOut() {
    const S = E();
    if (!S) return;
    const s = status() || {};
    if (s.pending > 0) {
      const ok = await confirmDialog({
        title: 'Sign out of sync?', confirmText: 'Sign out', cancelText: 'Stay signed in',
        html: `<p><b>${plural(s.pending, 'change')}</b> made on this device ${s.pending === 1 ? 'hasn’t' : 'haven’t'} reached the cloud yet. ${s.pending === 1 ? 'It stays' : 'They stay'} here and upload${s.pending === 1 ? 's' : ''} when you sign in again.</p><p>This device keeps its whole journal either way.</p>`,
      });
      if (!ok) return;
    }
    try { await S.signOut(); } catch (e) { /* the engine always forgets the local session */ }
    flow = null;
    if (dlg) dlg.close();
    toast('Signed out — this device keeps its journal. Sign in again any time to keep syncing.', 'ok', { ms: 5000 });
    refreshAll();
  }
  async function deleteCloud(btn) {
    const S = E();
    if (!S || delBusy) return;
    const s = status() || {}, email = (s.user && s.user.email) || '';
    if (offline()) { toast('You’re offline — connect to the internet to delete your cloud copy.', 'warn', { ms: 5000 }); return; }
    const ask = confirmDialog({
      title: 'Delete your cloud copy?', danger: true, requireText: 'DELETE', confirmText: 'Delete cloud copy', cancelText: 'Keep it', width: 520,
      html: `<p>Everything ${email ? `<b class="sy-em">${H(email)}</b>` : 'this account'} stored in the cloud is deleted for good: trades, journal days, reviews, settings and screenshots.</p>
        <p class="sy-cm"><b>This device keeps its whole journal</b>, and sync turns off here. Your other devices keep their own copies; sync pauses there until you upload again.</p>`,
    });
    // core's type-to-confirm field (created just now): tied to its label, and on a phone keyboard it types capitals
    // without autocorrect, or "DELETE" would come out as "Delete" and the button would never enable
    const req = [...document.querySelectorAll('.modal-backdrop.dyn [data-req]')].pop(), lab = req && req.closest('.field') ? req.closest('.field').querySelector('label') : null;
    if (req) {
      req.id = nid('req');
      if (lab) lab.htmlFor = req.id;
      for (const [k, v] of [['autocapitalize', 'characters'], ['autocomplete', 'off'], ['autocorrect', 'off'], ['spellcheck', 'false'], ['enterkeyhint', 'done']]) req.setAttribute(k, v);
      fitKeyboard(req.closest('.modal-backdrop'));
    }
    const ok = await ask;
    fitKb();
    if (!ok) return;
    delBusy = true;
    if (btn && btn.isConnected) { btn.setAttribute('aria-disabled', 'true'); btn.innerHTML = '<span class="sy-spin" aria-hidden="true"></span>Deleting…'; }
    let r = null;
    try { r = await S.deleteCloud(); } catch (e) { r = null; }
    delBusy = false;
    if (btn && btn.isConnected) { btn.removeAttribute('aria-disabled'); btn.innerHTML = `${ic('trash')}Delete cloud copy…`; }
    if (r && r.ok) { flow = null; toast(r.message || 'Your cloud copy was deleted. This device keeps its journal; sync is off.', 'ok', { ms: 8000 }); }
    else toast((r && r.error) || 'The cloud copy could not be deleted — try again.', 'err', { ms: 8000 });
    refreshAll();
  }

  /* ── Public: the dialog (topbar chip, Sync.open(), "Sync now" while signed out) ── */
  function open() {
    if (typeof Modal === 'undefined' || typeof document === 'undefined') return;
    if (dlg && dlg.root.isConnected) { focusIn(dlg); return; }
    const m = Modal.open({
      title: 'Cloud sync', width: 760, body: '<div class="sy-box sy-dlg"></div>',
      onClose: () => {
        fitKb();
        if (!dlg || dlg.m !== m) return;
        dlg = null;
        if (flow && flow.phase === 'done') { flow = null; refreshAll(); }   // closing the summary = done with it
      },
    });
    const panel = m.el.querySelector('.modal'), head = m.el.querySelector('.modal-head h3');
    if (panel && head) { head.id = nid('title'); panel.setAttribute('aria-labelledby', head.id); }
    dlg = { m, where: 'modal', root: m.el.querySelector('.sy-dlg'), panel, head: head || document.createElement('h3'), kind: null, close: () => m.close() };
    fitKeyboard(m.el);
    draw(dlg);
    setTimeout(() => { if (dlg && dlg.m === m) focusIn(dlg); }, 45);   // after Modal's own first-input focus (30 ms)
  }

  /* ── Public: Settings → Sync & devices ──────────────────── */
  function renderSettings(el) {
    if (!el) return;
    if (!setHost) {
      const root = document.createElement('div');
      root.className = 'sy-set';
      setHost = { where: 'settings', root, kind: null };
      // Settings rebuilds its panel on every journal change and this same node is mounted again, so what is
      // being typed, a request in flight and keyboard focus all survive
      root.addEventListener('focusin', (ev) => { setFocus = ev.target; });
      root.addEventListener('focusout', () => { setTimeout(() => { if (!root.isConnected || !root.contains(document.activeElement)) setFocus = null; }, 0); });
      // …but a password typed here and never sent goes once the section leaves the screen (another section of
      // Settings: its re-render has run by the time this fires, so a mere re-render keeps it)
      const page = el.closest ? el.closest('.page') : null;
      if (page && typeof MutationObserver === 'function') new MutationObserver(() => { if (!root.isConnected) forget(setHost); }).observe(page, { childList: true });
    }
    const root = setHost.root;
    if (root.parentNode !== el || el.childNodes.length !== 1) { el.textContent = ''; el.appendChild(root); }
    if (want() !== setHost.kind) draw(setHost); else update(setHost);
    const a = document.activeElement;
    if (setFocus && root.contains(setFocus) && (!a || a === document.body)) { try { setFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }

  // The eye button would otherwise show it to whoever opens this section next
  function forget(h) {
    if (!h || !h.root) return;
    for (const i of h.root.querySelectorAll('input[name=password]')) { i.value = ''; i.type = 'password'; i.removeAttribute('aria-invalid'); }
    for (const b of h.root.querySelectorAll('.sy-eye')) { b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Show password'); b.innerHTML = ic('eye'); }
  }

  /* ── Public: "Set a new password" after a reset link ────── */
  function recovery() {
    if (typeof Modal === 'undefined') return;
    if (rec && rec.el.isConnected) return;
    const S = E(), s = status() || {};
    let email = (s.user && s.user.email) || '';
    try { email = email || (S && S.email) || ''; } catch (e) { /* keep */ }
    const id = { a: nid('npa'), b: nid('npb'), h: nid('nph') }, t = touch();
    let busy = false;
    rec = Modal.open({
      title: 'Set a new password', width: 460,
      body: `<form class="sy-form sy-rec" novalidate>
        <p class="sy-lead" tabindex="-1"${t ? ' data-af' : ''}>You opened a password-reset link${email ? ` for <b class="sy-em">${H(email)}</b>` : ''}. Choose a new password — you’ll use it to sign in on your other devices too.</p>
        <input type="email" name="email" autocomplete="username" value="${H(email)}" hidden readonly>
        <div class="field">
          <label for="${id.a}">New password</label>
          <div class="input-group"><input class="input" id="${id.a}" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="72" aria-describedby="${id.h}"${t ? '' : ' data-af'}><button type="button" class="addon sy-eye" aria-label="Show passwords" aria-pressed="false">${ic('eye')}</button></div>
          <div class="hint" id="${id.h}">At least 6 characters.</div>
        </div>
        <div class="field">
          <label for="${id.b}">Repeat the new password</label>
          <input class="input" id="${id.b}" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="72">
        </div>
        <p class="sy-msg err" role="alert"></p>
        <div class="sy-acts"><button type="submit" class="btn btn-primary sy-go">Save new password</button><button type="button" class="btn btn-quiet" data-sy="later">Later</button></div>
      </form>`,
      onClose: () => { rec = null; fitKb(); refreshAll(); },
      onMount: (el, close) => {
        const f = el.querySelector('form'), a = el.querySelector('#' + id.a), b = el.querySelector('#' + id.b);
        const panel = el.querySelector('.modal'), head = el.querySelector('.modal-head h3');
        if (panel && head) { head.id = nid('title'); panel.setAttribute('aria-labelledby', head.id); }
        fitKeyboard(el);
        const eye = el.querySelector('.sy-eye'), msg = el.querySelector('.sy-msg'), go = el.querySelector('.sy-go');
        const show = (on) => { for (const x of [a, b]) x.type = on ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(on)); eye.setAttribute('aria-label', on ? 'Hide passwords' : 'Show passwords'); eye.innerHTML = ic(on ? 'eye-off' : 'eye'); };
        const fail = (inp, text) => { if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); } msg.textContent = text; };
        // Modal would focus the first input — here the hidden username field, which takes no focus
        setTimeout(() => { const x = el.querySelector('[data-af]'); if (x && x.isConnected) x.focus({ preventScroll: true }); }, 45);
        eye.addEventListener('click', () => show(a.type === 'password'));
        el.querySelector('[data-sy=later]').addEventListener('click', () => close());
        for (const x of [a, b]) x.addEventListener('input', () => { x.removeAttribute('aria-invalid'); msg.textContent = ''; });
        f.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const S2 = E();
          if (busy || !S2) return;
          msg.textContent = '';
          if (a.value.length < 6) return fail(a, 'Use at least 6 characters.');
          if (a.value !== b.value) return fail(b, 'The two passwords don’t match.');
          if (offline()) return fail(null, 'You’re offline. Connect to the internet to save the new password.');
          show(false);
          busy = true; go.setAttribute('aria-disabled', 'true'); go.innerHTML = '<span class="sy-spin" aria-hidden="true"></span>Saving…';
          let r = null;
          try { r = await S2.updatePassword(a.value); } catch (e) { r = null; }
          busy = false; go.removeAttribute('aria-disabled'); go.textContent = 'Save new password';
          if (r && r.ok) { a.value = ''; b.value = ''; close(); toast('New password saved — use it to sign in on your other devices.', 'ok', { ms: 6000 }); return; }
          fail(null, (r && r.error) || 'The password could not be saved — try again.');
        });
      },
    });
  }

  /* ── Wiring ─────────────────────────────────────────────── */
  // The engine toasts the first-sync result too; while the summary on screen says the same words, that toast only
  // covers it (on a phone, right over the dialog)
  function dropEcho(msg) {
    setTimeout(() => {
      if (!msg || !hosts(true).length || typeof document === 'undefined') return;
      for (const t of document.querySelectorAll('#toast-wrap .toast')) if (t.textContent.trim() === msg.trim()) t.remove();
    }, 0);
  }
  function onNote(n) {
    const k = n && n.kind;
    if (k === 'signin') beginFlow();
    else if (k === 'first' && flow) { flow.msg = String(n.message || ''); dropEcho(flow.msg); }
    else if (k === 'signout' || k === 'deleted' || k === 'switched') flow = null;
    else if (k === 'media' && n.message) toast(String(n.message), 'warn', { ms: 7000 });
    refreshAll();
  }
  if (typeof Bus !== 'undefined') {
    // the event carries the short status; the full one (user, firstSyncDone…) comes from the getter
    Bus.on('sync', () => { track(status()); refreshAll(); });
    Bus.on('sync-note', onNote);
    // progress details for the first sync: its safety snapshot comes before anything moves (a later one is the daily snapshot)
    Bus.on('snapshots', () => { if (flow && flow.phase === 'progress' && flow.first && !flow.moved && !flow.snap) { flow.snap = true; refreshAll(); } });
    Bus.on('remote', (d) => { if (flow && flow.phase === 'progress' && d && d.count > 0) { flow.down += d.count; flow.moved = true; refreshAll(); } });
    // another page: the Settings section is hidden, not removed — an unsent password goes all the same
    Bus.on('page', (id) => { if (id !== 'settings') forget(setHost); });
  }
  // The engine reports no change when only the connection flips while signed out (or expired), but the chip shows it
  if (typeof window !== 'undefined' && window.addEventListener) for (const e of ['online', 'offline']) window.addEventListener(e, () => refreshAll());
  // "2 min ago" stays true while a panel is on screen
  setInterval(() => { for (const h of hosts(true)) update(h); }, 30000);
  function init() { chip(); }
  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }

  return {
    open, renderSettings, recovery, summary,
    syncNow: (o) => syncNow(Object.assign({ toast: true }, o || {})),
    refresh: refreshAll,
  };
})();
