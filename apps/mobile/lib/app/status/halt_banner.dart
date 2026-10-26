import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/models/models.dart';

import 'status_text.dart';

/// Amber strip under the header while any halt is active, in plain words.
/// A drawdown halt carries a Re-arm action behind a confirmation.
class HaltBanner extends ConsumerWidget {
  const HaltBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final halts = status?.halts ?? const <HaltReason>[];
    if (halts.isEmpty) return const SizedBox.shrink();
    final c = context.lb;
    final canRearm = halts.contains(HaltReason.drawdown) || (status?.settings.drawdownHalted ?? false);

    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.only(
          left: LbSpace.screen + MediaQuery.paddingOf(context).left,
          right: (canRearm ? 4 : LbSpace.screen) + MediaQuery.paddingOf(context).right,
          top: 8,
          bottom: 8,
        ),
        decoration: BoxDecoration(
          color: c.warnBg,
          border: Border(bottom: BorderSide(color: c.warn.withValues(alpha: 0.3))),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(padding: const EdgeInsets.only(top: 2), child: LbIcon(LbIcons.alert02, size: 18, color: c.warn)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final h in halts)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 1),
                      child: Text(haltWords[h]!, style: Theme.of(context).textTheme.bodySmall!.copyWith(color: c.warn, fontSize: 13)),
                    ),
                ],
              ),
            ),
            if (canRearm)
              TextButton(
                onPressed: () => _rearm(context, ref),
                style: TextButton.styleFrom(foregroundColor: c.warn),
                child: const Text('Re-arm'),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _rearm(BuildContext context, WidgetRef ref) async {
    final ok = await showLbConfirm(
      context,
      title: 'Re-arm after drawdown halt?',
      message: 'New entries are allowed again, subject to the mode and every risk limit. Only do this after reviewing why the drawdown tripped.',
      confirmLabel: 'Re-arm',
    );
    if (!ok) return;
    await ref.read(harnessProvider.notifier).quickPatch('rearm', const SettingsPatch(drawdownHalted: false), 'Drawdown halt cleared');
  }
}
