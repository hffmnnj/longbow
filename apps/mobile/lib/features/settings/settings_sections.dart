import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/features/connect/host_form.dart';
import 'package:longbow/models/models.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'robinhood_sign_in.dart';

/// Robinhood connection: status, Connect (opens the sign-in page in the
/// browser) or Disconnect (confirmed).
class RobinhoodSection extends ConsumerWidget {
  const RobinhoodSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final broker = ref.watch(harnessProvider.select((s) => s.feed.status?.broker));
    final busyConnect = ref.watch(harnessProvider.select((s) => s.busy['connect'] ?? false));
    final busyDisconnect = ref.watch(harnessProvider.select((s) => s.busy['disconnect'] ?? false));
    if (broker == null) {
      return Text('Waiting for the server.', style: LbText.muted(context));
    }
    final connected = broker.state == BrokerState.connected;
    final needsConnect = broker.state == BrokerState.disconnected || broker.state == BrokerState.needsAuth || broker.state == BrokerState.error;
    final label = switch (broker.state) {
      BrokerState.connected => 'Connected',
      BrokerState.disconnected => 'Not connected',
      BrokerState.needsAuth => 'Sign-in needed',
      BrokerState.connecting => 'Connecting',
      BrokerState.error => 'Error',
    };
    final tone = switch (broker.state) {
      BrokerState.connected => StatusTone.live,
      BrokerState.error => StatusTone.loss,
      BrokerState.connecting => StatusTone.warn,
      _ => StatusTone.neutral,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('Robinhood', style: Theme.of(context).textTheme.bodyMedium),
            StatusChip(label, tone: tone),
          ],
        ),
        if (broker.state == BrokerState.error && broker.error != null) ...[
          const SizedBox(height: 6),
          Text(broker.error!, style: LbText.muted(context).copyWith(color: context.lb.destructive)),
        ],
        if (needsConnect) ...[
          const SizedBox(height: LbSpace.gap),
          FilledButton.icon(
            onPressed: busyConnect ? null : () => startRobinhoodSignIn(ref),
            icon: const LbIcon(LbIcons.link04, size: 16),
            label: const Text('Connect Robinhood'),
          ),
          const SizedBox(height: 6),
          Text('Sign-in opens in your browser. Come back here when you are done.', style: LbText.muted(context, size: 12.5)),
        ],
        if (connected) ...[
          const SizedBox(height: LbSpace.gap),
          OutlinedButton(
            onPressed: busyDisconnect
                ? null
                : () async {
                    final ok = await showLbConfirm(
                      context,
                      title: 'Disconnect Robinhood?',
                      message: 'The agent keeps researching but cannot read the account or place orders until you reconnect.',
                      confirmLabel: 'Disconnect',
                      destructive: true,
                    );
                    if (ok) await ref.read(harnessProvider.notifier).disconnectRobinhood();
                  },
            child: const Text('Disconnect'),
          ),
        ],
      ],
    );
  }
}

/// Trade alerts from the native foreground service: reflects the real state
/// (on, off, blocked by the system) and re-reads it when the app returns.
class NotificationsSection extends ConsumerStatefulWidget {
  const NotificationsSection({super.key});

  @override
  ConsumerState<NotificationsSection> createState() => _NotificationsSectionState();
}

