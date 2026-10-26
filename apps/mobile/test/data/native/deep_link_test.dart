import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/native/deep_link.dart';

void main() {
  group('parseDeepLink', () {
    test('routes notification paths to their screens', () {
      expect(parseDeepLink('/?order=o1'), isA<OrderLink>());
      expect((parseDeepLink('/?order=o1') as OrderLink).id, 'o1');
      expect((parseDeepLink('/?report=r2') as ReportLink).id, 'r2');
      expect(
        (parseDeepLink('/?view=portfolio') as SectionLink).section,
        AppSectionKey.portfolio,
      );
      expect(parseDeepLink('/?action=kill'), isA<KillSwitchLink>());
    });

    test('accepts absolute URLs and reads every view value', () {
      const views = {
        'feed': AppSectionKey.feed,
        'portfolio': AppSectionKey.portfolio,
        'markets': AppSectionKey.markets,
        'performance': AppSectionKey.performance,
        'agent': AppSectionKey.agent,
        'history': AppSectionKey.history,
        'reports': AppSectionKey.reports,
        'lab': AppSectionKey.lab,
        'live': AppSectionKey.feed,
      };
      for (final entry in views.entries) {
        final link = parseDeepLink(
            'https://longbow.example.ts.net:8443/?view=${entry.key}');
        expect(link, isA<SectionLink>(), reason: entry.key);
        expect((link as SectionLink).section, entry.value);
      }
    });

    test('order wins over report, view, and action', () {
      final link = parseDeepLink('/?order=o1&report=r1&view=feed&action=kill');
      expect(link, isA<OrderLink>());
      expect((link as OrderLink).id, 'o1');
    });

    test('falls back to null for null, empty, and unparsable input', () {
      expect(parseDeepLink(null), isNull);
      expect(parseDeepLink(''), isNull);
      expect(parseDeepLink('   '), isNull);
    });

    test('rejects non-HTTP schemes and unknown views', () {
      expect(parseDeepLink('javascript:alert(1)'), isNull);
      expect(parseDeepLink('/?view=bogus'), isNull);
      expect(parseDeepLink('/?action=other'), isNull);
      expect(parseDeepLink('/?unrelated=1'), isNull);
    });

    test('ignores empty ids', () {
      expect(parseDeepLink('/?order='), isNull);
    });
  });
}
