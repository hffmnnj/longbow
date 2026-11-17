import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/data/state/toast.dart' as data_toast show ToastTone;
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

/// The current Android build from the connected server, opened in the external
/// browser so Android can install or update the app.
class AndroidAppSection extends ConsumerWidget {
  const AndroidAppSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locator = ref.watch(serverLocatorProvider);
    final baseUrl = locator is Connected ? locator.baseUrl : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Download the APK in your browser if updating inside the app does not work.',
          style: LbText.muted(context, size: 12.5),
        ),
        const SizedBox(height: LbSpace.gap),
        OutlinedButton.icon(
          onPressed: baseUrl == null
              ? null
              : () => _openAndroidApkDownload(ref, baseUrl),
          icon: const LbIcon(LbIcons.arrowDown01, size: 16),
          label: const Text('Download Android app'),
        ),
        if (baseUrl == null) ...[
          const SizedBox(height: 6),
          Text(
            'Connect to the server first.',
            style: LbText.muted(context, size: 12.5),
          ),
        ],
      ],
    );
  }
}

Future<void> _openAndroidApkDownload(WidgetRef ref, Uri baseUrl) async {
  var launched = false;
  try {
    final downloadUrl = baseUrl.replace(path: '/download/longbow.apk');
    launched = await ref.read(externalLauncherProvider)(downloadUrl);
  } catch (_) {
    launched = false;
  }
  if (!launched) {
    ref.read(toastQueueProvider).add(
      const ToastEvent(
        tone: data_toast.ToastTone.error,
        title: 'Could not open the download',
        body: 'Open /download/longbow.apk on the connected server from a browser on this phone.',
      ),
    );
  }
}

/// New Android builds from the connected server: the app downloads and checks
/// them in the background, and the user decides when to install. Shows this
/// build, the latest release, and a plain status with the one next action.
class UpdatesSection extends ConsumerWidget {
  const UpdatesSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final update = ref.watch(appUpdateProvider);
    final alertsOn = ref.watch(preferencesProvider.select((p) => p.notificationsEnabled));
    final controller = ref.read(appUpdateProvider.notifier);
    final c = context.lb;
    final release = update.release;
    final android = update.android;

    final (String label, StatusTone tone) = switch (update.status) {
      UpdateStatus.idle => ('Not checked', StatusTone.neutral),
      UpdateStatus.checking => ('Checking', StatusTone.neutral),
      UpdateStatus.downloading => (
          update.progress == null ? 'Downloading' : 'Downloading ${(update.progress! * 100).floor()}%',
          StatusTone.live,
        ),
      UpdateStatus.ready => ('Ready to install', StatusTone.gain),
      UpdateStatus.current => ('Up to date', StatusTone.neutral),
      UpdateStatus.error => ('Update failed', StatusTone.loss),
      UpdateStatus.offline => ('Offline', StatusTone.warn),
    };

    final Widget? action = switch (update.status) {
      UpdateStatus.ready => FilledButton.icon(
          onPressed: update.installing ? null : controller.install,
          icon: const LbIcon(LbIcons.arrowDown01, size: 16),
          label: Text(android == null ? 'Install update' : 'Install ${android.versionName}'),
        ),
      UpdateStatus.error || UpdateStatus.offline => OutlinedButton.icon(
          onPressed: () => controller.check(force: true),
          icon: const LbIcon(LbIcons.refresh, size: 16),
          label: const Text('Try again'),
        ),
      UpdateStatus.idle || UpdateStatus.current => OutlinedButton.icon(
          onPressed: () => controller.check(force: true),
          icon: const LbIcon(LbIcons.refresh, size: 16),
          label: const Text('Check now'),
        ),
      UpdateStatus.checking || UpdateStatus.downloading => null,
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          liveRegion: true,
          child: Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [StatusChip(label, tone: tone)],
          ),
        ),
        if (update.status == UpdateStatus.downloading) ...[
          const SizedBox(height: LbSpace.gap),
          LinearProgressIndicator(
            value: update.progress,
            minHeight: 4,
            semanticsLabel: 'Update download',
            semanticsValue: update.progress == null ? null : '${(update.progress! * 100).floor()}%',
          ),
        ],
        if ((update.status == UpdateStatus.error || update.status == UpdateStatus.offline)) ...[
          const SizedBox(height: 6),
          Text(
            update.status == UpdateStatus.offline
                ? 'Could not reach the server. Longbow tries again when it is back.'
                : update.errorMessage ?? 'The update failed.',
            style: LbText.muted(context).copyWith(color: update.status == UpdateStatus.error ? c.destructive : c.warn),
          ),
        ],
        const SizedBox(height: LbSpace.gap),
        KeyValueList(
          rows: [
            KeyValueRow('This app', value: update.installedLabel),
            KeyValueRow('Latest release', value: release == null ? 'None yet' : release.version),
            if (android != null) KeyValueRow('Android build', value: '${android.versionName} (${android.versionCode}) \u00b7 ${_size(android.size)}'),
          ],
        ),
        if (release != null && (release.title.isNotEmpty || release.notes.isNotEmpty)) ...[
          const SizedBox(height: LbSpace.gap),
          if (release.title.isNotEmpty) Text(release.title, style: Theme.of(context).textTheme.titleSmall),
          Text(DateFormat.yMMMd().format(release.publishedAt), style: LbText.muted(context, size: 12.5)),
          if (release.notes.isNotEmpty) Disclosure(title: 'Release notes', child: LbMarkdown(release.notes)),
        ],
        if (update.installDenied) ...[
          const SizedBox(height: LbSpace.gap),
          Semantics(
            liveRegion: true,
            child: Text(
              'Android needs your OK before Longbow can install an update. Turn on Allow from this source for Longbow, come back here, and tap Install again.',
              style: LbText.muted(context).copyWith(color: c.warn),
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.tonal(onPressed: controller.openInstallSettings, child: const Text('Open install settings')),
          ),
        ],
        if (action != null) ...[
          const SizedBox(height: LbSpace.gap),
          Align(alignment: Alignment.centerLeft, child: action),
        ],
        if (!alertsOn) ...[
          const SizedBox(height: 8),
          Text('Trade alerts are off, so Longbow only looks for updates while it is open.', style: LbText.muted(context, size: 12.5)),
        ],
      ],
    );
  }
}

String _size(int bytes) => '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
