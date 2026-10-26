import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;

import 'gate.dart';

ThemeMode themeModeOf(AppThemeMode mode) => switch (mode) {
      AppThemeMode.system => ThemeMode.system,
      AppThemeMode.dark => ThemeMode.dark,
      AppThemeMode.light => ThemeMode.light,
    };

/// The Longbow app: Material 3 with the Longbow theme (dark by default),
/// transparent system bars whose icons follow the theme, and the connection
/// gate as home. Needs a [ProviderScope] with `sharedPreferencesProvider`.
class LongbowApp extends ConsumerWidget {
  const LongbowApp({super.key, this.home = const ConnectionGate()});

  final Widget home;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(preferencesProvider.select((p) => p.themeMode));
    return MaterialApp(
      title: 'Longbow',
      debugShowCheckedModeBanner: false,
      theme: buildLongbowTheme(Brightness.light),
      darkTheme: buildLongbowTheme(Brightness.dark),
      themeMode: themeModeOf(mode),
      builder: (context, child) {
        final dark = Theme.of(context).brightness == Brightness.dark;
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            systemNavigationBarColor: Colors.transparent,
            systemNavigationBarDividerColor: Colors.transparent,
            systemNavigationBarContrastEnforced: false,
            statusBarIconBrightness: dark ? Brightness.light : Brightness.dark,
            systemNavigationBarIconBrightness: dark ? Brightness.light : Brightness.dark,
            statusBarBrightness: dark ? Brightness.dark : Brightness.light,
          ),
          child: child!,
        );
      },
      home: home,
    );
  }
}
