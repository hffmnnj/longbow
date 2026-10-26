import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

/// The verdict at a glance: equity, today's result, cash and buying power.
class EquityHero extends ConsumerWidget {
  const EquityHero({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final loaded = ref.watch(harnessProvider.select((s) => s.loaded));
    final loadError = ref.watch(harnessProvider.select((s) => s.loadError));
    if (status == null) {
      if (loaded && loadError != null) {
        return LbCard(
          child: ErrorState(
            title: 'Could not load the account',
            message: loadError,
            onRetry: () => ref.read(harnessProvider.notifier).refresh(),
          ),
        );
      }
      return const SkeletonBlock(height: heroSkeletonHeight, radius: LbRadius.lg);
    }
    final account = status.account;
    if (account == null) {
      return const LbCard(
        child: Empty(
          title: 'Robinhood not connected',
          message: 'Connect it from Settings to see equity and positions.',
          icon: LbIcons.wallet01,
        ),
      );
    }
    return _Hero(account: account, dayPnl: status.dayPnl, dayPnlPct: status.dayPnlPct);
  }
}

/// Height of the loading block; roughly the loaded hero at text scale 1.
const double heroSkeletonHeight = 176;

class _Hero extends StatelessWidget {
  const _Hero({required this.account, required this.dayPnl, required this.dayPnlPct});

  final AccountSnapshot account;
  final double? dayPnl;
  final double? dayPnlPct;

  @override
  Widget build(BuildContext context) {
    final equity = account.equity;
    final invested = account.positions.fold<double>(0, (a, p) => a + p.marketValue);
    final cashPct = equity > 0 ? account.cash / equity * 100 : null;
    final investedPct = equity > 0 ? invested / equity * 100 : null;
    final hasDay = dayPnl != null || dayPnlPct != null;
    final dayWords = !hasDay
        ? 'Day result unavailable'
        : 'Today ${dayPnl != null ? usdSigned(dayPnl!) : ''} ${dayPnlPct != null ? pctSigned(dayPnlPct!) : ''}'.replaceAll('  ', ' ');
    return LbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 12,
            runSpacing: 2,
            children: [
              const SectionLabel('Equity'),
              Text('as of ${etStamp(account.at)}', style: LbText.caption(context)),
            ],
          ),
          const SizedBox(height: 4),
          Semantics(
            label: 'Equity ${usd(equity)}. $dayWords',
            child: ExcludeSemantics(child: _RollingEquity(value: equity)),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('Today', style: LbText.muted(context, size: 14)),
              if (hasDay)
                Pnl(amount: dayPnl, percent: dayPnlPct, size: 17, weight: FontWeight.w600)
              else
                Text('\u2014', style: LbText.number(context, size: 17, color: context.lb.mutedForeground)),
            ],
          ),
          const SizedBox(height: LbSpace.gap),
          Divider(height: 1, color: context.lb.border),
          const SizedBox(height: LbSpace.gap),
          Wrap(
            spacing: 28,
            runSpacing: 12,
            children: [
              Stat(label: 'Cash', value: usd(account.cash), sub: cashPct == null ? null : '${pct(cashPct)} of equity'),
              Stat(label: 'Buying power', value: usd(account.buyingPower)),
              if (investedPct != null) Stat(label: 'Invested', value: pct(investedPct), sub: '${account.positions.length} held'),
            ],
          ),
        ],
      ),
    );
  }
}

/// Large mono equity figure that rolls to a new value (instant under reduced
/// motion). Scales down rather than overflowing at large text sizes.
class _RollingEquity extends StatelessWidget {
  const _RollingEquity({required this.value});

  final double value;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: value),
      duration: LbMotion.duration(context, LbMotion.sheet),
      curve: LbMotion.curve,
      builder: (context, v, _) => FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Text(usd(v), maxLines: 1, style: LbText.display(context)),
      ),
    );
  }
}
