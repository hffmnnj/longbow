import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:longbow/models/models.dart';

import '../connection/server_locator.dart';
import '../state/preferences.dart';
import 'event_stream.dart';
import 'harness_api.dart';
import 'http_client.dart';
import 'status_cache.dart';

/// Handle for a running server-sent-events subscription.
abstract class EventFeedHandle {
  void dispose();
}

class _EventStreamHandle implements EventFeedHandle {
  _EventStreamHandle(this._stream);

  final EventStream _stream;

  @override
  void dispose() => _stream.dispose();
}

/// Builds and starts the live event stream for [baseUrl]. Overridden in
/// tests with a fake that replays scripted events with no network.
typedef EventStreamFactory = EventFeedHandle Function(
  Uri baseUrl, {
  required void Function(ServerEvent event) onEvent,
  required void Function() onOpen,
  required void Function() onClose,
});

final eventStreamFactoryProvider = Provider<EventStreamFactory>((ref) {
  final client = ref.watch(httpClientProvider);
  return (
    Uri baseUrl, {
    required void Function(ServerEvent event) onEvent,
    required void Function() onOpen,
    required void Function() onClose,
  }) {
    final stream = EventStream(
      baseUrl: baseUrl,
      client: client,
      onEvent: onEvent,
      onOpen: onOpen,
      onClose: onClose,
    );
    stream.start();
    return _EventStreamHandle(stream);
  };
});

/// The REST client for the currently connected server, or null until the
/// locator connects. Rebuilt with the new base URL when the server address
/// changes; the harness and sim stores reattach through it.
final harnessApiProvider = Provider<HarnessApi?>((ref) {
  final locator = ref.watch(serverLocatorProvider);
  if (locator is! Connected) return null;
  return HttpHarnessApi(
    locator.baseUrl,
    ref.watch(httpClientProvider),
    statusCache: StatusCache(ref.watch(sharedPreferencesProvider)),
  );
});
