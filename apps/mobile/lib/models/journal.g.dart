// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'journal.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

JournalEntry _$JournalEntryFromJson(Map<String, dynamic> json) => JournalEntry(
  id: json['id'] as String,
  at: (json['at'] as num).toInt(),
  cycleId: json['cycleId'] as String?,
  action: $enumDecode(
    _$JournalActionEnumMap,
    json['action'],
    unknownValue: JournalAction.none,
  ),
  symbol: json['symbol'] as String?,
  summary: json['summary'] as String,
  rationale: json['rationale'] as String,
  confidence: (json['confidence'] as num?)?.toDouble(),
  evidence: (json['evidence'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  orderId: json['orderId'] as String?,
  regime: json['regime'] as String?,
);

const _$JournalActionEnumMap = {
  JournalAction.hold: 'hold',
  JournalAction.buy: 'buy',
  JournalAction.sell: 'sell',
  JournalAction.watch: 'watch',
  JournalAction.none: 'none',
};
