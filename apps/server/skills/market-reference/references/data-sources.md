# Data sources: what each tool provides and its limits

## market_price_history({ symbol, range })

Daily OHLCV bars, oldest first, ranges 1m to 5y. Use for volume averages, swing levels, base ranges, custom RSI, and backtests. Limits: daily bars only, no intraday; splits and dividends may not be adjusted (verify against indicator closes before trusting multi-year return math); thin names may have missing sessions.

## market_indicators({ symbol, range? })

Snapshot plus trend and momentum: SMA 20/50/200, EMA 20, RSI 14, ATR 14 and ATR percent, MACD, Bollinger percent-B, 20-day Donchian channel, 52-week high/low, trailing returns, realized volatility, max drawdown, 20-day average dollar volume, and a trend label. Limits: any field may be null for young or thin listings; the trend label is a starting point, not a verdict; recompute disputed values from price history.

## market_compare({ symbols, range?, benchmark? })

Return, volatility, beta, correlation, and relative-strength percentages for a symbol list, plus a pairwise correlation matrix. Limits: correlations are backward-looking and spike toward 1.0 in selloffs, exactly when diversification is needed most; re-run after large moves.

## market_earnings({ symbol }) and market_earnings_calendar({ date })

Next report date, days until, time, and EPS forecast per symbol; the largest reporters for a given day. Limits: dates move; re-check inside the 5-day blackout window. Small caps may return null forecasts.

## market_economic_calendar({ date })

US events with actual, consensus, and previous values. Limits: explicitly may be unavailable; when it fails, fall back to the calendar reference file and web search, and treat unknown event days with the pre-event entry blackout.

## market_volatility({ range? })

VIX close, one-year percentile, 20-day SMA, and term structure when available. Limits: term-structure data may be absent; percentile needs roughly a year of history to be meaningful.

## market_yields()

Treasury curve points, 2s10s and 3m10y spreads, 20-day change in the 10-year. Limits: a snapshot for regime context, not a trading signal on its own.

## sec_company({ symbol })

CIK, recent filings with links, and 8 periods of revenue, net income, EPS, shares, cash, and long-term debt. Limits: 8 periods only; cash-flow statements are absent, so burn estimates are rough; always open the linked filings for going-concern or restatement language rather than trusting the numbers alone.

## General rule

Every numeric input that gates an entry must have a null check. A missing value fails closed: no indicator, no setup, no trade.
