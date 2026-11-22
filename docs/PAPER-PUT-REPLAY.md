# Paper long-put replay

`apps/server/scripts/replay-long-puts.ts` runs one offline, deterministic long-put round
trip from explicit option quotes. It reads one local JSON file, calls the synchronous
`replayLongPuts` core in `apps/server/src/sim/put-replay.ts`, and prints the JSON result.

It sends no order, makes no network or Robinhood call, reads no harness database, and
derives no fill from historical daily OHLC. The checked-in fixture is synthetic data that
exercises the rules. It is not archived SPY evidence and says nothing about real fills.

## Rules

- Cash only, long standard puts only. Buy to open and sell to close. One contract controls
  100 shares (`multiplier` is 100). No writing, spreads, margin, exercise, assignment, or
  automatic expiration settlement.
- All prices are integer cents per share. Premium for one contract is
  `priceCents × multiplier`. `feePerContractCents` is charged per contract on each filled
  order.
- A buy must fit in settled cash after premium and fee, and its premium plus fee must stay
  within `maxPremiumAtRiskCents`. Sale proceeds are included in equity but cannot fund
  another buy before the next clearing session (T+1). The replay only accepts dates on
  or after May 28, 2024 within the project's NYSE calendar coverage.
- An order needs a qualifying quote update that is strictly after the order time and no
  more than 60 seconds later. For a buy, the quote's ask must be at or below the limit and
  its ask size must cover the remaining quantity. For a sell, the bid must be at or above
  the limit and its bid size must cover the remaining quantity. Quotes at or before the
  order time are ignored.
- Every order and every quote must fall inside a NYSE regular session (09:30 to the session
  close, New York time) and before the contract expiry. An order's qualifying quote must
  come from the same regular session as the order.
- The position must be closed by a qualifying sell before expiry and before the session
  cutoff that applies to the sell order. A position still open when the replay ends is
  unscorable: the replay reports an error instead of settling, exercising, or assigning the
  put.

The replay core validates the document. Malformed input, a missing or non-regular file, a
file over 8 MiB, or an unscorable replay exit nonzero with a concise
`replay-long-puts: <message>` error on stderr.

## Paired holdout

Run `node apps/server/scripts/score-put-holdout.ts /path/to/holdout.json` to compare a
put hedge with the same stock positions and unspent option cash, and with an all-cash
reference with no interest. This is a non-compounding comparison across independent
windows, not a strategy generator or a calculation of a live portfolio's return.

The file contains a `windows` array in chronological order. Each entry has a unique
`id`, `startDate`, `endDate`, `startingEquityCents`, `optionCashSleeveCents`,
`feePerContractCents`, and `stock` with `startValueCents` and `endValueCents`. Include
one `put` with the contract shape below and `quotes` and `orders` in the same format
as the single-window replay. Supply `quoteProvenance` with `source`, `quoteDate`,
and `kind` (`observed` or `fixture`). Window quotes and orders must belong to that
contract. Quote provenance is supplied by the operator, not independently verified.

Fix candidate-selection and exit rules before looking at the holdout, including dates
with no qualifying trade. Use prior observations only to choose a contract, order
time and limit, and a later observed quote to test that order. Keep the stock
holdings and valuation times identical in both invested arms. Compare the net
hedge difference after spreads and fees, not gross option proceeds. Include
incomplete exits in the reported denominator: the scorer marks them unscorable,
rather than assuming a liquidation or a zero return.

Robinhood historical option candles are not a bid/ask tape. Do not substitute them
for executable quotes. Use historical OPRA quotes with timestamps and displayed
bid/ask size. A vendor sample or synthetic fixture tests the software only.

## Input

The input is one JSON object with exactly this shape:

