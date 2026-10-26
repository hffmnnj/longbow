/// Longbow data layer: the public surface feature screens read.
///
/// - REST: [HarnessApi] (implemented by [HttpHarnessApi]) plus [ApiError],
///   [ConnectResponse], [PushTestResult], and the range-to-wire helpers.
/// - Live events: [EventStream] (callbacks, backoff, watchdog) over [ServerEvent].
/// - Discovery: [ServerLocator] with [LocatorState]; the API provider
///   ([harnessApiProvider]) is null until it connects.
/// - Native bridge: [NativeBridge], [NotificationState], [DeepLink] and
///   [parseDeepLink] (query shapes `?order=`, `?report=`, `?view=`, `?action=kill`).
/// - State: [harnessProvider]/[HarnessStore] (+ derived providers),
///   [simProvider]/[SimStore], [clockProvider], [preferencesProvider],
///   [toastEventsProvider].
///
/// Screens obtain the API via `ref.watch(harnessApiProvider)` and the server
/// address from `ref.watch(serverLocatorProvider)` (a [Connected] carries the
/// [Uri] base URL). Tests override the providers with fakes; nothing here
/// touches the network unless the default probe/factory is used.
library;

export 'api/event_stream.dart';
export 'api/harness_api.dart';
export 'api/http_client.dart';
export 'api/providers.dart';
export 'api/status_cache.dart';
export 'connection/server_locator.dart';
export 'native/deep_link.dart';
export 'native/native_bridge.dart';
export 'state/clock.dart';
export 'state/feed_reducer.dart';
export 'state/harness_store.dart';
export 'state/preferences.dart';
export 'state/sim_store.dart';
export 'state/toast.dart';
