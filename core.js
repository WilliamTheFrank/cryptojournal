/* ═══════════════════════════════════════════════════════════
   CryptoJournal — core: data model, settings, formatting and
   shared UI primitives used by every page module.

   Load order: engine.js → metrics.js → charts.js → core.js →
   market.js → media.js → (page modules) → app.js
   Page modules register themselves with Pages.register(id, def)
   and re-render on Bus events; they never touch each other.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ─── Storage keys & versions ──────────────────────────── */
const DB_KEY = 'kryptojournal.v1';   // kept for continuity with existing user data
const DB_VERSION = 2;
const MODES = ['paper', 'live', 'demo'];
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

/* ─── Default taxonomies (from the research) ───────────── */
const DEFAULT_TASKS = [
  { id: 't1', name: 'Watching lectures', time: '30 M', stage: 'prepare' },
  { id: 't2', name: 'Sharing in Discord what I learned', time: '10 M', stage: 'reflect' },
  { id: 't3', name: 'Application of what I learned', time: '1 H', stage: 'trade' },
  { id: 't4', name: 'Reading book', time: '30 M', stage: 'prepare' },
  { id: 't5', name: 'Trade only your system', time: '', stage: 'trade' },
  { id: 't6', name: 'Strictly follow criteria for system', time: '', stage: 'trade' },
  { id: 't7', name: 'Max 1% risk of account in a single trade', time: '', stage: 'trade' },
  { id: 't8', name: 'Record trades in journal', time: '', stage: 'reflect' },
  { id: 't9', name: 'Affirmation (morning and night)', time: '', stage: 'prepare' },
  { id: 't10', name: "Think about your why's", time: '', stage: 'prepare' },
];
const DEFAULT_STRATEGIES = [
  { id: 's1', name: 'MM with Protection', tf: '', indicators: '', entry: [], exit: [], notes: '', minRR: 1.5 },
  { id: 's2', name: 'MM no Protection', tf: '', indicators: '', entry: [], exit: [], notes: '', minRR: 1.5 },
  { id: 's3', name: 'Swing Trader', tf: '', indicators: '', entry: [], exit: [], notes: '', minRR: 2 },
  { id: 's4', name: 'Invincible Scalper', tf: '', indicators: '', entry: [], exit: [], notes: '', minRR: 1.2 },
];
// Mistake taxonomy (practitioner list, groups for the report). 'none' = reviewed & clean.
const DEFAULT_MISTAKES = [
  { id: 'fomo', label: 'FOMO / chased entry', group: 'entry' },
  { id: 'late_entry', label: 'Hesitated / late entry', group: 'entry', minor: true },
  { id: 'no_plan', label: 'No plan / not in playbook', group: 'entry', severe: true },
  { id: 'ignored_setup', label: 'Broke setup rules', group: 'entry' },
  { id: 'oversize', label: 'Oversized (risk above plan)', group: 'risk', severe: true },
  { id: 'no_stop', label: 'No stop set', group: 'risk', severe: true },
  { id: 'moved_stop', label: 'Moved / widened stop', group: 'management', severe: true },
  { id: 'held_loser', label: 'Held loser past stop', group: 'management' },
  { id: 'early_exit', label: 'Exited early (fear)', group: 'exit', minor: true },
  { id: 'no_tp', label: "Didn't take profit at target", group: 'exit', minor: true },
  { id: 'revenge', label: 'Revenge trade', group: 'mindset', severe: true },
  { id: 'overtrading', label: 'Overtrading (over daily limit)', group: 'mindset' },
  { id: 'boredom', label: 'Boredom / impulse trade', group: 'mindset' },
  { id: 'overconfidence', label: 'Overconfidence after wins', group: 'mindset' },
  { id: 'exec_error', label: 'Execution error (size/side/slippage)', group: 'execution' },
];
const EMOTIONS_PRE = [
  { id: 'calm', label: 'Calm / focused', tone: 'calm' }, { id: 'confident', label: 'Confident', tone: 'calm' },
  { id: 'anxious', label: 'Anxious', tone: 'neg' }, { id: 'fearful', label: 'Fearful', tone: 'neg' },
  { id: 'fomo', label: 'FOMO / excited', tone: 'hot' }, { id: 'frustrated', label: 'Frustrated / angry', tone: 'neg' },
  { id: 'bored', label: 'Bored', tone: 'neg' }, { id: 'tired', label: 'Tired', tone: 'neg' },
  { id: 'euphoric', label: 'Euphoric / overconfident', tone: 'hot' }, { id: 'winback', label: 'Wants to win back', tone: 'neg' },
];
const EMOTIONS_POST = [
  { id: 'satisfied', label: 'Satisfied', tone: 'calm' }, { id: 'relieved', label: 'Relieved', tone: 'calm' },
  { id: 'regretful', label: 'Regretful', tone: 'neg' }, { id: 'frustrated', label: 'Frustrated', tone: 'neg' },
  { id: 'euphoric', label: 'Euphoric', tone: 'hot' }, { id: 'indifferent', label: 'Indifferent', tone: 'calm' },
];
const DEFAULT_TAG_GROUPS = [
  { id: 'market', name: 'Market condition', tags: ['Trending up', 'Trending down', 'Ranging', 'News / volatile', 'BTC dumping'] },
  { id: 'tf', name: 'Timeframe', tags: ['5m', '15m', '1h', '4h', '1D'] },
  { id: 'custom', name: 'Custom', tags: [] },
];
const VENUES = ['Binance', 'Bybit', 'OKX', 'Coinbase', 'Kraken', 'MEXC', 'PulseX', '9mm', 'Other'];
const MARKETS = [{ id: 'spot', label: 'Spot' }, { id: 'perp', label: 'Perpetual' }, { id: 'dex', label: 'DEX swap' }];
// Correlation clusters for open-risk ("heat"): positions in one cluster are largely one bet.
const CLUSTERS = {
  pulse: { label: 'PulseChain', coins: ['PLS', 'WPLS', 'PLSX', 'HEX', 'PHEX', 'INC', 'EHEX'] },
  majors: { label: 'BTC / ETH / SOL', coins: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'WBTC', 'WETH'] },
};
const clusterOf = (coin) => { const c = (coin || '').toUpperCase(); for (const [id, v] of Object.entries(CLUSTERS)) if (v.coins.includes(c)) return id; return 'alts'; };
// Base-tier fee presets in % per side (editable defaults — verify on your own account page).
// DEX swap fees (PulseX 0.29%) are already inside the executed price; never add them on top.
const FEE_PRESETS = {
  'Binance|spot': { maker: 0.1, taker: 0.1 }, 'Binance|perp': { maker: 0.02, taker: 0.05 },
  'Bybit|spot': { maker: 0.1, taker: 0.1 }, 'Bybit|perp': { maker: 0.02, taker: 0.055 },
  'OKX|spot': { maker: 0.08, taker: 0.1 }, 'OKX|perp': { maker: 0.02, taker: 0.05 },
  'Kraken|spot': { maker: 0.4, taker: 0.8 }, 'Kraken|perp': { maker: 0.02, taker: 0.05 },
  'Coinbase|spot': { maker: 0.5, taker: 0.9 }, 'MEXC|spot': { maker: 0, taker: 0.05 },
  'PulseX|dex': { maker: 0, taker: 0, swap: 0.29 },
};

