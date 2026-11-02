/* ═══════════════════════════════════════════════════════════
   CryptoJournal — market data (offline-first, fail-soft)
   Market      live quotes (CoinGecko for majors, DexScreener for
               PulseChain contracts), candles, funding estimate (OKX),
               PulseChain tx lookup (Blockscout), DEX pool info.
   CG          the original API, unchanged for every caller:
               CG.idFor(sym) · CG.resolve(sym) · CG.fetchPrices(ids) → {id:{usd,chg,at}}
               CG.priceForSymbol(sym) → {usd,chg,at} | null · CG.resetBackoff() · CG.IDS
   TradeChart  drawer with the trade's candles, entry/exit markers and
               stop/target lines; can fill highDuring/lowDuring (MAE/MFE).
   Every request goes through one per-host token-bucket queue with
   429/5xx back-off, never runs offline and resolves null on failure —
   callers never see a throw. The last quotes persist in localStorage
   ('cj.prices') so an offline launch still shows "as of" prices.
   ═══════════════════════════════════════════════════════════ */
const Market = (() => {
  /* ── Symbols, CoinGecko ids, PulseChain contracts ───────── */
  // symbol → CoinGecko id (majors; unknowns resolved via /search and cached in db.coinIds)
  const IDS = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple',
    ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot', MATIC: 'matic-network', POL: 'polygon-ecosystem-token',
    AVAX: 'avalanche-2', LINK: 'chainlink', UNI: 'uniswap', LTC: 'litecoin', ATOM: 'cosmos',
    XLM: 'stellar', NEAR: 'near', FTM: 'fantom', ALGO: 'algorand', ICP: 'internet-computer',
    FIL: 'filecoin', APE: 'apecoin', AXS: 'axie-infinity', SAND: 'the-sandbox', MANA: 'decentraland',
    GALA: 'gala', GRT: 'the-graph', AAVE: 'aave', MKR: 'maker', SNX: 'havven',
    CRV: 'curve-dao-token', COMP: 'compound-governance-token', SUSHI: 'sushi', '1INCH': '1inch',
    ENJ: 'enjincoin', CHZ: 'chiliz', HBAR: 'hedera-hashgraph', VET: 'vechain', THETA: 'theta-token',
    XTZ: 'tezos', EOS: 'eos', IOTA: 'iota', NEO: 'neo', DASH: 'dash', ZEC: 'zcash', XMR: 'monero',
    ETC: 'ethereum-classic', BCH: 'bitcoin-cash', TRX: 'tron', SHIB: 'shiba-inu', PEPE: 'pepe',
    ARB: 'arbitrum', OP: 'optimism', INJ: 'injective-protocol', TIA: 'celestia', SUI: 'sui',
    SEI: 'sei-network', APT: 'aptos', RNDR: 'render-token', IMX: 'immutable-x', LDO: 'lido-dao',
    RUNE: 'thorchain', KAVA: 'kava', ROSE: 'oasis-network', ONE: 'harmony', ZIL: 'zilliqa',
    KSM: 'kusama', EGLD: 'elrond-erd-2', FLOW: 'flow', ICX: 'icon', ONT: 'ontology', QTUM: 'qtum',
    RVN: 'ravencoin', DGB: 'digibyte', BAT: 'basic-attention-token', ZRX: '0x', OMG: 'omisego',
    LRC: 'loopring', STORJ: 'storj', ANKR: 'ankr', BAND: 'band-protocol', BAL: 'balancer',
    YFI: 'yearn-finance', REN: 'republic-protocol', KNC: 'kyber-network-crystal', OCEAN: 'ocean-protocol',
    RSR: 'reserve-rights-token', COTI: 'coti', CELO: 'celo', CELR: 'celer-network', CTSI: 'cartesi',
    DENT: 'dent', DUSK: 'dusk-network', DYDX: 'dydx-chain', ENS: 'ethereum-name-service',
    GMT: 'stepn', GTC: 'gitcoin', HNT: 'helium', HOT: 'holotoken', IOST: 'iostoken', IOTX: 'iotex',
    JASMY: 'jasmycoin', KLAY: 'klay-token', LINA: 'linear', LIT: 'litentry', LPT: 'livepeer',
    MASK: 'mask-network', MTL: 'metal', NKN: 'nkn', OGN: 'origin-protocol', PEOPLE: 'constitutiondao',
    REEF: 'reef', RLC: 'iexec-rlc', SFP: 'safepal', SKL: 'skale', STMX: 'storm', TRB: 'tellor',
    TLM: 'alien-worlds', WAVES: 'waves', WOO: 'woo-network', XEM: 'nem', ZEN: 'horizen',
    JUP: 'jupiter-exchange-solana', WIF: 'dogwifcoin', BONK: 'bonk', ONDO: 'ondo-finance', HYPE: 'hyperliquid',
    TON: 'the-open-network', TAO: 'bittensor', FET: 'fetch-ai', STX: 'blockstack', AR: 'arweave',
    // PulseChain ecosystem (verified against CoinGecko coin list)
    PLS: 'pulsechain', PLSX: 'pulsex', INC: 'pulsex-incentive-token',
    HEX: 'hex-pulsechain',  // PulseChain HEX (pHEX)
    PHEX: 'hex-pulsechain', EHEX: 'hex',  // explicit aliases: PulseChain vs Ethereum HEX
    WPLS: 'pulsechain',     // wrapped PLS trades 1:1 with PLS (CoinGecko fallback only)
  };
  // PulseChain contracts (crypto research, verified live) — priced by address, never by a guessable symbol
  const WPLS = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27', PHEX = '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39';
  const PULSE = { PLS: WPLS, WPLS, PLSX: '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab', INC: '0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d', HEX: PHEX, PHEX };

  const ADDR_RE = /^0x[0-9a-fA-F]{40}$/, SYM_RE = /^[A-Z0-9]{1,15}$/, HASH_RE = /^0x[0-9a-fA-F]{64}$/;
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const TTL = MIN, STALE_MS = 5 * MIN;
  const isN = (v) => typeof v === 'number' && isFinite(v);
  const numOf = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return isN(n) ? n : null; };
  const norm = (s) => String(s == null ? '' : s).toUpperCase().trim();
  // Exchange tickers as typed or imported: "BTCUSDT", "BTC/USDT", "BTC-PERP" → "BTC"
  function baseSym(sym) {
    let s = norm(sym).split(/[\/\-:\s_]/)[0] || '';
    if (/^[A-Z0-9]{2,}(USDT|USDC)$/.test(s)) s = s.replace(/(USDT|USDC)$/, '');
    return s;
  }
  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const emit = () => { if (typeof Bus !== 'undefined') Bus.emit('prices'); };
  // Public async functions never throw — a broken API or schema change degrades to "no data".
  const safe = (fn, dflt) => async (...a) => {
    try { return await fn(...a); } catch (e) { console.warn('[market]', e); return typeof dflt === 'function' ? dflt() : dflt; }
  };
  // Cache writes (resolved coin ids) are bookkeeping: they must never toast an error or
  // write over the journal while the storage-recovery banner is waiting for the user.
  function quietSave() {
    try { if (typeof StorageGuard !== 'undefined' && StorageGuard.loadError) return; if (typeof save === 'function') save(); } catch (e) { /* best effort */ }
  }
  // Look-up memory, cleared by resetBackoff() (reconnect, "reset coin cache")
  const noMatch = new Map();   // SYM → ms of the last /search with no exact hit (saves the keyless budget)
  const miss = new Map();      // SYM → ms of the last round that found no price (avoid hammering unknown coins)

  const userAddrs = () => (typeof db !== 'undefined' && db && db.tokenAddrs && typeof db.tokenAddrs === 'object' ? db.tokenAddrs : {});
  function idFor(sym) {
    const s = norm(sym);
    if (!s) return null;
    // db.coinIds comes from backups too: only a non-empty string is a usable id
    const u = ((typeof db !== 'undefined' && db && db.coinIds) || {})[s];
    return IDS[s] || (typeof u === 'string' && u ? u : null);
  }
  function addressFor(sym) {
    const s = norm(sym);
    if (!s) return null;
    if (PULSE[s]) return PULSE[s];
    const a = userAddrs()[s];
    return typeof a === 'string' && ADDR_RE.test(a) ? a : null;
  }
  const isPulse = (sym) => !!addressFor(sym);
  // A contract the USER chose is priced by its address only. A CoinGecko symbol match (IDS or
  // /search) can be another chain's token with the same ticker — e.g. a PulseChain "PEPE" would
  // get Ethereum PEPE's price. Built-in PULSE symbols map to their PulseChain CoinGecko ids.
  const cgAllowed = (sym) => { const s = norm(sym); return !addressFor(s) || !!PULSE[s]; };
  // The symbol we price: a known symbol as typed, else the base of an exchange ticker
  // ("BTCUSDT", "BTC/USDT", "BTC-PERP" → "BTC"); '' when nothing usable is left.
  function symKey(sym) {
    const s = norm(sym);
    if (!s) return '';
    if (SYM_RE.test(s) && (idFor(s) || addressFor(s))) return s;
    const b = baseSym(s);
    return SYM_RE.test(b) ? b : '';
  }
  // Optional user-chosen PulseChain contract for a symbol (imposter tokens share symbols).
  // Stored in db.tokenAddrs (unknown top-level keys survive sanitize()). User action only.
  function setAddress(sym, addr) {
    const s = norm(sym);
    if (!SYM_RE.test(s) || PULSE[s]) return false;
    if (addr == null || addr === '') {
      if (db.tokenAddrs) { delete db.tokenAddrs[s]; quietSave(); }
      dex.delete(s); delete quotes[s]; miss.delete(s);
      return true;
    }
    if (!ADDR_RE.test(String(addr).trim())) return false;
    if (!db.tokenAddrs || typeof db.tokenAddrs !== 'object') db.tokenAddrs = {};
    db.tokenAddrs[s] = String(addr).trim(); dex.delete(s); delete quotes[s]; miss.delete(s);
    quietSave();
    return true;
  }

  /* ── Request queue: one token bucket per host ───────────── */
  const cgKey = () => { try { return String(S().cgDemoKey || '').trim(); } catch (e) { return ''; } };
  // Budgets sit under each provider's documented free limit (keyless CoinGecko ≈ 10/min, Demo key 100/min).
  const HOSTS = {
    coingecko: { perMin: () => (cgKey() ? 100 : 10), burst: () => (cgKey() ? 20 : 4) },
    dexscreener: { perMin: () => 200, burst: () => 20 },
    geckoterminal: { perMin: () => 8, burst: () => 3 },
    binance: { perMin: () => 300, burst: () => 20 },
    coinbase: { perMin: () => 120, burst: () => 10 },
    okx: { perMin: () => 60, burst: () => 10 },
    blockscout: { perMin: () => 60, burst: () => 10 },
  };
  const hs = {};                 // host → { tokens, last, q, timer, backoff, until }
  const inflight = new Map();    // url → Promise (identical concurrent calls share one request)
  function hostState(name) {
    return hs[name] || (hs[name] = { tokens: HOSTS[name].burst(), last: Date.now(), q: [], timer: null, backoff: 0, until: 0 });
  }
  function wake(name, ms) {
    const h = hostState(name);
    if (h.timer) return;
    h.timer = setTimeout(() => { h.timer = null; pump(name); }, Math.max(50, Math.ceil(ms)));
  }
  function pump(name) {
    const h = hostState(name), cfg = HOSTS[name];
    while (h.q.length) {
      const now = Date.now(), job = h.q[0];
      if (now > job.deadline || !online()) { h.q.shift(); job.done(null); continue; }
      if (now < h.until) {
        // backing off: jobs that can't wait it out answer "no data" now, the rest sleep
        h.q = h.q.filter(j => { if (j.deadline < h.until) { j.done(null); return false; } return true; });
        if (h.q.length) wake(name, h.until - now);
        return;
      }
      const rate = cfg.perMin() / MIN;
      h.tokens = Math.min(cfg.burst(), h.tokens + (now - h.last) * rate); h.last = now;
      if (h.tokens < 1) { wake(name, (1 - h.tokens) / rate); return; }
      h.tokens -= 1; h.q.shift();
      run(name, job).catch(() => job.done(null));
    }
  }
  function penalize(h, ms) {
    // ms == null: exponential back-off 15s → 30s → … → 5 min (429/5xx); otherwise at least ms
    h.backoff = ms != null ? Math.max(h.backoff, ms) : Math.min(5 * MIN, h.backoff ? h.backoff * 2 : 15000);
    h.until = Date.now() + h.backoff;
  }
  async function fetchJSON(url, ms) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), ms) : null;
    try {
      const r = await fetch(url, { signal: ac ? ac.signal : undefined, referrerPolicy: 'no-referrer' });
      let j = null;
      if (r.ok) { try { j = await r.json(); } catch (e) { j = null; } }
      let retryAfter = 0;
      try { retryAfter = +(r.headers.get('retry-after') || 0) || 0; } catch (e) { /* header not exposed */ }
      return { status: r.status, ok: r.ok, j, retryAfter };
    } finally { if (timer) clearTimeout(timer); }
  }
  async function run(name, job) {
    const h = hostState(name);
    let r;
    try { r = await fetchJSON(job.url, job.timeout); }
    catch (e) {
      // network / CORS / timeout. A rate-limited host often answers 429 WITHOUT CORS headers, which the
      // browser reports as a network error — so repeated failures back off exponentially too (30s → 1m → 2m → 4m → 5m)
      h.netErr = (h.netErr || 0) + 1;
      penalize(h, Math.min(5 * MIN, 30000 * 2 ** Math.min(4, h.netErr - 1)));
      job.done(null); return;
    }
    h.netErr = 0;
    if (r.status === 429 || r.status >= 500) {
      penalize(h, null);
      if (r.retryAfter > 0) h.until = Math.max(h.until, Date.now() + Math.min(r.retryAfter, 600) * 1000);
      // one retry for a short back-off; otherwise give up quietly (callers show cached data)
      if (job.tries < 1 && h.until - Date.now() <= 20000) {
        job.tries++; job.deadline = Math.max(job.deadline, h.until + 5000);
        h.q.unshift(job); pump(name);
      } else job.done(null);
      return;
    }
    if (r.ok) h.backoff = 0;
    job.done(r.ok ? r.j : null);
  }
  // request(host, url, {timeout, maxWait}) → Promise<json | null>
  function request(name, url, opts) {
    opts = opts || {};
    if (!online() || !HOSTS[name]) return Promise.resolve(null);
    if (inflight.has(url)) return inflight.get(url);
    const h = hostState(name), maxWait = opts.maxWait || MIN;
    // in a long back-off (repeated 429s) answer now rather than leave a spinner up for minutes
    if (h.until - Date.now() > maxWait || h.q.length >= 40) return Promise.resolve(null);
    const p = new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      h.q.push({ url, tries: 0, timeout: opts.timeout || 15000, deadline: Date.now() + maxWait, done });
      pump(name);
    }).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }
  let expiredBefore = 0;   // resetBackoff(): anything fetched before this counts as old
  function resetBackoff() {
    expiredBefore = Date.now();
    noMatch.clear(); miss.clear();   // a reset coin cache or a new connection deserves a fresh look
    for (const name of Object.keys(hs)) {
      const h = hs[name];
      h.backoff = 0; h.until = 0; h.netErr = 0;
      if (h.timer) { clearTimeout(h.timer); h.timer = null; }
      if (h.q.length) pump(name);
    }
  }

  /* ── Quote store (persisted "as of" prices) ─────────────── */
  const LS_PRICES = 'cj.prices';
  let quotes = {};   // SYM → { usd, chg, at, source }
  try {
    const o = JSON.parse(localStorage.getItem(LS_PRICES) || '{}');
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        const q = o[k];
        if (SYM_RE.test(k) && q && isN(q.usd) && isN(q.at)) quotes[k] = { usd: q.usd, chg: isN(q.chg) ? q.chg : null, at: q.at, source: typeof q.source === 'string' ? q.source : '' };
      }
    }
  } catch (e) { quotes = {}; }
  function persist() {
    const keys = Object.keys(quotes);
    if (keys.length > 300) keys.sort((a, b) => quotes[a].at - quotes[b].at).slice(0, keys.length - 300).forEach(k => delete quotes[k]);
    try { localStorage.setItem(LS_PRICES, JSON.stringify(quotes)); } catch (e) { /* quota — the memory copy still works */ }
  }
  const fresh = (q) => !!q && Date.now() - q.at < TTL && q.at >= expiredBefore;
  const view = (q) => (q ? { usd: q.usd, chg: q.chg, at: q.at, source: q.source, stale: !online() || Date.now() - q.at > STALE_MS } : null);
  // Market.cached(sym) → last known quote, synchronously (stale = older than 5 min or offline)
  function cached(sym) { const k = symKey(sym); return k ? view(quotes[k]) : null; }

  /* ── CoinGecko (majors + PulseChain fallback) ───────────── */
  const CG_BASE = 'https://api.coingecko.com/api/v3';
  const cgUrl = (path) => CG_BASE + path + (cgKey() ? `&x_cg_demo_api_key=${encodeURIComponent(cgKey())}` : '');
  const idPrices = new Map();   // CoinGecko id → { usd, chg, at } (CG.fetchPrices compatibility)
  function symsForId(id) {
    const out = Object.keys(IDS).filter(s => IDS[s] === id);
    const user = (typeof db !== 'undefined' && db && db.coinIds) || {};
    for (const s of Object.keys(user)) if (user[s] === id && !out.includes(s) && SYM_RE.test(s)) out.push(s);
    return out;
  }
  async function cgBatch(ids) {
    const got = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      // precision=full: sub-cent PulseChain prices come back rounded without it
      const j = await request('coingecko', cgUrl(`/simple/price?ids=${chunk.map(encodeURIComponent).join(',')}&vs_currencies=usd&include_24hr_change=true&precision=full`));
      if (!j || typeof j !== 'object') continue;
      const at = Date.now();
      for (const id of chunk) {
        const v = j[id], usd = v ? numOf(v.usd) : null;
        if (usd == null || usd <= 0) continue;
        const q = { usd, chg: numOf(v.usd_24h_change), at };
        idPrices.set(id, q); got.push(id);
        // never let the fallback overwrite a fresh DexScreener quote for a PulseChain contract
        // (and never price a user-chosen contract with a same-ticker coin's quote)
        for (const s of symsForId(id)) if (cgAllowed(s) && (!addressFor(s) || !fresh(quotes[s]))) quotes[s] = { ...q, source: 'CoinGecko' };
      }
    }
    if (got.length) persist();
    return got;
  }
  async function resolve(sym) {
    const s = norm(sym);
    if (!s) return null;
    const known = idFor(s);
    if (known) return known;
    if (!SYM_RE.test(s) || Date.now() - (noMatch.get(s) || 0) < 10 * MIN) return null;
    const j = await request('coingecko', cgUrl(`/search?query=${encodeURIComponent(s)}`));
    if (!j) return null;
    // Only an EXACT symbol match, and among same-symbol copies the best-ranked coin — never an arbitrary first hit.
    const hits = (Array.isArray(j.coins) ? j.coins : []).filter(c => c && c.id && c.symbol && String(c.symbol).toUpperCase() === s);
    if (!hits.length) { noMatch.set(s, Date.now()); return null; }
    const rank = (c) => (isN(c.market_cap_rank) ? c.market_cap_rank : 1e9);
    hits.sort((a, b) => rank(a) - rank(b));
    const id = String(hits[0].id);
    if (!db.coinIds || typeof db.coinIds !== 'object') db.coinIds = {};
    db.coinIds[s] = id; quietSave();
    return id;
  }
  // CG.fetchPrices(ids) → { id: { usd, chg, at, stale } } (falls back to the persisted quote offline)
  async function fetchIds(ids) {
    ids = [...new Set((Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string' && x))];
    const now = Date.now();
    const need = ids.filter(id => { const p = idPrices.get(id); return !p || now - p.at > TTL || p.at < expiredBefore; });
    if (need.length && online()) { const got = await cgBatch(need); if (got.length) emit(); }
    const out = {};
    for (const id of ids) {
      const p = idPrices.get(id);
      if (p) { out[id] = { ...p, stale: !online() || Date.now() - p.at > STALE_MS }; continue; }
      const s = symsForId(id).find(x => quotes[x] && cgAllowed(x));
      if (s) { const v = view(quotes[s]); out[id] = { usd: v.usd, chg: v.chg, at: v.at, stale: v.stale }; }
    }
    return out;
  }

  /* ── DexScreener (PulseChain contracts) ─────────────────── */
  const dex = new Map();   // SYM → { pair, url, liquidityUsd, priceNative, quote, priceUsd, chg, at }
  async function dexBatch(syms) {
    const want = new Map(), orig = new Map();   // lower-case address → [SYM] / checksummed form for the URL
    for (const s of syms) { const a = addressFor(s); if (!a) continue; const k = a.toLowerCase(); if (!want.has(k)) { want.set(k, []); orig.set(k, a); } want.get(k).push(s); }
    const addrs = [...want.keys()], got = [];
    for (let i = 0; i < addrs.length; i += 30) {
      const chunk = addrs.slice(i, i + 30);
      const j = await request('dexscreener', `https://api.dexscreener.com/tokens/v1/pulsechain/${chunk.map(k => orig.get(k)).join(',')}`);
      const pairs = Array.isArray(j) ? j : j && Array.isArray(j.pairs) ? j.pairs : [];
      const addrOf = (t) => (t && typeof t.address === 'string' ? t.address.toLowerCase() : '');
      const symOf = (t) => (t && typeof t.symbol === 'string' ? t.symbol.slice(0, 12) : '');
      // The deepest pool per token is the honest price. Pools where our token is the BASE
      // give its price directly; a pool where it is the QUOTE is only a fallback
      // (price = base USD ÷ base-in-quote, and the 24h change belongs to the other token).
      const best = new Map(), inv = new Map();
      for (const p of pairs) {
        if (!p || typeof p !== 'object' || (p.chainId && p.chainId !== 'pulsechain')) continue;
        const usd = numOf(p.priceUsd), pn = numOf(p.priceNative), liq = numOf(p.liquidity && p.liquidity.usd) || 0;
        if (usd == null || usd <= 0) continue;
        const bk = addrOf(p.baseToken), qk = addrOf(p.quoteToken);
        if (want.has(bk)) {
          const b = best.get(bk);
          if (!b || liq > b.liq) best.set(bk, { p, liq, usd, pn, quote: symOf(p.quoteToken), chg: numOf(p.priceChange && p.priceChange.h24), side: 'base' });
        } else if (want.has(qk) && pn > 0) {
          const b = inv.get(qk);
          if (!b || liq > b.liq) inv.set(qk, { p, liq, usd: usd / pn, pn: 1 / pn, quote: symOf(p.baseToken), chg: null, side: 'quote' });
        }
      }
      for (const [k, b] of inv) if (!best.has(k)) best.set(k, b);
      const at = Date.now();
      for (const [k, b] of best) {
        const p = b.p;
        const info = {
          pair: typeof p.pairAddress === 'string' && ADDR_RE.test(p.pairAddress) ? p.pairAddress : '',
          url: typeof p.url === 'string' && /^https:\/\/dexscreener\.com\//.test(p.url) ? p.url : '',
          liquidityUsd: b.liq, priceNative: b.pn, quote: b.quote,
          priceUsd: b.usd, chg: b.chg, at, side: b.side,   // side: which side of the pool our token is (GeckoTerminal token=)
        };
        for (const s of want.get(k)) { dex.set(s, info); quotes[s] = { usd: b.usd, chg: info.chg, at, source: 'DexScreener' }; got.push(s); }
      }
    }
    if (got.length) persist();
    return got;
  }
  // Market.dexInfo(sym) → { liquidityUsd, priceNative, quote, pair, url, priceUsd, at, stale } | null
  async function dexInfo(sym) {
    const s = symKey(sym);
    if (!s || !addressFor(s)) return null;
    let d = dex.get(s);
    if ((!d || Date.now() - d.at > STALE_MS) && online()) { if ((await dexBatch([s])).length) emit(); d = dex.get(s); }
    return d ? { liquidityUsd: d.liquidityUsd, priceNative: d.priceNative, quote: d.quote, pair: d.pair, url: d.url, priceUsd: d.priceUsd, at: d.at, side: d.side, stale: !online() || Date.now() - d.at > STALE_MS } : null;
  }

  /* ── Quotes API ─────────────────────────────────────────── */
  // Market.prices([sym]) → { SYM: { usd, chg, at, source, stale } } — PulseChain via DexScreener first, then CoinGecko.
  // Keys are the symbols as asked (upper-cased); "BTCUSDT" is priced as BTC.
  async function prices(syms) {
    const keyOf = new Map();
    for (const raw of (Array.isArray(syms) ? syms : [syms])) { const s = norm(raw), k = symKey(s); if (k) keyOf.set(s, k); }
    const list = [...new Set(keyOf.values())];
    const now = Date.now();
    const need = list.filter(s => !fresh(quotes[s]) && now - (miss.get(s) || 0) > 2 * MIN);
    if (need.length && online()) {
      let updated = 0;
      const pulse = need.filter(s => addressFor(s));
      if (pulse.length) updated += (await dexBatch(pulse)).length;
      const ids = new Map();
      let lookups = 0;
      for (const s of need) {
        if (fresh(quotes[s]) || !cgAllowed(s)) continue;
        let id = idFor(s);
        if (!id && lookups < 2) { lookups++; id = await resolve(s); }   // at most 2 searches per round
        if (id) ids.set(id, true);
      }
      if (ids.size) updated += (await cgBatch([...ids.keys()])).length;
      for (const s of need) if (!fresh(quotes[s])) miss.set(s, Date.now());
      if (updated) emit();
    }
    const out = {};
    for (const [s, k] of keyOf) { const q = view(quotes[k]); if (q) out[s] = q; }
    return out;
  }
  async function price(sym) {
    const s = norm(sym);
    if (!s) return null;
    const m = await prices([s]);
    return m[s] || null;
  }

  /* ── Candles ────────────────────────────────────────────── */
  // Interval ladder: the finest one that keeps the window ≤ 300 candles (Coinbase's per-call cap)
  const IV = [['1m', MIN], ['5m', 5 * MIN], ['15m', 15 * MIN], ['1h', HOUR], ['4h', 4 * HOUR], ['1d', DAY]];
  const pickIv = (span) => IV.find(iv => span / iv[1] <= 300) || IV[IV.length - 1];
  const ivLabel = (ms) => (ms < HOUR ? Math.round(ms / MIN) + 'm' : ms < DAY ? Math.round(ms / HOUR) + 'h' : Math.round(ms / DAY) + 'd');
  function tidy(rows) {
    const out = [];
    for (const c of rows || []) {
      if (!c || ![c.t, c.o, c.h, c.l, c.c].every(isN)) continue;
      const h = Math.max(c.h, c.o, c.c), l = Math.min(c.l, c.o, c.c);
      if (!(l > 0)) continue;
      out.push({ t: c.t, o: c.o, h, l, c: c.c });
    }
    out.sort((a, b) => a.t - b.t);
    return out.filter((c, i) => i === 0 || c.t !== out[i - 1].t);
  }
  async function fromBinance(sym, iv, from, to) {
    const n = Math.min(1000, Math.ceil((to - from) / iv[1]) + 1);
    // short maxWait: a blocked or busy host should hand over to the next source, not stall the chart
    const j = await request('binance', `https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=${iv[0]}&startTime=${from}&endTime=${to}&limit=${n}`, { maxWait: 20000 });
    if (!Array.isArray(j)) return null;
    return { rows: tidy(j.map(r => (Array.isArray(r) ? { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] } : null))), ivMs: iv[1] };
  }
  const CB_GRAN = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 21600, '1d': 86400 };   // Coinbase has no 4h → 6h
  async function fromCoinbase(sym, iv, from, to) {
    const g = CB_GRAN[iv[0]], end = Math.min(to, Date.now());
    const start = Math.max(from, end - 300 * g * 1000);
    const j = await request('coinbase', `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=${g}&start=${encodeURIComponent(new Date(start).toISOString())}&end=${encodeURIComponent(new Date(end).toISOString())}`, { maxWait: 20000 });
    if (!Array.isArray(j)) return null;
    // Coinbase rows are [time s, LOW, HIGH, OPEN, CLOSE, volume] — note the order
    return { rows: tidy(j.map(r => (Array.isArray(r) ? { t: r[0] * 1000, l: +r[1], h: +r[2], o: +r[3], c: +r[4] } : null))), ivMs: g * 1000 };
  }
  const GT_TF = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] };
  async function fromGecko(sym, iv, from, to) {
    const info = await dexInfo(sym);
    if (!info || !ADDR_RE.test(info.pair)) return null;
    const [tf, agg] = GT_TF[iv[0]];
    const n = Math.min(1000, Math.ceil((to - from) / iv[1]) + 2);
    // token=base|quote: OHLCV of OUR token, whichever side of the deepest pool it sits on.
    // include_empty_intervals: quiet minutes come back as flat candles — the chart's x axis is one slot
    // per candle, so omitted gaps would squeeze time and put the entry/exit markers in the wrong place.
    const tok = info.side === 'quote' ? 'quote' : 'base';
    const j = await request('geckoterminal', `https://api.geckoterminal.com/api/v2/networks/pulsechain/pools/${info.pair}/ohlcv/${tf}?aggregate=${agg}&limit=${n}&before_timestamp=${Math.ceil(to / 1000)}&currency=usd&token=${tok}&include_empty_intervals=true`, { maxWait: 90000 });
    const list = j && j.data && j.data.attributes && Array.isArray(j.data.attributes.ohlcv_list) ? j.data.attributes.ohlcv_list : null;
    if (!list) return null;
    // rows [s, o, h, l, c, v], newest first
    const rows = tidy(list.map(r => (Array.isArray(r) ? { t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4] } : null)));
    return { rows: rows.filter(c => c.t >= from - iv[1]), ivMs: iv[1] };
  }
  async function fromCoinGecko(sym, from, to) {
    const id = idFor(sym) || await resolve(sym);
    if (!id) return null;
    // keyless /ohlc only counts back from now and picks its own granularity (30m / 4h / 4d)
    const ago = (Date.now() - from) / DAY;
    const days = [1, 7, 14, 30, 90, 180, 365].find(d => d >= ago) || 365;
    const j = await request('coingecko', cgUrl(`/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`));
    if (!Array.isArray(j)) return null;
    const all = tidy(j.map(r => (Array.isArray(r) ? { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] } : null)));
    if (all.length < 2) return null;
    const gaps = all.slice(1).map((c, i) => c.t - all[i].t).sort((a, b) => a - b);
    const ivMs = gaps[gaps.length >> 1];
    if (!(ivMs > 0)) return null;
    // CoinGecko stamps a candle with its CLOSE time; shift to the open time every other source uses
    const rows = all.map(c => ({ t: c.t - ivMs, o: c.o, h: c.h, l: c.l, c: c.c }));
    return { rows: rows.filter(c => c.t >= from - ivMs && c.t <= to), ivMs };
  }
  // In-memory + sessionStorage cache keyed by coin|interval|window
  const memC = new Map(), SS = 'cj.candles.';
  function cacheGet(key) {
    if (memC.has(key)) return memC.get(key);
    try {
      const raw = sessionStorage.getItem(SS + key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !Array.isArray(o.c)) return null;
      const hit = { at: o.at, complete: !!o.complete, res: { candles: tidy(o.c.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4] }))), source: String(o.s || ''), interval: String(o.i || ''), intervalMs: +o.m || 0 } };
      memC.set(key, hit);
      return hit;
    } catch (e) { return null; }
  }
  function cachePut(key, res, complete) {
    const hit = { at: Date.now(), complete, res };
    memC.set(key, hit);
    if (memC.size > 40) memC.delete(memC.keys().next().value);
    let raw;
    try { raw = JSON.stringify({ at: hit.at, complete, s: res.source, i: res.interval, m: res.intervalMs, c: res.candles.map(c => [c.t, c.o, c.h, c.l, c.c]) }); } catch (e) { return; }
    try { sessionStorage.setItem(SS + key, raw); }
    catch (e) {
      // quota: drop our own older candle caches (never anyone else's keys) and try once more
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k && k.startsWith(SS) && k !== SS + key) sessionStorage.removeItem(k); }
        sessionStorage.setItem(SS + key, raw);
      } catch (e2) { /* memory cache only */ }
    }
  }
  const copyRes = (r) => (r ? { candles: r.candles.slice(), source: r.source, interval: r.interval, intervalMs: r.intervalMs } : null);
  // Market.candles({coin, fromMs, toMs}) → { candles:[{t,o,h,l,c}] ascending, source, interval, intervalMs } | null
  async function candles(o) {
    o = o || {};
    const sym = symKey(o.coin);
    if (!sym) return null;
    const now = Date.now();
    let from = Number(o.fromMs), to = Math.min(Number(o.toMs), now);
    if (!isN(from) || !isN(to) || to <= from) return null;
    const iv = pickIv(to - from);
    // very short windows: widen to ≥ 60 candles so the chart has context
    if ((to - from) / iv[1] < 60) {
      const mid = (from + to) / 2;
      from = mid - 30 * iv[1]; to = Math.min(now, mid + 30 * iv[1]);
      if (to - from < 60 * iv[1]) from = to - 60 * iv[1];
    }
    from = Math.floor(from / iv[1]) * iv[1]; to = Math.ceil(to / iv[1]) * iv[1];
    const key = `${sym}|${iv[0]}|${from}|${to}`;
    const hit = cacheGet(key);
    if (hit && (hit.complete || Date.now() - hit.at < MIN || !online())) return copyRes(hit.res);
    if (!online()) return null;
    const tries = addressFor(sym)
      ? [['GeckoTerminal', () => fromGecko(sym, iv, from, to)], ...(cgAllowed(sym) ? [['CoinGecko', () => fromCoinGecko(sym, from, to)]] : [])]
      : [['Binance', () => fromBinance(sym, iv, from, to)], ['Coinbase', () => fromCoinbase(sym, iv, from, to)], ['CoinGecko', () => fromCoinGecko(sym, from, to)]];
    let res = null;
    for (const [source, f] of tries) {
      let r = null;
      try { r = await f(); } catch (e) { r = null; }
      if (r && r.rows && r.rows.length >= 2 && r.ivMs > 0) { res = { candles: r.rows, source, interval: ivLabel(r.ivMs), intervalMs: r.ivMs }; break; }
    }
    if (!res) return hit ? copyRes(hit.res) : null;
    // only the first-choice source is final: a coarse fallback (e.g. CoinGecko while Binance was busy)
    // is re-tried after a minute instead of sticking for the whole session
    cachePut(key, res, to <= Date.now() - iv[1] && res.source === tries[0][0]);
    return copyRes(res);
  }

  /* ── Funding (OKX public history, an estimate for any venue) ── */
  // Market.funding({coin, fromMs, toMs, side, qty, price}) → { usd (+ paid / − received), n, source, partial } | null
  async function funding(o) {
    o = o || {};
    const sym = symKey(o.coin), from = Number(o.fromMs), to = Math.min(Number(o.toMs), Date.now());
    const qty = Number(o.qty), px = Number(o.price);
    if (!sym || !isN(from) || !isN(to) || to <= from || !(qty > 0) || !(px > 0) || !online()) return null;
    const dir = o.side === 'short' ? -1 : 1;   // positive rate: longs pay shorts
    let after = Math.floor(to) + 1, usd = 0, n = 0, oldest = Infinity, any = false;
    for (let page = 0; page < 6; page++) {
      const j = await request('okx', `https://www.okx.com/api/v5/public/funding-rate-history?instId=${sym}-USDT-SWAP&limit=100&after=${after}`);
      if (!j || String(j.code) !== '0' || !Array.isArray(j.data)) { if (!any) return null; break; }
      if (!j.data.length) break;
      any = true;
      let pageOldest = Infinity;
      for (const r of j.data) {
        const t = numOf(r && r.fundingTime);
        const rate = numOf(r && r.realizedRate) != null ? numOf(r.realizedRate) : numOf(r && r.fundingRate);
        if (t == null || rate == null) continue;
        pageOldest = Math.min(pageOldest, t);
        if (t > from && t <= to) { usd += qty * px * rate * dir; n++; }   // only settlements while the trade was open
      }
      oldest = Math.min(oldest, pageOldest);
      if (!isFinite(pageOldest) || pageOldest <= from) break;
      after = pageOldest;
    }
    if (!any) return null;
    // OKX keeps ~3 months: flag when history did not reach back to the entry
    return { usd, n, source: 'OKX (estimate — your venue may differ)', partial: oldest > from + 8 * HOUR };
  }

  /* ── PulseChain transaction (Blockscout) ─────────────────── */
  // Market.tx(hash) → { gasNative (PLS), gasUsd, at (ms), ok, pending, explorer } | null
  // Accepts a bare hash, one without "0x", or a pasted explorer link (…/tx/0x…).
  function txHash(v) {
    const s = String(v == null ? '' : v).trim();
    if (HASH_RE.test(s)) return s;
    if (/^[0-9a-fA-F]{64}$/.test(s)) return '0x' + s;
    const m = /(?:^|[^0-9a-zA-Z])(0x[0-9a-fA-F]{64})(?![0-9a-zA-Z])/.exec(s);
    return m ? m[1] : '';
  }
  async function tx(hash) {
    const h = txHash(hash);
    if (!h || !online()) return null;
    const j = await request('blockscout', `https://api.scan.pulsechain.com/api/v2/transactions/${h}`);
    if (!j || typeof j !== 'object') return null;
    let gasNative = null;
    try { if (j.fee && j.fee.value != null) gasNative = Number(BigInt(String(j.fee.value))) / 1e18; } catch (e) { gasNative = null; }
    const at = Date.parse(j.timestamp);
    let pls = cached('PLS');
    if (!pls || pls.stale) pls = (await price('PLS')) || pls;
    // Blockscout status: 'ok' | 'error' | null (still pending). ok stays null while pending —
    // callers test ok === false for "failed on-chain", and a pending tx has not failed.
    return {
      gasNative, gasUsd: gasNative != null && pls ? gasNative * pls.usd : null,
      at: isFinite(at) ? at : null, ok: j.status === 'ok' ? true : j.status === 'error' ? false : null, pending: j.status == null,
      explorer: `https://scan.pulsechain.com/tx/${h}`,
    };
  }

  // Connection back → clear back-off so the next call refreshes everything
  if (typeof window !== 'undefined') window.addEventListener('online', () => resetBackoff());
  if (typeof Bus !== 'undefined') Bus.on('net', (d) => { if (d && d.online) resetBackoff(); });

  return {
    price: safe(price, null), prices: safe(prices, () => ({})), cached,
    candles: safe(candles, null), funding: safe(funding, null), tx: safe(tx, null), dexInfo: safe(dexInfo, null),
    attribution: 'Prices: CoinGecko · DexScreener',
    idFor, resolve: safe(resolve, null), addressFor, isPulse, setAddress, resetBackoff, online, baseSymbol: symKey,
    _fetchIds: safe(fetchIds, () => ({})), IDS, PULSE,
  };
})();

