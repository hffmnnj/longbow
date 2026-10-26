import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/app/tab_stack.dart';
import 'package:longbow/core/core.dart';

Widget _host(int index, Set<int> visited, {bool disableAnimations = false}) {
  return MaterialApp(
    theme: buildLongbowTheme(Brightness.dark),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(disableAnimations: disableAnimations),
      child: child!,
    ),
    home: Scaffold(
      body: TabStack(
        index: index,
        visited: visited,
        builders: [
          (_) => ListView(key: const PageStorageKey('one'), children: [for (var i = 0; i < 60; i++) SizedBox(height: 60, child: Text('row $i'))]),
          (_) => const Center(child: Text('two')),
        ],
      ),
    ),
  );
}

void main() {
  testWidgets('tabStack_switchingAway_keepsScrollPositionOfTheTabYouReturnTo', (tester) async {
    await tester.pumpWidget(_host(0, {0}));
    await tester.drag(find.byType(ListView), const Offset(0, -900));
    await tester.pump();
    final scrolledTo = tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;
    expect(scrolledTo, greaterThan(800));

    await tester.pumpWidget(_host(1, {0, 1}));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('two'), findsOneWidget);
    expect(find.byType(ListView), findsNothing, reason: 'hidden tab is offstage');

    await tester.pumpWidget(_host(0, {0, 1}));
    await tester.pump(const Duration(milliseconds: 300));
    final after = tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;
    expect(after, scrolledTo);
  });

  testWidgets('tabStack_crossFade_overlapsThenSettles', (tester) async {
    await tester.pumpWidget(_host(0, {0}));
    await tester.pumpWidget(_host(1, {0, 1}));
    await tester.pump(const Duration(milliseconds: 100));

    final opacities = tester.widgetList<FadeTransition>(find.byType(FadeTransition, skipOffstage: false)).map((f) => f.opacity.value).where((v) => v > 0 && v < 1);
    expect(opacities, isNotEmpty, reason: 'both tabs are mid-fade at 100 ms');

    await tester.pump(const Duration(milliseconds: 250));
    expect(find.byType(ListView), findsNothing);
    expect(find.text('two'), findsOneWidget);
  });

  testWidgets('tabStack_reducedMotion_swapsInstantly', (tester) async {
    await tester.pumpWidget(_host(0, {0}, disableAnimations: true));
    await tester.pumpWidget(_host(1, {0, 1}, disableAnimations: true));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1));

    expect(find.byType(ListView), findsNothing);
    expect(find.text('two'), findsOneWidget);
  });

  testWidgets('tabStack_unvisitedTabs_areNotBuilt', (tester) async {
    await tester.pumpWidget(_host(0, {0}));

    expect(find.text('two', skipOffstage: false), findsNothing);
  });
}
