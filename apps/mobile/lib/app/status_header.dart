import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/features/control/kill_switch.dart';
import 'package:longbow/features/control/live_lock.dart';

import 'status/agent_chip.dart';
import 'status/broker_chip.dart';
import 'status/session_chip.dart';
import 'status/status_text.dart';

/// The persistent header: equity and day P&L first, then one tappable row of
/// status pills (market, agent, broker, lock, mode) that opens the status
/// sheet, with the kill switch beside it. [condensed] drops the pill row while
/// the keyboard is up so the screen keeps its height.
class StatusHeader extends ConsumerWidget {
  const StatusHeader({
    super.key,
    required this.onSearch,
    required this.onSettings,
    required this.onMore,
    required this.onStatus,
    this.condensed = false,
  });

  final VoidCallback onSearch;
  final VoidCallback onSettings;
  final VoidCallback onMore;
  final VoidCallback onStatus;
  final bool condensed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.lb;
    final killed = ref.watch(harnessProvider.select((s) => s.feed.status?.settings.killSwitch ?? false));
    final pad = MediaQuery.paddingOf(context);
    final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final showMark = scale <= 1.15;

    return Material(
      color: killed ? Color.alphaBlend(c.destructive.withValues(alpha: 0.1), c.bar) : c.bar,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: killed ? c.destructive : c.border, width: killed ? 2 : 1)),
        ),
        child: Padding(
          padding: EdgeInsets.only(
            top: pad.top,
            left: math.max(LbSpace.gap, pad.left),
            right: math.max(4, pad.right),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  if (showMark) ...[
                    Semantics(
                      label: 'Longbow',
                      child: ExcludeSemantics(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(LbRadius.md),
                          child: Image.asset('assets/longbow-mark.png', width: 30, height: 30, errorBuilder: (_, _, _) => const SizedBox(width: 30, height: 30)),
                        ),
                      ),
                    ),
                    const SizedBox(width: LbSpace.gap),
                  ],
                  const Expanded(child: _EquityBlock()),
                  IconButton(tooltip: 'Jump to', onPressed: onSearch, icon: const LbIcon(LbIcons.search01)),
                  IconButton(tooltip: 'Settings', onPressed: onSettings, icon: const LbIcon(LbIcons.settings02)),
                  IconButton(tooltip: 'More', onPressed: onMore, icon: const LbIcon(LbIcons.moreHorizontal)),
                ],
              ),
              if (!condensed)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6, right: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(child: _StatusPills(onTap: onStatus)),
                      const SizedBox(width: 8),
                      const KillSwitchButton(compact: true),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EquityBlock extends ConsumerWidget {
  const _EquityBlock();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    if (status == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: Align(alignment: Alignment.centerLeft, child: SkeletonBlock(width: 128, height: 40, radius: LbRadius.md)),
      );
    }
    final equity = status.account?.equity;
    final dayPnl = status.dayPnl;
    final dayPct = status.dayPnlPct;
    final style = LbText.number(context, size: 22, weight: FontWeight.w600, letterSpacing: -0.4);

    final Widget equityText = equity == null
        ? Text('\u2014', style: style)
        : TweenAnimationBuilder<double>(
            tween: Tween<double>(end: equity.toDouble()),
            duration: LbMotion.duration(context, const Duration(milliseconds: 400)),
            curve: LbMotion.curve,
            builder: (_, v, _) => Text(usd(v), style: style, maxLines: 1),
          );
    final Widget day = dayPnl == null && dayPct == null
        ? Text('Day P&L unavailable', style: LbText.muted(context, size: 12))
        : Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 6,
            children: [
              Text('Day', style: LbText.muted(context, size: 12)),
              Pnl(amount: dayPnl, percent: dayPct, size: 13),
            ],
          );
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              label: equity == null ? 'Equity unavailable' : 'Equity ${usd(equity)}',
              excludeSemantics: true,
              child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: equityText),
            ),
            day,
          ],
        ),
      ),
    );
  }
}

class _StatusPills extends ConsumerWidget {
  const _StatusPills({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(harnessProvider.select((s) => s.feed.status?.settings.mode));
    final c = context.lb;
    return Semantics(
      button: true,
      label: 'Status details',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(LbRadius.md),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      const SessionChip(),
                      const AgentChip(),
                      const BrokerChip(),
                      const LiveLockChip(),
                      if (mode != null) StatusChip('Mode ${modeLabel(mode)}', icon: LbIcons.target01),
                    ],
                  ),
                ),
                LbIcon(LbIcons.chevronRight, size: 16, color: c.mutedForeground),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