```json
{
  "startingCashCents": 120000,
  "maxPremiumAtRiskCents": 15000,
  "feePerContractCents": 5,
  "contracts": [
    {
      "id": "spy-put",
      "underlying": "SPY",
      "strikeCents": 65000,
      "expiresAt": "2025-12-19T21:00:00Z",
      "multiplier": 100
    }
  ],
  "quotes": [
    {
      "at": "2025-11-21T15:00:00Z",
      "contractId": "spy-put",
      "bidCents": 88,
      "askCents": 98,
      "bidSize": 1,
      "askSize": 1
    },
    {
      "at": "2025-11-21T15:00:30Z",
      "contractId": "spy-put",
      "bidCents": 90,
      "askCents": 100,
      "bidSize": 1,
      "askSize": 1
    },
    {
      "at": "2025-11-21T15:05:00Z",
      "contractId": "spy-put",
      "bidCents": 90,
      "askCents": 100,
      "bidSize": 1,
      "askSize": 1
    },
    {
      "at": "2025-11-21T15:05:30Z",
      "contractId": "spy-put",
      "bidCents": 90,
      "askCents": 100,
      "bidSize": 1,
      "askSize": 1
    }
  ],
  "orders": [
    {
      "at": "2025-11-21T15:00:10Z",
      "contractId": "spy-put",
      "side": "buy",
      "quantity": 1,
      "limitCents": 100
    },
    {
      "at": "2025-11-21T15:05:10Z",
      "contractId": "spy-put",
      "side": "sell",
      "quantity": 1,
      "limitCents": 90
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `startingCashCents` | Starting cash in cents. |
| `maxPremiumAtRiskCents` | Maximum buy premium plus fees at risk, in cents. |
| `feePerContractCents` | Fee per contract charged on each filled order, in cents. |
| `contracts[].id` | Unique contract id referenced by quotes and orders. |
| `contracts[].underlying` | Underlying symbol. |
| `contracts[].strikeCents` | Strike price in cents per share. |
| `contracts[].expiresAt` | Expiry as an ISO-8601 UTC instant. |
| `contracts[].multiplier` | Shares per contract; 100 for a standard put. |
| `quotes[].at` | Quote timestamp as an ISO-8601 UTC instant. |
| `quotes[].contractId` | Contract the quote belongs to. |
| `quotes[].bidCents`, `askCents` | Bid and ask in cents per share; a crossed quote is invalid. |
| `quotes[].bidSize`, `askSize` | Contracts available at the bid and ask. |
| `orders[].at` | Order timestamp as an ISO-8601 UTC instant. |
| `orders[].contractId` | Contract to trade. |
| `orders[].side` | `buy` or `sell`. |
| `orders[].quantity` | Whole contracts to trade. |
| `orders[].limitCents` | Limit price in cents per share. |

Timestamps use UTC `Z` instants. Unknown fields are rejected. The fixture lists quotes and
orders chronologically.

## Checked-in fixture

`apps/server/scripts/fixtures/paper-put-replay.json` is synthetic: one SPY put, four
quotes, and two orders between 15:00 and 15:06 UTC on Friday 21 November 2025 (10:00 New
York time, inside one regular session). The contract expires 19 December 2025 at 21:00 UTC.
A quote lands just before each order and is ignored; the next quote for each order arrives
20 seconds later, inside the 60-second window.

| UTC | Event |
| --- | --- |
| 15:00:00 | Quote bid 88 / ask 98. Before the buy order, so ignored. |
| 15:00:10 | Buy 1 contract, limit 100 cents. |
| 15:00:30 | Quote bid 90 / ask 100. First qualifying update for the buy, 20 seconds later. |
| 15:05:00 | Quote bid 90 / ask 100. Before the sell order, so ignored. |
| 15:05:10 | Sell 1 contract, limit 90 cents. |
| 15:05:30 | Quote bid 90 / ask 100. First qualifying update for the sell, 20 seconds later. |

At the orders' intended limits the example spends and receives:

| Step | Cents |
| --- | ---: |
| Starting cash | 120000 |
| Buy premium: 100 × 100 | −10000 |
| Buy fee: 1 × 5 | −5 |
| Sell premium: 90 × 100 | +9000 |
| Sell fee: 1 × 5 | −5 |
| Ending cash | 118990 |
| Realized | −1010 |

That is $100.00 premium and $0.05 fee out, $90.00 premium less $0.05 fee in, for a
$10.10 loss and $1,189.90 ending cash including $89.95 of sale proceeds. The sale proceeds
settle on the next trading day, so they are not spendable in the replay's ending settled
cash. The $100.00 premium is under both the $1,200.00 starting cash and the $150.00 premium
cap. These figures use the intended limits; they do not assert a real fill.

## Run

From the repository root:

```sh
node apps/server/scripts/replay-long-puts.ts apps/server/scripts/fixtures/paper-put-replay.json
```

Or from `apps/server`:

```sh
node scripts/replay-long-puts.ts scripts/fixtures/paper-put-replay.json
```

The command prints one JSON object on stdout. The result schema is internal and may
change; treat the fixture as a smoke check for a completed round trip, not a stable field
layout.
