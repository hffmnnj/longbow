import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'bridge.dart';

/// Base URL of the served Longbow web app. Override at build time, e.g.
/// `flutter build apk --release --dart-define=LONGBOW_URL=https://host:8443/`.
const String longbowUrl = String.fromEnvironment(
  'LONGBOW_URL',
  defaultValue: 'https://longbow.example.ts.net:8443/',
);

/// Longbow dark surface, shared by the web app theme-color, the Android
/// system bars, the native splash, the loading overlay, and error screen.
const Color longbowBackground = Color(0xFF16191d);

/// Suffix appended to the WebView user agent so the server can tell the
/// native shell apart from a browser tab.
const String longbowUserAgentSuffix = ' LongbowAndroid/1.0';

/// How often the unreachable screen retries on its own.
const Duration retryInterval = Duration(seconds: 10);

/// Channel the web app's `LongbowBridge` posts to.
const String bridgeChannel = 'LongbowBridge';

/// Method channel to the Android embedding (print, notifications, deep links).
const MethodChannel nativeChannel = MethodChannel('longbow/native');

/// Haptic kinds the web app sends over the bridge.
const Set<String> hapticKinds = <String>{
  'selection',
  'light',
  'medium',
  'heavy',
  'success',
  'warning',
  'error',
};

/// Asks the open web page whether it consumed an Escape keypress. bits-ui
/// sheets, dialogs, and the command palette listen for Escape on `document`
/// and preventDefault it when they close, so `defaultPrevented` tells the
/// app whether a native back press should dismiss a sheet (true) or walk
/// WebView history (false). Returns false when nothing overlays the page.
const String escapeProbe = '(function(){'
    'var s="[role=dialog][data-state=open],[role=menu][data-state=open],[role=listbox][data-state=open]";'
    'if(!document.querySelector(s))return false;'
    'var e=new KeyboardEvent("keydown",{key:"Escape",code:"Escape",keyCode:27,which:27,bubbles:true,cancelable:true});'
    'document.dispatchEvent(e);'
    'return true;})()';

void main() {
  runApp(const LongbowApp());
}

class LongbowApp extends StatelessWidget {
  const LongbowApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Longbow',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: longbowBackground,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8FB4FF),
          brightness: Brightness.dark,
          surface: longbowBackground,
        ),
      ),
      home: const LongbowHome(),
    );
  }
}

/// Which native surface is currently visible.
enum LongbowStatus {
  /// First load (or a retry) is in flight; the splash look stays up.
  loading,

  /// The web app has rendered at least one page.
  ready,

  /// The main document failed; the native retry screen is up.
  unreachable,
}

class LongbowHome extends StatefulWidget {
  const LongbowHome({
    super.key,
    @visibleForTesting this.initialStatus = LongbowStatus.loading,
    @visibleForTesting this.autoRetry = true,
    @visibleForTesting this.debugReloadOverride,
  });

  /// Injected so widget tests can start on the error screen without a
  /// WebView or network.
  final LongbowStatus initialStatus;

  /// Disabled in tests so the periodic retry timer never outlives a test.
  final bool autoRetry;

  /// When set, Retry invokes this instead of touching a WebView.
  final Future<void> Function()? debugReloadOverride;

  @override
  State<LongbowHome> createState() => _LongbowHomeState();
}