const DEFAULT_SETTINGS = {
  // Soft circuit breakers — beginner defaults (opinion, user-editable; see research)
  risk: {
    maxRiskPct: 1, maxDailyLossPct: 3, maxWeeklyLossPct: 6, maxConsecLosses: 3, cooldownMin: 30,
    maxTradesDay: 5, maxOpenRiskPct: 3, maxClusterRiskPct: 2, maxLeverage: 5, maxCostR: 0.25,
    requireStop: true, requireStrategy: true, dayResetHour: 0,
  },
  // Round-trip cost assumptions used to haircut paper results (per side, %)
  costs: { cexFeePct: 0.1, cexSlipPct: 0.05, dexFeePct: 0.29, dexSlipPct: 0.5, dexCoins: ['PLS', 'PLSX', 'HEX', 'PHEX', 'INC'] },
  fees: { presets: clone(FEE_PRESETS), checked: '2026-10', defaultVenue: 'Binance', defaultMarket: 'spot', autoFillPaper: true },
  beBandR: 0,                  // |net R| below this counts as breakeven ("scratch"); 0 = off
  sessionScheme: 'dst',        // 'dst' (Tokyo/London/NY local hours) | 'utc' (fixed UTC blocks)
  cgDemoKey: '',               // optional CoinGecko Demo key (100 calls/min)
  plannedLiveCapital: null,
  palette: 'classic',          // 'classic' | 'cvd' (blue/orange colour-blind safe)
  units: '$',                  // '$' | '%' | 'R'
  density: 'comfortable',      // ledger row density
  ledgerCols: null,            // null = defaults
  onboardingDismissed: false,
  advancedFields: false,       // show perp/DEX/excursion fields in the trade form by default
  ramp: { enabled: true, stage: 1, stageStartAt: null },
  backup: { lastExportAt: null, lastFolderAt: null, folderName: '', autoFolder: false },
};

