// CryptoJournal service worker — offline app shell caching (scope: /journal/)
const CACHE = 'cryptojournal-v9';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './css/dashboard.css', './css/tradeform.css', './css/ledger.css', './css/analytics.css',
  './css/readiness.css', './css/journal.css', './css/discipline.css', './css/calc.css',
  './css/learn.css', './css/settings.css', './css/importer.css', './css/palette.css', './css/sync.css',
  './engine.js', './metrics.js', './charts.js', './patterns.js', './core.js', './market.js',
  './store.js', './config.js', './sync.js', './sync-ui.js', './tradeform.js',
  './pages/ledger.js', './pages/analytics.js', './pages/readiness.js', './pages/journal.js',
  './pages/discipline.js', './pages/calc.js', './pages/learn.js', './pages/settings.js',
  './importer.js', './palette.js', './demo.js', './app.js',
  './manifest.webmanifest',
  './icon.svg', './icon-maskable.svg',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];
// Hosts the worker never touches — requests go straight to the network, nothing is cached:
// market data (market.js keeps its own "as of" quotes) and Supabase (REST, auth, storage,
// realtime) — those responses are private journal data and tokens, so they must never sit in a cache.
const LIVE_HOSTS = ['coingecko.com', 'dexscreener.com', 'geckoterminal.com', 'binance.vision', 'coinbase.com', 'okx.com', 'pulsechain.com', 'supabase.co'];

self.addEventListener('install', (e) => {
  // addAll is atomic — cache each file on its own so one missing file can't block the install
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => c.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache market data or cloud sync — always live, fail silently offline.
  if (LIVE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return;
  // Belt and braces: anything sent with credentials is private, whatever the host.
  if (req.headers.has('authorization')) return;

  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin) {
    // The app is served by a LOCAL server that's up whenever the app is running,
    // so always prefer fresh files — this guarantees code changes show up on the
    // next launch. The cache is only a fallback for when the server is unreachable.
    e.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Cross-origin (e.g. Google Fonts): stale-while-revalidate.
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = await c.match(req);
      const network = fetch(req).then((resp) => {
        if (resp && (resp.ok || resp.type === 'opaque')) c.put(req, resp.clone());
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
