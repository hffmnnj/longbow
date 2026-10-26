import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/app/gate.dart';
import 'package:longbow/data/data.dart';

import '../../app/app_harness.dart';

const _tried = [
  'https://very-long-machine-name.some-long-tailnet-name.ts.net:8443',
  'http://very-long-machine-name.some-long-tailnet-name.ts.net:4520',
  'http://100.101.102.103:4520',
];

void main() {
  testWidgets('connect_noHosts_textScale2At360x640_scrollsWithoutOverflow', (tester) async {
    await pumpApp(tester, const ConnectionGate(), locatorState: const NoHosts(), size: const Size(360, 640), textScale: 2.0);

    expect(tester.takeException(), isNull);
    final connect = find.widgetWithText(FilledButton, 'Connect');
    await tester.ensureVisible(connect);
    expect(tester.getSize(connect).height, greaterThanOrEqualTo(48));
  });

  testWidgets('connect_unreachable_textScale2At360x640_keepsEveryActionReachable', (tester) async {
    await pumpApp(tester, const ConnectionGate(), locatorState: const Unreachable(_tried, true), size: const Size(360, 640), textScale: 2.0);

    expect(tester.takeException(), isNull);
    for (final label in ['Retry', 'Open Tailscale']) {
      final button = find.widgetWithText(label == 'Retry' ? FilledButton : OutlinedButton, label);
      await tester.ensureVisible(button);
      await tester.pump(const Duration(milliseconds: 200));
      expect(tester.getSize(button).height, greaterThanOrEqualTo(48), reason: label);
    }
    await tester.ensureVisible(find.text('What was tried'));
    await tester.tap(find.text('What was tried'));
    await settle(tester);
    expect(tester.takeException(), isNull, reason: 'long URLs wrap');
    expect(find.text(_tried.first), findsOneWidget);
  });

  testWidgets('connect_tablet_keepsTheFormInAReadableColumn', (tester) async {
    await pumpApp(tester, const ConnectionGate(), locatorState: const NoHosts(), size: const Size(840, 900));

    final field = tester.getSize(find.byType(TextField));
    expect(field.width, lessThanOrEqualTo(440));
    expect(tester.getCenter(find.byType(TextField)).dx, closeTo(420, 1));
  });
}