/* ── CG: the v1 API, kept 100% backward compatible ────────── */
const CG = (() => ({
  IDS: Market.IDS,
  idFor: (sym) => Market.idFor(sym),
  resolve: (sym) => Market.resolve(sym),
  fetchPrices: (ids) => Market._fetchIds(ids),
  async priceForSymbol(sym) {
    const q = await Market.price(sym);
    return q ? { usd: q.usd, chg: q.chg, at: q.at, source: q.source, stale: q.stale } : null;
  },
  resetBackoff: () => Market.resetBackoff(),
}))();

/* ═══ TradeChart — candles for one trade, in a drawer ═══════ */
const TradeChart = (() => {
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const isN = (v) => typeof v === 'number' && isFinite(v);
  // Candle high/low is only honest when each candle is small next to the hold: ≤ 1h candles
  // (or a multi-day hold) AND a candle at most a quarter of the hold (≤ 5m is always fine).
  // Stops e.g. 4-day CoinGecko candles being saved as the high/low of a 3-day trade.
  function fineFor(ctx) {
    if (!ctx.res || ctx.badTimes) return false;
    const iv = ctx.res.intervalMs || 0, hold = ctx.t1 - ctx.t0;
    return iv > 0 && (iv <= HOUR || hold > 2 * DAY) && (iv <= 5 * MIN || iv * 4 <= hold);
  }
  // The candles must span the whole holding period. Fallback sources can stop short
  // (Coinbase's 300-candle cap, CoinGecko's 365-day window, GeckoTerminal's ~6 months),
  // and a high/low from part of the trade would understate MAE/MFE.
  function covers(ctx) {
    const cs = ctx.res && ctx.res.candles;
    if (!cs || !cs.length) return false;
    const iv = ctx.res.intervalMs || 0, slack = Math.max(2 * iv, (ctx.t1 - ctx.t0) * 0.1);
    return cs[0].t <= ctx.t0 + slack && cs[cs.length - 1].t + iv >= Math.min(ctx.t1, Date.now()) - slack;
  }
  const marketLabel = (id) => ((typeof MARKETS !== 'undefined' && MARKETS.find(m => m.id === id)) || {}).label || id;
  const unitHtml = (obj) => (S().units === '$' ? `<span class="money">${fmtUnit(obj)}</span>` : fmtUnit(obj));
  // amount-weighted exit across scale-out portions
  function avgExit(g) {
    let q = 0, v = 0;
    for (const p of g.portions) if (isN(p.exitPrice) && isN(p.amount) && p.amount > 0) { q += p.amount; v += p.amount * p.exitPrice; }
    return q > 0 ? v / q : (isN(g.trade.exitPrice) ? g.trade.exitPrice : null);
  }
  const axisT = (span) => (ms) => {
    const d = new Date(ms);
    if (span <= 36 * HOUR) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (span <= 12 * DAY) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const srcLabel = (s) => (!s ? 'source not recorded' : s === 'manual' ? 'entered by you' : s === 'demo' ? 'generated demo values'
    : String(s).startsWith('candles:') ? 'from ' + String(s).slice(8) + ' candles' : String(s));

  function shell(ctx) {
    const { g, e, coin } = ctx;
    const res = ctx.closed
      ? `<span class="badge ${g.win ? 'win' : g.loss ? 'loss' : 'be'}">${g.win ? 'Win' : g.loss ? 'Loss' : 'Breakeven'} ${glyph(g.netPL)} ${unitHtml(g)}</span>`
      : '<span class="badge open">Open</span>';
    const lg = [`<span><i class="dot"></i>Entry (IN)</span>`];
    if (ctx.closed && !ctx.badTimes) lg.push(`<span><i class="dot ${g.win ? 'pos' : 'neg'}"></i>Exit (OUT)</span>`);
    if (isN(e.stopPrice)) lg.push('<span><i class="ln dash cl-c-down"></i>Stop</span>');
    if (isN(e.targetPrice)) lg.push('<span><i class="ln dash cl-c-up"></i>Target</span>');
    return `<div class="cl-tc">
      <div class="cl-tc-meta">${coinIcon(coin)}<b>${esc(coin)}</b>
        <span class="badge ${e.side === 'short' ? 'short' : 'long'}">${e.side === 'short' ? 'SHORT' : 'LONG'}</span>
        ${e.market ? `<span class="badge cat">${esc(marketLabel(e.market))}</span>` : ''}${res}
        <span class="cl-tc-px dim">Entry ${fmtPrice(e.entryPrice)}${ctx.closed && isN(ctx.exitPx) ? ` → exit ${fmtPrice(ctx.exitPx)}` : ''}</span></div>
      <div class="cl-tc-notes"></div>
      <div class="chart-box lg cl-tc-box"><canvas></canvas><div class="chart-tip"></div>
        <div class="cl-tc-state" role="status" aria-live="polite"></div></div>
      <div class="legend cl-tc-legend" aria-hidden="true">${lg.join('')}</div>
      <div class="chart-cap cl-tc-cap"></div>
      <div class="cl-tc-exc"></div>
    </div>`;
  }
  function setState(ctx, kind) {
    const el = $('.cl-tc-state', ctx.body);
    if (!el) return;
    ctx.state = kind;   // the 'net' listener retries an offline chart once the connection is back
    el.classList.toggle('full', kind === 'offline' || kind === 'fail');
    el.classList.toggle('hidden', kind === 'ok');
    if (kind === 'loading') el.innerHTML = `<span class="cl-spin" aria-hidden="true"></span><span>Loading ${esc(ctx.coin)} candles…</span>`;
    else if (kind === 'offline') el.innerHTML = emptyHtml("You're offline", 'Candles load from the internet the first time you open a chart. The chart retries when you reconnect, or press Retry — the rest of your journal works offline.', [{ id: 'retry', label: 'Retry', icon: 'refresh' }]);
    else if (kind === 'fail') {
      const sym = Market.baseSymbol(ctx.coin);
      // a contract you picked yourself is charted from its own pool only (no same-ticker CoinGecko fallback)
      const why = Market.isPulse(sym)
        ? `${Market.PULSE[sym] ? 'GeckoTerminal and CoinGecko' : 'GeckoTerminal'} had no candles for ${ctx.coin} in this window (free PulseChain history covers about 6 months).`
        : `Binance, Coinbase and CoinGecko had no candles for ${ctx.coin} in this window. Very old trades or uncommon coins may not be covered, or the price services are busy.`;
      el.innerHTML = emptyHtml('No price history found', why + ' Try again in a minute.', [{ id: 'retry', label: 'Retry', icon: 'refresh' }]);
    } else if (kind === 'ok') el.innerHTML = '';
    // Retry disappears once pressed — park focus on the status region instead of dropping it to <body>
    bindEmpty(el, { retry: () => { load(ctx); el.tabIndex = -1; el.focus({ preventScroll: true }); } });
  }
  // High/low of the candles that overlap the holding period — your own fills always sit inside it
  function extremes(ctx) {
    if (!ctx.res) return null;
    const iv = ctx.res.intervalMs || 0;
    const inTrade = ctx.res.candles.filter(c => c.t + iv > ctx.t0 && c.t <= ctx.t1);
    if (!inTrade.length) return null;
    const own = [ctx.e.entryPrice, ctx.exitPx].filter(isN);
    return { hi: Math.max(...inTrade.map(c => c.h), ...own), lo: Math.min(...inTrade.map(c => c.l), ...own), n: inTrade.length };
  }
  function draw(ctx) {
    const box = $('.cl-tc-box', ctx.body);
    if (!box || !ctx.res || typeof Charts === 'undefined') return;
    const cv = $('canvas', box), tip = $('.chart-tip', box), cs = ctx.res.candles, e = ctx.e;
    let lo = Infinity, hi = -Infinity;
    for (const c of cs) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
    // Entry far outside the market range → wrong coin/imposter token or generated demo prices; don't squash the chart
    const own = [e.entryPrice, ctx.exitPx].filter(isN);
    ctx.mismatch = own.some(p => p < lo * 0.8 || p > hi * 1.25);
    // Levels join the price scale only when they sit near the candles: a far target would squash every
    // candle into a thin strip. Far ones are named in the caption instead ("Target … above the chart").
    const span = Math.max(hi - lo, hi * 0.02), near = (p) => p >= lo - span * 2 && p <= hi + span * 2;
    const all = ctx.mismatch ? [] : [
      { price: e.stopPrice, label: 'Stop', kind: 'stop' },
      isN(e.stopFinal) && e.stopFinal !== e.stopPrice ? { price: e.stopFinal, label: 'Moved', name: 'Moved stop', kind: 'stop' } : null,
      { price: e.targetPrice, label: 'Target', kind: 'target' },
      { price: e.entryPrice, label: 'Entry', kind: 'entry' },
    ].filter(l => l && isN(l.price) && l.price > 0);
    const levels = all.filter(l => near(l.price));
    ctx.offChart = all.filter(l => !near(l.price) && l.kind !== 'entry').map(l => ({ label: l.name || l.label, price: l.price, dir: l.price > hi ? 'above' : 'below' }));
    // Charts.candles snaps a marker to the candle whose OPEN time is nearest; half an interval
    // earlier lands it on the candle that contains the fill instead of the next one.
    const half = (ctx.res.intervalMs || 0) / 2;
    Charts.candles(cv, tip, cs, {
      entry: ctx.mismatch || !isN(e.entryPrice) ? null : { t: ctx.t0 - half, price: e.entryPrice },
      exit: ctx.mismatch || !ctx.closed || ctx.badTimes || !isN(ctx.exitPx) ? null : { t: ctx.t1 - half, price: ctx.exitPx },
      levels, fmtP: fmtPriceText, fmtT: axisT(cs[cs.length - 1].t - cs[0].t), win: !!ctx.g.win,
    });
    const x = ctx.badTimes ? null : extremes(ctx);
    const keys = typeof Charts.keyNav === 'function';
    Charts.label(cv, `${ctx.coin} ${ctx.res.interval} candles from ${fmtDateTime(cs[0].t)} to ${fmtDateTime(cs[cs.length - 1].t)}, source ${ctx.res.source}. ` +
      `Entry ${fmtPriceText(e.entryPrice)}${ctx.closed && isN(ctx.exitPx) ? `, exit ${fmtPriceText(ctx.exitPx)}` : ', still open'}.` +
      (x ? ` While the trade was open price ranged from ${fmtPriceText(x.lo)} to ${fmtPriceText(x.hi)}.` : '') +
      (keys ? ' Use the left and right arrow keys to step through the candles.' : ''));
    // Keyboard: arrow keys show the same per-candle tooltip as hovering (Charts.candles has pointer
    // handlers only). The x maths mirrors its 8px left / 64px right plot padding.
    if (keys) {
      let hot = null;
      Charts.keyNav(cv, cs.length, (i) => {
        hot = i;
        if (i == null) { if (cv.onpointerleave) cv.onpointerleave(); return; }
        const r = cv.getBoundingClientRect(), slot = (r.width - 72) / cs.length;
        if (cv.onpointermove && slot > 0) cv.onpointermove({ clientX: r.left + 8 + slot * (i + 0.5) });
      });
      // keyNav swallows every Escape; with no candle highlighted let it through so Escape still closes the drawer
      const kn = cv.onkeydown;
      if (typeof kn === 'function') cv.onkeydown = (ev) => { if (ev.key === 'Escape' && hot == null) return; kn(ev); };
    }
  }
  function notes(ctx) {
    const el = $('.cl-tc-notes', ctx.body);
    if (!el) return;
    const out = [];
    if (ctx.mode === 'demo') out.push('Demo trades use generated prices — the chart shows the real market, so your levels may not line up.');
    if (ctx.badTimes) out.push('This trade has no valid exit time, so the chart shows the day after your entry. Add the exit date and time to the trade to see the whole trade.');
    if (ctx.res && ctx.mismatch) out.push(`Your entry price doesn't match ${ctx.coin}'s market price in this window, so markers and levels are hidden. Is the coin symbol right? Copies of popular tokens share symbols.`);
    if (ctx.res && !ctx.badTimes && !fineFor(ctx)) out.push(`Only ${ctx.res.interval} candles were available — too coarse to see a ${fmtDuration(ctx.t1 - ctx.t0)} trade in detail.`);
    el.innerHTML = out.map(t => `<div class="banner info cl-tc-note"><svg aria-hidden="true"><use href="#i-info"/></svg><span class="grow">${esc(t)}</span></div>`).join('');
  }
  function caption(ctx) {
    const el = $('.cl-tc-cap', ctx.body);
    if (!el || !ctx.res) return;
    const off = (ctx.offChart || []).map(l => `<span class="dim">${esc(l.label)} ${esc(fmtPriceText(l.price))} is ${l.dir} the chart</span>`).join('');
    el.innerHTML = `<span><b>${esc(ctx.res.interval)}</b> candles</span><span>${ctx.res.candles.length} bars</span><span>Candles from ${esc(ctx.res.source)}</span>${off}`;
  }
  function renderExc(ctx) {
    const el = $('.cl-tc-exc', ctx.body);
    if (!el) return;
    const cur = entryById(ctx.id, ctx.mode) || ctx.e;
    const savedHL = isN(cur.highDuring) && isN(cur.lowDuring);
    const saved = savedHL
      ? `Saved: high <b>${fmtPrice(cur.highDuring)}</b> · low <b>${fmtPrice(cur.lowDuring)}</b> <span class="dim">(${esc(srcLabel(cur.excursionSource))})</span>`
      : 'No high/low saved yet — MAE/MFE analytics need them.';
    const editBtn = '<div class="cl-tc-act"><button type="button" class="btn btn-ghost btn-sm" data-act="edit"><svg aria-hidden="true"><use href="#i-edit"/></svg>Edit trade</button></div>';
    let bodyHtml = '';
    if (!ctx.closed) bodyHtml = '<p class="cl-tc-p muted">Close the trade first — the high and low are measured between your entry and exit.</p>';
    else if (ctx.badTimes) bodyHtml = '<p class="cl-tc-p warn-c">This trade has no valid exit time, so the time you held it is unknown and candles can\'t measure its high and low. Add the exit date and time first.</p>' + editBtn;
    else if (ctx.res) {
      const x = extremes(ctx), hold = ctx.t1 - ctx.t0;
      if (!x) bodyHtml = '<p class="cl-tc-p muted">No candles overlap the time you held this trade.</p>';
      else if (ctx.mismatch) bodyHtml = '<p class="cl-tc-p muted">The candles don\'t match your prices, so they can\'t be used for MAE/MFE.</p>';
      else if (!covers(ctx)) bodyHtml = `<p class="cl-tc-p warn-c">The ${esc(ctx.res.source)} history only covers part of the time you held this trade, so its high and low could be missing the real extremes. Enter them by hand for an accurate MAE/MFE.</p>${editBtn}`;
      else {
        const e = ctx.e, long = e.side !== 'short';
        const stopD = isN(e.stopPrice) ? Math.abs(e.entryPrice - e.stopPrice) : null;
        const maeR = stopD ? ((long ? e.entryPrice - x.lo : x.hi - e.entryPrice) / stopD) : null;
        const mfeR = stopD ? ((long ? x.hi - e.entryPrice : e.entryPrice - x.lo) / stopD) : null;
        const rLine = stopD
          ? `<div class="cl-tc-r"><span>Worst point <b class="${maeR > 0 ? 'neg' : ''}">${glyph(-maeR)} ${fmtR(-maeR)}</b></span><span>Best point <b class="${mfeR > 0 ? 'pos' : ''}">${glyph(mfeR)} ${fmtR(mfeR)}</b></span></div>`
          : '<p class="cl-tc-p dim">Add a stop to this trade to see these in R.</p>';
        const fine = fineFor(ctx);
        // Metrics.excursion() measures single-leg trades only — say so before the user saves
        const legs = ctx.g.portions.length > 1 ? '<p class="cl-tc-p dim">This trade was scaled in or out, so the MAE/MFE charts in Analytics leave it out — the values are still saved on the trade.</p>' : '';
        bodyHtml = legs + `<div class="cl-tc-hl"><span>Highest <b>${fmtPrice(x.hi)}</b></span><span>Lowest <b>${fmtPrice(x.lo)}</b></span><span class="dim">from ${x.n} × ${esc(ctx.res.interval)} candle${x.n === 1 ? '' : 's'}</span></div>${rLine}` +
          (fine
            ? `<div class="cl-tc-act"><button type="button" class="btn btn-primary btn-sm" data-act="use-hl"><svg aria-hidden="true"><use href="#i-check"/></svg>Use high/low for MAE/MFE</button>
                <span class="cl-tc-warn">Approximate — each candle spans ${esc(ctx.res.interval)}, so a wick just before your entry or after your exit can be counted. You can edit the values in the trade.</span></div>`
            : `<p class="cl-tc-p warn-c">These ${esc(ctx.res.interval)} candles are too coarse for a ${esc(fmtDuration(hold))} trade — enter the high/low by hand for an accurate MAE/MFE.</p>${editBtn}`);
      }
    }
    el.innerHTML = `<div class="card cl-tc-card"><div class="card-title"><svg aria-hidden="true"><use href="#i-target"/></svg>Best &amp; worst price during the trade
      ${tipFor('mae', 'MAE = how far price went against you while the trade was open; MFE = how far it went in your favour. Both are measured in R (multiples of your stop distance).')}</div>
      <p class="cl-tc-p">${saved}</p>${bodyHtml}</div>`;
    const use = $('[data-act="use-hl"]', el);
    if (use) use.onclick = () => useCandles(ctx);
    const ed = $('[data-act="edit"]', el);
    if (ed) ed.onclick = () => {
      // the trade form edits the active account — only offer it while that is still this trade's account
      const en = db.mode === ctx.mode ? entryById(ctx.id) : null;
      if (!en) { toast('Switch back to the account this trade is in to edit it', 'warn'); return; }
      if (typeof TradeForm === 'undefined' || !TradeForm.open) { toast('The trade form isn’t available right now', 'warn'); return; }
      // Close the chart first: once the trade's times or prices change, this drawer's candles, levels
      // and "Use high/low" button would still describe the old trade and could save stale values.
      Drawer.close();
      TradeForm.open(en);
    };
  }
  async function useCandles(ctx) {
    const x = extremes(ctx), live = () => { const en = entryById(ctx.id, ctx.mode); return en && !en.deletedAt ? en : null; };
    const cur = live();
    if (!x || !cur || !ctx.res) { toast('This trade was deleted or is no longer in this account', 'err'); return; }
    if (!fineFor(ctx) || ctx.mismatch || !covers(ctx)) return;
    if (isN(cur.highDuring) && isN(cur.lowDuring) && !String(cur.excursionSource || '').startsWith('candles:')) {
      const who = cur.excursionSource === 'demo' ? 'The demo generated' : 'You entered';
      const ok = await confirmDialog({
        title: 'Replace the saved high/low?',
        message: `${who} high ${fmtPriceText(cur.highDuring)} and low ${fmtPriceText(cur.lowDuring)}. Replace them with ${fmtPriceText(x.hi)} / ${fmtPriceText(x.lo)} from the ${ctx.res.interval} candles? You can undo this right after.`,
        confirmText: 'Replace',
      });
      if (!ok || !ctx.alive || !live()) return;
    }
    // keep what was there so the toast can put it back (Undo)
    const prev = { highDuring: cur.highDuring, lowDuring: cur.lowDuring, excursionSource: cur.excursionSource };
    const iv = ctx.res.interval, mode = ctx.mode;
    updateEntry(ctx.id, { highDuring: x.hi, lowDuring: x.lo, excursionSource: 'candles:' + iv }, mode);
    commit();
    toast(`High/low saved from ${iv} candles — MAE/MFE updated (approximate)`, 'ok', {
      ms: 9000,
      action: {
        label: 'Undo', run: () => {
          if (!entryById(ctx.id, mode)) return;
          updateEntry(ctx.id, prev, mode);
          commit('High/low restored', 'ok');
          if (ctx.alive) renderExc(ctx);
        },
      },
    });
    if (!ctx.alive) return;
    renderExc(ctx);
    // the button was just replaced — keep keyboard focus on the result instead of dropping it to <body>
    const p = $('.cl-tc-exc .cl-tc-p', ctx.body);
    if (p) { p.tabIndex = -1; p.focus({ preventScroll: true }); }
  }
  async function load(ctx) {
    if (ctx.ro) { ctx.ro.disconnect(); ctx.ro = null; }
    ctx.res = null;
    const seq = ctx.seq = (ctx.seq || 0) + 1;   // only the newest load may draw (Retry while one is in flight)
    setState(ctx, 'loading'); notes(ctx); renderExc(ctx);
    const span = ctx.t1 - ctx.t0, pad = Math.max(span * 0.4, 30 * 60000);
    const res = await Market.candles({ coin: ctx.coin, fromMs: ctx.t0 - pad, toMs: ctx.t1 + pad });
    if (!ctx.alive || seq !== ctx.seq) return;
    if (!res || !res.candles || res.candles.length < 2) { setState(ctx, Market.online() ? 'fail' : 'offline'); renderExc(ctx); return; }
    ctx.res = res;
    const stEl = $('.cl-tc-state', ctx.body), hadFocus = !!stEl && document.activeElement === stEl;
    setState(ctx, 'ok'); draw(ctx); notes(ctx); caption(ctx); renderExc(ctx);
    // the status region is hidden now — hand focus to the (keyboard-navigable) chart
    if (hadFocus) { const cv = $('.cl-tc-box canvas', ctx.body); if (cv) cv.focus({ preventScroll: true }); }
    const box = $('.cl-tc-box', ctx.body);
    if (box && typeof ResizeObserver === 'function') {
      let queued = false;
      ctx.ro = new ResizeObserver(() => {
        if (queued) return; queued = true;
        requestAnimationFrame(() => { queued = false; if (ctx.alive) draw(ctx); });
      });
      ctx.ro.observe(box);
    }
  }
  // TradeChart.open(tradeId) — tradeId may also be a scale row's id
  function open(tradeId) {
    const g = (typeof groupById === 'function' && groupById(tradeId)) || (typeof groupOfRow === 'function' && groupOfRow(tradeId)) || null;
    if (!g) { toast('Trade not found in this account', 'err'); return; }
    const e = g.trade, coin = String(e.coin || '').toUpperCase().trim(), t0 = Date.parse(e.entryAt);
    if (!coin || !isFinite(t0) || !isN(e.entryPrice)) { toast('This trade needs a coin, an entry price and an entry time to chart', 'warn'); return; }
    // a typo'd future entry date has no price history yet — say so instead of "no candles found"
    if (t0 > Date.now() + 5 * MIN) { toast('This trade’s entry time is in the future — fix the date to see its chart', 'warn'); return; }
    const closed = !!g.closed;
    // A closed trade without a usable exit time (legacy/imported rows) has an unknown holding
    // period: chart the day after entry and never derive its high/low from that guess.
    // Entry and exit in the same minute (a scalp — datetime-local has minute precision) is a real
    // trade, not a missing exit: give it the one-minute candle it happened in.
    let t1 = Date.now(), badTimes = false;
    if (closed) {
      if (isN(g.exitMs) && g.exitMs >= t0) t1 = Math.max(g.exitMs, t0 + MIN);
      else { badTimes = true; t1 = Math.min(Date.now(), t0 + DAY); }
    }
    if (t1 <= t0) t1 = t0 + MIN;
    const held = closed && !badTimes ? g.exitMs - t0 : t1 - t0;
    const ctx = { id: e.id, mode: db.mode, g, e, coin, t0, t1, closed, badTimes, exitPx: closed ? avgExit(g) : null, alive: true, res: null, ro: null, body: null, mismatch: false, state: null };
    Drawer.open({
      title: `${coin} ${e.side === 'short' ? 'short' : 'long'} — price chart`,
      sub: `${fmtDateTime(t0)} → ${!closed ? 'still open' : badTimes ? 'exit time not recorded' : fmtDateTime(g.exitMs)}${badTimes ? '' : held < MIN ? ' · held under a minute' : ` · held ${fmtDuration(held)}`}`,
      width: 860, html: shell(ctx),
      onMount: (body) => { ctx.body = body; active = ctx; load(ctx); },
      onClose: () => { ctx.alive = false; if (active === ctx) active = null; if (ctx.ro) { ctx.ro.disconnect(); ctx.ro = null; } },
    });
  }
  // Back online while the chart shows "You're offline" → load it without making the user press Retry.
  // (market.js's own 'net' listener has already cleared the request back-off by the time this runs.)
  let active = null;
  if (typeof Bus !== 'undefined') Bus.on('net', (d) => {
    const c = active;
    if (!d || !d.online || !c || !c.alive || c.state !== 'offline') return;
    setTimeout(() => {
      if (!c.alive || c.state !== 'offline' || !Market.online()) return;
      const st = $('.cl-tc-state', c.body), had = !!st && st.contains(document.activeElement);
      load(c);
      // the Retry button is replaced by the spinner — keep keyboard focus in the status region
      if (had && st) { st.tabIndex = -1; st.focus({ preventScroll: true }); }
    }, 1200);
  });
  return { open };
})();
