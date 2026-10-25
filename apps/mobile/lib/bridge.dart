import 'dart:convert';

/// Parsing, reply encoding, and deep-link routing for the `LongbowBridge`
/// JavaScript channel. Pure Dart (no Flutter imports) so it runs in
/// `flutter test` with no device.
///
/// The web sends `LongbowBridge.postMessage(
/// JSON.stringify({ id, method, args }))`. Native answers by running
/// `window.__longbowReply(<id>, <json>)` where json is
/// `{ "ok": true, "value": ... }` or `{ "ok": false, "error": "..." }`.
class BridgeRequest {
  const BridgeRequest({
    required this.id,
    required this.method,
    required this.args,
  });

  final int id;
  final String method;
  final Map<String, Object?> args;

  /// Parses one channel message. Throws [FormatException] on anything that
  /// is not `{ id: int, method: non-empty string, args?: object }`.
  factory BridgeRequest.parse(String message) {
    final Object? decoded = jsonDecode(message);
    if (decoded is! Map) {
      throw const FormatException('bridge message must be a JSON object');
    }
    final Object? id = decoded['id'];
    final Object? method = decoded['method'];
    final Object? args = decoded['args'];
    if (id is! int) throw const FormatException('bridge id must be an int');
    if (method is! String || method.isEmpty) {
      throw const FormatException('bridge method must be a non-empty string');
    }
    if (args != null && args is! Map) {
      throw const FormatException('bridge args must be an object');
    }
    return BridgeRequest(
      id: id,
      method: method,
      args: args == null
          ? const <String, Object?>{}
          : Map<String, Object?>.from(args as Map),
    );
  }
}

/// Encodes the JavaScript snippet native runs to answer a bridge call.
String bridgeReply(int id, {Object? value, String? error}) {
  final Map<String, Object?> payload = error == null
      ? <String, Object?>{'ok': true, 'value': value}
      : <String, Object?>{'ok': false, 'error': error};
  return 'window.__longbowReply($id, ${jsonEncode(payload)})';
}

/// Resolves a notification tap (or any native deep link) to the URL the
/// WebView should load. `path` is the payload `url` such as `/?order=o1`.
/// Absolute URLs are only honored on the served origin; anything else —
/// null, empty, unparsable, foreign — falls back to [base].
String resolveLaunchUrl({required String base, String? path}) {
  final String trimmed = path?.trim() ?? '';
  if (trimmed.isEmpty) return base;
  final Uri? target = Uri.tryParse(trimmed);
  if (target == null) return base;
  if (target.hasScheme) {
    final Uri origin = Uri.parse(base);
    final bool sameOrigin = (target.scheme == 'http' ||
            target.scheme == 'https') &&
        target.host == origin.host &&
        target.port == origin.port;
    return sameOrigin ? target.toString() : base;
  }
  return Uri.parse(base).resolve(trimmed).toString();
}
