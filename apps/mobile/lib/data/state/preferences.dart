import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Async bootstrap provides this override at app start with
/// `await SharedPreferences.getInstance()`; tests override it with
/// `SharedPreferences.setMockInitialValues(...)`.
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (_) => throw UnimplementedError(
      'Override sharedPreferencesProvider with a real instance'),
);

/// Theme choice for Settings. The shell maps this onto Flutter's ThemeMode.
/// `dark` is the default, matching the web app.
enum AppThemeMode { system, dark, light }

class PreferencesState {
  const PreferencesState({
    this.themeMode = AppThemeMode.dark,
    this.savedHost,
    this.notificationsEnabled = false,
  });

  final AppThemeMode themeMode;

  /// The host the user typed in Settings (`server.host`), if any.
  final String? savedHost;

  /// Mirror of the native alert toggle: true after the user enables
  /// notifications, false after they turn them off.
  final bool notificationsEnabled;

  PreferencesState copyWith({
    AppThemeMode? themeMode,
    String? Function()? savedHost,
    bool? notificationsEnabled,
  }) {
    return PreferencesState(
      themeMode: themeMode ?? this.themeMode,
      savedHost: savedHost != null ? savedHost() : this.savedHost,
      notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
    );
  }
}

/// User settings backed by SharedPreferences. The server locator writes
/// `server.host` directly and then calls [setHost] to keep this mirror fresh.
class Preferences extends Notifier<PreferencesState> {
  static const String themeKey = 'theme.mode';
  static const String hostKey = 'server.host';
  static const String notificationsKey = 'notifications.enabled';

  late SharedPreferences _prefs;

  @override
  PreferencesState build() {
    _prefs = ref.watch(sharedPreferencesProvider);
    return PreferencesState(
      themeMode: _parseTheme(_prefs.getString(themeKey)),
      savedHost: _prefs.getString(hostKey),
      notificationsEnabled: _prefs.getBool(notificationsKey) ?? false,
    );
  }

  Future<void> setThemeMode(AppThemeMode mode) async {
    await _prefs.setString(themeKey, mode.name);
    state = state.copyWith(themeMode: mode);
  }

  Future<void> setHost(String? host) async {
    if (host == null) {
      await _prefs.remove(hostKey);
    } else {
      await _prefs.setString(hostKey, host);
    }
    state = state.copyWith(savedHost: () => host);
  }

  Future<void> setNotificationsEnabled(bool value) async {
    await _prefs.setBool(notificationsKey, value);
    state = state.copyWith(notificationsEnabled: value);
  }

  static AppThemeMode _parseTheme(String? raw) => switch (raw) {
        'system' => AppThemeMode.system,
        'light' => AppThemeMode.light,
        _ => AppThemeMode.dark,
      };
}

final preferencesProvider =
    NotifierProvider<Preferences, PreferencesState>(Preferences.new);
