/* ═══════════════════════════════════════════════════════════
   CryptoJournal — Learn page + metric Glossary
   Owns the 'patterns' page (tabs: Chart patterns · Metrics guide ·
   Crypto basics) and the global Glossary that tipFor() and every
   KPI info popover read. Definitions follow the research notes and
   the real formulas in metrics.js / engine.js: R is net, samples
   are gated, p-values are worded honestly, Kelly is never sizing.
   The only file allowed two globals: Glossary and Learn.
   ═══════════════════════════════════════════════════════════ */

/* ── Glossary ──────────────────────────────────────────────
   { key: { group, title, plain (1–2 beginner sentences), formula, good, caveat, min?, see?:[page, tab] } }
   tipFor(key) shows `plain + ' Good: ' + good`, so `good` reads as the end of that sentence. */
const Glossary = (() => {
  const G = {
    /* ── Results basics ── */
    rMultiple: {
      group: 'basics', title: 'R-multiple (R)',
      plain: 'R measures a result in units of what you risked. Risk $100 and make $250 after costs and the trade is +2.5R; a full stop-out is about −1R.',
      formula: 'R = net P/L ÷ initial $ risk\ninitial $ risk = units × |entry − stop|  (summed over every portion of the trade)',
      good: 'losses that stay near −1R and winners that are a multiple of it.',
      caveat: 'R in this app is net — fees, funding and gas are subtracted. A trade without a stop has no R (shown as “—”) and is counted as “no stop” instead of being guessed.',
      see: ['trades'],
    },
    riskPct: {
      group: 'basics', title: 'Risk per trade (%)',
      plain: 'The share of your account you lose if the stop is hit. Beginners usually keep it between 0.5% and 1%.',
      formula: '$ risk (1R) = units × |entry − stop|\nrisk % = $ risk ÷ balance before the trade\nunits = (balance × risk %) ÷ |entry − stop|',
      good: '1% or less per trade (your limit lives in Settings → Risk); the live ramp starts lower.',
      caveat: 'Leverage does not change this number when the size comes from the stop — it only changes the margin you post and how close liquidation is.',
      see: ['calc'],
    },
    netPL: {
      group: 'basics', title: 'Net P/L',
      plain: 'What you actually made or lost after every cost. It is the amount your balance moves by.',
      formula: 'net P/L = (exit − entry) × units × (+1 long / −1 short) − fees − funding − gas',
      good: 'positive over a meaningful sample — read it together with expectancy and its likely range.',
      caveat: 'Only closed trades count (realised P/L). Paper fills ignore slippage, so paper net P/L is optimistic — see the after-cost haircut.',
    },
    expectancy: {
      group: 'basics', title: 'Expectancy ($)', min: '20 trades',
      plain: 'The average dollar result per closed trade — what one more trade is worth on average.',
      formula: 'E$ = Σ net P/L of closed trades ÷ number of closed trades\n   = win rate × avg win − loss rate × |avg loss|',
      good: 'above zero after costs, and still above zero when you remove your single best trade.',
      caveat: 'Dollar expectancy moves when your account size or risk changes, so expectancy in R is better for comparing periods or paper with live.',
    },
    expR: {
      group: 'basics', title: 'Expectancy (R)', min: '20 trades', see: ['analytics', 'overview'],
      plain: 'Your average net R per trade. +0.3R means each trade earns, on average, 30% of what you risked on it.',
      formula: 'E_R = mean(net R) over closed trades with a stop\nlikely range (95%) = E_R ± t(n − 1) × sd(R) ÷ √n',
      good: '≤ 0 no edge · 0 to +0.2R thin (costs can erase it) · +0.2 to +0.5R solid · above +0.5R strong — or a small-sample fluke.',
      caveat: 'Says little below 20 trades and its range needs 30+. If the range includes 0R the result is still “consistent with no edge”.',
    },
    winRate: {
      group: 'basics', title: 'Win rate', min: '20 trades', see: ['analytics', 'overview'],
      plain: 'The share of closed trades that made money after costs. On its own it means little — it has to beat your breakeven win rate.',
      formula: 'win rate p = wins ÷ closed trades  (breakevens count as non-wins)\nWilson 95% range, z = 1.96:\n  centre = (p + z²/2n) ÷ (1 + z²/n)\n  half-width = z ÷ (1 + z²/n) × √(p(1 − p)/n + z²/4n²)',
      good: 'the low end of the Wilson range above your breakeven win rate. 12 wins in 20 trades (60%) could really be anywhere from 39% to 78%.',
      caveat: 'Wins and losses are judged on net P/L. If you set a scratch band, tiny results count as breakeven instead.',
    },
    beWinRate: {
      group: 'basics', title: 'Breakeven win rate',
      plain: 'The win rate you need just to break even, given how big your wins are compared with your losses.',
      formula: 'breakeven win rate = 1 ÷ (1 + payoff ratio)\nwith costs: (1 + c) ÷ (planned R:R + 1), c = cost per trade in R',
      good: 'your real win rate (its low end) comfortably above it. A 2:1 payoff breaks even at 33%; 1:1 needs 50%.',
      caveat: 'Built from average win and loss, so it moves around a lot until you have 30+ trades.',
    },
    payoff: {
      group: 'basics', title: 'Payoff ratio',
      plain: 'How big your average winner is compared with your average loser.',
      formula: 'payoff = average winning R ÷ |average losing R|  ($ when R is missing)\nprofit factor = payoff ($) × number of wins ÷ number of losses',
      good: 'above 1.5 with a win rate around 40–50%.',
      caveat: 'A few huge winners inflate it. A high payoff with a low win rate also means long losing streaks — check the streak card.',
    },
    profitFactor: {
      group: 'basics', title: 'Profit factor', min: '20 trades & 5 losses', see: ['analytics', 'overview'],
      plain: 'Dollars won for every dollar lost. 1.5 means your winners brought in $1.50 for each $1 your losers cost.',
      formula: 'PF = Σ net P/L of winners ÷ |Σ net P/L of losers|',
      good: 'below 1 losing · 1.0–1.3 marginal · 1.5–2 good · above 2 very good. Above 3 on a small sample usually just means too few losses so far.',
      caveat: 'Shown as “n/a” while there are no losses. Unreliable below 20 trades or 5 losses, and it ignores the order of trades, so it says nothing about drawdown.',
    },
    scratch: {
      group: 'basics', title: 'Breakeven (scratch) band', see: ['settings', 'risk'],
      plain: 'An optional rule that counts tiny results — for example within ±0.1R — as breakeven, so a fee-sized loss is not counted as a real loss.',
      formula: 'if |net R| < band → breakeven (neither a win nor a loss)',
      good: 'off (0) or a small band such as 0.05–0.1R, kept fixed so periods stay comparable.',
      caveat: 'It only changes the win / loss / breakeven labels and the win rate. P/L and R are never altered.',
    },
    sample: {
      group: 'basics', title: 'Sample-size badge',
      plain: 'Every headline number carries an n badge: how many trades it is based on. Fewer trades means more luck inside the number.',
      formula: 'n < 20 Insufficient · 20–49 Early · 50–99 Developing · 100+ Meaningful\nuncertainty shrinks with √n — 4× the trades halves the range',
      good: '100+ trades before trusting a number and 50+ before acting on it.',
      caveat: 'The tiers are rules of thumb, not a statistical test. Breakdown rows (by coin, session, tag…) need 10+ trades each; heat-map cells need 3+.',
    },

    /* ── Is the edge real? ── */
    ci: {
      group: 'edge', title: 'Likely range (95% confidence interval)', min: '30 trades', see: ['analytics', 'overview'],
      plain: 'The range your true average R probably sits in, given the trades so far. The narrower it is, the more you can trust the average.',
      formula: 't-interval: E_R ± t(n − 1) × sd(R) ÷ √n\nbootstrap: resample your R values 2,000 times; the middle 95% of the averages',
      good: 'the low end above 0R. If the range straddles 0R, the honest wording is “consistent with no edge” — not “no edge” and not “edge”.',
      caveat: 'Assumes trades are independent. Crypto R is fat-tailed, so the app also shows a bootstrap range that needs no normality assumption.',
    },
    tStat: {
      group: 'edge', title: 't-statistic & p-value', min: '30 trades', see: ['analytics', 'advanced'],
      plain: 'How many standard errors your average R sits above zero. Around 2 or more is decent evidence that your true average is above zero.',
      formula: 't = E_R ÷ (sd(R) ÷ √n)\none-tailed p = 1 − T_cdf(t; n − 1)   (test: mean net R > 0)',
      good: 't ≥ 2 evidence · 1 to 2 suggestive · below 1 noise. p below 0.05 is the usual bar.',
      caveat: 'A p-value is NOT the probability that your edge is random. It is how surprising your results would be if the true edge were zero. It also assumes independent, roughly normal R values, which crypto bends.',
    },
    tradesNeeded: {
      group: 'edge', title: 'Trades still needed',
      plain: 'A rough count of how many more trades — at your current average and spread — it would take for the edge to reach t = 2.',
      formula: 'needed = (2 × sd(R) ÷ E_R)² − trades so far',
      good: 'a number that shrinks as you log trades. If it keeps growing, your average is falling.',
      caveat: 'Only shown while your average R is positive, and it assumes future trades look like past ones.',
    },
    sqn: {
      group: 'edge', title: 'SQN (System Quality Number)', min: '30 trades', see: ['analytics', 'advanced'],
      plain: 'Van Tharp’s score for how steady your R results are: average R relative to its spread, scaled by the number of trades (capped at 100).',
      formula: 'SQN = √min(n, 100) × mean(R) ÷ sd(R)',
      good: 'below 1.6 poor · 1.6–2 below average · 2–2.5 average · 2.5–3 good · 3–5 excellent · 5–7 superb · 7+ suspiciously high — check for errors.',
      caveat: 'It is the t-statistic in disguise, so it rises with trade count alone — hence the 100 cap. Unreliable below 30 trades; only trades with a stop count.',
    },
    medianR: {
      group: 'edge', title: 'Median R',
      plain: 'The middle trade result. If the average is positive but the median is negative, your profit depends on a few big winners.',
      formula: 'median of net R over closed trades with a stop',
      good: 'reasonably close to the average R — or a negative median you expect because you trade for rare big winners.',
      caveat: 'It ignores how big the big winners are, so always read it next to the average.',
    },
    fragility: {
      group: 'edge', title: 'Fragility (drop your best trades)',
      plain: 'Your average R without your single best trade (and best 2 or 3). It shows whether the whole edge rests on one lucky trade.',
      formula: 'E_R without the top k trades, k = 1, 2, 3\ntop-3 share = P/L of your 3 best winners ÷ total net P/L',
      good: 'expectancy still above zero after dropping the best trade, and a top-3 share well under 100%.',
      caveat: 'A stress test, not a strategy: excluding trades from your real results is hindsight.',
    },
    rolling: {
      group: 'edge', title: 'Rolling expectancy', see: ['analytics', 'overview'],
      plain: 'Your average R over the last 20 trades, recalculated after every trade. It shows whether the edge is steady, improving or fading.',
      formula: 'rolling E_R(i) = mean(net R of trades i − 19 … i)',
      good: 'mostly above 0R. Warning sign: 10 windows in a row below zero while your lifetime average is positive.',
      caveat: 'Short windows are noisy by nature — a dip is normal, a long slide is information.',
    },
    kelly: {
      group: 'edge', title: 'Kelly % (edge strength only)', min: '200 trades', see: ['analytics', 'advanced'],
      plain: 'A textbook formula that turns win rate and payoff into one “edge strength” number. Here it is an indicator only — never a position-size suggestion.',
      formula: 'Kelly = W − (1 − W) ÷ payoff\npessimistic Kelly plugs in the low end of the Wilson win-rate range',
      good: 'above 0 means a positive edge — keep risking 0.5–1% per trade regardless.',
      caveat: 'Extremely sensitive to estimation error, and full-Kelly sizing is far too aggressive for anyone still learning. Hidden until you have 200+ trades.',
    },

    /* ── Risk & drawdown ── */
    maxDD: {
      group: 'risk', title: 'Max drawdown', see: ['analytics', 'risk'],
      plain: 'The biggest drop from a previous high in your trading results, in %. It is the pain you have already lived through.',
      formula: 'flow-neutral index: idx = idx_prev × (1 + net P/L ÷ balance before the trade)\ndrawdown = idx ÷ running peak − 1;  max DD = its lowest value',
      good: 'at 0.5–1% risk per trade: under 10% healthy · 10–20% caution · over 20% means risk or discipline is off.',
      caveat: 'Deposits and withdrawals are excluded, so they never look like gains or losses. Closed trades only — an open loss is not counted until it closes.',
    },
    currentDD: {
      group: 'risk', title: 'Current drawdown', see: ['analytics', 'risk'],
      plain: 'How far below your best point you are right now. 0% means you are at a new high.',
      formula: 'current DD = latest idx ÷ highest idx so far − 1',
      good: 'small and recovering; a drawdown deeper than your previous max deserves a review.',
      caveat: 'Realised results only — open positions are not marked to market here.',
    },
    timeUnderwater: {
      group: 'risk', title: 'Time underwater',
      plain: 'The share of calendar days you spent below a previous high. Long stretches underwater are harder to sit through than one sharp dip.',
      formula: 'days with drawdown < 0 ÷ all calendar days since your first closed trade',
      good: 'under about half the time, with new highs every few weeks.',
      caveat: 'Crypto trades 365 days a year, so idle days count too.',
    },
    recovery: {
      group: 'risk', title: 'Recovery factor',
      plain: 'Net profit divided by your worst drawdown in dollars — how many times over you have earned back your deepest hole.',
      formula: 'recovery factor = total net P/L ÷ |max drawdown $|',
      good: 'above 3.5 excellent · 2–3.5 decent · 1–2 weak · below 1 poor (vendor bands — opinion).',
      caveat: 'It grows naturally with time and trade count, so compare similar periods.',
    },
    retToDD: {
      group: 'risk', title: 'Return ÷ max drawdown', min: '180 days for CAGR / MAR',
      plain: 'Total return divided by the worst drawdown: how much return you earn per unit of pain, without annualising a short history.',
      formula: 'return / DD = total return % ÷ |max DD %|\nafter 180+ days: CAGR = idx^(365 ÷ days) − 1, MAR = CAGR ÷ |max DD %|',
      good: 'above 1 decent · above 2 strong · above 3 exceptional (convention).',
      caveat: 'Annualised figures (CAGR, MAR) stay hidden until 180 days — annualising a few weeks of crypto produces absurd numbers.',
    },
    sharpe: {
      group: 'risk', title: 'Sharpe ratio', min: '30 days (90+ preferred)', see: ['analytics', 'advanced'],
      plain: 'Average daily return divided by how much daily returns swing, scaled to a year. Higher means smoother returns for the risk taken.',
      formula: 'daily r = P/L closed that day ÷ equity at the start of the day  (every calendar day, zeros included)\nSharpe = mean(r) ÷ sd(r) × √365\nstandard error ≈ √((1 + SR_d² ÷ 2) ÷ days) × √365   (Lo 2002)',
      good: 'annualised: below 0 losing · 0–1 subpar · 1–2 good · 2–3 very good · above 3 suspicious unless the history is long.',
      caveat: 'Always read it with ± its standard error: after 90 days a Sharpe near 2 has an SE of about 2, which is noise. It uses √365 because crypto never closes — about 20% higher than stock-market √252 figures.',
    },
    sortino: {
      group: 'risk', title: 'Sortino ratio', min: '30 days', see: ['analytics', 'advanced'],
      plain: 'Like Sharpe, but only downside swings count against you — big up days are not punished.',
      formula: 'downside deviation = √(Σ min(0, r)² ÷ all N days)\nSortino = mean(r) ÷ downside deviation × √365',
      good: 'read on the same scale as Sharpe; usually higher than Sharpe for systems with big winners.',
      caveat: 'Divides by all days, not just losing days (a common mistake that inflates it). Same small-sample caveats as Sharpe.',
    },
    ulcer: {
      group: 'risk', title: 'Ulcer index', min: '90 days', see: ['analytics', 'advanced'],
      plain: 'A drawdown score that punishes both how deep and how long you were below a high. Lower is better.',
      formula: 'UI = √(mean over days of (100 × drawdown)²)',
      good: 'low single digits; compare your own periods rather than chasing an absolute target.',
      caveat: 'Sensitive to the look-back window and needs 90+ days of history.',
    },
    monteCarlo: {
      group: 'risk', title: 'Monte Carlo simulation', min: '50 trades', see: ['analytics', 'risk'],
      plain: 'Reshuffles your own trade results thousands of times to show a range of possible futures — how deep a drawdown or how long a losing streak is plausible.',
      formula: '5,000 paths × 100 trades: each step draws one of your past net R values,\n  equity ×= 1 + risk % × R\nreports 5th / 50th / 95th percentiles, P(drawdown ≥ 10 / 20 / 30 / 50%),\n  95th-percentile losing streak · stress mode adds a −3R gap trade to the pool',
      good: 'a 95th-percentile drawdown you could live with (20% or less at your planned risk) and a small chance of ending below the start.',
      caveat: 'A range, not a prediction. It can never produce a loss worse than ones you already had (hence the stress option), assumes the future resembles the past and ignores streaky market regimes. Hidden below 50 trades.',
    },
    streak: {
      group: 'risk', title: 'Losing streaks', see: ['analytics', 'risk'],
      plain: 'Runs of losses are normal maths, not proof that your system broke. The app shows how long a streak to expect for your win rate.',
      formula: 'expected longest losing run ≈ ln(n × (1 − q)) ÷ ln(1 ÷ q),  q = loss rate\nexact chance of a run ≥ k in N trades: dynamic programme over the current run length',
      good: 'a current streak at or below the expected length — normal variance, stick to the plan. Much longer: review setups and cut size. At a 45% win rate, 6–8 losses in a row over 100 trades is normal.',
      caveat: 'Assumes independent trades. Real losses cluster (tilt, market regimes), so actual streaks run a little longer than the model.',
    },
    openRisk: {
      group: 'risk', title: 'Open risk (heat)', see: ['dash'],
      plain: 'The total you would lose if every open position hit its stop at once, as a % of your balance.',
      formula: 'heat = Σ units × |entry − stop| over open positions ÷ balance',
      good: '3% or less in total (Settings → Risk). Any open position without a stop means unlimited risk.',
      caveat: 'Uses your planned stops, not live prices; gaps and slippage can make the real loss larger.',
    },
    cluster: {
      group: 'risk', title: 'Correlated exposure (clusters)',
      plain: 'Coins that move together are really one bet. BTC, ETH and SOL longs tend to fall together; PLS, PLSX and HEX move almost in lockstep.',
      formula: 'cluster heat = Σ $ risk of open positions in one cluster ÷ balance\nclusters: BTC / ETH / SOL (+ BNB, XRP) · PulseChain (PLS, PLSX, HEX, INC…) · everything else',
      good: '2% or less of the account per cluster.',
      caveat: 'Correlations rise in sell-offs — exactly when it matters most.',
    },
    dailyLoss: {
      group: 'risk', title: 'Daily & weekly loss limits', see: ['settings', 'risk'],
      plain: 'Circuit breakers: once you are down a set % for the day (or week), you stop. Losses push people into bigger, worse trades.',
      formula: 'day % = net P/L closed since the day reset ÷ balance at the start of the day\nstop when day % ≤ −daily limit (default 3%); weekly default 6%',
      good: 'limits you never need to override — every override is logged and counts against adherence.',
      caveat: 'Crypto never closes, so the “day” starts at your reset hour (Settings → Risk).',
    },
    cooldown: {
      group: 'risk', title: 'Cooldown & losses in a row', see: ['settings', 'risk'],
      plain: 'A pause after any loss (default 30 minutes) and a stop after a few losses in a row (default 3). Quick re-entries after a loss are usually revenge trades.',
      formula: 'cooldown active while now − last losing exit < cooldown minutes\nstop for the day when losses in a row today ≥ your limit',
      good: 'zero trades opened inside the cooldown.',
      caveat: 'Soft limits: the app interrupts and asks for a reason, but it cannot stop you trading on the exchange.',
    },

    /* ── Execution & efficiency ── */
    mae: {
      group: 'execution', title: 'MAE (max adverse excursion)', see: ['analytics', 'efficiency'],
      plain: 'How far a trade went against you before it closed, in R. It shows whether your stops are too tight or too loose.',
      formula: 'long:  MAE = (entry − lowest price during the trade) ÷ |entry − stop|\nshort: MAE = (highest price − entry) ÷ |entry − stop|',
      good: 'most winners with a small MAE (under about 0.6R). If many winners dip to −0.9R first, entries are early or the stop is too tight.',
      caveat: 'Needs the high and low during the trade (typed in, or from candles). Coarse candles (4-hour, daily) misstate the extremes of short trades.',
    },
    mfe: {
      group: 'execution', title: 'MFE (max favourable excursion)', see: ['analytics', 'efficiency'],
      plain: 'The best open profit a trade reached, in R. Compared with where you exited, it shows profit left on the table.',
      formula: 'long:  MFE = (highest price during the trade − entry) ÷ |entry − stop|\nshort: MFE = (entry − lowest price) ÷ |entry − stop|',
      good: 'average MFE bigger than average MAE; losers that rarely went far your way mean entries need work.',
      caveat: 'Same data needs as MAE — and it is hindsight: nobody knows the top in real time.',
    },
    exitEff: {
      group: 'execution', title: 'Exit efficiency', see: ['analytics', 'efficiency'],
      plain: 'On winning trades, the share of the best available move you actually kept.',
      formula: 'exit efficiency = (exit − entry) ÷ (best price − entry)   winners only, mirrored for shorts',
      good: '50% or more of the best move on winners. Below 50% usually means exiting too early — often fear (Tradervue’s rule of thumb).',
      caveat: 'Needs the high and low during the trade. 100% is impossible in practice — it would mean selling the exact top.',
    },
    entryEff: {
      group: 'execution', title: 'Entry efficiency', see: ['analytics', 'efficiency'],
      plain: 'Where your entry sat inside the trade’s full high-to-low range. High values mean you entered near the best price.',
      formula: 'long: (high − entry) ÷ (high − low)   (mirrored for shorts)\ntotal efficiency = (exit − entry) ÷ (high − low)',
      good: 'above 50% on average.',
      caveat: 'Needs the high and low during the trade and is very sensitive to candle resolution.',
    },
    captureRatio: {
      group: 'execution', title: 'Capture ratio (winners vs plan)',
      plain: 'On winning trades, how much of your planned reward you actually took.',
      formula: 'capture = mean(net R of winners) ÷ mean(planned R:R of winners)',
      good: '0.8 or more; below 0.6 usually means cutting winners early.',
      caveat: 'Only trades with a target price (a planned R:R) count.',
    },
    disposition: {
      group: 'execution', title: 'Disposition ratio', see: ['analytics', 'process'],
      plain: 'How long you hold losers compared with winners. Holding losers longer, hoping they come back, is the classic beginner pattern.',
      formula: 'disposition = median hold time of losers ÷ median hold time of winners',
      good: '1.0 or less — you cut losers at least as fast as winners. Above 1.5 is a red flag.',
      caveat: 'Needs 10+ winners and 10+ losers; mixing scalps and multi-day swings distorts it.',
    },
    stopViolation: {
      group: 'execution', title: 'Stop violations', see: ['analytics', 'process'],
      plain: 'The share of losing trades that lost noticeably more than planned — the stop was moved, ignored or slipped.',
      formula: 'stop violations = losers with net R < −1.1 ÷ losers with a stop',
      good: 'under 10% · 10–25% needs work · above 25% is a red flag.',
      caveat: 'On thin PulseChain pools slippage alone can push a loss past −1.1R, so check by coin before calling it a discipline problem.',
    },
    costDrag: {
      group: 'execution', title: 'Cost drag', see: ['analytics', 'risk'],
      plain: 'How much of your gross profit is eaten by fees, funding and gas.',
      formula: 'cost drag = (fees + funding + gas) ÷ gross profit of winning trades',
      good: 'under about 20%. If costs take half your gross profit, use maker orders, wider stops or fewer trades.',
      caveat: 'Paper trades often have no recorded fees — turn on fee auto-fill in Settings → Costs.',
    },

    /* ── Discipline & process ── */
    adherence: {
      group: 'process', title: 'Rule adherence', see: ['analytics', 'process'],
      plain: 'The share of trades where you followed every rule: stop set, risk within your limit, strategy chosen, loss within the stop, no mistakes tagged and no guardrail overrides.',
      formula: 'adherence = clean trades ÷ closed trades   (shown for your last 30)\nflagged if: no stop · risk > 1.1 × limit · loss below −1.2R · no strategy · any mistake tag · an override',
      good: '90%+ excellent · 75–89% needs work · below 75%: back to paper or half size.',
      caveat: 'Honest mistake tagging makes this number worse before it makes you better — that is the point.',
    },
    tiltmeter: {
      group: 'process', title: 'Tiltmeter', see: ['analytics', 'process'],
      plain: 'A rolling 0–100 discipline gauge over your last 10 trades. It drops fast when rules start slipping.',
      formula: 'per trade: 100 × (0.5 × checklist rules met + 0.3 × [no mistakes] + 0.2 × [no override])\ntiltmeter = average of your last 10 trades',
      good: '80+ disciplined · 60–79 slipping · below 60 on tilt — finish the current trade and review before the next one.',
      caveat: 'The weights are a transparent heuristic, not a vendor formula. Without a checklist, your 1–5 star rating stands in for “rules met”.',
    },
    grade: {
      group: 'process', title: 'Process grade (A / B / C)', see: ['analytics', 'process'],
      plain: 'A grade for how well you followed your plan — kept separate from whether the trade made money.',
      formula: 'A = every checklist rule met, no mistakes, stop set, risk within plan\nB = 75%+ of rules met and at most one minor mistake (early exit, late entry, missed target)\nC = anything else, or no stop / revenge / oversize / moved stop / no plan',
      good: 'mostly A and B trades, with expectancy ranking A > B > C. A profitable C trade is luck, not skill.',
      caveat: 'The app suggests a grade and you can override it. Grade honestly — it is your own feedback loop.',
    },
    mistakeCost: {
      group: 'process', title: 'Cost of mistakes', see: ['analytics', 'process'],
      plain: 'How much each type of mistake costs you, measured against your clean trades.',
      formula: 'gap = E_R(clean trades) − E_R(trades with this mistake)\ncost (R) = gap × number of those trades;  cost ($) ≈ cost (R) × average $ risk\ntotal = (E_R clean − E_R of trades with any mistake) × their count',
      good: 'clean trades with the best expectancy; the one or two costliest mistakes become next week’s goal.',
      caveat: 'A trade with several mistakes counts under each one, so the per-mistake rows overlap — use the separate total instead of adding them up. Treat a mistake with fewer than 5 tagged trades as a hint, not a verdict.',
    },
    processMatrix: {
      group: 'process', title: 'Process vs outcome', see: ['analytics', 'process'],
      plain: 'Every graded trade lands in one of four boxes: good process + win (deserved), good process + loss (bad break), bad process + win (dumb luck), bad process + loss (poetic justice).',
      formula: 'good process = grade A or B  ·  good outcome = net P/L > 0',
      good: 'most trades in the two good-process boxes. Dumb-luck wins are the dangerous ones — they teach bad habits.',
      caveat: 'Only trades with a grade are counted.',
    },
    checkin: {
      group: 'process', title: 'Readiness check-in (HALT)', see: ['journal'],
      plain: 'A 30-second self-check before you trade: sleep, stress, mood and HALT — are you Hungry, Angry, Lonely or Tired? Tired and tilted traders break rules.',
      formula: 'score = 100 − 15 per HALT flag − poor sleep (1 → 25, 2 → 20, 3 → 8)\n  − low mood (1 → 20, 2 → 15) − high stress (5 → 20, 4 → 12)   (ratings 1–5, kept within 0–100)',
      good: '80+ ready · 60–79 a bit off, A+ setups only · 50–59 below par, half size or paper · below 50 consider sitting out — not trading is a valid position.',
      caveat: 'A self-check heuristic, not a validated trading signal — it only gives advice. Honest answers matter more than a high score.',
    },
    reviewed: {
      group: 'process', title: 'Reviewed trades', see: ['journal'],
      plain: 'A trade counts as reviewed once you tag its mistakes or mark it clean. Unreviewed trades wait in the review queue.',
      formula: 'reviewed % = trades tagged with a mistake or “Clean” ÷ closed trades',
      good: '100%, ideally within a day of closing.',
      caveat: 'Unreviewed trades are left out of the mistake report, so a low review rate hides problems.',
    },
    greenDays: {
      group: 'process', title: 'Green days', see: ['journal'],
      plain: 'The share of your trading days that ended in profit.',
      formula: 'green days % = days with net P/L > 0 ÷ days with at least one closed trade\n(a trading day starts at your reset hour)',
      good: 'above 50% with positive expectancy — a smoother equity curve. A day that loses more than 2× your average losing day is flagged as a possible tilt day.',
      caveat: 'Days without trades are not counted.',
    },
    bestDayShare: {
      group: 'process', title: 'Best-day share', see: ['readiness'],
      plain: 'How much of all your winning-day profit came from your single best day. A high share means results hinge on one lucky day.',
      formula: 'best-day share = best day’s P/L ÷ Σ P/L of all green days',
      good: '50% or less (one of the readiness checks).',
      caveat: 'Small samples push this up almost by default; it settles after about 20 trading days.',
    },

    /* ── Crypto costs & leverage ── */
    fees: {
      group: 'crypto', title: 'Maker / taker fees (cost in R)', see: ['settings', 'costs'],
      plain: 'Exchanges charge less when your order waits on the book (maker, e.g. a resting limit order) than when it fills at once (taker, e.g. market and most stop orders).',
      formula: 'fees $ = units × entry × entry rate + units × exit × exit rate\nfee in R ≈ (entry rate + exit rate) × entry ÷ |entry − stop|',
      good: 'under 0.1R per trade fine · 0.1–0.25R watch it · above 0.25R costs are eating your edge.',
      caveat: 'Presets are editable base-tier defaults — confirm on your own account’s fee page. PulseX’s 0.29% swap fee is already inside the executed price; never add it again.',
    },
    funding: {
      group: 'crypto', title: 'Funding (perpetual futures)',
      plain: 'A payment between longs and shorts on perpetual futures, usually every 8 hours. When the rate is positive, longs pay shorts.',
      formula: 'per settlement: units × mark price × funding rate × (+1 long / −1 short)   (+ = you pay)\ntrade funding = Σ over the settlements while the position was open',
      good: 'negligible on scalps; on multi-day swings above about 0.1R it is worth tagging. The 0.01% per 8h baseline costs ≈ $1 per $10,000 per settlement (≈ 11% a year).',
      caveat: 'Only charged if you hold through the settlement instant (BTC / ETH usually 00:00, 08:00 and 16:00 UTC; some contracts every 1–4h). Your exchange’s transaction log has the exact figure.',
    },
    slippage: {
      group: 'crypto', title: 'Slippage & DEX price impact',
      plain: 'The gap between the price you expected and the price you got. On a DEX your own order moves the pool price — that part is price impact.',
      formula: 'slippage % = (fill − expected) ÷ expected × (+1 buy / −1 sell)\nDEX price impact ≈ trade size ÷ (pool liquidity ÷ 2 + trade size)',
      good: 'impact under 0.5% fine · 0.5–2% caution · above 2% the trade is too big for the pool. A $2,000 buy into a $100k pool ≈ 3.8% impact plus the 0.29% fee — paid again on exit.',
      caveat: 'Pool liquidity changes block to block and is thinner at weekends. Paper fills are perfect, so the haircut adds slippage back.',
    },
    liqPrice: {
      group: 'crypto', title: 'Liquidation price (estimate)', see: ['calc'],
      plain: 'On leveraged futures, the price at which the exchange force-closes your position because your margin has run out. Your stop must trigger long before it.',
      formula: 'isolated margin, one-way mode, tier 1 (Binance / Bybit):\n  long  LP = (Q × EP − WB − cum) ÷ (Q × (1 − MMR))\n  short LP = (Q × EP + WB + cum) ÷ (Q × (1 + MMR))\nWB = Q × EP ÷ leverage (+ extra margin) · simplified long ≈ EP × (1 − 1/L) ÷ (1 − MMR)',
      good: 'liquidation at least 2× as far away as your stop. Example: a 10× BTC long at 100,000 with MMR 0.5% liquidates near 90,452 (a short near 109,453).',
      caveat: 'Always an estimate: exchanges use the mark price, tiered MMR, fees and funding. Cross margin backs the trade with your whole wallet, so its figure is only approximate (≈).',
    },
    mmr: {
      group: 'crypto', title: 'Maintenance margin (MMR)',
      plain: 'The minimum margin the exchange requires to keep a leveraged position open. If your margin falls to it, you are liquidated.',
      formula: 'maintenance margin = notional × MMR − maintenance amount (tier)\ninitial margin = notional ÷ leverage',
      good: 'knowing your coin’s tier: about 0.4–0.5% for BTC / ETH at small size, higher for altcoins.',
      caveat: 'Tier tables differ by exchange, coin and position size, and they change — keep the MMR field editable.',
    },
    leverage: {
      group: 'crypto', title: 'Leverage vs risk', see: ['calc'],
      plain: 'Leverage decides how much margin you post and how close liquidation is — not how much you lose at your stop, as long as you size from the stop.',
      formula: 'margin = notional ÷ leverage\neffective leverage = Σ open notional ÷ account equity\n$ risk = units × |entry − stop|   (no leverage term)',
      good: 'effective leverage under 3× and an exchange leverage setting within your limit (default 5×).',
      caveat: 'High leverage tempts bigger size and moves liquidation inside normal price noise.',
    },
    haircut: {
      group: 'live', title: 'After-cost haircut', see: ['readiness'],
      plain: 'Paper fills are perfect. The haircut subtracts realistic fees and slippage from every paper trade so you see what it might have made live.',
      formula: 'extra cost = notional × 2 × (fee % + slippage % per side) − costs already recorded  (never below 0)\nCEX default 0.10% + 0.05% per side · DEX default 0.29% + 0.50% per side',
      good: 'expectancy still positive after the haircut — one of the go-live gates.',
      caveat: 'The assumptions are editable in Settings → Costs. Thin PulseChain pools can slip far more than the default.',
    },

    /* ── Paper → live ── */
    readiness: {
      group: 'live', title: 'Readiness evidence checklist', see: ['readiness'],
      plain: 'Pass / fail gates and evidence checks built from your paper results — deliberately not a score. Each check shows its own number.',
      formula: 'gates: 30+ paper trades · positive after-cost expectancy · 10 clean days in a row ·\n  adherence ≥ 90% (last 30) · paper max DD < 20% · every strategy written down\nchecks: sample · edge vs luck · size of edge · profit factor · win rate vs breakeven ·\n  simulated drawdown · stop discipline · consistency · time in market',
      good: 'every gate passed and most checks green — then start live at the smallest ramp stage.',
      caveat: 'Passing is permission to start small, not proof of an edge. Live results usually come in below paper.',
    },
    rampStage: {
      group: 'live', title: 'Staged live ramp', see: ['readiness'],
      plain: 'When you go live, risk per trade starts tiny and steps up only once your habits prove they transfer: 0.25% → 0.5% → 0.75% → 1%.',
      formula: 'review every 25 live trades:\n  promote if adherence ≥ 90%, expectancy > 0 (or ≥ half of paper after costs) and drawdown < 5%\n  demote one stage if drawdown ≥ 5% · back to paper if drawdown ≥ 10%',
      good: 'boring, steady promotions. Dropping a stage is the safety net working, not a failure.',
      caveat: 'The ramp caps risk inside this app only — you still have to size the order correctly on the exchange.',
    },
    transfer: {
      group: 'live', title: 'Paper → live transfer ratio', see: ['analytics', 'compare'],
      plain: 'How much of your paper edge survived contact with real money.',
      formula: 'transfer = live expectancy (R) ÷ paper expectancy after costs (R)',
      good: 'about 0.5–0.7 is common and acceptable; near 1 is excellent. Below 0.5, execution, costs or emotions are the gap.',
      caveat: 'Needs 25+ live trades before the ratio means much.',
    },
    welch: {
      group: 'live', title: 'Paper vs live test (Welch)', see: ['analytics', 'compare'],
      plain: 'A statistical check of whether your live average R is genuinely different from your paper average R, or within normal noise.',
      formula: 'Welch’s t = (mean live R − mean paper R) ÷ √(var_live ÷ n_live + var_paper ÷ n_paper)',
      good: 'p well above 0.05 — live is consistent with paper so far.',
      caveat: 'Weak with few live trades: “not significant” does not mean “the same”.',
    },
  };
  // Short aliases other modules may pass to tipFor(); non-enumerable so the guide lists each term once
  const ALIAS = {
    pf: 'profitFactor', dd: 'maxDD', maxDDPct: 'maxDD', currentDDPct: 'currentDD', winCI: 'winRate', wilson: 'winRate',
    payoffR: 'payoff', expectancyR: 'expR', avgR: 'expR', R: 'rMultiple', sharpeSE: 'sharpe', kellyPess: 'kelly',
    exc: 'mae', efficiency: 'exitEff', totalEff: 'entryEff', heat: 'openRisk', liq: 'liqPrice', adh: 'adherence',
    tilt: 'tiltmeter', ramp: 'rampStage', costR: 'fees', feeR: 'fees', maker: 'fees', taker: 'fees', bootCI: 'ci',
    ci95: 'ci', pValue: 'tStat', edge: 'tStat', riskPerTrade: 'riskPct', stopViolationRate: 'stopViolation',
    top3Share: 'fragility', cagr: 'retToDD', mar: 'retToDD', calmar: 'retToDD', mc: 'monteCarlo',
    lossStreak: 'streak', expLongestLossRun: 'streak', greenDayPct: 'greenDays', greenWeekPct: 'greenDays',
    beBandR: 'scratch', conf: 'sample', cleanStreak: 'readiness', mistakes: 'mistakeCost', priceImpact: 'slippage',
    maintenanceMargin: 'mmr', effectiveLeverage: 'leverage', recoveryFactor: 'recovery', underwater: 'timeUnderwater',
    halt: 'checkin', readinessCheckin: 'checkin', totalCostR: 'mistakeCost',
  };
  for (const [a, k] of Object.entries(ALIAS)) if (G[k] && !(a in G)) Object.defineProperty(G, a, { value: G[k], enumerable: false });
  return G;
})();