/* ─── Fresh db & sanitising migration ──────────────────── */
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function freshAccount(start) { return { startingBalance: start, startDate: todayISO(), entries: [] }; }
function freshDb() {
  return {
    version: DB_VERSION,
    mode: 'paper',
    accounts: { paper: freshAccount(10000), live: freshAccount(0), demo: freshAccount(10000) },
    strategies: clone(DEFAULT_STRATEGIES),
    routine: { tasks: clone(DEFAULT_TASKS), weeks: {} },
    backtest: { start: 1000, riskPct: 1, points: [] },
    coinIds: {},
    seq: 1,
    settings: clone(DEFAULT_SETTINGS),
    mistakes: clone(DEFAULT_MISTAKES),
    tagGroups: clone(DEFAULT_TAG_GROUPS),
    days: { paper: {}, live: {}, demo: {} },      // daily journal: pre/post/readiness/goal
    reviews: { paper: {}, live: {}, demo: {} },   // weekly / monthly reviews
    missed: { paper: [], live: [], demo: [] },    // missed-trade log
    overrides: [],                                 // guardrail overrides (violations)
    readinessHistory: [],
    importPresets: [],
    views: [],
    prevMode: null,
  };
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const numOr = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
function sanitizeAccount(a, dflt) {
  if (!isObj(a)) return dflt;
  return {
    startingBalance: numOr(a.startingBalance, dflt.startingBalance),
    startDate: typeof a.startDate === 'string' ? a.startDate : dflt.startDate,
    entries: Array.isArray(a.entries) ? a.entries.filter(isObj) : [],
  };
}
function mergeShallow(dflt, v) {
  if (!isObj(v)) return clone(dflt);
  const out = clone(dflt);
  for (const k of Object.keys(dflt)) {
    if (!(k in v)) continue;
    if (isObj(dflt[k])) out[k] = mergeShallow(dflt[k], v[k]);
    else if (Array.isArray(dflt[k])) out[k] = Array.isArray(v[k]) ? v[k] : out[k];
    else if (dflt[k] === null || typeof dflt[k] === typeof v[k]) out[k] = v[k];
  }
  return out;
}
// Settings: typed merge onto the defaults, plus (a) custom fee presets ('Venue|market' → numeric rates)
// and (b) top-level keys added by newer modules, so a reload or backup restore never drops them.
function sanitizeSettings(v) {
  const out = mergeShallow(DEFAULT_SETTINGS, v);
  if (!isObj(v)) return out;
  const up = isObj(v.fees) && isObj(v.fees.presets) ? v.fees.presets : null;
  if (up) for (const [k, p] of Object.entries(up)) {
    if (!isObj(p) || !/^[\w .&-]{1,40}\|(spot|perp|dex)$/.test(k)) continue;
    // null = the user cleared that rate on purpose (kept, so a built-in default doesn't come back on reload)
    const nums = {}; for (const [f, x] of Object.entries(p)) if (x === null || (typeof x === 'number' && isFinite(x) && x >= 0 && x < 10)) nums[f] = x;
    out.fees.presets[k] = { ...(out.fees.presets[k] || {}), ...nums };
  }
  for (const [k, x] of Object.entries(v)) if (!(k in DEFAULT_SETTINGS) && k !== '__proto__' && x !== undefined) out[k] = x;
  return out;
}
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
const perMode = (v, kind) => {
  const out = {};
  for (const m of MODES) out[m] = isObj(v) && (kind === 'arr' ? Array.isArray(v[m]) : isObj(v[m])) ? v[m] : (kind === 'arr' ? [] : {});
  return out;
};
// Merge a loaded/imported object onto a fresh db, key by key with type checks —
// a partial or hand-edited backup can never produce a shape that crashes the app.
function sanitize(d) {
  const base = freshDb();
  if (!isObj(d)) return base;
  const acc = isObj(d.accounts) ? d.accounts : {};
  // Unknown top-level keys (from a newer version or a future feature) are passed through, never dropped.
  const extras = {};
  for (const k of Object.keys(d)) if (!(k in base)) extras[k] = d[k];
  return {
    ...extras,
    version: DB_VERSION,
    mode: MODES.includes(d.mode) ? d.mode : 'paper',
    accounts: {
      paper: sanitizeAccount(acc.paper, base.accounts.paper),
      live: sanitizeAccount(acc.live, base.accounts.live),
      demo: sanitizeAccount(acc.demo, base.accounts.demo),
    },
    strategies: Array.isArray(d.strategies) ? d.strategies.filter(isObj).map(s => ({
      ...s, entry: Array.isArray(s.entry) ? s.entry : [], exit: Array.isArray(s.exit) ? s.exit : [],
      minRR: numOr(s.minRR, 1.5),
    })) : base.strategies,
    routine: {
      // ids index plain objects (routine.weeks) — reject prototype-polluting names from imported backups
      tasks: isObj(d.routine) && Array.isArray(d.routine.tasks) ? d.routine.tasks.filter(t => isObj(t) && typeof t.id === 'string' && !UNSAFE_KEYS.includes(t.id)) : base.routine.tasks,
      weeks: isObj(d.routine) && isObj(d.routine.weeks) ? d.routine.weeks : {},
    },
    backtest: {
      start: numOr(isObj(d.backtest) ? d.backtest.start : undefined, base.backtest.start),
      riskPct: numOr(isObj(d.backtest) ? d.backtest.riskPct : undefined, base.backtest.riskPct),
      points: isObj(d.backtest) && Array.isArray(d.backtest.points) ? d.backtest.points : [],
    },
    coinIds: isObj(d.coinIds) ? d.coinIds : {},
    seq: numOr(d.seq, base.seq),
    settings: sanitizeSettings(d.settings),
    mistakes: Array.isArray(d.mistakes) ? d.mistakes.filter(m => isObj(m) && m.id && m.label) : base.mistakes,
    tagGroups: Array.isArray(d.tagGroups) ? d.tagGroups.filter(g => isObj(g) && g.id && Array.isArray(g.tags)) : base.tagGroups,
    days: perMode(d.days, 'obj'),
    reviews: perMode(d.reviews, 'obj'),
    missed: perMode(d.missed, 'arr'),
    overrides: Array.isArray(d.overrides) ? d.overrides : [],
    readinessHistory: Array.isArray(d.readinessHistory) ? d.readinessHistory.slice(-400) : [],
    importPresets: Array.isArray(d.importPresets) ? d.importPresets : [],
    views: Array.isArray(d.views) ? d.views : [],
    prevMode: MODES.includes(d.prevMode) ? d.prevMode : null,
  };
}

/* ─── Schema migrations (ordered; each takes the raw object of version n → n+1) ── */
const MIGRATIONS = {
  // v1 → v2: new top-level stores are created by sanitize(); entries keep every field.
  1: (d) => { d.migratedFrom = 1; return d; },
};
function migrate(d) {
  let v = numOr(d.version, 1);
  while (v < DB_VERSION && MIGRATIONS[v]) { d = MIGRATIONS[v](d) || d; v++; d.version = v; }
  return d;
}

/* ─── Load / save ──────────────────────────────────────── */
// StorageGuard: if the saved journal cannot be parsed we keep the raw text under a
// separate key and refuse to overwrite DB_KEY until the user decides (app.js banner).
const StorageGuard = { loadError: null, corruptKey: null, pendingSnapshots: [] };
const PURGE_DAYS = 30;
let db = load();
// opts.fromSync: re-reading after another window saved — no upgrade/purge bookkeeping
// (that window already did it, and its snapshots were taken there).
function load(opts) {
  const sync = !!(opts && opts.fromSync);
  let raw = null;
  try { raw = localStorage.getItem(DB_KEY); } catch (e) { return freshDb(); }
  if (!raw) return freshDb();
  try {
    const d = JSON.parse(raw);
    if (!d || !d.accounts) throw new Error('missing accounts');
    if (!sync && numOr(d.version, 1) < DB_VERSION) StorageGuard.pendingSnapshots.push({ reason: `Before upgrade to v${DB_VERSION}`, raw });
    const out = sanitize(migrate(d));
    if (sync) return out;
    // Purge soft-deleted entries older than 30 days (a snapshot is taken first by store.js)
    const cutoff = Date.now() - PURGE_DAYS * 86400000;
    let purged = 0;
    const gone = new Set();
    for (const m of MODES) {
      const a = out.accounts[m], before = a.entries.length;
      a.entries = a.entries.filter(e => { const old = e.deletedAt && Date.parse(e.deletedAt) < cutoff; if (old) gone.add(e.id); return !old; });
      purged += before - a.entries.length;
    }
    // Guardrail overrides of purged trades go with them (ramp overrides have tradeId null and stay)
    if (gone.size) out.overrides = out.overrides.filter(o => !o || !o.tradeId || !gone.has(o.tradeId));
    if (purged) StorageGuard.pendingSnapshots.push({ reason: `Before purging ${purged} trashed entr${purged === 1 ? 'y' : 'ies'}`, raw });
    return out;
  } catch (e) {
    const key = 'cj.corrupt.' + Date.now();
    try { localStorage.setItem(key, raw); } catch (e2) { /* quota — raw stays in DB_KEY untouched */ }
    StorageGuard.loadError = String(e && e.message || e);
    StorageGuard.corruptKey = key;
    return freshDb();
  }
}
function save() {
  if (StorageGuard.loadError) { toast('Not saved — resolve the storage warning at the top of the page first', 'err'); return false; }
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); Bus.emit('saved'); return true; }
  catch (e) { toast('Storage is full — export a backup and remove old screenshots', 'err'); return false; }
}
// Called by the recovery banner once the user chose to start fresh or restored a backup.
function resolveLoadError() { StorageGuard.loadError = null; save(); }
// Replace the whole db (backup restore / snapshot restore). The current journal must be kept first:
// a snapshot, or — if that fails — a downloaded backup the user agrees to. Returns false if aborted.
async function replaceDb(next, reason) {
  let kept = false, why = 'snapshots are unavailable in this browser';
  if (typeof Store !== 'undefined' && Store.snapshot) {
    try { kept = (await Store.snapshot(reason || 'Before restore')) != null; if (!kept) why = 'the snapshot was not stored'; }
    catch (e) { why = String(e && e.message || e); }
  }
  if (!kept && totalEntries() > 0) {
    const go = await confirmDialog({
      title: 'Keep a copy first?', danger: true,
      message: `A safety snapshot of your current journal could not be saved (${why}). Download a backup of it before it is replaced?`,
      confirmText: 'Download backup & continue', cancelText: 'Cancel — change nothing',
    });
    if (!go) return false;
    try { if (typeof Store !== 'undefined' && Store.exportJSON) Store.exportJSON(); else download(`cryptojournal-backup-${todayISO()}.json`, JSON.stringify(db), 'application/json'); } catch (e) { return false; }
  }
  db = sanitize(migrate(next));
  StorageGuard.loadError = null;
  const ok = save(); applyTheme(); refresh();
  return ok;
}
const totalEntries = () => MODES.reduce((s, m) => s + ((db.accounts[m] || {}).entries || []).length, 0);

