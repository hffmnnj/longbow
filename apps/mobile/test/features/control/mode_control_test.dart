import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/control/mode_control.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

StatusResponse _fixture() => StatusResponse.fromJson(
      jsonDecode(File('test/fixtures/status.json').readAsStringSync())
          as Map<String, dynamic>,
    );

StatusResponse _withMode(TradingMode mode, {bool killSwitch = false}) {
  final base = _fixture();
  return base.copyWith(
    settings: base.settings.copyWith(mode: mode, killSwitch: killSwitch),
  );
}

Future<StoreHarness> _start(
  WidgetTester tester,
  StatusResponse status,
  List<SettingsPatch> patches,
) async {
  final api = FakeApi()..defaults();
  api.on('status', () async => status);
  api.handlers['patchSettings'] = (inv) async {
    patches.add(inv.positionalArguments[0] as SettingsPatch);
    return null;
  };
  final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
  addTearDown(h.dispose);
  await tester.runAsync(h.start);
  await pumpScreen(tester, const ModeControl(), harness: h);
  await tester.pump();
  return h;
}

Future<void> _settle(WidgetTester tester, StoreHarness h) async {
  await tester.runAsync(() => h.pump());
  await tester.pump();
  await tester.pump();
}

void main() {
  group('ModeControl', () {
    testWidgets('shows the selected mode description', (tester) async {
      await _start(tester, _withMode(TradingMode.off), []);
      expect(
        find.text('The agent reads and reasons. It does not propose orders.'),
        findsOneWidget,
      );
    });

    testWidgets('off to approve patches directly with a toast', (tester) async {
      final patches = <SettingsPatch>[];
      final h = await _start(tester, _withMode(TradingMode.off), patches);
      await tester.tap(find.text('Approve'));
      await _settle(tester, h);
      expect(find.text('Switch to Auto?'), findsNothing);
      expect(patches, hasLength(1));
      expect(patches.single.mode, TradingMode.approve);
      expect(
        h.toasts.where((t) => t.title == 'Orders wait for you'),
        isNotEmpty,
      );
    });

    testWidgets('moving to auto asks for confirmation', (tester) async {
      final patches = <SettingsPatch>[];
      final h = await _start(tester, _withMode(TradingMode.approve), patches);
      await tester.tap(find.text('Auto'));
      await tester.pump();
      expect(find.text('Switch to Auto?'), findsOneWidget);
      expect(
        find.text(
          'Risk-approved orders will be placed on Robinhood immediately, without waiting for you. The kill switch still blocks everything.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Enable Auto'));
      await _settle(tester, h);
      expect(patches, hasLength(1));
      expect(patches.single.mode, TradingMode.auto);
      expect(
        h.toasts.where((t) => t.title == 'Auto mode on'),
        isNotEmpty,
      );
    });

    testWidgets('cancelling the auto dialog patches nothing', (tester) async {
      final api = FakeApi()..defaults();
      api.on('status', () async => _withMode(TradingMode.approve));
      final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
      addTearDown(h.dispose);
      await tester.runAsync(h.start);
      await pumpScreen(tester, const ModeControl(), harness: h);
      await tester.pump();
      await tester.tap(find.text('Auto'));
      await tester.pump();
      await tester.tap(find.text('Cancel'));
      await _settle(tester, h);
      expect(api.count('patchSettings'), 0);
    });

    testWidgets('locked with an explanation under the kill switch',
        (tester) async {
      final api = FakeApi()..defaults();
      api.on(
        'status',
        () async => _withMode(TradingMode.approve, killSwitch: true),
      );
      final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
      addTearDown(h.dispose);
      await tester.runAsync(h.start);
      await pumpScreen(tester, const ModeControl(), harness: h);
      await tester.pump();
      expect(
        find.text('Mode is locked while the kill switch is engaged.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Off'), warnIfMissed: false);
      await _settle(tester, h);
      expect(api.count('patchSettings'), 0);
    });

    testWidgets('failed patch toasts the store error', (tester) async {
      final api = FakeApi()..defaults();
      api.on('status', () async => _withMode(TradingMode.off));
      api.fail('patchSettings', const ApiError(500, 'nope'));
      final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
      addTearDown(h.dispose);
      await tester.runAsync(h.start);
      await pumpScreen(tester, const ModeControl(), harness: h);
      await tester.pump();
      await tester.tap(find.text('Approve'));
      await _settle(tester, h);
      expect(h.toasts.where((t) => t.body.contains('nope')), isNotEmpty);
    });
  });
}
