import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

/// App-scoped HTTP client for the REST API, the SSE stream, and the server
/// probe. Tests override it with a fake; the locator and the harness store
/// both read through this provider so one override covers the data layer.
final httpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});