/* ─── Soft delete with Undo ────────────────────────────── */
// Deleting a parent trade also trashes its scale rows. Restorable from Settings → Trash for 30 days.
function softDelete(ids, label) {
  const a = acct(), set = new Set(ids);
  for (const e of a.entries) if (set.has(e.parentId)) set.add(e.id);
  const now = new Date().toISOString(), hit = [];
  for (const e of a.entries) if (set.has(e.id) && !e.deletedAt) { e.deletedAt = now; hit.push(e.id); }
  if (!hit.length) return;
  if (!commit()) { // not on disk → put memory back the way disk has it
    const back = new Set(hit);
    for (const e of a.entries) if (back.has(e.id)) delete e.deletedAt;
    refresh(); return;
  }
  toast(label || `Deleted ${hit.length} entr${hit.length === 1 ? 'y' : 'ies'}`, 'ok', {
    ms: 9000, action: { label: 'Undo', run: () => { restoreEntries(hit); } },
  });
}
// Restoring skips an imported trade whose exchange id was imported again while it sat in Trash
// (otherwise its P/L would count twice).
function restoreEntries(ids) {
  const set = new Set(ids);
  let n = 0, dup = 0;
  for (const m of MODES) {
    const es = db.accounts[m].entries;
    const liveExt = new Set(es.filter(e => !e.deletedAt && e.extId).map(e => e.extId));
    const skip = new Set();
    for (const e of es) if (set.has(e.id) && e.deletedAt && e.extId && liveExt.has(e.extId)) skip.add(e.id);
    for (const e of es) if (skip.has(e.parentId)) skip.add(e.id);
    for (const e of es) if (set.has(e.id) && e.deletedAt) { if (skip.has(e.id)) dup++; else { delete e.deletedAt; n++; } }
  }
  commit(n ? `Restored ${n} entr${n === 1 ? 'y' : 'ies'}` : null, 'ok');
  if (dup) toast(`${dup} entr${dup === 1 ? 'y was' : 'ies were'} left in Trash — already imported again`, 'warn');
}
const liveEntries = (mode) => acct(mode).entries.filter(e => !e.deletedAt);
// An entry that still exists (not in Trash) — editors must re-check this before saving
const liveById = (id, mode) => { const e = entryById(id, mode); return e && !e.deletedAt ? e : null; };
// Guardrail overrides of one account whose trade still exists (ramp overrides with tradeId null always count)
function liveOverrides(mode) {
  const ids = new Set(liveEntries(mode).map(e => e.id));
  return (db.overrides || []).filter(o => o && o.mode === mode && (!o.tradeId || ids.has(o.tradeId)));
}
// Can % returns / drawdowns be measured? Needs money in the account (start, deposits or a set-balance row).
const balanceMeasurable = (c) => !!c && (c.startingBalance > 0 || c.deposits > 0 || (c.rows || []).some(r => r.type === 'adjustment' && isNum(r.balance) && r.balance > 0));
// Trades that count as real activity (demo excluded) — for backup reminders etc.
const realTradeCount = () => ['paper', 'live'].reduce((s, m) => s + liveEntries(m).filter(e => e.type === 'trade').length, 0);
// Entry CRUD helpers — callers then commit(msg) to save + recompute + re-render.
function addEntry(fields, mode) {
  const e = { id: uid(), ...fields };
  e.seq = db.seq; e.createdAt = new Date().toISOString();
  acct(mode).entries.push(e);
  return e;
}
function entryById(id, mode) { return acct(mode).entries.find(x => x.id === id) || null; }
function updateEntry(id, patch, mode) {
  const e = entryById(id, mode); if (!e) return null;
  Object.assign(e, patch, { updatedAt: new Date().toISOString() });
  return e;
}
const groupById = (tradeId) => (C ? C.groups.find(g => g.trade.id === tradeId) || null : null);
const acct = (mode) => db.accounts[mode || db.mode];
const S = () => db.settings;
// Ids are unique across devices: time + per-device sequence + a random per-device tag
// (synced devices must never mint the same id for different trades).
const DEVICE_TAG = (() => {
  try {
    let t = localStorage.getItem('cj.dev');
    if (!t || !/^[a-z0-9]{3,8}$/.test(t)) { t = Math.random().toString(36).slice(2, 6).padEnd(4, '0'); localStorage.setItem('cj.dev', t); }
    return t;
  } catch (e) { return Math.random().toString(36).slice(2, 6); }
})();
function uid(prefix) { return (prefix || 'e') + Date.now().toString(36) + (db.seq++).toString(36) + DEVICE_TAG; }
function dayRec(key, create) {
  const store = db.days[db.mode] || (db.days[db.mode] = {});
  if (!store[key] && create) store[key] = {};
  return store[key] || null;
}
function strategyById(id) { return db.strategies.find(s => s.id === id) || null; }
function stratName(id) { const s = db.strategies.find(s => s.id === id || s.name === id); return s ? s.name : (id || '—'); }
function mistakeLabel(id) { if (id === 'none') return 'Clean trade'; const m = db.mistakes.find(x => x.id === id); return m ? m.label : id; }
// Effective max risk per trade: in live mode the staged ramp caps it (0.25 → 0.5 → 0.75 → 1%).
const RAMP_STAGES = [null, 0.25, 0.5, 0.75, 1.0];
function riskCapFor(mode) {
  const r = S().risk.maxRiskPct;
  if (mode === 'live' && S().ramp.enabled) return Math.min(r, RAMP_STAGES[S().ramp.stage] || r);
  return r;
}
function effectiveMaxRisk() { return riskCapFor(db.mode); }

