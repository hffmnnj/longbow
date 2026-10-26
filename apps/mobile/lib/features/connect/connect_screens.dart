import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;

import 'host_form.dart';

/// Longbow mark on the background colour, matching the native splash so the
/// hand-off from splash to Flutter shows no flash. A thin progress bar sits
/// below the mark without moving it.
class SplashView extends StatelessWidget {
  const SplashView({super.key});

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: context.lb.background,
      child: Stack(
        children: [
          Center(
            child: Image.asset(
              'assets/longbow-mark.png',
              width: 96,
              height: 96,
              semanticLabel: 'Longbow',
              errorBuilder: (_, _, _) => const SizedBox(width: 96, height: 96),
            ),
          ),
          Align(
            alignment: const Alignment(0, 0.3),
            child: Semantics(
              label: 'Looking for the server',
              child: const SizedBox(width: 96, child: LinearProgressIndicator(minHeight: 2)),
            ),
          ),
        ],
      ),
    );
  }
}

/// Frame shared by the two connect screens: centered column, scrolls when the
/// keyboard or a large text size needs the room.
class _ConnectFrame extends StatelessWidget {
  const _ConnectFrame({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, box) => SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.all(LbSpace.screen + 8),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: box.maxHeight - 2 * (LbSpace.screen + 8)),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Mark extends StatelessWidget {
  const _Mark();

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerLeft,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(LbRadius.lg),
          child: Image.asset('assets/longbow-mark.png', width: 56, height: 56, semanticLabel: 'Longbow', errorBuilder: (_, _, _) => const SizedBox(width: 56, height: 56)),
        ),
      );
}

/// First launch with no known server: ask for the host.
class NoHostsView extends StatelessWidget {
  const NoHostsView({super.key});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return _ConnectFrame(
      children: [
        const _Mark(),
        const SizedBox(height: LbSpace.screen + 4),
        Semantics(header: true, child: Text('Connect to Longbow', style: t.headlineSmall)),
        const SizedBox(height: 8),
        Text(
          'Longbow is reachable over your Tailscale network. Turn Tailscale on, then enter the address of your server.',
          style: LbText.muted(context, size: 15),
        ),
        const SizedBox(height: LbSpace.screen + 8),
        const HostForm(autofocus: true),
      ],
    );
  }
}

/// Servers were tried and none answered. Retries by itself; [probing] shows
/// a progress bar while a probe is running.
class UnreachableView extends ConsumerStatefulWidget {
  const UnreachableView({super.key, required this.state, this.probing = false});

  final Unreachable state;
  final bool probing;

  @override
  ConsumerState<UnreachableView> createState() => _UnreachableViewState();
}

class _UnreachableViewState extends ConsumerState<UnreachableView> {
  bool _tailscaleMissing = false;
  bool _opening = false;

  Future<void> _openTailscale() async {
    if (_opening) return;
    setState(() => _opening = true);
    final opened = await ref.read(nativeBridgeProvider).openTailscale();
    if (!mounted) return;
    setState(() {
      _opening = false;
      _tailscaleMissing = !opened;
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final u = widget.state;
    return _ConnectFrame(
      children: [
        const _Mark(),
        const SizedBox(height: LbSpace.screen + 4),
        Semantics(header: true, liveRegion: true, child: Text("Can't reach Longbow", style: t.headlineSmall)),
        const SizedBox(height: 8),
        Text(
          u.tailscaleLikely
              ? 'The server is on your Tailscale network. Make sure Tailscale is connected, then try again.'
              : 'The server did not answer. Check the address and your connection, then try again.',
          style: LbText.muted(context, size: 15),
        ),
        const SizedBox(height: LbSpace.gap),
        SizedBox(
          height: 2,
          child: widget.probing ? const LinearProgressIndicator(minHeight: 2) : null,
        ),
        const SizedBox(height: LbSpace.gap),
        FilledButton.icon(
          onPressed: widget.probing ? null : () => ref.read(serverLocatorProvider.notifier).retryNow(),
          icon: const LbIcon(LbIcons.refresh, size: 18),
          label: Text(widget.probing ? 'Trying\u2026' : 'Retry'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _opening ? null : _openTailscale,
          icon: const LbIcon(LbIcons.link04, size: 18),
          label: const Text('Open Tailscale'),
        ),
        if (_tailscaleMissing) ...[
          const SizedBox(height: LbSpace.gap),
          Semantics(
            liveRegion: true,
            child: Text(
              'Tailscale is not installed on this phone. Install it from the page that just opened, sign in, then tap Retry.',
              style: LbText.muted(context).copyWith(color: c.warn),
            ),
          ),
        ],
        const SizedBox(height: LbSpace.screen),
        if (u.tried.isNotEmpty)
          Disclosure(
            title: 'What was tried',
            child: Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final url in u.tried)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: SelectableText(url, style: LbText.number(context, size: 12.5, weight: FontWeight.w400, color: c.mutedForeground)),
                    ),
                ],
              ),
            ),
          ),
        Disclosure(
          title: 'Advanced',
          initiallyExpanded: u.tried.isEmpty,
          child: const Padding(padding: EdgeInsets.only(bottom: 8), child: HostForm(submitLabel: 'Use this host')),
        ),
      ],
    );
  }
}
