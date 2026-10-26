import 'package:json_annotation/json_annotation.dart';

part 'market.g.dart';

// Unknown sessions read as closed: the app must never assume the market is open.
enum MarketSession {
  @JsonValue('pre')
  pre,
  @JsonValue('regular')
  regular,
  @JsonValue('post')
  post,
  @JsonValue('closed')
  closed,
}

// Unknown ranges fall back to 3m, the app's default chart range.
enum HistoryRange {
  @JsonValue('1m')
  oneMonth,
  @JsonValue('3m')
  threeMonths,
  @JsonValue('6m')
  sixMonths,
  @JsonValue('1y')
  oneYear,
  @JsonValue('2y')
  twoYears,
  @JsonValue('5y')
  fiveYears,
}

@JsonSerializable(createToJson: false)
class MarketClock {
  const MarketClock({
    required this.now,
    required this.session,
    required this.isOpen,
    required this.tradingDay,
    required this.nextOpen,
    required this.nextClose,
    required this.earlyClose,
  });

  factory MarketClock.fromJson(Map<String, dynamic> json) =>
      _$MarketClockFromJson(json);

  final int now;
  @JsonKey(unknownEnumValue: MarketSession.closed)
  final MarketSession session;

  /// True only during the regular session of an NYSE trading day.
  final bool isOpen;

  /// ET date of the current or next trading day, YYYY-MM-DD.
  final String tradingDay;
  final int nextOpen;
  final int nextClose;
  final bool earlyClose;
}

@JsonSerializable(createToJson: false)
class Quote {
  const Quote({
    required this.symbol,
    required this.bid,
    required this.ask,
    required this.last,
    required this.at,
  });

  factory Quote.fromJson(Map<String, dynamic> json) => _$QuoteFromJson(json);

  final String symbol;
  final double bid;
  final double ask;
  final double last;
  final int at;
}

/// One daily bar; `date` is the ET trading date YYYY-MM-DD.
@JsonSerializable(createToJson: false)
class Bar {
  const Bar({
    required this.date,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
    required this.volume,
  });

  factory Bar.fromJson(Map<String, dynamic> json) => _$BarFromJson(json);

  final String date;
  final double open;
  final double high;
  final double low;
  final double close;
  final double volume;
}

@JsonSerializable(createToJson: false)
class PriceHistory {
  const PriceHistory({
    required this.symbol,
    required this.bars,
    required this.source,
    required this.asOf,
  });

  factory PriceHistory.fromJson(Map<String, dynamic> json) =>
      _$PriceHistoryFromJson(json);

  final String symbol;

  /// Oldest first.
  final List<Bar> bars;
  final String source;
  final int asOf;
}
