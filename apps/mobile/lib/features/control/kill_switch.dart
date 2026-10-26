import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/models/models.dart';

/// Kill switch button: engaging asks for destructive confirmation (nothing is
/// ever sent while it holds), releasing is one tap. Reads the harness store
/// itself so the app shell can drop it in a header or sheet with no wiring.
class KillSwitchButton extends ConsumerWidget {
  const KillSwitchButton({super.key, this.compact = false});

  final bool compact;

  Future<void> _press(BuildContext context, WidgetRef ref, bool engaged) async {
    final store = ref.read(harnessProvider.notifier);
    if (!engaged) {
      final ok = await showLbConfirm(
        context,
        title: 'Engage the kill switch?',
        message: 'No order of any kind is sent. Research cycles keep running.',
        confirmLabel: 'Engage kill switch',
        destructive: true,
      );
      if (!ok || !context.mounted) return;
    } else {
      Haptics.medium();
    }
    final done = await store.quickPatch(
      'kill',
      SettingsPatch(killSwitch: !engaged),
      engaged ? 'Kill switch released' : 'Kill switch engaged',
    );
    if (done && !engaged && context.mounted) Haptics.heavy();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final busy = ref.watch(harnessProvider.select((s) => s.busy['kill'] ?? false));
    final c = context.lb;
    if (status == null) {
      return compact
          ? const SizedBox(width: kMinTarget, height: kMinTarget, child: SkeletonBlock(height: kMinTarget))
          : const SkeletonBlock(height: kMinTarget);
    }
    final engaged = status.settings.killSwitch;
    final label = engaged
        ? (compact ? 'Engaged' : 'Engaged · Release')
        : (compact ? 'Kill' : 'Kill switch');
    final semantics = engaged ? 'Kill switch engaged. Release' : 'Engage kill switch';
    final Widget icon = busy
        ? SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator.adaptive(strokeWidth: 2),
          )
        : LbIcon(LbIcons.power, size: 18, color: engaged ? c.primaryForeground : c.destructive);

    if (compact) {
      return Semantics(
        button: true,
        label: semantics,
        excludeSemantics: true,
        child: Tooltip(
          message: semantics,
          child: InkWell(
            borderRadius: BorderRadius.circular(LbRadius.md),
            onTap: busy ? null : () => _press(context, ref, engaged),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minWidth: kMinTarget, minHeight: kMinTarget),
              child: Container(
                decoration: BoxDecoration(
                  color: engaged ? c.destructive : c.destructive.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(LbRadius.md),
                  border: engaged ? null : Border.all(color: c.destructive.withValues(alpha: 0.5)),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    icon,
                    const SizedBox(width: 6),
                    Text(
                      label,
                      style: Theme.of(context).textTheme.labelLarge!.copyWith(
                            color: engaged ? c.primaryForeground : c.destructive,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    final style = engaged
        ? FilledButton.styleFrom(
            backgroundColor: c.destructive,
            foregroundColor: c.primaryForeground,
            minimumSize: const Size(double.infinity, kMinTarget),
          )
        : OutlinedButton.styleFrom(
            foregroundColor: c.destructive,
            side: BorderSide(color: c.destructive.withValues(alpha: 0.5)),
            minimumSize: const Size(double.infinity, kMinTarget),
          );
    final button = engaged
        ? FilledButton.icon(
            style: style,
            onPressed: busy ? null : () => _press(context, ref, engaged),
            icon: icon,
            label: Text(semantics),
          )
        : OutlinedButton.icon(
            style: style,
            onPressed: busy ? null : () => _press(context, ref, engaged),
            icon: icon,
            label: Text(semantics),
          );
    return Semantics(
      button: true,
      label: semantics,
      excludeSemantics: true,
      child: SizedBox(width: double.infinity, child: button),
    );
  }
}