/* ── Learn page ─────────────────────────────────────────── */
const Learn = (() => {
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const ok = (f, d) => { try { return f(); } catch (e) { return d; } };
  const reduceMotion = () => ok(() => matchMedia('(prefers-reduced-motion: reduce)').matches, false);

  const TABS = [
    { id: 'patterns', label: 'Chart patterns', icon: 'pattern' },
    { id: 'metrics', label: 'Metrics guide', icon: 'stats' },
    { id: 'crypto', label: 'Crypto basics', icon: 'book' },
  ];
  const SUB = {
    patterns: 'Chart patterns, divergences and candlesticks — recognise them live, trade them with a plan.',
    metrics: 'Every number in the app in plain English: what it means, how it is calculated, what good looks like.',
    crypto: 'Short lessons on R, stops, leverage, fees and going live — the crypto-specific ways beginners lose money.',
  };
  const GROUPS = [
    { id: 'basics', label: 'Results basics' },
    { id: 'edge', label: 'Is the edge real?' },
    { id: 'risk', label: 'Risk & drawdown' },
    { id: 'execution', label: 'Execution' },
    { id: 'process', label: 'Discipline' },
    { id: 'crypto', label: 'Crypto costs' },
    { id: 'live', label: 'Paper → live' },
  ];
  const groupLabel = (id) => (GROUPS.find(g => g.id === id) || { label: '' }).label;
  const PF = [
    { id: 'all', label: 'All' }, { id: 'Chart', label: 'Chart patterns' }, { id: 'div', label: 'Divergences' },
    { id: 'Candlestick', label: 'Candlesticks' }, { id: 'bullish', label: '▲ Bullish' }, { id: 'bearish', label: '▼ Bearish' }, { id: 'neutral', label: '● Neutral' },
  ];

  /* ── Transient UI state (survives re-renders; tab mirrored to localStorage) ── */
  let tab = lsGet('cj.learnTab', 'patterns');
  let pf = 'all', pq = '';            // pattern filter / search
  let mg = 'all', mq = '';            // metrics group / search
  let pending = null;                 // deep link { tab, key } consumed after the next render
  let focusTab = false, hlTimer = null;
  // guarded as a whole: a hand-edited / non-array value must never break the page at load
  const read = new Set(ok(() => { const a = JSON.parse(lsGet('cj.learnRead', '[]')); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }, []));
  const rs = { acct: null, risk: null, entry: 100000, stop: 98000 };   // R & sizing lesson inputs
  const dx = { size: 2000, liq: 100000 };                               // DEX impact lesson inputs

  const patterns = () => (typeof PATTERNS !== 'undefined' && Array.isArray(PATTERNS) ? PATTERNS : []);
  const termKeys = () => Object.keys(Glossary);
  // Resolve aliases (non-enumerable) to the key the guide renders
  function canonical(key) {
    if (!key || !Glossary[key]) return null;
    if (Object.prototype.propertyIsEnumerable.call(Glossary, key)) return key;
    return termKeys().find(k => Glossary[k] === Glossary[key]) || null;
  }

  // Highlight query tokens inside already-plain text: escape every character, then wrap matches in <mark>
  function hl(text, q) {
    const s = String(text == null ? '' : text);
    const toks = String(q || '').toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const low = s.toLowerCase();
    if (!toks.length || low.length !== s.length) return esc(s);
    const on = new Array(s.length).fill(false);
    for (const t of toks) { let i = low.indexOf(t); while (i >= 0) { for (let k = i; k < i + t.length; k++) on[k] = true; i = low.indexOf(t, i + t.length); } }
    let out = '', open = false;
    for (let i = 0; i < s.length; i++) { if (on[i] !== open) { out += on[i] ? '<mark>' : '</mark>'; open = on[i]; } out += esc(s[i]); }
    return open ? out + '</mark>' : out;
  }
  const matchesAll = (hay, q) => { const toks = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); return toks.every(t => hay.includes(t)); };

  /* ── Chart patterns (ported from v1 renderPatterns / openPatternModal) ── */
  function biasBadge(bias) {
    const map = { bullish: ['bull', '▲ Bullish'], bearish: ['bear', '▼ Bearish'], neutral: ['neutral', '● Neutral'] };
    const [cls, label] = map[bias] || map.neutral;
    return `<span class="badge ${cls}">${label}</span>`;
  }
  function filteredPatterns() {
    return patterns().filter(p => {
      if (pf === 'div' ? !String(p.id).includes('div') : pf !== 'all' && p.category !== pf && p.bias !== pf) return false;
      if (!pq) return true;
      return matchesAll([p.name, p.summary, p.category, p.bias, p.detail].join(' ').toLowerCase(), pq);
    });
  }
  function divergenceTip() {
    const shut = lsGet('cj.learnDivTip', '1') === '0';
    return `<details class="learn-tip ln-tipd" id="ln-divtip"${shut ? '' : ' open'}>
      <summary class="learn-tip-h"><svg aria-hidden="true"><use href="#i-info"/></svg>How to spot divergence live<svg class="ln-chev" aria-hidden="true"><use href="#i-chevron-d"/></svg></summary>
      <div class="learn-tip-body">Divergence is when momentum disagrees with price — an early warning that a move is running out of steam. To catch it in real time:</div>
      <div class="learn-list" style="margin-top:8px">
        <div class="li"><span class="bullet"></span><span>Mark the last two swing highs (in an uptrend) or swing lows (in a downtrend) on <b>price</b>.</span></div>
        <div class="li"><span class="bullet"></span><span>Draw the same line on your oscillator — <b>RSI, MACD or Stochastic</b>.</span></div>
        <div class="li"><span class="bullet"></span><span>If the two lines slope in <b>opposite</b> directions, that’s a divergence.</span></div>
        <div class="li"><span class="bullet"></span><span>It’s a <b>warning, not a trigger</b> — wait for a candle close or trendline break to confirm before you enter.</span></div>
      </div>
    </details>`;
  }
  function patternsHtml() {
    return `${divergenceTip()}
      <div class="filterbar ln-bar">
        <div class="search-box"><svg aria-hidden="true"><use href="#i-search"/></svg><input class="input" type="search" id="ln-pq" placeholder="Search patterns" aria-label="Search patterns" autocomplete="off" spellcheck="false" value="${esc(pq)}"></div>
        <div class="chip-row" role="group" aria-label="Filter patterns">${PF.map(f => `<button type="button" class="chip sm${pf === f.id ? ' on' : ''}" data-pf="${f.id}" aria-pressed="${pf === f.id}">${esc(f.label)}</button>`).join('')}</div>
        <div class="count ln-count" id="ln-pcount" role="status" aria-live="polite"></div>
      </div>
      <div class="playbook-grid ln-pgrid" id="ln-pgrid"></div>
      <p class="ln-foot">Educational reference only. Patterns fail often — wait for confirmation, size from your stop (1R) and practise each setup on paper first.</p>`;
  }
  function patternCard(p) {
    // data-fid: the dialog's close can refocus this card even if the grid re-rendered underneath (core focusBack)
    return `<button type="button" class="card pattern-card ln-pcard" data-pattern="${esc(p.id)}" data-fid="ln-p-${esc(p.id)}" aria-haspopup="dialog">
      <span class="pattern-svg" aria-hidden="true">${p.svg || ''}</span>
      <span class="pattern-body">
        <span class="pattern-meta">${biasBadge(p.bias)}<span class="badge cat">${esc(p.category)}</span></span>
        <span class="ln-pn">${hl(p.name, pq)}</span>
        <span class="pattern-sum">${hl(p.summary, pq)}</span>
      </span>
    </button>`;
  }
  function drawPatterns(panel) {
    const grid = panel.querySelector('#ln-pgrid'), count = panel.querySelector('#ln-pcount');
    if (!grid) return;
    const list = filteredPatterns();
    if (count) count.textContent = `${list.length} pattern${list.length === 1 ? '' : 's'}`;
    grid.innerHTML = list.length ? list.map(patternCard).join('')
      : `<div class="empty-state sm ln-span"><div class="big">No patterns match</div><div class="small">Try another filter or clear the search.</div></div>`;
    grid.querySelectorAll('[data-pattern]').forEach(b => b.onclick = () => openPattern(b.dataset.pattern, list));
  }
  function patternBody(p) {
    const li = (arr, cls) => `<div class="learn-list ${cls || ''}">${(arr || []).map(t => `<div class="li"><span class="bullet"></span><span>${esc(t)}</span></div>`).join('')}</div>`;
    return `<div class="learn-detail-svg" aria-hidden="true">${p.svg || ''}</div>
      <div class="pattern-meta" style="margin-bottom:12px">${biasBadge(p.bias)}<span class="badge cat">${esc(p.category)} pattern</span></div>
      <p class="ln-pdetail">${esc(p.detail || p.summary)}</p>
      <div class="form-section">What it signals</div>
      ${li(p.signals)}
      <div class="form-section">How to trade it</div>
      ${li(p.trade, 'trade')}
      <p class="ln-disc">Educational reference — always wait for confirmation and use your own risk plan. Log it as a paper trade first.</p>`;
  }
  function openPattern(id, list) {
    const all = patterns();
    const seq = list && list.some(p => p.id === id) ? list : all;
    let i = seq.findIndex(p => p.id === id);
    if (i < 0) return;
    const many = seq.length > 1;
    Modal.open({
      title: seq[i].name, width: 640, body: patternBody(seq[i]),
      foot: `${many ? `<button class="btn btn-ghost btn-sm" type="button" data-pm="prev"><svg aria-hidden="true"><use href="#i-chevron-l"/></svg>Previous</button>
        <button class="btn btn-ghost btn-sm" type="button" data-pm="next">Next<svg aria-hidden="true"><use href="#i-chevron-r"/></svg></button>` : ''}
        <span class="sp"></span><span class="dim ln-pos" aria-live="polite">${i + 1} of ${seq.length}</span>
        <button class="btn btn-primary" type="button" data-pm="ok">Got it</button>`,
      onMount: (el, close) => {
        const show = (j) => {
          i = (j + seq.length) % seq.length;
          el.querySelector('.modal-head h3').textContent = seq[i].name;
          const body = el.querySelector('.modal-body'); body.innerHTML = patternBody(seq[i]); body.scrollTop = 0;
          const pos = el.querySelector('.ln-pos'); if (pos) pos.textContent = `${i + 1} of ${seq.length}`;
        };
        const b = (k) => el.querySelector(`[data-pm="${k}"]`);
        if (b('prev')) b('prev').onclick = () => show(i - 1);
        if (b('next')) b('next').onclick = () => show(i + 1);
        b('ok').onclick = () => close();
        // ← / → browse while the dialog is open (not while a form field has focus)
        el.addEventListener('keydown', (ev) => {
          if (!many || ev.altKey || ev.ctrlKey || ev.metaKey || (ev.target.closest && ev.target.closest('input, textarea, select'))) return;
          if (ev.key === 'ArrowLeft') { ev.preventDefault(); show(i - 1); } else if (ev.key === 'ArrowRight') { ev.preventDefault(); show(i + 1); }
        });
      },
    });
  }
  function bindPatterns(panel) {
    const inp = panel.querySelector('#ln-pq');
    if (inp) inp.addEventListener('input', () => { pq = inp.value.trim(); drawPatterns(panel); });
    panel.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => {
      pf = b.dataset.pf;
      panel.querySelectorAll('[data-pf]').forEach(x => { const on = x.dataset.pf === pf; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      drawPatterns(panel);
    });
    const tip = panel.querySelector('#ln-divtip');
    if (tip) tip.addEventListener('toggle', () => lsSet('cj.learnDivTip', tip.open ? '1' : '0'));
    drawPatterns(panel);
  }

  /* ── Metrics guide (every Glossary entry as a searchable card) ── */
  function metricsHtml() {
    return `<div class="ln-intro">
        <div class="ln-principle"><span class="ln-pi" aria-hidden="true">R</span><div><b>R is net.</b> Results are measured in multiples of what you risked, after fees, funding and gas. A trade without a stop has no R — it shows “—”.</div></div>
        <div class="ln-principle"><span class="ln-pi" aria-hidden="true">n</span><div><b>Sample size decides.</b> Below each metric’s minimum the app dims or hides it. <span class="ln-confs">${confBadge(12)}${confBadge(35)}${confBadge(70)}${confBadge(140)}</span></div></div>
        <div class="ln-principle"><span class="ln-pi" aria-hidden="true">±</span><div><b>Read the range, not the dot.</b> If the likely range includes 0R, your results are “consistent with no edge” — keep collecting trades.</div></div>
      </div>
      <div class="filterbar ln-bar">
        <div class="search-box"><svg aria-hidden="true"><use href="#i-search"/></svg><input class="input" type="search" id="ln-mq" placeholder="Search — drawdown, fees, SQN…" aria-label="Search the metrics guide" autocomplete="off" spellcheck="false" value="${esc(mq)}"></div>
        <div class="chip-row" role="group" aria-label="Filter by topic">${[{ id: 'all', label: 'All' }].concat(GROUPS).map(g => `<button type="button" class="chip sm${mg === g.id ? ' on' : ''}" data-mg="${g.id}" aria-pressed="${mg === g.id}">${esc(g.label)}</button>`).join('')}</div>
        <div class="count ln-count" id="ln-mcount" role="status" aria-live="polite"></div>
      </div>
      <div id="ln-mlist"></div>`;
  }
  function termHay(k) { const g = Glossary[k]; return [k, g.title, g.plain, g.formula, g.good, g.caveat, groupLabel(g.group)].join(' ').toLowerCase(); }
  function seeTarget(g) {
    if (!g.see || !Pages.has(g.see[0])) return null;
    const [page, sub] = g.see;
    const names = { analytics: 'Analytics', trades: 'Trades', calc: 'Calculator', readiness: 'Readiness', settings: 'Settings', dash: 'Dashboard', journal: 'Journal' };
    return names[page] ? `${names[page]}${sub && page === 'analytics' ? ' · ' + sub : ''}` : 'Open';
  }
  function termCard(k, q) {
    const g = Glossary[k], see = seeTarget(g);
    return `<article class="card ln-term" id="ln-t-${esc(k)}" tabindex="-1" aria-labelledby="ln-th-${esc(k)}">
      <header class="ln-term-h"><h3 id="ln-th-${esc(k)}">${hl(g.title, q)}</h3>${g.min ? `<span class="ln-min" title="Minimum sample before the app shows this number">needs ${esc(g.min)}</span>` : ''}</header>
      <p class="ln-plain">${hl(g.plain, q)}</p>
      ${g.formula ? `<div class="ln-block"><div class="ln-lbl">Formula</div><pre class="ln-formula">${esc(g.formula)}</pre></div>` : ''}
      ${g.good ? `<div class="ln-block ln-good"><div class="ln-lbl"><svg aria-hidden="true"><use href="#i-target"/></svg>What good looks like</div><p>${hl(g.good, q)}</p></div>` : ''}
      ${g.caveat ? `<div class="ln-block ln-caveat"><div class="ln-lbl"><svg aria-hidden="true"><use href="#i-alert"/></svg>Watch out</div><p>${hl(g.caveat, q)}</p></div>` : ''}
      <footer class="ln-term-f"><span class="badge cat sm">${esc(groupLabel(g.group))}</span>${see ? `<button type="button" class="btn btn-quiet btn-xs" data-see="${esc(k)}" aria-label="See your ${esc(g.title)} in ${esc(see)}">See yours<svg aria-hidden="true"><use href="#i-chevron-r"/></svg></button>` : ''}</footer>
    </article>`;
  }
  function drawTerms(panel) {
    const box = panel.querySelector('#ln-mlist'), count = panel.querySelector('#ln-mcount');
    if (!box) return;
    const keys = termKeys().filter(k => (mg === 'all' || Glossary[k].group === mg) && (!mq || matchesAll(termHay(k), mq)));
    if (count) count.textContent = `${keys.length} term${keys.length === 1 ? '' : 's'}`;
    if (!keys.length) {
      box.innerHTML = `<div class="empty-state"><div class="big">No terms match “${esc(mq)}”</div><div class="small">Try “drawdown”, “R”, “fees” or “streak”.</div></div>`;
      return;
    }
    // Unfiltered: grouped sections. Filtered: one flat grid of matches.
    const groups = mg === 'all' && !mq ? GROUPS.map(g => ({ g, ks: keys.filter(k => Glossary[k].group === g.id) })).filter(x => x.ks.length) : [{ g: null, ks: keys }];
    box.innerHTML = groups.map(({ g, ks }) => `${g ? `<h2 class="section-h ln-gh">${esc(g.label)}<span class="aside">${ks.length} terms</span></h2>` : ''}<div class="ln-terms">${ks.map(k => termCard(k, mq)).join('')}</div>`).join('');
    box.querySelectorAll('[data-see]').forEach(b => b.onclick = () => seeYours(b.dataset.see));
  }
  function seeYours(key) {
    const g = Glossary[key]; if (!g || !g.see) return;
    const [page, sub] = g.see;
    if (page === 'analytics' && sub && ok(() => typeof Analytics !== 'undefined' && typeof Analytics.show === 'function', false)) { ok(() => Analytics.show(sub)); return; }
    if (page === 'settings' && sub && ok(() => typeof Settings !== 'undefined' && typeof Settings.show === 'function', false)) { ok(() => Settings.show(sub)); return; }
    if (Pages.has(page)) Router.go(page);
  }
  function bindMetrics(panel) {
    const inp = panel.querySelector('#ln-mq');
    if (inp) inp.addEventListener('input', () => { mq = inp.value.trim(); drawTerms(panel); });
    panel.querySelectorAll('[data-mg]').forEach(b => b.onclick = () => {
      mg = b.dataset.mg;
      panel.querySelectorAll('[data-mg]').forEach(x => { const on = x.dataset.mg === mg; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      drawTerms(panel);
    });
    drawTerms(panel);
  }

  /* ── Crypto basics: short lessons with a few live numbers ── */
  const maxLev = () => ok(() => S().risk.maxLeverage, 5) || 5;
  function rsOut() {
    const r = rs.entry > 0 && rs.stop > 0 ? ok(() => Engine.positionSize({ balance: rs.acct, entry: rs.entry, stop: rs.stop, riskPct: rs.risk }), null) : null;
    if (!r || !isNum(r.cryptoAmount) || !(r.cryptoAmount > 0)) return '<div class="ln-hint">Enter an account size, a risk %, an entry and a stop that differs from the entry.</div>';
    const short = rs.stop > rs.entry, ratio = rs.acct > 0 ? r.capitalNeeded / rs.acct : null;
    return `<div class="calc-strip ln-strip">
        <div class="ci"><div class="l">1R (your risk)</div><div class="v">${money(r.amountRisked)}</div></div>
        <div class="ci"><div class="l">Size</div><div class="v">${esc(fmtQty(r.cryptoAmount))} units</div></div>
        <div class="ci"><div class="l">Position value</div><div class="v">${money(r.capitalNeeded)}</div></div>
        <div class="ci"><div class="l">Stop distance</div><div class="v">${esc(fmtPct(r.stopPct))}</div></div>
      </div>
      <div class="ln-hint">${short ? 'Stop above the entry → this is a <b>short</b>.' : 'Stop below the entry → this is a <b>long</b>.'}
        ${ratio != null && ratio > 1 ? ` The position is ${ratio.toFixed(1)}× your account: on spot you can’t afford it; on futures you would post margin — but your loss at the stop is still ${money(r.amountRisked)}.` : ''}</div>`;
  }
  function dxOut() {
    if (!(dx.size > 0) || !(dx.liq > 0)) return '<div class="ln-hint">Enter a trade size and the pool’s liquidity (DexScreener shows it per pair).</div>';
    const impact = dx.size / (dx.liq / 2 + dx.size), fee = 0.0029, one = impact + fee;
    const v = impact < 0.005 ? ['✓ Fine', ''] : impact <= 0.02 ? ['⚠ Caution', 'warn-c'] : ['✕ Too big for this pool', 'warn-c'];
    return `<div class="calc-strip ln-strip">
        <div class="ci"><div class="l">Price impact</div><div class="v">${esc(fmtPct(impact))}</div></div>
        <div class="ci"><div class="l">+ PulseX fee</div><div class="v">0.29%</div></div>
        <div class="ci"><div class="l">One-way cost</div><div class="v">${esc(fmtPct(one))}</div></div>
        <div class="ci"><div class="l">Round trip ≈</div><div class="v">${esc(fmtPct(2 * one))}</div></div>
        <div class="ci"><div class="l">Verdict</div><div class="v ${v[1]}">${v[0]}</div></div>
      </div>`;
  }
  function levTable() {
    const entry = 100000, stop = 98000, qty = 0.05, risk = qty * (entry - stop);
    const rows = [1, 2, 5, 10, 25, 50].map(L => {
      const liq = L > 1 ? ok(() => Engine.liqPrice({ side: 'long', entry, qty, leverage: L, mmr: 0.005 }), null) : null;
      const chk = liq ? ok(() => Engine.liqCheck('long', entry, stop, liq), null) : null;
      const st = !liq ? '<span class="dim">no liquidation (1×)</span>' : chk === 'beyond' ? '<b class="warn-c">✕ liquidated before the stop</b>' : chk === 'tight' ? '<span class="warn-c">⚠ tight — under 2× the stop</span>' : '✓ stop fires first';
      return `<tr><th scope="row">${L}×${L > maxLev() ? ' <span class="badge warn sm">above your limit</span>' : ''}</th>
        <td class="num">${esc(fmtMoney(entry * qty / L))}</td><td class="num">${esc(fmtMoney(risk))}</td>
        <td class="num">${liq ? esc(fmtPriceText(liq.price)) : '—'}</td><td class="num">${liq ? esc(fmtPct(liq.distPct, { dp: 1 })) : '—'}</td><td>${st}</td></tr>`;
    }).join('');
    return `<div class="table-wrap bare ln-tw"><table class="compact-t ln-table">
      <caption class="sr-only">Same BTC long at every leverage: 0.05 BTC at 100,000 with a stop at 98,000</caption>
      <thead><tr><th scope="col">Leverage</th><th scope="col" class="num">Margin posted</th><th scope="col" class="num">Loss at stop</th><th scope="col" class="num">Liquidation ≈</th><th scope="col" class="num">Distance</th><th scope="col">Stop vs liquidation</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  function feeTable() {
    const pre = ok(() => S().fees.presets, null) || (typeof FEE_PRESETS !== 'undefined' ? FEE_PRESETS : {});
    const pctTxt = (v) => (isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) + '%' : '—');
    const mk = { spot: 'Spot', perp: 'Perp', dex: 'DEX swap' };
    const cost = (r) => (!isNum(r) ? '—' : `<span class="${r > 0.1 ? 'warn-c' : ''}">${r.toFixed(2)}R${r > 0.25 ? ' ⚠' : ''}</span>`);
    const rows = Object.entries(pre || {}).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => {
      const [venue, market] = String(k).split('|');
      const swap = isNum(v.swap) ? v.swap : null, taker = isNum(v.taker) ? v.taker : null;
      const rt = swap != null && !(taker > 0) ? 2 * swap : taker != null ? 2 * taker : null;   // round trip, % of notional
      return `<tr><th scope="row">${esc(venue)} <span class="dim">· ${esc(mk[market] || market || '')}</span></th>
        <td class="num">${pctTxt(v.maker)}</td><td class="num">${swap != null && !(taker > 0) ? `<span class="dim">in price</span> ${pctTxt(swap)}` : pctTxt(taker)}</td>
        <td class="num">${cost(rt != null ? rt / 1 : null)}</td><td class="num">${cost(rt != null ? rt / 3 : null)}</td></tr>`;
    }).join('');
    const checked = ok(() => S().fees.checked, '');
    return `<div class="table-wrap bare ln-tw"><table class="compact-t ln-table">
      <caption class="sr-only">Fee presets and the cost of a taker round trip in R</caption>
      <thead><tr><th scope="col">Venue</th><th scope="col" class="num">Maker</th><th scope="col" class="num">Taker</th><th scope="col" class="num">Round trip · 1% stop</th><th scope="col" class="num">· 3% stop</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="dim">No fee presets set — add them in Settings → Costs.</td></tr>'}</tbody></table></div>
      <div class="ln-hint">Your presets from Settings → Costs${checked ? ` (last checked ${esc(checked)})` : ''}. Base tiers change often — confirm on your exchange’s fee page. Round trip = taker in and out; maker entries cost less.</div>`;
  }
  function sessionNow() {
    const now = Date.now();
    const s = ok(() => Metrics.sessionAt(now), null);
    const wd = new Date(now).getUTCDay(), weekend = wd === 0 || wd === 6;
    const label = {
      Asia: 'Asia session (Tokyo open)', London: 'London session', 'London/NY': 'London / New York overlap — usually the most liquid hours',
      'New York': 'New York session (US market hours)', 'Off-hours': 'Off-hours — no major market open, books are thinner',
    }[s];
    if (!label) return '';
    return `<div class="ln-now"><span class="ln-dot" aria-hidden="true"></span><span>Right now (${esc(fmtTime(now))} your time${weekend ? ', weekend' : ''}): <b>${esc(label)}</b>${weekend ? ' · weekend liquidity is thin' : ''}</span></div>`;
  }
  function rampSteps() {
    const ramp = ok(() => S().ramp, null), on = !!(ramp && ramp.enabled), stage = on ? ramp.stage : null;
    const st = typeof RAMP_STAGES !== 'undefined' ? RAMP_STAGES : [null, 0.25, 0.5, 0.75, 1];
    const steps = [{ n: 0, t: 'Earn it on paper', d: 'Every readiness gate passes.' }].concat([1, 2, 3, 4].map(n => ({ n, t: `Stage ${n} · ${st[n]}% risk`, d: n < 4 ? '25 live trades, then a review.' : 'Your normal maximum.' })));
    return `<ol class="ln-steps">${steps.map(x => `<li class="${stage === x.n ? 'on' : ''}"${stage === x.n ? ' aria-current="step"' : ''}><span class="ln-sn" aria-hidden="true">${x.n || '✓'}</span><span><b>${esc(x.t)}</b><span class="dim">${esc(x.d)}</span></span></li>`).join('')}</ol>
      <div class="ln-hint">${on ? `Your ramp is on — live trades are capped at <b>stage ${esc(stage)} of 4${isNum(st[stage]) ? ` (${st[stage]}% risk)` : ''}</b>.` : 'The staged ramp is switched off in Settings → Risk.'}</div>`;
  }
  // cls 'money' lets privacy mode blur an input that may hold the user's real balance
  const num = (id, label, key, obj, step, cls) => `<div class="field"><label for="${id}">${label}</label><input class="input mono sm${cls ? ' ' + cls : ''}" id="${id}" type="number" inputmode="decimal" min="0" step="${step || 'any'}" data-${key[0]}="${key[1]}" value="${isNum(obj[key[1]]) ? obj[key[1]] : ''}"></div>`;

  const LESSONS = [
    {
      id: 'r-sizing', title: 'R-multiples & position sizing', icon: 'target', mins: 3, terms: ['rMultiple', 'riskPct', 'expR', 'netPL'],
      key: 'Pick the stop first, then the size. 1R — the dollars you accept losing — is the one number you fully control.',
      body: () => `<p>Before you think about profit, decide what you are willing to lose if you are wrong. That amount is <b>1R</b>. Every result in this journal is then measured in R, so a $1,000 account and a $100,000 account can be compared — and so can paper and live.</p>
        <pre class="ln-formula">1R ($ risk)   = account × risk %
size (units)  = 1R ÷ |entry − stop|
result in R   = net P/L ÷ 1R</pre>
        <div class="ln-ex"><div class="ln-lbl">Worked example</div>$10,000 account at 1% risk → 1R = $100. BTC long at 100,000 with the stop at 98,000 → stop distance $2,000 → size <b>0.05 BTC</b> (a $5,000 position). Exit at 104,000: +$200 gross, about $10 of Binance spot fees → <b>+1.9R</b>. Stop hit: −$100 − fees → about <b>−1.1R</b>.</div>
        <div class="ln-try" id="ln-rs"><div class="ln-lbl">Try it</div>
          <div class="ln-try-grid">${num('ln-rs-acct', 'Account ($)', ['rs', 'acct'], rs, null, 'money')}${num('ln-rs-risk', 'Risk (%)', ['rs', 'risk'], rs, '0.05')}${num('ln-rs-entry', 'Entry', ['rs', 'entry'], rs)}${num('ln-rs-stop', 'Stop', ['rs', 'stop'], rs)}</div>
          <div id="ln-rs-out" aria-live="polite">${rsOut()}</div>
        </div>
        <ul><li><b>Size comes from the stop.</b> Never move the stop to fit a size you want.</li>
          <li><b>Keep 1R steady</b> (for example 1% of your starting balance) for a few weeks so results stay comparable.</li>
          <li><b>Think in R, not coin price:</b> a +3R winner and a −1R loser are what matter — whether it was BTC at 100,000 or PLS at 0.00003.</li></ul>`,
      extra: () => (Pages.has('calc') ? '<button type="button" class="btn btn-ghost btn-xs" data-act="calc"><svg aria-hidden="true"><use href="#i-calc"/></svg>Open in calculator</button>' : ''),
    },
    {
      id: 'stops', title: 'Where to put your stop', icon: 'shield', mins: 3, terms: ['mae', 'stopViolation', 'rMultiple'],
      key: 'If you can’t say which price proves you wrong, you don’t have a trade yet.',
      body: () => `<p>A stop is the price that proves your trade idea wrong — not a random percentage and not the point where it starts to hurt.</p>
        <ul><li><b>Place it at invalidation:</b> beyond the swing low (long) or swing high (short), or the level your setup depends on, plus a small buffer for wicks.</li>
          <li><b>Then size from it.</b> A wider stop means a smaller position; your dollar risk stays 1R.</li>
          <li><b>Decide before entry and never widen it.</b> Moving the stop further away turns −1R into −2R — the “Moved / widened stop” mistake.</li>
          <li><b>Too tight is a mistake too.</b> A 0.3% stop on a coin that moves 3% an hour gets hit by noise. Your MAE data shows how far winners really dip.</li>
          <li><b>DEX swaps have no stop orders.</b> On PulseX you need a price alert and the discipline to sell — and slippage can push the loss past −1R.</li>
          <li><b>On perps the stop must sit well inside the liquidation price</b> (see the liquidation lesson).</li></ul>
        <div class="ln-ex"><div class="ln-lbl">Worked example</div>ETH long at 3,500. The higher low is at 3,430, so the stop goes to 3,415 (a small buffer). Distance 85 (2.4%). At 1R = $100 the size is 100 ÷ 85 ≈ <b>1.18 ETH</b> (about $4,120).</div>`,
    },
    {
      id: 'spot-perp', title: 'Spot vs perpetual futures', icon: 'layers', mins: 3, terms: ['funding', 'liqPrice', 'leverage', 'fees'],
      key: 'Start on spot. Perps add three new ways to lose money: leverage, liquidation and funding.',
      body: () => `<div class="table-wrap bare ln-tw"><table class="compact-t ln-table">
          <caption class="sr-only">Spot compared with perpetual futures</caption>
          <thead><tr><th scope="col"></th><th scope="col">Spot</th><th scope="col">Perpetual futures</th></tr></thead>
          <tbody>
            <tr><th scope="row">What you hold</th><td>The coin itself</td><td>A contract that tracks the price</td></tr>
            <tr><th scope="row">Direction</th><td>Long (sell what you own to exit)</td><td>Long or short</td></tr>
            <tr><th scope="row">Leverage</th><td>None (1×)</td><td>Up to 100×+ — keep it within your limit (${maxLev()}×)</td></tr>
            <tr><th scope="row">Liquidation</th><td>Never</td><td>Yes, if your margin runs out</td></tr>
            <tr><th scope="row">Holding cost</th><td>None</td><td>Funding, usually every 8 hours</td></tr>
            <tr><th scope="row">Typical base fees</th><td>~0.1% per side (Binance)</td><td>~0.02% maker / 0.05% taker</td></tr>
            <tr><th scope="row">Expiry</th><td>—</td><td>None — that is the “perpetual”</td></tr>
          </tbody></table></div>
        <p>Perps stay close to the spot price through <b>funding</b> payments, and the exchange uses a <b>mark price</b> (an index of several venues), not the last trade, to decide liquidations.</p>
        <p class="ln-note">Availability: many offshore perpetual venues (for example Binance and Bybit futures) are not available to US residents. Check what is legal where you live before you build a live plan around perps.</p>`,
    },
    {
      id: 'leverage', title: 'Leverage vs risk', icon: 'scale', mins: 3, terms: ['leverage', 'liqPrice', 'riskPct'],
      key: 'Size from the stop, then use the lowest leverage that fits the margin. Leverage is a margin setting, not a profit setting.',
      body: () => `<p>The most common beginner confusion: <b>when your size comes from the stop, leverage does not change how much you lose at the stop.</b> Your loss is units × stop distance — leverage isn’t in that formula. Leverage only decides how much of your own cash the exchange locks as margin, and how close liquidation sits.</p>
        <p>Same trade at every setting — 0.05 BTC long at 100,000, stop at 98,000:</p>
        ${levTable()}
        <ul><li><b>Effective leverage</b> = position value ÷ account equity. A $5,000 position on a $10,000 account is 0.5× — even if the exchange slider says 10×.</li>
          <li>Higher leverage frees cash, which tempts a bigger size. That is where accounts blow up, not the slider itself.</li>
          <li>Above ~25× in this example, ordinary noise can liquidate you before your stop ever fires.</li></ul>`,
    },
    {
      id: 'liquidation', title: 'Liquidation & maintenance margin', icon: 'alert', mins: 4, terms: ['liqPrice', 'mmr', 'leverage'],
      key: 'If your stop is beyond the liquidation price, the stop never fires — you are liquidated first.',
      body: () => `<p>With leverage you post <b>initial margin</b>. The exchange also requires a smaller <b>maintenance margin</b>. If losses eat your margin down to that level, it force-closes the position — liquidation — and you usually lose that margin plus a fee.</p>
        <pre class="ln-formula">initial margin      = notional ÷ leverage
maintenance margin  = notional × MMR − maintenance amount (tier)
long  liquidation  ≈ (Q × EP − WB − cum) ÷ (Q × (1 − MMR))
short liquidation  ≈ (Q × EP + WB + cum) ÷ (Q × (1 + MMR))
WB = isolated margin = Q × EP ÷ leverage</pre>
        <div class="ln-ex"><div class="ln-lbl">Worked example</div>10× BTC long at 100,000 with MMR 0.5%: liquidation ≈ <b>90,452</b>, 9.5% away. The same 10× short liquidates ≈ <b>109,453</b>. Rough rule: distance ≈ 1 ÷ leverage − MMR → 10× ≈ 9.5%, 25× ≈ 3.5%, 50× ≈ 1.5%.</div>
        <ul><li><b>Keep liquidation at least 2× as far away as your stop.</b> The trade form and calculator flag a stop beyond liquidation in red.</li>
          <li><b>Isolated margin</b> limits the damage to that position’s margin. <b>Cross margin</b> uses your whole wallet, so one bad trade can drain it — the app’s figure is then only approximate (≈).</li>
          <li>Exchanges use the mark price, tiered MMR, closing fees and funding — treat every liquidation number as an estimate, never a promise.</li></ul>`,
    },
    {
      id: 'funding', title: 'Funding rates', icon: 'clock', mins: 2, terms: ['funding', 'fees', 'netPL'],
      key: 'Funding is a cost of holding: negligible for scalps, real for multi-day swings.',
      body: () => `<p>Perpetual futures never expire, so exchanges keep their price close to spot with <b>funding</b> — a periodic payment between longs and shorts.</p>
        <pre class="ln-formula">funding = units × mark price × funding rate   (+ you pay, − you receive)
positive rate → longs pay shorts · negative rate → shorts pay longs</pre>
        <ul><li><b>When:</b> usually every 8 hours (00:00, 08:00 and 16:00 UTC for BTC / ETH); some contracts settle every 1 or 4 hours.</li>
          <li><b>Only if you are open at the settlement instant.</b> A two-hour scalp between settlements pays nothing.</li>
          <li><b>How much:</b> at the 0.01% per 8h baseline, a $10,000 position pays about $1 per settlement, $3 a day, roughly 11% a year. Crowded markets pay far more.</li>
          <li><b>In R:</b> a 5-day swing on a $10,000 position with $100 at risk pays about $15 — 0.15R gone before fees.</li>
          <li>Record it in the trade’s <b>Funding</b> field (signed) so net P/L and R stay honest. Your exchange’s transaction log has the exact figure.</li></ul>`,
    },
    {
      id: 'fees', title: 'Maker vs taker — why costs belong in R', icon: 'scale', mins: 3, terms: ['fees', 'costDrag', 'beWinRate', 'haircut'],
      key: 'Costs are part of R. Use maker entries where you can, avoid very tight stops on high-fee venues and keep the cost under 0.25R.',
      body: () => `<p><b>Maker</b> orders add liquidity — a limit order that rests on the book — and pay less. <b>Taker</b> orders remove it — market orders and most stop-losses — and pay more.</p>
        <pre class="ln-formula">fee in R ≈ (entry rate + exit rate) × entry ÷ |entry − stop|</pre>
        <p>The tighter your stop, the bigger fees become in R. For the same 1R a tight stop means a bigger position, and fees are charged on the position: a 0.2% round trip costs 0.1R with a 2% stop but 0.4R with a 0.5% stop.</p>
        ${feeTable()}
        <div class="ln-ex"><div class="ln-lbl">Breakeven win rate after costs</div>(1 + cost in R) ÷ (planned R:R + 1). A 2R target with no costs breaks even at 33%; with 0.2R of costs it needs 40%; a 1R target with 0.2R of costs needs 60%.</div>`,
    },
    {
      id: 'slippage', title: 'Slippage & DEX price impact (PulseX)', icon: 'trend-down', mins: 3, terms: ['slippage', 'fees', 'haircut', 'stopViolation'],
      key: 'On a DEX, size to the pool as well as to your stop: keep price impact under 0.5%.',
      body: () => `<p><b>Slippage</b> is the gap between the price you expected and your fill. On an exchange it comes from the order book; on a DEX like PulseX it comes from the pool itself — your buy pushes the price up while you trade.</p>
        <pre class="ln-formula">slippage %    = (fill − expected) ÷ expected   (× −1 for sells)
price impact  ≈ trade size ÷ (pool liquidity ÷ 2 + trade size)
PulseX fee    = 0.29% per swap — already inside the fill price</pre>
        <div class="ln-try" id="ln-dx"><div class="ln-lbl">Try it</div>
          <div class="ln-try-grid">${num('ln-dx-size', 'Trade size ($)', ['dx', 'size'], dx)}${num('ln-dx-liq', 'Pool liquidity ($)', ['dx', 'liq'], dx)}</div>
          <div id="ln-dx-out" aria-live="polite">${dxOut()}</div>
        </div>
        <ul><li><b>Don’t add the 0.29% fee again.</b> It is already in your executed price — enter the real fill and leave the fee at zero.</li>
          <li><b>Gas</b> on PulseChain is paid in PLS and is tiny (a swap ≈ 100 PLS, a fraction of a cent) — record it anyway.</li>
          <li><b>Slippage tolerance:</b> set it as low as works in your wallet; a very high tolerance invites sandwich bots.</li>
          <li><b>Thin pools and weekends</b> mean more impact — check the pair’s liquidity before you size.</li>
          <li>Losses beyond −1R on PulseChain coins are often slippage, not a moved stop — note it on the trade.</li></ul>`,
    },
    {
      id: 'sessions', title: '24/7 markets, sessions & weekends', icon: 'calendar', mins: 3, terms: ['dailyLoss', 'cooldown', 'greenDays', 'sample'],
      key: 'Pick your hours and trade them deliberately. “The market is always open” is a trap, not an edge.',
      body: () => `${sessionNow()}
        <p>Crypto never closes, but liquidity comes in waves that follow traditional market hours. The app classifies each trade by its entry time and follows daylight saving automatically.</p>
        <div class="table-wrap bare ln-tw"><table class="compact-t ln-table">
          <caption class="sr-only">Trading sessions in local and UTC time</caption>
          <thead><tr><th scope="col">Session</th><th scope="col">Local hours</th><th scope="col">UTC (winter / summer)</th></tr></thead>
          <tbody>
            <tr><th scope="row">Asia</th><td>Tokyo 09:00–17:00</td><td>00:00–08:00 (no DST)</td></tr>
            <tr><th scope="row">London</th><td>08:00–16:30 London</td><td>08:00–16:30 / 07:00–15:30</td></tr>
            <tr><th scope="row">New York</th><td>09:30–16:00 New York</td><td>14:30–21:00 / 13:30–20:00</td></tr>
            <tr><th scope="row">London / NY overlap</th><td>Both open</td><td>14:30–16:30 / 13:30–15:30</td></tr>
            <tr><th scope="row">Off-hours & weekends</th><td>No major market open</td><td>Thinner books, wider spreads</td></tr>
          </tbody></table></div>
        <ul><li><b>Weekends are thin:</b> in 2024 weekend volume fell to about 16% of the weekly total (Kaiko). Expect wider spreads, more slippage and sudden moves — especially on PulseChain pools.</li>
          <li><b>Your trading day starts at your reset hour</b> (Settings → Risk), so a 1 a.m. trade can still count as “yesterday” for the daily loss limit.</li>
          <li><b>24/7 tempts night trading.</b> Tired trades are usually C-grade; the daily readiness check-in in the Journal helps you notice.</li>
          <li>Analytics → Timing shows your own results by session and weekday once each bucket has 10+ trades.</li></ul>`,
    },
    {
      id: 'paper-live', title: 'Paper vs live: what changes', icon: 'flask', mins: 3, terms: ['haircut', 'transfer', 'readiness', 'welch'],
      key: 'Paper proves the process; live tests it under pressure. Go live small and let the data decide when to size up.',
      body: () => {
        const c = ok(() => S().costs, null) || {};
        const p = (v) => (isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) + '%' : '—');
        return `<div class="table-wrap bare ln-tw"><table class="compact-t ln-table">
            <caption class="sr-only">Differences between paper and live trading</caption>
            <thead><tr><th scope="col"></th><th scope="col">Paper</th><th scope="col">Live</th></tr></thead>
            <tbody>
              <tr><th scope="row">Fills</th><td>Perfect, at your price</td><td>Spread, slippage, partial fills</td></tr>
              <tr><th scope="row">Fees</th><td>Only if recorded (auto-fill helps)</td><td>Always</td></tr>
              <tr><th scope="row">Emotion</th><td>Quiet</td><td>Fear and hope get loud — early exits, moved stops</td></tr>
              <tr><th scope="row">Size</th><td>Any size fills</td><td>Thin books move against you</td></tr>
              <tr><th scope="row">Mistakes</th><td>Cheap lessons</td><td>Real losses</td></tr>
            </tbody></table></div>
          <p>The readiness page subtracts a <b>haircut</b> from every paper trade: exchange trades lose ${p(c.cexFeePct)} fee + ${p(c.cexSlipPct)} slippage per side, DEX trades ${p(c.dexFeePct)} + ${p(c.dexSlipPct)} per side (Settings → Costs).</p>
          <ul><li><b>Use the same guardrails in paper as in live</b> so the habits carry over.</li>
            <li><b>Keep the paper balance realistic</b> — within 0.5–2× the capital you will actually trade live.</li>
            <li><b>Expect live below paper.</b> Keeping 50–70% of your paper edge is common.</li>
            <li><b>Base rates are harsh:</b> in one study of Brazilian futures day traders, 97% of those who kept at it for 300+ days lost money (Chague, De-Losso & Giovannetti, 2019). The evidence checklist exists so you don’t find out with real money.</li></ul>`;
      },
    },
    {
      id: 'ramp', title: 'The staged ramp: going live safely', icon: 'trend-up', mins: 2, terms: ['rampStage', 'readiness', 'transfer', 'adherence'],
      key: 'Earn each step up. Dropping a stage is the safety net working, not a failure.',
      body: () => `<p>Small size keeps your first live mistakes cheap while you learn how you behave with real money. Each stage lasts at least 25 live trades — a review checkpoint, not proof of an edge.</p>
        ${rampSteps()}
        <pre class="ln-formula">review every 25 live trades:
  promote     adherence ≥ 90%, expectancy > 0 (or ≥ half of paper after costs), drawdown < 5%
  demote      drawdown ≥ 5% → back one stage
  stop        drawdown ≥ 10% → back to paper</pre>`,
      extra: () => (Pages.has('readiness') ? '<button type="button" class="btn btn-ghost btn-xs" data-act="readiness"><svg aria-hidden="true"><use href="#i-shield"/></svg>Open readiness</button>' : ''),
    },
  ];

  function lessonHtml(l, i) {
    const done = read.has(l.id);
    return `<article class="card ln-lesson" id="ln-c-${l.id}" tabindex="-1" aria-labelledby="ln-ch-${l.id}">
      <header class="ln-lesson-h"><span class="ln-lesson-ic" aria-hidden="true"><svg><use href="#i-${l.icon}"/></svg></span>
        <div><h3 id="ln-ch-${l.id}">${i + 1}. ${esc(l.title)}</h3><div class="ln-lesson-meta">${l.mins} min read${done ? ' · ✓ read' : ''}</div></div></header>
      <div class="ln-body">${ok(() => l.body(), '<p class="dim">This lesson could not be shown.</p>')}</div>
      <div class="ln-key"><svg aria-hidden="true"><use href="#i-target"/></svg><span><b>Key takeaway:</b> ${esc(l.key)}</span></div>
      <footer class="ln-lesson-f"><span class="ln-lbl">Related</span>${l.terms.filter(k => Glossary[k]).map(k => `<button type="button" class="chip sm" data-term="${k}">${esc(Glossary[k].title)}</button>`).join('')}
        <span class="sp"></span>${l.extra ? ok(() => l.extra(), '') : ''}
        <button type="button" class="btn btn-ghost btn-xs ln-readbtn${done ? ' on' : ''}" data-read="${l.id}" aria-pressed="${done}"><svg aria-hidden="true"><use href="#i-check"/></svg>${done ? 'Read' : 'Mark as read'}</button></footer>
    </article>`;
  }
  function cryptoHtml() {
    // personal default, except in privacy mode (screen-sharing): then the worked example's $10,000
    if (rs.acct == null) rs.acct = !ok(() => View.privacy, false) && C && C.balance > 0 ? Math.round(C.balance) : 10000;
    if (rs.risk == null) rs.risk = ok(() => effectiveMaxRisk(), 1) || 1;
    const n = LESSONS.length, done = LESSONS.filter(l => read.has(l.id)).length;
    return `<div class="ln-crypto">
      <nav class="card ln-toc" aria-label="Lessons">
        <div class="ln-toc-h"><b>Lessons</b><span class="dim">${done} of ${n} read</span></div>
        <div class="progress-track" role="progressbar" aria-label="Lessons read" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${done}"><div class="progress-fill" style="width:${Math.round(done / n * 100)}%"></div></div>
        <ol>${LESSONS.map((l, i) => `<li><button type="button" data-toc="${l.id}" class="${read.has(l.id) ? 'read' : ''}"><span class="ln-n" aria-hidden="true">${read.has(l.id) ? '✓' : i + 1}</span><span class="ln-tt">${esc(l.title)}</span>${read.has(l.id) ? '<span class="sr-only"> (read)</span>' : ''}</button></li>`).join('')}</ol>
      </nav>
      <div class="ln-lessons">${LESSONS.map(lessonHtml).join('')}</div>
    </div>`;
  }
  function bindCrypto(panel) {
    panel.querySelectorAll('[data-toc]').forEach(b => b.onclick = () => reveal({ tab: 'crypto', key: b.dataset.toc }));
    panel.querySelectorAll('[data-term]').forEach(b => b.onclick = () => show('metrics', b.dataset.term));
    panel.querySelectorAll('[data-read]').forEach(b => b.onclick = () => {
      const id = b.dataset.read;
      if (read.has(id)) read.delete(id); else read.add(id);
      lsSet('cj.learnRead', JSON.stringify([...read]));
      const y = scrollTopOf();
      panel.innerHTML = cryptoHtml(); bindCrypto(panel);
      restoreScroll(y);
      const nb = panel.querySelector(`[data-read="${id}"]`); if (nb) nb.focus({ preventScroll: true });
      const badge = document.querySelector('#ln-tab-crypto .nav-badge'); if (badge) badge.textContent = cryptoBadge();
    });
    panel.querySelectorAll('[data-act="calc"]').forEach(b => b.onclick = () => {
      // only hand over numbers: a cleared field (null) would wipe the calculator's own value
      const p = { coin: 'BTC' };
      if (isNum(rs.entry) && rs.entry > 0) p.entry = rs.entry;
      if (isNum(rs.stop) && rs.stop > 0) p.stop = rs.stop;
      if (isNum(rs.risk) && rs.risk > 0) p.riskPct = rs.risk;
      if (p.entry != null && p.stop != null) p.side = p.stop > p.entry ? 'short' : 'long';
      if (ok(() => typeof Calc !== 'undefined' && typeof Calc.prefill === 'function', false)) ok(() => Calc.prefill(p));
      else if (Pages.has('calc')) Router.go('calc');
    });
    panel.querySelectorAll('[data-act="readiness"]').forEach(b => b.onclick = () => Router.go('readiness'));
    // inputs carry data-rs="acct|risk|entry|stop" or data-dx="size|liq"; only the result strip re-renders, so focus stays put
    const live = (attr, obj, outId, fn) => panel.querySelectorAll(`[data-${attr}]`).forEach(inp => inp.addEventListener('input', () => {
      const v = parseFloat(inp.value); obj[inp.dataset[attr]] = isFinite(v) ? v : null;
      const out = panel.querySelector(outId); if (out) out.innerHTML = fn();
    }));
    live('rs', rs, '#ln-rs-out', rsOut);
    live('dx', dx, '#ln-dx-out', dxOut);
  }
  const cryptoBadge = () => `${LESSONS.filter(l => read.has(l.id)).length}/${LESSONS.length}`;

  /* ── Scrolling helpers (desktop scrolls #content, phones scroll the window) ── */
  function scrollTopOf() { const c = document.getElementById('content'); return { c: c ? c.scrollTop : 0, w: window.scrollY }; }
  function restoreScroll(y) { const c = document.getElementById('content'); if (c) c.scrollTop = y.c; if (window.scrollY !== y.w) window.scrollTo(0, y.w); }
  // Scroll to a card, flash a highlight ring and move focus there (screen readers land on it)
  function reveal(p) {
    if (!p) return;
    if (p.tab === 'patterns') { openPattern(p.key); return; }
    const key = p.tab === 'metrics' ? canonical(p.key) : p.key;
    const node = key && document.getElementById((p.tab === 'metrics' ? 'ln-t-' : 'ln-c-') + key);
    if (!node) return;
    node.scrollIntoView({ block: p.tab === 'metrics' ? 'center' : 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
    node.classList.remove('ln-hl'); void node.offsetWidth; node.classList.add('ln-hl');
    node.focus({ preventScroll: true });
    clearTimeout(hlTimer); hlTimer = setTimeout(() => node.classList.remove('ln-hl'), 2600);
  }

  /* ── Page shell: tabs + panel ── */
  function bindTabs(root) {
    const btns = [...root.querySelectorAll('[role="tab"]')];
    btns.forEach((b, i) => {
      b.onclick = () => setTab(b.dataset.tab);
      b.onkeydown = (ev) => {
        const j = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? btns.length - 1 : null;
        if (j == null) return;
        ev.preventDefault(); focusTab = true; setTab(btns[(j + btns.length) % btns.length].dataset.tab);
      };
    });
  }
  function setTab(t) {
    if (!TABS.some(x => x.id === t)) return;
    if (t === tab) { focusTab = false; return; }
    tab = t; lsSet('cj.learnTab', t); pending = null;
    if (Router.active === 'patterns') Router.render();   // re-render emits 'page' so the topbar subtitle follows the tab
  }
  function render(el) {
    if (!TABS.some(t => t.id === tab)) tab = 'patterns';
    // keep focus + caret in a search box across re-renders (resize, commits elsewhere)
    const act = document.activeElement, actId = act && el.contains(act) && act.id && act.matches('input') ? act.id : null;
    const caret = actId ? ok(() => act.selectionStart, null) : null;
    // a tab activated by click / Enter / Space is destroyed by this re-render — hand focus to the new active tab
    const tabHadFocus = !!(act && el.contains(act) && act.getAttribute && act.getAttribute('role') === 'tab');
    const badge = { patterns: String(patterns().length), metrics: String(termKeys().length), crypto: cryptoBadge() };
    el.innerHTML = `<div class="ln">
      <div class="tabs ln-tabs" role="tablist" aria-label="Learn sections">${TABS.map(t => `<button type="button" role="tab" id="ln-tab-${t.id}" data-tab="${t.id}" data-fid="ln-tab-${t.id}" aria-controls="ln-panel" aria-selected="${t.id === tab}" tabindex="${t.id === tab ? 0 : -1}" class="${t.id === tab ? 'on' : ''}"><svg aria-hidden="true"><use href="#i-${t.icon}"/></svg>${esc(t.label)}<span class="nav-badge">${badge[t.id]}</span></button>`).join('')}</div>
      <div class="ln-panel" id="ln-panel" role="tabpanel" aria-labelledby="ln-tab-${tab}">${tab === 'patterns' ? patternsHtml() : tab === 'metrics' ? metricsHtml() : cryptoHtml()}</div>
    </div>`;
    bindTabs(el);
    const panel = el.querySelector('#ln-panel');
    if (tab === 'patterns') bindPatterns(panel); else if (tab === 'metrics') bindMetrics(panel); else bindCrypto(panel);
    if (focusTab || tabHadFocus) { focusTab = false; const b = el.querySelector('#ln-tab-' + tab); if (b) b.focus({ preventScroll: true }); }
    else if (actId) { const n = document.getElementById(actId); if (n) { n.focus({ preventScroll: true }); if (caret != null) ok(() => n.setSelectionRange(caret, caret)); } }
    if (pending && pending.tab === tab) { const p = pending; pending = null; setTimeout(() => reveal(p), 80); }   // after the router resets scroll
  }

  // Learn.show('patterns' | 'metrics' | 'crypto', key?) — navigate, then reveal the pattern / term / lesson
  function show(t, key) {
    if (TABS.some(x => x.id === t)) { tab = t; lsSet('cj.learnTab', t); }
    pending = null;
    if (key != null && key !== '') {
      const k = String(key);
      if (tab === 'metrics') {
        if (canonical(k)) { mq = ''; mg = 'all'; pending = { tab, key: k }; }
        else { mq = k; mg = 'all'; }   // unknown key → show it as a search instead
      } else pending = { tab, key: k };
    }
    if (Router.active === 'patterns') Router.render(); else Router.go('patterns');
  }

  Pages.register('patterns', { title: 'Learn', sub: () => SUB[tab] || SUB.patterns, render });

  return { show, get tab() { return tab; }, tabs: TABS.map(t => t.id) };
})();
