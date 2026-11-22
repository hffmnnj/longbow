import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/orders.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

import 'risk_checks.dart';

/// Tone of the status chip for an order status.
StatusTone orderStatusTone(OrderStatus status) => switch (status) {
      OrderStatus.pendingApproval => StatusTone.warn,
      OrderStatus.filled => StatusTone.gain,
      OrderStatus.rejectedRisk || OrderStatus.rejectedUser || OrderStatus.failed || OrderStatus.expired => StatusTone.loss,
      OrderStatus.submitted || OrderStatus.partiallyFilled || OrderStatus.triggering || OrderStatus.held => StatusTone.live,
      OrderStatus.cancelled => StatusTone.neutral,
    };

/// One order with its plan, risk checks, outcome and, while it waits for a
/// human, Approve and Reject (port of OrderCard.svelte).
class OrderCard extends ConsumerStatefulWidget {
  const OrderCard({super.key, required this.order, this.showChart = true, this.compact = false});

  final OrderRecord order;

  /// A short card for the approvals strip: two lines of thesis, no chart, and
  /// a Details button that opens the full order sheet. Keeps Approve and
  /// Reject on screen without scrolling.
  final bool compact;

  /// Draws the three-month price path with limit and invalidation lines on
  /// orders that are waiting for approval.
  final bool showChart;

  @override
  ConsumerState<OrderCard> createState() => _OrderCardState();
}

enum _Acting { approve, reject }

class _OrderCardState extends ConsumerState<OrderCard> {
  bool _more = false;
  _Acting? _acting;

  Future<void> _approve() async {
    final store = ref.read(harnessProvider.notifier);
    setState(() => _acting = _Acting.approve);
    Haptics.success();
    await store.approve(widget.order.id);
  }

