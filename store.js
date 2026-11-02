/* ═══════════════════════════════════════════════════════════
   CryptoJournal — local storage services (IndexedDB 'cryptojournal')
     media      screenshots as Blobs (never in localStorage)
     snapshots  rolling copies of the whole journal (newest 20)
     kv         the backup-folder directory handle
   Plus JSON export/import, the File System Access backup folder,
   backup age and the persistent-storage request.
   If IndexedDB is unavailable (private window, blocked site data)
   Store.ready still resolves: media/snapshot calls then reject with
   a clear message and the journal itself keeps working.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Store = (() => {
  const NAME = 'cryptojournal', VER = 1, KEEP = 20, MAX_W = 1920, DAY = 86400000;
  const LAST_SNAP = 'cj.lastSnap';
  const MODE_NAMES = { paper: 'Paper', live: 'Live', demo: 'Demo' };
  let idb = null, err = null, booted = false;
  const urls = new Map(), pendingUrls = new Map();   // media id → object URL (cached until deleted)

  const isO = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const friendly = (e) => {
    const n = e && e.name;
    if (n === 'QuotaExceededError') return 'browser storage is full — remove old screenshots or snapshots';
    if (n === 'NotFoundError') return 'the folder or file no longer exists';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'the browser did not allow access';
    return (e && e.message) || String(e || 'unknown error');
  };
  const emit = (evt, data) => { if (typeof Bus !== 'undefined') Bus.emit(evt, data); };
  const openData = () => { if (typeof Settings !== 'undefined' && Settings.show) Settings.show('data'); };

  /* ── Open the database (never rejects) ─────────────────── */
  const ready = new Promise((resolve) => {
    let done = false;
    // A late success (after the timeout) is still adopted, so a slow disk doesn't disable media for the
    // session — and the start-up bookkeeping (pending snapshots) still runs.
    const finish = (d, e) => {
      if (d) { idb = d; err = null; } else if (!idb) err = e;
      if (!done) { done = true; resolve(!!d); } else if (d) boot();
    };
    if (typeof indexedDB === 'undefined' || !indexedDB) { finish(null, 'This browser has no IndexedDB, so screenshots and snapshots are unavailable.'); return; }
    let req;
    try { req = indexedDB.open(NAME, VER); } catch (e) { finish(null, `IndexedDB is blocked here (${friendly(e)}). Screenshots and snapshots are unavailable.`); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' }).createIndex('tradeId', 'tradeId');
      if (!d.objectStoreNames.contains('snapshots')) d.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('at', 'at');
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const d = req.result;
      // Another tab upgrading the schema: step aside instead of blocking it
      d.onversionchange = () => { try { d.close(); } catch (e) { /* ok */ } if (idb === d) { idb = null; err = 'The local database was closed by another tab — reload to reconnect.'; } };
      finish(d);
    };
    req.onerror = () => finish(null, `Could not open the local database (${friendly(req.error)}).`);
    req.onblocked = () => { /* an older tab holds the db open — wait for it (timeout below) */ };
    setTimeout(() => finish(null, 'The local database did not open in time — reload the page to retry.'), 6000);
  });
  const unavailable = () => new Error(err || 'The local database is unavailable.');

  // One request in its own transaction; resolves with the request's result once the transaction commits.
  function run(store, mode, fn) {
    return ready.then(() => new Promise((resolve, reject) => {
      if (!idb) { reject(unavailable()); return; }
      let t;
      try { t = idb.transaction(store, mode); } catch (e) { reject(new Error(friendly(e))); return; }
      let out;
      const r = fn(t.objectStore(store));
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onabort = t.onerror = () => reject(new Error(friendly(t.error)));
    }));
  }

  /* ── Media (screenshots) ───────────────────────────────── */
  let webpOk = null;
  const canWebp = () => {
    if (webpOk == null) { try { const c = document.createElement('canvas'); c.width = c.height = 1; webpOk = c.toDataURL('image/webp').indexOf('data:image/webp') === 0; } catch (e) { webpOk = false; } }
    return webpOk;
  };
  function loadBitmap(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const u = URL.createObjectURL(blob), img = new Image();
      img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('Not a readable image')); };
      img.src = u;
    });
  }
  const toBlob = (cv, type, q) => new Promise((res) => { try { cv.toBlob(b => res(b), type, q); } catch (e) { res(null); } });
  // 4K screenshots are downscaled to 1920px wide (WebP, else JPEG); smaller images keep their original file.
  async function shrink(blob) {
    if (!/^image\/(png|jpeg|webp|bmp)$/i.test(blob.type || '')) return { blob };
    const img = await loadBitmap(blob);
    const w = img.width, h = img.height;
    if (!(w > MAX_W)) { if (typeof img.close === 'function') img.close(); return { blob, w, h }; }
    const cw = MAX_W, ch = Math.max(1, Math.round(h * MAX_W / w));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    const webp = canWebp();
    if (!webp) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch); }   // JPEG has no alpha
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);
    if (typeof img.close === 'function') img.close();
    const out = await toBlob(cv, webp ? 'image/webp' : 'image/jpeg', 0.86);
    return out && out.size < blob.size ? { blob: out, w: cw, h: ch } : { blob, w, h };
  }
  // meta: { tradeId, kind 'before'|'after'|'other', name }
  async function putMedia(blob, meta) {
    if (!(blob instanceof Blob)) throw new Error('Not an image file');
    await ready;
    if (!idb) throw unavailable();
    meta = meta || {};
    let s = { blob };
    try { s = await shrink(blob); } catch (e) { s = { blob }; }
    const rec = {
      id: rid('m'), blob: s.blob, type: s.blob.type || blob.type || 'application/octet-stream', size: s.blob.size,
      tradeId: meta.tradeId || null, kind: meta.kind || 'other', at: new Date().toISOString(),
      name: String(meta.name || blob.name || '').slice(0, 120), w: s.w || null, h: s.h || null, origSize: blob.size,
    };
    await run('media', 'readwrite', st => st.put(rec));
    // Cloud sync (sync.js) uploads it once a paper/live trade references it — never blocks the save
    if (hasSync() && typeof Sync.queueMedia === 'function') { try { Sync.queueMedia(rec.id); } catch (e) { /* sync is optional */ } }
    return rec.id;
  }
  function mediaURL(id) {
    if (!id) return Promise.resolve(null);
    if (urls.has(id)) return Promise.resolve(urls.get(id));
    if (pendingUrls.has(id)) return pendingUrls.get(id);
    const p = run('media', 'readonly', st => st.get(id)).catch(() => null).then(async (rec) => {
      // Not on this device: a screenshot of a trade synced from the other device lives in the cloud
      const blob = rec && rec.blob ? rec.blob : await fromCloud(id);
      if (!blob) return null;
      const u = URL.createObjectURL(blob); urls.set(id, u); return u;
    }).catch(() => null).finally(() => pendingUrls.delete(id));
    pendingUrls.set(id, p);
    return p;
  }
  // try: while sync.js itself is still loading, its const is in the temporal dead zone
  const hasSync = () => { try { return typeof Sync !== 'undefined' && !!Sync; } catch (e) { return false; } };
  // Download once and keep it under the SAME id, so the entry's reference works offline from now on.
  // A failed local write (quota, no IndexedDB) still shows the picture this time.
  async function fromCloud(id) {
    if (!hasSync() || !Sync.user || typeof Sync.fetchMedia !== 'function') return null;
    let blob = null;
    try { blob = await Sync.fetchMedia(id); } catch (e) { return null; }
    if (!(blob instanceof Blob) || !blob.size) return null;
    if (idb) {
      const rec = { id, blob, type: blob.type || 'application/octet-stream', size: blob.size, tradeId: null, kind: 'other', at: new Date().toISOString(), name: '', w: null, h: null, origSize: blob.size };
      try { await run('media', 'readwrite', st => st.put(rec)); } catch (e) { /* shown once, fetched again next time */ }
    }
    return blob;
  }
  async function deleteMedia(id) {
    if (!id) return false;
    const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); }
    await run('media', 'readwrite', st => st.delete(id));
    // Best effort: the cloud copy goes too (queued while offline)
    if (hasSync() && typeof Sync.deleteMedia === 'function') { try { Promise.resolve(Sync.deleteMedia(id)).catch(() => {}); } catch (e) { /* optional */ } }
    return true;
  }
  async function getMedia(id) { try { return (await run('media', 'readonly', st => st.get(id))) || null; } catch (e) { return null; } }
  async function listMedia() {
    try { const all = (await run('media', 'readonly', st => st.getAll())) || []; return all.map(({ blob, ...m }) => ({ ...m, size: m.size || (blob && blob.size) || 0 })); }
    catch (e) { return []; }
  }
  // Media no entry (in any mode, trash included) points to. Fresh files (< 1h) are skipped: an open trade form may hold them.
  function mediaRefs() {
    const ids = new Set();
    for (const m of MODES) for (const e of (db.accounts[m].entries || [])) for (const s of (Array.isArray(e.shots) ? e.shots : [])) if (s && s.id) ids.add(s.id);
    return ids;
  }
  async function unusedMedia() {
    const refs = mediaRefs(), cutoff = Date.now() - 3600000;
    return (await listMedia()).filter(m => !refs.has(m.id) && !(Date.parse(m.at) > cutoff));
  }

  /* ── Snapshots (rolling, newest KEEP) ──────────────────── */
  function countsOf(obj) {
    const c = {};
    for (const m of MODES) {
      const a = isO(obj) && isO(obj.accounts) ? obj.accounts[m] : null;
      c[m] = a && Array.isArray(a.entries) ? a.entries.filter(e => isO(e) && e.type === 'trade' && !e.deletedAt).length : 0;
    }
    return c;
  }
  // Raw text core.js could not parse (kept under cj.corrupt.<ms>, or still in DB_KEY when that copy did not fit)
  const unreadableRaw = () => lsGet(StorageGuard.corruptKey || '') || lsGet(DB_KEY);
  // raw: JSON text (or an object); defaults to the current journal. Resolves with the id (null when nothing to keep).
  async function snapshot(reason, raw) {
    await ready;
    if (!idb) throw unavailable();
    reason = String(reason || 'Manual snapshot');
    // While the saved journal is unreadable, the in-memory db is an empty stand-in. A restore or import is about
    // to overwrite DB_KEY, so keep the unreadable original instead of a copy of nothing.
    if (raw == null && StorageGuard.loadError) {
      raw = unreadableRaw();
      if (!raw) return null;
      reason += ' (unreadable journal, kept as text)';
    }
    let text = raw, obj = null;
    if (typeof text === 'string') { try { obj = JSON.parse(text); } catch (e) { obj = null; } }
    else { obj = isO(raw) ? raw : db; text = JSON.stringify(obj); }
    const rec = {
      id: rid('s'), at: new Date().toISOString(), reason: reason.slice(0, 160),
      size: text.length, raw: text, counts: countsOf(obj), mode: (obj && obj.mode) || null, version: (obj && obj.version) || null,
    };
    await run('snapshots', 'readwrite', st => st.put(rec));
    dropMeta();
    try { await prune(); } catch (e) { /* housekeeping only */ }
    emit('snapshots', { id: rec.id });
    return rec.id;
  }
  // The list without raw text is cached until a snapshot is added/removed. It is read with a cursor
  // (newest first), so only one raw copy is held in memory at a time instead of all 20 at once (getAll()).
  // The generation stops a read that started before a change from caching the old list.
  let metaCache = null, metaGen = 0;
  const dropMeta = () => { metaCache = null; metaGen++; };
  async function allMeta() {
    await ready;
    if (!idb) throw unavailable();
    return new Promise((resolve, reject) => {
      let t;
      try { t = idb.transaction('snapshots', 'readonly'); } catch (e) { reject(new Error(friendly(e))); return; }
      const out = [];
      const req = t.objectStore('snapshots').index('at').openCursor(null, 'prev');
      req.onsuccess = () => {
        const c = req.result; if (!c) return;
        const { raw, ...m } = c.value || {};
        if (!(m.size >= 0)) m.size = typeof raw === 'string' ? raw.length : 0;
        out.push(m);
        c.continue();
      };
      t.oncomplete = () => resolve(out);
      t.onabort = t.onerror = () => reject(new Error(friendly(t.error)));
    });
  }
  // Walks the 'at' index newest-first reading keys only, so pruning never loads every raw copy into memory.
  async function prune() {
    await ready;
    if (!idb) return 0;
    const n = await new Promise((resolve, reject) => {
      let t;
      try { t = idb.transaction('snapshots', 'readwrite'); } catch (e) { reject(new Error(friendly(e))); return; }
      const st = t.objectStore('snapshots');
      let seen = 0, gone = 0;
      const req = st.index('at').openKeyCursor(null, 'prev');
      req.onsuccess = () => {
        const c = req.result; if (!c) return;
        if (++seen > KEEP) { st.delete(c.primaryKey); gone++; }
        c.continue();
      };
      t.oncomplete = () => resolve(gone);
      t.onabort = t.onerror = () => reject(new Error(friendly(t.error)));
    });
    if (n) dropMeta();
    return n;
  }
  async function listSnapshots() {
    try {
      if (metaCache) return metaCache.slice();
      const g = metaGen, list = await allMeta();
      if (g === metaGen) metaCache = list;
      return list.slice();
    } catch (e) { return []; }
  }
  async function getSnapshot(id) { try { return (await run('snapshots', 'readonly', st => st.get(id))) || null; } catch (e) { return null; } }
  async function deleteSnapshot(id) { await run('snapshots', 'readwrite', st => st.delete(id)); dropMeta(); emit('snapshots', { id }); return true; }
  async function downloadSnapshot(id) {
    const rec = await getSnapshot(id);
    if (!rec) { toast('That snapshot no longer exists', 'err'); return false; }
    download(`cryptojournal-snapshot-${dayOf(rec.at)}-${new Date(rec.at).toTimeString().slice(0, 5).replace(':', '')}.json`, rec.raw, 'application/json');
    return true;
  }
  async function restoreSnapshot(id) {
    const rec = await getSnapshot(id);
    if (!rec) { toast('That snapshot no longer exists', 'err'); return false; }
    let obj = null; try { obj = JSON.parse(rec.raw); } catch (e) { obj = null; }
    if (!isO(obj) || !isO(obj.accounts)) { toast('That snapshot is unreadable', 'err'); return false; }
    // Same gate as an import: a copy that cannot be computed must never replace a working journal
    try { dryRun(obj); } catch (e) { toast('That snapshot could not be loaded: ' + friendly(e), 'err'); return false; }
    const ok = await confirmDialog({
      title: 'Restore this snapshot?', width: 540, confirmText: 'Restore snapshot', danger: true,
      html: `<p>Snapshot from <b>${esc(fmtDateTime(rec.at))}</b> · ${esc(rec.reason)}</p>${summaryHtml(obj)}
        <p class="st-cm-note">${StorageGuard.loadError
          ? 'This copy becomes your journal and saving resumes. The unreadable journal is kept as a snapshot first.'
          : 'Everything in the journal is replaced by this copy. Your current data is snapshotted first, so you can undo this from Settings → Data &amp; backups.'}</p>`,
    });
    if (!ok) return false;
    // false: the user cancelled the safety copy, or the save failed (save() already said why)
    if (!(await replaceDb(obj, 'Before restoring snapshot'))) return false;
    toast('Snapshot restored', 'ok');
    return true;
  }

  /* ── Backup summary (shown before any replace) ─────────── */
  function summaryOf(obj) {
    const out = { modes: {}, from: null, to: null, total: 0 };
    for (const m of MODES) {
      const a = isO(obj) && isO(obj.accounts) ? obj.accounts[m] : null;
      const es = a && Array.isArray(a.entries) ? a.entries.filter(e => isO(e) && !e.deletedAt) : [];
      const trades = es.filter(e => e.type === 'trade');
      out.modes[m] = { trades: trades.length, entries: es.length };
      out.total += trades.length;
      for (const e of trades) {
        const t = Date.parse(e.entryAt);
        if (isFinite(t)) { if (out.from == null || t < out.from) out.from = t; if (out.to == null || t > out.to) out.to = t; }
      }
    }
    return out;
  }
  function summaryHtml(obj, label) {
    const s = summaryOf(obj);
    const rows = MODES.map(m => `<tr><td>${MODE_NAMES[m]}</td><td class="num">${s.modes[m].trades}</td><td class="num">${s.modes[m].entries}</td></tr>`).join('');
    return `<div class="st-sum">${label ? `<div class="st-sum-f"><svg aria-hidden="true"><use href="#i-file-in"/></svg>${esc(label)}</div>` : ''}
      <table class="compact-t st-sum-t"><thead><tr><th scope="col">Account</th><th scope="col" class="num">Trades</th><th scope="col" class="num">All entries</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="st-sum-r">${s.from != null ? `Trades from <b>${esc(fmtDate(s.from))}</b> to <b>${esc(fmtDate(s.to))}</b>` : 'No trades in this copy.'}</div></div>`;
  }

  /* ── JSON export / import ──────────────────────────────── */
  function exportJSON() {
    if (StorageGuard.loadError) { toast('Your saved journal could not be read — use "Download the unreadable copy" in the banner instead', 'warn'); return false; }
    download(`cryptojournal-backup-${todayISO()}.json`, JSON.stringify(db, null, 2), 'application/json');
    S().backup.lastExportAt = new Date().toISOString();
    save();
    emit('backup', { kind: 'export' });
    toast('Backup downloaded — keep a copy off this computer (OneDrive, USB stick)', 'ok', { ms: 4500 });
    return true;
  }
  async function importJSON(file) {
    if (!file) return false;
    if (file.size > 60 * 1048576) { toast('That file is too large to be a journal backup', 'err'); return false; }
    let text;
    try { text = await file.text(); } catch (e) { toast('Could not read that file', 'err'); return false; }
    return importText(text, file.name);
  }
  // Dry run: a copy must sanitise and compute before it may replace anything (v1 behaviour). Throws on failure.
  function dryRun(obj) {
    const t = sanitize(migrate(clone(obj)));
    for (const m of MODES) Engine.compute(t.accounts[m], { beBandR: t.settings.beBandR || 0 });
  }
  async function importText(text, label) {
    let obj;
    try { obj = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { toast('That file is not valid JSON — is it a CryptoJournal backup?', 'err'); return false; }
    if (!isO(obj) || !isO(obj.accounts)) { toast("That file doesn't look like a CryptoJournal backup (no accounts inside)", 'err'); return false; }
    try { dryRun(obj); } catch (e) { toast('That backup could not be loaded: ' + friendly(e), 'err'); return false; }
    const cur = summaryOf(db), bad = !!StorageGuard.loadError;
    // Without IndexedDB replaceDb() cannot snapshot first, so the current journal is downloaded instead —
    // and an unreadable original that only lives in DB_KEY (its quarantine copy did not fit) leaves as a file too
    const noSnap = !idb && !bad && !isEmpty();
    const rawOnly = !idb && bad && !lsGet(StorageGuard.corruptKey || '') ? lsGet(DB_KEY) : null;
    const note = bad
      ? `Your saved journal could not be read. ${idb ? 'Its unreadable text is kept as a snapshot first' : rawOnly ? 'Its unreadable text is <b>downloaded first</b>: keep that file' : 'Its unreadable text stays in this browser (Settings → Data &amp; backups → Where your data lives)'}, then this backup becomes your journal and saving resumes.`
      : `Your current journal (<b>${cur.total}</b> trade${cur.total === 1 ? '' : 's'}) is replaced. ${noSnap
        ? 'Snapshots are unavailable in this browser, so a copy of your current journal is <b>downloaded first</b>: keep that file until you are sure.'
        : 'A snapshot of it is taken first, so you can undo this from Settings → Data &amp; backups → Snapshots.'}`;
    const ok = await confirmDialog({
      title: 'Replace all data with this backup?', width: 540, confirmText: 'Replace my data', danger: true,
      html: `${summaryHtml(obj, label)}<p class="st-cm-note">${note}</p>`,
    });
    if (!ok) return false;
    if (noSnap) download(`cryptojournal-before-import-${todayISO()}.json`, JSON.stringify(db, null, 2), 'application/json');
    if (rawOnly) download(`cryptojournal-unreadable-${todayISO()}.json`, rawOnly, 'application/json');
    if (!(await replaceDb(obj, 'Before importing backup'))) return false;
    toast('Backup restored', 'ok');
    return true;
  }

  /* ── Backup folder (File System Access API, Chromium) ──── */
  const folder = (() => {
    const supported = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
    let handle = null, loaded = false, busy = false, warned = false, failWarned = false;
    async function getHandle() {
      if (loaded) return handle;
      try { handle = (await run('kv', 'readonly', st => st.get('backupDir'))) || null; } catch (e) { handle = null; }
      loaded = true;
      return handle;
    }
    // 'granted' | 'prompt' | 'denied'. Asking needs a user click (transient activation).
    async function perm(h, ask) {
      try {
        let p = await h.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'readwrite' });
        return p;
      } catch (e) { return 'denied'; }
    }
    async function connect() {
      if (!supported) { toast('This browser cannot connect a folder — use Export JSON instead', 'warn'); return false; }
      let h;
      try { h = await window.showDirectoryPicker({ id: 'cj-backup', mode: 'readwrite', startIn: 'documents' }); }
      catch (e) { if (!e || e.name !== 'AbortError') toast('Could not use that folder: ' + friendly(e), 'err'); return false; }
      handle = h; loaded = true;
      try { await run('kv', 'readwrite', st => st.put(h, 'backupDir')); }
      catch (e) { toast('Connected for this session only — the browser could not remember the folder', 'warn'); }
      const b = S().backup; b.folderName = h.name; b.autoFolder = true;
      save();
      const r = await write({ ask: true });
      if (r.ok) toast(`Backup folder connected — wrote ${r.name}`, 'ok', { ms: 4500 });
      else toast('Folder connected, but the first backup failed: ' + r.reason, 'warn');
      emit('backup', { kind: 'folder' });
      return true;
    }
    async function status() {
      const name = S().backup.folderName || '';
      if (!supported) return { supported: false, connected: false, name, permission: null };
      const h = await getHandle();
      if (!h) return { supported: true, connected: false, name, permission: null };
      return { supported: true, connected: true, name: h.name || name, permission: await perm(h, false) };
    }
    async function reallow() { const h = await getHandle(); if (!h) return false; const ok = (await perm(h, true)) === 'granted'; if (ok) emit('backup', { kind: 'folder' }); return ok; }
    // Writes cryptojournal-YYYY-MM-DD.json (same day overwrites; createWritable swaps the file in atomically)
    async function write(o) {
      o = o || {};
      if (StorageGuard.loadError) return { ok: false, reason: 'your saved journal could not be read, so nothing was written (the folder keeps your last good copy)' };
      const h = await getHandle();
      if (!h) return { ok: false, reason: 'no backup folder is connected' };
      if ((await perm(h, !!o.ask)) !== 'granted') return { ok: false, reason: 'the browser needs your permission again', needsPermission: true };
      if (busy) return { ok: false, reason: 'a backup is already being written', busy: true };
      busy = true;
      const name = `cryptojournal-${todayISO()}.json`;
      try {
        const fh = await h.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        try { await w.write(JSON.stringify(db, null, 2)); await w.close(); }
        catch (e) { try { await w.abort(); } catch (x) { /* ignore */ } throw e; }
        S().backup.lastFolderAt = new Date().toISOString();
        warned = failWarned = false;   // working again: a later failure is worth a new warning
        save();
        emit('backup', { kind: 'folder', name });
        return { ok: true, name };
      } catch (e) { return { ok: false, reason: friendly(e) }; }
      finally { busy = false; }
    }
    async function disconnect() {
      handle = null; loaded = true;
      try { await run('kv', 'readwrite', st => st.delete('backupDir')); } catch (e) { /* nothing stored */ }
      const b = S().backup; b.folderName = ''; b.autoFolder = false;
      save();
      emit('backup', { kind: 'folder' });
      return true;
    }
    // Newest backup files in the folder (needs permission already granted)
    async function list(limit) {
      const h = await getHandle();
      if (!h || (await perm(h, false)) !== 'granted') return [];
      const max = limit || 10, found = [], out = [];
      try {
        for await (const [name, fh] of h.entries()) if (fh.kind === 'file' && /^cryptojournal.*\.json$/i.test(name)) found.push([name, fh]);
      } catch (e) { return []; }
      // Dated names sort newest-first as text, so only the newest few files need opening (a year of backups = 365 files)
      found.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
      for (const [name, fh] of found.slice(0, max * 2)) {
        try { const f = await fh.getFile(); out.push({ name, size: f.size, at: f.lastModified }); } catch (e) { /* unreadable — skip */ }
      }
      return out.sort((a, b) => b.at - a.at).slice(0, max);
    }
    async function restore(name) {
      const h = await getHandle(); if (!h) return false;
      if ((await perm(h, true)) !== 'granted') { toast('Allow access to the backup folder first', 'warn'); return false; }
      try { const f = await (await h.getFileHandle(name)).getFile(); return importText(await f.text(), name); }
      catch (e) { toast(`Could not read ${name}: ${friendly(e)}`, 'err'); return false; }
    }
    // After a save: at most once per calendar day, only with permission already granted, never an empty journal.
    // A backup that silently stops is the worst failure, so each kind of problem is reported once per session.
    const auto = debounce(async () => {
      const b = S().backup;
      if (!supported || !b.autoFolder || StorageGuard.loadError || isEmpty()) return;
      if (b.lastFolderAt && dayOf(b.lastFolderAt) === todayISO()) return;
      const r = await write({ ask: false });
      if (r.ok || r.busy) return;
      if (r.needsPermission) {
        if (warned) return;
        warned = true;
        // The toast button is a user click, so the permission prompt is allowed to appear
        toast('Automatic folder backup is paused — the browser needs your OK again', 'warn', { ms: 9000, action: { label: 'Re-allow', run: () => { reallow().then(ok => { if (ok) write({}); }); } } });
        return;
      }
      if (failWarned) return;
      failWarned = true;
      toast(`Automatic folder backup failed: ${r.reason}`, 'warn', { ms: 9000, action: { label: 'Open backups', run: openData } });
    }, 3000);
    return { supported, connect, status, reallow, write, disconnect, list, restore, auto, get busy() { return busy; } };
  })();

  /* ── Backup age & persistence ──────────────────────────── */
  function backupAgeDays() {
    const b = S().backup || {};
    const ts = [b.lastExportAt, b.lastFolderAt].map(x => Date.parse(x)).filter(isFinite);
    return ts.length ? Math.max(0, (Date.now() - Math.max(...ts)) / DAY) : null;
  }
  // Call from a click: browsers grant persistence more readily after a user gesture.
  async function persist() {
    const st = navigator.storage;
    if (!st || typeof st.persist !== 'function') return false;
    try { if (typeof st.persisted === 'function' && await st.persisted()) return true; return !!(await st.persist()); } catch (e) { return false; }
  }
  async function persisted() {
    try { return navigator.storage && typeof navigator.storage.persisted === 'function' ? await navigator.storage.persisted() : null; } catch (e) { return null; }
  }
  async function usage() {
    const out = { mediaCount: 0, mediaBytes: 0, snapshotCount: 0, snapshotBytes: 0, localStorageBytes: 0, usage: null, quota: null, persisted: null };
    try { out.localStorageBytes = JSON.stringify(db).length; } catch (e) { /* ok */ }
    await ready;
    out.available = !!idb; out.error = idb ? null : err;
    if (idb) {
      const m = await listMedia(); out.mediaCount = m.length; out.mediaBytes = m.reduce((s, x) => s + (x.size || 0), 0);
      const s = await listSnapshots(); out.snapshotCount = s.length; out.snapshotBytes = s.reduce((a, x) => a + (x.size || 0), 0);
    }
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage; out.quota = e.quota; } } catch (e) { /* ok */ }
    out.persisted = await persisted();
    return out;
  }
  const isEmpty = () => MODES.every(m => !(db.accounts[m].entries || []).length);

  /* ── Bookkeeping: pending snapshots, daily snapshot, auto folder ── */
  // The day is also kept in memory: if localStorage refuses the marker (full), every save would snapshot again
  let snapBusy = false, snapDay = null;
  function dailySnapshot() {
    if (StorageGuard.loadError || snapBusy || !idb) return;
    const today = todayISO();
    if (snapDay === today || lsGet(LAST_SNAP) === today) return;
    snapBusy = true;
    snapshot('Daily automatic snapshot').then(() => { snapDay = today; lsSet(LAST_SNAP, today); }).catch(e => console.warn('[Store] daily snapshot', e)).finally(() => { snapBusy = false; });
  }
  if (typeof Bus !== 'undefined') Bus.on('saved', () => { dailySnapshot(); folder.auto(); });

  // An empty journal with backups available (cleared site data, new port, other browser profile) → offer a restore.
  // Only paper/live count (demo is sample data), and each backup is offered once: after a deliberate wipe the
  // user is not asked again on every launch.
  const OFFERED = 'cj.restoreOffered';
  const realEmpty = () => ['paper', 'live'].every(m => !(db.accounts[m].entries || []).length);
  async function offerRestore() {
    if (StorageGuard.loadError || !realEmpty()) return;
    const snap = (await listSnapshots()).find(s => s.counts && (s.counts.paper > 0 || s.counts.live > 0));
    if (snap) {
      if (lsGet(OFFERED) === snap.id) return;
      lsSet(OFFERED, snap.id);
      toast(`Your journal is empty, but a snapshot from ${fmtDateShort(snap.at)} has trades`, 'warn', { ms: 15000, action: { label: 'Restore it', run: () => restoreSnapshot(snap.id) } });
      return;
    }
    const st = await folder.status();
    const key = 'folder:' + (S().backup.lastFolderAt || st.name || '');
    if (st.connected && lsGet(OFFERED) !== key) {
      lsSet(OFFERED, key);
      toast('Your journal is empty, but your backup folder may hold copies', 'warn', { ms: 15000, action: { label: 'Open backups', run: openData } });
    }
  }
  // Once the database is open: store the snapshots core.js queued while loading (before an upgrade or
  // a trash purge), then look for an empty journal that a backup could fill, and run the folder backup.
  async function boot() {
    if (booted || !idb) return;
    booted = true;
    const pend = StorageGuard.pendingSnapshots.splice(0);
    for (const p of pend) { try { await snapshot(p.reason, p.raw); } catch (e) { console.warn('[Store] pending snapshot', e); } }
    setTimeout(() => { offerRestore().catch(() => {}); folder.auto(); }, 1500);
  }
  ready.then((ok) => { if (ok) boot(); });

  return {
    ready, KEEP,
    get available() { return !!idb; },
    get error() { return idb ? null : err; },
    putMedia, mediaURL, deleteMedia, getMedia, listMedia, unusedMedia,
    snapshot, listSnapshots, getSnapshot, restoreSnapshot, deleteSnapshot, downloadSnapshot,
    exportJSON, importJSON, importText, summaryHtml,
    folder, backupAgeDays, persist, persisted, usage,
  };
})();
