/* ═══════════════════════════════════════════════════════════
   CryptoJournal — exchange CSV importer (page 'import')
   Drop a CSV → detect the exchange preset (or map columns) →
   normalise fills → rebuild round trips per coin (signed position,
   weighted-average entry, scale-in / scale-out legs) → staging
   preview with dedupe + P/L reconciliation → commit as ONE
   undoable batch (importBatchId, needsReview, no stop yet).
   Everything runs locally: no exchange login, no API keys.
   Public: Importer.open() · Importer.batches() · Importer.removeBatch(id, mode)
           Importer.analyzeText(text, opts) + pure parsers (tests)
   ═══════════════════════════════════════════════════════════ */
const Importer = (() => {
  /* ── Constants ─────────────────────────────────────────── */
  const MAX_BYTES = 15 * 1024 * 1024;
  const PAGE_ROWS = 150;
  const MAX_SOURCES = 10;
  const MAX_LEGS = 8;          // more (lot × exit) pieces than this collapse to one leg per entry lot
  const MAX_OPEN_LOTS = 24;    // grid-bot style positions merge their open lots (keeps the maths linear)
  const MODE_LABEL = { paper: 'Paper', live: 'Live', demo: 'Demo' };
  // Quotes that are dollars for P/L purposes; EUR/GBP are imported 1:1 with a warning.
  const USD_Q = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'USDE', 'USDP', 'PYUSD', 'DAI', 'USD'];
  const FIAT_Q = ['EUR', 'GBP'];
  const QUOTE_SUFFIX = ['FDUSD', 'PYUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'USDE', 'USDP', 'DAI', 'USD', 'EUR', 'GBP', 'TRY', 'BTC', 'ETH', 'BNB'];
  const ALIAS = { XBT: 'BTC', XXBT: 'BTC', XDG: 'DOGE', XXDG: 'DOGE', XETH: 'ETH', XXRP: 'XRP', XLTC: 'LTC', ZUSD: 'USD', ZEUR: 'EUR', ZGBP: 'GBP' };
  const isUsd = (q) => !q || USD_Q.includes(q);

  // Field labels for the mapping UI. Fill grain = one row per fill/order; closed grain = one row per closed trade.
  const LABEL = {
    time: 'Date / time', exitTime: 'Close time', symbol: 'Symbol / pair', side: 'Side', price: 'Price', qty: 'Quantity',
    total: 'Total (price × qty)', entryPrice: 'Entry price', exitPrice: 'Exit price', fee: 'Fee', feeAsset: 'Fee asset', pnl: 'Realised P/L',
    funding: 'Funding', fundAsset: 'Funding asset', id: 'Trade ID', orderId: 'Order ID',
  };
  const FILL_FIELDS = ['time', 'symbol', 'side', 'price', 'qty', 'total', 'fee', 'feeAsset', 'pnl', 'funding', 'id', 'orderId'];
  const CLOSED_FIELDS = ['exitTime', 'time', 'symbol', 'side', 'entryPrice', 'exitPrice', 'qty', 'fee', 'pnl', 'funding', 'id'];
  const FUND_FIELDS = ['time', 'symbol', 'funding', 'fundAsset', 'id'];
  const HINT = {
    side: 'Buy / Sell (or Open long, Close short…)', qty: 'In coins, not dollars', funding: 'Negative = you paid',
    fee: 'In the fee asset (or $)', pnl: 'Only used to cross-check totals', total: 'Works out price or quantity if one is missing',
    time: 'Pick the time zone above', orderId: 'Fills of one order are merged',
  };
  const TZS = [['UTC', 'UTC (most exchanges)'], ['UTC+8', 'UTC+8 (MEXC, some OKX exports)'], ['local', 'My computer’s time zone'],
    ['UTC-5', 'UTC−5'], ['UTC-4', 'UTC−4'], ['UTC+1', 'UTC+1'], ['UTC+2', 'UTC+2'], ['UTC+3', 'UTC+3'], ['UTC+9', 'UTC+9']];

  // Header synonyms used to pre-fill the column mapping (normalised: lowercase, letters/digits only).
  const GUESS = {
    time: ['dateutc', 'timeutc', 'datetime', 'timestamp', 'time', 'date', 'createdat', 'filltime', 'tradetime', 'executiontime', 'opentime',
      'when', 'tradedate', 'executedat', 'filledat', 'orderdate', 'ordertime', /^(date|time)/, /(date|time)/],
    exitTime: ['closetime', 'exittime', 'closedat', 'closingtime', 'tradetime', 'updatetime', /^clos.*time/],
    symbol: ['symbol', 'pair', 'pairs', 'market', 'instrument', 'contract', 'contracts', 'product', 'ticker', 'futurestradingpair', 'coin', 'asset'],
    side: ['side', 'direction', 'action', 'buysell', 'tradeside', 'closingdirection', 'type', 'transactiontype'],
    price: ['price', 'filledprice', 'avgprice', 'averageprice', 'averagefilledprice', 'executionprice', 'fillprice', 'tradeprice', 'dealprice', 'priceattransaction'],
    entryPrice: ['entryprice', 'openprice', 'avgentryprice', 'averageentryprice', 'openingprice'],
    exitPrice: ['exitprice', 'closeprice', 'avgexitprice', 'averageexitprice', 'closingprice'],
    qty: ['qty', 'quantity', 'executed', 'executedamount', 'filledqty', 'filledquantity', 'size', 'amount', 'volume', 'vol', 'quantitytransacted', 'filled'],
    total: ['total', 'amount', 'subtotal', 'cost', 'value', 'notional', 'turnover', 'tradingtotal', 'filledvalue'],
    fee: ['fee', 'fees', 'commission', 'feepaid', 'tradingfee', 'feesandorspread', 'totalfee'],
    feeAsset: ['feecoin', 'feeasset', 'feecurrency', 'commissionasset', 'feeunit'],
    pnl: ['realizedprofit', 'realizedpnl', 'realisedpnl', 'closedpnl', 'closedpl', 'closingpnl', 'pnl', 'pl', 'profit', 'netpnl'],
    funding: ['funding', 'fundingfee', 'fundingfees'],
    id: ['tradeid', 'fillid', 'execid', 'txid', 'transactionid', 'id'],
    orderId: ['orderid', 'ordertxid', 'orderno', 'ordernumber'],
  };

  /* ── Built-in exchange presets ─────────────────────────── */
  // need: headers that must all be present (normalised). map: candidate headers per field (first hit wins).
  // Extra internal fields: total (quote amount → derive price/qty), unit (qty unit), kind (row type),
  // marketCol (spot/swap per row), quote, margin, status, fundAsset, fee2.
  // Headers from the research notes (BittyTax parsers, TradesViz, Kraken help); 'unverified' = check the preview.
  const PRESETS = [
    { id: 'binance-spot', name: 'Binance · spot trade history', venue: 'Binance', market: 'spot', tz: 'UTC',
      need: ['dateutc', 'pair', 'side', 'price', 'executed', 'amount', 'fee'],
      map: { time: ['dateutc'], symbol: ['pair'], side: ['side'], price: ['price'], qty: ['executed'], total: ['amount'], fee: ['fee'] } },
    { id: 'binance-spot-old', name: 'Binance · spot (older export)', venue: 'Binance', market: 'spot', tz: 'UTC',
      need: ['dateutc', 'market', 'type', 'price', 'amount', 'total', 'fee', 'feecoin'],
      map: { time: ['dateutc'], symbol: ['market'], side: ['type'], price: ['price'], qty: ['amount'], total: ['total'], fee: ['fee'], feeAsset: ['feecoin'] } },
    { id: 'binance-futures', name: 'Binance · USDⓈ-M futures trade history', venue: 'Binance', market: 'perp', tz: 'UTC',
      need: ['symbol', 'side', 'price', 'quantity', 'fee', 'feecoin'],
      map: { time: [/^(date|time)utc/, 'date', 'time'], symbol: ['symbol'], side: ['side'], price: ['price'], qty: ['quantity'], total: ['amount'],
        fee: ['fee'], feeAsset: ['feecoin'], pnl: ['realizedprofit', 'realizedpnl'], quote: ['quoteasset'], id: ['tradeid'], orderId: ['orderid'] } },
    { id: 'binance-futures-tx', name: 'Binance · futures transaction history (funding)', venue: 'Binance', market: 'perp', tz: 'UTC', funding: true,
      need: ['type', 'amount', 'asset', 'symbol'], not: ['price', 'side', 'quantity'],
      map: { time: [/^(date|time)utc/, 'time', 'date'], kind: ['type'], funding: ['amount'], fundAsset: ['asset'], symbol: ['symbol'], id: ['transactionid', 'tranid'] },
      kinds: { funding: /^funding[_ ]?fee$/i }, fundSign: -1 },   // Binance: negative amount = you paid
    { id: 'bybit-uta', name: 'Bybit · transaction log (Unified account)', venue: 'Bybit', market: 'perp', tz: 'UTC',
      need: ['contract', 'type', 'direction', 'quantity', 'filledprice', 'feepaid'],
      map: { time: ['time', /^timeutc/], symbol: ['contract'], kind: ['type'], side: ['direction'], qty: ['quantity'], price: ['filledprice'],
        fee: ['feepaid'], feeAsset: ['currency'], funding: ['funding'], id: ['tradeid'], orderId: ['orderid'] },
      kinds: { fill: /^(trade|liquidat|adl|delivery)/i, funding: /^settlement$/i }, fundSign: 1 },   // Bybit API: positive funding = expense
    { id: 'bybit-closed', name: 'Bybit · closed P&L', venue: 'Bybit', market: 'perp', tz: 'UTC', grain: 'closed', unverified: true, sideMode: 'closing',
      need: ['contracts', 'closingdirection', 'entryprice', 'exitprice'],
      map: { symbol: ['contracts'], side: ['closingdirection'], qty: ['qty', 'quantity', 'closedqty', 'filledqty'], entryPrice: ['entryprice'], exitPrice: ['exitprice'],
        pnl: [/^closedp/], time: ['createtime', 'opentime'], exitTime: [/^tradetime/, 'closetime', 'updatetime', 'time'],
        fee: ['openingfee', 'openfee'], fee2: ['closingfee', 'closefee'], funding: ['fundingfee'], id: ['orderid'] }, fundSign: 1 },
    { id: 'okx', name: 'OKX · trade history', venue: 'OKX', market: 'spot', tz: 'UTC',
      need: ['orderid', 'time', 'tradetype'],
      map: { time: ['time'], symbol: ['instrument', 'symbol'], side: ['action', 'side', 'type'], price: ['filledprice', 'price', 'avgprice', 'fillprice'],
        qty: ['amount', 'filledamount', 'size', 'quantity'], unit: ['tradingunit', 'unit'], fee: ['fee'], feeAsset: ['feeunit', 'feecurrency'],
        pnl: ['pnl', 'pl'], id: ['id', 'tradeid'], orderId: ['orderid'], marketCol: ['tradetype'] } },
    { id: 'kraken', name: 'Kraken · trades.csv', venue: 'Kraken', market: 'spot', tz: 'UTC',
      need: ['txid', 'ordertxid', 'pair', 'time', 'type', 'price', 'cost', 'fee', 'vol'],
      map: { time: ['time'], symbol: ['pair'], side: ['type'], price: ['price'], qty: ['vol'], total: ['cost'], fee: ['fee'], id: ['txid'], orderId: ['ordertxid'], margin: ['margin'] } },
    { id: 'coinbase', name: 'Coinbase · transaction history', venue: 'Coinbase', market: 'spot', tz: 'UTC', symIsBase: true,
      need: ['timestamp', 'transactiontype', 'asset', 'quantitytransacted'],
      map: { time: ['timestamp'], kind: ['transactiontype'], side: ['transactiontype'], symbol: ['asset'], qty: ['quantitytransacted'],
        price: ['priceattransaction', 'spotpriceattransaction'], quote: ['pricecurrency', 'spotpricecurrency'], total: ['subtotal', 'usdsubtotal'],
        fee: ['feesandorspread', 'usdfees', 'fees'], id: ['id'] },
      kinds: { fill: /(^|\s)(buy|sell)$/i } },
    { id: 'coinbase-adv', name: 'Coinbase Advanced · fills', venue: 'Coinbase', market: 'spot', tz: 'UTC', unverified: true,
      need: ['tradeid', 'product', 'side', 'createdat', 'size', 'price'],
      map: { time: ['createdat'], symbol: ['product'], side: ['side'], qty: ['size'], unit: ['sizeunit'], price: ['price'], fee: ['fee'],
        feeAsset: ['pricefeetotalunit', 'feeunit'], id: ['tradeid'], orderId: ['orderid'] } },
    { id: 'mexc-spot', name: 'MEXC · spot trade history', venue: 'MEXC', market: 'spot', tz: 'UTC+8',
      need: ['pairs', 'time', 'side', 'filledprice', 'executedamount'],
      map: { time: ['time', /^timeutc/], symbol: ['pairs'], side: ['side'], price: ['filledprice'], qty: ['executedamount'], total: ['total'], fee: ['fee'], id: ['tradeid'], orderId: ['orderid'] } },
    { id: 'mexc-futures', name: 'MEXC · futures order history', venue: 'MEXC', market: 'perp', tz: 'UTC+8', unverified: true,
      need: ['futurestradingpair', 'direction', 'averagefilledprice'],
      map: { time: [/^timeutc/, 'time', 'ordertime'], symbol: ['futurestradingpair'], side: ['direction'], price: ['averagefilledprice'],
        qty: [/^filled(qty|quantity|amount|volume|vol)/, 'dealvol', 'filled', 'quantity'], fee: ['tradingfee'], feeAsset: ['feepaymentcrypto'],
        pnl: ['closingpnl'], status: ['status'], orderId: ['orderid', 'orderno'] } },
  ];

  // Where to find the export on each exchange (menus move — wording stays hedged).
  const GUIDES = [
    { v: 'Binance', html: 'Usually <b>Orders → Spot Order</b> (or <b>Futures Order</b>) <b>→ Trade History → Export</b>. One file covers up to ~3 months — drop several at once. For futures funding also export <b>Transaction History</b>. Binance sometimes gives an <b>.xlsx</b>: open it in Excel → <b>File → Save As → CSV UTF-8</b>.' },
    { v: 'Bybit', html: 'Unified account: <b>Assets → Transaction Log → Export</b>. It holds your trades and funding payments in one file. A Closed P&amp;L export also works (check the preview).' },
    { v: 'OKX', html: '<b>Assets → Order center → Trade history → Download</b>. Check which time zone the export uses and pick it on the next step.' },
    { v: 'Kraken', html: '<b>History → Export → Trades → CSV</b>. Kraken sends a .zip — unzip it and drop <b>trades.csv</b>.' },
    { v: 'Coinbase', html: '<b>Profile → Statements / Reports → Transaction history → CSV</b>. Coinbase Advanced: <b>Orders → Fills → Download</b>.' },
    { v: 'MEXC', html: '<b>Orders → Spot / Futures orders → Trade history → Export</b>. MEXC times are UTC+8 — the importer converts them to your time.' },
  ];

  // Row flags. hard = can't be imported correctly (checkbox disabled); block = unticked by default; others = warning only.
  const FLAG = {
    basis: { t: 'Opening balance unknown', block: true, tip: 'You sold coins this file never bought (an opening balance, or a buy older than the export). Type your average buy price in the Entry column to include it, or leave it out.' },
    preclose: { t: 'Opened before this file', block: true, tip: 'The position was opened before the file’s date range. The entry price is worked out from the exchange’s realised P/L; the entry time is unknown.' },
    quote: { t: 'Not priced in $', hard: true, tip: 'The pair is priced in another coin or currency (e.g. ETH/BTC), so its P/L is not in dollars. Log it by hand if you need it.' },
    cont: { t: 'Size in contracts', hard: true, tip: 'The quantity is in contracts, not coins, so P/L would be wrong. Export a file that shows size in coins (most exchanges have a unit setting).' },
    inverse: { t: 'Coin-margined futures', hard: true, tip: 'Inverse (coin-margined) contracts such as BTCUSD are sized in contracts and settle in the coin, so the P/L would not be in dollars. Log these by hand.' },
    fee: { t: 'Fee in BNB/other — edit', block: false, tip: 'The fee was paid in another coin, so it is imported as $0. Add the $ value when you review the trade.' },
    eur: { t: 'In EUR/GBP (shown as $)', block: false, tip: 'Amounts are imported 1:1 as dollars.' },
    dust: { t: 'Tiny leftover ignored', block: false, tip: 'A dust amount stayed after the sell (usually a fee taken in the coin itself) — the trade is treated as closed.' },
  };

  /* ── Small helpers ─────────────────────────────────────── */
  let nextId = 1;
  const lid = (p) => p + (nextId++).toString(36);
  const normH = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const cell = (row, i) => (i == null || i < 0 || row[i] == null ? '' : String(row[i]).trim());
  const slug = (v) => String(v || 'other').toLowerCase().replace(/[^a-z0-9]/g, '') || 'other';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const nfmt = (n) => Number(n || 0).toLocaleString('en-US');
  // FNV-1a — short stable hash for extIds when the exchange gives no trade id
  function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
  const roundP = (v) => (isNum(v) ? +v.toPrecision(12) : v);
  const roundUsd = (v) => (isNum(v) ? Math.round(v * 1e6) / 1e6 : 0);
  // Asset codes from the file ('USDT', 'bnb ', 'XXBT') → letters/digits only: they end up in notes and badges
  const assetOf = (v) => { const a = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); return ALIAS[a] || a; };

  /* ── CSV parser (RFC 4180: quotes, "" escapes, CRLF, BOM; , ; tab | auto) ── */
  function countOutside(line, d) { let n = 0, q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; }
  function sniff(text) {
    const lines = text.slice(0, 8000).split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 8);
    let best = ',', score = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map(l => countOutside(l, d));
      // a real delimiter shows up on (nearly) every line; break ties by how often
      const s = counts.filter(c => c > 0).length * 1000 + Math.max(0, ...counts);
      if (counts.some(c => c > 0) && s > score) { best = d; score = s; }
    }
    return best;
  }
  function parseCSV(text) {
    text = String(text || '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    let delim = null;
    const sep = /^sep=(.)\s*(\r\n|\n|\r)/i.exec(text);   // Excel "sep=;" hint line
    if (sep) { delim = sep[1]; text = text.slice(sep[0].length); }
    if (!delim) delim = sniff(text);
    const rows = []; let row = [], c = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { c += '"'; i++; } else q = false; }
        else c += ch;
      } else if (ch === '"' && c.trim() === '') { q = true; c = ''; }
      else if (ch === delim) { row.push(c); c = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(c); rows.push(row); row = []; c = ''; }
      else c += ch;
    }
    if (c !== '' || row.length) { row.push(c); rows.push(row); }
    return { delim, rows: rows.filter(r => r.some(x => String(x).trim() !== '')) };
  }

  /* ── Numbers: '0.01BTC', '$1,234.56', '1.234,56', '(12.3)', '−5 USDT', '1 234,5', '1.2E-5' ── */
  function parseNum(raw, decComma) {
    // NBSP / narrow NBSP / apostrophe are thousands separators; '1 234,5' → '1234,5'
    let s = String(raw == null ? '' : raw).trim().replace(/−/g, '-').replace(/[  ']/g, '').replace(/(\d)\s+(?=\d)/g, '$1');
    if (!s || /^(-|--|n\/a|null|none)$/i.test(s)) return { v: null, asset: '' };
    let sign = 1, asset = '';
    if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1).trim(); }
    const takeSign = () => { s = s.replace(/^([+-])\s*/, (m, g) => { if (g === '-') sign = -sign; return ''; }); };
    takeSign();
    s = s.replace(/^[$€£]\s*/, '');
    const pre = /^([A-Za-z][A-Za-z0-9]{0,11})\s+(?=[-+\d.,])/.exec(s);   // 'USDT 12.5'
    if (pre) { asset = pre[1]; s = s.slice(pre[0].length); }
    takeSign();
    s = s.replace(/^[$€£]\s*/, '');
    const m = /^([\d.,]+(?:[eE][+-]?\d+)?)\s*([A-Za-z][A-Za-z0-9]*)?$/.exec(s);
    if (!m) return { v: null, asset: '' };
    let n = m[1]; if (m[2]) asset = m[2];
    const hasC = n.includes(','), hasD = n.includes('.');
    if (hasC && hasD) n = n.lastIndexOf(',') > n.lastIndexOf('.') ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
    // '1,234' = thousands in a comma file; '0,001' is always a decimal (no number starts with a 0 thousands group)
    else if (hasC) n = (n.match(/,/g).length > 1 || (!decComma && /^[1-9]\d{0,2}(,\d{3})+$/.test(n))) ? n.replace(/,/g, '') : n.replace(',', '.');
    else if (hasD && /^\d{1,3}(\.\d{3}){2,}$/.test(n)) n = n.replace(/\./g, '');   // '1.234.567' = dots as thousands
    const v = parseFloat(n);
    return { v: isFinite(v) ? sign * v : null, asset: asset.toUpperCase() };
  }

  /* ── Times: explicit tz → epoch ms (stored later as local 'YYYY-MM-DDTHH:mm') ── */
  function tzMin(tz) {
    if (!tz || tz === 'UTC') return 0;
    if (tz === 'local') return null;
    const m = /^UTC\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(tz);
    return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0;
  }
  // order: null (ISO) | 'ymd' (Binance '21-03-05') | 'mdy' | 'dmy' — decided per file by dateOrder()
  function parseTime(raw, tz, order) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    if (/^\d{9,10}(\.\d+)?$/.test(s)) return Math.round(+s * 1000);   // epoch seconds
    if (/^\d{12,13}$/.test(s)) return +s;                              // epoch ms
    let y, mo, d, h = 0, mi = 0, sec = 0, ms = 0, rest = '', off = null, m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; rest = s.slice(m[0].length); }
    else if ((m = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{2,4})/.exec(s))) {
      const a = +m[1], b = +m[3], c = +m[4];
      if (m[4].length <= 2 && order === 'ymd') { y = 2000 + a; mo = b; d = c; }
      else { y = c < 100 ? 2000 + c : c; if (order === 'dmy') { d = a; mo = b; } else { mo = a; d = b; } }
      rest = s.slice(m[0].length);
    } else {
      // Month-name formats ('Jan 5, 2024 3:04 PM'): let the browser parse, then re-read in the file's tz
      const t = Date.parse(s);
      if (!isFinite(t)) return null;
      if (/(Z|UTC|GMT|[+-]\d{2}:?\d{2})\s*$/i.test(s)) return t;
      const x = new Date(t);
      y = x.getFullYear(); mo = x.getMonth() + 1; d = x.getDate(); h = x.getHours(); mi = x.getMinutes(); sec = x.getSeconds();
    }
    if (rest) {
      const tm = /(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*([AaPp][Mm])?/.exec(rest);
      if (tm) {
        h = +tm[1]; mi = +tm[2]; sec = +(tm[3] || 0); ms = tm[4] ? +(tm[4] + '00').slice(0, 3) : 0;
        if (tm[5]) { const pm = /p/i.test(tm[5]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
        rest = rest.slice(tm.index + tm[0].length);
      }
      // An explicit zone in the value always wins over the file setting
      if (/^\s*(Z|UTC|GMT)\s*$/i.test(rest)) off = 0;
      else { const z = /([+-])(\d{1,2}):?(\d{2})?\s*$/.exec(rest); if (z) off = (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +(z[3] || 0)); }
    }
    if (!(y > 1990 && y < 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60 && sec < 61)) return null;
    if (off == null) off = tzMin(tz);
    if (off == null) return new Date(y, mo - 1, d, h, mi, sec, ms).getTime();
    return Date.UTC(y, mo - 1, d, h, mi, sec, ms) - off * 60000;
  }

  /* ── Symbols: BTCUSDT, BTC-USDT-SWAP, BTC_USDT, XBTUSD, XXBTZUSD → coin + quote ── */
  function normSym(raw, quoteHint, isBase) {
    const s = String(raw || '').trim().toUpperCase();
    let base = '', quote = '';
    if (s) {
      // contract suffixes go, but never the first part — PERP is also a coin (Perpetual Protocol)
      const parts = s.split(/[-/_:\s]+/).filter(Boolean).filter((p, i) => i === 0 || !/^(SWAP|PERP|PERPETUAL|FUTURES?|SPOT|\d+)$/.test(p));
      if (isBase || parts.length === 1 && parts[0].length <= 3) base = parts[0] || '';
      else if (parts.length >= 2) { base = parts[0]; quote = parts[1]; }
      else if (parts.length === 1) {
        const p = parts[0].length > 5 && parts[0].endsWith('PERP') ? parts[0].slice(0, -4) : parts[0];   // Bybit USDC perps: BTCPERP
        const k = /^X([A-Z]{3})[XZ]([A-Z]{3})$/.exec(p);   // Kraken XXBTZUSD
        if (k) { base = k[1]; quote = k[2]; }
        else {
          // XBTUSD / DOTUSD end in 'TUSD' too: prefer a quote that leaves a 3+ letter coin (BTCTUSD still → BTC/TUSD)
          const cands = QUOTE_SUFFIX.filter(x => p.endsWith(x) && p.length - x.length >= 2);
          const q = cands.find(x => p.length - x.length >= 3) || cands[0];
          if (q) { base = p.slice(0, -q.length); quote = q; } else base = p;
        }
      }
    }
    base = ALIAS[base] || base; quote = ALIAS[quote] || quote;
    if (!quote && quoteHint) { const h = String(quoteHint).trim().toUpperCase(); quote = ALIAS[h] || h; }
    return { coin: base.replace(/[^A-Z0-9]/g, '').slice(0, 20), quote: quote.replace(/[^A-Z0-9]/g, '').slice(0, 10) };
  }
  // Fill side → 'buy' | 'sell'
  function sideOf(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return null;
    if (/open\s*long|close\s*short/.test(s)) return 'buy';
    if (/open\s*short|close\s*long/.test(s)) return 'sell';
    if (/\bbuy\b|^b$|bought|^long$/.test(s)) return 'buy';
    if (/\bsell\b|^s$|sold|^short$/.test(s)) return 'sell';
    return null;
  }
  // Closed-trade side → 'long' | 'short' (a "closing" Sell means the position was long)
  function posSideOf(v, closing) {
    const s = String(v || '').trim().toLowerCase();
    if (/long/.test(s)) return 'long';
    if (/short/.test(s)) return 'short';
    const sd = sideOf(s);
    if (!sd) return null;
    return closing ? (sd === 'sell' ? 'long' : 'short') : (sd === 'buy' ? 'long' : 'short');
  }

  /* ── Header row, presets and column mapping ────────────── */
  const KNOWN = (() => {
    const s = new Set();
    const add = (c) => { if (typeof c === 'string') s.add(c); };
    for (const list of Object.values(GUESS)) list.forEach(add);
    for (const P of PRESETS) { P.need.forEach(add); for (const list of Object.values(P.map)) list.forEach(add); }
    return s;
  })();
  const CUSTOM = { id: 'custom', name: 'Custom mapping', venue: 'Other', market: 'spot', tz: 'UTC', grain: 'fill', fundSign: -1, need: [], map: {} };

  // Some exports put a title or account line above the header — pick the row that looks most like one.
  function findHeader(rows) {
    let best = 0, score = -Infinity;
    for (let i = 0; i < Math.min(rows.length - 1, 25); i++) {
      const cells = rows[i].map(c => String(c).trim()).filter(Boolean);
      if (cells.length < 2) continue;
      let s = 0;
      for (const c of cells) {
        if (KNOWN.has(normH(c))) s += 3;
        else if (/^[-+$€£(]?[\d.,]+\)?[a-z]*$/i.test(c)) s -= 2;   // a number: data, not a header
        else s += 0.25;
      }
      if (s > score) { score = s; best = i; }
    }
    return best;
  }
  const userPresets = () => (Array.isArray(db.importPresets)
    ? db.importPresets.filter(p => p && typeof p === 'object' && p.id && p.map && typeof p.map === 'object' && !Array.isArray(p.map)) : []);
  const builtIn = (id) => PRESETS.find(p => p.id === id) || null;
  // Saved presets reuse a built-in's row logic (kinds, fee asset, sign conventions) through `base`.
  function presetById(pid) {
    const b = builtIn(pid); if (b) return b;
    const up = userPresets().find(p => p.id === pid);
    if (!up) return CUSTOM;
    const base = builtIn(up.base);
    return {
      ...(base || CUSTOM), id: up.id, name: String(up.name || 'My preset').slice(0, 60), user: true, userMap: up.map, base: base ? base.id : null,
      venue: VENUES.includes(up.venue) ? up.venue : (base ? base.venue : 'Other'),
      market: up.market === 'perp' || up.market === 'spot' ? up.market : (base ? base.market : 'spot'),
      tz: typeof up.tz === 'string' && up.tz ? up.tz : (base ? base.tz : 'UTC'),
      grain: up.grain === 'closed' || up.grain === 'fill' ? up.grain : (base && base.grain) || 'fill',
      unverified: false,
    };
  }
  const matchH = (c, h) => (c instanceof RegExp ? c.test(h) : h === c);
  // Built-in map: candidates per field, first hit wins (one column may serve two fields, e.g. Coinbase kind + side)
  function resolveMap(map, hn) {
    const out = {};
    for (const [f, cands] of Object.entries(map || {})) {
      out[f] = -1;
      for (const c of cands) { const i = hn.findIndex(h => h && matchH(c, h)); if (i >= 0) { out[f] = i; break; } }
    }
    return out;
  }
  // Unknown file: guess each field from header synonyms; one column per field
  function guessMap(hn, grain) {
    const out = {}, used = new Set();
    for (const f of grain === 'closed' ? CLOSED_FIELDS : FILL_FIELDS) {
      out[f] = -1;
      for (const c of GUESS[f] || []) {
        const i = hn.findIndex((h, j) => h && !used.has(j) && matchH(c, h));
        if (i >= 0) { out[f] = i; used.add(i); break; }
      }
    }
    return out;
  }
  function mapFromUser(P, hn) {
    const b = builtIn(P.base), out = b ? resolveMap(b.map, hn) : {};
    for (const [f, h] of Object.entries(P.userMap || {})) out[f] = hn.indexOf(normH(h));
    return out;
  }
  function detect(src) {
    const hs = new Set(src.hn), has = (c) => (c instanceof RegExp ? src.hn.some(h => c.test(h)) : hs.has(c));
    let best = 'custom', score = 0;
    for (const up of userPresets()) {
      const m = Array.isArray(up.match) ? up.match.map(normH).filter(Boolean) : [];
      if (m.length && m.every(h => hs.has(h)) && 100 + m.length > score) { best = up.id; score = 100 + m.length; }
    }
    for (const P of PRESETS) if (P.need.every(has) && !(P.not || []).some(has) && P.need.length > score) { best = P.id; score = P.need.length; }
    return best;
  }
  const mapped = (src, f) => isNum(src.map[f]) && src.map[f] >= 0;
  // 'Time(UTC+08:00)' / 'Date(UTC)' in the header says which zone the values use
  function headerTz(src) {
    const i = mapped(src, 'time') ? src.map.time : mapped(src, 'exitTime') ? src.map.exitTime : -1;
    const h = i >= 0 ? String(src.headers[i] || '') : '';
    const m = /UTC\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i.exec(h);
    if (m) return `UTC${m[1]}${+m[2]}${m[3] && m[3] !== '00' ? ':' + m[3] : ''}`;
    if (/utc|gmt/i.test(h)) return 'UTC';
    return null;
  }
  const guessVenue = (name) => { const n = String(name || '').toLowerCase(); return VENUES.find(v => v !== 'Other' && n.includes(v.toLowerCase())) || 'Other'; };
  function applyPreset(src, pid) {
    const P = presetById(pid);
    src.presetId = P.id; src.preset = P;
    src.grain = P.grain || 'fill';
    src.map = P.user ? mapFromUser(P, src.hn) : P === CUSTOM ? guessMap(src.hn, src.grain) : resolveMap(P.map, src.hn);
    src.venue = P === CUSTOM ? guessVenue(src.name) : P.venue;
    src.market = P.market || 'spot';
    src.tz = P.user ? P.tz : headerTz(src) || P.tz || 'UTC';
    src.order = 'auto'; src.ex = null; src.adjusted = false;
    src.mapOpen = P === CUSTOM || missingRequired(src).length > 0;
  }
  const fieldsFor = (src) => (src.preset.funding ? FUND_FIELDS : src.grain === 'closed' ? CLOSED_FIELDS : FILL_FIELDS);
  const fieldLabel = (f, src) => (f === 'time' && src && src.grain === 'closed' && !src.preset.funding ? 'Open time' : LABEL[f] || f);
  function required(src) {
    if (src.preset.funding) return [['time'], ['symbol'], ['funding']];
    if (src.grain === 'closed') return [['exitTime', 'time'], ['symbol'], ['side'], ['qty'], ['entryPrice'], ['exitPrice']];
    return [['time'], ['symbol'], ['side'], ['qty', 'total'], ['price', 'total']];
  }
  const missingGroups = (src) => required(src).filter(alts => !alts.some(f => mapped(src, f)));
  const missingRequired = (src) => missingGroups(src).map(alts => alts.map(f => fieldLabel(f, src)).join(' or '));
  // Slash/dot dates: which part is the day? Decided from the values (a part > 12 settles it).
  function dateOrder(src) {
    const i = mapped(src, 'time') ? src.map.time : mapped(src, 'exitTime') ? src.map.exitTime : -1;
    if (src._ordK === i && src._ord) return src._ord;
    let n = 0, d2 = 0, aBig = false, a31 = false, bBig = false, cBig = false, dot = false;
    if (i >= 0) for (const r of src.data.slice(0, 400)) {
      const m = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{2,4})/.exec(cell(r, i)); if (!m) continue;
      n++;
      if (+m[1] > 12) aBig = true; if (+m[1] > 31) a31 = true; if (+m[3] > 12) bBig = true;
      if (m[2] === '-' && m[4].length === 2) { d2++; if (+m[4] > 31) cBig = true; }
      if (m[2] === '.') dot = true;
    }
    let o;
    if (!n) o = { order: null, ambiguous: false, n };
    else if (d2 === n && !cBig) o = { order: 'ymd', ambiguous: !a31, n };   // '21-03-05' (Binance short dates)
    else if (aBig) o = { order: 'dmy', ambiguous: false, n };
    else if (bBig) o = { order: 'mdy', ambiguous: false, n };
    else o = { order: dot ? 'dmy' : 'mdy', ambiguous: true, n };
    src._ordK = i; src._ord = o;
    return o;
  }

  /* ── Reading rows → fills / funding / closed trades ────── */
  const NON_TRADE = /deposit|withdraw|transfer|reward|interest|airdrop|stak|convert|send|receive|income|bonus|distribution|rebate|referral|learn|dust|subscription|redemption/i;
  const sigOf = (src) => JSON.stringify([src.presetId, src.map, src.tz, src.venue, src.market, src.grain, src.order]);
  function extract(src) {
    const sig = sigOf(src);
    if (src.ex && src.ex.sig === sig) return src.ex;
    const P = src.preset, M = src.map, dc = src.delim === ';';
    const order = src.order && src.order !== 'auto' ? src.order : dateOrder(src).order;
    const ex = { sig, fills: [], funds: [], closed: [], skip: {}, errs: [], sample: null, desc: false };
    const g = (r, f) => cell(r, M[f]);
    const n = (r, f) => parseNum(g(r, f), dc);
    const skip = (k) => { ex.skip[k] = (ex.skip[k] || 0) + 1; };
    const bad = (line, msg) => { skip('bad'); if (ex.errs.length < 4) ex.errs.push(`Line ${line}: ${msg}`); };
    const contUnit = mapped(src, 'qty') && /cont/.test(src.hn[M.qty] || '');
    const fundSign = isNum(P.fundSign) ? P.fundSign : -1;
    const hasPnl = mapped(src, 'pnl');
    for (let i = 0; i < src.data.length; i++) {
      const r = src.data[i], line = src.hdr + 2 + i;
      // 1. row type (trade / funding / something else)
      const kind = g(r, 'kind');
      let isFund = !!P.funding;
      // Row-type filter only when the type column is in the file (a saved preset may not have it);
      // a funding file without it reads nothing rather than every row as funding.
      if (P.kinds && (P.funding || mapped(src, 'kind'))) {
        if (P.kinds.funding && P.kinds.funding.test(kind)) isFund = true;
        else if (P.funding || (P.kinds.fill && !P.kinds.fill.test(kind))) { skip('other'); continue; }
      }
      if (mapped(src, 'status') && /cancel|expire|reject|fail|unfilled/i.test(g(r, 'status'))) { skip('cancelled'); continue; }
      // 2. time
      const isClosed = !isFund && src.grain === 'closed';
      const rawT = isClosed ? (g(r, 'exitTime') || g(r, 'time')) : g(r, 'time');
      if (!rawT) { skip('notime'); continue; }
      const t = parseTime(rawT, src.tz, order);
      if (t == null) { bad(line, `couldn’t read the date “${rawT.slice(0, 40)}”`); continue; }
      if (!ex.sample) ex.sample = { raw: rawT, t };
      // 3a. funding payment
      if (isFund) {
        const fv = n(r, 'funding');
        if (!isNum(fv.v) || fv.v === 0) { skip('zero'); continue; }
        const sym = normSym(g(r, 'symbol'), '', false);
        if (!sym.coin) { bad(line, 'no symbol on a funding row'); continue; }
        const asset = assetOf(g(r, 'fundAsset') || g(r, 'feeAsset') || fv.asset || 'USDT');
        if (!isUsd(asset)) { skip('fundcoin'); continue; }
        ex.funds.push({ t, coin: sym.coin, usd: fundSign * fv.v, venue: src.venue, src: src.id, id: g(r, 'id') });
        continue;
      }
      // 3b. one row = one closed trade
      if (isClosed) {
        const sideV = g(r, 'side'), side = posSideOf(sideV, P.sideMode === 'closing');
        if (!side) { if (!sideV) skip('noside'); else bad(line, `unknown side “${sideV.slice(0, 20)}”`); continue; }
        const sym = normSym(g(r, 'symbol'), g(r, 'quote'), !!P.symIsBase);
        if (!sym.coin) { bad(line, 'no coin / symbol'); continue; }
        const qty = Math.abs(n(r, 'qty').v || 0), ep = Math.abs(n(r, 'entryPrice').v || 0), xp = Math.abs(n(r, 'exitPrice').v || 0);
        if (!qty || !ep || !xp) { skip('zero'); continue; }
        const t0 = mapped(src, 'exitTime') && g(r, 'exitTime') ? parseTime(g(r, 'time'), src.tz, order) : null;
        const flags = [];
        if (sym.quote && !isUsd(sym.quote)) flags.push(FIAT_Q.includes(sym.quote) ? 'eur' : 'quote');
        if (contUnit) flags.push('cont');
        const fu = n(r, 'funding').v, pl = n(r, 'pnl').v;
        ex.closed.push({ t: isNum(t0) && t0 <= t ? t0 : t, tx: t, i, coin: sym.coin, quote: sym.quote, market: src.market, shortOk: true, venue: src.venue,
          side, qty, entry: ep, exit: xp, fee: Math.abs(n(r, 'fee').v || 0) + Math.abs(n(r, 'fee2').v || 0),
          funding: isNum(fu) ? fundSign * fu : 0, pnl: hasPnl ? (isNum(pl) ? pl : 0) : null, id: g(r, 'id'), orderId: g(r, 'orderId'), flags, src: src.id });
        continue;
      }
      // 3c. a buy or sell fill
      const sideV = g(r, 'side'), side = sideOf(sideV);
      if (!side) { if (!sideV) skip('noside'); else if (NON_TRADE.test(sideV)) skip('other'); else bad(line, `unknown side “${sideV.slice(0, 20)}” (expected Buy or Sell)`); continue; }
      const q = n(r, 'qty'), p = n(r, 'price'), tot = n(r, 'total');
      const qh = g(r, 'quote') || (tot.asset && tot.asset !== q.asset ? tot.asset : '') || p.asset;
      const sym = normSym(g(r, 'symbol'), qh, !!P.symIsBase);
      if (!sym.coin) { bad(line, 'no coin / symbol'); continue; }
      const quote = sym.quote, flags = [];
      let qty = isNum(q.v) ? Math.abs(q.v) : null, price = isNum(p.v) ? Math.abs(p.v) : null;
      const total = isNum(tot.v) ? Math.abs(tot.v) : null;
      const unitRaw = g(r, 'unit').toUpperCase(), unit = ALIAS[unitRaw] || unitRaw;
      if (/^CONT/.test(unit) || contUnit) flags.push('cont');
      else if (unit && quote && unit === quote && qty && price) qty = qty / price;   // size given in $ (quote), not coins
      if (!price && qty && total) price = total / qty;
      if (!qty && price && total) qty = total / price;
      if (!qty || !price) { skip('zero'); continue; }
      if (quote && !isUsd(quote)) flags.push(FIAT_Q.includes(quote) ? 'eur' : 'quote');
      // Fees → $ (quote currency). A fee in the base coin converts at the fill price; BNB / other coins → $0 + flag.
      const fv = n(r, 'fee'), f2 = n(r, 'fee2');
      const feeAmt = Math.abs(fv.v || 0) + Math.abs(f2.v || 0);
      const fa = assetOf(g(r, 'feeAsset') || fv.asset || '');
      let fee = 0, feeNote = '';
      if (feeAmt) {
        if (!fa || fa === quote || (isUsd(fa) && isUsd(quote))) fee = feeAmt;
        else if (fa === sym.coin) fee = feeAmt * price;
        else if (isUsd(fa)) fee = feeAmt;
        else { flags.push('fee'); feeNote = `${fmtQty(feeAmt)} ${fa}`; }
      }
      let market = src.market, shortOk = false;
      const mc = g(r, 'marketCol');
      if (mc) {
        if (/swap|perp|futur|contract|deriv/i.test(mc)) market = 'perp';
        else if (/margin/i.test(mc)) { market = 'spot'; shortOk = true; }
        else if (/spot/i.test(mc)) market = 'spot';
      }
      if (n(r, 'margin').v) shortOk = true;   // Kraken margin trades can be short
      // Coin-margined perps (BTCUSD, BTC-USD-SWAP, BTCUSD_PERP) charge fees in the coin and size in contracts
      if (market === 'perp' && quote === 'USD' && fa && fa === sym.coin && !flags.includes('cont')) flags.push('inverse');
      const pl = n(r, 'pnl').v;
      ex.fills.push({ t, i, coin: sym.coin, quote, market, shortOk: shortOk || market === 'perp', venue: src.venue, side, qty, price, fee, feeNote,
        pnl: hasPnl ? (isNum(pl) ? pl : 0) : null, id: g(r, 'id'), orderId: g(r, 'orderId'), flags, src: src.id });
      const fu = mapped(src, 'funding') ? n(r, 'funding').v : null;
      if (isNum(fu) && fu !== 0) ex.funds.push({ t, coin: sym.coin, usd: fundSign * fu, venue: src.venue, src: src.id, id: '' });
    }
    // Binance & co. list newest first — remember it so same-second fills keep their real order
    if (ex.fills.length > 1 && ex.fills[0].t > ex.fills[ex.fills.length - 1].t) ex.desc = true;
    src.ex = ex;
    return ex;
  }
  const rowsRead = (ex) => ex.fills.length + ex.closed.length + ex.funds.length;

  /* ── Round trips: signed position + weighted-average entry ── */
  // A trade holds entry lots (scale-ins) and exits (scale-outs). Each exit is split pro-rata over the open
  // lots, which keeps the average entry unchanged — so the realised P/L equals the exchange's avg-cost P/L.
  const EPS = (q) => q * 1e-9 + 1e-12;
  // Pro-rata exits keep every lot open until the position is flat, so the only lots that can be
  // open sit from index o0 onwards (o0 moves past lots that compress() has closed) — keeps big files linear.
  const openQty = (t) => { let s = 0; for (let i = t.o0; i < t.lots.length; i++) s += t.lots[i].rem; return s; };
  function blank(f, side) {
    return { key: lid('t'), venue: f.venue, market: f.market, coin: f.coin, quote: f.quote, side, lots: [], o0: 0, exits: [], pieces: [],
      flags: new Set(), feeNotes: [], filePnl: null, pnlCol: false, peak: 0, nFills: 0, closed: false, first: f,
      srcs: new Set(), funding: 0, fundN: 0, basisPrice: null, _s: null };
  }
  function touch(t, f) {
    t.nFills += f.n || 1; t.srcs.add(f.src);
    for (const x of f.flags || []) t.flags.add(x);
    if (f.feeNote) t.feeNotes.push(f.feeNote);
    if (f.pnl != null) t.pnlCol = true;
  }
  function addLot(t, f, qty, fee) {
    if (t.lots.length - t.o0 > MAX_OPEN_LOTS * 4) compress(t);   // thousands of DCA buys, no sells yet
    t.lots.push({ t: f.t, price: f.price, qty, rem: qty, fee });
    t.peak = Math.max(t.peak, openQty(t));
    touch(t, f);
  }
  // Many small buys (DCA / grid bots): merge the open remainders into one lot at their average price
  function compress(t) {
    const open = t.lots.slice(t.o0).filter(l => l.rem > 0);
    if (open.length <= MAX_OPEN_LOTS) return;
    let q = 0, c = 0, fee = 0, t0 = Infinity;
    for (const l of open) {
      const share = l.qty ? l.fee * l.rem / l.qty : 0;
      q += l.rem; c += l.price * l.rem; fee += share; t0 = Math.min(t0, l.t);
      l.fee -= share; l.qty -= l.rem; l.rem = 0;   // the lot keeps only its already-closed part (fee per unit unchanged)
    }
    t.lots = t.lots.filter(l => l.qty > 0);
    t.lots.push({ t: t0, price: c / q, qty: q, rem: q, fee });
    t.o0 = t.lots.length - 1;
  }
  function reduceBy(t, f, qty, fee) {
    if (t.lots.length - t.o0 > MAX_OPEN_LOTS) compress(t);
    const ex = { t: f.t, price: f.price, qty, fee };
    t.exits.push(ex);
    const open = openQty(t);
    for (let i = t.o0; i < t.lots.length; i++) {
      const l = t.lots[i];
      if (!(l.rem > 0)) continue;
      const a = qty * l.rem / open;
      l.rem = Math.max(0, l.rem - a);
      t.pieces.push({ lot: l, exit: ex, qty: a });
    }
    touch(t, f);
  }
  // Spot sell of coins this file never bought: entry unknown until the user types it
  function orphan(f, qty, fee) {
    const t = blank(f, 'long'), lot = { t: f.t, price: null, qty, rem: 0, fee: 0 }, ex = { t: f.t, price: f.price, qty, fee };
    t.lots.push(lot); t.exits.push(ex); t.pieces.push({ lot, exit: ex, qty });
    t.peak = qty; t.closed = true; t.flags.add('basis'); touch(t, f);
    return t;
  }
  // Futures fill that closes a position opened before the file: entry = exit − realised P/L ÷ qty
  function preClose(b, f, trades) {
    const side = f.side === 'sell' ? 'long' : 'short', d = side === 'long' ? 1 : -1;
    let t = b.pre && b.pre.side === side ? b.pre : null;
    if (!t) { t = blank(f, side); t.flags.add('preclose'); t.closed = true; trades.push(t); b.pre = t; }
    const entry = f.price - (f.pnl / f.qty) * d;
    const lot = { t: f.t, price: entry > 0 ? entry : null, qty: f.qty, rem: 0, fee: 0 }, ex = { t: f.t, price: f.price, qty: f.qty, fee: f.fee };
    t.lots.push(lot); t.exits.push(ex); t.pieces.push({ lot, exit: ex, qty: f.qty });
    t.filePnl = (t.filePnl || 0) + f.pnl; t.peak += f.qty;
    if (!(entry > 0)) t.flags.add('basis');
    touch(t, f);
  }
  function reconstruct(fills) {
    const books = new Map(), trades = [];
    for (const f of fills) {
      // spot USDT/USDC/USD pairs share one book (all dollars); an ETH/BTC or EUR pair never reduces an ETH/USDT position
      const bk = [f.venue, f.market, f.coin, f.market === 'perp' || !isUsd(f.quote) ? f.quote : ''].join('|');
      let b = books.get(bk);
      if (!b) { b = { cur: null, pre: null, dust: 0 }; books.set(bk, b); }
      const dir = f.side === 'buy' ? 1 : -1, perUnit = f.qty > 0 ? f.fee / f.qty : 0;
      if (!b.cur) {
        if (dir < 0 && !f.shortOk) {
          b.pre = null;
          // selling leftover dust (or a few cents of something) is not a trade
          if ((b.dust > 0 && f.qty <= b.dust * 1.05 + 1e-12) || f.qty * f.price < 0.5) { b.dust = Math.max(0, b.dust - f.qty); continue; }
          trades.push(orphan(f, f.qty, f.fee)); continue;
        }
        if (f.shortOk && isNum(f.pnl) && Math.abs(f.pnl) > 1e-9) { preClose(b, f, trades); continue; }
        b.pre = null;
        b.cur = blank(f, dir > 0 ? 'long' : 'short'); addLot(b.cur, f, f.qty, f.fee); trades.push(b.cur);
        continue;
      }
      b.pre = null;
      const t = b.cur, sgn = t.side === 'long' ? 1 : -1;
      if (dir === sgn) { addLot(t, f, f.qty, f.fee); continue; }            // scale in
      const open = openQty(t), red = Math.min(f.qty, open);
      reduceBy(t, f, red, perUnit * red);                                     // scale out / close
      if (isNum(f.pnl)) t.filePnl = (t.filePnl || 0) + f.pnl;
      const left = open - red;
      const dust = !f.shortOk && left > EPS(t.peak) && (left * f.price < 1 || left <= t.peak * 0.0015);
      if (left <= EPS(t.peak) || dust) {
        if (dust) { t.flags.add('dust'); b.dust = left; for (const l of t.lots) l.rem = 0; }
        t.closed = true; b.cur = null;
      }
      const extra = f.qty - red;
      if (extra > EPS(f.qty)) {
        const rest = { ...f, pnl: f.pnl == null ? null : 0, feeNote: '' };
        if (f.shortOk) { b.cur = blank(rest, dir > 0 ? 'long' : 'short'); addLot(b.cur, rest, extra, perUnit * extra); trades.push(b.cur); }   // flip
        else if ((b.dust > 0 && extra <= b.dust * 1.05 + 1e-12) || extra * f.price < 0.5) b.dust = 0;
        else trades.push(orphan(rest, extra, perUnit * extra));
      }
    }
    return trades;
  }
  function closedTrade(c) {
    const t = blank(c, c.side);
    const lot = { t: c.t, price: c.entry, qty: c.qty, rem: 0, fee: c.fee / 2 }, ex = { t: c.tx, price: c.exit, qty: c.qty, fee: c.fee / 2 };
    t.lots.push(lot); t.exits.push(ex); t.pieces.push({ lot, exit: ex, qty: c.qty });
    t.peak = c.qty; t.closed = true;
    if (c.funding) { t.funding = c.funding; t.fundN = 1; }
    if (c.pnl != null) t.filePnl = c.pnl;
    touch(t, c);
    return t;
  }
  // Funding goes to the futures position on that coin that was open at the settlement time
  function attachFunding(trades, funds) {
    const out = { n: funds.length, matched: 0, matchedUsd: 0, left: 0, leftUsd: 0 };
    if (!funds.length) return out;
    const idx = new Map();
    for (const t of trades) {
      // loops, not Math.min(...spread): a DCA file can hold more lots than a call accepts arguments
      const t0 = t.flags.has('preclose') ? -Infinity : t.lots.reduce((m, l) => Math.min(m, l.t), Infinity);
      const t1 = t.closed ? t.exits.reduce((m, e) => Math.max(m, e.t), -Infinity) : Infinity;
      const k = t.venue + '|' + t.coin;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push({ t, t0, t1 });
    }
    for (const u of funds) {
      const list = idx.get(u.venue + '|' + u.coin) || [];
      const hit = list.find(x => (x.t.market === 'perp' || x.t.srcs.has(u.src)) && x.t0 <= u.t && u.t <= x.t1);
      if (hit) { hit.t.funding += u.usd; hit.t.fundN++; hit.t._s = null; out.matched++; out.matchedUsd += u.usd; }
      else { out.left++; out.leftUsd += u.usd; }
    }
    return out;
  }
  const lotPrice = (t, l) => (isNum(l.price) ? l.price : isNum(t.basisPrice) && t.basisPrice > 0 ? t.basisPrice : null);
  // Journal rows for one trade: (entry lot × exit) pieces, an open remainder at the average entry
  function legsOf(t) {
    const tiny = t.peak * 1e-12, legs = [];
    const pcs = t.pieces.filter(p => p.qty > tiny);
    const feeOf = (p) => (p.lot.qty ? p.lot.fee * p.qty / p.lot.qty : 0) + (p.exit.qty ? p.exit.fee * p.qty / p.exit.qty : 0);
    if (pcs.length <= MAX_LEGS) {
      for (const p of pcs) legs.push({ entryMs: p.lot.t, entryPrice: lotPrice(t, p.lot), amount: p.qty, exitMs: p.exit.t, exitPrice: p.exit.price, fees: feeOf(p) });
    } else {
      // collapse to one closed leg per entry lot (volume-weighted exit) — or one leg when there are many lots
      const per = new Map();
      for (const p of pcs) {
        let x = per.get(p.lot);
        if (!x) { x = { entryMs: p.lot.t, entryPrice: lotPrice(t, p.lot), amount: 0, px: 0, exitMs: 0, fees: 0 }; per.set(p.lot, x); }
        x.amount += p.qty; x.px += p.exit.price * p.qty; x.exitMs = Math.max(x.exitMs, p.exit.t); x.fees += feeOf(p);
      }
      let rows = [...per.values()];
      if (rows.length > MAX_LEGS) {
        const all = { entryMs: Infinity, ep: 0, known: true, amount: 0, px: 0, exitMs: 0, fees: 0 };
        for (const x of rows) {
          all.entryMs = Math.min(all.entryMs, x.entryMs);
          if (x.entryPrice == null) all.known = false; else all.ep += x.entryPrice * x.amount;
          all.amount += x.amount; all.px += x.px; all.exitMs = Math.max(all.exitMs, x.exitMs); all.fees += x.fees;
        }
        rows = [{ entryMs: all.entryMs, entryPrice: all.known ? all.ep / all.amount : null, amount: all.amount, px: all.px, exitMs: all.exitMs, fees: all.fees }];
      }
      for (const x of rows) legs.push({ entryMs: x.entryMs, entryPrice: x.entryPrice, amount: x.amount, exitMs: x.exitMs, exitPrice: x.px / x.amount, fees: x.fees });
    }
    if (!t.closed) {
      let rem = 0, cost = 0, fees = 0, t0 = Infinity;
      for (const l of t.lots) if (l.rem > tiny) { rem += l.rem; cost += l.price * l.rem; fees += l.qty ? l.fee * l.rem / l.qty : 0; t0 = Math.min(t0, l.t); }
      if (rem > 0) legs.push({ entryMs: t0, entryPrice: cost / rem, amount: rem, exitMs: null, exitPrice: null, fees });
    }
    // parent row first: earliest entry, closed before open, then by exit time
    legs.sort((a, b) => a.entryMs - b.entryMs || (a.exitMs == null) - (b.exitMs == null) || (a.exitMs || 0) - (b.exitMs || 0));
    return legs;
  }
  function summ(t) {
    if (t._s) return t._s;
    const legs = legsOf(t), d = t.side === 'short' ? -1 : 1;
    let gross = 0, known = true, fees = 0, feesC = 0, qOut = 0, pxOut = 0, last = 0;
    for (const l of legs) {
      fees += l.fees;
      if (l.exitPrice == null) continue;
      feesC += l.fees; qOut += l.amount; pxOut += l.exitPrice * l.amount; last = Math.max(last, l.exitMs);
      if (l.entryPrice == null) known = false; else gross += (l.exitPrice - l.entryPrice) * l.amount * d;
    }
    let qIn = 0, cost = 0, costKnown = true;
    for (const l of t.lots) { qIn += l.qty; const p = lotPrice(t, l); if (p == null) costKnown = false; else cost += p * l.qty; }
    const fundOn = legs.length > 0 && legs[0].exitPrice != null;   // funding sits on the parent row; Engine counts it once that row closes
    const net = qOut && known ? gross - feesC - (fundOn ? t.funding : 0) : null;
    t._s = {
      legs, gross: qOut && known ? gross : null, fees, feesC, net, fundOn, qty: qIn,
      avgEntry: costKnown && qIn ? cost / qIn : null, avgExit: qOut ? pxOut / qOut : null,
      entryMs: legs.length ? legs[0].entryMs : t.lots[0].t, exitMs: t.closed ? last : null,
    };
    return t._s;
  }

  /* ── Dedupe, status and reconciliation ─────────────────── */
  function extIdOf(t) {
    const f = t.first;
    const core = f.id ? 'i' + f.id : f.orderId ? 'o' + f.orderId
      : 'h' + hash([f.t, f.coin, f.side, roundP(f.qty), roundP(isNum(f.price) ? f.price : f.entry)].join('|'));
    return `${slug(t.venue)}:${t.market}:${t.coin}:${core}`.slice(0, 140);
  }
  function setStatus(t) {
    const fl = [...t.flags];
    t.hard = fl.some(k => FLAG[k] && FLAG[k].hard);
    t.status = t.hard ? 'blocked' : t.dup ? 'dup' : t.maybe ? 'maybe' : fl.some(k => FLAG[k] && FLAG[k].block) ? 'flag' : 'new';
  }
  const canPick = (t) => !t.hard && !(t.flags.has('basis') && !(isNum(t.basisPrice) && t.basisPrice > 0));
  function classify(trades, target) {
    const mine = (db.accounts[target] ? liveEntries(target) : []).filter(e => e && e.type === 'trade');
    const byExt = new Map();
    for (const e of mine) if (e.extId) byExt.set(String(e.extId), e);
    // trades logged by hand: same coin + side, entry within 15 min and 0.4% → possible duplicate
    const hand = [];
    for (const e of mine) {
      if (e.importBatchId) continue;
      const ms = Date.parse(e.entryAt);
      if (isFinite(ms) && isNum(e.entryPrice) && e.entryPrice > 0) hand.push({ ms, coin: String(e.coin || '').toUpperCase(), side: e.side === 'short' ? 'short' : 'long', px: e.entryPrice });
    }
    const used = new Set();
    for (const t of trades) {
      let id = extIdOf(t);
      if (used.has(id)) { let k = 2; while (used.has(id + '~' + k)) k++; id += '~' + k; }
      used.add(id); t.extId = id;
      const hit = byExt.get(id);
      t.dup = hit ? (!isNum(hit.exitPrice) && t.closed ? 'open' : 'same') : null;
      const s = summ(t);
      t.maybe = !t.dup && isNum(s.avgEntry) && hand.some(h => h.coin === t.coin && h.side === t.side && Math.abs(h.ms - s.entryMs) <= 15 * 60000 && Math.abs(h.px / s.avgEntry - 1) <= 0.004);
      setStatus(t);
    }
  }
  // File's own realised P/L vs the P/L rebuilt from fills (before fees / after fees / after funding)
  function recon(trades) {
    let has = false, nonzero = false, realised = false, file = 0, gross = 0, feesC = 0, fund = 0;
    for (const t of trades) {
      if (!t.pnlCol) continue;
      has = true; file += t.filePnl || 0; if (t.filePnl) nonzero = true;
      const s = summ(t);
      if (s.avgExit != null) realised = true;
      if (s.gross != null) gross += s.gross;
      feesC += s.feesC;
      if (s.fundOn) fund += t.funding;
    }
    // only open positions: $0 vs $0 would read as a "match" without proving anything
    if (has && !realised && !nonzero) return { has: false, open: true };
    if (!has || (!nonzero && Math.abs(gross) > 0.01)) return { has: false, empty: has };
    // Exchanges differ in what "realised P/L" includes — compare with the closest basis (fees are often
    // small, so taking the first one within tolerance could call "after fees" a match when funding is missing)
    const tol = Math.max(0.05, Math.abs(file) * 0.001);
    const opts = [['before fees', gross], ['after fees', gross - feesC], ['after fees and funding', gross - feesC - fund]];
    const best = opts.reduce((a, o) => (Math.abs(o[1] - file) < Math.abs(a[1] - file) ? o : a));
    const m = Math.abs(best[1] - file) <= tol;
    return { has: true, file, gross, basis: best[0], value: best[1], match: m ? best[0] : null, diff: file - best[1] };
  }
  function analyze(sources, target) {
    const fills = [], funds = [], closedRows = [], seen = new Map();
    let dupFills = 0;
    // Overlapping exports repeat rows: same exchange id, or (across files) the same time/qty/price
    const take = (k, byId, srcId) => {
      const prev = seen.get(k);
      if (prev != null && (byId || prev !== srcId)) return false;
      seen.set(k, srcId); return true;
    };
    sources.forEach((src, si) => {
      const ex = extract(src);
      for (const f of ex.fills) {
        const k = 'f|' + f.venue + '|' + f.coin + '|' + (f.id ? 'i' + f.id : 'h' + hash([f.t, f.side, f.qty, f.price].join('|')));
        if (!take(k, !!f.id, src.id)) { dupFills++; continue; }
        fills.push({ ...f, si, ord: ex.desc ? -f.i : f.i });
      }
      for (const u of ex.funds) {
        const k = 'u|' + u.venue + '|' + u.coin + '|' + (u.id ? 'i' + u.id : 'h' + hash([u.t, u.usd].join('|')));
        if (take(k, !!u.id, src.id)) funds.push(u);
      }
      for (const c of ex.closed) {
        const k = 'c|' + c.venue + '|' + c.coin + '|' + (c.id ? 'i' + c.id : 'h' + hash([c.t, c.tx, c.qty, c.entry, c.exit].join('|')));
        if (!take(k, !!c.id, src.id)) { dupFills++; continue; }
        closedRows.push(c);
      }
    });
    fills.sort((a, b) => a.t - b.t || a.si - b.si || a.ord - b.ord);
    // Group fills of one order (or, without an order id, back-to-back same-second fills on the same side)
    const merged = [], byOrder = new Map(), lastByBook = new Map();
    for (const f of fills) {
      const bk = f.venue + '|' + f.market + '|' + f.coin + '|' + (f.quote || '');
      let m = null;
      if (f.orderId) m = byOrder.get(bk + '|' + f.side + '|' + f.orderId) || null;
      else { const l = lastByBook.get(bk); if (l && !l.orderId && l.side === f.side && Math.floor(l.t / 1000) === Math.floor(f.t / 1000)) m = l; }
      if (m) {
        const q = m.qty + f.qty;
        m.price = (m.price * m.qty + f.price * f.qty) / q; m.qty = q; m.fee += f.fee; m.n++;
        if (f.feeNote) m.feeNote = m.feeNote ? m.feeNote + ', ' + f.feeNote : f.feeNote;
        if (f.pnl != null) m.pnl = (m.pnl || 0) + f.pnl;
        for (const x of f.flags) if (!m.flags.includes(x)) m.flags.push(x);
        if (f.shortOk) m.shortOk = true;
      } else {
        m = { ...f, flags: [...f.flags], n: 1 };
        merged.push(m);
        if (f.orderId) byOrder.set(bk + '|' + f.side + '|' + f.orderId, m);
      }
      lastByBook.set(bk, m);
    }
    const trades = reconstruct(merged);
    for (const c of closedRows) trades.push(closedTrade(c));
    funds.sort((a, b) => a.t - b.t);
    const fstat = attachFunding(trades, funds);
    classify(trades, target);   // before sorting: extId suffixes stay stable between imports
    trades.sort((a, b) => summ(b).entryMs - summ(a).entryMs);
    return {
      trades, nRows: fills.length + closedRows.length, nOrders: merged.length + closedRows.length, dupFills, funds: fstat, recon: recon(trades),
      perp: trades.some(t => t.market === 'perp'), fundingCol: sources.some(s => s.preset.funding || mapped(s, 'funding')), target,
    };
  }

  /* ── Wizard state (module-level so router re-renders never lose progress) ── */
  const fresh = (target) => ({
    step: 1, target: MODES.includes(target) ? target : 'live', sources: [], errs: [], paste: '', pasteOpen: false,
    res: null, sel: new Set(), basisTxt: {}, filter: 'all', limit: PAGE_ROWS, done: null, busy: false,
  });
  let st = fresh();
  let root = null;

  /* ── Files in ──────────────────────────────────────────── */
  // Excel "CSV UTF-8" adds a BOM, "Unicode text" is UTF-16, older Windows exports are cp1252; .xlsx is a zip ('PK')
  function decode(buf) {
    const b = new Uint8Array(buf);
    if (b.length >= 2 && ((b[0] === 0x50 && b[1] === 0x4B) || (b[0] === 0xD0 && b[1] === 0xCF))) return null;
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
    let t;
    try { t = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { t = new TextDecoder('windows-1252').decode(b); }
    return /\u0000/.test(t.slice(0, 4000)) ? null : t;
  }
  function makeSource(name, size, text) {
    const p = parseCSV(text);
    if (p.rows.length < 2) return { err: `${name}: no data rows found — is this the right file?` };
    const hdr = findHeader(p.rows);
    const headers = p.rows[hdr].map(h => String(h == null ? '' : h).trim());
    const data = p.rows.slice(hdr + 1);
    if (!data.length) return { err: `${name}: only a header row, no trades.` };
    const src = { id: lid('s'), name: String(name).slice(0, 120), size, delim: p.delim, hdr, headers, hn: headers.map(normH), data,
      order: 'auto', mapOpen: false, rawOpen: false, ex: null, map: {} };
    applyPreset(src, detect(src));
    return { src };
  }
  function addSource(name, size, text) {
    if (st.sources.length >= MAX_SOURCES) { st.errs.push(`Up to ${MAX_SOURCES} files at a time — import these first, then the rest.`); return false; }
    const r = makeSource(name, size, text);
    if (r.err) { st.errs.push(r.err); return false; }
    st.sources.push(r.src);
    return true;
  }
  async function addFiles(list) {
    const files = [...(list || [])];
    if (!files.length) return;
    if (st.step === 4) st = fresh(st.target);
    st.errs = [];
    for (const f of files) {
      const name = String(f.name || 'file');
      if (/\.(xlsx|xlsm|xls|numbers|ods)$/i.test(name)) { st.errs.push(`${name} is a spreadsheet, not a CSV. Open it in Excel → File → Save As → “CSV UTF-8 (comma delimited)”, then drop the .csv here.`); continue; }
      if (/\.(zip|gz|7z|rar)$/i.test(name)) { st.errs.push(`${name} is a compressed archive. Unzip it first and drop the .csv inside (Kraken: trades.csv).`); continue; }
      if (f.size > MAX_BYTES) { st.errs.push(`${name} is larger than 15 MB — export a shorter date range.`); continue; }
      let text = null;
      try { text = decode(await f.arrayBuffer()); }
      catch (e) { st.errs.push(`${name} couldn’t be read (${(e && e.message) || e}).`); continue; }
      if (text == null) { st.errs.push(`${name} looks like an Excel or binary file. Save it as CSV first (File → Save As → CSV UTF-8).`); continue; }
      addSource(name, f.size, text);
    }
    st.res = null;
    if (st.sources.length) st.step = st.errs.length ? 1 : 2;
    draw(); scrollTop();
  }
  function usePaste() {
    const text = String(st.paste || '');
    if (!text.trim()) { toast('Paste the CSV text first', 'warn'); return; }
    st.errs = [];
    const n = st.sources.filter(s => /^Pasted text/.test(s.name)).length;
    if (addSource(n ? `Pasted text ${n + 1}` : 'Pasted text', text.length, text)) { st.paste = ''; st.pasteOpen = false; st.res = null; st.step = 2; }
    draw(); scrollTop();
  }
  function runAnalyze() {
    const bad = st.sources.find(s => missingRequired(s).length);
    if (bad) { toast(`Pick the missing columns for ${bad.name}`, 'warn'); return; }
    try { st.res = analyze(st.sources, st.target); }
    catch (e) { console.error('[import] analyze', e); toast('Could not build trades from this file: ' + ((e && e.message) || e), 'err'); return; }
    st.sel = new Set(st.res.trades.filter(t => t.status === 'new' && canPick(t)).map(t => t.key));
    st.basisTxt = {}; st.filter = 'all'; st.limit = PAGE_ROWS; st.step = 3;
    draw(); scrollTop();
  }

  /* ── Commit, undo, history ─────────────────────────────── */
  function noteFor(t) {
    const p = [];
    if (t.flags.has('fee')) p.push(`Fee paid in another coin${t.feeNotes.length ? ` (${t.feeNotes.slice(0, 4).join(', ')})` : ''} — imported as $0; add the $ value.`);
    if (t.flags.has('preclose')) p.push('Opened before the imported file: entry price worked out from the exchange’s realised P/L; entry time unknown.');
    if (t.flags.has('basis')) p.push('The buy was not in the imported file — entry price typed in during import.');
    if (t.flags.has('eur')) p.push(`Priced in ${t.quote} — imported 1:1 as dollars.`);
    if (t.flags.has('dust')) p.push('A tiny leftover amount was ignored.');
    return p.join(' ');
  }
  function writeTrade(t, mode, batchId, srcName) {
    const s = summ(t), venue = VENUES.includes(t.venue) ? t.venue : 'Other', note = noteFor(t);
    let parent = null;
    s.legs.forEach((l, i) => {
      const f = {
        type: i ? 'scale' : 'trade', entryAt: nowLocalInput(l.entryMs), coin: t.coin, side: t.side,
        entryPrice: roundP(l.entryPrice), amount: roundP(l.amount), stopPrice: null, targetPrice: null,
        exitPrice: l.exitPrice != null ? roundP(l.exitPrice) : null, fees: roundUsd(l.fees), market: t.market, venue,
        importBatchId: batchId, extId: i ? `${t.extId}#${i + 1}` : t.extId, importSrc: srcName,
        needsReview: true, mistakes: [], tags: [],
      };
      if (l.exitMs != null) f.exitAt = nowLocalInput(l.exitMs);
      if (i) f.parentId = parent.id;
      else { if (t.funding) f.funding = roundUsd(t.funding); if (note) f.notes = note; }
      const e = addEntry(f, mode);
      if (!i) parent = e;
    });
    return s.legs.length;
  }
  async function doImport() {
    if (st.busy || !st.res) return;
    // The saved journal could not be read: save() refuses, and a snapshot now would only copy the empty stand-in
    if (typeof StorageGuard !== 'undefined' && StorageGuard && StorageGuard.loadError) { toast('Not imported — resolve the storage warning at the top of the page first', 'err'); return; }
    const res = st.res, mode = st.target;
    const picks = res.trades.filter(t => st.sel.has(t.key) && canPick(t));
    if (!picks.length) { toast('Tick at least one trade to import', 'warn'); return; }
    // The preview may be older than the journal (another import or an Undo since): re-check the IDs now
    const have = new Set(liveEntries(mode).filter(e => e && e.type === 'trade' && e.extId).map(e => String(e.extId)));
    const risky = picks.filter(t => t.dup || t.maybe || have.has(t.extId)).length;
    if (risky) {
      const ok = await confirmDialog({
        title: `Import ${plural(risky, 'possible duplicate')}?`, confirmText: 'Import anyway',
        html: `You ticked <b>${plural(risky, 'trade')}</b> that ${risky === 1 ? 'looks' : 'look'} like ${risky === 1 ? 'it is' : 'they are'} already in your ${esc(MODE_LABEL[mode])} journal. Importing them again counts the same P/L twice.`,
      });
      if (!ok) return;
    }
    st.busy = true; draw();
    // Safety net first: a restorable copy of the whole journal (Settings → Data & backups). The text is
    // taken now, so even a slow database (we stop waiting after 8 s) stores the journal as it was before.
    try {
      if (typeof Store !== 'undefined' && Store && typeof Store.snapshot === 'function') {
        const snap = Promise.resolve(Store.snapshot('Before CSV import', JSON.stringify(db))).catch(e => console.warn('[import] snapshot skipped', e));
        await Promise.race([snap, new Promise(r => setTimeout(r, 8000))]);
      }
    } catch (e) { console.warn('[import] snapshot skipped', e); }
    const batchId = 'imp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const srcName = [...new Set(st.sources.map(s => s.preset.name))].join(' + ').slice(0, 120);
    const a = acct(mode), before = a.entries.length;
    let legs = 0;
    try {
      picks.sort((x, y) => summ(x).entryMs - summ(y).entryMs);   // chronological → seq order matches time order
      for (const t of picks) legs += writeTrade(t, mode, batchId, srcName);
    } catch (e) {
      a.entries.splice(before);   // nothing half-imported
      st.busy = false; console.error('[import] write', e); toast('Import failed — nothing was changed: ' + ((e && e.message) || e), 'err'); draw();
      return;
    }
    if (!save()) { a.entries.splice(before); st.busy = false; draw(); return; }   // save() already told the user why
    st.busy = false;
    st.done = { batchId, mode, n: picks.length, legs, flagged: picks.filter(t => t.flags.size).length, open: picks.filter(t => !t.closed).length, undone: false,
      first: summ(picks[0]).entryMs };   // picks are sorted by entry time
    st.step = 4;
    refresh();   // = commit(): recompute + re-render (this page shows the Done step)
    // the Import button is gone — move keyboard focus to the next step instead of losing it to <body>
    const nb = Router.active === 'import' && root ? root.querySelector('[data-act="review"]') : null;
    if (nb) { try { nb.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    toast(`Imported ${plural(picks.length, 'trade')} into ${MODE_LABEL[mode]}`, 'ok', { ms: 10000, action: { label: 'Undo', run: () => removeBatch(batchId, mode, false) } });
    scrollTop();
  }
  // Same rule as the Trades page's review queue: closed and no mistakes picked yet (Metrics.isReviewed).
  // needsReview itself is not cleared by every review path, so it can't be the count.
  const isRev = (e) => (typeof Metrics !== 'undefined' && Metrics && typeof Metrics.isReviewed === 'function'
    ? Metrics.isReviewed(e) : Array.isArray(e.mistakes) && e.mistakes.length > 0);
  // Parent ids of trades with any portion still open (open trades join the queue once closed)
  const openParents = (entries) => {
    const s = new Set();
    for (const e of entries) if (e && !e.deletedAt && (e.type === 'trade' || e.type === 'scale') && !isNum(e.exitPrice)) s.add(e.type === 'trade' ? e.id : e.parentId);
    return s;
  };
  const batchIds = (batchId, mode) => {
    const a = db.accounts[mode];
    return a ? a.entries.filter(e => e.importBatchId === batchId && e.type === 'trade' && !e.deletedAt).map(e => e.id) : [];
  };
  // softDelete() only sees the active account, so a batch in another account is trashed here directly
  async function removeBatch(batchId, mode, ask) {
    const a = db.accounts[mode];
    if (!a) return;
    const ids = new Set(a.entries.filter(e => e.importBatchId === batchId && !e.deletedAt).map(e => e.id));
    for (const e of a.entries) if (!e.deletedAt && ids.has(e.parentId)) ids.add(e.id);   // legs added by hand later
    if (!ids.size) { toast('That import was already removed', 'warn'); return; }
    const nT = a.entries.filter(e => ids.has(e.id) && e.type === 'trade').length;
    if (ask) {
      const ok = await confirmDialog({
        title: 'Remove this import?', confirmText: 'Remove import', danger: true,
        html: `<b>${plural(nT, 'trade')}</b> (${plural(ids.size, 'row')}) move from your <b>${esc(MODE_LABEL[mode] || mode)}</b> account to Trash — including any stops, notes or reviews you added to them. You can undo right after, or restore them from Settings → Trash for 30 days.`,
      });
      if (!ok) return;
    }
    const now = new Date().toISOString(), hit = [];
    for (const e of a.entries) if (ids.has(e.id) && !e.deletedAt) { e.deletedAt = now; hit.push(e.id); }
    if (st.done && st.done.batchId === batchId) st.done.undone = true;
    commit();
    toast(`Removed ${plural(nT, 'imported trade')}`, 'ok', {
      ms: 9000, action: { label: 'Undo', run: () => { if (st.done && st.done.batchId === batchId) st.done.undone = false; restoreEntries(hit); } },
    });
  }
  function batches() {
    const map = new Map();
    for (const m of MODES) {
      const a = db.accounts && db.accounts[m];
      if (!a || !Array.isArray(a.entries)) continue;
      let open = null;
      for (const e of a.entries) {
        if (!e || !e.importBatchId || e.deletedAt) continue;
        if (!open) open = openParents(a.entries);
        const k = m + '|' + e.importBatchId;
        let b = map.get(k);
        if (!b) { b = { id: String(e.importBatchId), mode: m, at: String(e.createdAt || ''), venues: new Set(), srcs: new Set(), trades: 0, rows: 0, review: 0, open: 0 }; map.set(k, b); }
        b.rows++;
        if (e.createdAt && (!b.at || String(e.createdAt) < b.at)) b.at = String(e.createdAt);
        if (e.venue) b.venues.add(String(e.venue));
        if (e.importSrc) b.srcs.add(String(e.importSrc));
        if (e.type === 'trade') { b.trades++; if (open.has(e.id)) b.open++; else if (!isRev(e)) b.review++; }
      }
    }
    return [...map.values()].sort((x, y) => y.at.localeCompare(x.at));
  }
  // Make `mode` the active account (App asks before switching to Live). Resolves false if the user stays.
  async function toMode(mode) {
    if (!MODES.includes(mode)) return false;
    if (mode === db.mode) return true;
    if (typeof App === 'undefined' || !App || typeof App.switchMode !== 'function') { toast(`Switch to the ${MODE_LABEL[mode]} account first`, 'warn'); return false; }
    try { await App.switchMode(mode); } catch (e) { console.error('[import] switchMode', e); }
    return db.mode === mode;
  }
  // Jump to the Trades page in the account that holds the batch
  async function showTrades(mode, filter) {
    if (!(await toMode(mode))) return;
    if (typeof Ledger !== 'undefined' && Ledger && typeof Ledger.show === 'function') Ledger.show(filter);
    else Router.go('trades');
  }
  // Settings → Account edits the ACTIVE account, so switch to the one the message is about first
  async function openAccount(mode) {
    if (MODES.includes(mode) && !(await toMode(mode))) return;
    if (typeof Settings !== 'undefined' && Settings && typeof Settings.show === 'function') Settings.show('account');
    else Router.go('settings');
  }
  // Historical trades older than the account's start date: the equity curve's "Start" point would sit after them
  function earlyStart(d, a) {
    if (!d || d.undone || !a || !isNum(d.first) || typeof a.startDate !== 'string') return null;
    const day = nowLocalInput(d.first).slice(0, 10);
    if (!(day < a.startDate)) return null;
    const cur = Date.parse(a.startDate + 'T00:00');
    return { ms: d.first, day, cur: isFinite(cur) ? cur : d.first };
  }
  function setStartDate() {
    const d = st.done, a = d ? db.accounts[d.mode] : null, e = earlyStart(d, a);
    if (!e) return;
    const prev = a.startDate, mode = d.mode;
    a.startDate = e.day;
    commit();
    const nb = root && Router.active === 'import' ? root.querySelector('[data-act="review"]') : null;
    if (nb) { try { nb.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
    toast(`${MODE_LABEL[mode]} account now starts on ${fmtDate(e.ms)}`, 'ok', {
      ms: 9000, action: { label: 'Undo', run: () => { const x = db.accounts[mode]; if (x) { x.startDate = prev; commit('Start date restored', 'ok'); } } },
    });
  }
  // One batch on the Trades page. review: only its closed trades still waiting in the review queue
  // (the Ledger counts a trade as "to review" once it is closed), else every trade of the batch.
  function openBatch(batchId, mode, review) {
    const a = db.accounts[mode]; if (!a) return;
    const ids = batchIds(batchId, mode);
    if (!ids.length) { toast('That import was already removed', 'warn'); return; }
    const b = batches().find(x => x.id === batchId && x.mode === mode), at = b ? Date.parse(b.at) : NaN;
    const source = isFinite(at) ? `the import of ${fmtDateShort(at)}, ${fmtTime(at)}` : 'Import';
    if (review) {
      const set = new Set(ids), open = openParents(a.entries);
      const pending = a.entries.filter(e => set.has(e.id) && !open.has(e.id) && !isRev(e)).length;
      if (pending) { showTrades(mode, { status: 'review', ids, source }); return; }
      toast(ids.some(id => open.has(id)) ? 'Nothing to review yet — open trades join the review queue once you close them' : 'Every trade from this import is reviewed ✓', 'ok');
    }
    showTrades(mode, { ids, source });
  }

  /* ── Presets: save / delete ────────────────────────────── */
  function savePreset(src) {
    const P = src.preset, base = P.user ? P.base : P !== CUSTOM ? P.id : null;
    const def = P.user ? P.name : P === CUSTOM ? `${src.venue !== 'Other' ? src.venue : 'My'} CSV` : `${P.name} (my columns)`;
    Modal.open({
      title: 'Save column mapping', width: 460,
      body: `<div class="field"><label for="im-pn">Preset name</label><input class="input" id="im-pn" maxlength="60" autocomplete="off" value="${esc(def)}">
        <div class="hint">Next time you drop a file with these columns, this mapping, time zone and exchange are picked automatically.</div></div>`,
      foot: '<button class="btn btn-ghost" type="button" data-x>Cancel</button><button class="btn btn-primary" type="button" data-ok>Save preset</button>',
      onMount: (el, close) => {
        const inp = el.querySelector('#im-pn');
        const ok = () => { const v = inp.value.trim(); if (!v) { inp.classList.add('invalid'); inp.focus(); return; } close(v); };
        el.querySelector('[data-ok]').onclick = ok;
        el.querySelector('[data-x]').onclick = () => close();
        inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } };
      },
      onClose: (name) => { if (name) storePreset(src, name, base); },
    });
  }
  function storePreset(src, name, base) {
    const map = {}, match = [];
    for (const f of fieldsFor(src)) {
      if (!mapped(src, f)) continue;
      const h = src.headers[src.map[f]]; map[f] = h;
      const hn = normH(h); if (hn && !match.includes(hn)) match.push(hn);
    }
    if (!Array.isArray(db.importPresets)) db.importPresets = [];
    const nm = name.slice(0, 60), i = db.importPresets.findIndex(p => p && p.name === nm);   // same name → replace
    const p = { id: i >= 0 ? db.importPresets[i].id : uid('ip'), name: nm, match, map, tz: src.tz, grain: src.grain, venue: src.venue, market: src.market, base: base || null, createdAt: new Date().toISOString() };
    if (i >= 0) db.importPresets[i] = p; else db.importPresets.push(p);
    const keep = src.map;
    src.presetId = p.id; src.preset = presetById(p.id); src.map = keep; src.adjusted = false; src.ex = null;
    commit(`Preset “${nm}” saved — picked automatically next time`, 'ok');
  }
  async function deletePreset(src) {
    const P = src.preset;
    if (!P.user) return;
    const ok = await confirmDialog({ title: 'Delete this preset?', message: `“${P.name}” will no longer be picked automatically. Trades you already imported are not affected.`, confirmText: 'Delete preset', danger: true });
    if (!ok) return;
    db.importPresets = (Array.isArray(db.importPresets) ? db.importPresets : []).filter(p => p && p.id !== P.id);
    for (const s of st.sources) {
      if (s.presetId !== P.id) continue;
      const keep = s.map, nb = P.base || 'custom';
      s.presetId = nb; s.preset = presetById(nb); s.map = keep; s.ex = null;
    }
    commit('Preset deleted', 'ok');
  }

  /* ── Rendering helpers ─────────────────────────────────── */
  const STEPS = [['File', 'Choose the export'], ['Columns', 'Check what was read'], ['Review', 'Pick trades to import'], ['Done', 'Add stops in review']];
  const TARGETS = [{ id: 'live', label: 'Live' }, { id: 'paper', label: 'Paper' }, { id: 'demo', label: 'Demo' }];
  const TARGET_HINT = {
    live: 'Real trades from your exchange account — the usual choice.',
    paper: 'Only for practice trades, e.g. an exchange’s demo / testnet account.',
    demo: 'The sample sandbox — a safe place to try the importer first.',
  };
  const DELIM = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };
  const SKIP_TXT = {
    other: 'non-trade rows skipped (deposits, transfers…)', cancelled: 'cancelled orders skipped', zero: 'empty / zero-size rows skipped',
    notime: 'rows without a date skipped', noside: 'rows without a side skipped', fundcoin: 'funding in a non-$ coin left out',
  };
  const ORDER_TXT = { dmy: 'Day / month / year', mdy: 'Month / day / year', ymd: 'Year-month-day (2-digit year)' };
  const FILTERS = [['all', 'All'], ['new', 'New'], ['dup', 'Duplicates'], ['attn', 'Needs a look'], ['open', 'Open']];
  const inFilter = (t, f) => f === 'all' || (f === 'new' && t.status === 'new') || (f === 'dup' && (t.status === 'dup' || t.status === 'maybe'))
    || (f === 'attn' && (t.status === 'flag' || t.status === 'blocked' || t.flags.size > 0)) || (f === 'open' && !t.closed);
  const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
  const sideBadge = (s) => `<span class="badge ${s === 'short' ? 'short' : 'long'}">${s === 'short' ? '↘ SHORT' : '↗ LONG'}</span>`;
  const modeBadge = (m) => `<span class="badge sm im-m im-m-${esc(m)}">${esc(MODE_LABEL[m] || m)}</span>`;
  const when = (ms) => (isNum(ms) ? `${fmtDate(ms)}, ${fmtTime(ms)}` : '—');
  const plMoney = (v) => (isNum(v) ? `<span class="money ${plClass(v)}">${glyph(v) ? glyph(v) + ' ' : ''}${fmtMoney(v, { sign: true })}</span>` : '—');
  const fundTxt = (v) => (v >= 0 ? `paid ${money(v)}` : `received ${money(-v)}`);   // funding: + = paid
  const tzLabel = (tz) => (TZS.find(x => x[0] === tz) || [tz, tz])[1];
  function localTz() {
    const m = -new Date().getTimezoneOffset(), a = Math.abs(m);
    return `UTC${m < 0 ? MINUS : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
  }
  const kpi = (lbl, val, sub) => `<div class="kpi"><div class="k-lbl">${lbl}</div><div class="k-val">${val}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
  const msg = (kind, ic, html) => `<div class="im-msg ${kind}">${icon(ic)}<div>${html}</div></div>`;
  function scrollTop() {
    // async work (file reading, the snapshot wait) can finish after the user went to another page — leave that page alone
    if (typeof Router !== 'undefined' && Router.active !== 'import') return;
    const c = document.getElementById('content'); if (c) c.scrollTop = 0;
    if (window.matchMedia && matchMedia('(max-width: 860px)').matches) window.scrollTo(0, 0);
  }
  // Keep keyboard focus on the "same" control across full re-renders
  function focusKey() { const a = document.activeElement; return a && root && root.contains(a) && a.dataset ? a.dataset.fk || null : null; }
  function restoreFocus(k) {
    if (!k || !root) return;
    const n = [...root.querySelectorAll('[data-fk]')].find(x => x.dataset.fk === k);
    if (n && !n.disabled) { try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  /* ── Step indicator ────────────────────────────────────── */
  function stepper() {
    const cur = st.step;
    return `<ol class="im-steps" aria-label="Import steps">${STEPS.map(([l, s], i) => {
      const n = i + 1, on = n === cur, done = n < cur || cur === 4, can = n < cur && cur < 4;
      const inner = `<span class="im-sn" aria-hidden="true">${done && !on ? icon('check') : n}</span><span class="im-sl"><b>${l}</b><small>${s}</small></span>${on ? '<span class="sr-only">(current step)</span>' : done ? '<span class="sr-only">(done)</span>' : ''}`;
      return `<li class="im-step${on ? ' on' : ''}${done && !on ? ' done' : ''}"${on ? ' aria-current="step"' : ''}>${can
        ? `<button type="button" class="im-step-b" data-act="goto" data-step="${n}" data-fk="step-${n}" title="Back to: ${l}">${inner}</button>`
        : `<div class="im-step-b">${inner}</div>`}</li>`;
    }).join('')}</ol>`;
  }

  /* ── Step 1: file ──────────────────────────────────────── */
  function step1() {
    const a = db.accounts[st.target], noBal = st.target === 'live' && !(a && a.startingBalance > 0);
    const errs = st.errs.length ? `<div class="im-msgs" role="alert">${st.errs.map(m => msg('err', 'alert', esc(m))).join('')}</div>` : '';
    const files = st.sources.length ? `<div class="im-files">
        <div class="im-files-h">Ready to read</div>
        ${st.sources.map(s => `<div class="im-file">${icon('file-in')}<span class="im-file-n">${esc(s.name)}</span><span class="dim">${nfmt(s.data.length)} rows</span>
          <button type="button" class="btn btn-quiet btn-xs btn-icon" data-act="rmsrc" data-src="${s.id}" aria-label="Remove ${esc(s.name)}">${icon('x')}</button></div>`).join('')}
        <div class="im-files-a"><button type="button" class="btn btn-primary btn-sm" data-act="next1" data-fk="next1">Continue${icon('chevron-r')}</button></div>
      </div>` : '';
    return `<div class="im-g1">
      <div class="card im-pick">
        <div class="card-title">${icon('file-in')}Choose your exchange export</div>
        <div class="im-drop" data-drop>
          ${icon('upload')}
          <div class="im-drop-t">Drop CSV files here</div>
          <div class="im-drop-s">One or more files from the same exchange — trade history and, for futures, the funding / transaction history.</div>
          <button type="button" class="btn btn-primary btn-sm" data-act="pick" data-fk="pick">${icon('folder')}Choose files…</button>
        </div>
        ${errs}${files}
        <details class="im-paste" data-tog="paste"${st.pasteOpen ? ' open' : ''}>
          <summary>Paste CSV text instead</summary>
          <div class="im-paste-b">
            <label class="sr-only" for="im-paste">CSV text</label>
            <textarea class="input mono" id="im-paste" data-paste data-fk="paste" rows="6" spellcheck="false" placeholder="Date(UTC),Pair,Side,Price,Executed,Amount,Fee&#10;2026-03-05 14:02:11,BTCUSDT,BUY,67000,0.01BTC,670USDT,0.67USDT">${esc(st.paste)}</textarea>
            <button type="button" class="btn btn-ghost btn-sm" data-act="usepaste" data-fk="usepaste">Use this text</button>
          </div>
        </details>
        <div class="im-target">
          <div class="field">
            <label id="im-tl">Import into</label>
            <div class="seg inline" data-seg="target" role="group" aria-labelledby="im-tl"></div>
            <div class="hint">${esc(TARGET_HINT[st.target])}</div>
          </div>
          ${noBal ? msg('info', 'info', `Your Live account has no starting balance yet. Set it so % returns and risk % work for these trades. <button type="button" class="link-btn" data-act="acct" data-m="live">${db.mode === 'live' ? 'Open Settings → Account' : 'Switch to Live and open Settings → Account'}</button>`) : ''}
        </div>
        <div class="im-privacy">${icon('lock')}<div><b>Stays on this computer.</b> The file is read inside the app — no exchange login and no API keys. Never paste API keys into any journal or website.</div></div>
      </div>
      <div class="card im-help">
        <div class="card-title">${icon('info')}Where to find the export</div>
        <div class="card-sub">Menus move around. If a step looks different, look for <b>Trade history</b> and an <b>Export</b> or <b>Download</b> button.</div>
        <div class="im-guides">${GUIDES.map(g => `<details class="im-guide"><summary>${coinIcon(g.v.slice(0, 3))}<span>${esc(g.v)}</span></summary><div class="im-guide-b">${g.html}</div></details>`).join('')}</div>
        <div class="im-sup"><b>Recognised automatically:</b> Binance (spot, futures, funding), Bybit, OKX, Kraken, Coinbase, MEXC. Any other file → you match its columns once and save that as a preset.</div>
        <div class="reading">Paper trades don’t come from an exchange, so importing is mainly for when you trade <b>live</b>. You’ll check every trade before anything is saved.</div>
      </div>
    </div>`;
  }

  /* ── Step 2: columns ───────────────────────────────────── */
  function sampleTable(ex) {
    if (ex.fills.length) {
      const rows = ex.fills.slice(0, 4).map(f => `<tr><td>${esc(when(f.t))}</td><td><b>${esc(f.coin)}</b>${f.quote ? `<span class="dim">/${esc(f.quote)}</span>` : ''}</td>
        <td>${f.side === 'buy' ? 'Buy' : 'Sell'}</td><td class="num">${fmtQty(f.qty)}</td><td class="num">${fmtPrice(f.price)}</td>
        <td class="num">${f.feeNote ? `<span class="warn-c">${esc(f.feeNote)}</span>` : money(f.fee)}</td></tr>`).join('');
      return `<div class="table-wrap im-sample"><table class="compact-t"><caption class="sr-only">First rows as read</caption>
        <thead><tr><th scope="col">Your time</th><th scope="col">Coin</th><th scope="col">Side</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Price</th><th scope="col" class="num">Fee ($)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    if (ex.closed.length) {
      const rows = ex.closed.slice(0, 4).map(c => `<tr><td>${esc(when(c.tx))}</td><td><b>${esc(c.coin)}</b></td><td>${sideBadge(c.side)}</td>
        <td class="num">${fmtQty(c.qty)}</td><td class="num">${fmtPrice(c.entry)}</td><td class="num">${fmtPrice(c.exit)}</td></tr>`).join('');
      return `<div class="table-wrap im-sample"><table class="compact-t"><caption class="sr-only">First rows as read</caption>
        <thead><tr><th scope="col">Closed (your time)</th><th scope="col">Coin</th><th scope="col">Side</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Entry</th><th scope="col" class="num">Exit</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    const rows = ex.funds.slice(0, 4).map(u => `<tr><td>${esc(when(u.t))}</td><td><b>${esc(u.coin)}</b></td><td class="num">${fundTxt(u.usd)}</td></tr>`).join('');
    return `<div class="table-wrap im-sample"><table class="compact-t"><caption class="sr-only">First funding rows as read</caption>
      <thead><tr><th scope="col">Your time</th><th scope="col">Coin</th><th scope="col" class="num">Funding</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function srcCard(src) {
    const P = src.preset, miss = missingRequired(src), ex = miss.length ? null : extract(src);
    const missF = new Set(missingGroups(src).flat()), single = new Set(required(src).filter(g => g.length === 1).flat());
    const ups = userPresets(), id = src.id;
    const badge = P === CUSTOM ? '<span class="badge warn">Not recognised — match the columns</span>'
      : `<span class="badge ok">✓ ${P.user ? 'Your preset: ' : ''}${esc(P.name)}</span>${P.unverified ? '<span class="badge cat">Check the preview</span>' : ''}`;
    const presetSel = `<select class="input sm" id="${id}-p" data-opt="preset" data-src="${id}" data-fk="${id}-p">
      ${ups.length ? `<optgroup label="Your presets">${ups.map(p => opt(p.id, p.name, src.presetId)).join('')}</optgroup>` : ''}
      <optgroup label="Exchanges">${PRESETS.map(p => opt(p.id, p.name, src.presetId)).join('')}</optgroup>
      <optgroup label="Other">${opt('custom', 'Custom — match the columns myself', src.presetId)}</optgroup></select>`;
    const tzs = TZS.some(x => x[0] === src.tz) ? TZS : TZS.concat([[src.tz, src.tz]]);
    const dOrd = dateOrder(src);
    const field = (fid, label, control, hint) => `<div class="field"><label for="${fid}">${label}</label>${control}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    const opts = [
      field(`${id}-p`, 'File type', presetSel),
      field(`${id}-v`, 'Exchange', `<select class="input sm" id="${id}-v" data-opt="venue" data-src="${id}" data-fk="${id}-v">${VENUES.filter(v => v !== 'PulseX' && v !== '9mm').map(v => opt(v, v, src.venue)).join('')}</select>`),
      P.funding ? '' : field(`${id}-k`, 'Market', `<select class="input sm" id="${id}-k" data-opt="market" data-src="${id}" data-fk="${id}-k">${opt('spot', 'Spot', src.market)}${opt('perp', 'Perpetual futures', src.market)}</select>`),
      field(`${id}-z`, 'Times in the file are', `<select class="input sm" id="${id}-z" data-opt="tz" data-src="${id}" data-fk="${id}-z">${tzs.map(([v, l]) => opt(v, l, src.tz)).join('')}</select>`),
      dOrd.n ? field(`${id}-o`, 'Date order', `<select class="input sm" id="${id}-o" data-opt="order" data-src="${id}" data-fk="${id}-o">${opt('auto', `Auto (${ORDER_TXT[dOrd.order] || '—'})`, src.order)}${Object.entries(ORDER_TXT).map(([v, l]) => opt(v, l, src.order)).join('')}</select>`, dOrd.ambiguous && src.order === 'auto' ? '<span class="warn-c">Can’t tell for sure — check the dates below.</span>' : '') : '',
      !P.funding && (P === CUSTOM || (P.user && !P.base)) ? field(`${id}-g`, 'Each row is', `<select class="input sm" id="${id}-g" data-opt="grain" data-src="${id}" data-fk="${id}-g">${opt('fill', 'A buy or sell (fill / order)', src.grain)}${opt('closed', 'A closed trade (entry + exit)', src.grain)}</select>`) : '',
    ].join('');
    const first = src.data[0] || [];
    const mapHtml = fieldsFor(src).map(f => {
      const cur = mapped(src, f) ? src.map[f] : -1, eg = cur >= 0 ? cell(first, cur) : '', req = single.has(f);
      return `<div class="field im-mf${missF.has(f) ? ' missing' : ''}">
        <label for="${id}-m-${f}">${esc(fieldLabel(f, src))}${req ? '<span class="im-req" aria-hidden="true">*</span><span class="sr-only">(required)</span>' : missF.has(f) ? ' <span class="opt">(one of these)</span>' : ' <span class="opt">optional</span>'}</label>
        <select class="input sm" id="${id}-m-${f}" data-map="${f}" data-src="${id}" data-fk="${id}-m-${f}">${opt(-1, '— not in this file —', cur)}${src.headers.map((h, i) => opt(i, h || `(column ${i + 1})`, cur)).join('')}</select>
        <div class="hint">${cur >= 0 && eg ? `e.g. <span class="mono">${esc(eg.slice(0, 32))}</span>` : esc(HINT[f] || '')}</div></div>`;
    }).join('');
    const used = new Set(fieldsFor(src).filter(f => mapped(src, f)).map(f => src.map[f]));
    let read;
    if (miss.length) read = `<div role="alert">${msg('err', 'alert', `Pick a column for: <b>${miss.map(esc).join(', ')}</b>.`)}</div>`;
    else {
      const nT = ex.fills.length + ex.closed.length;
      const skips = Object.entries(ex.skip).filter(([k]) => k !== 'bad').map(([k, v]) => `${nfmt(v)} ${SKIP_TXT[k] || k}`);
      read = `<div class="im-read">
        <div class="im-read-h">${icon('check')}<span><b>${nfmt(nT)}</b> ${ex.closed.length ? 'closed trades' : 'buys / sells'} read${ex.funds.length ? ` · <b>${nfmt(ex.funds.length)}</b> funding payments` : ''}${skips.length ? `<span class="dim"> · ${esc(skips.join(' · '))}</span>` : ''}</span></div>
        ${ex.sample ? `<div class="im-tzs">First date in the file: <span class="mono">${esc(ex.sample.raw)}</span> (${esc(tzLabel(src.tz))}) → <b>${esc(when(ex.sample.t))}</b> your time (${localTz()}).</div>` : ''}
        ${ex.errs.length ? msg('warn', 'alert', `<b>${plural(ex.skip.bad || 0, 'row')} could not be read.</b><br>${ex.errs.map(esc).join('<br>')}`) : ''}
        ${rowsRead(ex) ? sampleTable(ex) : msg('err', 'alert', `Nothing usable was found — check the columns${dOrd.n ? ' and the date order' : ''}.`)}
      </div>`;
    }
    return `<div class="card im-src">
      <div class="im-src-h">
        <span class="im-src-ic">${icon('file-in')}</span>
        <div class="im-src-n"><b>${esc(src.name)}</b><small>${nfmt(src.data.length)} rows · ${DELIM[src.delim] || 'custom'}-separated${src.hdr ? ` · header on line ${src.hdr + 1}` : ''}</small></div>
        <div class="im-src-b">${badge}</div>
        <button type="button" class="btn btn-quiet btn-xs" data-act="rmsrc" data-src="${id}" aria-label="Remove ${esc(src.name)}">${icon('trash')}Remove</button>
      </div>
      ${P.unverified ? msg('info', 'info', 'This layout was built from public descriptions, not a real file — compare the rows below with the exchange before importing.') : ''}
      ${P.funding ? msg('info', 'info', 'Funding file: each payment is attached to the futures trade that was open at the time. Drop the trade history file from the same exchange too.') : ''}
      <div class="im-opts">${opts}</div>
      <details class="im-cols" data-tog="map" data-src="${id}"${src.mapOpen || miss.length ? ' open' : ''}>
        <summary>Columns used${miss.length ? ` <span class="badge stop sm">${miss.length} missing</span>` : src.adjusted ? ' <span class="badge cat sm">edited</span>' : ''}</summary>
        <div class="im-map">${mapHtml}</div>
        <div class="im-map-acts">
          <button type="button" class="btn btn-ghost btn-xs" data-act="savepreset" data-src="${id}" data-fk="${id}-save"${miss.length ? ' disabled' : ''}>${icon('star')}Save as preset</button>
          ${P.user ? `<button type="button" class="btn btn-quiet btn-xs" data-act="delpreset" data-src="${id}" data-fk="${id}-del">${icon('trash')}Delete this preset</button>` : ''}
          <span class="dim">${P === CUSTOM || src.adjusted ? 'A saved preset is picked automatically next time.' : 'Change a column if something below looks wrong.'}</span>
        </div>
      </details>
      ${read}
      <details class="im-raw" data-tog="raw" data-src="${id}"${src.rawOpen ? ' open' : ''}>
        <summary>Show the file’s first rows</summary>
        <div class="table-wrap im-rawt"><table class="compact-t"><caption class="sr-only">First rows of ${esc(src.name)} as written in the file</caption>
          <thead><tr>${src.headers.map((h, i) => `<th scope="col"${used.has(i) ? ' class="im-used"' : ''}>${esc(h || `(column ${i + 1})`)}</th>`).join('')}</tr></thead>
          <tbody>${src.data.slice(0, 5).map(r => `<tr>${src.headers.map((_, i) => `<td${used.has(i) ? ' class="im-used"' : ''}>${esc(cell(r, i).slice(0, 40))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      </details>
    </div>`;
  }
  function step2() {
    const ok = st.sources.length > 0 && st.sources.every(s => !missingRequired(s).length && rowsRead(extract(s)) > 0);
    return `<div class="im-s2">
      <div class="reading im-lead">${icon('clock')}<span>Exchanges write times in their own time zone. They are converted to <b>your time (${localTz()})</b> — if the first date below looks a few hours off, change “Times in the file are”.</span></div>
      ${st.sources.map(srcCard).join('')}
      <div class="im-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="back" data-fk="back2">${icon('chevron-l')}Back</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="pick" data-fk="pick2">${icon('plus')}Add another file</button>
        <span class="sp"></span>
        ${ok ? '' : '<span class="im-why">Fix or remove the files marked above to continue.</span>'}
        <button type="button" class="btn btn-primary" data-act="analyze" data-fk="analyze"${ok ? '' : ' disabled'}>Build trades${icon('chevron-r')}</button>
      </div>
    </div>`;
  }

  /* ── Step 3: staging preview ───────────────────────────── */
  function statusHtml(t) {
    const out = [];
    if (t.dup === 'same') out.push(`<span class="badge cat sm">Already imported</span>${infoTip('A trade with the same exchange ID is already in this account, so it is unticked — nothing gets counted twice.')}`);
    else if (t.dup === 'open') out.push(`<span class="badge warn sm">In journal as open</span>${infoTip('You imported this trade earlier while it was still open. Close that trade in the journal (or remove the old import) instead of importing it again.')}`);
    else if (t.maybe) out.push(`<span class="badge warn sm">Possible duplicate</span>${infoTip('A trade with the same coin and side and a similar entry time and price is already in this account — maybe you logged it by hand. Unticked to be safe.')}`);
    for (const k of t.flags) {
      const F = FLAG[k]; if (!F) continue;
      const extra = k === 'fee' && t.feeNotes.length ? ` (${t.feeNotes.slice(0, 3).join(', ')})` : '';
      out.push(`<span class="badge ${F.hard ? 'stop' : 'warn'} sm">${esc(F.t)}</span>${infoTip(F.tip + extra)}`);
    }
    if (!out.length) out.push('<span class="badge ok sm">New</span>');
    return out.join('');
  }
  function rowHtml(t) {
    const s = summ(t), can = canPick(t), on = can && st.sel.has(t.key), w = when(s.entryMs);
    const unknownEntry = t.flags.has('preclose') || t.flags.has('basis');
    const hold = t.closed ? (unknownEntry ? 'entry time unknown' : 'held ' + fmtDuration(Math.max(0, s.exitMs - s.entryMs))) : 'still open';
    const entry = t.flags.has('basis')
      ? `<input class="input sm mono im-basis" data-basis="${t.key}" data-fk="b-${t.key}" inputmode="decimal" autocomplete="off" placeholder="Avg buy $" aria-label="Average buy price for the ${esc(t.coin)} sold ${esc(w)}" value="${esc(st.basisTxt[t.key] || '')}">`
      : fmtPrice(s.avgEntry);
    const exit = s.avgExit != null ? fmtPrice(s.avgExit) + (!t.closed ? '<small>partial</small>' : '') : '<span class="badge open sm">OPEN</span>';
    const pl = t.closed ? (s.net != null ? plMoney(s.net) : '<span class="dim">—</span>')
      : s.net != null ? `<span class="dim">open</span><small>realised ${plMoney(s.net)}</small>` : '<span class="dim">open</span>';
    const legs = s.legs.length;
    return `<tr class="${on ? 'sel' : 'im-off'}${t.hard ? ' im-hard' : ''}" data-key="${t.key}">
      <td class="im-ck"><input type="checkbox" data-pick="${t.key}" data-fk="p-${t.key}"${on ? ' checked' : ''}${can ? '' : ' disabled'} aria-label="Import ${esc(t.coin)} ${t.side} opened ${esc(w)}"></td>
      <td>${esc(w)}<small>${hold}</small></td>
      <td><div class="coin-cell">${coinIcon(t.coin)}<div>${esc(t.coin)}<small>${esc(t.venue)} · ${t.market === 'perp' ? 'Perp' : 'Spot'}${legs > 1 ? ` · ${legs} legs` : ''}${t.nFills > 1 ? ` · ${t.nFills} fills` : ''}</small></div></div></td>
      <td>${sideBadge(t.side)}</td>
      <td class="num">${fmtQty(s.qty)}</td>
      <td class="num">${entry}</td>
      <td class="num">${exit}</td>
      <td class="num">${pl}</td>
      <td class="num">${money(s.fees)}${t.fundN ? `<small>funding ${fundTxt(t.funding)}</small>` : ''}</td>
      <td><div class="im-st">${statusHtml(t)}</div></td>
    </tr>`;
  }
  function table(shown, page) {
    const pickable = shown.filter(canPick), allOn = pickable.length > 0 && pickable.every(t => st.sel.has(t.key));
    return `<div class="table-wrap bare im-tw"><table class="im-t">
      <caption class="sr-only">Trades found in your file. Ticked rows will be imported.</caption>
      <thead><tr>
        <th class="im-ck" scope="col"><input type="checkbox" data-allpick data-fk="allpick" aria-label="Tick every trade in this view"${allOn ? ' checked' : ''}${pickable.length ? '' : ' disabled'}></th>
        <th scope="col">Opened</th><th scope="col">Coin</th><th scope="col">Side</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Entry</th>
        <th scope="col" class="num">Exit</th><th scope="col" class="num">Net P/L</th><th scope="col" class="num">Costs</th><th scope="col">Status</th>
      </tr></thead><tbody>${page.map(rowHtml).join('')}</tbody></table></div>`;
  }
  function sumInner() {
    const r = st.res, ts = r.trades, sel = ts.filter(t => st.sel.has(t.key) && canPick(t));
    const dup = ts.filter(t => t.dup || t.maybe).length, attn = ts.filter(t => t.status === 'flag' || t.status === 'blocked').length;
    let net = 0, nC = 0, fees = 0;
    for (const t of sel) { const s = summ(t); fees += s.fees; if (t.closed && s.net != null) { net += s.net; nC++; } }
    const open = sel.filter(t => !t.closed).length;
    return `<div class="kpis k5 im-kpis">
      ${kpi('Trades found', nfmt(ts.length), `from ${plural(r.nRows, 'row')}${r.dupFills ? ` · ${nfmt(r.dupFills)} repeated skipped` : ''}`)}
      ${kpi('Ticked', nfmt(sel.length), open ? `${open} still open` : 'to import')}
      ${kpi('Already in journal', nfmt(dup), dup ? 'unticked' : 'no duplicates found')}
      ${kpi('Need a look', nfmt(attn), attn ? 'flagged · unticked' : 'nothing flagged')}
      ${kpi('Ticked net P/L', plMoney(net), `${plural(nC, 'closed trade')} · costs ${money(fees)}`)}
    </div>`;
  }
  const nTicked = () => (st.res ? st.res.trades.filter(t => st.sel.has(t.key) && canPick(t)).length : 0);
  const countHtml = (n) => (n ? `<b>${nfmt(n)}</b> of ${nfmt(st.res.trades.length)} ticked → ${modeBadge(st.target)}` : 'Nothing ticked yet');
  const importLbl = (n) => `${icon('download')}${st.busy ? 'Importing…' : `Import ${plural(n, 'trade')}`}`;
  function footInner() {
    const n = nTicked();
    return `<button type="button" class="btn btn-ghost btn-sm" data-act="back" data-fk="back3"${st.busy ? ' disabled' : ''}>${icon('chevron-l')}Back</button>
      <span class="im-bar-t" aria-live="polite" data-live="count">${countHtml(n)}</span>
      <button type="button" class="btn btn-primary" data-act="import" data-fk="import"${n && !st.busy ? '' : ' disabled'}>${importLbl(n)}</button>`;
  }
  // Ticking a row updates the bar in place — the live region survives, so screen readers hear the new count
  function syncFoot() {
    if (!root || !st.res) return;
    const n = nTicked(), c = root.querySelector('[data-live="count"]'), b = root.querySelector('[data-act="import"]');
    if (c) c.innerHTML = countHtml(n);
    if (b) { b.disabled = !n || st.busy; b.innerHTML = importLbl(n); }
  }
  function notes() {
    const r = st.res, out = [], rc = r.recon, fu = r.funds;
    if (rc.has && rc.match) out.push(`<div class="reading im-good">${icon('check')}<span><b>Matches the file.</b> The P/L rebuilt from your fills (${plMoney(rc.value)} ${rc.match}) equals the exchange’s own realised P/L (${plMoney(rc.file)}).</span></div>`);
    else if (rc.has) out.push(`<div class="reading im-bad">${icon('alert')}<span><b>Differs by ${money(Math.abs(rc.diff))}.</b> Rebuilt from your fills: ${plMoney(rc.value)} ${esc(rc.basis)}; the file’s own realised P/L adds up to ${plMoney(rc.file)}. Usually this means positions opened before the file starts, fees paid in BNB, or a column mapped to the wrong field — check the flagged rows before importing.</span></div>`);
    else if (rc.open) out.push(`<div class="reading">${icon('info')}<span>Nothing in this file has been closed yet, so there is no realised P/L to cross-check. The positions come in as <b>open trades</b> — close them in the journal when you exit.</span></div>`);
    else out.push(`<div class="reading">${icon('info')}<span>${rc.empty ? 'The file’s realised P/L column is empty' : 'This file has no realised P/L column'}, so there is nothing to cross-check. Compare two or three trades with the exchange’s own history before importing.</span></div>`);
    if (fu.n) out.push(`<div class="reading">${icon('clock')}<span><b>${plural(fu.matched, 'funding payment')}</b> attached to the futures trades open at the time (${fundTxt(fu.matchedUsd)} in total).${fu.left ? ` ${plural(fu.left, 'payment')} (${fundTxt(fu.leftUsd)}) happened while no imported position was open and ${fu.left === 1 ? 'was' : 'were'} left out.` : ''}</span></div>`);
    else if (r.perp && !r.fundingCol) out.push(`<div class="reading">${icon('info')}<span>No funding in this file. For futures held across funding times (often every 8 h), also drop the exchange’s funding / transaction history so net P/L includes it.</span></div>`);
    const nb = r.trades.filter(t => t.flags.has('basis')).length;
    if (nb) out.push(`<div class="reading im-bad">${icon('alert')}<span><b>${plural(nb, 'sell')} without a matching buy</b> in this file (coins bought earlier or elsewhere). They are unticked — type your average buy price in the Entry column to include one, or leave them out.</span></div>`);
    const nd = r.trades.filter(t => t.dup).length;
    if (nd) out.push(`<div class="reading">${icon('copy')}<span><b>${plural(nd, 'trade')}</b> ${nd === 1 ? 'is' : 'are'} already in your ${esc(MODE_LABEL[r.target])} journal (same exchange IDs) — unticked, so nothing is imported twice.</span></div>`);
    out.push(`<div class="reading">${icon('target')}<span><b>No stops in exchange files.</b> Imported trades have no stop yet, so their R shows “—” and R-based stats skip them until you add the stop you planned. They land in the <b>Needs review</b> queue. The preview shows dollars for the same reason.</span></div>`);
    if (r.target !== db.mode) out.push(`<div class="reading">${icon('info')}<span>These go into your <b>${esc(MODE_LABEL[r.target])}</b> account — you are viewing ${esc(MODE_LABEL[db.mode])} right now.</span></div>`);
    return out.join('');
  }
  function step3() {
    const r = st.res, ts = r.trades;
    if (!ts.length) {
      const why = r.funds.n ? 'Only funding payments were found. Add the trade history file from the same exchange — the funding is attached to those trades automatically.'
        : 'No trades could be built from this file. Go back and check the columns and the date format.';
      return `<div class="card">${emptyHtml('No trades to import', why)}<div class="im-actions im-center"><button type="button" class="btn btn-ghost btn-sm" data-act="back" data-fk="back3">${icon('chevron-l')}Back to columns</button></div></div>`;
    }
    const shown = ts.filter(t => inFilter(t, st.filter)), page = shown.slice(0, st.limit);
    const cnt = (f) => ts.filter(t => inFilter(t, f)).length;
    return `<div data-live="sum">${sumInner()}</div>
      <div class="im-notes">${notes()}</div>
      <div class="card flush im-tc">
        <div class="im-tbar">
          <div class="im-fil" role="group" aria-label="Show trades">${FILTERS.map(([fid, l]) => `<button type="button" class="chip sm${st.filter === fid ? ' on' : ''}" aria-pressed="${st.filter === fid}" data-act="filter" data-f="${fid}" data-fk="f-${fid}">${l}<span class="im-cn">${nfmt(cnt(fid))}</span></button>`).join('')}</div>
          <span class="sp"></span>
          <button type="button" class="btn btn-quiet btn-xs" data-act="suggest" data-fk="suggest">Tick suggested</button>
          <button type="button" class="btn btn-quiet btn-xs" data-act="none" data-fk="none">Untick all</button>
        </div>
        ${shown.length ? table(shown, page) : '<div class="empty-state sm"><div class="big">Nothing in this view</div><div class="small">Pick another filter above.</div></div>'}
        ${shown.length > page.length ? `<div class="im-more"><button type="button" class="btn btn-ghost btn-sm" data-act="more" data-fk="more">Show ${nfmt(Math.min(PAGE_ROWS, shown.length - page.length))} more <span class="dim">(${nfmt(shown.length - page.length)} not shown)</span></button></div>` : ''}
      </div>
      <div class="im-bar">${footInner()}</div>`;
  }

  /* ── Step 4: done ──────────────────────────────────────── */
  function step4() {
    const d = st.done, mode = d.mode;
    if (d.undone) {
      return `<div class="card im-done"><div class="im-done-h"><span class="im-done-ic undone">${icon('undo')}</span><div><h3>Import undone</h3>
        <div class="muted">The ${plural(d.n, 'trade')} moved to Trash (restorable for 30 days). Nothing else in your journal changed.</div></div></div>
        <div class="im-actions"><button type="button" class="btn btn-primary btn-sm" data-act="again" data-fk="again">${icon('file-in')}Import a file</button></div></div>`;
    }
    const ck = (n, title, sub) => `<div class="ck"><span class="cb im-cbn" aria-hidden="true">${n}</span><div><div class="ct">${title}</div><div class="cs">${sub}</div></div></div>`;
    const a = db.accounts[mode], noBal = mode === 'live' && !(a && a.startingBalance > 0), early = earlyStart(d, a);
    return `<div class="card im-done">
      <div class="im-done-h"><span class="im-done-ic">${icon('check')}</span><div><h3>Imported ${plural(d.n, 'trade')} into ${esc(MODE_LABEL[mode])}</h3>
        <div class="muted">${plural(d.legs, 'journal row')}${d.open ? ` · ${d.open} still open` : ''} · listed in Import history below</div></div></div>
      <div class="checklist im-next">
        ${ck(1, 'Add the stop you planned to each trade', 'Exchange files have no stop-loss plan. Until a trade has its stop, R shows “—” and it is left out of R-based stats such as expectancy and SQN.')}
        ${ck(2, 'Pick the strategy and review the process', 'Strategy, mistakes and an A/B/C process grade turn raw fills into lessons. Every imported trade waits in the Needs review queue.')}
        ${d.flagged ? ck(3, `Check ${plural(d.flagged, 'flagged trade')}`, 'Their notes say what to fix — for example a fee paid in BNB that needs its $ value.') : ''}
      </div>
      ${mode !== db.mode ? msg('info', 'info', `These trades are in your <b>${esc(MODE_LABEL[mode])}</b> account and you are viewing <b>${esc(MODE_LABEL[db.mode])}</b> — the buttons below switch for you.`) : ''}
      ${noBal ? msg('info', 'info', `Your Live account has no starting balance yet, so % returns and risk % stay blank. <button type="button" class="link-btn" data-act="acct" data-m="live">${db.mode === 'live' ? 'Set it in Settings → Account' : 'Switch to Live and set it in Settings → Account'}</button>`) : ''}
      ${early ? msg('info', 'calendar', `These trades go back to <b>${esc(fmtDate(early.ms))}</b>, before your ${esc(MODE_LABEL[mode])} account’s start date (${esc(fmtDate(early.cur))}), so the equity curve would start after them. <button type="button" class="link-btn" data-act="startdate" data-fk="startdate">Start the account on ${esc(fmtDate(early.ms))}</button>`) : ''}
      <div class="im-actions">
        <button type="button" class="btn btn-primary" data-act="review" data-fk="review">${icon('check')}Review imported trades</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="showdone" data-fk="showdone">${icon('list')}Show these trades</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="undo" data-fk="undo">${icon('undo')}Undo this import</button>
        <span class="sp"></span>
        <button type="button" class="btn btn-quiet btn-sm" data-act="again" data-fk="again">${icon('file-in')}Import another file</button>
      </div>
    </div>`;
  }

  /* ── Import history (all accounts) ─────────────────────── */
  function historyCard() {
    const bs = batches(), n = bs.length;
    const rows = bs.map(b => {
      const at = Date.parse(b.at), ven = [...b.venues].join(', ') || '—', srcTxt = [...b.srcs].join(', ');
      const lbl = `${MODE_LABEL[b.mode]} import of ${isFinite(at) ? when(at) : 'unknown date'}`, fk = esc(`h-${b.mode}-${b.id}`);
      return `<tr>
        <td>${isFinite(at) ? esc(when(at)) : '—'}</td><td>${modeBadge(b.mode)}</td>
        <td class="im-hsrc"><b>${esc(ven)}</b>${srcTxt ? `<small title="${esc(srcTxt)}">${esc(srcTxt)}</small>` : ''}</td>
        <td class="num">${nfmt(b.trades)}</td>
        <td class="num">${b.review ? `<span class="badge warn sm">${nfmt(b.review)}</span>` : '<span class="dim">0</span>'}${b.open ? `<small>${nfmt(b.open)} still open</small>` : ''}</td>
        <td><div class="im-hacts">
          <button type="button" class="btn btn-ghost btn-xs" data-act="hreview" data-b="${esc(b.id)}" data-m="${b.mode}" data-fk="${fk}-r" aria-label="Review trades from the ${esc(lbl)}">Review</button>
          <button type="button" class="btn btn-quiet btn-xs" data-act="hshow" data-b="${esc(b.id)}" data-m="${b.mode}" data-fk="${fk}-s" aria-label="Show trades from the ${esc(lbl)}">Show</button>
          <button type="button" class="btn btn-quiet btn-xs im-rm" data-act="hrm" data-b="${esc(b.id)}" data-m="${b.mode}" data-fk="${fk}-x" aria-label="Remove batch: ${esc(lbl)}">${icon('trash')}Remove batch</button>
        </div></td></tr>`;
    }).join('');
    return `<div class="card im-hist">
      <div class="card-title">${icon('layers')}Import history${n ? `<span class="aside">${n} batch${n === 1 ? '' : 'es'}</span>` : ''}</div>
      ${n ? `<div class="card-sub">Each import is one batch. Removing a batch takes all of its trades out again (with Undo); nothing else is touched.</div>
        <div class="table-wrap bare im-htw"><table class="compact-t im-ht"><caption class="sr-only">Past imports</caption>
          <thead><tr><th scope="col">Imported</th><th scope="col">Account</th><th scope="col">Exchange</th><th scope="col" class="num">Trades</th><th scope="col" class="num">Need review</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
        : '<div class="empty-state sm"><div class="big">No imports yet</div><div class="small">Each import shows up here, so you can review or remove a whole batch in one click.</div></div>'}
    </div>`;
  }

  /* ── Draw + events ─────────────────────────────────────── */
  function draw() {
    if (!root) return;
    if (st.step === 2 && !st.sources.length) st.step = 1;
    if (st.step === 3 && !st.res) st.step = st.sources.length ? 2 : 1;
    if (st.step === 4 && !st.done) st.step = 1;
    const fk = focusKey();
    // the staging table scrolls inside its own box — keep its position across full re-renders (tick all, filter…)
    const tw = st.step === 3 ? root.querySelector('.im-tw') : null, keep = tw ? [tw.scrollTop, tw.scrollLeft] : null;
    const body = st.step === 1 ? step1() : st.step === 2 ? step2() : st.step === 3 ? step3() : step4();
    root.innerHTML = `<div class="im im-step${st.step}">
      <input type="file" class="hidden" data-file accept=".csv,.tsv,.txt,text/csv,text/plain" multiple tabindex="-1" aria-hidden="true">
      ${stepper()}${body}${historyCard()}</div>`;
    bind();
    if (keep) { const nt = root.querySelector('.im-tw'); if (nt) { nt.scrollTop = keep[0]; nt.scrollLeft = keep[1]; } }
    restoreFocus(fk);
  }
  const hasFiles = (ev) => !!(ev.dataTransfer && [...(ev.dataTransfer.types || [])].includes('Files'));
  function bind() {
    root.onclick = onClick; root.onchange = onChange; root.oninput = onInput;
    // Files dropped anywhere on the page land here (and never navigate the app away)
    root.ondragover = (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); const dz = root.querySelector('[data-drop]'); if (dz) dz.classList.add('over'); };
    root.ondragleave = (ev) => { const dz = root.querySelector('[data-drop]'); if (dz && !root.contains(ev.relatedTarget)) dz.classList.remove('over'); };
    root.ondrop = (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      const dz = root.querySelector('[data-drop]'); if (dz) dz.classList.remove('over');
      if (st.busy) return;
      if (st.step === 3) st.res = null;
      addFiles(ev.dataTransfer.files);
    };
    root.querySelectorAll('details[data-tog]').forEach(d => {
      d.ontoggle = () => {
        const s = d.dataset.src ? st.sources.find(x => x.id === d.dataset.src) : null;
        if (d.dataset.tog === 'paste') st.pasteOpen = d.open;
        else if (s && d.dataset.tog === 'map') s.mapOpen = d.open;
        else if (s && d.dataset.tog === 'raw') s.rawOpen = d.open;
      };
    });
    const sg = root.querySelector('[data-seg="target"]');
    if (sg) seg(sg, TARGETS, st.target, (v) => {
      st.target = MODES.includes(v) ? v : 'live'; st.res = null; draw();
      const b = root.querySelector('[data-seg="target"] button.on');   // seg buttons carry no data-fk: refocus by hand
      if (b) { try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    });
    syncAll();
  }
  function syncAll() {
    const h = root && root.querySelector('[data-allpick]');
    if (!h || !st.res) return;
    const list = st.res.trades.filter(t => inFilter(t, st.filter) && canPick(t)), n = list.filter(t => st.sel.has(t.key)).length;
    h.checked = list.length > 0 && n === list.length; h.indeterminate = n > 0 && n < list.length;
  }
  // One checkbox: update in place so the scroll position and focus stay put
  function pick(el) {
    const k = el.dataset.pick;
    if (el.checked) st.sel.add(k); else st.sel.delete(k);
    const tr = el.closest('tr'); if (tr) { tr.classList.toggle('sel', el.checked); tr.classList.toggle('im-off', !el.checked); }
    const a = root.querySelector('[data-live="sum"]'); if (a) a.innerHTML = sumInner();
    syncFoot(); syncAll();
  }
  function setBasis(el) {
    const k = el.dataset.basis, t = st.res && st.res.trades.find(x => x.key === k);
    if (!t) return;
    st.basisTxt[k] = el.value;
    const v = parseNum(el.value, false).v, had = t.basisPrice;
    t.basisPrice = isNum(v) && v > 0 ? v : null; t._s = null;
    if (t.basisPrice && !had) st.sel.add(k);
    if (!t.basisPrice) st.sel.delete(k);
    if (el.value.trim() && !t.basisPrice) toast('Type the price as a number, e.g. 41250.5', 'warn');
    // 'change' fires as Tab leaves the field: refresh every other cell of the row in place, so the
    // input and the focus move that is under way survive (a full redraw would pull focus back here)
    const tr = el.closest('tr'), tmp = document.createElement('tbody');
    tmp.innerHTML = rowHtml(t);
    const nr = tmp.firstElementChild;
    if (!tr || !nr || tr.cells.length !== nr.cells.length) { draw(); return; }
    tr.className = nr.className;
    for (let i = 0; i < tr.cells.length; i++) if (!tr.cells[i].contains(el)) tr.cells[i].innerHTML = nr.cells[i].innerHTML;
    const a = root.querySelector('[data-live="sum"]'); if (a) a.innerHTML = sumInner();
    syncFoot(); syncAll();
  }
  function go(n) { st.step = Math.max(1, Math.min(4, n)); draw(); scrollTop(); }
  function onClick(ev) {
    const b = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!b || !root.contains(b) || b.disabled) return;
    const a = b.dataset.act, src = b.dataset.src ? st.sources.find(s => s.id === b.dataset.src) : null;
    // while the import is being written (snapshot wait), the wizard stays where it is
    if (st.busy && /^(pick|usepaste|goto|next1|back|rmsrc|analyze|savepreset|delpreset|again)$/.test(a)) return;
    switch (a) {
      case 'pick': { const inp = root.querySelector('[data-file]'); if (inp) inp.click(); return; }
      case 'usepaste': usePaste(); return;
      case 'goto': go(+b.dataset.step); return;
      case 'next1': go(2); return;
      case 'back': go(st.step - 1); return;
      case 'rmsrc': if (src) { st.sources = st.sources.filter(s => s !== src); st.res = null; } draw(); return;
      case 'analyze': runAnalyze(); return;
      case 'savepreset': if (src) savePreset(src); return;
      case 'delpreset': if (src) deletePreset(src); return;
      case 'filter': st.filter = FILTERS.some(f => f[0] === b.dataset.f) ? b.dataset.f : 'all'; st.limit = PAGE_ROWS; draw(); return;
      case 'suggest': if (st.res) st.sel = new Set(st.res.trades.filter(t => t.status === 'new' && canPick(t)).map(t => t.key)); draw(); return;
      case 'none': st.sel.clear(); draw(); return;
      case 'more': st.limit += PAGE_ROWS; draw(); return;
      case 'import': doImport(); return;
      case 'review': if (st.done) openBatch(st.done.batchId, st.done.mode, true); return;
      case 'showdone': if (st.done) openBatch(st.done.batchId, st.done.mode, false); return;
      case 'undo': if (st.done && !st.done.undone) removeBatch(st.done.batchId, st.done.mode, false); return;
      case 'again': st = fresh(st.target); draw(); scrollTop(); return;
      case 'acct': openAccount(b.dataset.m); return;
      case 'startdate': setStartDate(); return;
      case 'hreview': openBatch(b.dataset.b, b.dataset.m, true); return;
      case 'hshow': openBatch(b.dataset.b, b.dataset.m, false); return;
      case 'hrm': removeBatch(b.dataset.b, b.dataset.m, true); return;
      default: return;
    }
  }
  function onChange(ev) {
    const el = ev.target;
    if (!el || !el.dataset) return;
    if (el.hasAttribute('data-file')) { const files = el.files ? [...el.files] : []; el.value = ''; addFiles(files); return; }
    if (el.dataset.pick) { pick(el); return; }
    if (el.hasAttribute('data-allpick')) {
      if (!st.res) return;
      for (const t of st.res.trades) if (inFilter(t, st.filter) && canPick(t)) { if (el.checked) st.sel.add(t.key); else st.sel.delete(t.key); }
      draw(); return;
    }
    if (el.dataset.basis) { setBasis(el); return; }
    const src = el.dataset.src ? st.sources.find(s => s.id === el.dataset.src) : null;
    if (!src) return;
    if (el.dataset.map) {
      const v = parseInt(el.value, 10);
      src.map = { ...src.map, [el.dataset.map]: isFinite(v) ? v : -1 };
      src.adjusted = true; src.ex = null; st.res = null; draw(); return;
    }
    switch (el.dataset.opt) {
      case 'preset': applyPreset(src, el.value); break;
      case 'venue': src.venue = VENUES.includes(el.value) ? el.value : 'Other'; break;
      case 'market': src.market = el.value === 'perp' ? 'perp' : 'spot'; break;
      case 'tz': src.tz = el.value || 'UTC'; break;
      case 'order': src.order = ORDER_TXT[el.value] ? el.value : 'auto'; break;
      case 'grain': src.grain = el.value === 'closed' ? 'closed' : 'fill'; src.map = guessMap(src.hn, src.grain); src.mapOpen = true; break;
      default: return;
    }
    src.ex = null; st.res = null; draw();
  }
  function onInput(ev) {
    const el = ev.target;
    if (!el || !el.dataset) return;
    if (el.hasAttribute('data-paste')) st.paste = el.value;
    else if (el.dataset.basis) st.basisTxt[el.dataset.basis] = el.value;
  }

  /* ── Page + public API ─────────────────────────────────── */
  if (typeof Pages !== 'undefined') Pages.register('import', {
    title: 'Import trades',
    sub: () => 'Exchange CSV → journal, read on this computer. No exchange login, no API keys.',
    render(el) { root = el; draw(); },
  });
  // On the Import page a file dropped just outside the section would make the browser open it instead
  // (and leave the app). Catch it here — but never inside drawers/modals, which own their drop zones.
  if (typeof document !== 'undefined') {
    const outside = (ev) => typeof Router !== 'undefined' && Router.active === 'import' && hasFiles(ev) && !ev.defaultPrevented
      && !(root && root.contains(ev.target)) && !(ev.target && ev.target.closest && ev.target.closest('.drawer-wrap, .modal-backdrop'));
    document.addEventListener('dragover', (ev) => { if (outside(ev)) ev.preventDefault(); });
    document.addEventListener('drop', (ev) => {
      if (!outside(ev)) return;
      ev.preventDefault();
      if (st.busy || !root) return;
      if (st.step === 3) st.res = null;
      addFiles(ev.dataTransfer.files);
    });
  }
  function open() {
    if (st.step === 4) st = fresh(st.target);
    if (typeof Router !== 'undefined') Router.go('import');
  }
  // Headless run for tests / tools: never touches the wizard or the journal.
  // text: CSV string, or [{ text, name?, preset?, tz?, venue?, market? }] for several files at once.
  function analyzeText(text, o) {
    o = o || {};
    const files = Array.isArray(text) ? text : [{ text, name: o.name, preset: o.preset, tz: o.tz, venue: o.venue, market: o.market }];
    const srcs = [];
    for (const fl of files) {
      const body = String((fl && fl.text) || '');
      const r = makeSource(fl.name || 'test.csv', body.length, body);
      if (r.err) return { error: r.err };
      const src = r.src;
      if (fl.preset) applyPreset(src, fl.preset);
      if (fl.tz) src.tz = fl.tz;
      if (fl.venue) src.venue = fl.venue;
      if (fl.market) src.market = fl.market;
      const miss = missingRequired(src);
      if (miss.length) return { error: 'missing columns: ' + miss.join(', '), preset: src.presetId };
      srcs.push(src);
    }
    const res = analyze(srcs, MODES.includes(o.target) ? o.target : 'live');
    return {
      preset: srcs.map(s => s.presetId).join(','), recon: res.recon, funds: res.funds,
      trades: res.trades.map(t => {
        const s = summ(t);
        return { coin: t.coin, side: t.side, market: t.market, closed: t.closed, status: t.status, flags: [...t.flags], extId: t.extId, funding: t.funding,
          qty: s.qty, avgEntry: s.avgEntry, avgExit: s.avgExit, gross: s.gross, net: s.net, fees: s.fees,
          legs: s.legs.map(l => ({ ...l })) };
      }),
    };
  }
  return {
    open,
    reset() { st = fresh(st.target); if (Router.active === 'import') draw(); },
    batches: () => batches().map(b => ({ id: b.id, mode: b.mode, at: b.at, trades: b.trades, review: b.review, open: b.open, venues: [...b.venues], sources: [...b.srcs] })),
    removeBatch: (id, mode) => removeBatch(id, MODES.includes(mode) ? mode : db.mode, true),
    analyzeText, parseCSV, parseNum, parseTime, normSym,
    presets: () => PRESETS.map(p => ({ id: p.id, name: p.name, venue: p.venue, market: p.market })),
  };
})();
