import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/orders.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

/// One journal decision: action, symbol, headline, rationale, confidence,
/// evidence, and a link to the order it produced (port of DecisionCard.svelte).
///
/// [order] is the order this decision produced; when omitted and the entry
/// names one, it is looked up in the live account. Pass [linkable] false in
/// the lab, where orders live in the run and not in the live account.
class DecisionCard extends ConsumerStatefulWidget {
  const DecisionCard({super.key, required this.entry, this.order, this.linkable = true});

  final JournalEntry entry;
  final OrderRecord? order;
  final bool linkable;

  @override
  ConsumerState<DecisionCard> createState() => _DecisionCardState();
}

class _DecisionCardState extends ConsumerState<DecisionCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final entry = widget.entry;
    final c = context.lb;
    final theme = Theme.of(context).textTheme;
    final orderId = entry.orderId;
    final order = widget.order ??
        (orderId == null
            ? null
            : ref.watch(harnessProvider.select((s) {
                for (final o in s.feed.orders) {
                  if (o.id == orderId) return o;
                }
                return null;
              })));
    final checks = order?.verdict.checks ?? const <RiskCheck>[];
    final failed = checks.where((x) => !x.ok).toList();
    final win = order != null
        ? ('win', order.intent.probabilityWin)
        : entry.confidence != null
            ? ('conf', entry.confidence!)
            : null;
    final reasoning = order?.intent.thesis ?? entry.rationale;
    final headline = '${entry.action.name}${entry.symbol != null ? ' ${entry.symbol}' : ''} decision';

    return Semantics(
      container: true,
      label: headline,
      child: LbCard(
        padding: const EdgeInsets.symmetric(horizontal: LbSpace.card, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                ActionBadge(entry.action.name),
                if (entry.symbol != null) TickerLink(entry.symbol!),
                Text(etStamp(entry.at), style: LbText.number(context, size: 11.5, weight: FontWeight.w400, color: c.mutedForeground)),
              ],
            ),
            Text(entry.summary, style: theme.titleSmall!.copyWith(fontSize: 14.5, height: 1.35)),
            if (win != null) ...[
              const SizedBox(height: 8),
              _ConfidenceMeter(label: win.$1, value: win.$2),
            ],
            const SizedBox(height: 8),
            Text(
              reasoning,
              maxLines: _open ? null : 2,
              overflow: _open ? TextOverflow.visible : TextOverflow.ellipsis,
              style: LbText.muted(context, size: 13).copyWith(height: 1.45),
            ),
            if (entry.evidence.isNotEmpty) ...[
              const SizedBox(height: 8),
              SectionLabel('Evidence ${entry.evidence.length}'),
              const SizedBox(height: 4),
              if (!_open)
                Text(entry.evidence.first, maxLines: 1, overflow: TextOverflow.ellipsis, style: LbText.muted(context, size: 12.5))
              else
                for (final ev in entry.evidence)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 7, right: 8),
                          child: DecoratedBox(
                            decoration: BoxDecoration(color: c.mutedForeground, shape: BoxShape.circle),
                            child: const SizedBox.square(dimension: 4),
                          ),
                        ),
                        Expanded(child: Text(ev, style: LbText.muted(context, size: 12.5))),
                      ],
                    ),
                  ),
            ],
            if (_open && entry.regime != null) ...[
              const SizedBox(height: 4),
              Text('Regime: ${entry.regime}', style: LbText.muted(context, size: 12.5)),
            ],
            if (_open && order != null)
              for (final f in failed)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(padding: const EdgeInsets.only(top: 2), child: LbIcon(LbIcons.close, size: 14, color: c.loss)),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text.rich(
                          TextSpan(children: [
                            TextSpan(text: '${ruleName(f.rule)}. ', style: const TextStyle(fontWeight: FontWeight.w600)),
                            TextSpan(text: f.detail),
                          ]),
                          style: LbText.muted(context, size: 12.5).copyWith(color: c.loss),
                        ),
                      ),
                    ],
                  ),
                ),
            const SizedBox(height: 4),
            Row(
              children: [
                Expanded(child: _footerStatus(context, order, failed, checks)),
                TextButton(
                  onPressed: () => setState(() => _open = !_open),
                  style: TextButton.styleFrom(foregroundColor: c.mutedForeground),
                  child: Semantics(expanded: _open, child: Text(_open ? 'Less' : 'Details')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _footerStatus(BuildContext context, OrderRecord? order, List<RiskCheck> failed, List<RiskCheck> checks) {
    final c = context.lb;
    final entry = widget.entry;
    if (order != null) {
      final bad = failed.isNotEmpty;
      return Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          StatusChip(
            bad ? 'Risk: ${failed.length} of ${checks.length} failed' : 'Risk: all ${checks.length} checks passed',
            tone: bad ? StatusTone.loss : StatusTone.gain,
            icon: bad ? LbIcons.close : LbIcons.check,
          ),
          if (widget.linkable)
            TextButton.icon(
              onPressed: () => AppNav.order(context, order.id),
              icon: const LbIcon(LbIcons.arrowRight01, size: 14),
              iconAlignment: IconAlignment.end,
              label: Semantics(label: 'Open order: ${statusLabel(order.status)}', excludeSemantics: true, child: Text(statusLabel(order.status))),
            )
          else
            Text(statusLabel(order.status), style: LbText.muted(context, size: 12.5)),
        ],
      );
    }
    if (entry.orderId != null) {
      return Text('Order no longer in the recent list', style: LbText.muted(context, size: 12.5));
    }
    if (entry.action == JournalAction.buy || entry.action == JournalAction.sell) {
      return Text('No order was submitted', style: LbText.muted(context, size: 12.5));
    }
    return Text('', style: TextStyle(color: c.mutedForeground));
  }
}

class _ConfidenceMeter extends StatelessWidget {
  const _ConfidenceMeter({required this.label, required this.value});

  final String label;
  final double value;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final v = value.clamp(0.0, 1.0);
    final text = '$label ${(value * 100).round()}%';
    return Semantics(
      label: label == 'win' ? 'Stated probability of winning ${(value * 100).round()} percent' : 'Agent confidence ${(value * 100).round()} percent',
      excludeSemantics: true,
      child: Row(
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(2),
              child: SizedBox(
                height: 4,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ColoredBox(color: c.secondary),
                    FractionallySizedBox(alignment: Alignment.centerLeft, widthFactor: v, child: ColoredBox(color: c.primary)),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Text(text, style: LbText.number(context, size: 11.5, color: c.mutedForeground)),
        ],
      ),
    );
  }
}
