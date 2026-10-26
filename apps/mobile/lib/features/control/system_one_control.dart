import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/system_one.dart';
import 'package:longbow/models/models.dart';

/// System One (decision model) connection and gate, wired to the settings
/// patch. Sits directly below the Mode control with the same rhythm: a status
/// row with a master switch, a mono stats caption, then an Off / Advise /
/// Block gate. The gate locks while the master switch is off.
class SystemOneControl extends ConsumerWidget {
  const SystemOneControl({super.key});

  Future<void> _setEnabled(WidgetRef ref, bool next) async {
    Haptics.selection();
    await ref.read(harnessProvider.notifier).quickPatch(
          'sysone',
          SettingsPatch(systemOne: SystemOneSettingsPatch(enabled: next)),
        );
  }

  Future<void> _setGate(
    WidgetRef ref,
    SystemOneGate next,
    SystemOneGate current,
  ) async {
    if (next == current) return;
    await ref.read(harnessProvider.notifier).quickPatch(
          'sysone-gate',
          SettingsPatch(systemOne: SystemOneSettingsPatch(gate: next)),
        );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final busySys =
        ref.watch(harnessProvider.select((s) => s.busy['sysone'] ?? false));
    final busyGate = ref.watch(
      harnessProvider.select((s) => s.busy['sysone-gate'] ?? false),
    );
    if (status == null) return const SkeletonBlock(height: kMinTarget);
    final c = context.lb;
    final settings = status.settings.systemOne;
    final info = status.systemOne;
    final state = info?.state ?? SystemOneState.unconfigured;
    final dot = switch (systemOneTone(state)) {
      SystemOneTone.ok => c.gain,
      SystemOneTone.warn => c.warn,
      SystemOneTone.bad => c.destructive,
      SystemOneTone.muted => c.mutedForeground,
    };
    final cooldown = info == null
        ? null
        : systemOneCooldownUntil(info.state, info.cooldownUntil);

    final gateSelector = LbSegmented<SystemOneGate>(
      semanticLabel: 'System One gate',
      selected: settings.gate,
      segments: const [
        LbSegment(SystemOneGate.off, 'Off'),
        LbSegment(SystemOneGate.advise, 'Advise'),
        LbSegment(SystemOneGate.block, 'Block'),
      ],
      onChanged: (next) => _setGate(ref, next, settings.gate),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Row(
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  systemOneLabel(state),
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w500),
                ),
              ),
              if (info != null) ...[
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    info.model,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: LbText.number(
                      context,
                      size: 12,
                      weight: FontWeight.w400,
                      color: c.mutedForeground,
                    ),
                  ),
                ),
              ] else
                const Spacer(),
              Semantics(
                label: 'System One enabled',
                toggled: settings.enabled,
                excludeSemantics: true,
                child: Switch(
                  value: settings.enabled,
                  onChanged: busySys ? null : (v) => _setEnabled(ref, v),
                ),
              ),
            ],
          ),
        ),
        if (info != null)
          Text(
            systemOneStatsLine(
              calls24h: info.calls24h,
              medianLatencyMs: info.medianLatencyMs,
            ),
            style: LbText.number(
              context,
              size: 12,
              weight: FontWeight.w400,
              color: c.mutedForeground,
            ),
          ),
        if (cooldown != null)
          Text(
            'Cooldown until ${etTime(cooldown)}',
            style: LbText.muted(context, size: 12),
          ),
        if (info?.lastError?.isNotEmpty ?? false)
          Tooltip(
            message: info!.lastError!,
            child: Text(
              info.lastError!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: LbText.muted(context, size: 12),
            ),
          ),
        const SizedBox(height: 6),
        IgnorePointer(
          ignoring: !settings.enabled || busyGate,
          child: Opacity(
            opacity: settings.enabled ? 1 : 0.5,
            child: settings.gate == SystemOneGate.block
                ? Theme(
                    data: Theme.of(context).copyWith(
                      segmentedButtonTheme: SegmentedButtonThemeData(
                        style: (SegmentedButtonTheme.of(context).style ??
                                const ButtonStyle())
                            .copyWith(
                          backgroundColor:
                              WidgetStateProperty.resolveWith((states) =>
                                  states.contains(WidgetState.selected)
                                      ? c.warnBg
                                      : Colors.transparent),
                          foregroundColor:
                              WidgetStateProperty.resolveWith((states) =>
                                  states.contains(WidgetState.selected)
                                      ? c.warn
                                      : c.mutedForeground),
                        ),
                      ),
                    ),
                    child: gateSelector,
                  )
                : gateSelector,
          ),
        ),
      ],
    );
  }
}
