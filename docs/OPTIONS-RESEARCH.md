# Robinhood put research

Longbow can compare up to four exact strikes for one listed put expiration
with `rh_compare_puts`. The result shows the quote time, displayed sizes, spread
and premium for one 100-share contract. A quote marked recent came from the
current regular session and is at most two minutes old; it is not an execution
price. Robinhood may report some contracts as missing or ambiguous.

The comparison tool is installed only when Robinhood advertises both the
instrument and quote readers. `rh_options_readiness` checks options entitlement
and Robinhood's manual approval setting on the dedicated MCP account without
exposing the account number.

`rh_preview_long_option` is a broker preview of a single equity call or put, not
an order. It checks Level 2 or 3 entitlement, exact instrument identity, a
100-multiplier chain with one underlying and no cash deliverable, regular hours
and the later-than-today expiration before requesting the preview. A
missing entitlement, pre-trade alert or unknown response is not an approval.
The raw review, placement, cancellation and exercise tools remain unavailable
to the agent. The equity and crypto order gate is unchanged.

Robinhood's `get_option_historicals` returns historical OHLC, not bid and ask.
For an offline execution replay, use separately sourced timestamped quotes.
