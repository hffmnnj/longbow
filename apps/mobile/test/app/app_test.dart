import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/app/app.dart';
import 'package:longbow/data/data.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<ThemeMode> _modeFor(WidgetTester tester, Map<String, Object> prefs) async {
  SharedPreferences.setMockInitialValues(prefs);
  final shared = await SharedPreferences.getInstance();
  await tester.pumpWidget(ProviderScope(
    overrides: [sharedPreferencesProvider.overrideWithValue(shared)],
    child: const LongbowApp(home: Scaffold(body: Text('home'))),
  ));
  return tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode!;
}

void main() {
  testWidgets('app_noSavedTheme_startsDark', (tester) async {
    expect(await _modeFor(tester, {}), ThemeMode.dark);
    expect(Theme.of(tester.element(find.text('home'))).brightness, Brightness.dark);
  });

  testWidgets('app_savedLightTheme_isHonored', (tester) async {
    expect(await _modeFor(tester, {'theme.mode': 'light'}), ThemeMode.light);
    expect(Theme.of(tester.element(find.text('home'))).brightness, Brightness.light);
  });

  testWidgets('app_savedSystemTheme_followsTheSystem', (tester) async {
    expect(await _modeFor(tester, {'theme.mode': 'system'}), ThemeMode.system);
  });
}
