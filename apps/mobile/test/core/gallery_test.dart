import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/core/gallery/design_gallery.dart';

void main() {
  for (final b in Brightness.values) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('gallery lays out without errors: ${b.name} at text scale $scale, 360x800', (t) async {
        t.view.physicalSize = const Size(360, 800);
        t.view.devicePixelRatio = 1;
        addTearDown(t.view.reset);
        await t.pumpWidget(MaterialApp(
          theme: buildLongbowTheme(b),
          builder: (ctx, child) => MediaQuery(data: MediaQuery.of(ctx).copyWith(textScaler: TextScaler.linear(scale)), child: child!),
          home: const DesignGallery(),
        ));
        await t.pump(const Duration(milliseconds: 100));
        expect(t.takeException(), isNull);

        // Scroll the whole page so every lazily built sliver is laid out.
        for (var i = 0; i < 40; i++) {
          await t.drag(find.byType(CustomScrollView), const Offset(0, -400));
          await t.pump(const Duration(milliseconds: 50));
          expect(t.takeException(), isNull, reason: 'overflow after scroll step $i');
        }
        // The last widget in the gallery was reached, so every sliver was laid out.
        expect(find.byType(CodeBlock), findsWidgets);
      });
    }
  }
}