  Future<void> _reject() async {
    final store = ref.read(harnessProvider.notifier);
    final i = widget.order.intent;
    final t = i.longOption;
    final label = t != null && isValidOptionIntent(i)
        ? '${optionSideLabel(t)} ${t.contracts} ${i.symbol}'
        : t != null
            ? 'option order'
            : '${i.side.name} ${i.symbol}';
    final reason = await showLbSheet<String>(
      context,
      (_) => RejectReasonForm(label: label),
      title: 'Reject order',
    );
    if (reason == null || !mounted) return;
    setState(() => _acting = _Acting.reject);
    Haptics.error();
    await store.reject(widget.order.id, reason);
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;
    final i = order.intent;
    final c = context.lb;
    final ev = expectedValuePct(i);
    final pending = order.status == OrderStatus.pendingApproval;
    final isOwner = order.ownerMessageId != null;
    final ownerPending = isOwner && pending;
    final quoteLabel = fractionalQuoteLabel(i);
    final isOption = isOptionIntent(i);
    final ticket = i.longOption;
    final validOption = isValidOptionIntent(i);
    final problem = isOption ? optionProblem(i) : null;
    final approveBlocked = problem != null;
    final busy = ref.watch(harnessProvider.select((s) => s.busy['order:${order.id}'] ?? false));
    final killSwitch = ref.watch(harnessProvider.select((s) => s.feed.status?.settings.killSwitch ?? false));
    final compact = widget.compact;
    final long = !compact && i.thesis.length > 110;
    final semanticsLabel = isOption && ticket != null && validOption
        ? '${optionSideLabel(ticket)} ${ticket.contracts} ${i.symbol} ${usd(optionStrike(ticket))} ${ticket.contractType.name}, ${orderStatusLabel(order)}'
        : isOption
            ? 'Option details need review, ${orderStatusLabel(order)}'
            : '${i.side.name} ${i.symbol}, ${orderStatusLabel(order)}';

    return Semantics(
      container: true,
      label: semanticsLabel,
      child: LbCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Wrap(
                    spacing: 10,
                    runSpacing: 0,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      SideBadge(i.side.name),
                      if (isOption && validOption && ticket != null)
                        StatusChip(optionBadgeLabel(ticket), tone: StatusTone.live, showIcon: false)
                      else if (isOption)
                        StatusChip(ticket != null ? optionBadgeLabel(ticket) : 'Option', tone: StatusTone.warn, showIcon: false),
                      TickerLink(i.symbol, style: LbText.number(context, size: 15, weight: FontWeight.w600)),
                      if (isOwner) const StatusChip('Owner order', tone: StatusTone.live, showIcon: false),
                      if (isOption && ticket != null && validOption)
                        Text(
                          '${ticket.contracts} ${ticket.contracts == 1 ? 'contract' : 'contracts'} · ${usd(optionStrike(ticket))} ${optionTypeLabel(ticket).toLowerCase()} · Exp ${isoShort(ticket.expiration)}',
                          style: LbText.number(context, size: 13, weight: FontWeight.w400, color: c.mutedForeground),
                        )
                      else if (!isOption)
                        Text(
                          quoteLabel == null
                              ? '${qtyFor(i.symbol, i.quantity)} @ ${usd(i.limitPrice)}'
                              : '${qtyFor(i.symbol, i.quantity)} ${qtyUnit(i.symbol)} · $quoteLabel ${usd(i.limitPrice)}',
                          style: LbText.number(context, size: 13, weight: FontWeight.w400, color: c.mutedForeground),
                        ),
                      if (!isOption && i.orderType == OrderType.stopLimit && i.stopPrice != null && i.stopPrice! > 0)
                        Text('stop ${usd(i.stopPrice!)}', style: LbText.number(context, size: 12, weight: FontWeight.w400, color: c.mutedForeground)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Money(notional(i), size: 14, weight: FontWeight.w600),
              ],
            ),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusChip(orderStatusLabel(order), tone: orderStatusTone(order.status)),
                Text(etStamp(order.createdAt), style: LbText.number(context, size: 11.5, weight: FontWeight.w400, color: c.mutedForeground)),
                if (compact)
                  TextButton(
                    onPressed: () => AppNav.order(context, order.id),
                    child: const Text('Details'),
                  ),
              ],
            ),
            if (isOption && ticket != null && validOption) ...[
              const SizedBox(height: 10),
              _OptionTicketBox(order: order),
            ] else if (isOption) ...[
              const SizedBox(height: 10),
              _OptionProblemBox(problem: problem),
            ] else if (ownerPending) ...[
              const SizedBox(height: 10),
              _OwnerOrderDetails(order: order),
            ] else if (pending && quoteLabel != null) ...[
              const SizedBox(height: 8),
              Text(fractionalQuoteDisclosure, style: LbText.muted(context, size: 12.5)),
            ],
            const SizedBox(height: 10),
            Text(
              i.thesis,
              maxLines: _more ? null : 2,
              overflow: _more ? TextOverflow.visible : TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium!.copyWith(fontSize: 13.5, height: 1.45),
            ),
            if (long)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(onPressed: () => setState(() => _more = !_more), child: Text(_more ? 'Show less' : 'Show more')),
              ),
            if (!isOption && pending && widget.showChart && !compact) ...[
              const SizedBox(height: 8),
              OrderMiniChart(symbol: i.symbol, limit: i.limitPrice, invalidation: i.invalidationPrice, limitLabel: quoteLabel ?? 'limit'),
            ],
            const SizedBox(height: 10),
            if (compact)
              _CompactFacts(order: order, ev: ev)
            else if (isOption && ticket != null && validOption)
              Wrap(
                spacing: 20,
                runSpacing: 10,
                children: [
                  Stat(label: 'Contracts', value: '${ticket.contracts}'),
                  Stat(label: optionLimitHeading(ticket), value: usd(optionLimitPerShare(ticket))),
                  Stat(
                    label: 'Total at limit',
                    value: '${usd(optionTotal(ticket))} ${ticket.side == OptionTicketSide.buyToOpen ? 'debit' : 'proceeds'}',
                    sub: 'before fees',
                  ),
                  Stat(label: 'Strike', value: '${usd(optionStrike(ticket))} ${optionTypeLabel(ticket).toLowerCase()}'),
                  Stat(label: 'Expiration', value: optionExpiryLabel(ticket.expiration)),
                  Stat(
                    label: 'Expected value',
                    value: pctSigned(ev),
                    sub: 'win ${(i.probabilityWin * 100).round()}%',
                    tone: ev < 0 ? Tone.loss : Tone.flat,
                  ),
                  Stat(label: 'Underlying invalidation', value: usd(i.invalidationPrice)),
                  Stat(label: 'Time stop', value: i.timeStopDate),
                  if (order.averageFillPrice != null)
                    Stat(
                      label: 'Filled',
                      value:
                          '${qtyFor(i.symbol, order.filledQuantity ?? 0)} of ${qtyFor(i.symbol, i.quantity)} @ ${usd(order.averageFillPrice!)}',
                      sub: usd(optionFilledTotal(order.filledQuantity ?? 0, order.averageFillPrice!)),
                    ),
                ],
              )
            else if (!isOption)
              Wrap(
                spacing: 20,
                runSpacing: 10,
                children: [
                  Stat(label: 'Invalidation', value: usd(i.invalidationPrice)),
                  Stat(label: 'Time stop', value: i.timeStopDate),
                  Stat(
                    label: 'Expected value',
                    value: pctSigned(ev),
                    sub: 'win ${(i.probabilityWin * 100).round()}%',
                    tone: ev < 0 ? Tone.loss : Tone.flat,
                  ),
                  if (order.averageFillPrice != null)
                    Stat(label: 'Filled', value: '${qtyFor(i.symbol, order.filledQuantity ?? 0)} @ ${usd(order.averageFillPrice!)}'),
                ],
              ),
            const SizedBox(height: 6),
            RiskChecks(verdict: order.verdict),
            if (order.review != null && order.review!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(order.review!, style: LbText.muted(context, size: 13).copyWith(height: 1.45)),
            ],
            if (order.error != null && order.error!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(order.error!, style: Theme.of(context).textTheme.bodySmall!.copyWith(color: c.loss, fontSize: 13)),
            ],
            if (pending) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(minimumSize: const Size(0, kMinTarget)),
                      onPressed: busy || killSwitch || approveBlocked ? null : _approve,
                      child: Text(busy && _acting == _Acting.approve ? 'Approving\u2026' : 'Approve'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(minimumSize: const Size(0, kMinTarget)),
                      onPressed: busy ? null : _reject,
                      child: Text(busy && _acting == _Acting.reject ? 'Rejecting\u2026' : 'Reject'),
                    ),
                  ),
                ],
              ),
              if (problem != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('$problem Approval is blocked; rejecting is still available.',
                      style: Theme.of(context).textTheme.bodySmall!.copyWith(color: c.loss)),
                ),
              if (killSwitch)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('Kill switch is engaged. Release it to approve.', style: Theme.of(context).textTheme.bodySmall!.copyWith(color: c.warn)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Exact terms of an owner-requested order awaiting approval: full-precision
/// quantity and limit (the compact formatters round), order type, stop when
/// set, and expiry at today's close. The quoted instruction is context for
/// the decision, not a claim of authorization.
class _OwnerOrderDetails extends StatelessWidget {
  const _OwnerOrderDetails({required this.order});

  final OrderRecord order;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final i = order.intent;
    final side = i.side == OrderSide.buy ? 'Buy' : 'Sell';
    final type = i.orderType == OrderType.stopLimit ? 'Stop limit' : 'Limit';
    final quoteLabel = fractionalQuoteLabel(i);
    final price = quoteLabel == null ? '$type @ ${priceExact(i.limitPrice)}' : '$quoteLabel ${priceExact(i.limitPrice)}';
    final stop = i.orderType == OrderType.stopLimit && i.stopPrice != null && i.stopPrice! > 0
        ? ' · Stop ${priceExact(i.stopPrice!)}'
        : '';
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Color.alphaBlend(c.primary.withValues(alpha: 0.08), c.card),
        border: Border.all(color: c.primary.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(LbRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '$side ${qtyExact(i.quantity)} ${qtyUnit(i.symbol)} of ${i.symbol} · $price$stop · Expires at today\'s close',
              style: LbText.number(context, size: 12.5, weight: FontWeight.w400),
            ),
            if (quoteLabel != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(fractionalQuoteDisclosure, style: LbText.muted(context, size: 12.5)),
              ),
            if (i.ownerInstruction != null && i.ownerInstruction!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'From your message: “${i.ownerInstruction}”',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LbText.muted(context, size: 12.5),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Exact terms of a long option: contract, side, limit per share (per point
/// for cash-settled XSP) and total debit or proceeds at the limit before
/// fees. Always shown for valid options so the ticket never reads as shares.
class _OptionTicketBox extends StatelessWidget {
  const _OptionTicketBox({required this.order});

  final OrderRecord order;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final i = order.intent;
    final t = i.longOption!;
    final side = optionSideLabel(t);
    final contracts = '${t.contracts} ${t.contracts == 1 ? 'contract' : 'contracts'}';
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Color.alphaBlend(c.primary.withValues(alpha: 0.08), c.card),
        border: Border.all(color: c.primary.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(LbRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SectionLabel(optionSectionHeading(t)),
            const SizedBox(height: 4),
            Text(
              '$side $contracts of ${t.symbol} · ${usd(optionStrike(t))} ${t.contractType.name} · Exp ${optionExpiryLabel(t.expiration)}',
              style: LbText.number(context, size: 12.5, weight: FontWeight.w400),
            ),
            const SizedBox(height: 2),
            Text(
              'Limit ${usd(optionLimitPerShare(t))} ${optionPerUnit(t)} · Total ${usd(optionTotal(t))} ${t.side == OptionTicketSide.buyToOpen ? 'debit' : 'proceeds'} before fees · Order expires at today\'s close',
              style: LbText.number(context, size: 12.5, weight: FontWeight.w400),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '${optionSettlementNote(t)} A fill is not guaranteed at the limit.',
                style: LbText.muted(context, size: 12.5),
              ),
            ),
            if (i.ownerInstruction != null && i.ownerInstruction!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'From your message: “${i.ownerInstruction}”',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LbText.muted(context, size: 12.5),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Malformed or mismatched option details: never a share ticket, never an
/// actionable approval.
class _OptionProblemBox extends StatelessWidget {
  const _OptionProblemBox({required this.problem});

  final String? problem;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Color.alphaBlend(c.loss.withValues(alpha: 0.08), c.card),
        border: Border.all(color: c.loss.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(LbRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Option details need review.', style: Theme.of(context).textTheme.bodyMedium!.copyWith(fontSize: 12.5, fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text(
              '${problem ?? 'Contract details are incomplete or malformed.'} Do not approve from this ticket.',
              style: LbText.muted(context, size: 12.5),
            ),
          ],
        ),
      ),
    );
  }
}

/// Sheet body that asks for an optional reason before rejecting an order.
/// Pops the trimmed reason (possibly empty) on confirm, null on cancel.
class RejectReasonForm extends StatefulWidget {
  const RejectReasonForm({super.key, required this.label});

  final String label;

  @override
  State<RejectReasonForm> createState() => _RejectReasonFormState();
}

class _RejectReasonFormState extends State<RejectReasonForm> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('The agent sees your reason on its next cycle. You can leave it empty.', style: LbText.muted(context)),
        const SizedBox(height: LbSpace.gap),
        LbTextField(
          controller: _reason,
          label: 'Reason (optional)',
          hint: 'Why reject ${widget.label}?',
          autofocus: true,
          maxLines: 3,
          minLines: 1,
          textInputAction: TextInputAction.done,
          inputFormatters: [LengthLimitingTextInputFormatter(500)],
          onSubmitted: (_) => Navigator.of(context).pop(_reason.text.trim()),
        ),
        const SizedBox(height: LbSpace.gap),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, kMinTarget)),
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: FilledButton(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, kMinTarget),
                  backgroundColor: context.lb.destructive,
                  foregroundColor: context.lb.primaryForeground,
                ),
                onPressed: () => Navigator.of(context).pop(_reason.text.trim()),
                child: const Text('Confirm reject'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Three-month close path with the limit and invalidation lines, loaded on
/// demand through the harness store (the web MiniChart).
class OrderMiniChart extends ConsumerStatefulWidget {
  const OrderMiniChart({super.key, required this.symbol, required this.limit, required this.invalidation, this.limitLabel = 'limit'});

  final String symbol;
  final double limit;
  final double invalidation;
  final String limitLabel;

  @override
  ConsumerState<OrderMiniChart> createState() => _OrderMiniChartState();
}

class _OrderMiniChartState extends ConsumerState<OrderMiniChart> {
  static const _range = HistoryRange.threeMonths;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (mounted) ref.read(harnessProvider.notifier).loadHistory(widget.symbol, _range);
    });
  }

  @override
  Widget build(BuildContext context) {
    final key = '${widget.symbol}:${historyRangeWire(_range)}';
    final loadable = ref.watch(harnessProvider.select((s) => s.history[key]));
    final bars = loadable?.data?.bars;
    if (loadable?.state == LoadState.error || (bars != null && bars.length < 2)) return const SizedBox.shrink();
    if (bars == null) return const SkeletonBlock(height: 96, radius: LbRadius.md);
    return RepaintBoundary(
      child: DitherAreaChart(
        values: [for (final b in bars) b.close],
        labels: [for (final b in bars) b.date],
        height: 96,
        tone: ChartTone.primary,
        showAxes: false,
        enableHaptics: false,
        valueFormatter: usd,
        name: widget.symbol,
        referenceLines: [
          ChartReferenceLine(value: widget.limit, label: widget.limitLabel, tone: ChartTone.primary),
          ChartReferenceLine(value: widget.invalidation, label: 'invalidation', tone: ChartTone.loss),
        ],
        semanticsLabel: '${widget.symbol} three month price with ${widget.limitLabel.toLowerCase()} ${usd(widget.limit)} and invalidation ${usd(widget.invalidation)}',
      ),
    );
  }
}

