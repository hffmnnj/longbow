import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/features/search/jump_sheet.dart';
import 'package:longbow/models/models.dart';

import 'deep_link_queue.dart';
import 'more_sheet.dart';
import 'nav.dart';
import 'shell_tabs.dart';
import 'status/halt_banner.dart';
import 'status/status_sheet.dart';
import 'status_header.dart';
import 'tab_stack.dart';
import 'toasts.dart';

/// The app once connected: status header, halt and offline strips, the five
/// tabs (kept alive, cross-faded) and the navigation bar or rail.
///
/// It also owns the cross-cutting wiring: keeping the stores, clock and
/// preferences subscribed, pausing the clock in the background, showing
/// toasts, routing notification deep links, and unwinding back presses.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> with WidgetsBindingObserver {
  int _index = 0;
  final Set<int> _visited = {0};
  bool _wasConnected = false;
  bool _draining = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ref.listenManual<LocatorState>(serverLocatorProvider, (_, next) {
      if (next is Connected) {
        _wasConnected = true;
      } else if (_wasConnected && mounted) {
        setState(() {});
      }
    }, fireImmediately: true);
    ref.listenManual<List<DeepLink>>(deepLinkQueueProvider, (_, queue) {
      if (queue.isNotEmpty) _scheduleDrain();
    }, fireImmediately: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        ref.read(clockProvider.notifier).resume();
        ref.read(serverLocatorProvider.notifier).onForeground();
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        ref.read(clockProvider.notifier).pause();
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
        break;
    }
  }

  void _select(int i, {bool haptic = true}) {
    if (i == _index) return;
    if (haptic) Haptics.selection();
    setState(() {
      _index = i;
      _visited.add(i);
    });
  }

  // Links wait for the first frame so dialogs and routes have a Navigator.
  void _scheduleDrain() {
    if (_draining) return;
    _draining = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _draining = false;
      if (!mounted) return;
      for (final link in ref.read(deepLinkQueueProvider.notifier).take()) {
        unawaited(_route(link));
      }
    });
  }

  Future<void> _route(DeepLink link) async {
    switch (link) {
      case OrderLink(:final id):
        await AppNav.order(context, id);
      case ReportLink(:final id):
        await AppNav.report(context, id);
      case SectionLink(:final section):
        await _openSection(section);
      case KillSwitchLink():
        await _confirmKill();
    }
  }

  Future<void> _openSection(AppSectionKey section) async {
    final tab = tabIndexOf(ref.read(shellTabsProvider), section);
    Navigator.of(context).popUntil((route) => route.isFirst);
    if (tab != null) {
      _select(tab, haptic: false);
      return;
    }
    switch (section) {
      case AppSectionKey.reports:
        await AppNav.reports(context);
      case AppSectionKey.history:
        await AppNav.history(context);
      case AppSectionKey.lab:
        await AppNav.lab(context);
      default:
        break;
    }
  }

  Future<void> _confirmKill() async {
    final store = ref.read(harnessProvider.notifier);
    if (ref.read(harnessProvider).feed.status?.settings.killSwitch ?? false) {
      showToast(context, 'Kill switch is already engaged', tone: ToastTone.info);
      return;
    }
    final ok = await showLbConfirm(
      context,
      title: 'Engage the kill switch?',
      message: 'All order placement stops immediately. Release it from the status bar when you are ready.',
      confirmLabel: 'Engage kill switch',
      destructive: true,
    );
    if (!ok || !mounted) return;
    if (await store.quickPatch('kill', const SettingsPatch(killSwitch: true), 'Kill switch engaged')) Haptics.heavy();
  }

  Future<void> _more() async {
    final dest = await showMoreSheet(context);
    if (dest == null || !mounted) return;
    switch (dest) {
      case MoreDestination.reports:
        await AppNav.reports(context);
      case MoreDestination.history:
        await AppNav.history(context);
      case MoreDestination.lab:
        await AppNav.lab(context);
      case MoreDestination.settings:
        await AppNav.settings(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Subscriptions that keep the stores alive; none of them rebuilds the shell.
    ref.listen(harnessProvider, (_, _) {});
    ref.listen(simProvider, (_, _) {});
    ref.listen(clockProvider, (_, _) {});
    ref.listen(preferencesProvider, (_, _) {});
    ref.listen(toastEventsProvider, (_, next) {
      next.whenData((event) => showToastEvent(context, event, onOpenReport: (id) => AppNav.report(context, id)));
    });

    final tabs = ref.watch(shellTabsProvider);
    final locator = ref.watch(serverLocatorProvider);
    final lost = _wasConnected && locator is! Connected;
    final pending = ref.watch(pendingOrdersProvider.select((l) => l.length));
    final size = MediaQuery.sizeOf(context);
    final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;
    final wide = size.width >= 600 && size.height >= 480;
    final c = context.lb;

    final body = TabStack(
      index: _index,
      visited: _visited,
      builders: [for (final t in tabs) t.builder],
    );

    Widget icon(ShellTab tab, {bool selected = false}) {
      final glyph = LbIcon(tab.icon);
      if (tab.section != AppSectionKey.feed) return glyph;
      return Badge(
        isLabelVisible: pending > 0,
        label: Text('$pending'),
        backgroundColor: c.warn,
        textColor: c.background,
        child: glyph,
      );
    }

    final rail = SafeArea(
      top: false,
      right: false,
      child: NavigationRail(
        selectedIndex: _index,
        onDestinationSelected: _select,
        extended: size.width >= 840,
        labelType: size.width >= 840 ? NavigationRailLabelType.none : NavigationRailLabelType.all,
        backgroundColor: c.bar,
        indicatorColor: c.accent,
        selectedIconTheme: IconThemeData(color: c.foreground, size: 22),
        unselectedIconTheme: IconThemeData(color: c.mutedForeground, size: 22),
        selectedLabelTextStyle: Theme.of(context).textTheme.labelMedium!.copyWith(color: c.foreground),
        unselectedLabelTextStyle: Theme.of(context).textTheme.labelMedium!.copyWith(color: c.mutedForeground),
        destinations: [
          for (final t in tabs) NavigationRailDestination(icon: icon(t), label: Text(t.label), padding: const EdgeInsets.symmetric(vertical: 2)),
        ],
      ),
    );

    return PopScope(
      canPop: _index == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _select(0, haptic: false);
      },
      child: Scaffold(
        body: Column(
          children: [
            // Header, halts and the offline strip share a box that scrolls if
            // large text or several halts would otherwise starve the tab body.
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: size.height * 0.45),
              child: SingleChildScrollView(
                physics: const ClampingScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    StatusHeader(
                      condensed: keyboardUp,
                      onSearch: () => showJumpSheet(context, onSection: _openSection),
                      onSettings: () => AppNav.settings(context),
                      onMore: _more,
                      onStatus: () => showStatusSheet(context),
                    ),
                    const HaltBanner(),
                    _OfflineStrip(lost: lost),
                  ],
                ),
              ),
            ),
            Expanded(
              child: wide
                  ? Row(
                      children: [
                        rail,
                        VerticalDivider(width: 1, color: c.border),
                        Expanded(child: body),
                      ],
                    )
                  : body,
            ),
          ],
        ),
        bottomNavigationBar: wide || keyboardUp
            ? null
            : NavigationBar(
                selectedIndex: _index,
                onDestinationSelected: _select,
                destinations: [
                  for (final t in tabs) NavigationDestination(icon: icon(t), label: t.label),
                ],
              ),
      ),
    );
  }
}

/// "Offline · updated 4m ago" under the header while the live stream is down
/// or the server stopped answering. Data stays visible beneath it.
class _OfflineStrip extends ConsumerWidget {
  const _OfflineStrip({required this.lost});

  final bool lost;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(harnessProvider.select((s) => s.connection));
    if (connection != ConnectionStatus.offline && !lost) return const SizedBox.shrink();
    final cachedAt = ref.watch(harnessProvider.select((s) => s.cachedAt));
    final accountAt = ref.watch(harnessProvider.select((s) => s.feed.status?.account?.at));
    final nowMs = ref.watch(clockProvider).millisecondsSinceEpoch;
    final lastKnown = cachedAt ?? accountAt;
    return StaleBanner(
      offline: true,
      updatedAtMs: lastKnown,
      now: nowMs,
      message: lastKnown == null ? 'Reconnecting to the server\u2026' : null,
      onRetry: () => ref.read(serverLocatorProvider.notifier).retryNow(),
    );
  }
}