/* ─── Computation cache ────────────────────────────────── */
let C = null;      // Engine.compute() of the active account
const engineOpts = () => ({ beBandR: S().beBandR || 0 });
function recompute() { C = Engine.compute(acct(), engineOpts()); return C; }
function computeFor(mode) { return mode === db.mode && C ? C : Engine.compute(acct(mode), engineOpts()); }
// Context object every Metrics.* call takes (risk rules, cost model, playbook…).
// mode: which account the groups come from (defaults to the active one) — the live ramp cap
// must not be applied when judging paper trades.
const metricsCtx = (c, mode) => ({
  startingBalance: (c || C).startingBalance, now: Date.now(),
  riskPerTradePct: riskCapFor(mode || db.mode), liveRiskPct: S().risk.maxRiskPct,
  costs: S().costs, rules: S().risk, resetHour: S().risk.dayResetHour, maxDailyLossPct: S().risk.maxDailyLossPct,
  strategies: db.strategies, sessionScheme: S().sessionScheme, plannedLiveCapital: S().plannedLiveCapital,
});

/* ─── Event bus & page registry ────────────────────────── */
const Bus = (() => {
  const h = {};
  return {
    on(e, f) { (h[e] = h[e] || []).push(f); },
    emit(e, d) { for (const f of (h[e] || [])) { try { f(d); } catch (err) { console.error('[Bus]', e, err); } } },
  };
})();
// def: { title, sub(): string, render(sectionEl), onLeave?() }
const Pages = (() => {
  const map = new Map();
  return { register(id, def) { map.set(id, def); }, get(id) { return map.get(id); }, has(id) { return map.has(id); }, ids() { return [...map.keys()]; } };
})();
const Router = (() => {
  let active = 'dash';
  function section(id) { return document.querySelector(`.page[data-page="${id}"]`); }
  function render() {
    const def = Pages.get(active), el = section(active);
    if (!def || !el) return;
    try { def.render(el); }
    catch (err) {
      console.error('[page:' + active + ']', err);
      el.innerHTML = `<div class="card"><div class="card-title">This page hit an error</div><div class="muted">${esc(err.message)}</div></div>`;
    }
    Bus.emit('page', active);
  }
  function go(id, opts) {
    if (!Pages.has(id)) return;
    const prev = Pages.get(active);
    if (prev && prev.onLeave && id !== active) { try { prev.onLeave(); } catch (e) { /* ignore */ } }
    active = id;
    const swap = () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === id));
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.dataset.page === id));
      render();
      if (!opts || !opts.keepScroll) { const c = document.getElementById('content'); if (c) c.scrollTop = 0; }
    };
    // opts.instant: first paint / programmatic jumps skip the cross-fade (also avoids a stuck
    // transition overlay when the window is in the background)
    const instant = (opts && opts.instant) || document.hidden;
    if (!instant && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const vt = document.startViewTransition(swap);
      // A newer navigation skips the running transition; its promises then reject harmlessly
      for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) if (p && p.catch) p.catch(() => {});
    } else swap();
  }
  return { go, render, get active() { return active; } };
})();
function refresh() { recompute(); Bus.emit('refresh'); Router.render(); }
// Returns whether the save reached disk; the success toast only shows when it did (save() toasts the error).
function commit(msg, kind) { const ok = save(); refresh(); if (msg && ok) toast(msg, kind); return ok; }

/* ─── Formatting ───────────────────────────────────────── */
const MINUS = '−';
const isNum = (v) => typeof v === 'number' && isFinite(v);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const signed = (v, s, opts) => (v < 0 ? MINUS : (opts && opts.sign && v > 0 ? '+' : '')) + s;