/// Two dense lines of plan facts for the compact card.
class _CompactFacts extends StatelessWidget {
  const _CompactFacts({required this.order, required this.ev});

  final OrderRecord order;
  final double ev;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final i = order.intent;
    final t = i.longOption;
    final label = LbText.muted(context, size: 12.5);
    TextSpan pair(String name, String value, {Color? color}) => TextSpan(children: [
          TextSpan(text: '$name ', style: label),
          TextSpan(text: value, style: LbText.number(context, size: 12.5, color: color)),
        ]);
    if (t != null && isValidOptionIntent(i)) {
      return Text.rich(
        TextSpan(children: [
          pair('Contracts', '${t.contracts}'),
          const TextSpan(text: '   '),
          pair('Total', '${usd(optionTotal(t))} ${t.side == OptionTicketSide.buyToOpen ? 'debit' : 'proceeds'}'),
          const TextSpan(text: '\n'),
          pair('Limit', '${usd(optionLimitPerShare(t))}${optionCompactUnit(t)}'),
          const TextSpan(text: '   '),
          pair('Exp', isoShort(t.expiration)),
          if (order.averageFillPrice != null) ...[
            const TextSpan(text: '   '),
            pair('Filled',
                '${qtyFor(i.symbol, order.filledQuantity ?? 0)} @ ${usd(order.averageFillPrice!)}${optionCompactUnit(t)}'),
          ],
        ]),
      );
    }
    if (t != null) {
      return Text('Option details need review.', style: LbText.muted(context, size: 12.5));
    }
    return Text.rich(
      TextSpan(children: [
        pair('Invalidation', usd(i.invalidationPrice)),
        const TextSpan(text: '   '),
        pair('Time stop', i.timeStopDate),
        const TextSpan(text: '\n'),
        pair('Expected value', pctSigned(ev), color: ev < 0 ? c.loss : null),
        const TextSpan(text: '   '),
        pair('Win', '${(i.probabilityWin * 100).round()}%'),
        if (order.averageFillPrice != null) ...[
          const TextSpan(text: '   '),
          pair('Filled', '${qtyFor(i.symbol, order.filledQuantity ?? 0)} @ ${usd(order.averageFillPrice!)}'),
        ],
      ]),
    );
  }
}
