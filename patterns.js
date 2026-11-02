/* ═══════════════════════════════════════════════════════════
   CryptoJournal — trading pattern library
   Each pattern ships a hand-drawn inline SVG plus plain-English
   "what it signals" and "how to trade it" guidance.
   Exposes a global PATTERNS array consumed by app.js.
   ═══════════════════════════════════════════════════════════ */
const PATTERNS = (() => {
  const UP = '#29E5B0', DOWN = '#FF5C7A', LINE = '#7DD3FC', LVL = '#93A2C6';
  const VBW = 240, VBH = 140;

  function svg(inner) {
    return `<svg viewBox="0 0 ${VBW} ${VBH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
  }
  const poly = (pts, color = LINE, w = 2.5) =>
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const seg = (x1, y1, x2, y2, color = LVL, w = 2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  const dash = (x1, y1, x2, y2, color = LVL) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 4" opacity=".65"/>`;
  const path = (d, color = LINE, w = 2.5) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const aUp = (x, y) =>
    `<path d="M${x} ${y + 15} L${x} ${y}" stroke="${UP}" stroke-width="2.6" stroke-linecap="round"/><path d="M${x - 5.5} ${y + 5.5} L${x} ${y} L${x + 5.5} ${y + 5.5}" fill="none" stroke="${UP}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const aDown = (x, y) =>
    `<path d="M${x} ${y - 15} L${x} ${y}" stroke="${DOWN}" stroke-width="2.6" stroke-linecap="round"/><path d="M${x - 5.5} ${y - 5.5} L${x} ${y} L${x + 5.5} ${y - 5.5}" fill="none" stroke="${DOWN}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  // candle: body from top→bot, wick from hi→lo, up = green
  const candle = (x, top, bot, hi, lo, up) => {
    const w = 13, c = up ? UP : DOWN;
    return `<line x1="${x}" y1="${hi}" x2="${x}" y2="${lo}" stroke="${c}" stroke-width="2"/>` +
      `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${Math.max(2.5, bot - top)}" rx="2" fill="${c}"/>`;
  };
  const candles = (arr) => arr.map(a => candle(...a)).join('');

  // ── RSI-divergence helpers (two-panel: price on top, RSI below) ──
  const AMB = '#FFB84D', RSICOL = '#7FA8E0';
  const txt = (x, y, s) => `<text x="${x}" y="${y}" font-size="9" fill="${LVL}" font-family="Inter, sans-serif" font-weight="700" letter-spacing=".5" opacity=".55">${s}</text>`;
  const dot = (x, y, c = AMB) => `<circle cx="${x}" cy="${y}" r="3.4" fill="${c}"/>`;
  const divg = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${AMB}" stroke-width="2" stroke-dasharray="5 3" stroke-linecap="round"/>` + dot(x1, y1) + dot(x2, y2);
  const guide = (y) => `<line x1="14" y1="${y}" x2="206" y2="${y}" stroke="${LVL}" stroke-width="1" stroke-dasharray="2 5" opacity=".2"/>`;
  const divider = `<line x1="10" y1="81" x2="214" y2="81" stroke="${LVL}" stroke-width="1" opacity=".22"/>`;
  // Generic two-panel diagram: price on top, an oscillator layer below, plus two
  // divergence trendlines (dp = on price, dr = on the oscillator) and an arrow.
  const panelFrame = (priceLayer, oscLayer, oscLabel, dp, dr, arrow, guides = '') => svg(
    guides + divider + txt(15, 17, 'PRICE') + txt(15, 97, oscLabel) +
    priceLayer + oscLayer + divg(...dp) + divg(...dr) + arrow);
  const rsiFrame = (pricePts, rsiPts, dp, dr, arrow) =>
    panelFrame(poly(pricePts, LINE, 2.5), poly(rsiPts, RSICOL, 2.5), 'RSI', dp, dr, arrow, guide(96) + guide(126));
  // MACD histogram bars around a zero line ([x, height]; +up = green, -down = red)
  const macdBars = (bars, zeroY = 110) =>
    `<line x1="14" y1="${zeroY}" x2="206" y2="${zeroY}" stroke="${LVL}" stroke-width="1" opacity=".35"/>` +
    bars.map(([x, h]) => {
      const c = h >= 0 ? UP : DOWN;
      const top = h >= 0 ? zeroY - Math.abs(h) : zeroY;
      return `<rect x="${x - 4}" y="${top}" width="8" height="${Math.max(2, Math.abs(h))}" rx="1.5" fill="${c}" opacity=".8"/>`;
    }).join('');
  // Stochastic: %D (slow, dim) behind %K (fast, bright)
  const stochLines = (kPts, dPts) => poly(dPts, LVL, 2) + poly(kPts, RSICOL, 2.5);

  const P = [
    // ── CHART PATTERNS ────────────────────────────────────
    {
      id: 'head-shoulders', name: 'Head & Shoulders', category: 'Chart', bias: 'bearish',
      svg: svg(dash(40, 94, 192, 94) + poly('12,112 40,66 62,94 96,42 132,94 168,68 192,94 218,120') + aDown(206, 116)),
      summary: 'A peak (head) between two lower peaks (shoulders). Signals a top and a reversal down.',
      detail: 'Forms after an uptrend: a high (left shoulder), a higher high (head), then a lower high (right shoulder). The “neckline” connects the two intervening lows. A close below the neckline confirms the reversal.',
      signals: ['Buying momentum is fading — each rally after the head is weaker.', 'The trend is shifting from up to down.', 'Volume usually shrinks into the head and right shoulder.'],
      trade: ['Enter short on a candle close below the neckline.', 'Stop above the right shoulder.', 'Target = neckline minus the head-to-neckline height.'],
    },
    {
      id: 'inv-head-shoulders', name: 'Inverse Head & Shoulders', category: 'Chart', bias: 'bullish',
      svg: svg(dash(40, 46, 192, 46) + poly('12,28 40,74 62,46 96,98 132,46 168,72 192,46 218,20') + aUp(206, 24)),
      summary: 'An upside-down head & shoulders. Signals a bottom and a reversal up.',
      detail: 'Forms after a downtrend: a low (left shoulder), a lower low (head), then a higher low (right shoulder). A close above the neckline confirms the reversal.',
      signals: ['Selling pressure is exhausting.', 'The trend is shifting from down to up.', 'Volume often rises on the neckline breakout.'],
      trade: ['Enter long on a close above the neckline.', 'Stop below the right shoulder.', 'Target = neckline plus the head-to-neckline height.'],
    },
    {
      id: 'double-top', name: 'Double Top', category: 'Chart', bias: 'bearish',
      svg: svg(dash(40, 34, 168, 34) + dash(70, 82, 204, 82) + poly('12,104 46,34 84,82 124,34 160,82 202,118') + aDown(196, 112)),
      summary: 'Two peaks at about the same level — an “M”. Repeated rejection of resistance signals a top.',
      detail: 'Price rallies to a high, pulls back, then rallies to roughly the same high and fails. The low between the peaks is the neckline; a close below it confirms.',
      signals: ['Price failed twice to break higher.', 'Momentum often diverges lower on the second peak.', 'Break of the middle low confirms the reversal.'],
      trade: ['Short on a close below the middle (neckline) low.', 'Stop above the peaks.', 'Target = neckline minus the pattern height.'],
    },
    {
      id: 'double-bottom', name: 'Double Bottom', category: 'Chart', bias: 'bullish',
      svg: svg(dash(40, 106, 168, 106) + dash(70, 58, 204, 58) + poly('12,36 46,106 84,58 124,106 160,58 202,22') + aUp(196, 28)),
      summary: 'Two lows at about the same level — a “W”. Support holding twice signals a bottom.',
      detail: 'Price falls to a low, bounces, then falls to roughly the same low and holds. The high between the lows is the neckline; a close above it confirms.',
      signals: ['Buyers defended the same level twice.', 'Momentum often diverges higher on the second low.', 'Break above the middle high confirms the reversal.'],
      trade: ['Long on a close above the middle (neckline) high.', 'Stop below the lows.', 'Target = neckline plus the pattern height.'],
    },
    {
      id: 'asc-triangle', name: 'Ascending Triangle', category: 'Chart', bias: 'bullish',
      svg: svg(seg(34, 48, 190, 48) + seg(34, 104, 190, 60) + poly('36,98 62,52 86,74 114,52 140,66 168,52 188,58 210,26') + aUp(204, 32)),
      summary: 'Flat resistance with rising higher-lows. Buyers pressing — usually breaks up.',
      detail: 'A horizontal resistance line caps price while each pullback bottoms higher, forming a rising support line. The coil usually resolves in the trend direction (up).',
      signals: ['Higher lows show demand building into resistance.', 'Repeated tests weaken the ceiling.', 'A breakout typically continues the prior uptrend.'],
      trade: ['Long on a close above the flat resistance.', 'Stop below the last higher-low.', 'Target = triangle height added to the breakout.'],
    },
    {
      id: 'desc-triangle', name: 'Descending Triangle', category: 'Chart', bias: 'bearish',
      svg: svg(seg(34, 94, 190, 94) + seg(34, 48, 190, 90) + poly('36,52 62,90 86,68 114,90 140,78 168,90 188,96 210,120') + aDown(204, 114)),
      summary: 'Flat support with falling lower-highs. Sellers pressing — usually breaks down.',
      detail: 'A horizontal support line holds price while each rally tops lower, forming a falling resistance line. The coil usually resolves in the trend direction (down).',
      signals: ['Lower highs show supply building into support.', 'Support weakens with each test.', 'A breakdown typically continues the prior downtrend.'],
      trade: ['Short on a close below the flat support.', 'Stop above the last lower-high.', 'Target = triangle height below the breakout.'],
    },
    {
      id: 'sym-triangle', name: 'Symmetrical Triangle', category: 'Chart', bias: 'neutral',
      svg: svg(seg(30, 46, 190, 74) + seg(30, 98, 190, 76) + poly('30,96 58,50 86,86 114,58 142,78 170,66 190,74 212,42') + aUp(206, 48)),
      summary: 'Converging highs and lows (a coil). The breakout continues the prior trend.',
      detail: 'Lower highs and higher lows squeeze into an apex as volatility compresses. Neither side is in control until price closes outside the triangle.',
      signals: ['Volatility compresses as the range narrows.', 'Neither buyers nor sellers dominate yet.', 'Direction is only confirmed on the breakout.'],
      trade: ['Trade the breakout direction on a close outside the triangle.', 'Stop on the opposite side of the apex.', 'Target = the widest part of the triangle projected from the breakout.'],
    },
    {
      id: 'bull-flag', name: 'Bull Flag', category: 'Chart', bias: 'bullish',
      svg: svg(dash(54, 34, 132, 52) + dash(72, 56, 132, 74) + poly('16,124 54,32 72,52 94,42 114,62 132,52 214,16') + aUp(204, 22)),
      summary: 'A sharp rally (pole) then a small downward drift (flag). It pauses before continuing up.',
      detail: 'An impulsive advance forms the pole; a shallow, orderly pullback in a small down-channel forms the flag. The prior trend usually resumes on the breakout.',
      signals: ['Strong impulsive move up = the pole.', 'Shallow pullback on lower volume = healthy consolidation.', 'Trend intact; a breakout resumes the advance.'],
      trade: ['Long on a break above the flag’s upper trendline.', 'Stop below the flag.', 'Target = pole height added to the breakout.'],
    },
    {
      id: 'bear-flag', name: 'Bear Flag', category: 'Chart', bias: 'bearish',
      svg: svg(dash(54, 106, 132, 88) + dash(72, 84, 132, 66) + poly('16,16 54,108 72,88 94,98 114,78 132,88 214,124') + aDown(204, 118)),
      summary: 'A sharp drop (pole) then a small upward drift. It pauses before continuing down.',
      detail: 'An impulsive decline forms the pole; a weak counter-trend bounce in a small up-channel forms the flag. The downtrend usually resumes on the breakdown.',
      signals: ['Strong impulsive move down = the pole.', 'Weak bounce on low volume = a pause, not a reversal.', 'Downtrend intact; a breakdown resumes it.'],
      trade: ['Short on a break below the flag’s lower trendline.', 'Stop above the flag.', 'Target = pole height below the breakout.'],
    },
    {
      id: 'falling-wedge', name: 'Falling Wedge', category: 'Chart', bias: 'bullish',
      svg: svg(seg(26, 42, 182, 84) + seg(26, 72, 182, 88) + poly('26,46 52,70 76,52 102,82 122,66 148,84 170,78 182,86 210,44') + aUp(204, 50)),
      summary: 'Two down-sloping converging lines. Selling slows — usually breaks up.',
      detail: 'Both boundaries slope down but the highs fall faster than the lows, so the range narrows. Falling momentum plus a converging range often resolves upward.',
      signals: ['Downward momentum fades as the wedge narrows.', 'Highs and lows converge.', 'A bullish break comes above the upper line.'],
      trade: ['Long on a close above the upper wedge line.', 'Stop below the last low.', 'Target = wedge height added to the breakout.'],
    },
    {
      id: 'rising-wedge', name: 'Rising Wedge', category: 'Chart', bias: 'bearish',
      svg: svg(seg(26, 56, 182, 22) + seg(26, 92, 182, 36) + poly('26,88 52,60 76,74 104,42 126,56 152,32 176,42 190,34 210,96') + aDown(204, 90)),
      summary: 'Two up-sloping converging lines. Buying slows — usually breaks down.',
      detail: 'Both boundaries slope up but the lows rise faster than the highs, so the range narrows. Fading momentum inside a rising wedge often resolves downward.',
      signals: ['Upward momentum fades as the wedge narrows.', 'Rallies get shorter near the top.', 'A bearish break comes below the lower line.'],
      trade: ['Short on a close below the lower wedge line.', 'Stop above the last high.', 'Target = wedge height below the breakout.'],
    },
    {
      id: 'cup-handle', name: 'Cup & Handle', category: 'Chart', bias: 'bullish',
      svg: svg(dash(22, 44, 214, 44) + path('M22,44 C46,116 148,116 170,46') + path('M170,46 C180,58 192,66 198,60') + path('M198,60 L220,26') + aUp(214, 32)),
      summary: 'A rounded “U” base then a small pullback (handle). A bullish continuation base.',
      detail: 'The cup is a smooth, rounded recovery showing accumulation; the handle is a final shallow shakeout near the rim. A breakout above the rim confirms.',
      signals: ['The cup shows accumulation and a smooth recovery.', 'The handle is a last, shallow shakeout.', 'A breakout above the rim confirms.'],
      trade: ['Long on a break above the cup’s rim (the handle high).', 'Stop below the handle.', 'Target = cup depth added to the breakout.'],
    },
    // ── RSI DIVERGENCES (price vs. momentum) ──────────────
    {
      id: 'rsi-bull-div', name: 'Regular Bullish Divergence', category: 'Chart', bias: 'bullish',
      svg: rsiFrame('14,30 66,54 108,40 150,66 206,32', '14,104 66,126 108,112 150,114 206,102',
        [66, 54, 150, 66], [66, 126, 150, 114], aUp(214, 30)),
      summary: 'Price makes a lower low but RSI makes a higher low. Selling momentum is fading — a reversal up.',
      detail: 'In a downtrend, price prints a lower low while the RSI oscillator prints a higher low. The disagreement (“divergence”) shows sellers are losing strength even as price drops — it often precedes a bounce or reversal higher.',
      signals: ['Price: lower low. RSI: higher low.', 'Downside momentum is weakening.', 'Strongest when RSI is turning up from oversold (below 30).'],
      trade: ['Wait for confirmation — a bullish candle or a break of the price down-trendline.', 'Long with a stop below the most recent price low.', 'Target the prior swing high or use your planned R.'],
    },
    {
      id: 'rsi-bear-div', name: 'Regular Bearish Divergence', category: 'Chart', bias: 'bearish',
      svg: rsiFrame('14,58 66,34 108,48 150,24 206,56', '14,118 66,102 108,116 150,110 206,120',
        [66, 34, 150, 24], [66, 102, 150, 110], aDown(214, 58)),
      summary: 'Price makes a higher high but RSI makes a lower high. Buying momentum is fading — a reversal down.',
      detail: 'In an uptrend, price prints a higher high while the RSI prints a lower high. The divergence shows buyers are losing strength even as price climbs — it often precedes a pullback or reversal lower.',
      signals: ['Price: higher high. RSI: lower high.', 'Upside momentum is weakening.', 'Strongest when RSI is turning down from overbought (above 70).'],
      trade: ['Wait for confirmation — a bearish candle or a break of the price up-trendline.', 'Short with a stop above the most recent price high.', 'Target the prior swing low or use your planned R.'],
    },
    {
      id: 'rsi-hidden-bull-div', name: 'Hidden Bullish Divergence', category: 'Chart', bias: 'bullish',
      svg: rsiFrame('14,58 66,52 108,34 150,44 206,20', '14,108 66,112 108,102 150,126 206,110',
        [66, 52, 150, 44], [66, 112, 150, 126], aUp(214, 24)),
      summary: 'In an uptrend, price makes a higher low but RSI makes a lower low. The trend likely continues up.',
      detail: 'A hidden divergence forms on a pullback within an uptrend: price holds a higher low while RSI dips to a lower low. It signals the pullback is temporary and the uptrend is set to resume — a continuation, not a reversal.',
      signals: ['Price: higher low. RSI: lower low.', 'Occurs on a pullback inside an uptrend.', 'A continuation signal, not a reversal.'],
      trade: ['Long in the direction of the trend as price resumes higher.', 'Stop below the higher low.', 'Target the prior high / trend extension or your planned R.'],
    },
    {
      id: 'rsi-hidden-bear-div', name: 'Hidden Bearish Divergence', category: 'Chart', bias: 'bearish',
      svg: rsiFrame('14,22 66,32 108,48 150,40 206,60', '14,120 66,112 108,120 150,100 206,116',
        [66, 32, 150, 40], [66, 112, 150, 100], aDown(214, 58)),
      summary: 'In a downtrend, price makes a lower high but RSI makes a higher high. The trend likely continues down.',
      detail: 'A hidden divergence forms on a bounce within a downtrend: price makes a lower high while RSI pushes to a higher high. It signals the bounce is temporary and the downtrend is set to resume — a continuation, not a reversal.',
      signals: ['Price: lower high. RSI: higher high.', 'Occurs on a bounce inside a downtrend.', 'A continuation signal, not a reversal.'],
      trade: ['Short in the direction of the trend as price rolls over.', 'Stop above the lower high.', 'Target the prior low / trend extension or your planned R.'],
    },
    {
      id: 'macd-bull-div', name: 'MACD Bullish Divergence', category: 'Chart', bias: 'bullish',
      svg: panelFrame(poly('14,30 66,54 108,40 150,66 206,32', LINE, 2.5),
        macdBars([[22, -4], [46, -12], [66, -19], [90, -10], [110, -3], [130, -8], [150, -12], [174, -4], [198, 3]]),
        'MACD', [66, 54, 150, 66], [66, 129, 150, 122], aUp(214, 30)),
      summary: 'Price makes a lower low but the MACD makes a higher low. Downside momentum is drying up.',
      detail: 'As price prints a lower low in a downtrend, the MACD histogram prints a shallower low — momentum fades even as price falls. MACD is slower than RSI, so its divergences are fewer but often more reliable on higher timeframes.',
      signals: ['Price: lower low. MACD: higher low (shallower troughs).', 'Bearish momentum is weakening.', 'Extra weight when the MACD line crosses back above its signal line.'],
      trade: ['Wait for a MACD bullish cross or a break of the price down-trendline.', 'Long with a stop below the recent price low.', 'Target the prior swing high or use your planned R.'],
    },
    {
      id: 'macd-bear-div', name: 'MACD Bearish Divergence', category: 'Chart', bias: 'bearish',
      svg: panelFrame(poly('14,58 66,34 108,48 150,24 206,56', LINE, 2.5),
        macdBars([[22, 4], [46, 12], [66, 19], [90, 10], [110, 3], [130, 8], [150, 12], [174, 4], [198, -3]]),
        'MACD', [66, 34, 150, 24], [66, 91, 150, 98], aDown(214, 58)),
      summary: 'Price makes a higher high but the MACD makes a lower high. Upside momentum is drying up.',
      detail: 'As price prints a higher high in an uptrend, the MACD histogram prints a shorter high — momentum fades even as price rises. Being slower than RSI, MACD gives fewer but often steadier divergence signals.',
      signals: ['Price: higher high. MACD: lower high (shorter peaks).', 'Bullish momentum is weakening.', 'Extra weight when the MACD line crosses back below its signal line.'],
      trade: ['Wait for a MACD bearish cross or a break of the price up-trendline.', 'Short with a stop above the recent price high.', 'Target the prior swing low or use your planned R.'],
    },
    {
      id: 'stoch-bull-div', name: 'Stochastic Bullish Divergence', category: 'Chart', bias: 'bullish',
      svg: panelFrame(poly('14,30 66,54 108,40 150,66 206,32', LINE, 2.5),
        stochLines('14,104 66,124 108,110 150,116 206,100', '14,108 66,120 108,112 150,117 206,104'),
        'STOCH', [66, 54, 150, 66], [66, 124, 150, 116], aUp(214, 30), guide(96) + guide(126)),
      summary: 'Price makes a lower low but the Stochastic makes a higher low — often deep in oversold.',
      detail: 'The Stochastic (%K/%D) tracks where price closes within its recent range. When price prints a lower low but the Stochastic turns up from a higher low in the oversold zone (below 20), buyers are quietly stepping in.',
      signals: ['Price: lower low. Stochastic: higher low.', 'Most reliable when it happens below 20 (oversold).', 'A %K crossing back above %D adds confirmation.'],
      trade: ['Enter long once %K crosses up through %D or price breaks its down-trendline.', 'Stop below the recent price low.', 'Target the prior swing high or use your planned R.'],
    },
    {
      id: 'stoch-bear-div', name: 'Stochastic Bearish Divergence', category: 'Chart', bias: 'bearish',
      svg: panelFrame(poly('14,58 66,34 108,48 150,24 206,56', LINE, 2.5),
        stochLines('14,118 66,100 108,114 150,108 206,120', '14,116 66,104 108,112 150,110 206,116'),
        'STOCH', [66, 34, 150, 24], [66, 100, 150, 108], aDown(214, 58), guide(96) + guide(126)),
      summary: 'Price makes a higher high but the Stochastic makes a lower high — often deep in overbought.',
      detail: 'When price prints a higher high but the Stochastic rolls over from a lower high in the overbought zone (above 80), buying pressure is fading beneath the surface even as price pushes up.',
      signals: ['Price: higher high. Stochastic: lower high.', 'Most reliable when it happens above 80 (overbought).', 'A %K crossing back below %D adds confirmation.'],
      trade: ['Enter short once %K crosses down through %D or price breaks its up-trendline.', 'Stop above the recent price high.', 'Target the prior swing low or use your planned R.'],
    },
    // ── CANDLESTICK PATTERNS ──────────────────────────────
    {
      id: 'hammer', name: 'Hammer', category: 'Candlestick', bias: 'bullish',
      svg: svg(candles([[78, 44, 60, 40, 64, false], [112, 60, 78, 56, 82, false], [150, 78, 90, 75, 124, true]])),
      summary: 'Small body up top with a long lower wick. Buyers rejected lower prices.',
      detail: 'After a downtrend, sellers drive price down intraday but buyers slam it back up to close near the open, leaving a long lower wick and a small body at the top.',
      signals: ['Sellers pushed down but buyers rejected the lows.', 'Appears after a downtrend.', 'The lower wick is at least ~2× the body.'],
      trade: ['Long on confirmation (the next candle closes higher).', 'Stop below the hammer’s low.', 'Target the nearest resistance or use your planned R.'],
    },
    {
      id: 'shooting-star', name: 'Shooting Star', category: 'Candlestick', bias: 'bearish',
      svg: svg(candles([[78, 92, 108, 88, 112, true], [112, 72, 92, 68, 96, true], [150, 60, 72, 34, 75, false]])),
      summary: 'Small body down low with a long upper wick. Buyers rejected higher prices.',
      detail: 'After an uptrend, buyers push price up intraday but sellers reject the high and drive it back down to close near the open, leaving a long upper wick.',
      signals: ['Buyers pushed up but sellers rejected the highs.', 'Appears after an uptrend.', 'The upper wick is at least ~2× the body.'],
      trade: ['Short on confirmation (the next candle closes lower).', 'Stop above the star’s high.', 'Target the nearest support or use your planned R.'],
    },
    {
      id: 'doji', name: 'Doji', category: 'Candlestick', bias: 'neutral',
      svg: svg(candle(70, 66, 82, 60, 88, false) + candle(96, 62, 78, 58, 84, true) +
        seg(140, 38, 140, 106, LINE, 2.4) + seg(120, 72, 160, 72, LINE, 3.2) +
        candle(184, 64, 80, 60, 86, true)),
      summary: 'Open and close nearly equal — a cross. Market indecision and a possible turning point.',
      detail: 'Neither buyers nor sellers finished in control: price closes right where it opened. On its own it means indecision; at the end of a trend it can warn of a reversal.',
      signals: ['Neither side won the session.', 'After a strong trend it warns of a possible reversal.', 'Meaning depends heavily on context and confirmation.'],
      trade: ['Don’t act on the doji alone — wait for the next candle.', 'Trade the direction of the confirming candle.', 'Place the stop beyond the doji’s wick range.'],
    },
    {
      id: 'bull-engulfing', name: 'Bullish Engulfing', category: 'Candlestick', bias: 'bullish',
      svg: svg(candles([[74, 50, 70, 46, 74, false], [104, 58, 76, 54, 80, false], [134, 46, 84, 42, 88, true]])),
      summary: 'A large green candle fully engulfs the prior red candle. Momentum flips up.',
      detail: 'A small red candle is followed by a green candle whose body completely covers it. Buyers overwhelmed the previous session — strongest after a downtrend.',
      signals: ['Buyers overwhelmed the prior session’s sellers.', 'Strongest after a downtrend.', 'The green body fully covers the prior red body.'],
      trade: ['Long at the engulfing candle’s close or the next open.', 'Stop below the pattern’s low.', 'Target resistance or your planned R.'],
    },
    {
      id: 'bear-engulfing', name: 'Bearish Engulfing', category: 'Candlestick', bias: 'bearish',
      svg: svg(candles([[74, 64, 88, 60, 92, true], [104, 64, 84, 60, 88, true], [134, 56, 94, 52, 98, false]])),
      summary: 'A large red candle fully engulfs the prior green candle. Momentum flips down.',
      detail: 'A small green candle is followed by a red candle whose body completely covers it. Sellers overwhelmed the previous session — strongest after an uptrend.',
      signals: ['Sellers overwhelmed the prior session’s buyers.', 'Strongest after an uptrend.', 'The red body fully covers the prior green body.'],
      trade: ['Short at the engulfing candle’s close or the next open.', 'Stop above the pattern’s high.', 'Target support or your planned R.'],
    },
    {
      id: 'morning-star', name: 'Morning Star', category: 'Candlestick', bias: 'bullish',
      svg: svg(candles([[70, 40, 84, 36, 88, false], [108, 94, 104, 90, 108, true], [146, 46, 88, 42, 92, true]])),
      summary: 'Big red, a small indecision candle, then big green. A three-candle bottom.',
      detail: 'Selling (red) gives way to a pause (a small “star” that gaps down), then buyers take over with a strong green candle that closes well into the first body.',
      signals: ['Selling, then a pause (star), then buyers take over.', 'The middle candle gaps down and stalls.', 'The third candle closes well into the first red body.'],
      trade: ['Long after the third (green) candle closes.', 'Stop below the star’s low.', 'Target the nearest resistance or your planned R.'],
    },
    {
      id: 'evening-star', name: 'Evening Star', category: 'Candlestick', bias: 'bearish',
      svg: svg(candles([[70, 42, 84, 38, 88, true], [108, 32, 40, 28, 44, false], [146, 44, 86, 40, 90, false]])),
      summary: 'Big green, a small indecision candle, then big red. A three-candle top.',
      detail: 'Buying (green) gives way to a pause (a small “star” that gaps up), then sellers take over with a strong red candle that closes well into the first body.',
      signals: ['Buying, then a pause (star), then sellers take over.', 'The middle candle gaps up and stalls.', 'The third candle closes well into the first green body.'],
      trade: ['Short after the third (red) candle closes.', 'Stop above the star’s high.', 'Target the nearest support or your planned R.'],
    },
    {
      id: 'three-soldiers', name: 'Three White Soldiers', category: 'Candlestick', bias: 'bullish',
      svg: svg(candles([[72, 84, 106, 80, 110, true], [112, 64, 90, 60, 94, true], [152, 44, 74, 40, 78, true]])),
      summary: 'Three strong rising green candles. A decisive shift to buyers.',
      detail: 'Three consecutive green candles, each opening within the prior body and closing near its high with small upper wicks — a strong reversal signal after a downtrend.',
      signals: ['Each candle opens within the prior body and closes near its high.', 'Small upper wicks show sustained buying.', 'Confirms a bottom after a downtrend.'],
      trade: ['Long on strength, ideally on a minor pullback.', 'Stop below the first soldier.', 'Watch for exhaustion after an extended run.'],
    },
    {
      id: 'three-crows', name: 'Three Black Crows', category: 'Candlestick', bias: 'bearish',
      svg: svg(candles([[72, 42, 64, 38, 68, false], [112, 62, 88, 58, 92, false], [152, 84, 110, 80, 114, false]])),
      summary: 'Three strong falling red candles. A decisive shift to sellers.',
      detail: 'Three consecutive red candles, each opening within the prior body and closing near its low with small lower wicks — a strong reversal signal after an uptrend.',
      signals: ['Each candle opens within the prior body and closes near its low.', 'Small lower wicks show sustained selling.', 'Confirms a top after an uptrend.'],
      trade: ['Short on weakness, ideally on a minor bounce.', 'Stop above the first crow.', 'Watch for exhaustion after an extended drop.'],
    },
  ];
  return P;
})();
