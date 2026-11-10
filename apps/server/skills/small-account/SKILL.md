---
name: small-account
description: Sizes positions and plans the day for a small limited-margin account with fractional shares, swing and core holds, and buying-power discipline; load before sizing any trade or planning the day.
---

Use when: sizing any order on an account near $1,000 to $2,000, or planning the day's entries and watchlist.

## The realistic goal

Compound faster than SPY net of costs. At this size the two ways to lose are churn (spread and small stop-outs eating the account) and cash drag (sitting out a rising market). A handful of well-chosen companies held for months, with stops that leave room for normal volatility, avoids both. Judge each month by net return against SPY and by whether the account was as invested as the regime called for.

## Universe

Liquid, profitable large caps with average daily dollar volume well above the live floor in `get_risk_state` and tight spreads. Follow the owner's latest instruction on funds: when the owner says individual stocks only, the universe is companies only. Small caps and thin names are off the menu: their spreads alone can exceed the per-trade risk budget.

## Position count and sizing

Hold at most the live maxPositions names from the cycle header and `get_risk_state`; a core book of 4 to 8 names is the usual shape at this size. Read the live per-trade risk percent, per-name cap and entry-order notional cap before every computation; the numbers below illustrate method, not current settings.

Worked example at $1,200 equity, 3% per-trade risk ($36) and a 30% per-name cap ($360): a $200 stock with a 12% core stop ($24 per share) allows $36 / $24 = 1.5 shares on risk, which cost $300, under the cap. A first tranche of two thirds is 1.0 share ($200); a second tranche later brings it to 1.5. Fractional shares are expected: size to the cent and never round up to a whole share.

## Cash settlement and buying power

The connected agentic account is limited margin. Use the broker's live buying power, not an invented settled-cash figure; the snapshot intentionally omits settledCash. Never assume that limited margin removes day-trade restrictions.

Robinhood fills fractional shares only as market orders in regular hours. A fractional limit intent sent through `submit_order` converts to market only if the fresh ask is at or below the buy limit, or the bid at or above the sell limit; otherwise it fails rather than resting. Market fills can slip. Fractional protective sell stops are held by the harness and checked every minute in regular NYSE hours, then sold at market on the trigger. They need the harness running and cannot protect overnight. Whole-share limits and GTC stops rest at Robinhood. Use `cancel_order` with the harness order id to cancel or replace protection.

## Day-trade limits

Prefer multi-day and multi-month holds over intraday trades. Read the live day-trade cap and minimum hold from `get_risk_state`; do not substitute an old fixed count or require an overnight hold when the live minimum is zero. A stop exit is exempt from the minimum hold, not from the kill switch, mode off, a closed equity session or a stale quote. Crypto has separate rules in `crypto-sleeve`.

## Cost control

There are no commissions, and sales of $500 or less (and 50 shares or fewer) skip the SEC and FINRA fees, so spread plus slippage is usually the whole cost line. The risk engine rejects an entry whose estimatedCostPct is below spread plus fees. Re-check the spread on a fresh quote immediately before `submit_order`; if it exceeds the live gate, pick another name or wait for a tighter market.

## When buying power is too small

If the computed size cannot clear the minimum order notional or live buying power cannot cover it, log it as a hold with the reason in one line and move to the next candidate. Do not widen stops or combine slots to make it fit.

## Weekly review habit

Once a week, post-close: compare the week's net return with SPY, check the invested share against the regime target, check realized costs against estimates, and add at most 3 lines to `lessons.md`. Demote a tactical setup with two consecutive full-stop losses to paper-only for a month.

## Failure modes

- Cash drag: researching for days while the account sits mostly in cash. A qualified candidate below the invested target is a buy, in tranches.
- Tight stops: stops a percent or two under the price on volatile names turn ordinary noise into realized losses.
- Revenge trading after a stop: the next setup does not know about the last loss.
- Concentration in one theme: two "different" tech names are one bet; the sector cap and the 0.8 correlation rule in `portfolio-heat` decide, not the tickers.
- Chasing: entering far above the planned limit because the name is running converts edge into slippage.
- Averaging down into a broken thesis. A planned later tranche into an intact core name is not averaging down.

Crypto is not an extra stock slot: crypto pairs live in the separate capped sleeve, so load `crypto-sleeve` before sizing any crypto order.