class _NotificationsSectionState extends ConsumerState<NotificationsSection> with WidgetsBindingObserver {
  NotificationState? _state;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final next = await ref.read(nativeBridgeProvider).notificationsStatus();
    if (mounted) setState(() => _state = next);
  }

  Future<void> _toggle(bool on, Uri? baseUrl) async {
    final bridge = ref.read(nativeBridgeProvider);
    setState(() => _busy = true);
    try {
      if (on) {
        if (baseUrl == null) return;
        await bridge.enableNotifications(baseUrl.toString());
      } else {
        await bridge.disableNotifications();
      }
      final next = await bridge.notificationsStatus();
      await ref.read(preferencesProvider.notifier).setNotificationsEnabled(next == NotificationState.on);
      if (mounted) setState(() => _state = next);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final locator = ref.watch(serverLocatorProvider);
    final baseUrl = locator is Connected ? locator.baseUrl : null;
    final state = _state;
    final blocked = state == NotificationState.blocked;
    final on = state == NotificationState.on;
    final subtitle = switch (state) {
      null => 'Checking\u2026',
      NotificationState.on => 'On. Fills, approvals and reports alert this phone.',
      NotificationState.off => baseUrl == null ? 'Connect to the server first.' : 'Off. Turn on to get trade alerts.',
      NotificationState.blocked => 'Blocked by Android.',
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LbSwitchRow(
          title: 'Trade alerts',
          subtitle: subtitle,
          value: on,
          onChanged: _busy || blocked || state == null || (!on && baseUrl == null) ? null : (v) => _toggle(v, baseUrl),
        ),
        if (blocked)
          Semantics(
            liveRegion: true,
            child: Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Notifications are turned off for Longbow in Android. Open Settings, Apps, Longbow, Notifications, allow them, then come back here.',
                style: LbText.muted(context).copyWith(color: context.lb.warn),
              ),
            ),
          ),
      ],
    );
  }
}

/// System, Dark or Light.
class AppearanceSection extends ConsumerWidget {
  const AppearanceSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(preferencesProvider.select((p) => p.themeMode));
    return LbSegmented<AppThemeMode>(
      semanticLabel: 'Theme',
      selected: mode,
      onChanged: (m) => ref.read(preferencesProvider.notifier).setThemeMode(m),
      segments: const [
        LbSegment(AppThemeMode.system, 'System'),
        LbSegment(AppThemeMode.dark, 'Dark'),
        LbSegment(AppThemeMode.light, 'Light'),
      ],
    );
  }
}

/// The address the app is using, with Retry and Change host.
class ServerSection extends ConsumerStatefulWidget {
  const ServerSection({super.key});

  @override
  ConsumerState<ServerSection> createState() => _ServerSectionState();
}

class _ServerSectionState extends ConsumerState<ServerSection> {
  bool _editing = false;

  @override
  Widget build(BuildContext context) {
    final locator = ref.watch(serverLocatorProvider);
    final saved = ref.watch(preferencesProvider.select((p) => p.savedHost));
    final (String address, StatusTone tone, String stateLabel) = switch (locator) {
      Connected(:final baseUrl) => (baseUrl.toString(), StatusTone.live, 'Connected'),
      Searching() => ('Searching\u2026', StatusTone.neutral, 'Searching'),
      Unreachable(:final tried) => (tried.isEmpty ? 'No answer' : tried.first, StatusTone.warn, "Can't reach"),
      NoHosts() => ('No server set', StatusTone.neutral, 'Not set'),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            StatusChip(stateLabel, tone: tone),
            SelectableText(address, style: LbText.number(context, size: 13, weight: FontWeight.w400)),
          ],
        ),
        const SizedBox(height: LbSpace.gap),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: () => ref.read(serverLocatorProvider.notifier).retryNow(),
              icon: const LbIcon(LbIcons.refresh, size: 16),
              label: const Text('Retry'),
            ),
            TextButton(
              onPressed: () => setState(() => _editing = !_editing),
              child: Text(_editing ? 'Cancel' : 'Change host'),
            ),
          ],
        ),
        if (_editing) ...[
          const SizedBox(height: LbSpace.gap),
          HostForm(
            submitLabel: 'Use this host',
            initialValue: saved,
            autofocus: true,
            onSubmitted: () {
              if (mounted) setState(() => _editing = false);
            },
          ),
        ],
      ],
    );
  }
}

/// App version.
class AboutSection extends StatefulWidget {
  const AboutSection({super.key});

  @override
  State<AboutSection> createState() => _AboutSectionState();
}

class _AboutSectionState extends State<AboutSection> {
  late final Future<String> _version = _load();

  static Future<String> _load() async {
    try {
      final info = await PackageInfo.fromPlatform();
      return info.buildNumber.isEmpty ? info.version : '${info.version} (${info.buildNumber})';
    } catch (_) {
      return '\u2014';
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String>(
      future: _version,
      builder: (context, snap) => KeyValueRow('Longbow', value: snap.data ?? '\u2026'),
    );
  }
}
