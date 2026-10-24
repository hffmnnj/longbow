---
name: small-account
description: Sizes positions and plans the day for a small limited-margin account with fractional shares, swing holds, and buying-power discipline; load before sizing any trade or planning the day.
---

Use when: sizing any order on an account near $1,000 to $2,000, or planning the day's entries and watchlist.

## The realistic goal

This account compounds through low drawdowns, not lottery tickets. A 20% drawdown needs a 25% recovery; the math punishes churn and rewards survival. Judge every week by equity curve smoothness and adherence to stops, never by whether a runner was caught. One to two good swings a month beats twenty scratches.

## Universe

Default to liquid ETFs (SPY, QQQ, DIA, IWM) and mega-cap leaders with average daily dollar volume well above the live floor in `get_risk_state`. Check actual spreads and fills; even liquid names can gap through stops. Single small caps are off the menu: their spreads alone can exceed the whole per-trade risk budget, which fails the expected-value gate before the thesis is even read.

## Position count and sizing

At most 4 names, and usually 1 to 2. Each slot is scarce, so a new entry must displace the weakest idea on paper, not just clear the gate. Read the live per-trade risk percent, per-name cap, and order-notional cap from `get_risk_state` before every computation; the worked numbers below illustrate method, not current settings.

Worked example at $1,000 with a one-and-a-half percent per-trade risk ($15) and a 30% per-name cap ($300): a $95 entry with a $4.50 per-share stop gives $15 / $4.50 = 3.33 shares on risk, which cost $316 and breach the name cap, so the cap binds at $300 / $95 = 3.16 shares. Fractional shares are allowed and expected: size to the tighter of the risk constraint and the cap constraint, to the cent, and never round up to a whole share.

## Cash settlement and buying power

The connected agentic account is limited margin. Use the broker's live buying power, not an invented settled-cash figure; the snapshot intentionally omits settledCash. Keep cash available and never assume that limited margin removes day-trade restrictions.

Robinhood fills fractional shares only as market orders in regular hours. A fractional limit intent sent through `submit_order` converts to market only if the fresh ask is at or below the buy limit, or the bid at or above the sell limit; otherwise it fails rather than resting. Market fills can slip. Fractional protective sell stops are held by the harness and checked every minute in regular NYSE hours, then sold at market on the trigger. They need the harness running and cannot protect overnight. Whole-share limits and GTC stops rest at Robinhood. Use `cancel_order` with the harness order id to cancel or replace protection.

## Day-trade limits

Do not day trade. Opening and closing the same name in one session counts toward the system's day-trade cap (3 in 5 business days), and each round trip burns spread twice on an account that cannot afford it. Every entry is planned as a multi-day swing with a 3- to 15-day horizon: long enough for the thesis to work, short enough that a time stop fires before hope sets in. Stop exits are exempt from the minimum hold and are always allowed; everything else sits overnight at minimum.

## Cost control

There are no commissions, so spread plus slippage is the entire cost line. Re-check the spread on a fresh quote immediately before `submit_order`; if it exceeds the live gate, pass regardless of the chart. Prefer entries near the mid with day orders, and never chase more than a few basis points past the planned limit: on an $18 risk budget, a 30-cent slip on 4 shares is $1.20, or nearly 7% of the risk, gone before the trade starts.

## When buying power is too small

Pass. If the computed size cannot clear the $5 minimum order notional, if the name cap leaves too few fractional shares to be worth the spread, or if live buying power cannot cover the notional, the setup is untradable today. Log it as a hold with the reason ("passed: name cap allowed only $40 notional, spread would eat the edge"). Scarcity of capital is information, not an obstacle to route around by widening stops or combining slots.

## Weekly review habit

Once a week, post-close: recompute heat per `portfolio-heat`, check realized costs per trade against estimates, confirm no unsettled-cash or day-trade near misses, and append at most 3 lines to `lessons.md`. Demote any setup with two consecutive full-stop losses to paper-only for a month. Review the watchlist for names that have drifted below the liquidity floor and remove them.

## Failure modes

- Overtrading: four entries in a week on a small account is churn, not diversification; each ticket costs spread the account cannot reclaim.
- Revenge trading after a stop: the next setup does not know about the last loss; halving size for the rest of the day after a down day exists for exactly this impulse.
- Concentration in one theme: two "different" tech names are one bet; the sector cap and the 0.8 correlation rule in `portfolio-heat` decide, not the tickers.
- Chasing: entering above the planned limit because the name is running converts edge into slippage; the missed trade costs nothing and the chased one pays spread.
- Borrowing conviction from size: no averaging down, ever; a position against its stop is smaller next time, not bigger this time.
