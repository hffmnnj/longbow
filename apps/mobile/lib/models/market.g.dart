// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'market.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MarketClock _$MarketClockFromJson(Map<String, dynamic> json) => MarketClock(
  now: (json['now'] as num).toInt(),
  session: $enumDecode(
    _$MarketSessionEnumMap,
    json['session'],
    unknownValue: MarketSession.closed,
  ),
  isOpen: json['isOpen'] as bool,
  tradingDay: json['tradingDay'] as String,
  nextOpen: (json['nextOpen'] as num).toInt(),
  nextClose: (json['nextClose'] as num).toInt(),
  earlyClose: json['earlyClose'] as bool,
);

const _$MarketSessionEnumMap = {
  MarketSession.pre: 'pre',
  MarketSession.regular: 'regular',
  MarketSession.post: 'post',
  MarketSession.closed: 'closed',
};

Quote _$QuoteFromJson(Map<String, dynamic> json) => Quote(
  symbol: json['symbol'] as String,
  bid: (json['bid'] as num).toDouble(),
  ask: (json['ask'] as num).toDouble(),
  last: (json['last'] as num).toDouble(),
  at: (json['at'] as num).toInt(),
);

Bar _$BarFromJson(Map<String, dynamic> json) => Bar(
  date: json['date'] as String,
  open: (json['open'] as num).toDouble(),
  high: (json['high'] as num).toDouble(),
  low: (json['low'] as num).toDouble(),
  close: (json['close'] as num).toDouble(),
  volume: (json['volume'] as num).toDouble(),
);

PriceHistory _$PriceHistoryFromJson(Map<String, dynamic> json) => PriceHistory(
  symbol: json['symbol'] as String,
  bars: (json['bars'] as List<dynamic>)
      .map((e) => Bar.fromJson(e as Map<String, dynamic>))
      .toList(),
  source: json['source'] as String,
  asOf: (json['asOf'] as num).toInt(),
);