class _LongbowHomeState extends State<LongbowHome>
    with WidgetsBindingObserver {
  LongbowStatus _status = LongbowStatus.loading;

  /// True once the first page finished loading; drives the crossfade.
  bool _ready = false;
  WebViewController? _controller;
  Timer? _retryTimer;

  static const _systemBars = SystemUiOverlayStyle(
    statusBarColor: longbowBackground,
    systemNavigationBarColor: longbowBackground,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarIconBrightness: Brightness.light,
  );

  @override
  void initState() {
    super.initState();
    _status = widget.initialStatus;
    _ready = _status == LongbowStatus.ready;
    SystemChrome.setSystemUIOverlayStyle(_systemBars);
    WidgetsBinding.instance.addObserver(this);
    nativeChannel.setMethodCallHandler(_onNativeMethod);
    if (_status == LongbowStatus.unreachable) {
      _beginAutoRetry();
    } else {
      if (_status == LongbowStatus.ready) {
        // Widget tests inject the ready state with no WebView.
        _controller ??= _buildController();
      }
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _retryTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Retry when the app comes back while the error screen is showing
    // (e.g. the user just re-enabled Tailscale).
    if (state == AppLifecycleState.resumed &&
        _status == LongbowStatus.unreachable) {
      unawaited(_retry());
    }
  }

  /// Calls from the Android embedding: notification taps while running.
  Future<void> _onNativeMethod(MethodCall call) async {
    if (call.method == 'openUrl') {
      final Object? args = call.arguments;
      final String? url = args is Map
          ? args['url'] as String?
          : args as String?;
      if (url != null && url.isNotEmpty) unawaited(_openUrl(url));
    }
  }

  Future<void> _openUrl(String url) async {
    final String target = resolveLaunchUrl(base: longbowUrl, path: url);
    try {
      final WebViewController controller = _controller ??= _buildController();
      if (_status == LongbowStatus.unreachable) {
        if (mounted) setState(() => _status = LongbowStatus.loading);
      }
      await controller.loadRequest(Uri.parse(target));
    } catch (_) {
      _showUnreachable();
    }
  }

  WebViewController _buildController() {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(longbowBackground)
      ..addJavaScriptChannel(bridgeChannel,
          onMessageReceived: _onBridgeMessage)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: _decideNavigation,
          onPageFinished: (_) {
            if (!mounted || _status == LongbowStatus.unreachable) return;
            setState(() {
              _status = LongbowStatus.ready;
              _ready = true;
            });
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? false) _showUnreachable();
          },
          onHttpError: (error) {
            final code = error.response?.statusCode ?? 0;
            if (code >= 500) _showUnreachable();
          },
        ),
      );
    return controller;
  }

  /// One `LongbowBridge.postMessage(JSON.stringify({ id, method, args }))`.
  Future<void> _onBridgeMessage(JavaScriptMessage message) async {
    final WebViewController? controller = _controller;
    if (controller == null) return;
    late final BridgeRequest request;
    try {
      request = BridgeRequest.parse(message.message);
    } catch (e) {
      // No id to answer; nothing the web is waiting on.
      debugPrint('LongbowBridge: ignoring malformed message: $e');
      return;
    }
    Future<void> reply({Object? value, String? error}) {
      return controller.runJavaScript(
        bridgeReply(request.id, value: value, error: error),
      );
    }

    try {
      switch (request.method) {
        case 'haptic':
          await _doHaptic(request.args['kind'] as String?);
          await reply();
        case 'copy':
          final Object? text = request.args['text'];
          if (text is! String || text.isEmpty) {
            await reply(error: 'copy needs { text }');
            return;
          }
          await Clipboard.setData(ClipboardData(text: text));
          await HapticFeedback.lightImpact();
          await reply();
        case 'badge':
          // No-op: launchers show notification dots from the alert
          // notifications, so there is nothing to set or clear.
          await reply();
        case 'print':
          final Object? title = request.args['title'];
          await nativeChannel.invokeMethod('print', <String, Object?>{
            'identifier': _webViewIdentifier(),
            'title': title is String && title.isNotEmpty
                ? title
                : 'Longbow report',
          });
          await reply();
        case 'notifications.status':
          final String? status = await nativeChannel
              .invokeMethod<String>('notificationsStatus');
          await reply(value: status ?? 'off');
        case 'notifications.enable':
          final String? status = await nativeChannel
              .invokeMethod<String>('notificationsEnable', <String, Object?>{
            'baseUrl': longbowUrl,
          });
          await reply(value: status ?? 'off');
        case 'notifications.disable':
          final String? status = await nativeChannel
              .invokeMethod<String>('notificationsDisable');
          await reply(value: status ?? 'off');
        default:
          await reply(error: 'unknown method "${request.method}"');
      }
    } on PlatformException catch (e) {
      try {
        await reply(error: e.message ?? 'native call failed');
      } catch (_) {
        // The page is gone; nothing left to answer.
      }
    } catch (e) {
      try {
        await reply(error: '$e');
      } catch (_) {
        // The page is gone; nothing left to answer.
      }
    }
  }

  int? _webViewIdentifier() {
    final WebViewController? controller = _controller;
    if (controller?.platform is AndroidWebViewController) {
      return (controller!.platform as AndroidWebViewController)
          .webViewIdentifier;
    }
    return null;
  }

  static Future<void> _doHaptic(String? kind) {
    if (kind != null && !hapticKinds.contains(kind)) {
      throw ArgumentError('unknown haptic kind "$kind"');
    }
    switch (kind) {
      case 'selection':
        return HapticFeedback.selectionClick();
      case 'medium':
      case 'success':
        return HapticFeedback.mediumImpact();
      case 'heavy':
      case 'warning':
        return HapticFeedback.heavyImpact();
      case 'error':
        return HapticFeedback.vibrate();
      case 'light':
      default:
        return HapticFeedback.lightImpact();
    }
  }

  /// Same-origin navigations stay in the WebView; everything else
  /// (Robinhood OAuth, news, SEC filings) opens in the external browser.
  FutureOr<NavigationDecision> _decideNavigation(NavigationRequest request) async {
    final base = Uri.parse(longbowUrl);
    final target = Uri.tryParse(request.url);
    if (target == null) return NavigationDecision.prevent;
    final sameOrigin = target.scheme == base.scheme &&
        target.host == base.host &&
        target.port == base.port;
    if (sameOrigin) return NavigationDecision.navigate;
    if (await canLaunchUrl(target)) {
      await launchUrl(target, mode: LaunchMode.externalApplication);
    }
    return NavigationDecision.prevent;
  }

  Future<void> _load() async {
    try {
      final controller = _controller ??= _buildController();
      final current = await controller.getUserAgent();
      if (current != null && !current.contains('LongbowAndroid')) {
        await controller.setUserAgent('$current$longbowUserAgentSuffix');
      }
      if (controller.platform is AndroidWebViewController) {
        // Pinch zoom fights the app's own touch targets; the PWA layout
        // already fits the phone width.
        await (controller.platform as AndroidWebViewController)
            .enableZoom(false);
      }
      final String? initial =
          await nativeChannel.invokeMethod<String>('getInitialUrl');
      final String start = resolveLaunchUrl(base: longbowUrl, path: initial);
      await controller.loadRequest(Uri.parse(start));
    } catch (_) {
      _showUnreachable();
    }
  }

  Future<void> _retry() async {
    if (!mounted || _status != LongbowStatus.unreachable) return;
    if (widget.debugReloadOverride != null) {
      await widget.debugReloadOverride!();
      return;
    }
    if (mounted) setState(() => _status = LongbowStatus.loading);
    await _load();
  }

  void _showUnreachable() {
    if (!mounted) return;
    if (_status != LongbowStatus.unreachable) {
      setState(() {
        _status = LongbowStatus.unreachable;
        _ready = false;
      });
    }
    _beginAutoRetry();
  }

  void _beginAutoRetry() {
    if (!widget.autoRetry) return;
    _retryTimer?.cancel();
    _retryTimer = Timer.periodic(retryInterval, (_) => unawaited(_retry()));
  }

  Future<void> _onPopInvoked(bool didPop) async {
    if (didPop) return;
    final controller = _controller;
    if (_status != LongbowStatus.unreachable && controller != null) {
      // Let the web app close an open sheet first: it consumes the
      // synthetic Escape exactly when a sheet, dialog, or menu is open.
      // Otherwise walk WebView history, else leave the app.
      try {
        final consumed =
            await controller.runJavaScriptReturningResult(escapeProbe);
        if (consumed == true) return;
      } catch (_) {
        // A page that cannot run the probe cannot consume the back press.
      }
      if (await controller.canGoBack()) {
        await controller.goBack();
        return;
      }
    }
    await SystemNavigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    // Skip the crossfade when the OS asks for reduced motion.
    final bool reduceMotion = MediaQuery.disableAnimationsOf(context);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) => _onPopInvoked(didPop),
      child: Scaffold(
        backgroundColor: longbowBackground,
        body: SafeArea(
          child: _status == LongbowStatus.unreachable
              ? UnreachableScreen(onRetry: _retry)
              : Stack(
                  children: [
                    if (_controller != null)
                      AnimatedOpacity(
                        opacity: _ready ? 1 : 0,
                        duration: reduceMotion
                            ? Duration.zero
                            : const Duration(milliseconds: 200),
                        child: WebViewWidget(controller: _controller!),
                      ),
                    if (!_ready) const SplashLook(),
                  ],
                ),
        ),
      ),
    );
  }
}

/// Splash look: the Longbow mark centred on #16191d. Shown natively while
/// the first page loads so there is never a white flash.
class SplashLook extends StatelessWidget {
  const SplashLook({super.key});

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: longbowBackground,
      child: Center(
        child: Image(
          image: AssetImage('assets/longbow-mark.png'),
          width: 120,
          height: 120,
          semanticLabel: 'Longbow',
        ),
      ),
    );
  }
}

/// Native error screen shown when the main document fails to load.
class UnreachableScreen extends StatelessWidget {
  const UnreachableScreen({super.key, required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return ColoredBox(
      color: longbowBackground,
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Image(
                image: AssetImage('assets/longbow-mark.png'),
                width: 96,
                height: 96,
                semanticLabel: 'Longbow',
              ),
              const SizedBox(height: 24),
              Text(
                "Can't reach Longbow",
                style: textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'Check that Tailscale is connected.',
                style: textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              FilledButton(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(160, 48),
                ),
                onPressed: () {
                  onRetry();
                },
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
