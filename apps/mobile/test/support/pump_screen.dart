import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';

import '../data/fake_api.dart';

export '../data/fake_api.dart';
export '../data/model_builders.dart';

/// Pumps [child] inside the real Longbow theme with the data layer wired to
/// the fakes in [harness] (see test/data/fake_api.dart). Create the harness
/// with `await StoreHarness.create()`, script `harness.api` with `on(...)`,
/// then call `await tester.runAsync(harness.start)` before pumping if the
/// screen reads the harness store.
///
/// The surface is a phone (360x800) by default; pass [size] and [textScale]
/// to test other classes and accessibility sizes.
Future<void> pumpScreen(
  WidgetTester tester,
  Widget child, {
  required StoreHarness harness,
  Brightness brightness = Brightness.dark,
  Size size = const Size(360, 800),
  double textScale = 1.0,
}) async {
  tester.view.physicalSize = size * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: harness.container,
      child: MaterialApp(
        theme: buildLongbowTheme(brightness),
        builder: (context, app) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
          child: app!,
        ),
        home: child,
      ),
    ),
  );
  await tester.pump();
}
