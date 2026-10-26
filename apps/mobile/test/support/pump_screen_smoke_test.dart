import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart';

import 'pump_screen.dart';

void main() {
  testWidgets('pumpScreen provides theme and a live store', (tester) async {
    final h = (await tester.runAsync(StoreHarness.create))!;
    addTearDown(h.dispose);
    await tester.runAsync(h.start);
    await pumpScreen(
      tester,
      Consumer(builder: (context, ref, _) {
        final loaded = ref.watch(harnessProvider.select((s) => s.loaded));
        return Scaffold(body: Text(loaded ? 'loaded' : 'loading'));
      }),
      harness: h,
    );
    expect(find.text('loaded'), findsOneWidget);
  });
}
