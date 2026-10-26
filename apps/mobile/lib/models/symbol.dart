import 'package:json_annotation/json_annotation.dart';

import 'account.dart';
import 'journal.dart';
import 'market.dart';
import 'notes.dart';
import 'orders.dart';

part 'symbol.g.dart';

// Unknown stop sources read as thesis (the agent's own invalidation level).
enum StopSource {
  @JsonValue('held')
  held,
  @JsonValue('robinhood')
  robinhood,
  @JsonValue('thesis')
  thesis,
}

@JsonSerializable(createToJson: false)
class SymbolIndicators {
  const SymbolIndicators({
    this.sma20,
    this.sma50,
    this.sma200,
    this.rsi14,
    this.atr14,
    this.avgDollarVolume,
    this.return1m,
    this.return3m,
    this.high52w,
    this.low52w,
  });

  factory SymbolIndicators.fromJson(Map<String, dynamic> json) =>
      _$SymbolIndicatorsFromJson(json);

  final double? sma20;
  final double? sma50;
  final double? sma200;
  final double? rsi14;
  final double? atr14;
  final double? avgDollarVolume;

  /// Percent, like TrendRow.
  final double? return1m;
  final double? return3m;
  final double? high52w;
  final double? low52w;
}

@JsonSerializable(createToJson: false)
class NextEarnings {
  const NextEarnings({required this.date, this.time});

  factory NextEarnings.fromJson(Map<String, dynamic> json) =>
      _$NextEarningsFromJson(json);

  final String date;
  final String? time;
}

@JsonSerializable(createToJson: false)
class StopInfo {
  const StopInfo({required this.price, required this.source});

  factory StopInfo.fromJson(Map<String, dynamic> json) =>
      _$StopInfoFromJson(json);

  final double price;
  @JsonKey(unknownEnumValue: StopSource.thesis)
  final StopSource source;
}

@JsonSerializable(createToJson: false)
class SymbolDetail {
  const SymbolDetail({
    required this.symbol,
    this.name,
    this.quote,
    this.position,
    required this.history,
    required this.indicators,
    this.thesis,
    required this.orders,
    required this.journal,
    this.nextEarnings,
    this.stop,
  });

  factory SymbolDetail.fromJson(Map<String, dynamic> json) =>
      _$SymbolDetailFromJson(json);

  final String symbol;
  final String? name;
  final Quote? quote;
  final Position? position;
  final PriceHistory history;
  final SymbolIndicators indicators;

  /// `theses/<SYMBOL>.md` from the agent's notes, when it exists.
  final NoteContent? thesis;
  final List<OrderRecord> orders;
  final List<JournalEntry> journal;
  final NextEarnings? nextEarnings;
  final StopInfo? stop;
}
