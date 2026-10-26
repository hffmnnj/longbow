import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/features/control/kill_switch.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

StatusResponse _fixture({required bool killSwitch}) {
  final base = StatusResponse.fromJson(
    jsonDecode(File('test/fixtures/status.json').readAsStringSync())
        as Map<String, dynamic>,
  );
  return base.copyWith(
    settings: base.settings.copyWith(killSwitch: killSwitch),
  );
}

Future<StoreHarness> _start(
  WidgetTester tester, {
  required StatusResponse Function() readStatus,
  bool compact = false,
  List<SettingsPatch>? patches,
}) async {
  final api = FakeApi()..defaults();
  api.on('status', () async => readStatus());
  api.handlers['patchSettings'] = (inv) async {
    patches?.add(inv.positionalArguments[0] as SettingsPatch);
    return null;
  };
  final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
  addTearDown(h.dispose);
  await tester.runAsync(h.start);
  await pumpScreen(
    tester,
    Scaffold(body: Center(child: KillSwitchButton(compact: compact))),
    harness: h,
  );
  await tester.pump();
  return h;
}

Future<void> _settle(WidgetTester tester, StoreHarness h) async {
  await tester.runAsync(() => h.pump());
  await tester.pump();
  await tester.pump();
}

void main() {
  group('KillSwitchButton', () {
    testWidgets('engage asks for confirmation then patches', (tester) async {
      final patches = <SettingsPatch>[];
      var current = _fixture(killSwitch: false);
      final h = await _start(
        tester,
        readStatus: () => current,
        patches: patches,
      );
      expect(find.text('Engage kill switch'), findsOneWidget);
      await tester.tap(find.text('Engage kill switch'));
      await tester.pump();
      expect(find.text('Engage the kill switch?'), findsOneWidget);
      expect(
        find.text('No order of any kind is sent. Research cycles keep running.'),
        findsOneWidget,
      );
      current = _fixture(killSwitch: true);
      await tester.tap(find.text('Engage kill switch').last);
      await _settle(tester, h);
      expect(patches, hasLength(1));
      expect(patches.single.killSwitch, isTrue);
      expect(
        h.toasts.where((t) => t.title == 'Kill switch engaged'),
        isNotEmpty,
      );
      expect(find.text('Kill switch engaged. Release'), findsOneWidget);
    });

    testWidgets('cancelling the engage dialog patches nothing',
        (tester) async {
      final api = FakeApi()..defaults();
      api.on('status', () async => _fixture(killSwitch: false));
      final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
      addTearDown(h.dispose);
      await tester.runAsync(h.start);
      await pumpScreen(
        tester,
        const Scaffold(body: KillSwitchButton()),
        harness: h,
      );
      await tester.pump();
      await tester.tap(find.text('Engage kill switch'));
      await tester.pump();
      await tester.tap(find.text('Cancel'));
      await tester.pump();
      await tester.pump();
      expect(api.count('patchSettings'), 0);
    });

    testWidgets('release is one tap with no dialog', (tester) async {
      final patches = <SettingsPatch>[];
      final h = await _start(
        tester,
        readStatus: () => _fixture(killSwitch: true),
        patches: patches,
      );
      expect(find.text('Kill switch engaged. Release'), findsOneWidget);
      await tester.tap(find.text('Kill switch engaged. Release'));
      await _settle(tester, h);
      expect(find.text('Engage the kill switch?'), findsNothing);
      expect(patches, hasLength(1));
      expect(patches.single.killSwitch, isFalse);
      expect(
        h.toasts.where((t) => t.title == 'Kill switch released'),
        isNotEmpty,
      );
    });

    testWidgets('compact variant labels itself and stays 48dp',
        (tester) async {
      await _start(
        tester,
        readStatus: () => _fixture(killSwitch: false),
        compact: true,
      );
      expect(find.bySemanticsLabel('Engage kill switch'), findsOneWidget);
      expect(find.byTooltip('Engage kill switch'), findsOneWidget);
      expect(find.text('Kill'), findsOneWidget);
      final box =
          tester.getRect(find.bySemanticsLabel('Engage kill switch'));
      expect(box.height, greaterThanOrEqualTo(48));
      expect(box.width, greaterThanOrEqualTo(48));
      await tester.tap(find.text('Kill'));
      await tester.pump();
      expect(find.text('Engage the kill switch?'), findsOneWidget);
    });
  });
}
