# Robinhood put research

Longbow can compare up to four exact strikes for one listed put expiration
with `rh_compare_puts`. The result shows the quote time, displayed sizes, spread
and premium for one 100-share contract. A quote marked recent came from the
current regular session and is at most two minutes old; it is not an execution
price. Robinhood may report some contracts as missing or ambiguous.

The tool is installed only when Robinhood advertises both the instrument and
quote readers. Option placement, review, cancellation and exercise are not
agent tools. The equity and crypto order gate is unchanged.

Robinhood's `get_option_historicals` returns historical OHLC, not bid and ask.
For an offline execution replay, use separately sourced timestamped quotes.
