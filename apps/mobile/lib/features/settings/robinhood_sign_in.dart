import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/data/data.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens a URL in the external browser; false when nothing could open it.
typedef ExternalLauncher = Future<bool> Function(Uri uri);

/// The launcher [startRobinhoodSignIn] uses. Tests replace it.
final externalLauncherProvider = Provider<ExternalLauncher>(
  (_) => (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
);

/// Refreshes the account status the first time the app returns to the
/// foreground after the user left for the Robinhood sign-in page, then
/// removes itself.
class _RefreshOnResume with WidgetsBindingObserver {
  _RefreshOnResume(this._store);

  final HarnessStore _store;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    WidgetsBinding.instance.removeObserver(this);
    _store.refreshStatus();
  }
}

/// Asks the server for the Robinhood sign-in URL and opens it in the external
/// browser. When the user comes back, the status refreshes by itself.
/// Failures surface as toasts. Returns true when the browser was launched.
Future<bool> startRobinhoodSignIn(WidgetRef ref) async {
  final store = ref.read(harnessProvider.notifier);
  final toasts = ref.read(toastQueueProvider);
  final url = await store.connectRobinhood();
  if (url == null) return false;
  final uri = Uri.tryParse(url);
  if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http')) {
    toasts.add(const ToastEvent(tone: ToastTone.error, title: 'Could not start Robinhood sign-in', body: 'The server sent an unusable link.'));
    return false;
  }
  final observer = _RefreshOnResume(store);
  WidgetsBinding.instance.addObserver(observer);
  var launched = false;
  try {
    launched = await ref.read(externalLauncherProvider)(uri);
  } catch (_) {
    launched = false;
  }
  if (!launched) {
    WidgetsBinding.instance.removeObserver(observer);
    toasts.add(const ToastEvent(tone: ToastTone.error, title: 'Could not open the browser', body: 'Open the sign-in page from a browser on this phone.'));
  }
  return launched;
}
