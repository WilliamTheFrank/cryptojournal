/* ═══════════════════════════════════════════════════════════
   CryptoJournal — welcome intro, "Show me around" tour and the
   install guide · global Intro
   First start on a device: a five-step walkthrough (what the app
   is, logging, closing & reviewing, the numbers, iPhone and PC).
   The tour dims the page and points at the real controls one at a
   time; it never clicks anything. The install guide works out where
   it runs (PC app, iPhone Safari, another iPhone browser, an in-app
   browser, Android, a desktop browser, already installed) and shows
   only the steps that apply, with a QR code from qr.js for the phone.
   Device-only state lives in localStorage outside the journal, so it
   never syncs: cj.intro · cj.installSnooze · cj.tourDone.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Intro = (() => {
  const K_INTRO = 'cj.intro', K_SNOOZE = 'cj.installSnooze', K_TOUR = 'cj.tourDone';
  const DONE = 'v1-done', DAY = 86400000, SNOOZE_DAYS = 14;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const ok = (f, d) => { try { return f(); } catch (e) { return d; } };
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  const touch = () => mq('(hover: none) and (pointer: coarse)');
  let seq = 0;
  const nid = (p) => `it-${p}-${++seq}`;
  // Other modules, looked up one at a time: a script that is missing (ReferenceError) or threw while loading
  // (its const stays in the TDZ, where even typeof throws) only turns that one module off
  const MODS = { Settings: () => Settings, Sync: () => Sync, Palette: () => Palette, App: () => App, QR: () => QR };
  const mod = (name) => ok(() => MODS[name]() || null, null);
  const appUrl = () => ok(() => String((typeof CJ_CONFIG !== 'undefined' && CJ_CONFIG && CJ_CONFIG.appUrl) || '').trim(), '');
  // This page's own address without hash or query (a sign-in link's tokens never get copied)
  const here = () => ok(() => location.origin + location.pathname, '');

  /* ── Icons drawn inline (the sprite has no phone, PC or iOS share glyph) ── */
  const svg = (d, fill) => `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  const I = {
    share: svg('<path d="M12 14.5V3.5M8.5 7 12 3.5 15.5 7"/><path d="M8.5 10.5H7A1.5 1.5 0 0 0 5.5 12v7.5A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-1.5"/>'),
    addHome: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>', true),
    kebab: svg('<circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>', true),
    install: svg('<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/><path d="M12 7.5v5M9.6 10.6 12 13l2.4-2.4"/>'),
    phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    pc: svg('<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8 20.5h8M12 16.5v4"/>'),
    devices: svg('<rect x="2" y="4" width="13" height="10" rx="1.8"/><path d="M6.5 18h4M8.5 14v4"/><rect x="17" y="8" width="5.5" height="11" rx="1.5"/>'),
    check: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.8 2.8 5.4-5.4"/>'),
    alert: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>'),
    // the sidebar's brand mark
    logo: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><line x1="7" y1="6" x2="7" y2="18" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round"/><rect x="5.4" y="9" width="3.2" height="5" rx="1" fill="#29E5B0"/><line x1="12" y1="4.5" x2="12" y2="16.5" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round"/><rect x="10.4" y="7" width="3.2" height="5" rx="1" fill="#fff"/><line x1="17" y1="7.5" x2="17" y2="19.5" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round"/><rect x="15.4" y="10.5" width="3.2" height="5" rx="1" fill="#FF5C7A"/></svg>',
  };
  const sp = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;   // sprite icon
  // A button's glyph inside a sentence; label it when the words beside it don't say what it is
  const gl = (icon, label) => `<span class="it-gl"${label ? ` role="img" aria-label="${label}"` : ''}>${icon}</span>`;
  const appIcon = '<img class="it-appic" src="icon-180.png" alt="" width="18" height="18">';

  /* ═══ Where is it running? ═══════════════════════════════ */
  // Pure, so the dev tests can feed it real user agents:
  // _detect(ua, {standalone, displayMode, maxTouchPoints, hostname, hasPrompt}) → {os, browser, standalone, local, inApp, canPrompt}
  //   os: ios (iPhone/iPod) · ipados · android · windows · macos · chromeos · linux · other
  //   browser: safari · chrome · edge · firefox · samsung · opera · other — or, in an app's built-in browser, the app
  //   (facebook · instagram · line · twitter · google · linkedin · snapchat · tiktok · wechat · pinterest · threads · webview)
  const IN_APP = [
    ['facebook', /FBAN|FBAV|FBIOS|FB_IAB|FBSN\//], ['instagram', /Instagram/], ['threads', /Barcelona/], ['line', /\bLine\//],
    ['twitter', /Twitter/], ['google', /\bGSA\//], ['linkedin', /LinkedInApp/], ['snapchat', /Snapchat/],
    ['tiktok', /musical_ly|TikTok|BytedanceWebview/], ['wechat', /MicroMessenger/], ['pinterest', /Pinterest/], ['webview', /KAKAOTALK|NAVER\(inapp/],
  ];
  const INSTALLED_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
  function _detect(ua, o) {
    ua = String(ua || ''); o = o || {};
    // iPadOS 13+ Safari asks for desktop sites with a Mac user agent: a Mac with a touch screen is an iPad
    const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (+o.maxTouchPoints || 0) > 1);
    const os = ipad ? 'ipados' : /iPhone|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : /CrOS/.test(ua) ? 'chromeos'
      : /Windows/.test(ua) ? 'windows' : /Macintosh|Mac OS X/.test(ua) ? 'macos' : /Linux|X11/.test(ua) ? 'linux' : 'other';
    const standalone = o.standalone === true || INSTALLED_MODES.includes(o.displayMode);
    const host = String(o.hostname || '').toLowerCase();
    const local = !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
    // the order matters: Edge, Samsung, Opera and Firefox all carry "Chrome" or "Safari" too
    let browser = /EdgiOS|EdgA\/|Edg\/|Edge\//.test(ua) ? 'edge' : /SamsungBrowser/.test(ua) ? 'samsung' : /OPiOS|OPT\/|OPR\/|Opera/.test(ua) ? 'opera'
      : /FxiOS|Firefox\//.test(ua) ? 'firefox' : /CriOS|Chrome\/|Chromium\//.test(ua) ? 'chrome' : /Ddg\//.test(ua) ? 'other'
        : /Safari\//.test(ua) && /Version\//.test(ua) ? 'safari' : 'other';
    let inApp = false;
    if (!standalone) {
      const hit = IN_APP.find(([, re]) => re.test(ua));
      // an iOS page without "Safari/" in its user agent is a bare web view inside some app (an installed web app
      // has none either, but that is caught as standalone above); Android marks web views with "; wv)"
      if (hit) { inApp = true; browser = hit[0]; }
      else if ((os === 'ios' || os === 'ipados') && browser === 'other' && !/Safari\//.test(ua)) { inApp = true; browser = 'webview'; }
      else if (os === 'android' && /;\s?wv\)/.test(ua)) { inApp = true; browser = 'webview'; }
    }
    return { os, browser, standalone, local, inApp, canPrompt: !!o.hasPrompt && !standalone };
  }

  // The install prompt Chrome, Edge and Samsung Internet offer (Android and desktop). Kept so the guide can show
  // its own "Install app" button; preventDefault stops Android's mini-infobar doubling up with our banner.
  let deferred = null, installedNow = false;
  function displayMode() {
    for (const m of INSTALLED_MODES) if (mq(`(display-mode: ${m})`)) return m;
    return 'browser';
  }
  function context() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    return _detect(nav.userAgent, {
      standalone: ok(() => nav.standalone === true, false), displayMode: displayMode(),
      maxTouchPoints: ok(() => nav.maxTouchPoints || 0, 0), hostname: ok(() => location.hostname, ''), hasPrompt: !!deferred,
    });
  }
  const isPhone = (c) => c.os === 'ios' || c.os === 'ipados' || c.os === 'android';
  const isIOS = (c) => c.os === 'ios' || c.os === 'ipados';
  // Which version of the guide applies. The PC app runs on localhost: that wins over everything else.
  function kind(c) {
    if (c.local) return 'pc';
    if (c.standalone) return 'installed';
    if (c.inApp) return 'inapp';
    if (isIOS(c)) return c.browser === 'safari' ? 'ios-safari' : 'ios-other';
    if (c.os === 'android') return 'android';
    return 'desktop';
  }
  const BROWSER = { safari: 'Safari', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', samsung: 'Samsung Internet', opera: 'Opera', other: 'this browser' };
  const APP = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', line: 'LINE', twitter: 'X', google: 'the Google app', linkedin: 'LinkedIn', snapchat: 'Snapchat', tiktok: 'TikTok', wechat: 'WeChat', pinterest: 'Pinterest', webview: 'this app' };

  /* ═══ Install guide content ══════════════════════════════ */
  // A long address wraps only at its seams (after "//", either side of an inner "/", before "."), never inside a
  // word: "cryptojou|rnal" on a phone is how a typo starts. Takes escaped text; <wbr> adds nothing when copied.
  const seams = (s) => s.replace(/\/\/|\/(?=.)|\./g, (m) => (m === '//' ? '//<wbr>' : m === '.' ? '<wbr>.' : '<wbr>/<wbr>'));
  const urlRow = (url) => `<div class="it-url"><span class="it-addr" translate="no">${seams(esc(url))}</span><button type="button" class="btn btn-ghost btn-sm" data-it="copy" data-url="${esc(url)}">${sp('copy')}<span>Copy link</span></button></div>`;
  function qrCode(url, compact) {
    const Q = mod('QR');
    if (!Q || typeof Q.svg !== 'function') return '';
    try {
      // whole pixels per module keep the code crisp: (modules + 2 × 4 quiet zone) × scale
      const n = Q.matrix ? Q.matrix(url, { ecc: 'M' }).size + 8 : 41;
      return `<div class="it-qr-code">${Q.svg(url, { ecc: 'M', margin: 4, size: n * (compact ? 3 : 4), label: 'QR code for ' + url })}</div>`;
    } catch (e) { console.warn('[intro] QR code', e); return ''; }
  }
  // The code with the steps beside it, then the address (whole, on its own row) to copy or type
  function qrBlock(url, compact, side) {
    const code = qrCode(url, compact);
    const typo = /github\.io/i.test(url) ? 'a typo opens GitHub’s “404” page' : 'a typo opens an error page';
    return `<div class="it-qr${code ? '' : ' it-noqr'}">${code}<div class="it-qr-side">${side(!!code)}</div></div>
      ${urlRow(url)}<p class="it-p it-sm dim">Typing it? Use lower case, exactly as shown: ${typo}.</p>`;
  }
  // where: the other device the email must match ('this PC', 'this computer'…)
  const signInStep = (where) => `<li>Sign in under <b>Settings → Sync &amp; devices</b> with the same email as on ${where || 'your PC'}.</li>`;
  function iosSteps(c, o) {
    const ipad = c.os === 'ipados';
    return `<ol class="it-ol">
      ${o.first || ''}
      <li>Tap <b>Share</b> ${gl(I.share)} ${ipad ? 'at the top of the screen, next to the address' : 'at the bottom of the screen'}.${ipad ? '' : ` Only see ${gl(I.dots, 'More (•••)')}? Tap it first.`}</li>
      <li>Scroll down, tap <b>Add to Home Screen</b> ${gl(I.addHome)}, then <b>Add</b>. If you see <b>Open as Web App</b>, leave it on.</li>
      <li>Open <b>CryptoJournal</b> ${appIcon} from your Home Screen.</li>
      ${signInStep(o.pc ? 'this PC' : '')}
    </ol>`;
  }
  const separateNote = (from) => `<p class="it-note">${I.info}<span>The Home Screen app keeps its own data, separate from ${from}. Your journal shows up in it once you sign in.</span></p>`;
  const installBtn = '<div class="it-acts"><button type="button" class="btn btn-primary" data-it="prompt" data-af>' + I.install + '<span>Install app</span></button></div>';
  function desktopSteps(c) {
    if (c.canPrompt) {
      const alt = c.browser === 'edge' ? 'Or click <b>…</b> at the top right → <b>Apps</b> → <b>Install this site as an app</b>.'
        : c.browser === 'chrome' ? `Or click the install icon ${gl(I.install)} at the right end of the address bar.` : 'Or use the browser’s own menu.';
      return `${installBtn}<p class="it-p it-sm dim">${alt}</p>`;
    }
    if (c.browser === 'edge') return '<ol class="it-ol"><li>Click <b>…</b> (Settings and more) at the top right.</li><li>Choose <b>Apps</b> → <b>Install this site as an app</b>, then <b>Install</b>.</li></ol>';
    if (c.browser === 'chrome') return `<ol class="it-ol"><li>Click the install icon ${gl(I.install)} at the right end of the address bar.</li><li>Click <b>Install</b>.</li></ol><p class="it-p it-sm dim">No icon? Open the <b>⋮</b> menu → <b>Cast, save and share</b> → <b>Install page as app</b>.</p>`;
    if (c.browser === 'safari' && c.os === 'macos') return '<ol class="it-ol"><li>Choose <b>File → Add to Dock</b> (macOS Sonoma or later).</li><li>Click <b>Add</b>.</li></ol>';
    return `<p class="it-p">${c.browser === 'firefox' ? 'Firefox can’t install web apps. ' : ''}Open this page in <b>Edge</b> or <b>Chrome</b> to install it, or bookmark it.</p>`;
  }
  const phoneQr = (compact) => `<h4 class="it-sh">Put it on your phone</h4>${qrBlock(appUrl() || here(), compact, (code) => `<ol class="it-ol">
      <li>${code ? 'Point your phone’s Camera at the code and tap the link.' : 'Open the address below on your phone.'}</li>
      <li><b>iPhone:</b> in <b>Safari</b>, tap <b>Share</b> ${gl(I.share)} → <b>Add to Home Screen</b> ${gl(I.addHome)}.</li>
      <li><b>Android:</b> browser menu <b>⋮</b> → <b>Install app</b>.</li>
      ${signInStep('this computer')}</ol>`)}`;
  // compact: the welcome's last slide — the same steps and notes, with a smaller QR code and no sync box
  // (the slide has its own sync line)
  function guideHtml(c, compact) {
    const k = kind(c), url = appUrl();
    const status = (icon, html, cls) => `<div class="it-status${cls ? ' ' + cls : ''}">${icon}<div>${html}</div></div>`;
    let out = '';
    if (k === 'pc') {
      out = status(I.pc, '<b>This is your PC app.</b> It runs on this computer and works offline.')
        + '<h4 class="it-sh">Put it on your iPhone</h4>'
        + (url ? qrBlock(url, compact, (code) => iosSteps({ os: 'ios' }, { pc: true,
          first: `<li>${code ? 'Point your iPhone’s Camera at the code and tap the link. It opens in <b>Safari</b>.' : 'Open the address below in <b>Safari</b> on your iPhone.'}</li>` }))
          + separateNote('Safari')
          : '<p class="it-p">The online copy isn’t published yet, so there is no address for your iPhone to open. Publish it first; the QR code appears here afterwards.</p>');
    } else if (k === 'installed') {
      const phone = isPhone(c);
      out = status(I.check, `<b>You’re using the installed app.</b> ${phone ? 'Open it from your Home Screen any time.' : 'Open it from the Start menu, Dock or desktop any time.'}`)
        + (phone ? `<h4 class="it-sh">Put it on your PC</h4>
            <p class="it-p">On your PC, open CryptoJournal. No app there yet? Open this address in <b>Edge</b>, then <b>…</b> → <b>Apps</b> → <b>Install this site as an app</b>.</p>${urlRow(url || here())}`
          : phoneQr(compact));
    } else if (k === 'inapp') {
      const ios = isIOS(c), b = ios ? 'Safari' : 'Chrome', name = APP[c.browser] || APP.webview;
      out = status(I.alert, `<b>Open this page in ${b} first.</b> You’re in ${name === APP.webview ? 'an app’s' : esc(name) + '’s'} built-in browser, which can’t add apps to your ${c.os === 'android' ? 'Home screen' : 'Home Screen'}.`, 'warn')
        + `<ol class="it-ol"><li>Tap the menu (<b>•••</b> or <b>⋮</b>) or the share icon, then <b>Open in ${b}</b>. It may say <b>Open in browser</b>.</li>
          <li>No such option? Tap <b>Copy link</b>, open <b>${b}</b> and paste it into the address bar.</li></ol>${urlRow(here())}`;
    } else if (k === 'ios-safari') {
      out = status(I.phone, '<b>Add CryptoJournal to your Home Screen.</b> It opens full-screen, like an app, and works offline.')
        + iosSteps(c, {}) + separateNote('Safari');
    } else if (k === 'ios-other') {
      const b = BROWSER[c.browser] || BROWSER.other;
      // a browser we can't name gets no "You're in this browser." (it says nothing)
      out = status(I.phone, `<b>Open this page in Safari.</b> ${c.browser === 'other' ? '' : `You’re in ${esc(b)}. `}Safari adds apps to the Home Screen most reliably.`)
        + `<ol class="it-ol"><li>Tap <b>Copy link</b>.</li><li>Open <b>Safari</b>, paste the link into the address bar and open it.</li>
          <li>Tap <b>Share</b> ${gl(I.share)} → <b>Add to Home Screen</b> ${gl(I.addHome)} → <b>Add</b>.</li></ol>${urlRow(here())}`
        + `<p class="it-note">${I.info}<span>On iOS 16.4 or later, ${esc(b)}’s own <b>Share</b> menu → <b>Add to Home Screen</b> works too.</span></p>`
        + separateNote('your browser');
    } else if (k === 'android') {
      const samsung = c.browser === 'samsung';
      out = status(I.phone, '<b>Install CryptoJournal on your Home screen.</b> It opens full-screen, like an app, and works offline.')
        + (c.canPrompt ? `${installBtn}<ol class="it-ol"><li>Tap <b>Install app</b>, then <b>Install</b>.</li>`
          : `<ol class="it-ol"><li>Tap the browser menu ${samsung ? '<b>≡</b> at the bottom right' : `${gl(I.kebab, 'Menu (⋮)')} at the top right`}.</li>
            <li>Tap <b>Install app</b> or <b>Add to Home screen</b>${samsung ? ' (in Samsung Internet: <b>Add page to</b> → <b>Home screen</b>)' : ''}.</li>`)
        + '<li>Open <b>CryptoJournal</b> ' + appIcon + ' from your Home screen.</li>' + signInStep() + '</ol>';
    } else {
      out = status(I.pc, '<b>Install CryptoJournal on this computer.</b> It gets its own window and works offline.')
        + desktopSteps(c) + phoneQr(compact);
    }
    // one journal on every device — the welcome's last slide says this in its own list
    const canSync = ok(() => mod('Settings').sections.includes('sync'), false);
    if (!compact) {
      out += `<div class="it-sync">${I.devices}<div class="grow"><b>One journal on every device.</b> Sign in under <b>Settings → Sync &amp; devices</b> with the same email on your iPhone and PC.</div>
        ${canSync ? '<button type="button" class="btn btn-ghost btn-sm" data-it="sync">Open Sync &amp; devices</button>' : ''}</div>`;
    }
    return `<div class="it-guide" data-kind="${k}">${out}</div>`;
  }

  /* ── Guide actions (copy, install prompt, go to sync) ── */
  async function copy(text, btn) {
    let done = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); done = true; } } catch (e) { done = false; }
    if (!done) {
      // no clipboard API (or it was refused): copy through a hidden text field
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'it-copybox';
      document.body.appendChild(ta);
      try { ta.select(); ta.setSelectionRange(0, text.length); done = document.execCommand('copy'); } catch (e) { done = false; }
      ta.remove();
      if (btn && btn.isConnected) btn.focus({ preventScroll: true });
    }
    toast(done ? 'Link copied' : 'Couldn’t copy. Select the address and copy it.', done ? 'ok' : 'warn');
    if (done && btn && btn.isConnected) {
      const l = btn.querySelector('span');
      if (l) { l.textContent = 'Copied'; setTimeout(() => { if (l.isConnected) l.textContent = 'Copy link'; }, 2000); }
    }
  }
  async function promptInstall() {
    const ev = deferred;
    if (!ev) { redraw(); return; }
    deferred = null;   // the browser lets a prompt be shown once
    try {
      await ev.prompt();
      const r = await ev.userChoice;
      if (r && r.outcome === 'accepted') toast('Installing CryptoJournal…', 'ok');
    } catch (e) { console.warn('[intro] install prompt', e); }
    redraw();
  }
  // hosts: every guide on screen ({ root, compact, close }) — redrawn when the install prompt comes or goes
  const hosts = new Set();
  function drawGuide(h) {
    if (!h.root.isConnected) { hosts.delete(h); return; }
    const had = h.root.contains(document.activeElement);
    h.root.innerHTML = guideHtml(context(), h.compact);
    bindGuide(h);
    if (had) { const f = h.root.querySelector('[data-af], button'); if (f) f.focus({ preventScroll: true }); }
  }
  function redraw() { for (const h of [...hosts]) drawGuide(h); }
  function bindGuide(h) {
    h.root.querySelectorAll('[data-it]').forEach(b => {
      const a = b.dataset.it;
      if (a === 'copy') b.onclick = () => copy(b.dataset.url || '', b);
      else if (a === 'prompt') b.onclick = () => promptInstall();
      else if (a === 'sync') b.onclick = () => {
        if (h.close) h.close();
        // a guide opened from the welcome's last slide: the welcome steps aside too, or it covers Settings
        if (introH && introH.m.el.isConnected) introH.m.close();
        const S2 = mod('Settings'); if (S2 && S2.show) S2.show('sync');
      };
    });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); deferred = ev; redraw(); });
    window.addEventListener('appinstalled', () => {
      deferred = null; installedNow = true;   // this tab stays a browser tab: the banner must not ask again
      toast('CryptoJournal is installed. Open it from your Home Screen or Start menu.', 'ok', { ms: 6000 });
      redraw();
      const A = mod('App'); if (A && A.renderBanners) ok(() => A.renderBanners());
    });
  }

  /* ═══ Dialog plumbing ════════════════════════════════════ */
  // Tab stays inside our dialogs. core's trap counts sprite icons (<use href>) as stops, so these dialogs move
  // focus themselves and keep the key from reaching it.
  const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  function trapTab(box, ev) {
    const f = [...box.querySelectorAll(FOCUSABLE)].filter(x => !x.disabled && x.getClientRects().length > 0 && getComputedStyle(x).visibility !== 'hidden');
    ev.preventDefault();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    f[i < 0 ? (ev.shiftKey ? f.length - 1 : 0) : (i + (ev.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  }
  // Modal.open + an accessible name from the title + our own Tab handling
  function dialog(o) {
    const m = Modal.open(o);
    const panel = m.el.querySelector('.modal'), head = m.el.querySelector('.modal-head h3');
    if (panel && head) { head.id = nid('title'); panel.setAttribute('aria-labelledby', head.id); }
    if (panel && o.cls) panel.classList.add(o.cls);
    // a click on plain text keeps focus in the dialog (not on <body>), so ← → and Tab still reach it;
    // tabindex -1 keeps the panel itself out of the Tab order
    if (panel) panel.setAttribute('tabindex', '-1');
    m.el.addEventListener('keydown', (ev) => { if (ev.key === 'Tab' && panel) { trapTab(panel, ev); ev.stopPropagation(); } });
    return { m, panel, head };
  }
  const layerOpen = () => !!document.querySelector('.modal-backdrop.open, .drawer-wrap') || !!ok(() => mod('Palette').isOpen, false);

  /* ═══ Welcome intro ══════════════════════════════════════ */
  const ui = (html, pri) => `<span class="it-ui${pri ? ' pri' : ''}">${html}</span>`;
  const pts = (rows) => `<ul class="it-pts">${rows.map(([icon, html]) => `<li><span class="it-pi">${icon}</span><span>${html}</span></li>`).join('')}</ul>`;
  const top = (badge, lead, brand) => `<div class="it-top"><span class="it-badge${brand ? ' brand' : ''}" aria-hidden="true">${badge}</span><p class="it-lead">${lead}</p></div>`;
  const SLIDES = [
    {
      id: 'welcome', title: 'Welcome to CryptoJournal',
      html: () => top(I.logo, 'Your private trading journal. Practise with paper trades, learn what works, and go live only when your own results say so.', true)
        + pts([
          [sp('layers'), `<b>Paper and Live are separate accounts.</b> Practice never mixes with real money. The ${ui('PAPER')} or ${ui('LIVE')} label by the page title shows which one you’re in.`],
          [I.devices, '<b>It works offline.</b> Your journal is saved on this device. Sign in to sync, and it’s on your iPhone and PC too.'],
        ]),
    },
    {
      id: 'log', title: 'Log every trade',
      html: () => top(sp('plus'), `${ui(sp('plus') + 'New trade', true)} at the top right opens the trade form. On the phone, it’s the ${ui(sp('plus'), true)} in the top bar.`)
        + pts([
          [sp('zap'), `<b>Just did a DEX swap?</b> Use ${ui('Quick log')}: coin, side and price now, the details later. ${touch() ? 'It’s in <b>Search</b>.' : 'Press <kbd>Q</kbd>, or find it in <b>Search</b>. <kbd>N</kbd> opens the full form.'}`],
          [sp('shield'), '<b>Always set a stop.</b> R is measured against it: losing exactly what you risked is −1R.'],
        ]),
    },
    {
      id: 'review', title: 'Close and review',
      html: () => top(sp('check'), 'Closing a trade and reviewing it is where the learning happens.')
        + pts([
          [sp('target'), `<b>Close a position</b> from <b>Dashboard → Open positions</b>, or <b>Search → ${ui('Close a position')}</b>.`],
          [sp('edit'), '<b>Review each closed trade.</b> Tag the mistakes, or mark it clean if you followed your plan.'],
          [sp('journal'), '<b>The Journal</b> is for planning the day before you trade and closing it after.'],
        ]),
    },
    {
      id: 'learn', title: 'Learn from your numbers',
      html: () => top(sp('stats'), 'After a few dozen trades, your own numbers start to tell you things. Every number shows how many trades it’s based on.')
        + pts([
          [sp('stats'), '<b>Analytics</b> shows what works and where your biggest leaks are.'],
          [sp('shield'), '<b>Readiness</b> is a checklist that tells you when your paper results support going live.'],
          [sp('trend-up'), '<b>The live ramp starts small:</b> 0.25% risk per trade at first, more only while your live results hold up.'],
        ]),
    },
    {
      id: 'devices', title: 'Use it on your iPhone and PC',
      // the context as it is now: an install prompt can arrive (or be used up) after the welcome opened
      html: () => `<div data-it="guide-root">${guideHtml(context(), true)}</div>`
        + pts([
          [I.devices, '<b>Sync:</b> sign in under <b>Settings → Sync &amp; devices</b> with the same email on your iPhone and PC.'],
          [sp('download'), '<b>Backups:</b> <b>Settings → Data &amp; backups</b>. Sync isn’t a backup, so download one now and then.'],
        ])
        + `<div class="it-more"><button type="button" class="btn btn-ghost btn-sm" data-it="guide">${I.install}<span>More ways to install</span></button></div>`
        + (ok(setUpShown, false) ? `<p class="it-next">${sp('flag')}<span>Next: the <b>Get set up</b> checklist on the Dashboard walks you through your first steps.</span></p>` : ''),
    },
  ];
  // Mention "Get set up" only where the Dashboard shows it (app.js onboarding()): Paper, not hidden, steps left.
  // The Dashboard's last render tells whether steps are left; before its first render, assume they are.
  function setUpShown() {
    if (S().onboardingDismissed || db.mode !== 'paper') return false;
    const dash = document.querySelector('.page[data-page="dash"]');
    return !dash || !dash.childElementCount || !!dash.querySelector('.db-onboard');
  }

  let introH = null;   // the open welcome dialog
  function slideIndex(s) {
    if (typeof s === 'string') { const i = SLIDES.findIndex(x => x.id === s); return i < 0 ? 0 : i; }
    return Number.isInteger(s) ? Math.max(0, Math.min(SLIDES.length - 1, s)) : 0;
  }
  function open(slide) {
    if (typeof Modal === 'undefined' || typeof document === 'undefined') return;
    if (T) end('replaced');
    const start = slideIndex(slide);
    if (introH && introH.m.el.isConnected) { show(start); return; }
    const dots = SLIDES.map(() => '<i></i>').join('');
    const d = dialog({
      title: SLIDES[start].title, width: 600, cls: 'it-modal',
      body: '<div class="it-intro"><div class="sr-only" aria-live="polite" data-it="live"></div><div data-it="slide"></div></div>',
      foot: `<button type="button" class="btn btn-quiet" data-it="skip">Skip</button><span class="it-dots" aria-hidden="true">${dots}</span>
        <button type="button" class="btn btn-ghost" data-it="back">${sp('chevron-l')}<span>Back</span></button>
        <button type="button" class="btn btn-ghost" data-it="start" hidden>Start using the app</button>
        <button type="button" class="btn btn-primary" data-it="next"><span>Next</span>${sp('chevron-r')}</button>`,
      // Skip, ×, Esc, the backdrop or a last-slide button: any way out counts as seen on this device
      onClose: () => { lsSet(K_INTRO, DONE); if (introH && introH.host) hosts.delete(introH.host); introH = null; },
    });
    const el = d.m.el, foot = el.querySelector('.modal-foot');
    if (foot) foot.classList.add('it-foot');
    introH = { m: d.m, el, head: d.head, i: start, host: null, foot };
    const b = (k) => el.querySelector(`[data-it="${k}"]`);
    b('skip').onclick = () => d.m.close();
    b('start').onclick = () => d.m.close();
    b('back').onclick = () => show(introH.i - 1);
    b('next').onclick = () => { if (introH.i < SLIDES.length - 1) show(introH.i + 1); else { d.m.close(); tour(); } };
    el.addEventListener('keydown', (ev) => {
      if ((ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const t = ev.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (!introH) return;
      const j = introH.i + (ev.key === 'ArrowRight' ? 1 : -1);
      ev.preventDefault();
      if (j >= 0 && j < SLIDES.length) show(j);
    });
    show(start);
  }
  function show(i) {
    const h = introH; if (!h) return;
    i = slideIndex(i);
    const dir = i < h.i ? -1 : 1, last = i === SLIDES.length - 1, s = SLIDES[i];
    h.i = i;
    h.head.textContent = s.title;
    const box = h.el.querySelector('[data-it="slide"]'), wrap = h.el.querySelector('.it-intro');
    if (h.host) { hosts.delete(h.host); h.host = null; }
    wrap.dataset.dir = String(dir);
    box.innerHTML = `<div class="it-slide" data-slide="${s.id}">${s.html(h)}</div>`;
    const gr = box.querySelector('[data-it="guide-root"]');
    if (gr) { h.host = { root: gr, compact: true, close: () => h.m.close() }; hosts.add(h.host); bindGuide(h.host); }
    const g = box.querySelector('[data-it="guide"]'); if (g) g.onclick = () => install();
    const b = (k) => h.el.querySelector(`[data-it="${k}"]`);
    const a = document.activeElement;
    // Back keeps its place on the first slide (invisible), so the dots don't jump around
    b('back').style.visibility = i === 0 ? 'hidden' : '';
    b('skip').hidden = last;
    b('start').hidden = !last;
    b('next').innerHTML = last ? `${sp('target')}<span>Show me around</span>` : `<span>Next</span>${sp('chevron-r')}`;
    h.foot.classList.toggle('last', last);
    h.el.querySelectorAll('.it-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
    const live = h.el.querySelector('[data-it="live"]'); if (live) live.textContent = `Step ${i + 1} of ${SLIDES.length}: ${s.title}`;
    const body = h.el.querySelector('.modal-body'); if (body) body.scrollTop = 0;
    // a button that just hid (Back on the first slide) must not leave focus on nothing
    if (a && a !== document.body && (a.hidden || !h.el.contains(a) || !a.getClientRects().length || getComputedStyle(a).visibility === 'hidden')) b('next').focus({ preventScroll: true });
  }

  /* ── First start on this device ── */
  const seen = () => String(lsGet(K_INTRO, '')).startsWith('v1');
  // Something else is on screen: a dialog, a drawer, the palette — or sync is about to ask for a new password
  // after a reset link (it opens its own dialog). The welcome never covers them.
  function busy() {
    if (layerOpen() || T) return true;
    return !!ok(() => { const s = mod('Sync'); return s && s.pendingRecovery; }, false);
  }
  let started = false;
  function maybeStart() {
    if (started) return;
    started = true;
    if (ok(() => StorageGuard.loadError, null) || seen()) return;   // an unreadable journal comes first
    const t0 = Date.now();
    const check = () => {
      if (seen() || introH || ok(() => StorageGuard.loadError, null)) return;
      if (busy()) { if (Date.now() - t0 < 60000) setTimeout(check, 500); return; }
      open(0);
    };
    setTimeout(check, 600);
  }

  /* ═══ Install guide dialog ═══════════════════════════════ */
  let guideH = null;
  function install() {
    if (typeof Modal === 'undefined' || typeof document === 'undefined') return;
    if (T) end('replaced');
    if (guideH && guideH.m.el.isConnected) { const f = guideH.m.el.querySelector('[data-af], .modal-foot .btn-primary'); if (f) f.focus({ preventScroll: true }); return; }
    let host = null;
    const d = dialog({
      title: 'Install CryptoJournal', width: 600, cls: 'it-modal',
      body: '<div data-it="guide-root"></div>',
      foot: '<button type="button" class="btn btn-primary" data-it="done">Done</button>',
      onClose: () => { if (host) hosts.delete(host); guideH = null; },
    });
    guideH = d;
    host = { root: d.m.el.querySelector('[data-it="guide-root"]'), compact: false, close: () => d.m.close() };
    hosts.add(host);
    drawGuide(host);
    d.m.el.querySelector('[data-it="done"]').onclick = () => d.m.close();
    // after Modal's own first focus (30 ms): the install button, when there is one
    setTimeout(() => { const f = host.root.querySelector('[data-af]'); if (f && f.isConnected) f.focus({ preventScroll: true }); }, 45);
  }

  /* ═══ Install banner (app.js shows it in #banners) ═══════ */
  // Only in a phone's browser tab: not installed, not the PC app, not snoozed
  function bannerHtml() {
    if (installedNow || ok(() => StorageGuard.loadError, null)) return '';
    const c = context();
    if (!isPhone(c) || c.standalone || c.local) return '';
    if (Date.now() < (+lsGet(K_SNOOZE, 0) || 0)) return '';
    return `<div class="banner info it-banner" role="region" aria-label="Install CryptoJournal">${I.phone}<div class="grow"><b>Install CryptoJournal on your Home Screen.</b> It opens full-screen and keeps your data in one place.</div>
      <div class="acts"><button class="btn btn-primary btn-xs" type="button" data-bn="install">Show me how</button><button class="btn btn-quiet btn-xs" type="button" data-bn="install-later">Not now</button></div></div>`;
  }
  function snoozeBanner() {
    lsSet(K_SNOOZE, String(Date.now() + SNOOZE_DAYS * DAY));
    toast('Hidden for 2 weeks. The steps are in Settings → About any time.', 'ok', { ms: 5000 });
  }

  /* ═══ "Show me around" — spotlight tour ══════════════════ */
  const $q = (s) => document.querySelector(s);
  const nav = (p) => $q(`.nav-item[data-page="${p}"]`);
  function visible(el) {
    if (!el || !el.isConnected || el.hidden) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0;
  }
  const firstVisible = (...sel) => sel.map($q).find(visible) || null;
  const verb = () => (touch() ? 'Tap' : 'Click');
  const MAC = /Mac|iPhone|iPad/.test(ok(() => String(navigator.platform || '') + ' ' + String(navigator.userAgent || ''), ''));
  const TOUR = [
    { id: 'new', find: () => $q('#btn-new-trade-top'), title: 'Log a trade',
      text: () => (touch() ? 'Opens the trade form. Just did a DEX swap? <b>Quick log</b> takes the coin, side and price now, the details later. It’s in Search.'
        : 'Opens the trade form. Press <kbd>N</kbd> for it any time, or <kbd>Q</kbd> for <b>Quick log</b>: coin, side and price now, the details later.') },
    { id: 'balance', find: () => $q('#balance-pill'), title: 'Your balance',
      text: () => `The balance of the account you’re in. ${verb()} it to set it to what your exchange or wallet shows.` },
    { id: 'mode', find: () => firstVisible('#mode-switch', '#mode-pill'), title: 'Paper or Live',
      text: () => (visible($q('#mode-switch')) ? 'Switch between Paper and Live here. They’re separate accounts, so practice never mixes with real money.'
        : 'Shows which account you’re in. Paper and Live are separate, so practice never mixes with real money. Switch in <b>Settings → Account</b>.') },
    { id: 'search', find: () => $q('#btn-cmdk'), title: 'Search',
      text: () => (touch() ? 'Find any trade, page or command. <b>Quick log</b> and <b>Close a position</b> are in here too.'
        : `Find any trade, page or command. Press <kbd>${MAC ? '⌘' : 'Ctrl'}</kbd> <kbd>K</kbd> from anywhere.`) },
    // the badge shows only while trades wait for a review, and never in the phone's tab bar
    { id: 'journal', find: () => nav('journal'), title: 'Journal',
      text: () => 'Plan the day before you trade, and close it after.' + (visible($q('#nav-journal-badge')) ? ' The badge counts closed trades waiting for a review.' : '') },
    { id: 'analytics', find: () => nav('analytics'), title: 'Analytics', text: () => 'What works, what doesn’t, and where your biggest leaks are.' },
    { id: 'readiness', find: () => nav('readiness'), title: 'Readiness', text: () => 'A checklist that tells you when your paper results support going live.' },
    { id: 'settings', find: () => nav('settings'), title: 'Settings', text: () => 'Risk rules, backups and sync. Replay the <b>Welcome tour</b> or this one (<b>Show me around</b>) from <b>Settings → About</b>.' },
    { id: 'sync', find: () => $q('.sy-chip'), title: 'Cloud sync',
      text: () => `Shows whether your journal is synced. ${verb()} it to sign in with the same email on your iPhone and PC, and both share one journal.` },
  ];

  let T = null;   // the running tour
  function tour() {
    if (T) return;
    if (introH && introH.m.el.isConnected) introH.m.close();   // the welcome gives way to the tour
    if (layerOpen()) { toast('Close this dialog first, then start the tour', 'warn'); return; }
    const steps = TOUR.filter(s => visible(s.find()));
    if (!steps.length) return;
    const layer = document.createElement('div');
    layer.className = 'it-tour';
    const tid = nid('tt'), xid = nid('tx');
    layer.innerHTML = `<div class="it-shade"></div><div class="it-hole" aria-hidden="true"></div>
      <div class="it-tip" role="dialog" aria-modal="true" aria-labelledby="${tid}" aria-describedby="${xid}">
        <div class="it-tip-in">
          <div class="it-tip-top"><span class="it-tip-n" data-t="n"></span><button type="button" class="btn btn-quiet btn-xs it-tip-skip" data-t="skip">Skip tour</button></div>
          <h3 class="it-tip-t" id="${tid}"></h3>
          <p class="it-tip-x" id="${xid}"></p>
          <div class="it-tip-f"><button type="button" class="btn btn-ghost btn-sm" data-t="back">Back</button><button type="button" class="btn btn-primary btn-sm" data-t="next">Next</button></div>
        </div><span class="it-arrow" aria-hidden="true"></span>
      </div>
      <div class="sr-only" aria-live="polite" data-t="live"></div>`;
    document.body.appendChild(layer);
    const q = (k) => layer.querySelector(`[data-t="${k}"]`);
    T = { steps, i: 0, layer, ret: document.activeElement, hole: layer.querySelector('.it-hole'), tip: layer.querySelector('.it-tip'), inner: layer.querySelector('.it-tip-in'), arrow: layer.querySelector('.it-arrow'), q, raf: 0, last: '' };
    q('skip').onclick = () => end('skip');
    q('back').onclick = () => go(-1);
    q('next').onclick = () => go(1);
    // the dimmed page takes no clicks and keeps focus where it is (the Done click itself ends the tour, so T may be gone)
    const tipEl = T.tip;
    layer.addEventListener('mousedown', (ev) => { if (!tipEl.contains(ev.target)) ev.preventDefault(); });
    layer.addEventListener('click', (ev) => { if (!tipEl.contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); } });
    // Capture phase on window: before the palette's and core's own keys — and no page shortcut fires behind the tour
    T.onKey = (ev) => {
      if (!T) return;
      const k = ev.key;
      if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end('skip'); return; }
      if ((k === 'ArrowRight' || k === 'ArrowLeft') && !ev.altKey && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); ev.stopPropagation(); go(k === 'ArrowRight' ? 1 : -1); return; }
      if (k === 'Tab') { trapTab(T.tip, ev); ev.stopPropagation(); return; }
      ev.stopPropagation();   // Enter / Space still press the focused tour button (their default action runs)
    };
    T.onFocus = (ev) => { if (T && !T.tip.contains(ev.target)) q('next').focus({ preventScroll: true }); };
    T.onMove = () => { if (T && !T.raf) T.raf = requestAnimationFrame(() => { if (!T) return; T.raf = 0; refit(); }); };
    window.addEventListener('keydown', T.onKey, true);
    document.addEventListener('focusin', T.onFocus);
    window.addEventListener('resize', T.onMove);
    window.addEventListener('scroll', T.onMove, true);
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', T.onMove); vv.addEventListener('scroll', T.onMove); }
    // a control can move without a resize (the sync chip changes width, the ticker fills in)
    T.timer = setInterval(() => { if (T) place(); }, 400);
    // another dialog or drawer opened (a sync prompt, a cross-window update…): it must not sit under the tour
    T.mo = new MutationObserver(() => { if (T && document.querySelector('.modal-backdrop.open, .drawer-wrap')) end('layer'); });
    T.mo.observe(document.body, { childList: true });
    step(0);
  }
  function go(d) {
    if (!T) return;
    const j = T.i + d;
    if (j >= T.steps.length) { end('done'); return; }
    if (j >= 0) step(j);
  }
  // The visible targets after a resize (phone ↔ desktop layouts show different controls); the current one is kept
  function refit() {
    if (!T) return;
    const cur = T.steps[T.i] ? T.steps[T.i].id : null;
    const steps = TOUR.filter(s => visible(s.find()));
    if (!steps.length) { end('layer'); return; }
    const order = TOUR.map(s => s.id);
    let i = steps.findIndex(s => s.id === cur);
    if (i < 0) { i = steps.findIndex(s => order.indexOf(s.id) > order.indexOf(cur)); if (i < 0) i = steps.length - 1; }
    const changed = steps.length !== T.steps.length || steps[i].id !== cur;
    T.steps = steps;
    if (changed) step(i);
    // same step, new words: phones point at the PAPER label instead of the switch, and the badge hides
    else if (steps[i].text() !== T.text) step(i, true);
    else place();
  }
  // refresh: the same step again with its words as they are now — focus and scroll stay where they are
  function step(i, refresh) {
    if (!T) return;
    T.i = i;
    const s = T.steps[i], el = s.find(), n = T.steps.length, text = s.text();
    T.text = text;
    T.q('n').textContent = `${i + 1} of ${n}`;
    T.tip.querySelector('.it-tip-t').textContent = s.title;
    T.tip.querySelector('.it-tip-x').innerHTML = text;
    T.q('back').hidden = i === 0;
    T.q('next').textContent = i === n - 1 ? 'Done' : 'Next';
    T.q('live').textContent = `Step ${i + 1} of ${n}. ${s.title}. ${T.tip.querySelector('.it-tip-x').textContent}`;
    // a sidebar item can be scrolled out of a short window
    try { if (el && !refresh) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* old browsers */ }
    T.last = '';
    place();
    if (!refresh) T.q('next').focus({ preventScroll: true });
  }
  // Spotlight + tooltip next to the target, flipped above/below as room allows and clamped to the viewport
  function place() {
    if (!T) return;
    const s = T.steps[T.i], el = s && s.find();
    if (!visible(el)) { refit(); return; }
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const r = el.getBoundingClientRect(), P = 6, M = 10, GAP = 12;
    const key = [r.left, r.top, r.width, r.height, vw, vh, T.i].map(Math.round).join(',');
    if (key === T.last) return;
    T.last = key;
    const hx = Math.max(2, r.left - P), hy = Math.max(2, r.top - P);
    const hw = Math.max(8, Math.min(vw - 2, r.right + P) - hx), hh = Math.max(8, Math.min(vh - 2, r.bottom + P) - hy);
    const rad = Math.min(hh / 2, (parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8) + P);
    Object.assign(T.hole.style, { left: hx + 'px', top: hy + 'px', width: hw + 'px', height: hh + 'px', borderRadius: rad + 'px' });
    T.inner.style.maxHeight = Math.max(120, vh - 2 * M) + 'px';
    const tw = T.tip.offsetWidth, th = T.tip.offsetHeight;
    const below = hy + hh + GAP, above = hy - GAP - th;
    let side = 'below', y = below;
    if (below + th > vh - M) {
      if (above >= M) { side = 'above'; y = above; }
      else { side = 'over'; y = Math.max(M, Math.min(vh - M - th, vh - (hy + hh) >= hy ? below : above)); }
    }
    const x = Math.max(M, Math.min(vw - M - tw, r.left + r.width / 2 - tw / 2));
    T.tip.dataset.side = side;
    T.tip.style.left = Math.round(x) + 'px';
    T.tip.style.top = Math.round(y) + 'px';
    T.arrow.style.left = Math.round(Math.max(16, Math.min(tw - 16, r.left + r.width / 2 - x))) + 'px';
  }
  // why: 'done' · 'skip' · 'layer' (another dialog took over) · 'replaced' (the welcome or guide opened)
  function end(why) {
    if (!T) return;
    const t = T;
    T = null;
    window.removeEventListener('keydown', t.onKey, true);
    document.removeEventListener('focusin', t.onFocus);
    window.removeEventListener('resize', t.onMove);
    window.removeEventListener('scroll', t.onMove, true);
    const vv = window.visualViewport;
    if (vv) { vv.removeEventListener('resize', t.onMove); vv.removeEventListener('scroll', t.onMove); }
    clearInterval(t.timer);
    if (t.raf) cancelAnimationFrame(t.raf);
    t.mo.disconnect();
    t.layer.remove();
    lsSet(K_TOUR, DONE);
    if (why === 'layer' || why === 'replaced') return;   // the new layer keeps focus
    if (typeof focusBack === 'function') ok(() => focusBack(t.ret));
    toast(`${why === 'done' ? 'That’s the tour.' : 'Tour closed.'} Replay it any time: Settings → About → Show me around.`, 'ok', { ms: 4000 });
  }

  return {
    maybeStart, open, tour, install, bannerHtml, snoozeBanner, context, _detect,
    get tourOpen() { return !!T; },
  };
})();
