import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Base URL of the served Longbow web app. Override at build time, e.g.
/// `flutter build apk --release --dart-define=LONGBOW_URL=https://host:8443/`.
const String longbowUrl = String.fromEnvironment(
  'LONGBOW_URL',
  defaultValue: 'https://longbow.example.ts.net:8443/',
);

/// Longbow dark surface, shared by the web app theme-color, the Android
/// system bars, the splash, and every native screen.
const Color longbowBackground = Color(0xFF16191d);

/// Suffix appended to the WebView user agent so the server can tell the
/// native shell apart from a browser tab.
const String longbowUserAgentSuffix = ' LongbowAndroid/1.0';

/// How often the unreachable screen retries on its own.
const Duration retryInterval = Duration(seconds: 10);

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
    SystemChrome.setSystemUIOverlayStyle(_systemBars);
    WidgetsBinding.instance.addObserver(this);
    if (_status == LongbowStatus.unreachable) {
      _beginAutoRetry();
    } else {
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

  WebViewController _buildController() {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(longbowBackground)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: _decideNavigation,
          onPageFinished: (_) {
            if (!mounted || _status == LongbowStatus.unreachable) return;
            setState(() => _status = LongbowStatus.ready);
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
      await controller.loadRequest(Uri.parse(longbowUrl));
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
      setState(() => _status = LongbowStatus.unreachable);
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
    if (_status != LongbowStatus.unreachable &&
        controller != null &&
        await controller.canGoBack()) {
      await controller.goBack();
    } else {
      await SystemNavigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
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
                      WebViewWidget(controller: _controller!),
                    if (_status == LongbowStatus.loading)
                      const SplashLook(),
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
