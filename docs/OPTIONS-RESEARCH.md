# Long options research playbook

This document is research guidance, not an execution or entitlement path.
Longbow cannot submit, approve, or exercise an option. The existing equity and
crypto order controls are unchanged. No options edge has been established for
this account.

## Read-only tools

- `rh_compare_puts` compares one to four exact put strikes at one current or
  future expiration. It returns the quote time, displayed bid and ask size, the
  per-contract spread and the premium estimated from the ask. A `recent` quote
  came from the current regular session and is no more than two minutes old;
  other contracts are `incomplete`, `outside-regular-session` or
  `stale-or-unverified`. The premium and break-even exclude fees, and a quote or
  displayed size is not a fill guarantee. A strike without a unique active,
  tradable instrument reports a reason instead.
- `rh_options_readiness` reports options entitlement and Robinhood's manual
  approval setting for the dedicated MCP account without exposing the account
  number. Its `longbowExecution` field is `unavailable`; entitlement is not
  permission to trade.
- `rh_preview_long_option` is a non-executing Robinhood preview of one exact
  standard, 100-multiplier equity call or put. It requires regular hours, an
  expiration after today, Level 2 or 3 approval, and a match on the instrument
  and chain. It returns `kind: preview-only`, a premium or limit-proceeds figure
  that excludes fees, Robinhood's approval flag and a count of pre-trade alerts. It
  creates no order and no approval request. Only the owner can request it.
- `rh_get_option_instruments`, `rh_get_option_quotes` and `rh_get_option_chains`
  are read-only data. `rh_get_option_historicals` returns OHLC bars, not bid and
  ask, so it cannot supply an executable quote.
- `submit_order` and the risk engine do not accept options.

The preview also exposes a `sell-to-close` side for closing an existing long
position. Longbow opens no option positions, so that side is not used for new
exposure. Selling to open is never available.

## Evaluation checklist

Start with the alternative, not the option: cash, or trimming the underlying
position, is the default. Compare one specific long call or put with that
default and reject the option unless it is the cheaper, better-defined way to
express the same view.

1. Thesis and horizon. A call needs one dated catalyst (earnings, product,
   regulatory or macro event) and what would falsify it. A put needs a named
   hedge objective: which holding, which loss, and which horizon. A missing date
   or objective is a rejection.
2. Expiration. The contract must span the catalyst or hedge horizon with at
   least two weeks of buffer. Never use 0DTE or a same-week expiry, and reject an
   expiration before the event.
3. Quote. Require a fresh regular-session bid and ask, the quote time, and
   displayed bid and ask size. Reject a broad or wide spread, a stale or missing
   quote, or a quote with no displayed size. A mid, last price, OHLC bar or a
   price merely touched is not an executable quote.
4. Cost and size. Premium is `ask × 100 × contracts`; add fees for the all-in
   debit. Size in whole contracts against the approved premium budget: the
   owner's stated option budget, otherwise the engine's per-trade risk allowance
   treated as a full-premium loss. If no budget can be established, or the
   smallest usable contract's premium plus fees exceeds it, reject instead of
   choosing a cheaper, worse strike.
5. Scenarios. Show net results after premium and fees for no move, the thesis
   target, and total loss. Stress the planned exit at an unchanged price with
   time decay (theta) and an implied-volatility crush after the event. Label
   implied volatility and Greeks as assumptions; never present invented values
   as tool facts.
6. Risk. The option itself can lose the full premium plus fees, even when the
   underlying moves the right way. Exercise can create separate stock exposure
   and further losses; a planned exit does not guarantee a fill.
7. Plan. Entry is limit-only, never a market order, and this harness does not
   submit it. Name the exact contract, quantity, limit, quote time and
   expiration. Set a timed exit well before expiration and state the thesis
   invalidation. State the hold/no-action alternative and why the option beats
   it; if it does not, recommend cash or trimming the stock.

## Contract arithmetic

All figures are per contract, or per share where stated. `debit` includes the
premium and every fee.

```text
premium          = ask × 100 × contracts
debit            = premium + fees
call break-even  = strike + debit / (100 × contracts)
put break-even   = strike - debit / (100 × contracts)

call net at expiry = max(0, underlying - strike) × 100 × contracts - debit
put net at expiry  = max(0, strike - underlying) × 100 × contracts - debit
```

One call at a $100 strike with a $1.30 ask, one contract and $1 of fees has a
$130 premium, a $131 debit and a $101.31 break-even. A no-move expiry loses the
full $131; at $105 the payoff is $500 and the net is $369. One put at the same
strike with a $2.10 ask, one contract and $1 of fees has a $211 debit and a
$97.89 break-even; at $95 the net is $289.

Before expiry, time value and implied volatility also move the price. A no-move
scenario usually loses time value, and an implied-volatility crush can produce a
loss even when the underlying moves toward the strike.

## Reject when

- The thesis has no dated catalyst or named hedge objective.
- Expiration is before the catalyst, 0DTE, or in the same week.
- The quote is stale, missing, outside a regular session, has no displayed size,
  or the spread is broad or wide.
- No premium budget can be established, or the smallest usable whole contract's
  premium plus fees exceeds it.
- The plan has no limit entry, no timed exit well before expiration, or no
  thesis invalidation.
- Cash, holding, or trimming the underlying is the better expression.
- The idea needs selling to open, exercise, assignment, shorting, margin,
  multi-leg orders, or any execution the harness does not support.

## Preview is not execution

`rh_options_readiness` may report that previews are possible while
`longbowExecution` remains `unavailable`. `rh_preview_long_option` can confirm
the exact contract, Robinhood approval requirement and pre-trade alerts, but its
result is still only a preview. It never submits an order, requests the owner's
approval or reserves a contract. The existing equity and crypto order paths
are unchanged.

## Paper replay

`docs/PAPER-PUT-REPLAY.md` documents the offline long-put replay. It requires
separately timestamped bid and ask quotes and pre-declared limit orders, and it
models a fill only when a later quote inside the same regular session satisfies
the limit and displayed size. It never infers an option fill from underlying
OHLC, bars or prices touched, and it rejects a position that remains open instead
of settling, exercising or assigning it. Replay P&L includes the configured fees
and stays within the configured premium cap.

A replay is a check of a rule on a fixed tape, not evidence that buying options
earns after costs. Do not promise, extrapolate or annualize replay profit, and
do not cite a replay, an equity base rate, or a single profitable trade as a
proven options edge.

## Execution verification

The options integration tests exercise `submit_order`, the existing approval
route, the risk gate, and the Robinhood adapter using a fixture transport. They
do not enable placement in the running service. A fresh approval is required
after a server restart or an account change; a previously dispatched ticket is
never retried automatically. A broker order ID or an exact echoed client
reference is required to reconcile a lost response. Matching the contract,
quantity and time is not proof that the broker accepted this order.

Broker automatic exercise can create a stock position. An expiration alert or a
submitted close is not a guaranteed exit, and the current Trading MCP does not
advertise a Do Not Exercise request. No stock/ETF option opening is wired to
production without a verified way to protect and reconcile that exposure.
Robinhood's published clearing and regulatory fee is $0.04 per stock/ETF option
contract, on both sides; it is not a guarantee of all-in costs.
