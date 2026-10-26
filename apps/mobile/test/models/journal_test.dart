import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('journal_parsesLiveEntries', () {
    final list =
        jsonDecode(File('test/fixtures/journal.json').readAsStringSync())
            as List;
    final entries = list
        .map((e) => JournalEntry.fromJson(e as Map<String, dynamic>))
        .toList();

    expect(entries, hasLength(4));
    expect(entries.map((e) => e.action).toList(), [
      JournalAction.hold,
      JournalAction.hold,
      JournalAction.hold,
      JournalAction.none,
    ]);
    expect(entries.first.summary, contains('Quick status check'));
    expect(entries.first.evidence, hasLength(2));
    // The "none" action entry carries no trade evidence.
    expect(entries.last.evidence, isEmpty);
  });
}
