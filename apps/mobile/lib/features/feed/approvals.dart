import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/orders.dart';
import 'package:longbow/models/models.dart';

import 'order_card.dart';

/// Orders waiting for a human decision, as a collapsible strip with an
/// Approve and Reject card per order (port of Approvals.svelte). It opens by
/// itself when a new order arrives. With [constrained] it caps its height and
/// scrolls inside; without, it lays out at full height for a side pane.
class ApprovalsArea extends ConsumerStatefulWidget {
  const ApprovalsArea({super.key, this.constrained = true, this.showEmpty = false, this.maxHeight});

  final bool constrained;

  /// Height the whole strip (header and cards) may take when [constrained];
  /// defaults to half the screen. The Feed passes a share of its own height so
  /// the transcript and composer always keep room.
  final double? maxHeight;

  /// Say "Nothing waiting for approval" instead of collapsing to nothing.
  final bool showEmpty;

  @override
  ConsumerState<ApprovalsArea> createState() => _ApprovalsAreaState();
}

class _ApprovalsAreaState extends ConsumerState<ApprovalsArea> {
  bool _open = true;

  @override
  Widget build(BuildContext context) {
    ref.listen<List<OrderRecord>>(pendingOrdersProvider, (prev, next) {
      if (next.length > (prev?.length ?? 0) && !_open) setState(() => _open = true);
    });
    final pending = ref.watch(pendingOrdersProvider);
    final c = context.lb;
    if (pending.isEmpty) {
      return widget.showEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: LbSpace.gap),
              child: Text('Nothing waiting for approval', style: LbText.muted(context)),
            )
          : const SizedBox.shrink();
    }
    final cards = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < pending.length; i++) ...[
          if (i > 0) const SizedBox(height: LbSpace.gap),
          OrderCard(key: ValueKey(pending[i].id), order: pending[i], compact: widget.constrained),
        ],
      ],
    );
    final stripCap = widget.maxHeight ?? MediaQuery.sizeOf(context).height * 0.5;
    final contentCap = (stripCap - kMinTarget - LbSpace.gap).clamp(0.0, double.infinity);
    final header = Semantics(
      button: true,
      expanded: _open,
      label: 'Pending approval, ${pending.length}',
      excludeSemantics: true,
      onTap: () => setState(() => _open = !_open),
      child: InkWell(
        onTap: () => setState(() => _open = !_open),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: LbSpace.screen),
            child: Row(
              children: [
                const Flexible(child: SectionLabel('Pending approval')),
                const SizedBox(width: 8),
                DecoratedBox(
                  decoration: BoxDecoration(color: c.warnBg, borderRadius: BorderRadius.circular(LbRadius.sm)),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    child: Text('${pending.length}', style: LbText.number(context, size: 12, weight: FontWeight.w600, color: c.warn)),
                  ),
                ),
                const Spacer(),
                AnimatedRotation(
                  turns: _open ? 0.5 : 0,
                  duration: LbMotion.duration(context, LbMotion.fast),
                  child: LbIcon(LbIcons.chevronDown, size: 20, color: c.mutedForeground),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    final Widget content = !_open
        ? const SizedBox(width: double.infinity)
        : Padding(
            padding: const EdgeInsets.fromLTRB(LbSpace.screen, 0, LbSpace.screen, LbSpace.gap),
            child: widget.constrained
                ? ConstrainedBox(constraints: BoxConstraints(maxHeight: contentCap), child: SingleChildScrollView(child: cards))
                : cards,
          );
    return DecoratedBox(
      decoration: BoxDecoration(color: c.bar, border: Border(bottom: BorderSide(color: c.border))),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          header,
          AnimatedSize(
            duration: LbMotion.duration(context),
            curve: LbMotion.curve,
            alignment: Alignment.topCenter,
            child: content,
          ),
        ],
      ),
    );
  }
}

/// Compact list of the latest settled orders for the side pane; each opens the
/// order sheet.
class RecentOrders extends ConsumerWidget {
  const RecentOrders({super.key, this.limit = 8});

  final int limit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(harnessProvider.select((s) => s.feed.orders));
    final recent = orders.where((o) => o.status != OrderStatus.pendingApproval).take(limit).toList();
    final c = context.lb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionLabel('Recent orders'),
        const SizedBox(height: 8),
        if (recent.isEmpty)
          Text('No orders yet', style: LbText.muted(context))
        else
          LbCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < recent.length; i++) ...[
                  if (i > 0) Divider(height: 1, color: c.border),
                  _RecentRow(order: recent[i]),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _RecentRow extends StatelessWidget {
  const _RecentRow({required this.order});

  final OrderRecord order;

  @override
  Widget build(BuildContext context) {
    final i = order.intent;
    final c = context.lb;
    return Semantics(
      button: true,
      label: '${i.side.name} ${i.symbol}, ${statusLabel(order.status)}. Open order',
      excludeSemantics: true,
      onTap: () => AppNav.order(context, order.id),
      child: InkWell(
        onTap: () => AppNav.order(context, order.id),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: LbSpace.card, vertical: 8),
            child: Row(
              children: [
                SideBadge(i.side.name),
                const SizedBox(width: 8),
                Text(i.symbol, style: LbText.number(context, size: 14, weight: FontWeight.w600)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    qtyFor(i.symbol, i.quantity),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: LbText.number(context, size: 12.5, weight: FontWeight.w400, color: c.mutedForeground),
                  ),
                ),
                Flexible(child: StatusChip(statusLabel(order.status), tone: orderStatusTone(order.status), showIcon: false)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
