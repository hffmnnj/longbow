import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/state/clock.dart';
import 'package:longbow/data/state/preferences.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('clockProvider', () {
    test('ticks on the interval and pauses and resumes', () async {
      final container = ProviderContainer(overrides: [
        clockTickProvider.overrideWithValue(const Duration(milliseconds: 20)),
      ]);
      addTearDown(container.dispose);
      container.listen<DateTime>(clockProvider, (_, _) {});

      final first = container.read(clockProvider);
      await Future<void>.delayed(const Duration(milliseconds: 60));
      final second = container.read(clockProvider);
      expect(second.isAfter(first), isTrue);

      container.read(clockProvider.notifier).pause();
      final paused = container.read(clockProvider);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(container.read(clockProvider), paused);

      container.read(clockProvider.notifier).resume();
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(container.read(clockProvider).isAfter(paused), isTrue);
    });
  });

  group('preferencesProvider', () {
    test('defaults to dark with no host and no mirror', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
      ]);
      addTearDown(container.dispose);

      final state = container.read(preferencesProvider);
      expect(state.themeMode, AppThemeMode.dark);
      expect(state.savedHost, isNull);
      expect(state.notificationsEnabled, isFalse);
    });

    test('persists theme, host, and the notification mirror', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(preferencesProvider.notifier);

      await notifier.setThemeMode(AppThemeMode.light);
      await notifier.setHost('longbow.example.ts.net');
      await notifier.setNotificationsEnabled(true);

      final state = container.read(preferencesProvider);
      expect(state.themeMode, AppThemeMode.light);
      expect(state.savedHost, 'longbow.example.ts.net');
      expect(state.notificationsEnabled, isTrue);
      expect(prefs.getString('theme.mode'), 'light');
      expect(prefs.getString('server.host'), 'longbow.example.ts.net');
      expect(prefs.getBool('notifications.enabled'), isTrue);

      await notifier.setHost(null);
      expect(container.read(preferencesProvider).savedHost, isNull);
      expect(prefs.getString('server.host'), isNull);
    });
  });
}
