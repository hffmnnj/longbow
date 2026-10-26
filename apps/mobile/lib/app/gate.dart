import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/features/connect/connect_screens.dart';

import 'deep_link_queue.dart';
import 'shell.dart';

/// Finds the server before showing the app. Searching shows the splash,
/// NoHosts asks for a host, Unreachable explains and retries, Connected shows
/// the shell. Once the app has been connected it stays in the shell for good:
/// a dropped connection becomes the offline strip, never a trip back here.
///
/// The gate also feeds notification links (cold start and while running) into
/// [deepLinkQueueProvider] from the first frame, so a link that arrives
/// during connecting is routed once the shell mounts.
class ConnectionGate extends ConsumerStatefulWidget {
  const ConnectionGate({super.key});

  @override
  ConsumerState<ConnectionGate> createState() => _ConnectionGateState();
}

class _ConnectionGateState extends ConsumerState<ConnectionGate> {
  bool _everConnected = false;
  bool _initialLinkHandled = false;
  Unreachable? _lastUnreachable;

  @override
  void initState() {
    super.initState();
    final queue = ref.read(deepLinkQueueProvider.notifier);
    ref.listenManual<AsyncValue<DeepLink?>>(initialDeepLinkProvider, (_, next) {
      next.whenData((link) {
        if (_initialLinkHandled) return;
        _initialLinkHandled = true;
        if (link != null) queue.add(link);
      });
    }, fireImmediately: true);
    ref.listenManual<AsyncValue<DeepLink>>(nativeLinkProvider, (_, next) => next.whenData(queue.add));
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(serverLocatorProvider);
    if (state is Connected) {
      _everConnected = true;
      _lastUnreachable = null;
    }
    if (_everConnected) return const AppShell();

    switch (state) {
      case Connected():
        return const AppShell();
      case Searching():
        // A retry flips Unreachable to Searching for a moment; keep the
        // explanation on screen instead of flashing the splash.
        final last = _lastUnreachable;
        return last == null ? const SplashView() : UnreachableView(state: last, probing: true);
      case NoHosts():
        _lastUnreachable = null;
        return const NoHostsView();
      case Unreachable():
        _lastUnreachable = state;
        return UnreachableView(state: state);
    }
  }
}
