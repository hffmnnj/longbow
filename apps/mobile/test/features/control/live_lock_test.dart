import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/control/live_lock.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

Future<StoreHarness> _start(
  WidgetTester tester, {
  required bool liveTrading,
}) async {
  final base = StatusResponse.fromJson(
    jsonDecode(File('test/fixtures/status.json').readAsStringSync())
        as Map<String, dynamic>,
  );
  final api = FakeApi()..defaults();
  api.on('status', () async => base.copyWith(liveTrading: liveTrading));
  final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
  addTearDown(h.dispose);
  await tester.runAsync(h.start);
  await pumpScreen(
    tester,
    const Scaffold(body: Center(child: LiveLockChip())),
    harness: h,
  );
  await tester.pump();
  return h;
}

void main() {
  group('LiveLockChip', () {
    testWidgets('renders nothing once live trading is on', (tester) async {
      await _start(tester, liveTrading: true);
      expect(find.text('Read-only'), findsNothing);
    });

    testWidgets('warn chip opens the lock explainer', (tester) async {
      await _start(tester, liveTrading: false);
      expect(find.text('Read-only'), findsOneWidget);
      await tester.tap(find.text('Read-only'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Live trading locked'), findsOneWidget);
      expect(
        find.textContaining('HARNESS_LIVE_TRADING'),
        findsOneWidget,
      );
    });
  });
}
