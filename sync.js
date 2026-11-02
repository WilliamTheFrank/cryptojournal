/* ═══════════════════════════════════════════════════════════
   CryptoJournal — cloud sync engine (iPhone ↔ PC) · global Sync
   Local-first: each device keeps its whole journal in localStorage
   exactly as before and never waits for the network. The db is
   mapped to small documents (one per trade, day, review, …); the
   ones that changed are found by hashing, pushed to Supabase
   (public.cj_docs) and the other device's changes are pulled.
   Conflicts resolve per document — newest edit wins (client_ts),
   enforced by a server trigger. Only fetch + WebSocket are used:
   GoTrue auth, PostgREST, Storage and Realtime (Phoenix protocol).
   Design: docs/sync-design.md. The visible UI (topbar chip,
   Settings → Sync & devices) belongs to sync-ui.js (SyncUI); a
   small built-in UI stands in when that module is not loaded.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Sync = (() => {
  /* ── Config & constants ─────────────────────────────────── */
  const CFG = typeof CJ_CONFIG !== 'undefined' && CJ_CONFIG ? CJ_CONFIG : {};
  const BASE = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = String(CFG.supabaseKey || '');
  const BUCKET = String(CFG.mediaBucket || 'cj-media');
  const enabled = /^https?:\/\/[\w.:-]+$/.test(BASE) && KEY.length > 10;
  const SKEY = 'cj.sync', AKEY = 'cj.auth', MQ = 'cj.sync.mq', MQD = 'cj.sync.mqd', GEN = 'cj.sync.gen', EDIT = 'cj.sync.edit';
  // Timings (ms) and request sizes — tests may change them through Sync._core.T
  // (timeout = until the reply's headers; body = until its body has arrived)
  const T = { debounce: 400, rtDebounce: 250, poll: 30000, safety: 300000, overlap: 60000, heartbeat: 25000, timeout: 20000, body: 300000, reconcile: 1800000, early: 60000, page: 1000, batch: 200, ids: 100 };
  const EPOCH = '1970-01-01T00:00:00.000Z';
  // What a device without a journal of its own uploads (its untouched defaults) is dated long before any real edit,
  // so the first real version of that document — from any device, in any order — wins over it
  const UNSET = Date.UTC(2000, 0, 1);
  const SYNC_MODES = ['paper', 'live'];                       // demo is per-device sample data: never synced
  const DEVICE_SETTINGS = ['backup', 'density'];              // settings that stay on each device
  const DEVICE_KEYS = new Set(['version', 'mode', 'prevMode', 'seq', 'migratedFrom', 'coinIds']);
  const MAPPED = new Set(['accounts', 'strategies', 'routine', 'backtest', 'settings', 'mistakes', 'tagGroups', 'days', 'reviews', 'missed', 'overrides', 'readinessHistory', 'importPresets', 'views']);
  const WHOLE = { strategies: ['strategies'], mistakes: ['mistakes'], tagGroups: ['tagGroups'], 'routine:tasks': ['routine', 'tasks'], importPresets: ['importPresets'], views: ['views'] };
  const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/, REV_RE = /^(?:W:\d{4}-\d{2}-\d{2}|M:\d{4}-\d{2})$/, XKEY_RE = /^[A-Za-z_$][\w$]{0,63}$/, MEDIA_RE = /^[\w-]{1,80}$/;

  /* ── Small helpers ──────────────────────────────────────── */
  const isO = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } };
  const lsJson = (k, d) => { try { const v = JSON.parse(lsGet(k)); return v == null ? d : v; } catch (e) { return d; } };
  const okId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128 && !UNSAFE.has(s) && !/[\u0000-\u001f]/.test(s);
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const enc = encodeURIComponent;
  const H = (s) => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const withTimeout = (p, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timed out')), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
  class SyncErr extends Error { constructor(kind, msg, status) { super(msg || kind); this.kind = kind; this.status = status || 0; } }

  /* ── Timestamps ─────────────────────────────────────────── */
  // Own ISO parser: Postgres sends microseconds ("…:56.123456+00:00"), which older Safari's Date.parse rejects
  const TS_RE = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d+))?)?\s*(Z|[+-]\d\d(?::?\d\d)?)?$/i;
  function parseTs(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    const m = TS_RE.exec(String(v == null ? '' : v).trim());
    if (!m) return NaN;
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? +(m[7] + '00').slice(0, 3) : 0);
    const z = m[8];
    if (z && z.toUpperCase() !== 'Z') {
      const o = /^([+-])(\d\d):?(\d\d)?$/.exec(z);
      if (!o) return NaN;
      t -= (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +(o[3] || 0)) * 60000;
    }
    return t;
  }
  const isoOf = (ms) => new Date(ms).toISOString();
  // Larger of two server timestamps, kept as the server's own text (microseconds survive for the next query).
  // Same millisecond: Postgres drops trailing zeros and '+' sorts before digits, so plain text order is right.
  function maxTs(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    const x = parseTs(a), y = parseTs(b);
    if (x !== y) return x > y ? a : b;
    return a < b ? b : a;
  }

  /* ── Stable hashing ─────────────────────────────────────── */
  // Canonical JSON (keys sorted, JSON's rules for undefined/NaN): the same document hashes the same on every
  // device, whatever key order jsonb hands back
  function canon(v) {
    if (v === null || v === undefined) return 'null';
    const t = typeof v;
    if (t === 'number') return isFinite(v) ? JSON.stringify(v) : 'null';
    if (t === 'string') return JSON.stringify(v);
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t !== 'object') return 'null';
    if (typeof v.toJSON === 'function') return canon(v.toJSON());
    if (Array.isArray(v)) {
      let s = '[';
      for (let i = 0; i < v.length; i++) { const x = v[i]; s += (i ? ',' : '') + (x === undefined || typeof x === 'function' || typeof x === 'symbol' ? 'null' : canon(x)); }
      return s + ']';
    }
    let s = '{', first = true;
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      if (x === undefined || typeof x === 'function' || typeof x === 'symbol') continue;
      s += (first ? '' : ',') + JSON.stringify(k) + ':' + canon(x);
      first = false;
    }
    return s + '}';
  }
  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  // 53-bit hash + length, base36
  const hash = (v) => { const s = canon(v); return cyrb53(s).toString(36) + s.length.toString(36); };
  // An override row is identified by what it records (it has no id of its own)
  const ovrKey = (o) => hash({ at: o.at, rule: o.rule, tradeId: o.tradeId, value: o.value, limit: o.limit, reason: o.reason });

  // Deep copy for data from the cloud: JSON values only, never a key Object.prototype has ('__proto__', 'constructor',
  // and 'toString' / 'valueOf', whose shadowing makes Date.parse, String() and the engine throw on that value)
  function safeClone(v, depth) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'object' || (depth || 0) > 100) return undefined;
    const d = (depth || 0) + 1;
    if (Array.isArray(v)) return v.map(x => { const c = safeClone(x, d); return c === undefined ? null : c; });
    const o = {};
    for (const k of Object.keys(v)) { if (k in Object.prototype) continue; const c = safeClone(v[k], d); if (c !== undefined) o[k] = c; }
    return o;
  }

  /* ── Document mapping ───────────────────────────────────── */
  // explode(db) → Map<docId, data>. Values are the live objects (read-only for callers); demo and device-only
  // parts are left out.
  function explode(d) {
    const out = new Map();
    if (!isO(d)) return out;
    const acc = isO(d.accounts) ? d.accounts : {};
    for (const m of SYNC_MODES) {
      const a = acc[m];
      if (isO(a)) {
        out.set('meta:' + m, { startingBalance: a.startingBalance, startDate: a.startDate });
        for (const e of Array.isArray(a.entries) ? a.entries : []) {
          if (!isO(e) || !okId(e.id)) continue;
          const id = 'e:' + m + ':' + e.id;
          if (!out.has(id)) out.set(id, e);
        }
      }
      const days = isO(d.days) && isO(d.days[m]) ? d.days[m] : {};
      for (const k of Object.keys(days)) if (DAY_RE.test(k) && isO(days[k])) out.set('day:' + m + ':' + k, days[k]);
      const revs = isO(d.reviews) && isO(d.reviews[m]) ? d.reviews[m] : {};
      for (const k of Object.keys(revs)) if (REV_RE.test(k) && isO(revs[k])) out.set('rev:' + m + ':' + k, revs[k]);
      for (const x of isO(d.missed) && Array.isArray(d.missed[m]) ? d.missed[m] : []) {
        if (isO(x) && okId(x.id) && !out.has('miss:' + m + ':' + x.id)) out.set('miss:' + m + ':' + x.id, x);
      }
    }
    for (const o of Array.isArray(d.overrides) ? d.overrides : []) {
      if (!isO(o) || !SYNC_MODES.includes(o.mode)) continue;
      const id = 'ovr:' + o.mode + ':' + ovrKey(o);
      if (!out.has(id)) out.set(id, o);
    }
    for (const r of Array.isArray(d.readinessHistory) ? d.readinessHistory : []) {
      if (isO(r) && typeof r.day === 'string' && DAY_RE.test(r.day) && !out.has('rh:' + r.day)) out.set('rh:' + r.day, r);
    }
    for (const id of Object.keys(WHOLE)) { const v = WHOLE[id].reduce((o, k) => (isO(o) ? o[k] : undefined), d); if (Array.isArray(v)) out.set(id, v); }
    const weeks = isO(d.routine) && isO(d.routine.weeks) ? d.routine.weeks : {};
    for (const k of Object.keys(weeks)) if (DAY_RE.test(k) && isO(weeks[k])) out.set('week:' + k, weeks[k]);
    if (isO(d.backtest)) out.set('backtest', d.backtest);
    if (isO(d.settings)) {
      const s = {};
      for (const k of Object.keys(d.settings)) if (!DEVICE_SETTINGS.includes(k) && k !== '__proto__' && d.settings[k] !== undefined) s[k] = d.settings[k];
      out.set('settings', s);
    }
    // Any other top-level key (onboard, readinessSelf, backtestR, routinePrefs, tokenAddrs, future keys). null = absent.
    for (const k of Object.keys(d)) {
      if (DEVICE_KEYS.has(k) || MAPPED.has(k) || UNSAFE.has(k) || !XKEY_RE.test(k) || d[k] == null || typeof d[k] === 'function') continue;
      out.set('x:' + k, d[k]);
    }
    return out;
  }
  // What a doc id means — null for anything this version does not sync (demo, unknown prefixes, unsafe keys)
  function parseId(id) {
    if (typeof id !== 'string' || !id || id.length > 260 || /[\u0000-\u001f]/.test(id)) return null;
    if (WHOLE[id]) return { k: 'whole', key: id };
    if (id === 'backtest' || id === 'settings') return { k: id };
    const i = id.indexOf(':');
    if (i < 0) return null;
    const p = id.slice(0, i), rest = id.slice(i + 1);
    if (p === 'meta') return SYNC_MODES.includes(rest) ? { k: 'meta', m: rest } : null;
    if (p === 'rh' || p === 'week') return DAY_RE.test(rest) ? { k: p, key: rest } : null;
    // (an x: key becomes a property of db itself: 'toString', 'hasOwnProperty' … would shadow Object.prototype)
    if (p === 'x') return XKEY_RE.test(rest) && !UNSAFE.has(rest) && !(rest in Object.prototype) && !DEVICE_KEYS.has(rest) && !MAPPED.has(rest) ? { k: 'x', key: rest } : null;
    if (!['e', 'day', 'rev', 'miss', 'ovr'].includes(p)) return null;
    const j = rest.indexOf(':');
    if (j < 0) return null;
    const m = rest.slice(0, j), key = rest.slice(j + 1);
    if (!SYNC_MODES.includes(m) || !key || UNSAFE.has(key)) return null;
    if (p === 'day' && !DAY_RE.test(key)) return null;
    if (p === 'rev' && !REV_RE.test(key)) return null;
    if ((p === 'e' || p === 'miss') && !okId(key)) return null;
    if (p === 'ovr' && !/^[0-9a-z]{1,40}$/.test(key)) return null;
    return { k: p, m, key };
  }
  // Shape checks for incoming (not deleted) docs; anything else is ignored, never applied
  function validDoc(p, v) {
    if (!p || v === undefined) return false;
    switch (p.k) {
      case 'meta': return isO(v) && typeof v.startingBalance === 'number' && isFinite(v.startingBalance) && typeof v.startDate === 'string';
      case 'e': return isO(v) && v.id === p.key && typeof v.type === 'string' && v.type.length > 0 && v.type.length <= 40;
      case 'miss': return isO(v) && v.id === p.key;
      case 'day': return isO(v) && (v.pre == null || isO(v.pre)) && (v.post == null || isO(v.post));
      case 'rev': return isO(v);
      case 'ovr': return isO(v) && v.mode === p.m && ovrKey(v) === p.key;
      case 'rh': return isO(v) && v.day === p.key;
      case 'week': return isO(v) && Object.keys(v).every(k => !UNSAFE.has(k) && Array.isArray(v[k]));
      case 'whole': return Array.isArray(v);
      case 'backtest': return isO(v) && (v.points == null || Array.isArray(v.points));
      case 'settings': return isO(v) && (v.risk == null || isO(v.risk)) && (v.costs == null || isO(v.costs)) && (v.fees == null || isO(v.fees));
      case 'x': return v !== null && typeof v !== 'function';
      default: return false;
    }
  }
  // Whole arrays get the same light clean-up core's sanitize() applies on load
  function normWhole(key, arr) {
    const list = arr.filter(isO);
    if (key === 'strategies') return list.map(s => Object.assign({}, s, { entry: Array.isArray(s.entry) ? s.entry : [], exit: Array.isArray(s.exit) ? s.exit : [], minRR: typeof s.minRR === 'number' && isFinite(s.minRR) ? s.minRR : 1.5 }));
    if (key === 'mistakes') return list.filter(m => m.id && m.label);
    if (key === 'tagGroups') return list.filter(g => g.id && Array.isArray(g.tags));
    if (key === 'routine:tasks') return list.filter(t => typeof t.id === 'string' && !UNSAFE.has(t.id));
    return arr;
  }
  // In-place updates: open editors hold references to these objects and must keep seeing live data
  function replaceObj(target, src) {
    for (const k of Object.keys(target)) if (!Object.prototype.hasOwnProperty.call(src, k)) delete target[k];
    for (const k of Object.keys(src)) if (k !== '__proto__') target[k] = src[k];
    return target;
  }
  function syncArray(target, src) {
    const byId = new Map();
    for (const x of target) if (isO(x) && typeof x.id === 'string' && !byId.has(x.id)) byId.set(x.id, x);
    const out = src.map(x => {
      const cur = isO(x) && typeof x.id === 'string' ? byId.get(x.id) : null;
      if (!cur) return x;
      byId.delete(x.id);
      return replaceObj(cur, x);
    });
    target.length = 0;
    for (const x of out) target.push(x);
  }
  function upsertById(list, id, v) {
    if (v == null) { for (let i = list.length - 1; i >= 0; i--) if (isO(list[i]) && list[i].id === id) list.splice(i, 1); return true; }
    const cur = list.find(x => isO(x) && x.id === id);
    if (cur) replaceObj(cur, v); else list.push(v);
    return true;
  }
  function putKey(map, key, v) {
    if (v == null) { delete map[key]; return true; }
    if (isO(map[key])) replaceObj(map[key], v); else map[key] = v;
    return true;
  }
  const holder = (d, field, m, kind) => {
    if (!isO(d[field])) d[field] = {};
    const ok = kind === 'arr' ? Array.isArray(d[field][m]) : isO(d[field][m]);
    if (!ok) d[field][m] = kind === 'arr' ? [] : {};
    return d[field][m];
  };
  function acctOf(d, m) {
    if (!isO(d.accounts)) d.accounts = {};
    if (!isO(d.accounts[m])) d.accounts[m] = { startingBalance: 0, startDate: '', entries: [] };
    if (!Array.isArray(d.accounts[m].entries)) d.accounts[m].entries = [];
    return d.accounts[m];
  }
  // applyDoc(db, id, data | null) → true when the journal now holds that version (null = deleted)
  function applyDoc(d, id, data) {
    const p = parseId(id);
    if (!p || !isO(d)) return false;
    const del = data == null;
    if (!del && !validDoc(p, data)) return false;
    const v = del ? null : safeClone(data);
    switch (p.k) {
      case 'meta': {
        if (del) return false;   // an account always has a balance and start date
        const a = acctOf(d, p.m); a.startingBalance = v.startingBalance; a.startDate = v.startDate; return true;
      }
      case 'e': return upsertById(acctOf(d, p.m).entries, p.key, v);
      case 'miss': return upsertById(holder(d, 'missed', p.m, 'arr'), p.key, v);
      case 'day': return putKey(holder(d, 'days', p.m, 'obj'), p.key, v);
      case 'rev': return putKey(holder(d, 'reviews', p.m, 'obj'), p.key, v);
      case 'week': {
        if (!isO(d.routine)) d.routine = { tasks: [], weeks: {} };
        if (!isO(d.routine.weeks)) d.routine.weeks = {};
        return putKey(d.routine.weeks, p.key, v);
      }
      case 'ovr': {
        if (!Array.isArray(d.overrides)) d.overrides = [];
        const list = d.overrides, same = (o) => isO(o) && o.mode === p.m && ovrKey(o) === p.key;
        if (del) { for (let i = list.length - 1; i >= 0; i--) if (same(list[i])) list.splice(i, 1); return true; }
        const cur = list.find(same);
        if (cur) { replaceObj(cur, v); return true; }
        // the log stays in time order
        const t = Date.parse(v.at);
        let i = isFinite(t) ? list.findIndex(o => isO(o) && Date.parse(o.at) > t) : -1;
        if (i < 0) i = list.length;
        list.splice(i, 0, v);
        return true;
      }
      case 'rh': {
        if (!Array.isArray(d.readinessHistory)) d.readinessHistory = [];
        const h = d.readinessHistory;
        if (del) { for (let i = h.length - 1; i >= 0; i--) if (isO(h[i]) && h[i].day === p.key) h.splice(i, 1); return true; }
        const cur = h.find(r => isO(r) && r.day === p.key);
        if (cur) { replaceObj(cur, v); return true; }
        let i = h.findIndex(r => isO(r) && typeof r.day === 'string' && r.day > p.key);
        if (i < 0) i = h.length;
        h.splice(i, 0, v);
        return true;
      }
      case 'whole': {
        if (del) return false;
        const path = WHOLE[p.key];
        let o = d;
        for (let i = 0; i < path.length - 1; i++) { if (!isO(o[path[i]])) o[path[i]] = {}; o = o[path[i]]; }
        const last = path[path.length - 1];
        if (!Array.isArray(o[last])) o[last] = [];
        syncArray(o[last], normWhole(p.key, v));
        return true;
      }
      case 'backtest': {
        if (del) return false;
        if (isO(d.backtest)) replaceObj(d.backtest, v); else d.backtest = v;
        return true;
      }
      case 'settings': {
        if (del) return false;
        let clean = v;
        // typed merge onto the defaults, exactly as a reload would do it
        if (typeof sanitizeSettings === 'function') { try { clean = sanitizeSettings(v); } catch (e) { return false; } }
        if (!isO(d.settings)) d.settings = {};
        const s = d.settings;
        for (const k of Object.keys(s)) if (!DEVICE_SETTINGS.includes(k) && !Object.prototype.hasOwnProperty.call(clean, k)) delete s[k];
        for (const k of Object.keys(clean)) if (!DEVICE_SETTINGS.includes(k) && k !== '__proto__') s[k] = clean[k];
        return true;
      }
      case 'x': {
        if (del) { delete d[p.key]; return true; }
        const cur = d[p.key];
        if (isO(cur) && isO(v)) replaceObj(cur, v);
        else if (Array.isArray(cur) && Array.isArray(v)) { cur.length = 0; for (const x of v) cur.push(x); }
        else d[p.key] = v;
        return true;
      }
      default: return false;
    }
  }
  // "No real data" = nothing a person typed into paper/live (demo and untouched defaults don't count)
  function hasRealData(d) {
    return SYNC_MODES.some(m => {
      const a = isO(d.accounts) ? d.accounts[m] : null;
      if (isO(a) && Array.isArray(a.entries) && a.entries.some(e => isO(e) && !e.deletedAt && e.type === 'trade')) return true;
      const n = (o) => isO(o) && Object.keys(o).length > 0;
      return n(isO(d.days) ? d.days[m] : null) || n(isO(d.reviews) ? d.reviews[m] : null) || (isO(d.missed) && Array.isArray(d.missed[m]) && d.missed[m].length > 0);
    });
  }

  /* ── Pure decisions (Sync._core — tested by dev/sync-sim.js) ─ */
  // Change detection. known[id] = {h, ts, rev?, sh?} last agreed with the server (h 'del' = deleted there);
  // dirty[id] = {ts, h} | {ts, del:true}: waiting to be pushed, ts = edit time on the server's clock.
  function detect(st, docs, ts, opts) {
    const o = opts || {};
    let changed = 0;
    for (const [id, data] of docs) {
      const h = hash(data), k = st.known[id], d = st.dirty[id];
      if (k && k.h === h) { if (d) { delete st.dirty[id]; changed++; } continue; }   // matches the server (or edited back)
      if (d && !d.del && d.h === h) continue;                                         // still waiting, unchanged
      st.dirty[id] = { ts, h }; changed++;
    }
    for (const id of Object.keys(st.known)) {
      const k = st.known[id];
      if (docs.has(id) || !k || k.h === 'del' || !parseId(id)) continue;
      const d = st.dirty[id];
      if (d && d.del) continue;
      st.dirty[id] = { ts: o.tombTs ? o.tombTs(id, k, ts) : ts, del: true }; changed++;
    }
    for (const id of Object.keys(st.dirty)) {
      if (docs.has(id)) continue;
      const k = st.known[id];
      if (!k || k.h === 'del') { delete st.dirty[id]; changed++; }   // never reached the server alive: nothing to delete there
    }
    return { changed };
  }
  // A pulled row against local bookkeeping: r = {ts, rev, h}, lh = hash of the local doc ('del' when absent)
  function decide(k, d, r, lh) {
    if (k && !k.held && k.ts === r.ts && (k.h === r.h || k.sh === r.h || (k.rev != null && r.rev != null && k.rev === r.rev))) return 'skip';
    if (lh === r.h) return 'known';            // same content here already
    if (d && d.ts > r.ts) return 'keep';       // the local edit is newer: it will push and win
    return 'apply';
  }
  // Push reply: returned rows were applied; ids not returned were rejected (the server holds a newer version)
  function pushResult(st, sent, rows) {
    const got = new Map();
    for (const r of Array.isArray(rows) ? rows : []) if (isO(r) && typeof r.id === 'string') got.set(r.id, r);
    const applied = [], rejected = [];
    for (const s of sent) {
      const r = got.get(s.id);
      if (!r) { rejected.push(s.id); continue; }
      const ts = parseTs(r.client_ts);
      const rec = { h: s.h, ts: isFinite(ts) ? ts : s.ts };
      if (r.rev != null) rec.rev = r.rev;
      st.known[s.id] = rec;
      const d = st.dirty[s.id];
      // a newer edit made while the request was in flight stays dirty
      if (d && d.ts === s.ts && (d.del ? s.h === 'del' : d.h === s.h)) delete st.dirty[s.id];
      applied.push(s.id);
    }
    return { applied, rejected };
  }
  // First sign-in on this device: seed an empty cloud, adopt it (nothing real here), or merge both
  function planFirst(o) {
    let live = 0;
    for (const r of o.index.values()) if (!r.del) live++;
    const kind = !live ? 'seed' : !o.hasReal ? 'adopt' : 'merge';
    const marks = {};
    if (kind !== 'adopt') {
      for (const [id, data] of o.docs) {
        const h = hash(data), k = o.known[id];
        if (k && k.h === h) continue;                    // already agreed in an earlier, interrupted attempt
        const entry = id.startsWith('e:'), r = o.index.get(id);
        // merge: the cloud wins for everything but trades — unless all it holds is the untouched default of a device
        // that had no journal (signed in first by mistake)
        if (kind === 'merge' && !entry && !(r && !r.del && r.ts <= UNSET)) continue;
        marks[id] = { ts: entry ? o.entryTs(data) : o.hasReal ? o.now : UNSET, h };
      }
    }
    return { kind, marks };
  }

  /* ── Bookkeeping in localStorage ────────────────────────── */
  let st = null, stRaw = null, sess = null, skew = 0, skewSampled = false;
  const devTag = () => { try { if (typeof DEVICE_TAG === 'string') return DEVICE_TAG; } catch (e) { /* not loaded */ } return rid().slice(-4); };
  function guessName() {
    const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Macintosh/.test(ua)) return 'Mac';
    return 'This device';
  }
  function blankState(user) {
    return {
      v: 1, userId: user ? user.id : null, email: user ? user.email || '' : '', deviceId: devTag(), deviceName: guessName(),
      cursor: null, known: {}, dirty: {}, lastPullAt: null, lastPushAt: null, lastSyncAt: null, lastError: null,
      firstSyncDone: false, skewMs: skew, lastIndexAt: null, cloudGone: false,
    };
  }
  function parseState(raw) {
    let s = null;
    try { s = JSON.parse(raw); } catch (e) { return null; }
    if (!isO(s) || s.v !== 1 || !isO(s.known) || !isO(s.dirty)) return null;
    for (const m of [s.known, s.dirty]) for (const k of Object.keys(m)) if (!isO(m[k])) delete m[k];
    if (s.skip != null && !isO(s.skip)) delete s.skip;
    return s;
  }
  // Re-read before every locked step: another window of the app may have synced meanwhile
  function loadSt() {
    const raw = lsGet(SKEY);
    if (raw === stRaw && (st || !raw)) return st;
    stRaw = raw;
    st = raw ? parseState(raw) : null;
    if (st && !skewSampled && isFinite(st.skewMs)) skew = st.skewMs;
    return st;
  }
  function saveSt() {
    if (!st) return;
    st.skewMs = skew;
    const raw = JSON.stringify(st);
    if (lsSet(SKEY, raw)) stRaw = raw;
  }
  const nowS = () => Date.now() + skew;   // this device's clock corrected to the server's

  /* ── Session (cj.auth) ──────────────────────────────────── */
  function readSession() {
    try { const s = JSON.parse(lsGet(AKEY)); return isO(s) && isO(s.user) && typeof s.user.id === 'string' ? s : null; } catch (e) { return null; }
  }
  function writeSession(s) {
    sess = s;
    if (s) lsSet(AKEY, JSON.stringify(s)); else lsDel(AKEY);
    scheduleRefresh();
    emitStatus();
  }
  function decodeJwt(t) {
    try {
      const b = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b + '==='.slice((b.length + 3) % 4));
      return JSON.parse(decodeURIComponent(bin.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
    } catch (e) { return null; }
  }
  // GoTrue token reply (or the #access_token=… link) → our session record. Expiry is kept on this device's clock.
  function sessionFrom(r) {
    if (!isO(r) || typeof r.access_token !== 'string' || !r.access_token || typeof r.refresh_token !== 'string' || !r.refresh_token) return null;
    const jwt = decodeJwt(r.access_token) || {}, u = isO(r.user) ? r.user : {};
    const id = typeof u.id === 'string' ? u.id : typeof jwt.sub === 'string' ? jwt.sub : null;
    if (!id) return null;
    const email = String(u.email || jwt.email || '');
    const inS = +r.expires_in, atS = +r.expires_at;
    const exp = inS > 0 ? Date.now() + inS * 1000 : atS > 0 ? atS * 1000 - skew : jwt.exp > 0 ? jwt.exp * 1000 - skew : Date.now() + 3600000;
    return { access_token: r.access_token, refresh_token: r.refresh_token, exp, user: { id, email } };
  }

  /* ── Transport: every request goes through req() (tests mock io) ── */
  const io = {
    fetch: (url, init) => fetch(url, init),
    ws: (url) => new WebSocket(url),
    get hasWs() { return typeof WebSocket === 'function'; },
  };
  // Postgres jsonb refuses \u0000 and unpaired surrogates: clean strings on the way out
  function cleanStr(s) {
    if (s.indexOf('\u0000') >= 0) s = s.split('\u0000').join('');
    if (!/[\ud800-\udfff]/.test(s)) return s;
    let o = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { o += s[i] + s[i + 1]; i++; }
      else o += c >= 0xd800 && c <= 0xdfff ? '\ufffd' : s[i];
    }
    return o;
  }
  const wire = (k, v) => (typeof v === 'string' ? cleanStr(v) : v);
  // Clock skew = server time − device time. Precise samples come from push replies (updated_at); the Date
  // header only has whole seconds, so it moves the estimate only when that is clearly off.
  function sampleSkew(v, tol) { if (!isFinite(v)) return; if (!skewSampled || Math.abs(v - skew) > tol) { skew = Math.round(v); skewSampled = true; } }
  function noteDate(res, t0, t1) {
    let d = null;
    try { d = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('date') : null; } catch (e) { d = null; }
    const s = d ? Date.parse(d) : NaN;
    if (isFinite(s) && t1 - t0 < 10000) sampleSkew(s + 500 - (t0 + t1) / 2, 1500);
  }
  const tails = new WeakMap();   // reply → its body deadline, cleared once the body has been read
  const untail = (res) => { if (isO(res)) { clearTimeout(tails.get(res)); tails.delete(res); } };
  async function req(method, path, o) {
    o = o || {};
    if (!enabled) throw new SyncErr('config', 'Cloud sync is not set up in this copy of the app.');
    if (!online()) throw new SyncErr('net', 'You are offline.');
    const headers = Object.assign({ apikey: KEY }, o.headers || {});
    let body = o.body;
    if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json, wire); }
    // the publishable key goes in apikey only — Authorization always carries the user's own token
    if (o.token) headers.Authorization = 'Bearer ' + o.token;
    else if (o.auth !== false) headers.Authorization = 'Bearer ' + await accessToken();
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    // the headers come only after the whole body went up: allow for a slow phone uplink (~20 KB/s) on big pushes
    const size = typeof body === 'string' ? body.length : body && body.size > 0 ? body.size : 0;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, (o.timeout || T.timeout) + Math.round(size / 20));
    const t0 = Date.now();
    let res;
    try { res = await io.fetch(BASE + path, { method, headers, body, signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit' }); }
    catch (e) { throw new SyncErr('net', 'No connection to the sync server.'); }
    finally { clearTimeout(timer); }
    // The body gets its own, longer deadline: a reply that stalls half-way (a phone between networks) would otherwise
    // hold the sync lock for good — and with it every later sync of this window
    if (ctl && isO(res)) tails.set(res, setTimeout(() => ctl.abort(), o.tail || T.body));
    noteDate(res, t0, Date.now());
    if (res.status === 401 && !o.token && o.auth !== false && !o.retried) {   // token expired early: renew once, retry
      untail(res);
      await refresh(true);
      return req(method, path, Object.assign({}, o, { retried: true }));
    }
    return res;
  }
  async function readBody(res, blob) {
    try { return blob ? await res.blob() : await res.text(); }
    catch (e) { throw new SyncErr('net', 'The connection dropped while the reply was coming in.'); }
    finally { untail(res); }
  }
  async function readJson(res) { const t = await readBody(res); try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  async function httpErr(res, j) {
    if (j === undefined) j = await readJson(res);
    const s = res.status, msg = isO(j) ? (j.message || j.msg || j.error_description || j.error || '') : '';
    const kind = s === 401 ? 'auth' : s >= 500 || s === 429 || s === 408 ? 'server' : 'client';
    return new SyncErr(kind, `The sync server said: ${String(msg || 'HTTP ' + s).slice(0, 160)}`, s);
  }
  async function getJson(path) {
    const res = await req('GET', path);
    if (!res.ok) throw await httpErr(res);
    const j = await readJson(res);
    if (!Array.isArray(j)) throw new SyncErr('server', 'The sync server sent an unexpected reply.');
    return j;
  }

  /* ── Locks: one sync at a time per window, and across windows (navigator.locks) ── */
  const chains = {};
  function lock(name, fn) {
    const job = () => {
      const L = typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null;
      if (!L) return fn();
      let ran = false;
      // no Web Locks here after all (file://, old Safari): the in-window order still holds
      try { return Promise.resolve(L.request(name, () => { ran = true; return fn(); })).catch((e) => { if (ran) throw e; return fn(); }); }
      catch (e) { return fn(); }
    };
    const p = (chains[name] || Promise.resolve()).then(job, job);
    chains[name] = p.catch(() => {});
    return p;
  }

  /* ── Auth: tokens ───────────────────────────────────────── */
  let refreshing = null, refreshTimer = null, refreshedAt = 0;
  async function accessToken() {
    if (!sess || sess.bad || !sess.access_token) throw new SyncErr('auth', sess ? 'Sign in again to keep syncing.' : 'Not signed in.');
    if (Date.now() > sess.exp - T.early) await refresh();
    if (!sess || sess.bad) throw new SyncErr('auth', 'Sign in again to keep syncing.');
    return sess.access_token;
  }
  async function refresh(force) {
    if (refreshing) {
      try { await refreshing; } catch (e) { /* this call tries again below */ }
      if (!force || Date.now() - refreshedAt < 5000) return;
    }
    refreshing = lock('cj-auth', () => doRefresh(force));
    try { await refreshing; } finally { refreshing = null; }
  }
  async function doRefresh(force) {
    // A refresh token works once: another window may already have swapped the pair — then use theirs
    const cur = readSession();
    if (cur && sess && !cur.bad && cur.user.id === sess.user.id && cur.refresh_token !== sess.refresh_token) {
      sess = cur; scheduleRefresh(); RT.token();
      if (Date.now() < cur.exp - T.early) { refreshedAt = Date.now(); return; }
    }
    if (!sess || sess.bad || !sess.refresh_token) throw new SyncErr('auth', 'Sign in again to keep syncing.');
    if (!force && Date.now() < sess.exp - T.early) return;
    if (force && Date.now() - refreshedAt < 5000) return;
    const res = await req('POST', '/auth/v1/token?grant_type=refresh_token', { auth: false, json: { refresh_token: sess.refresh_token } });
    const j = await readJson(res);
    // signed out in another window while this request was out: stay signed out, never bring the session back
    if (!readSession()) { sess = null; RT.stop(); emitStatus(); throw new SyncErr('auth', 'Signed out.'); }
    if (res.ok) {
      const s = sessionFrom(j);
      if (!s || !sess || s.user.id !== sess.user.id) throw new SyncErr('server', 'The sign-in could not be renewed — try again.');
      refreshedAt = Date.now();
      writeSession(s); RT.token();
      return;
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      writeSession({ user: sess.user, bad: true, exp: 0 });   // refresh token revoked or expired: only a new sign-in helps
      throw new SyncErr('auth', 'Your sign-in has expired — sign in again to keep syncing.');
    }
    throw await httpErr(res, j);
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer); refreshTimer = null;
    if (!sess || sess.bad || !(sess.exp > 0)) return;
    const ms = Math.min(0x7fffffff, Math.max(5000, sess.exp - T.early - Date.now()));
    refreshTimer = setTimeout(() => { refreshTimer = null; if (online()) refresh().catch(authFail); }, ms);
  }
  function authFail(e) { if (e && e.kind === 'auth') { RT.stop(); emitStatus(); } }
  // Best effort, never awaited by the UI: end THIS session on the server (scope=local — GoTrue's default
  // 'global' would also sign the other device out)
  function endRemote(token) { if (token) req('POST', '/auth/v1/logout?scope=local', { token, json: {}, timeout: 8000 }).catch(() => {}); }

  /* ── Engine state ───────────────────────────────────────── */
  let busy = false, errKind = null, errMsg = null, retryN = 0, retryTimer = null;
  let editAt = 0, selfSave = false, looked = false, sawLoadError = false, genSeen = null, staleSince = 0;
  let kickTimer = null, kickAt = 0, want = {}, queued = null, saveTimer = null, rtTimer = null, rtDel = false, lastWake = 0;
  let started = false, link = null, linkError = null, pendingRecovery = false, mediaBusy = false, mediaTimer = null, mediaRetry = 0, mediaNote = null;
  const loadBlocked = () => typeof StorageGuard !== 'undefined' && !!StorageGuard.loadError;
  const parkedN = () => (st ? Object.keys(st.dirty).filter(id => st.dirty[id].bad).length : 0);
  const pendingN = () => (st ? Object.keys(st.dirty).length : 0);
  function stateNow() {
    if (!enabled || !sess) return 'off';
    if (sess.bad) return 'auth';
    if (!online() || errKind === 'net') return 'offline';
    if (busy) return 'syncing';
    if (errKind) return 'error';
    return 'synced';
  }
  const statusObj = () => ({ state: stateNow(), pending: pendingN(), lastSyncAt: (st && st.lastSyncAt) || null, error: errMsg || null, realtime: RT.up });
  let lastKey = '';
  function emitStatus() {
    const s = statusObj(), k = JSON.stringify(s);
    if (k === lastKey) return;
    lastKey = k;
    if (typeof Bus !== 'undefined') Bus.emit('sync', s);
    chip();
  }
  function note(kind, message, toastKind) {
    if (typeof Bus !== 'undefined') Bus.emit('sync-note', { kind, message });
    if (toastKind && typeof toast === 'function') toast(message, toastKind, { ms: 9000 });
  }
  // A cross-window marker: every save writes a new one, so a window whose in-memory journal is older than
  // the copy on disk (the storage event is still on its way) waits instead of syncing stale data
  function bumpGen() { genSeen = rid(); lsSet(GEN, genSeen); }
  function stale() {
    const g = lsGet(GEN);
    if (g == null || genSeen == null || g === genSeen) { staleSince = 0; return false; }
    if (!staleSince) staleSince = Date.now();
    if (Date.now() - staleSince > 3000) { genSeen = g; staleSince = 0; return false; }   // that event never came
    return true;
  }

  /* ── Scheduling ─────────────────────────────────────────── */
  function kick(o, delay) {
    for (const k of Object.keys(o || {})) if (o[k]) want[k] = true;
    const at = Date.now() + (delay || 0);
    if (kickTimer) { if (kickAt <= at) return; clearTimeout(kickTimer); }
    kickAt = at;
    kickTimer = setTimeout(() => { kickTimer = null; const w = want; want = {}; runCycle(w); }, Math.max(0, delay || 0));
  }
  function runCycle(o) {
    if (queued) { for (const k of Object.keys(o || {})) if (o[k]) queued.o[k] = true; return queued.p; }
    const q = { o: Object.assign({}, o) };
    q.p = lock('cj-sync', () => { if (queued === q) queued = null; return cycle(q.o); });
    queued = q;
    return q.p;
  }
  function onSaved() {
    bumpGen();
    if (selfSave) return;               // our own write of pulled changes is not an edit
    editAt = nowS();                    // the edit time, recorded even while offline
    if (!st && !sess) return;           // never synced on this device: nothing to track
    lsSet(EDIT, String(editAt));        // …and kept if the app is closed before the change is looked at
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; kick({}); }, T.debounce);
  }
  // Time of the latest edit not looked at yet — this window's, or one saved just before the app was last closed
  // (dated "now" at the next start, it could beat a newer edit made meanwhile on the other device)
  const editTs = () => Math.max(editAt, +lsGet(EDIT) || 0) || nowS();
  function fail(e, o) {
    const kind = (e && e.kind) || 'server';
    if (kind === 'stale') { kick(o, 300); return; }
    if (kind === 'auth') { errKind = null; errMsg = null; if (sess && !sess.bad) writeSession({ user: sess.user, bad: true, exp: 0 }); RT.stop(); emitStatus(); return; }
    if (kind !== 'net' && kind !== 'stale') console.warn('[sync]', kind, e && e.message);
    errKind = kind === 'net' ? 'net' : kind;
    errMsg = kind === 'net' ? null : (e && e.message) || 'Sync problem';
    if (st) { st.lastError = errMsg; saveSt(); }
    if (kind === 'cloud' || kind === 'paused' || kind === 'config') return;   // waits for the person
    const delays = kind === 'net' ? [5e3, 15e3, 30e3, 60e3, 120e3] : kind === 'storage' ? [60e3, 120e3, 300e3, 600e3] : [10e3, 30e3, 60e3, 120e3, 300e3];
    const d = delays[Math.min(retryN++, delays.length - 1)];
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; kick(Object.assign({ pull: true }, o)); }, d);
  }
  // Forget what the cloud holds and run the first-sign-in plan again (cloud deleted, journal replaced while unreadable)
  function restart() {
    if (!st) return;
    Object.assign(st, { known: {}, dirty: {}, cursor: null, firstSyncDone: false, cloudGone: false, lastIndexAt: null, snapAt: null, skip: {} });
    saveSt();
  }

  /* ── Detection ──────────────────────────────────────────── */
  // Before the first sync is done the first-sign-in plan decides what goes up (seed / adopt / merge): marking this
  // device's untouched defaults as fresh edits would let them overwrite the other device's journal
  function look(planning, at) {
    if (!st || loadBlocked() || (!st.firstSyncDone && !planning)) return 0;
    const ts = at || editTs();
    editAt = 0;
    if (lsGet(EDIT) != null) lsDel(EDIT);
    const first = !looked;
    looked = true;
    // At start-up a known trade that is gone was purged from Trash by core.js (30 days). That tombstone is dated
    // just after the version we know (or when it was trashed here, if that is later and never went up), so a
    // restore made on the other device meanwhile still wins.
    let purged = 0;
    const tombTs = (id, k, t) => {
      if (!id.startsWith('e:') || !isFinite(k.ts)) return t;
      purged++;
      const d = st.dirty[id];
      return Math.max(k.ts + 1, d && !d.del && isFinite(d.ts) ? d.ts : 0);
    };
    const r = detect(st, explode(db), ts, first ? { tombTs } : null);
    if (r.changed) saveSt();
    // That purge lives only in memory until the next save: store it now, so another open window of the app reloads
    // the same journal instead of uploading the trashed copy back
    if (purged) { selfSave = true; try { save(); } finally { selfSave = false; } }
    emitStatus();
    return r.changed;
  }
  // Safety net: a document pushed again and again in versions it already had (two windows holding different copies,
  // a future bug) is held back for a while instead of bouncing. Quick real edits (ticking a checklist) keep moving
  // forward to new versions, so they are never held.
  const flaps = new Map();
  function flapping(id) {
    const a = flaps.get(id);
    if (!a) return false;
    while (a.length && Date.now() - a[0].t > 120000) a.shift();
    if (a.length < 10) return false;
    const seen = new Set();
    let back = 0;
    for (const x of a) { if (seen.has(x.h)) back++; seen.add(x.h); }
    return back >= 6;
  }
  const pushedNow = (id, h) => { const a = flaps.get(id) || []; a.push({ t: Date.now(), h }); flaps.set(id, a.slice(-12)); };

  /* ── One sync cycle (runs under the cj-sync lock) ───────── */
  async function cycle(o) {
    o = o || {};
    if (!enabled) return false;
    if (loadBlocked()) {
      sawLoadError = true;
      if (sess && !sess.bad) { errKind = 'paused'; errMsg = 'Sync is paused until the storage warning at the top of the page is resolved.'; emitStatus(); }
      return false;
    }
    loadSt();
    if (!sess || sess.bad) { look(); return false; }   // signed out: keep recording edit times for later
    // This journal's bookkeeping belongs to another account (sign-in normally switches first): never mix them
    if (st && st.userId && st.userId !== sess.user.id) { errKind = 'paused'; errMsg = 'This device’s journal belongs to another account — sign out, then sign in again.'; emitStatus(); return false; }
    if (!st) { st = blankState(sess.user); saveSt(); }
    if (!st.userId) { st.userId = sess.user.id; st.email = sess.user.email; saveSt(); }
    if (errKind === 'paused') { errKind = null; errMsg = null; }
    // The journal was replaced while it was unreadable (fresh start or restore): start over from the cloud
    if (sawLoadError) { sawLoadError = false; restart(); }
    if (stale()) { kick(o, 300); return false; }
    look();
    if (!online()) { errKind = 'net'; errMsg = null; emitStatus(); return false; }
    if (st.cloudGone && !o.force) { emitStatus(); return false; }
    busy = true; emitStatus();
    try {
      if (st.cloudGone) restart();
      if (!st.firstSyncDone) await firstSync();
      else {
        if (o.reconcile || !st.lastIndexAt || Date.now() - st.lastIndexAt > T.reconcile) await reconcile();
        await pushAll(!!o.force);
        if (o.pull) await pull(false);
      }
      await dropMedia();
      st.lastSyncAt = Date.now(); st.lastError = null; retryN = 0;
      const bad = parkedN(), held = Object.keys(st.dirty).filter(flapping).length;
      errKind = bad || held ? 'client' : null;
      errMsg = bad ? `${plural(bad, 'change')} could not be uploaded — the server refused ${bad === 1 ? 'it' : 'them'}. Edit ${bad === 1 ? 'it' : 'them'} again or press Sync now to retry.`
        : held ? `${plural(held, 'change')} keeps going back and forth — close any other open window of the app; sync retries shortly.` : null;
      if (held) kick({}, 30000);
      saveSt();
      scheduleMedia(500);
      return true;
    } catch (e) { fail(e, o); return false; }
    finally { busy = false; emitStatus(); }
  }

  /* ── First sign-in on a device ──────────────────────────── */
  async function firstSync() {
    // 1. a safety snapshot of this device's journal (adopt/merge may overwrite parts of it)
    if (!st.snapAt && typeof Store !== 'undefined' && Store.snapshot) {
      try { await withTimeout(Store.snapshot('Before first cloud sync'), 15000); st.snapAt = Date.now(); saveSt(); } catch (e) { /* no snapshots here: carry on */ }
    }
    // 2. what the cloud holds
    const { map, serverAt } = await fetchIndex();
    if (stale()) throw new SyncErr('stale');
    const plan = planFirst({ docs: explode(db), index: map, hasReal: hasRealData(db), known: st.known, now: nowS(), entryTs });
    for (const id of Object.keys(plan.marks)) st.dirty[id] = plan.marks[id];
    saveSt();
    // 3. adopt / merge: download the cloud (pre-marked trades with a newer edit stay)
    const down = plan.kind === 'seed' ? 0 : await pull(true);
    // seed: nothing older than the index exists — start the cursor there, on the server's own clock
    // (without a readable Date header it stays empty and the next pull simply reads everything once)
    if (plan.kind === 'seed' && isFinite(serverAt)) st.cursor = maxTs(st.cursor, isoOf(serverAt - 120000));
    // 4. whatever is only here goes up — after adopting, that is this device's defaults for what the cloud does not
    // hold yet (the other device may still be uploading it): dated "unset", so its real versions win when they come
    look(true, plan.kind === 'adopt' ? UNSET : 0);
    const up = await pushAll(true);
    // 5. screenshots of synced trades follow
    queueAllMedia();
    st.firstSyncDone = true; st.lastIndexAt = Date.now();
    saveSt();
    const msg = plan.kind === 'seed' ? `Cloud sync is on — ${plural(up, 'item')} from this device uploaded.`
      : plan.kind === 'adopt' ? `Your journal was downloaded from the cloud (${plural(down, 'item')}).`
        : `Merged: ${plural(up, 'item')} from this device added to the cloud, ${plural(down, 'item')} downloaded.`;
    note('first', msg, 'ok');
    return { kind: plan.kind, up, down };
  }
  // A trade's own edit time (on the server's clock) decides a merge — moving it to Trash counts (softDelete sets
  // only deletedAt), or the cloud's older live copy would quietly take it back out of Trash
  function entryTs(e) {
    const ts = isO(e) ? [e.updatedAt, e.deletedAt, e.createdAt].map(v => parseTs(v)).filter(isFinite) : [];
    return ts.length ? Math.max(...ts) + skew : nowS();
  }

  /* ── Index reconcile (cheap: ids and versions only) ─────── */
  async function fetchIndex() {
    const map = new Map();
    let after = null, maxUp = null, serverAt = NaN;
    // keyset pages until an empty one, so a lower max-rows setting on the server can't cut it short
    for (let i = 0; i < 1000; i++) {
      const res = await req('GET', '/rest/v1/cj_docs?select=id,client_ts,deleted,rev,updated_at&order=id.asc&limit=' + T.page + (after != null ? '&id=gt.' + enc(after) : ''));
      if (!res.ok) throw await httpErr(res);
      if (!i) { try { serverAt = Date.parse(res.headers.get('date')); } catch (e) { serverAt = NaN; } }
      const rows = await readJson(res);
      if (!Array.isArray(rows)) throw new SyncErr('server', 'The sync server sent an unexpected reply.');
      for (const r of rows) {
        if (!isO(r) || typeof r.id !== 'string') continue;
        map.set(r.id, { ts: parseTs(r.client_ts), del: r.deleted === true, rev: r.rev == null ? null : r.rev });
        if (typeof r.updated_at === 'string' && isFinite(parseTs(r.updated_at))) maxUp = maxTs(maxUp, r.updated_at);
      }
      const last = rows.length ? rows[rows.length - 1] : null;
      if (!last || !isO(last) || typeof last.id !== 'string') break;
      after = last.id;
    }
    return { map, maxUp, serverAt };
  }
  async function reconcile() {
    const { map, maxUp } = await fetchIndex();
    const k = st.known;
    // Most of what this device knew is gone: the cloud copy was deleted (on another device — perhaps while this one
    // was away and has pushed an edit into the empty cloud since). Never upload everything again without asking.
    const live = Object.keys(k).filter(id => k[id].h !== 'del' && parseId(id)), gone = live.filter(id => !map.has(id)).length;
    if (gone && (!map.size || (gone >= 5 && gone * 2 > live.length))) {
      st.cloudGone = true; saveSt();
      const msg = 'Your cloud copy was deleted (on another device). Sync is paused here — press Sync now to upload this device’s journal again, or sign out.';
      note('cloud-gone', msg);
      throw new SyncErr('cloud', msg);
    }
    const need = [];
    for (const [id, r] of map) {
      const x = k[id];
      if (!parseId(id)) continue;
      if (!x || x.held || x.ts !== r.ts || (x.h === 'del') !== r.del || (x.rev != null && r.rev != null && x.rev !== r.rev)) need.push(id);
    }
    // The server lost rows we thought it had: upload ours again, dated as the version both sides last agreed on
    // (so a newer copy uploaded meanwhile by the other device still wins)
    let lost = 0, docs = null;
    for (const id of Object.keys(k)) {
      if (map.has(id)) continue;
      const x = k[id];
      delete k[id]; lost++;
      docs = docs || explode(db);
      if (x.h !== 'del' && docs.has(id) && !st.dirty[id] && parseId(id)) st.dirty[id] = { ts: x.ts, h: hash(docs.get(id)) };
    }
    if (lost) saveSt();
    if (need.length > 300) await pull(true); else if (need.length) await fetchIds(need);
    if (maxUp) st.cursor = maxTs(st.cursor, maxUp);
    st.lastIndexAt = Date.now();
    saveSt();
    if (lost) look();
  }

  /* ── Pull ───────────────────────────────────────────────── */
  async function pull(full) {
    const c = parseTs(st.cursor);
    let from = !full && isFinite(c) ? isoOf(c - T.overlap) : EPOCH;   // 60 s overlap: rows that committed late
    let total = 0;
    const seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const rows = await getJson('/rest/v1/cj_docs?select=id,data,deleted,client_ts,rev,updated_at,device&updated_at=gte.' + enc(from) + '&order=updated_at.asc,id.asc&limit=' + T.page);
      let fresh = 0;
      for (const r of rows) { const key = isO(r) ? r.id + '@' + r.updated_at : ''; if (!seen.has(key)) { seen.add(key); fresh++; } }
      total += processRows(rows).applied;
      const lastRow = rows.length ? rows[rows.length - 1] : null;
      const last = isO(lastRow) && typeof lastRow.updated_at === 'string' && isFinite(parseTs(lastRow.updated_at)) ? lastRow.updated_at : null;
      if (last) st.cursor = maxTs(st.cursor, last);
      st.lastPullAt = Date.now();
      saveSt();
      // a full pull keeps paging until nothing new comes back (a lower max-rows setting can't cut it short);
      // an incremental one stops at a short page — the cursor carries on from there next time
      if ((!full && rows.length < T.page) || !fresh || !last) break;
      from = last;
    }
    return total;
  }
  async function fetchIds(ids) {
    let n = 0;
    for (let i = 0; i < ids.length; i += T.ids) {
      const list = ids.slice(i, i + T.ids).map(id => '"' + id.replace(/["\\]/g, '\\$&') + '"').join(',');
      n += processRows(await getJson('/rest/v1/cj_docs?select=id,data,deleted,client_ts,rev,updated_at,device&id=in.(' + enc(list) + ')')).applied;
    }
    return n;
  }
  // Decide each pulled row and apply the batch in place. Synchronous from the look at the journal to the save,
  // so nothing can change the journal in between.
  function processRows(rows) {
    if (!Array.isArray(rows)) throw new SyncErr('server', 'The sync server sent an unexpected reply.');
    if (loadBlocked()) throw new SyncErr('paused', 'Sync is paused until the storage warning at the top of the page is resolved.');
    if (stale()) throw new SyncErr('stale');
    // Edits saved while this request was out (here or in another window) are marked first, with their edit time —
    // otherwise an older copy from the other device would replace them below
    if (editAt || lsGet(EDIT) != null) look();
    const by = new Map();
    for (const r of rows) if (isO(r) && typeof r.id === 'string') by.set(r.id, r);   // oldest first: the newest copy wins
    const docs = explode(db), todo = [];
    let known = 0, ignored = 0, held = 0;
    for (const [id, r] of by) {
      const p = parseId(id), ts = parseTs(r.client_ts);
      if (!p || !isFinite(ts) || (r.deleted != null && typeof r.deleted !== 'boolean')) { ignored++; continue; }
      const del = r.deleted === true, local = docs.get(id), lh = local === undefined ? 'del' : hash(local);
      const rev = r.rev == null ? null : r.rev;
      // a version this device cannot use (skipped before, wrong shape, nested too deep to read) is left alone, and
      // must not stop the rest of the batch
      let rh = null;
      try { if (!(st.skip && st.skip[id] === ts) && (del || validDoc(p, r.data))) rh = del ? 'del' : hash(r.data); } catch (e) { rh = null; }
      if (rh === null) { if (hold(id, ts, rev, lh)) held++; ignored++; continue; }
      const dec = decide(st.known[id], st.dirty[id], { ts, rev, h: rh }, lh);
      if (dec === 'skip' || dec === 'keep') continue;
      if (dec === 'known') { st.known[id] = rev != null ? { h: lh, ts, rev } : { h: lh, ts }; delete st.dirty[id]; known++; continue; }
      todo.push({ id, p, rh, ts, rev, data: del ? null : r.data, prev: local === undefined ? null : safeClone(local) });
    }
    const applied = todo.length ? applyBatch(todo) : 0;
    if (todo.length || known || held) saveSt();
    return { applied, known, ignored };
  }
  // A cloud version this device cannot use: the local copy stays, but is never pushed over that version unless it is
  // edited again (a newer app on the other device may have written it, and a first sign-in must not replace it with
  // this device's defaults). Later pulls and the reconcile then skip that version.
  // (held: the reconcile keeps fetching it, so an app update that can read it picks it up)
  function hold(id, ts, rev, lh) {
    if (st.dirty[id]) return false;   // a real local edit: it goes up and the newer one wins
    const k = st.known[id];
    st.known[id] = rev != null ? { h: k ? k.h : lh, ts, rev, held: 1 } : { h: k ? k.h : lh, ts, held: 1 };
    return true;
  }
  // A copy that cannot be computed must never replace a working journal
  function computes() {
    if (typeof Engine === 'undefined' || !Engine.compute) return true;
    try { const opts = typeof engineOpts === 'function' ? engineOpts() : {}; for (const m of SYNC_MODES) Engine.compute(db.accounts[m], opts); return true; } catch (e) { return false; }
  }
  const undo = (list) => { for (let i = list.length - 1; i >= 0; i--) { try { applyDoc(db, list[i].id, list[i].prev); } catch (e) { /* best effort */ } } };
  function applyBatch(todo) {
    let done = [];
    for (const x of todo) {
      let ok = false;
      try { ok = applyDoc(db, x.id, x.data); } catch (e) { undo([x]); }
      if (ok) done.push(x);
    }
    // Only trades and account balances feed the computation. When the batch breaks it, the documents responsible are
    // found by halving and left out alone — one bad trade must not hold back (or, on a first sign-in, cost) the rest.
    const feeds = (x) => x.p.k === 'e' || x.p.k === 'meta', bad = [];
    if (done.some(feeds) && !computes()) {
      const feed = done.filter(feeds), keep = new Set();
      undo(feed);
      if (computes()) {
        const tryAdd = (list) => {
          for (const x of list) applyDoc(db, x.id, x.data);
          if (computes()) { for (const x of list) keep.add(x); return; }
          undo(list);
          if (list.length === 1) { bad.push(list[0]); return; }
          tryAdd(list.slice(0, list.length >> 1)); tryAdd(list.slice(list.length >> 1));
        };
        tryAdd(feed);
        done = done.filter(x => !feeds(x) || keep.has(x));
      } else for (const x of feed) applyDoc(db, x.id, x.data);   // it did not compute before this batch either
    }
    if (bad.length) {
      st.skip = st.skip || {};
      for (const x of bad) { st.skip[x.id] = x.ts; hold(x.id, x.ts, x.rev, x.prev == null ? 'del' : hash(x.prev)); }
      const ks = Object.keys(st.skip); if (ks.length > 500) for (const k of ks.slice(0, ks.length - 500)) delete st.skip[k];
      console.warn('[sync] left out, cannot be computed here:', bad.map(x => x.id).join(', '));
      note('skipped', `${plural(bad.length, 'change')} from your other device could not be loaded on this device and ${bad.length === 1 ? 'was' : 'were'} left out.`, 'warn');
    }
    if (!done.length) return 0;
    let ok;
    selfSave = true; try { ok = save() !== false; } finally { selfSave = false; }
    if (!ok) {
      // memory goes back to what is on disk; known/cursor stay, so this is retried later
      undo(done);
      try { recompute(); } catch (e) { /* page shows its own error */ }
      throw new SyncErr('storage', 'This device’s storage is full — changes from your other device can’t be saved here until you free some space.');
    }
    // known = what the journal now holds (a version normalised on the way in is not pushed back)
    const after = explode(db);
    for (const x of done) {
      const loc = after.get(x.id), h = loc === undefined ? 'del' : hash(loc);
      const rec = { h, ts: x.ts };
      if (x.rev != null) rec.rev = x.rev;
      if (h !== x.rh) rec.sh = x.rh;
      st.known[x.id] = rec;
      delete st.dirty[x.id];
    }
    try { recompute(); } catch (e) { console.error('[sync] recompute', e); }
    if (done.some(x => x.p.k === 'settings')) { try { if (typeof applyTheme === 'function') applyTheme(); } catch (e) { /* cosmetic */ } Bus.emit('settings'); }
    Bus.emit('refresh');
    Bus.emit('remote', { count: done.length });
    return done.length;
  }

  /* ── Push ───────────────────────────────────────────────── */
  const devLabel = () => `${String((st && st.deviceName) || guessName()).slice(0, 40)} · ${(st && st.deviceId) || devTag()}`;
  // Oldest edits first; a doc edited again since detection gets its new content and edit time
  function pickBatch(docs, tries) {
    const ids = Object.keys(st.dirty).filter(id => !st.dirty[id].bad && (tries[id] || 0) < 2 && !flapping(id)).sort((a, b) => st.dirty[a].ts - st.dirty[b].ts).slice(0, T.batch);
    const out = [];
    for (const id of ids) {
      let d = st.dirty[id];
      const data = docs.get(id);
      if (!d.del && data === undefined) {
        const k = st.known[id];
        if (!k || k.h === 'del') { delete st.dirty[id]; continue; }
        d = st.dirty[id] = { ts: editTs(), del: true };
      } else if (d.del && data !== undefined) d = st.dirty[id] = { ts: editTs(), h: hash(data) };
      const h = d.del ? 'del' : hash(data);
      if (!d.del && h !== d.h) d = st.dirty[id] = { ts: editTs(), h };
      out.push({ id, h, ts: d.ts, del: !!d.del, data: d.del ? null : data });
    }
    return out;
  }
  async function pushRows(batch) {
    const body = batch.map(s => ({ id: s.id, data: s.del ? null : s.data, deleted: s.del, client_ts: isoOf(s.ts), device: devLabel() }));
    const t0 = Date.now();
    const res = await req('POST', '/rest/v1/cj_docs?on_conflict=user_id,id&select=id,client_ts,rev,updated_at', { json: body, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
    if (res.ok) {
      const rows = await readJson(res), t1 = Date.now();
      if (!Array.isArray(rows)) throw new SyncErr('server', 'The sync server sent an unexpected reply.');
      const ups = rows.map(r => (isO(r) ? parseTs(r.updated_at) : NaN)).filter(isFinite);
      if (ups.length && t1 - t0 < 2000) sampleSkew(Math.max(...ups) - (t0 + t1) / 2, 0);
      return pushResult(st, batch, rows);
    }
    const s = res.status;
    // 400/409/413/422 = something in the documents (403/404 would be the server's setup: retried later, not split)
    if ([400, 409, 413, 422].includes(s)) {
      // One bad document must not block the rest: split until it is isolated, then park it until it changes
      if (batch.length > 1) {
        const mid = batch.length >> 1, a = await pushRows(batch.slice(0, mid)), b = await pushRows(batch.slice(mid));
        return { applied: a.applied.concat(b.applied), rejected: a.rejected.concat(b.rejected) };
      }
      const d = st.dirty[batch[0].id];
      if (d) d.bad = s;
      console.warn('[sync] the server refused', batch[0].id, s);
      return { applied: [], rejected: [] };
    }
    throw await httpErr(res);
  }
  async function pushAll(force) {
    if (force) for (const id of Object.keys(st.dirty)) delete st.dirty[id].bad;
    let applied = 0;
    const tries = {};
    for (let round = 0; round < 500; round++) {
      if (stale()) throw new SyncErr('stale');
      const batch = pickBatch(explode(db), tries);
      if (!batch.length) break;
      const r = await pushRows(batch), hs = new Map(batch.map(s => [s.id, s.h]));
      applied += r.applied.length;
      for (const id of r.applied) pushedNow(id, hs.get(id));
      st.lastPushAt = Date.now();
      saveSt();
      if (r.rejected.length) {   // the server holds a newer version: fetch it (it replaces the local edit)
        for (const id of r.rejected) tries[id] = (tries[id] || 0) + 1;
        await fetchIds(r.rejected);
      }
      emitStatus();
    }
    return applied;
  }

  /* ── Screenshots (media) ────────────────────────────────── */
  // uid is passed in, never read from the session at request time: a sign-in as someone else mid-run must not
  // point the rest of the run at their storage
  const objPath = (uid, id, dl) => `/storage/v1/object/${dl ? 'authenticated/' : ''}${enc(BUCKET)}/${enc(uid)}/${enc(id)}`;
  const addQ = (k, id) => { const q = lsJson(k, []); if (Array.isArray(q) && !q.includes(id)) { q.push(id); lsSet(k, JSON.stringify(q.slice(-5000))); } };
  const dropQ = (k, id) => { const q = lsJson(k, []); if (Array.isArray(q) && q.includes(id)) lsSet(k, JSON.stringify(q.filter(x => x !== id))); };
  const qLen = (k) => { const q = lsJson(k, []); return Array.isArray(q) ? q.length : 0; };
  // Media ids referenced by paper/live trades (trash included) — demo screenshots never leave the device
  function mediaRefs() {
    const ids = new Set();
    for (const m of SYNC_MODES) {
      const a = isO(db.accounts) ? db.accounts[m] : null;
      for (const e of isO(a) && Array.isArray(a.entries) ? a.entries : []) {
        for (const s of isO(e) && Array.isArray(e.shots) ? e.shots : []) if (isO(s) && typeof s.id === 'string' && MEDIA_RE.test(s.id)) ids.add(s.id);
      }
    }
    return ids;
  }
  // Also while signed out (this device still keeps its sync bookkeeping): it goes up after the next sign-in
  function queueMedia(id) {
    if (!MEDIA_RE.test(String(id || '')) || (!sess && !st)) return false;
    addQ(MQ, id);
    scheduleMedia(1500);
    return true;
  }
  function queueAllMedia() { for (const id of mediaRefs()) addQ(MQ, id); }
  function scheduleMedia(ms) {
    if (!qLen(MQ)) return;
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(() => { mediaTimer = null; mediaRun(); }, ms || 0);
  }
  // Storage answers 400 for many things (an expired token included): only a size or type refusal is final
  async function storageErr(res) {
    const j = await readJson(res), m = isO(j) ? String(j.message || j.error || '') : '';
    return {
      jwt: res.status === 401 || /jwt|token/i.test(m),
      gone: res.status === 404 || /not.?found/i.test(m + (isO(j) ? ' ' + (j.statusCode || '') : '')) || (isO(j) && String(j.statusCode) === '404'),
      final: res.status === 413 || res.status === 415 || /exceeded|too large|mime|not supported/i.test(m),
      big: res.status === 413 || /exceeded|too large/i.test(m),
      busy: res.status >= 500 || res.status === 429 || res.status === 408,   // the server's trouble, not the file's
    };
  }
  const mediaTries = new Map();
  const tried = (id) => { const n = (mediaTries.get(id) || 0) + 1; mediaTries.set(id, n); return n; };
  // Cloud copies of removed screenshots go only once this device agrees with the cloud: a trade edit that loses to the
  // other device's newer one may still use the screenshot (then it stays). Runs inside the sync cycle, so the
  // account cannot change meanwhile.
  async function dropMedia() {
    if (!qLen(MQD) || !sess || sess.bad) return;
    look();
    if (Object.keys(st.dirty).some(id => id.startsWith('e:') && !st.dirty[id].bad)) return;
    const refs = mediaRefs(), uid = sess.user.id;
    try {
      for (const id of lsJson(MQD, [])) {
        if (refs.has(id)) { dropQ(MQD, id); continue; }   // in use again (or still): keep it
        const res = await req('DELETE', objPath(uid, id));
        if (res.ok) { dropQ(MQD, id); continue; }
        const er = await storageErr(res);
        if (er.jwt) { await refresh(true); break; }
        if (er.busy) break;
        if (er.gone || tried('-' + id) >= 5) dropQ(MQD, id);   // already gone (or never uploaded), or refused for good
      }
    } catch (e) { /* offline or signed out: the next sync tries again */ }
  }
  async function mediaRun() {
    if (mediaBusy || !sess || sess.bad || !online() || loadBlocked() || (st && st.cloudGone) || typeof Store === 'undefined' || !Store.getMedia) return;
    // the account this run uploads for: a sign-in as someone else meanwhile stops it
    const uid = sess.user.id, mine = () => !!sess && !sess.bad && sess.user.id === uid;
    mediaBusy = true;
    let again = false;
    try {
      await Store.ready;
      if (!Store.available) return;   // the local database is closed: try again later, drop nothing
      const refs = mediaRefs();
      for (const id of lsJson(MQ, [])) {
        const rec = await Store.getMedia(id);
        if (!rec || !(rec.blob instanceof Blob)) { if (Store.available) dropQ(MQ, id); else again = true; continue; }   // blob gone: nothing to upload
        if (!refs.has(id)) { if (Date.now() - (Date.parse(rec.at) || 0) > 86400000) dropQ(MQ, id); continue; }   // no synced trade uses it (yet)
        if (!mine()) { again = true; break; }
        const res = await req('POST', objPath(uid, id), { body: rec.blob, headers: { 'Content-Type': rec.type || rec.blob.type || 'application/octet-stream', 'x-upsert': 'true' }, timeout: 120000 });
        if (res.ok) { dropQ(MQ, id); mediaTries.delete(id); continue; }
        const er = await storageErr(res);
        if (er.jwt) { await refresh(true); again = true; break; }
        if (er.busy) { again = true; break; }   // an outage gives nothing up: everything waits and is retried
        if (er.final || tried(id) >= 5) {
          dropQ(MQ, id);
          mediaNote = er.big ? 'A screenshot larger than 10 MB stays on this device only.' : er.final ? 'A screenshot in a format the cloud does not accept stays on this device only.' : 'A screenshot could not be uploaded and stays on this device only.';
          note('media', mediaNote);
          continue;
        }
        again = true;
      }
      if (!again) mediaRetry = 0;
    } catch (e) {
      if (e && e.kind === 'auth') fail(e); else again = true;
    } finally {
      mediaBusy = false;
      if (again) scheduleMedia([10e3, 30e3, 60e3, 300e3][Math.min(mediaRetry++, 3)]);
      emitStatus();
    }
  }
  // → Promise<Blob|null>; Store.mediaURL keeps it locally under the same id
  async function fetchMedia(id) {
    if (!sess || sess.bad || !MEDIA_RE.test(String(id || '')) || !online()) return null;
    try {
      for (let i = 0; i < 2; i++) {
        const res = await req('GET', objPath(sess.user.id, id, true), { timeout: 60000, tail: 600000 });
        if (res.ok) { const b = await readBody(res, true); return b && b.size ? b : null; }
        if (i || !(await storageErr(res)).jwt) return null;
        await refresh(true);   // an expired token: renew once and ask again
      }
    } catch (e) { /* offline or signed out: no picture this time */ }
    return null;
  }
  // The cloud copy goes with the next sync (dropMedia), once nothing uses it any more
  function deleteMedia(id) {
    if (!MEDIA_RE.test(String(id || ''))) return Promise.resolve(false);
    dropQ(MQ, id);
    if (!sess && !st) return Promise.resolve(false);
    addQ(MQD, id);
    kick({}, T.debounce);
    return Promise.resolve(true);
  }

  /* ── Realtime (Phoenix over WebSocket): "something changed" → pull ── */
  const RT = (() => {
    const TOPIC = 'realtime:cj-docs';
    let ws = null, joined = false, ref = 0, joinRef = null, hb = null, hbWait = false, retry = 0, timer = null, wantUp = false;
    const url = () => BASE.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + enc(KEY) + '&vsn=1.0.0';
    const send = (m) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); } catch (e) { /* closing */ } };
    function drop() {
      clearInterval(hb); hb = null; hbWait = false;
      const w = ws; ws = null; joined = false;
      if (w) { w.onopen = w.onmessage = w.onclose = w.onerror = null; try { w.close(); } catch (e) { /* already closed */ } }
      emitStatus();
    }
    function later(renew) {
      if (!wantUp || timer) return;
      const d = [1000, 2000, 5000, 10000, 30000][Math.min(retry++, 4)];
      timer = setTimeout(() => {
        timer = null;
        if (renew) refresh(true).then(connect, (e) => { authFail(e); if (!(e && e.kind === 'auth')) later(); });
        else connect();
      }, d);
    }
    function connect() {
      if (!wantUp || ws || !sess || sess.bad || !online() || !io.hasWs || !enabled) return;
      clearTimeout(timer); timer = null;
      let w;
      try { w = io.ws(url()); } catch (e) { later(); return; }
      ws = w;
      w.onopen = () => { if (ws !== w) return; join(); clearInterval(hb); hbWait = false; hb = setInterval(beat, T.heartbeat); };
      w.onmessage = (ev) => { if (ws === w) onMsg(ev); };
      w.onclose = () => { if (ws !== w) return; ws = null; joined = false; clearInterval(hb); hb = null; emitStatus(); later(); };
      w.onerror = () => { /* onclose follows */ };
    }
    async function join() {
      let tok;
      try { tok = await accessToken(); } catch (e) { authFail(e); drop(); if (!(e && e.kind === 'auth')) later(); return; }
      if (!ws || !sess) return;
      joinRef = String(++ref);
      send({
        topic: TOPIC, event: 'phx_join', ref: joinRef, join_ref: joinRef,
        payload: { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'cj_docs', filter: 'user_id=eq.' + sess.user.id }], private: false }, access_token: tok },
      });
    }
    // no reply to the last heartbeat = a dead socket (phones drop them in the background)
    function beat() {
      if (!ws) return;
      if (hbWait) { drop(); later(); return; }
      hbWait = true;
      send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) });
    }
    function onMsg(ev) {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!isO(m)) return;
      if (m.topic === 'phoenix') { if (m.event === 'phx_reply') hbWait = false; return; }
      if (m.topic !== TOPIC) return;
      const p = isO(m.payload) ? m.payload : {};
      if (m.event === 'phx_reply' && m.ref === joinRef) {
        if (p.status === 'ok') { joined = true; retry = 0; emitStatus(); kick({ pull: true }); }   // catch up on what was missed
        else { drop(); later(true); }
        return;
      }
      // never trust the payload beyond "something changed" (a delete may mean the cloud copy went: check the index)
      if (m.event === 'postgres_changes') { changed(isO(p.data) && p.data.type === 'DELETE'); return; }
      if (m.event === 'phx_close' || m.event === 'phx_error') { drop(); later(); return; }
      if (m.event === 'system' && p.status === 'error') { drop(); later(true); }
    }
    return {
      start() { wantUp = true; connect(); },
      stop() { wantUp = false; clearTimeout(timer); timer = null; drop(); },
      // after a token refresh the open channel gets the new token
      token() { if (ws && joined && sess && !sess.bad) send({ topic: TOPIC, event: 'access_token', payload: { access_token: sess.access_token }, ref: String(++ref), join_ref: joinRef }); },
      wake() { if (!wantUp) return; retry = 0; if (!ws) { clearTimeout(timer); timer = null; connect(); } else if (!hbWait) beat(); },
      get up() { return joined; },
    };
  })();
  function changed(isDel) {
    rtDel = rtDel || !!isDel;
    clearTimeout(rtTimer);
    rtTimer = setTimeout(() => { rtTimer = null; const r = rtDel; rtDel = false; kick({ pull: true, reconcile: r }); }, T.rtDebounce);
  }
  // Every 30 s: poll while the live connection is down (page visible), and a safety pull every 5 min
  function tick() {
    if (!sess || sess.bad || !st || !st.firstSyncDone || !visible() || !online()) return;
    if (!RT.up || Date.now() - (st.lastPullAt || 0) > T.safety) kick({ pull: true });
  }
  function wake() {
    if (!sess || sess.bad) return;
    RT.wake();
    if (Date.now() - lastWake < 3000) return;
    lastWake = Date.now();
    kick({ pull: true });
  }

  /* ── Auth: actions ──────────────────────────────────────── */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function authMsg(status, j) {
    const code = isO(j) ? String(j.error_code || j.code || j.error || '') : '';
    const msg = isO(j) ? String(j.msg || j.message || j.error_description || '') : '';
    if (/invalid_credentials|invalid_grant/.test(code) || /invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/email_not_confirmed/.test(code) || /not confirmed/i.test(msg)) return 'Confirm your email first: open the link we sent you, then sign in.';
    if (/user_already_exists|email_exists/.test(code) || /already registered/i.test(msg)) return 'An account with this email already exists — sign in instead.';
    if (/weak_password/.test(code)) return msg || 'Choose a longer password.';
    if (/rate_limit/.test(code) || status === 429) return 'Too many attempts — wait a minute and try again.';
    if (/signup_disabled/.test(code)) return 'New accounts are switched off for this app.';
    if (/email_address_invalid|validation_failed/.test(code)) return "That email address doesn't look right.";
    if (status >= 500) return 'The sign-in service is having trouble — try again in a minute.';
    return msg ? msg.slice(0, 160) : `Something went wrong (HTTP ${status}).`;
  }
  const netMsg = (e) => (e && e.kind === 'net' ? 'No connection — check your internet and try again.' : e && e.kind === 'config' ? e.message : 'Something went wrong — try again.');
  function check(email, password, min) {
    if (!enabled) return 'Cloud sync is not set up in this copy of the app.';
    if (!EMAIL_RE.test(email)) return "That email address doesn't look right.";
    if (password != null && String(password).length < (min || 1)) return min > 1 ? `Use at least ${min} characters for the password.` : 'Enter your password.';
    return null;
  }
  // Email links come back to this page: the app URL when published, else wherever this copy runs
  function redirectTo() {
    let to = String(CFG.appUrl || '');
    if (!to) { try { to = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : ''; } catch (e) { to = ''; } }
    return to ? '?redirect_to=' + enc(to) : '';
  }
  async function signIn(email, password) {
    email = String(email || '').trim();
    const bad = check(email, password); if (bad) return { ok: false, error: bad };
    let res, j;
    try { res = await req('POST', '/auth/v1/token?grant_type=password', { auth: false, json: { email, password: String(password) } }); j = await readJson(res); }
    catch (e) { return { ok: false, error: netMsg(e) }; }
    if (!res.ok) return { ok: false, error: authMsg(res.status, j) };
    const s = sessionFrom(j);
    return s ? adoptSession(s) : { ok: false, error: 'The sign-in reply was not understood — try again.' };
  }
  async function signUp(email, password) {
    email = String(email || '').trim();
    const bad = check(email, password, 6); if (bad) return { ok: false, error: bad };
    let res, j;
    try { res = await req('POST', '/auth/v1/signup' + redirectTo(), { auth: false, json: { email, password: String(password) } }); j = await readJson(res); }
    catch (e) { return { ok: false, error: netMsg(e) }; }
    if (!res.ok) return { ok: false, error: authMsg(res.status, j) };
    const s = sessionFrom(j);
    if (s) return adoptSession(s);
    // email confirmation is on: the link signs this device in (see handleHash)
    return { ok: true, confirm: true, email, message: `Check ${email}: open the confirmation link, then sign in here.` };
  }
  async function resetPassword(email) {
    email = String(email || '').trim();
    const bad = check(email); if (bad) return { ok: false, error: bad };
    try {
      const res = await req('POST', '/auth/v1/recover' + redirectTo(), { auth: false, json: { email } });
      if (!res.ok) return { ok: false, error: authMsg(res.status, await readJson(res)) };
    } catch (e) { return { ok: false, error: netMsg(e) }; }
    return { ok: true, message: `If an account exists for ${email}, a reset link is on its way. Open it on this device.` };
  }
  async function updatePassword(password) {
    if (!sess || sess.bad) return { ok: false, error: 'Open the reset link again, or sign in first.' };
    if (String(password || '').length < 6) return { ok: false, error: 'Use at least 6 characters for the password.' };
    try {
      const res = await req('PUT', '/auth/v1/user', { json: { password: String(password) } });
      if (!res.ok) return { ok: false, error: authMsg(res.status, await readJson(res)) };
    } catch (e) { return { ok: false, error: e && e.kind === 'auth' ? 'This reset link has expired — ask for a new one.' : netMsg(e) }; }
    pendingRecovery = false;
    note('password', 'Your new password is saved.');
    return { ok: true };
  }
  // A new session for this device. Another person's journal is never merged into this account: switching
  // keeps a snapshot, then empties the synced parts so the new account's journal can come down.
  function adoptSession(s) {
    return lock('cj-sync', async () => {
      const cur = loadSt();
      if (cur && cur.userId && cur.userId !== s.user.id) {
        if (!(await confirmSwitch(cur, s.user))) { endRemote(s.access_token); return { ok: false, cancelled: true, error: 'Nothing changed — this device stays as it was.' }; }
        if (!(await switchUser(s.user))) { endRemote(s.access_token); return { ok: false, error: 'Stopped: this device’s journal could not be put aside safely, so nothing was changed.' }; }
      }
      if (!st || st.userId !== s.user.id) st = blankState(s.user);
      if (s.user.email) st.email = s.user.email;
      errKind = null; errMsg = null;
      saveSt();
      writeSession(s);
      return { ok: true, user: { id: s.user.id, email: s.user.email } };
    }).then((r) => {
      if (r.ok) { RT.stop(); RT.start(); kick({ reconcile: true, pull: true }); note('signin', `Signed in as ${r.user.email || 'you'}.`); }
      return r;
    });
  }
  function confirmSwitch(cur, user) {
    if (typeof confirmDialog !== 'function') return Promise.resolve(false);
    const waiting = Object.keys(cur.dirty || {}).length;
    return Promise.resolve(confirmDialog({
      title: 'Switch sync to another account?', danger: true, width: 520, confirmText: 'Switch account', cancelText: 'Cancel',
      html: `<p>The journal on this device belongs to <b>${H(cur.email || 'another account')}</b>. Signing in as <b>${H(user.email || 'this account')}</b> replaces it here with that account's journal, so the two never mix.</p>
        <p>A snapshot of the current journal is saved first (Settings → Data &amp; backups).${waiting ? ` <b>${plural(waiting, 'change')} made here ${waiting === 1 ? 'has' : 'have'} not reached ${H(cur.email || 'the other account')}'s cloud copy yet</b> and will only be in that snapshot.` : ''}</p>`,
    })).then(v => !!v);
  }
  async function switchUser(user) {
    let kept = false;
    if (typeof Store !== 'undefined' && Store.snapshot) { try { kept = (await withTimeout(Store.snapshot('Before switching sync to ' + (user.email || 'another account')), 15000)) != null; } catch (e) { kept = false; } }
    if (!kept && hasRealData(db)) {
      const go = typeof confirmDialog === 'function' && await confirmDialog({ title: 'Keep a copy first?', danger: true, confirmText: 'Download backup & continue', cancelText: 'Cancel', message: 'A safety snapshot could not be saved. Download a backup of this journal before it is replaced?' });
      if (!go) return false;
      try { if (typeof Store !== 'undefined' && Store.exportJSON) Store.exportJSON(); } catch (e) { return false; }
    }
    const fresh = explode(freshDb()), cur = explode(db);
    for (const id of cur.keys()) applyDoc(db, id, fresh.has(id) ? fresh.get(id) : null);
    for (const [id, v] of fresh) if (!cur.has(id)) applyDoc(db, id, v);
    let ok;
    selfSave = true; try { ok = save() !== false; } finally { selfSave = false; }
    if (!ok) {   // memory goes back to the copy on disk
      try { db = load({ fromSync: true }); recompute(); Bus.emit('refresh'); Bus.emit('remote', { count: 0 }); } catch (e) { /* keep going */ }
      return false;
    }
    lsDel(MQ); lsDel(MQD); lsDel(EDIT);   // the other account's screenshots never upload here
    st = blankState(user); saveSt();
    try { recompute(); } catch (e) { /* page shows it */ }
    Bus.emit('settings'); Bus.emit('refresh'); Bus.emit('remote', { count: cur.size });
    note('switched', `This device now syncs with ${user.email || 'the new account'}.`);
    return true;
  }
  // Keeps this device's journal (and its sync bookkeeping, for the same person signing in again)
  async function signOut() {
    const s = sess;
    RT.stop();
    clearTimeout(refreshTimer); refreshTimer = null;
    errKind = null; errMsg = null;
    writeSession(null);
    if (s && !s.bad) endRemote(s.access_token);
    note('signout', 'Signed out — this device keeps its journal.');
    return true;
  }
  // Deletes every synced row and screenshot of this account. Local data stays; sync turns off.
  function deleteCloud() {
    if (!sess || sess.bad) return Promise.resolve({ ok: false, error: 'Sign in first.' });
    return lock('cj-sync', async () => {
      try {
        const res = await req('DELETE', '/rest/v1/cj_docs?id=not.is.null');
        if (!res.ok) throw await httpErr(res);
      } catch (e) { return { ok: false, error: (e && e.message) || 'The cloud copy could not be deleted.' }; }
      let mediaLeft = false;
      try { await wipeMedia(); } catch (e) { mediaLeft = true; }
      lsDel(SKEY); st = null; stRaw = null; lsDel(MQ); lsDel(MQD); lsDel(EDIT);
      const s = sess;
      RT.stop(); errKind = null; errMsg = null;
      writeSession(null);
      if (s) endRemote(s.access_token);
      const msg = `Your cloud copy was deleted${mediaLeft ? ' (some screenshots may remain — try again later)' : ''}. This device keeps its journal; sync is off.`;
      note('deleted', msg);
      return { ok: true, mediaLeft, message: msg };
    });
  }
  async function wipeMedia() {
    const uid = sess.user.id;
    for (let i = 0; i < 100; i++) {
      const res = await req('POST', '/storage/v1/object/list/' + enc(BUCKET), { json: { prefix: uid, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } } });
      if (!res.ok) throw await httpErr(res);
      const list = await readJson(res);
      const names = (Array.isArray(list) ? list : []).map(o => (isO(o) && typeof o.name === 'string' ? o.name : '')).filter(n => n && n !== '.emptyFolderPlaceholder');
      if (!names.length) return;
      const del = await req('DELETE', '/storage/v1/object/' + enc(BUCKET), { json: { prefixes: names.map(n => uid + '/' + n) } });
      if (!del.ok) throw await httpErr(del);
    }
  }
  function setDeviceName(name) {
    const n = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    return lock('cj-sync', () => { loadSt(); if (st) { st.deviceName = n || guessName(); saveSt(); } emitStatus(); return !!st; });
  }
  function now() {
    if (!enabled) return Promise.resolve(false);
    if (!sess || sess.bad) { open(); return Promise.resolve(false); }
    retryN = 0;
    RT.wake();
    return runCycle({ pull: true, force: true });
  }

  /* ── Links from emails (#access_token=…&type=recovery|signup, #error=…) ── */
  // Read and removed from the address bar at once, before anything can log or bookmark them
  function handleHash() {
    let h = '';
    try { h = String(location.hash || ''); } catch (e) { return; }
    if (!/(^#|&)(access_token|error|error_code|error_description)=/.test(h)) return;
    let p = null;
    try { p = new URLSearchParams(h.slice(1)); } catch (e) { p = null; }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { try { location.hash = ''; } catch (e2) { /* nothing else to do */ } }
    if (!p) return;
    if (p.get('error') || p.get('error_code')) {
      const d = String(p.get('error_description') || '');
      linkError = /expired|invalid/i.test(d + p.get('error_code')) ? 'That email link has expired or was already used — ask for a new one.' : 'That email link did not work' + (d ? ': ' + d.slice(0, 120) : '.');
      return;
    }
    const s = sessionFrom({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: +p.get('expires_in'), expires_at: +p.get('expires_at') });
    if (s) link = { s, type: String(p.get('type') || '') };
  }
  function useLink() {
    if (linkError) { note('link-error', linkError, 'err'); linkError = null; }
    if (!link) return;
    const { s, type } = link;
    link = null;
    adoptSession(s).then((r) => {
      if (!r.ok) { if (r.error && !r.cancelled) note('link-error', r.error, 'err'); return; }
      if (type === 'recovery') { pendingRecovery = true; note('recovery', 'Choose a new password to finish the reset.'); askNewPassword(); }
      else note('confirmed', 'Email confirmed — you are signed in and your journal is syncing.', 'ok');
    });
  }

  /* ── Cross-window events ────────────────────────────────── */
  function onStorage(ev) {
    if (!ev) return;
    if (ev.key === GEN) { genSeen = ev.newValue; staleSince = 0; return; }
    if (ev.key === SKEY) { loadSt(); emitStatus(); return; }
    if (ev.key === AKEY || ev.key === null) {
      const prev = sess;
      sess = readSession();
      if (!sess || sess.bad) RT.stop();
      else if (!prev || prev.bad || prev.user.id !== sess.user.id) { loadSt(); RT.stop(); RT.start(); kick({ pull: true }); }
      else if (prev.access_token !== sess.access_token) RT.token();
      scheduleRefresh();
      if (ev.key === null) loadSt();
      emitStatus();
    }
  }

  /* ── Built-in UI (only without sync-ui.js) ──────────────── */
  let inUI = false, boxEl = null, boxClose = null, styled = false;
  const ui = () => { try { return typeof SyncUI !== 'undefined' && SyncUI ? SyncUI : null; } catch (e) { return null; } };
  function uiCall(name, ...a) {
    const u = ui();
    if (!u || typeof u[name] !== 'function' || inUI) return false;
    inUI = true;
    try { u[name](...a); return true; } catch (e) { console.error('[sync-ui]', e); return false; } finally { inUI = false; }
  }
  const ic = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const LABEL = { off: 'Sync off', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', auth: 'Sign in again', error: 'Sync problem' };
  const chipText = (s) => (s.state === 'offline' && s.pending ? `Offline · ${s.pending} waiting` : LABEL[s.state] || 'Sync');
  function style() {
    if (styled || typeof document === 'undefined' || !document.head || !document.createElement) return;
    styled = true;
    const el = document.createElement('style');
    el.id = 'cjs-style';
    el.textContent = `.cjs-chip[data-state="synced"] svg{color:var(--up)}.cjs-chip[data-state="offline"],.cjs-chip[data-state="auth"]{color:var(--amber)}.cjs-chip[data-state="error"]{color:var(--down)}
      .cjs-chip[data-state="syncing"] svg{animation:cjs-spin 1s linear infinite}@keyframes cjs-spin{to{transform:rotate(360deg)}}
      @media (max-width:860px){.cjs-chip .cjs-lbl{display:none}.cjs-chip{padding:8px}}
      .cjs-box .field{margin-top:10px}.cjs-msg{min-height:1.2em;margin-top:8px;font-size:12.5px}.cjs-msg.err{color:var(--down)}.cjs-msg.ok{color:var(--up)}
      .cjs-box .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}.cjs-box h4{margin:18px 0 6px;font-size:13px}
      .cjs-url{word-break:break-all;font-family:var(--mono);font-size:12px}
      @media (pointer:coarse){.cjs-box .input{font-size:16px}}`;
    document.head.appendChild(el);
  }
  // Topbar chip: Sync off · Synced · Syncing… · Offline · N waiting · Sign in again · Sync problem
  function chip() {
    if (!enabled || ui() || typeof document === 'undefined' || typeof document.getElementById !== 'function' || !started) return;
    let b = document.getElementById('cjs-chip');
    if (!b) {
      const ck = document.getElementById('btn-cmdk');
      if (!ck || !ck.parentNode) return;
      style();
      b = document.createElement('button');
      b.type = 'button'; b.id = 'cjs-chip'; b.className = 'tb-btn cjs-chip';
      b.addEventListener('click', () => open());
      ck.parentNode.insertBefore(b, ck);
      const live = document.createElement('span');
      live.id = 'cjs-live'; live.className = 'sr-only'; live.setAttribute('aria-live', 'polite');
      ck.parentNode.insertBefore(live, ck);
    }
    const s = statusObj(), t = chipText(s);
    const icon = { synced: 'check', syncing: 'refresh', offline: 'info', auth: 'lock', error: 'alert', off: 'refresh' }[s.state] || 'refresh';
    b.innerHTML = `${ic(icon)}<span class="cjs-lbl">${H(t)}</span>`;
    b.setAttribute('aria-label', 'Cloud sync: ' + t);
    b.title = s.lastSyncAt && typeof fmtTime === 'function' ? `Last synced ${fmtTime(s.lastSyncAt)}` : t;
    b.dataset.state = s.state;
    const live = document.getElementById('cjs-live');
    if (live && b.dataset.said !== s.state && s.state !== 'syncing') { live.textContent = 'Cloud sync: ' + t; b.dataset.said = s.state; }
    if (boxEl && boxEl.isConnected) {
      const a = document.activeElement;
      if (!(a && boxEl.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName))) renderBox(boxEl, boxClose);
    }
  }
  function open() {
    if (uiCall('open')) return;
    if (typeof Settings !== 'undefined' && Settings && Array.isArray(Settings.sections) && Settings.sections.includes('sync')) { Settings.show('sync'); return; }
    if (typeof Modal === 'undefined') return;
    style();
    let h = null;
    h = Modal.open({ title: 'Cloud sync', width: 520, body: '<div class="cjs-box"></div>', onClose: () => { boxEl = null; boxClose = null; }, onMount: (el) => renderBox(el.querySelector('.cjs-box'), () => h && h.close()) });
  }
  function renderSettings(el) {
    if (!el) return;
    if (uiCall('renderSettings', el)) return;
    style();
    el.innerHTML = '<div class="card st-card cjs-box"></div>';
    renderBox(el.firstChild, null);
  }
  const fmtAt = (t) => (t ? (typeof fmtDateTime === 'function' ? fmtDateTime(t) : new Date(t).toLocaleString()) : 'not yet');
  function renderBox(el, close) {
    if (!el) return;
    boxEl = el; boxClose = close;
    if (!enabled) { el.innerHTML = '<p class="st-p">Cloud sync is not set up in this copy of the app.</p>'; return; }
    const s = statusObj(), u = sess && sess.user;
    if (!u || sess.bad) {
      el.innerHTML = `<p class="st-p">Keep one journal on your iPhone and this computer. Each device keeps its full copy and works offline; changes sync in the background whenever you are online. Only your account can read what is synced.</p>
        <p class="st-p dim">Sign in first on the device that already has your journal, then on the other — it downloads everything. Demo data, table density and the backup folder stay on each device.</p>
        ${sess && sess.bad ? '<p class="st-p"><b>Your sign-in expired.</b> Sign in again to continue syncing — nothing on this device is lost.</p>' : ''}
        <form class="cjs-form" novalidate>
          <div class="field"><label for="cjs-email">Email</label><input class="input" id="cjs-email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" value="${H((u && u.email) || (st && st.email) || '')}"></div>
          <div class="field"><label for="cjs-pw">Password</label><input class="input" id="cjs-pw" type="password" autocomplete="current-password"></div>
          <div class="cjs-msg" role="alert"></div>
          <div class="row"><button class="btn btn-primary btn-sm" type="submit">Sign in</button><button class="btn btn-ghost btn-sm" type="button" data-cjs="up">Create account</button><button class="link-btn" type="button" data-cjs="forgot">Forgot password?</button></div>
        </form>`;
      const f = el.querySelector('form'), em = el.querySelector('#cjs-email'), pw = el.querySelector('#cjs-pw'), msg = el.querySelector('.cjs-msg');
      const say = (t, ok) => { msg.textContent = t || ''; msg.className = 'cjs-msg ' + (ok ? 'ok' : 'err'); };
      const busyBtns = (on) => el.querySelectorAll('button').forEach(b => { b.disabled = on; });
      const go = async (fn) => { busyBtns(true); try { const r = await fn(); if (!r.ok) say(r.error); else if (r.message) say(r.message, true); else if (close) close(); } finally { if (el.isConnected) busyBtns(false); } };
      f.addEventListener('submit', (ev) => { ev.preventDefault(); go(() => signIn(em.value, pw.value)); });
      el.querySelector('[data-cjs=up]').addEventListener('click', () => { pw.setAttribute('autocomplete', 'new-password'); go(() => signUp(em.value, pw.value)); });
      el.querySelector('[data-cjs=forgot]').addEventListener('click', () => go(() => resetPassword(em.value)));
      return;
    }
    const app = String(CFG.appUrl || '');
    el.innerHTML = `<p class="st-p">Signed in as <b>${H(u.email)}</b>.</p>
      <p class="st-p">${H(chipText(s))} · last synced ${H(fmtAt(s.lastSyncAt))}${s.pending ? ` · ${plural(s.pending, 'change')} waiting` : ''} · ${s.realtime ? 'live connection' : 'checking every 30 seconds'}</p>
      ${s.error ? `<p class="st-p" role="alert">${H(s.error)}</p>` : ''}
      <div class="field"><label for="cjs-dev">This device's name</label><input class="input" id="cjs-dev" maxlength="40" value="${H((st && st.deviceName) || guessName())}"></div>
      <div class="row"><button class="btn btn-primary btn-sm" type="button" data-cjs="now">${ic('refresh')}Sync now</button><button class="btn btn-ghost btn-sm" type="button" data-cjs="out">Sign out</button></div>
      <h4>Open on your iPhone</h4>
      ${app ? `<p class="st-p">Open <span class="cjs-url">${H(app)}</span> in Safari, tap Share → <b>Add to Home Screen</b>, then sign in with the same email.</p><div class="row"><button class="btn btn-ghost btn-sm" type="button" data-cjs="copy">${ic('copy')}Copy link</button></div>`
        : '<p class="st-p dim">The iPhone link appears here once the app is published online.</p>'}
      <h4>Danger zone</h4>
      <p class="st-p dim">Deletes everything this account stored in the cloud. This device keeps its journal; sync turns off.</p>
      <div class="row"><button class="btn btn-danger btn-sm" type="button" data-cjs="del">${ic('trash')}Delete cloud copy…</button></div>`;
    const on = (k, fn) => { const b = el.querySelector(`[data-cjs=${k}]`); if (b) b.addEventListener('click', fn); };
    const dev = el.querySelector('#cjs-dev');
    dev.addEventListener('change', () => setDeviceName(dev.value));
    on('now', () => now());
    on('out', () => { signOut(); if (close) close(); });
    on('copy', () => { try { navigator.clipboard.writeText(app).then(() => toast('Link copied', 'ok'), () => toast(app, 'ok', { ms: 8000 })); } catch (e) { toast(app, 'ok', { ms: 8000 }); } });
    on('del', async () => {
      const ok = typeof confirmDialog === 'function' && await confirmDialog({ title: 'Delete your cloud copy?', danger: true, requireText: 'delete', confirmText: 'Delete cloud copy', message: 'Every synced trade, journal entry and screenshot of this account is removed from the cloud. This device keeps its journal and sync turns off. Other devices keep their copies.' });
      if (!ok) return;
      const r = await deleteCloud();
      if (typeof toast === 'function') toast(r.ok ? r.message : r.error, r.ok ? 'ok' : 'err', { ms: 7000 });
    });
  }
  // "Set a new password" after a reset link (a UI failure must never break the sign-in that came with it)
  function askNewPassword() {
    try { recoveryDialog(); } catch (e) { console.error('[sync] password dialog', e); }
  }
  function recoveryDialog() {
    if (uiCall('recovery')) return;
    if (typeof Modal === 'undefined') return;
    style();
    Modal.open({
      title: 'Set a new password', width: 440,
      body: `<form class="cjs-box" novalidate><p class="st-p">Choose a new password for <b>${H(sess && sess.user ? sess.user.email : '')}</b>.</p>
        <div class="field"><label for="cjs-np">New password</label><input class="input" id="cjs-np" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="cjs-np2">Repeat it</label><input class="input" id="cjs-np2" type="password" autocomplete="new-password"></div>
        <div class="cjs-msg err" role="alert"></div><div class="row"><button class="btn btn-primary btn-sm" type="submit">Save password</button></div></form>`,
      onMount: (el, close) => {
        const f = el.querySelector('form'), msg = el.querySelector('.cjs-msg');
        f.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const a = el.querySelector('#cjs-np').value, b = el.querySelector('#cjs-np2').value;
          if (a !== b) { msg.textContent = 'The two passwords are different.'; return; }
          const r = await updatePassword(a);
          if (r.ok) { close(); if (typeof toast === 'function') toast('Password changed', 'ok'); } else msg.textContent = r.error;
        });
      },
    });
  }

  /* ── Start-up ───────────────────────────────────────────── */
  function start() {
    if (started) return;
    started = true;
    if (!enabled) { emitStatus(); return; }
    loadSt();
    sess = readSession();
    genSeen = lsGet(GEN);
    if (genSeen == null) bumpGen();
    if (sess && !sess.bad && st && st.userId && st.userId !== sess.user.id) {
      // a session for someone else than this journal's owner: go through the switch (with its confirmation)
      const s = sess; sess = null;
      adoptSession(s);
    } else if (sess && !sess.bad) {
      if (!st || st.userId !== sess.user.id) { st = blankState(sess.user); saveSt(); }
      RT.start();
      scheduleRefresh();
      kick({ reconcile: true, pull: true });
    } else if (st) kick({});
    setInterval(tick, T.poll);
    lastKey = '';
    emitStatus();
    useLink();
    if (pendingRecovery) askNewPassword();
  }
  handleHash();
  st = null; loadSt();
  sess = readSession();
  if (typeof Bus !== 'undefined') Bus.on('saved', onSaved);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', () => { if (errKind === 'net') errKind = null; retryN = 0; RT.wake(); kick({ pull: true }); scheduleMedia(1000); emitStatus(); });
    window.addEventListener('offline', () => emitStatus());
    window.addEventListener('focus', wake);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => { if (visible()) wake(); });
    // after app.js has set itself up (it listens for 'remote' and 'sync')
    const boot = () => setTimeout(start, 0);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  return {
    get enabled() { return enabled; },
    get state() { return stateNow(); },
    get user() { return sess && !sess.bad ? { id: sess.user.id, email: sess.user.email } : null; },
    get email() { return (sess && sess.user && sess.user.email) || (st && st.email) || ''; },
    get pending() { return pendingN(); },
    get status() { return Object.assign(statusObj(), { user: sess && sess.user ? { id: sess.user.id, email: sess.user.email } : null, deviceName: (st && st.deviceName) || guessName(), mediaPending: qLen(MQ), parked: parkedN(), firstSyncDone: !!(st && st.firstSyncDone), cloudGone: !!(st && st.cloudGone), appUrl: String(CFG.appUrl || '') }); },
    get deviceName() { return (st && st.deviceName) || guessName(); },
    get pendingRecovery() { return pendingRecovery; },
    clearRecovery() { pendingRecovery = false; },
    open, renderSettings, now, signIn, signUp, signOut, resetPassword, updatePassword, deleteCloud, setDeviceName,
    queueMedia, fetchMedia, deleteMedia,
    explode, applyDoc, hash,
    // aliases other modules may reach for
    syncNow: now, recover: resetPassword, setPassword: updatePassword, deleteCloudCopy: deleteCloud,
    // pure parts + seams for dev/sync-sim.js and tests.html
    _core: {
      T, io, explode, applyDoc, hash, canon, parseId, validDoc, detect, decide, pushResult, planFirst, parseTs, maxTs, hasRealData, safeClone, ovrKey, normWhole, cleanStr, sessionFrom,
      state: () => st, session: () => sess, get skew() { return skew; }, cycle: (o) => runCycle(o || {}), look, mediaRun, rt: RT,
    },
  };
})();
