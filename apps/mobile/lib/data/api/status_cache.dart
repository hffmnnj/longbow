import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:longbow/models/models.dart';

/// Offline snapshot of the last live status: raw GET /api/status JSON plus
/// the time it was saved, so an offline launch still shows the last known
/// account with its age.
class CachedStatus {
  const CachedStatus({required this.status, required this.at});

  final StatusResponse status;

  /// Epoch millis when the snapshot was saved.
  final int at;
}

/// Persists the raw GET /api/status body under the `status.cache` key.
/// The raw body is stored (not the model) because the models have `fromJson`
/// only. All reads and writes are total: corrupt input yields null, and a
/// failing disk never throws into the caller.
class StatusCache {
  StatusCache(this.prefs, {int Function()? now})
      : _now = now ?? (() => DateTime.now().millisecondsSinceEpoch);

  static const String key = 'status.cache';

  final SharedPreferences prefs;
  final int Function() _now;

  /// Persists the raw body of a successful GET /api/status. Never throws:
  /// a broken body or a full disk must not fail the status call.
  Future<void> saveRaw(String rawBody) async {
    try {
      final body = jsonDecode(rawBody);
      if (body is! Map<String, dynamic>) return;
      await prefs.setString(
          key, jsonEncode({'at': _now(), 'status': body}));
    } catch (_) {
      // Best effort only.
    }
  }

  /// Reads the snapshot back, or null when nothing usable was saved.
  CachedStatus? load() {
    try {
      final raw = prefs.getString(key);
      if (raw == null || raw.isEmpty) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      final at = decoded['at'];
      final status = decoded['status'];
      if (at is! int || status is! Map<String, dynamic>) return null;
      return CachedStatus(status: StatusResponse.fromJson(status), at: at);
    } catch (_) {
      return null;
    }
  }

  Future<void> clear() async {
    try {
      await prefs.remove(key);
    } catch (_) {
      // Best effort only.
    }
  }
}
