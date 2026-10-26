import 'package:json_annotation/json_annotation.dart';

part 'journal.g.dart';

// Unknown actions read as none so the app never implies a trade happened.
enum JournalAction {
  @JsonValue('hold')
  hold,
  @JsonValue('buy')
  buy,
  @JsonValue('sell')
  sell,
  @JsonValue('watch')
  watch,
  @JsonValue('none')
  none,
}

@JsonSerializable(createToJson: false)
class JournalEntry {
  const JournalEntry({
    required this.id,
    required this.at,
    this.cycleId,
    required this.action,
    this.symbol,
    required this.summary,
    required this.rationale,
    this.confidence,
    required this.evidence,
    this.orderId,
    this.regime,
  });

  factory JournalEntry.fromJson(Map<String, dynamic> json) =>
      _$JournalEntryFromJson(json);

  final String id;
  final int at;
  final String? cycleId;
  @JsonKey(unknownEnumValue: JournalAction.none)
  final JournalAction action;
  final String? symbol;

  /// One-line headline.
  final String summary;
  final String rationale;

  /// 0..1
  final double? confidence;
  final List<String> evidence;
  final String? orderId;
  final String? regime;
}
