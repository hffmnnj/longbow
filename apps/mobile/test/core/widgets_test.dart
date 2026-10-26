import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';

Widget host(Widget child, {Brightness b = Brightness.dark, bool reduceMotion = false}) => MaterialApp(
      theme: buildLongbowTheme(b),
      home: MediaQuery.withClampedTextScaling(
        minScaleFactor: 1,
        maxScaleFactor: 1,
        child: Builder(
          builder: (ctx) => MediaQuery(
            data: MediaQuery.of(ctx).copyWith(disableAnimations: reduceMotion),
            child: Scaffold(body: Center(child: child)),
          ),
        ),
      ),
    );

/// The single Text widget under [finder], flattened to (string, color).
(String, Color?) textOf(WidgetTester t, Finder finder) {
  final w = t.widget<Text>(finder);
  return (w.textSpan!.toPlainText(), w.style?.color);
}

void main() {
  group('Pnl', () {
    testWidgets('gain shows plus sign in gain color', (t) async {
      await t.pumpWidget(host(const Pnl(amount: 42.1, percent: 1.5)));
      final (s, color) = textOf(t, find.descendant(of: find.byType(Pnl), matching: find.byType(Text)));
      expect(s, '+\$42.10 (+1.50%)');
      expect(color, LongbowColors.dark.gain);
    });

    testWidgets('loss shows the U+2212 minus in loss color', (t) async {
      await t.pumpWidget(host(const Pnl(amount: -7.5, percent: -0.2)));
      final (s, color) = textOf(t, find.descendant(of: find.byType(Pnl), matching: find.byType(Text)));
      expect(s, '\u2212\$7.50 (\u22120.20%)');
      expect(color, LongbowColors.dark.loss);
    });

    testWidgets('zero is unsigned and muted, and the semantics say flat', (t) async {
      await t.pumpWidget(host(const Pnl(amount: 0.001)));
      final (s, color) = textOf(t, find.descendant(of: find.byType(Pnl), matching: find.byType(Text)));
      expect(s, '\$0.00');
      expect(color, LongbowColors.dark.mutedForeground);
      expect(find.bySemanticsLabel('Flat \$0.00'), findsOneWidget);
    });

    testWidgets('light theme uses the light gain token', (t) async {
      await t.pumpWidget(host(const Pnl(percent: 2), b: Brightness.light));
      final (_, color) = textOf(t, find.descendant(of: find.byType(Pnl), matching: find.byType(Text)));
      expect(color, LongbowColors.light.gain);
    });
  });

  group('LbNumberField', () {
    test('validate reports min, max, junk, and required', () {
      expect(LbNumberField.validate('5', min: 10), 'Must be at least 10');
      expect(LbNumberField.validate('5000.5', max: 5000), 'Must be at most 5,000');
      expect(LbNumberField.validate('1.2.3'), 'Enter a number');
      expect(LbNumberField.validate('', required: true), 'Required');
      expect(LbNumberField.validate('', min: 1), isNull);
      expect(LbNumberField.validate('10', min: 10, max: 10), isNull);
    });

    testWidgets('typing out-of-range shows an inline error and reports null', (t) async {
      double? last = -1;
      await t.pumpWidget(host(SizedBox(width: 300, child: LbNumberField(label: 'Limit', unit: 'USD', min: 0, max: 100, onChanged: (v) => last = v))));
      await t.enterText(find.byType(TextField), '150');
      await t.pump();
      expect(find.text('Must be at most 100'), findsOneWidget);
      expect(last, isNull);

      await t.enterText(find.byType(TextField), '42.5');
      await t.pump();
      expect(find.text('Must be at most 100'), findsNothing);
      expect(last, 42.5);
    });

    testWidgets('letters are filtered out of the input', (t) async {
      await t.pumpWidget(host(const SizedBox(width: 300, child: LbNumberField(label: 'Limit'))));
      await t.enterText(find.byType(TextField), '1a2b');
      expect(t.widget<TextField>(find.byType(TextField)).controller!.text, '12');
    });
  });

  group('showLbSheet', () {
    testWidgets('opens with its content, then dismisses on close', (t) async {
      await t.pumpWidget(host(Builder(
        builder: (ctx) => TextButton(onPressed: () => showLbSheet<void>(ctx, (_) => const Text('Order detail'), title: 'Order'), child: const Text('open')),
      )));
      await t.tap(find.text('open'));
      await t.pumpAndSettle();
      expect(find.text('Order detail'), findsOneWidget);
      expect(find.text('Order'), findsOneWidget);

      await t.tap(find.byTooltip('Close'));
      await t.pumpAndSettle();
      expect(find.text('Order detail'), findsNothing);
    });

    testWidgets('returns the popped value', (t) async {
      String? result;
      await t.pumpWidget(host(Builder(
        builder: (ctx) => TextButton(
          onPressed: () async => result = await showLbSheet<String>(ctx, (c) => TextButton(onPressed: () => Navigator.pop(c, 'ok'), child: const Text('pick'))),
          child: const Text('open'),
        ),
      )));
      await t.tap(find.text('open'));
      await t.pumpAndSettle();
      await t.tap(find.text('pick'));
      await t.pumpAndSettle();
      expect(result, 'ok');
    });
  });

  group('showLbConfirm', () {
    testWidgets('confirm returns true, cancel returns false', (t) async {
      bool? answer;
      await t.pumpWidget(host(Builder(
        builder: (ctx) => TextButton(onPressed: () async => answer = await showLbConfirm(ctx, title: 'Sure?', confirmLabel: 'Do it', destructive: true), child: const Text('go')),
      )));
      await t.tap(find.text('go'));
      await t.pumpAndSettle();
      await t.tap(find.text('Do it'));
      await t.pumpAndSettle();
      expect(answer, isTrue);

      await t.tap(find.text('go'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel'));
      await t.pumpAndSettle();
      expect(answer, isFalse);
    });
  });

  group('LbMotion.duration', () {
    testWidgets('is zero when animations are disabled and the given value otherwise', (t) async {
      late Duration normal;
      late Duration reduced;
      await t.pumpWidget(MediaQuery(
        data: const MediaQueryData(),
        child: Builder(builder: (c) {
          normal = LbMotion.duration(c);
          return const SizedBox();
        }),
      ));
      await t.pumpWidget(MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: Builder(builder: (c) {
          reduced = LbMotion.duration(c, LbMotion.sheet);
          return const SizedBox();
        }),
      ));
      expect(normal, const Duration(milliseconds: 200));
      expect(reduced, Duration.zero);
    });
  });

  group('Disclosure', () {
    testWidgets('tap expands content and reports the state', (t) async {
      bool? open;
      await t.pumpWidget(host(Disclosure(title: 'More', onChanged: (v) => open = v, child: const Text('hidden body'))));
      expect(find.text('hidden body'), findsNothing);
      await t.tap(find.text('More'));
      await t.pumpAndSettle();
      expect(find.text('hidden body'), findsOneWidget);
      expect(open, isTrue);
    });
  });

  group('Badges', () {
    testWidgets('SideBadge sell is loss colored and spoken', (t) async {
      await t.pumpWidget(host(const SideBadge('sell')));
      expect(find.text('SELL'), findsOneWidget);
      expect(t.widget<Text>(find.text('SELL')).style!.color, LongbowColors.dark.loss);
      expect(find.bySemanticsLabel('Sell'), findsOneWidget);
    });
  });

  group('LbMarkdown', () {
    test('protectSingleTildes escapes approximate tildes but keeps strikethrough and code', () {
      expect(protectSingleTildes('~1.3 to ~2'), r'\~1.3 to \~2');
      expect(protectSingleTildes('~~gone~~'), '~~gone~~');
      expect(protectSingleTildes('use `~/bin` ~5'), r'use `~/bin` \~5');
    });

    test('isSafeLink allows only http and https', () {
      expect(isSafeLink('https://a.com'), isTrue);
      expect(isSafeLink('http://a.com'), isTrue);
      expect(isSafeLink('javascript:alert(1)'), isFalse);
      expect(isSafeLink('mailto:a@b.c'), isFalse);
      expect(isSafeLink(null), isFalse);
    });

    testWidgets('renders heading, code block with copy button, and literal tilde', (t) async {
      await t.pumpWidget(host(const SizedBox(width: 340, child: LbMarkdown('## Title\n\nabout ~1.3\n\n```\nrun it\n```'))));
      expect(find.text('Title'), findsOneWidget);
      expect(find.byType(CodeBlock), findsOneWidget);
      expect(find.byTooltip('Copy code'), findsOneWidget);
      expect(find.textContaining('about ~1.3', findRichText: true), findsOneWidget);
    });
  });
}