function fmtMoney(v, opts) {
  if (!isNum(v)) return '—';
  const abs = Math.abs(v), o = opts || {};
  if (o.compact && abs >= 10000) return signed(v, '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(abs), o);
  const dec = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs > 0 ? Math.min(6, Math.max(2, 2 - Math.floor(Math.log10(abs)))) : 2;
  return signed(v, '$' + abs.toLocaleString('en-US', { minimumFractionDigits: o.dp != null ? o.dp : dec, maximumFractionDigits: o.dp != null ? o.dp : dec }), o);
}
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const toSub = (n) => String(n).split('').map(c => SUBS[+c] || c).join('');
// Prices: ≥100 → 2dp; 1–100 → up to 4dp; 0.001–1 → 4 significant; <0.001 → subscript-zero (0.0₅67)
function priceParts(v) {
  const a = Math.abs(v);
  if (a === 0) return { text: '0.00' };
  if (a >= 100) return { text: a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
  if (a >= 1) return { text: a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) };
  if (a >= 0.001) return { text: a.toLocaleString('en-US', { maximumSignificantDigits: 4 }) };
  const [mant, ex] = a.toExponential(3).split('e');
  const zeros = -parseInt(ex, 10) - 1;
  const digits = mant.replace('.', '').replace(/0+$/, '') || '0';
  return { zeros, digits };
}
function fmtPrice(v) {           // HTML (uses <sub>) — for DOM
  if (!isNum(v)) return '—';
  const p = priceParts(v), s = v < 0 ? MINUS : '';
  return p.text != null ? s + p.text : `<span class="px" title="${esc(String(v))}">${s}0.0<sub>${p.zeros}</sub>${p.digits}</span>`;
}
function fmtPriceText(v) {       // plain text (unicode subscripts) — for canvas, titles, toasts
  if (!isNum(v)) return '—';
  const p = priceParts(v), s = v < 0 ? MINUS : '';
  return p.text != null ? s + p.text : `${s}0.0${toSub(p.zeros)}${p.digits}`;
}
function fmtNum(v, dec) { return isNum(v) ? signed(v, Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: dec == null ? 4 : dec })) : '—'; }
function fmtQty(v) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: a >= 1 ? 4 : 8 });
}
function fmtPct(v, opts) {
  if (!isNum(v)) return '—';
  const o = opts || {};
  return signed(v, (Math.abs(v) * 100).toLocaleString('en-US', { maximumFractionDigits: o.dp != null ? o.dp : 2, minimumFractionDigits: o.min || 0 }) + '%', o);
}
function fmtR(v, dp) { return isNum(v) ? signed(v, Math.abs(v).toFixed(dp == null ? 2 : dp) + 'R', { sign: true }) : '—'; }
function fmtCompact(v) { return isNum(v) ? signed(v, new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(v))) : '—'; }
function fmtPF(v) { return v == null ? '—' : v === Infinity ? 'n/a' : v.toFixed(2); }
const fmtDuration = (ms) => Engine.fmtDuration(ms);
function fmtDate(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateShort(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtDateTime(t) { const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function fmtTime(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function nowLocalInput(d) { d = d ? new Date(d) : new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function plClass(v) { return !isNum(v) ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
const glyph = (v) => (!isNum(v) || v === 0 ? '' : v > 0 ? '▲' : '▼');
// Wrap money so privacy mode can blur it
const money = (v, opts) => `<span class="money">${fmtMoney(v, opts)}</span>`;

/* ─── Unit view ($ / % / R) and privacy ────────────────── */
// obj: { netPL, changePct, R }  (a closed group or a summary-like object)
function fmtUnit(obj, opts) {
  const u = S().units;
  if (u === 'R') return fmtR(obj.R != null ? obj.R : null);
  if (u === '%') return fmtPct(obj.changePct, { sign: true });
  return fmtMoney(obj.netPL, { sign: true, ...(opts || {}) });
}
const View = {
  get privacy() { return document.documentElement.classList.contains('privacy'); },
  setPrivacy(on) { document.documentElement.classList.toggle('privacy', !!on); try { localStorage.setItem('cj.privacy', on ? '1' : '0'); } catch (e) { /* ok */ } Bus.emit('view'); Router.render(); },
  setUnits(u) { S().units = u; save(); Bus.emit('view'); Router.render(); },
  // axis formatter for money that respects privacy
  axisMoney(v) { return View.privacy ? '•••' : (Math.abs(v) >= 1000 ? (v < 0 ? MINUS : '') + '$' + fmtCompact(Math.abs(v)).replace(MINUS, '') : fmtMoney(v, { dp: 0 })); },
};
function applyTheme() {
  const html = document.documentElement;
  html.dataset.palette = S().palette === 'cvd' ? 'cvd' : 'classic';
  html.dataset.mode = db.mode;
  html.dataset.density = S().density === 'compact' ? 'compact' : 'comfortable';
  if (typeof Metrics !== 'undefined') Metrics.config.sessionScheme = S().sessionScheme === 'utc' ? 'utc' : 'dst';
  try { if (localStorage.getItem('cj.privacy') === '1') html.classList.add('privacy'); } catch (e) { /* ok */ }
}

/* ─── Sample-size confidence (research tiers) ──────────── */
function confTier(n) {
  if (n >= 100) return { tier: 4, label: 'Meaningful', cls: 'c4' };
  if (n >= 50) return { tier: 3, label: 'Developing', cls: 'c3' };
  if (n >= 20) return { tier: 2, label: 'Early', cls: 'c2' };
  return { tier: 1, label: 'Insufficient', cls: 'c1' };
}
const confBadge = (n, unit) => { const t = confTier(n); return `<span class="conf ${t.cls}" title="Sample size: ${n} ${unit || 'trades'}. Tiers: <20 insufficient · 20–49 early · 50–99 developing · 100+ meaningful">n=${n} · ${t.label}</span>`; };

/* ─── Toast ────────────────────────────────────────────── */
// toast(msg, kind 'ok'|'err'|'warn', { action: { label, run }, ms })
function toast(msg, kind, opts) {
  const wrap = document.getElementById('toast-wrap'); if (!wrap) return;
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || 'ok');
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  el.innerHTML = `<svg><use href="#i-${kind === 'err' ? 'x' : kind === 'warn' ? 'info' : 'check'}"/></svg><span></span>${opts.action ? '<button type="button" class="toast-act"></button>' : ''}`;
  el.querySelector('span').textContent = msg;
  const dismiss = () => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); };
  if (opts.action) {
    const b = el.querySelector('.toast-act'); b.textContent = opts.action.label;
    b.onclick = () => { dismiss(); opts.action.run(); };
  }
  wrap.appendChild(el);
  setTimeout(dismiss, opts.ms || (opts.action ? 8000 : 2800));
}

/* ─── Modals (static ids in index.html + dynamic factory) ─ */
// Return focus to the opener. If a commit() re-rendered the page underneath, the opener is detached —
// find its replacement by its stable data-fid.
function focusBack(el) {
  if (!el) return;
  if (!el.isConnected && el.dataset && el.dataset.fid) el = document.querySelector(`[data-fid="${CSS.escape(el.dataset.fid)}"]`);
  if (el && el.isConnected && el.focus) el.focus({ preventScroll: true });
}
const modalStack = [];
function openModal(id) {
  const m = document.getElementById(id); if (!m) return;
  m.classList.add('open'); modalStack.push({ el: m, ret: document.activeElement });
  setTimeout(() => { const f = m.querySelector('[autofocus], .modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea, .modal-body button'); if (f) f.focus({ preventScroll: true }); }, 30);
}
function closeModal(id) {
  const m = document.getElementById(id); if (!m) return;
  m.classList.remove('open');
  const i = modalStack.findIndex(x => x.el === m);
  if (i >= 0) { const [x] = modalStack.splice(i, 1); focusBack(x.ret); }
}
// Modal.open({ title, body, foot, width, onMount(el, close), onClose }) → { el, close }
const Modal = {
  open(o) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop open dyn';
    bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:${o.width || 560}px">
      <div class="modal-head"><h3></h3><button class="x" type="button" aria-label="Close"><svg width="18" height="18"><use href="#i-x"/></svg></button></div>
      <div class="modal-body">${o.body || ''}</div>${o.foot != null ? `<div class="modal-foot">${o.foot}</div>` : ''}</div>`;
    bd.querySelector('h3').textContent = o.title || '';
    document.body.appendChild(bd);
    const ret = document.activeElement;
    const entry = { el: bd, ret };
    modalStack.push(entry);
    let closed = false;
    const close = (val) => {
      if (closed) return; closed = true;
      bd.remove();
      const i = modalStack.indexOf(entry); if (i >= 0) modalStack.splice(i, 1);
      focusBack(ret);
      if (o.onClose) o.onClose(val);
    };
    entry.close = close;
    bd.querySelector('.x').onclick = () => close();
    bd.addEventListener('mousedown', (ev) => { if (ev.target === bd) close(); });
    if (o.onMount) o.onMount(bd, close);
    setTimeout(() => { const f = bd.querySelector('[autofocus], .modal-body input, .modal-body select, .modal-body textarea, .modal-foot .btn-primary'); if (f) f.focus({ preventScroll: true }); }, 30);
    return { el: bd, close };
  },
};
// confirmDialog({ title, message, confirmText, cancelText, danger, requireText, reason }) → Promise<false | true | {reason}>
function confirmDialog(o) {
  return new Promise((resolve) => {
    const needReason = !!o.reason;
    const h = Modal.open({
      title: o.title || 'Are you sure?', width: o.width || 460,
      body: `<div class="confirm-msg">${o.html || esc(o.message || '')}</div>
        ${o.requireText ? `<div class="field" style="margin-top:14px"><label>Type <b>${esc(o.requireText)}</b> to confirm</label><input class="input" data-req></div>` : ''}
        ${needReason ? `<div class="field" style="margin-top:14px"><label>${esc(o.reason)}</label><input class="input" data-reason placeholder="Be honest — this goes into your journal"></div>` : ''}`,
      foot: `<button class="btn btn-ghost" data-act="no" type="button">${esc(o.cancelText || 'Cancel')}</button><button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-act="yes" type="button">${esc(o.confirmText || 'Confirm')}</button>`,
      onClose: (v) => resolve(v || false),
      onMount: (el, close) => {
        const yes = el.querySelector('[data-act=yes]');
        const req = el.querySelector('[data-req]'), rsn = el.querySelector('[data-reason]');
        const check = () => { yes.disabled = (req && req.value.trim() !== o.requireText) || (rsn && rsn.value.trim().length < 3); };
        if (req) req.addEventListener('input', check); if (rsn) rsn.addEventListener('input', check); check();
        el.querySelector('[data-act=no]').onclick = () => close(false);
        yes.onclick = () => close(needReason ? { reason: rsn.value.trim() } : true);
      },
    });
    return h;
  });
}

/* ─── Side drawer ──────────────────────────────────────── */
const Drawer = (() => {
  let cur = null;
  function close() { if (!cur) return; const c = cur; cur = null; c.el.classList.remove('open'); setTimeout(() => c.el.remove(), 220); focusBack(c.ret); if (c.onClose) c.onClose(); }
  // open({ title, sub, html, width, onMount(bodyEl) })
  function open(o) {
    close();
    const el = document.createElement('div');
    el.className = 'drawer-wrap';
    el.innerHTML = `<div class="drawer-scrim"></div><aside class="drawer" role="dialog" aria-modal="true" style="width:min(${o.width || 520}px,100vw)">
      <div class="drawer-head"><div><h3></h3><div class="page-sub"></div></div><button class="x" type="button" aria-label="Close"><svg width="18" height="18"><use href="#i-x"/></svg></button></div>
      <div class="drawer-body">${o.html || ''}</div></aside>`;
    el.querySelector('h3').textContent = o.title || '';
    el.querySelector('.page-sub').textContent = o.sub || '';
    document.body.appendChild(el);
    cur = { el, ret: document.activeElement, onClose: o.onClose };
    el.querySelector('.x').onclick = close;
    el.querySelector('.drawer-scrim').onclick = close;
    requestAnimationFrame(() => el.classList.add('open'));
    if (o.onMount) o.onMount(el.querySelector('.drawer-body'));
    setTimeout(() => el.querySelector('.x').focus({ preventScroll: true }), 40);
    return { el, close, body: el.querySelector('.drawer-body') };
  }
  return { open, close, get isOpen() { return !!cur; } };
})();

/* ─── Escape closes the top-most layer; Tab stays inside it ─ */
document.addEventListener('keydown', (ev) => {
  const top = modalStack[modalStack.length - 1];
  const layer = top ? top.el : (Drawer.isOpen ? document.querySelector('.drawer-wrap .drawer') : null);
  if (ev.key === 'Escape' && !ev.defaultPrevented) {
    if (document.querySelector('.popover')) return; // popover handler closes itself first
    if (top) { ev.preventDefault(); if (top.close) top.close(); else closeModal(top.el.id); }
    else if (Drawer.isOpen) { ev.preventDefault(); Drawer.close(); }
    return;
  }
  if (ev.key === 'Tab' && layer) {
    const f = [...layer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!layer.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
});

/* ─── Info popovers (keyboard reachable, replace title=) ─ */
function infoTip(text) { return `<button type="button" class="info-tip" aria-label="What is this?" data-tip="${esc(text)}"><svg width="12" height="12"><use href="#i-info"/></svg></button>`; }
// Metric tooltip from the Learn page's Glossary (pages/learn.js) with a fallback sentence.
function tipFor(key, fallback) {
  const g = typeof Glossary !== 'undefined' && Glossary[key];
  return infoTip(g ? g.plain + (g.good ? ' Good: ' + g.good : '') : (fallback || ''));
}
(() => {
  let pop = null;
  const hide = () => { if (pop) { pop.remove(); pop = null; } };
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('.info-tip');
    if (!b) { if (pop && !ev.target.closest('.popover')) hide(); return; }
    ev.stopPropagation(); ev.preventDefault();
    if (pop && pop._for === b) { hide(); return; }
    hide();
    pop = document.createElement('div'); pop.className = 'popover'; pop.setAttribute('role', 'tooltip'); pop._for = b;
    pop.textContent = b.dataset.tip; document.body.appendChild(pop);
    const r = b.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    pop.style.top = (r.bottom + 8 + window.scrollY) + 'px';
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
})();

/* ─── Chip selector (single / multi / exclusive options) ─ */
// chips(el, options:[{id,label,tone?,title?}], selected:[], { multi, max, exclusive:['none'], onChange(sel) })
function chips(el, options, selected, opts) {
  opts = opts || {};
  let sel = [...(selected || [])];
  function draw() {
    el.innerHTML = options.map(o => `<button type="button" class="chip sm ${o.tone ? 'tone-' + o.tone : ''} ${sel.includes(o.id) ? 'on' : ''}" data-id="${esc(o.id)}" aria-pressed="${sel.includes(o.id)}" ${o.title ? `title="${esc(o.title)}"` : ''}>${esc(o.label)}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => {
      const id = b.dataset.id, on = sel.includes(id);
      if (!opts.multi) sel = on ? [] : [id];
      else if (on) sel = sel.filter(x => x !== id);
      else {
        const ex = opts.exclusive || [];
        if (ex.includes(id)) sel = [id]; else sel = sel.filter(x => !ex.includes(x)).concat(id);
        if (opts.max && sel.length > opts.max) sel = sel.slice(sel.length - opts.max);
      }
      draw(); if (opts.onChange) opts.onChange([...sel]);
    });
  }
  draw();
  return { get value() { return [...sel]; }, set(v) { sel = [...(v || [])]; draw(); } };
}
// Segmented control: seg(el, [{id,label}], value, onChange)
function seg(el, options, value, onChange) {
  let v = value;
  const draw = () => {
    el.classList.add('seg');
    el.innerHTML = options.map(o => `<button type="button" data-id="${esc(o.id)}" class="${o.id === v ? 'on' : ''}" aria-pressed="${o.id === v}" ${o.title ? `title="${esc(o.title)}"` : ''}>${esc(o.label)}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => { v = b.dataset.id; draw(); if (onChange) onChange(v); });
  };
  draw();
  return { get value() { return v; }, set(x) { v = x; draw(); } };
}

/* ─── Misc helpers ─────────────────────────────────────── */
function coinIcon(sym) { return `<span class="coin-ic" aria-hidden="true">${esc((sym || '?').slice(0, 4))}</span>`; }
function emptyHtml(big, small, actions) {
  const btns = (actions || []).map(a => `<button type="button" class="btn ${a.primary ? 'btn-primary' : 'btn-ghost'} btn-sm" data-empty-act="${esc(a.id)}">${a.icon ? `<svg><use href="#i-${a.icon}"/></svg>` : ''}${esc(a.label)}</button>`).join('');
  return `<div class="empty-state"><svg aria-hidden="true"><use href="#i-trades"/></svg><div class="big">${esc(big)}</div><div class="small">${esc(small || '')}</div>${btns ? `<div class="empty-acts">${btns}</div>` : ''}</div>`;
}
// Wire empty-state buttons: bindEmpty(container, { id: fn })
function bindEmpty(el, map) { el.querySelectorAll('[data-empty-act]').forEach(b => b.onclick = () => { const f = map[b.dataset.emptyAct]; if (f) f(); }); }
// CSV writing: numbers stay numeric; text that Excel would run as a formula (= + − @ tab) gets a leading apostrophe.
function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCSV = (rows) => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
function download(name, text, type) {
  const blob = text instanceof Blob ? text : new Blob([text], { type: type || 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function fillSelect(sel, pairs, blankLabel) {
  const el = typeof sel === 'string' ? $(sel) : sel; if (!el) return;
  const cur = el.value;
  el.innerHTML = (blankLabel != null ? `<option value="">${esc(blankLabel)}</option>` : '') + pairs.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  el.value = cur; if (el.selectedIndex === -1) el.selectedIndex = 0;
}
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const groupOfRow = (id) => (C ? C.groups.find(g => g.portions.some(p => p.id === id)) : null);
