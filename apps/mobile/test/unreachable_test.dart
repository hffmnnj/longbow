import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/main.dart';

void main() {
  testWidgets('unreachable screen shows message and a Retry button',
      (tester) async {
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        home: LongbowHome(
          initialStatus: LongbowStatus.unreachable,
          autoRetry: false,
          debugReloadOverride: () async {
            retried = true;
          },
        ),
      ),
    );

    expect(find.text("Can't reach Longbow"), findsOneWidget);
    expect(
      find.text('Check that Tailscale is connected.'),
      findsOneWidget,
    );
    expect(find.widgetWithText(FilledButton, 'Retry'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Retry'));
    await tester.pump();
    expect(retried, isTrue);
  });
}
