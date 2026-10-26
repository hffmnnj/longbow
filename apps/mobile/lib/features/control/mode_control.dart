import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/models/models.dart';

/// Off / Approve / Auto selector wired to the settings patch. Moving to Auto
/// asks for confirmation; the whole control locks while the kill switch is
/// engaged. Reads the harness store itself so the app shell can drop it in a
/// header or sheet with no wiring.
class ModeControl extends ConsumerWidget {
  const ModeControl({super.key});

  static const _descriptions = {
    TradingMode.off: 'The agent reads and reasons. It does not propose orders.',
    TradingMode.approve: 'Each risk-approved order is queued until you approve it.',
    TradingMode.auto: 'Risk-approved orders go to Robinhood without waiting for you.',
  };

  static const _done = {
    TradingMode.off: 'Mode off: research only',
    TradingMode.approve: 'Orders wait for you',
    TradingMode.auto: 'Auto mode on',
  };

  Future<void> _change(BuildContext context, WidgetRef ref, TradingMode next) async {
    final store = ref.read(harnessProvider.notifier);
    if (next == TradingMode.auto) {
      final ok = await showLbConfirm(
        context,
        title: 'Switch to Auto?',
        message:
            'Risk-approved orders will be placed on Robinhood immediately, without waiting for you. The kill switch still blocks everything.',
        confirmLabel: 'Enable Auto',
        destructive: true,
      );
      if (!ok || !context.mounted) return;
      Haptics.medium();
    }
    await store.quickPatch('mode', SettingsPatch(mode: next), _done[next]);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final busy = ref.watch(harnessProvider.select((s) => s.busy['mode'] ?? false));
    if (status == null) return const SkeletonBlock(height: kMinTarget);
    final mode = status.settings.mode;
    final killed = status.settings.killSwitch;

    final selector = IgnorePointer(
      ignoring: killed || busy,
      child: Opacity(
        opacity: killed ? 0.5 : 1,
        child: LbSegmented<TradingMode>(
          semanticLabel: 'Trading mode',
          selected: mode,
          segments: const [
            LbSegment(TradingMode.off, 'Off'),
            LbSegment(TradingMode.approve, 'Approve'),
            LbSegment(TradingMode.auto, 'Auto'),
          ],
          onChanged: (next) {
            if (next == mode || busy) return;
            _change(context, ref, next);
          },
        ),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        selector,
        const SizedBox(height: 4),
        if (killed)
          Text(
            'Mode is locked while the kill switch is engaged.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: context.lb.warn),
          )
        else
          Text(_descriptions[mode]!, style: LbText.muted(context)),
      ],
    );
  }
}
