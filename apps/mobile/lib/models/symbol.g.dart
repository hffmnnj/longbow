// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'symbol.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SymbolIndicators _$SymbolIndicatorsFromJson(Map<String, dynamic> json) =>
    SymbolIndicators(
      sma20: (json['sma20'] as num?)?.toDouble(),
      sma50: (json['sma50'] as num?)?.toDouble(),
      sma200: (json['sma200'] as num?)?.toDouble(),
      rsi14: (json['rsi14'] as num?)?.toDouble(),
      atr14: (json['atr14'] as num?)?.toDouble(),
      avgDollarVolume: (json['avgDollarVolume'] as num?)?.toDouble(),
      return1m: (json['return1m'] as num?)?.toDouble(),
      return3m: (json['return3m'] as num?)?.toDouble(),
      high52w: (json['high52w'] as num?)?.toDouble(),
      low52w: (json['low52w'] as num?)?.toDouble(),
    );

NextEarnings _$NextEarningsFromJson(Map<String, dynamic> json) =>
    NextEarnings(date: json['date'] as String, time: json['time'] as String?);

StopInfo _$StopInfoFromJson(Map<String, dynamic> json) => StopInfo(
  price: (json['price'] as num).toDouble(),
  source: $enumDecode(
    _$StopSourceEnumMap,
    json['source'],
    unknownValue: StopSource.thesis,
  ),
);

const _$StopSourceEnumMap = {
  StopSource.held: 'held',
  StopSource.robinhood: 'robinhood',
  StopSource.thesis: 'thesis',
};

SymbolDetail _$SymbolDetailFromJson(Map<String, dynamic> json) => SymbolDetail(
  symbol: json['symbol'] as String,
  name: json['name'] as String?,
  quote: json['quote'] == null
      ? null
      : Quote.fromJson(json['quote'] as Map<String, dynamic>),
  position: json['position'] == null
      ? null
      : Position.fromJson(json['position'] as Map<String, dynamic>),
  history: PriceHistory.fromJson(json['history'] as Map<String, dynamic>),
  indicators: SymbolIndicators.fromJson(
    json['indicators'] as Map<String, dynamic>,
  ),
  thesis: json['thesis'] == null
      ? null
      : NoteContent.fromJson(json['thesis'] as Map<String, dynamic>),
  orders: (json['orders'] as List<dynamic>)
      .map((e) => OrderRecord.fromJson(e as Map<String, dynamic>))
      .toList(),
  journal: (json['journal'] as List<dynamic>)
      .map((e) => JournalEntry.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextEarnings: json['nextEarnings'] == null
      ? null
      : NextEarnings.fromJson(json['nextEarnings'] as Map<String, dynamic>),
  stop: json['stop'] == null
      ? null
      : StopInfo.fromJson(json['stop'] as Map<String, dynamic>),
);
