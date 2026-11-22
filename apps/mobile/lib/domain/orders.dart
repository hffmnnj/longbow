// Dart port of `apps/web/src/lib/orders.ts`. Pure Dart: no Flutter imports.
import 'package:longbow/core/format.dart';
import 'package:longbow/models/models.dart';

final _optionSymbolPattern = RegExp(r'^[A-Z][A-Z0-9.]{0,9}$');
final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _datePattern = RegExp(r'^\d{4}-\d\d-\d\d$');

bool _isRealDate(String iso) {
  if (!_datePattern.hasMatch(iso)) return false;
  final parts = iso.split('-');
  final y = int.tryParse(parts[0]);
  final m = int.tryParse(parts[1]);
  final d = int.tryParse(parts[2]);
  if (y == null || m == null || d == null) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  final dt = DateTime.utc(y, m, d);
  return dt.year == y && dt.month == m && dt.day == d;
}

bool _isWhole(num? n) => n is int;

/// Any presence of longOption routes to the option ticket UI, never the stock ticket.
bool isOptionIntent(OrderIntent i) => i.longOption != null;

/// Shape check for the shared LongOptionTicket: standard 100-share long contracts only.
bool isValidLongOptionTicket(LongOptionTicket? t) {
  if (t == null) return false;
  return _uuidPattern.hasMatch(t.instrumentId) &&
      _optionSymbolPattern.hasMatch(t.symbol) &&
      _isRealDate(t.expiration) &&
      _isWhole(t.strikeCents) &&
      t.strikeCents >= 1 &&
      t.strikeCents <= 10000000 &&
      _isWhole(t.contracts) &&
      t.contracts >= 1 &&
      t.contracts <= 100 &&
      _isWhole(t.limitCents) &&
      t.limitCents >= 1 &&
      t.limitCents <= 1000000;
}

/// Why an option intent cannot be approved as written. Null when the ticket
/// and the order agree; a short human reason when they do not. Any non-null
/// value must block approval and never fall back to a stock ticket.
String? optionProblem(OrderIntent i) {
  final t = i.longOption;
  if (t == null) return null;
  if (!isValidLongOptionTicket(t)) {
    return 'Contract details are incomplete or malformed.';
  }
  if (t.symbol != i.symbol) return 'Contract symbol does not match the order.';
  final expectedSide =
      t.side == OptionTicketSide.buyToOpen ? OrderSide.buy : OrderSide.sell;
  if (i.side != expectedSide) {
    return 'Order side does not match buy to open or sell to close.';
  }
  if (i.quantity != t.contracts.toDouble()) {
    return 'Contracts must equal the order quantity in whole contracts.';
  }
  if ((i.limitPrice * 100).round() != t.limitCents) {
    return 'Per-share limit must match the contract limit.';
  }
  if (i.orderType != OrderType.limit ||
      i.timeInForce != TimeInForce.day ||
      i.stopPrice != null) {
    return 'Options use a whole-contract day limit with no stop.';
  }
  return null;
}

/// True only when the ticket is well formed and agrees with the order.
bool isValidOptionIntent(OrderIntent i) =>
    i.longOption != null && optionProblem(i) == null;

/// "Buy to open" or "Sell to close".
String optionSideLabel(LongOptionTicket t) =>
    t.side == OptionTicketSide.buyToOpen ? 'Buy to open' : 'Sell to close';

/// "Call" or "Put".
String optionTypeLabel(LongOptionTicket t) =>
    t.contractType == OptionContractType.call ? 'Call' : 'Put';

/// XSP Mini-SPX index options are cash settled: no stock changes hands at
/// exercise. Display discriminator is the validated ticket symbol only; no
/// new wire field.
bool isCashSettledOption(LongOptionTicket t) => t.symbol == 'XSP';

/// Badge for the option ticket: XSP never touches shares.
String optionBadgeLabel(LongOptionTicket t) =>
    isCashSettledOption(t) ? 'Cash-settled option' : 'Option';

/// Section heading for the option ticket box.
String optionSectionHeading(LongOptionTicket t) => isCashSettledOption(t)
    ? 'Long option · cash settled'
    : 'Long option · 100-share';

/// Long-form quote-unit noun: XSP is quoted in index points, equities per share.
String optionPerUnit(LongOptionTicket t) =>
    isCashSettledOption(t) ? 'per point' : 'per share';

/// Compact quote-unit suffix for dense rows: "/pt" for XSP, "/sh" otherwise.
String optionCompactUnit(LongOptionTicket t) =>
    isCashSettledOption(t) ? '/pt' : '/sh';

/// "Limit / pt" for XSP, "Limit / share" for equity options.
String optionLimitHeading(LongOptionTicket t) =>
    isCashSettledOption(t) ? 'Limit / pt' : 'Limit / share';

/// Settlement sentence for a valid option ticket. Cash-settled XSP never
/// delivers shares; every other symbol keeps the underlying-stock warning.
/// Pair with the no-fill-guarantee sentence wherever it already appears.
String optionSettlementNote(LongOptionTicket t) => isCashSettledOption(t)
    ? 'Cash settled; no shares are delivered.'
    : 'If exercised, this can create ${t.symbol} stock.';

/// Per-share limit in dollars: limitCents is cents per share.
double optionLimitPerShare(LongOptionTicket t) => t.limitCents / 100;

/// Strike in dollars: strikeCents is cents per share.
double optionStrike(LongOptionTicket t) => t.strikeCents / 100;

/// Total debit (buy to open) or proceeds (sell to close) at the limit, before
/// fees, in dollars. One contract is 100 shares, so the per-share cents times
/// 100 shares is limitCents dollars per contract: 2 contracts at $1.75 is
/// $350, never $3.50.
double optionTotal(LongOptionTicket t) => (t.contracts * t.limitCents).toDouble();

/// Filled total for option contracts: whole contracts times 100 shares at the
/// per-share fill price.
double optionFilledTotal(num contracts, num perSharePrice) =>
    contracts.toDouble() * perSharePrice.toDouble() * 100;

/// Status text that never calls an option submission a held stop.
String orderStatusLabel(OrderRecord o) {
  if (isOptionIntent(o.intent)) {
    if (o.status == OrderStatus.triggering) return 'Submission uncertain';
    if (o.status == OrderStatus.held) return 'Held';
  }
  return statusLabel(o.status);
}

/// Total at risk at the limit: full option premium for valid tickets, share notional otherwise.
double notional(OrderIntent i) {
  final t = i.longOption;
  if (t != null && isValidOptionIntent(i)) return optionTotal(t);
  return i.quantity * i.limitPrice;
}

/// A fractional equity limit price is only a pre-placement quote check.
/// Options never use a quote ceiling.
String? fractionalQuoteLabel(OrderIntent i) {
  if (isOptionIntent(i)) return null;
  if (i.orderType != OrderType.limit || isCryptoSymbol(i.symbol) ||
      i.quantity.truncateToDouble() == i.quantity) {
    return null;
  }
  return i.side == OrderSide.buy ? 'Buy quote ceiling' : 'Sell quote floor';
}

const fractionalQuoteDisclosure =
    'If the quote passes, this is sent as a market order. The fill price can differ.';

/// Expected value in % of notional after estimated round-trip costs.
double expectedValuePct(OrderIntent i) {
  return i.probabilityWin * i.expectedGainPct -
      (1 - i.probabilityWin) * i.expectedLossPct -
      i.estimatedCostPct;
}

/// The risk checks that failed on an order record.
List<RiskCheck> failedChecks(OrderRecord o) =>
    o.verdict.checks.where((c) => !c.ok).toList();

/// Display label for every order status.
String statusLabel(OrderStatus status) => statusLabels[status]!;

/// Mirrors TS `STATUS_LABEL`: display label for every order status.
const Map<OrderStatus, String> statusLabels = {
  OrderStatus.pendingApproval: 'Awaiting approval',
  OrderStatus.rejectedRisk: 'Blocked by risk',
  OrderStatus.rejectedUser: 'Rejected',
  OrderStatus.expired: 'Expired',
  OrderStatus.submitted: 'Submitted',
  OrderStatus.held: 'Stop held',
  OrderStatus.triggering: 'Stop firing',
  OrderStatus.partiallyFilled: 'Partly filled',
  OrderStatus.filled: 'Filled',
  OrderStatus.cancelled: 'Cancelled',
  OrderStatus.failed: 'Failed',
};

/// Orders still working or waiting on something (a human, the broker, the
/// harness stop watcher).
const Set<OrderStatus> openOrderStatuses = {
  OrderStatus.pendingApproval,
  OrderStatus.submitted,
  OrderStatus.held,
  OrderStatus.triggering,
  OrderStatus.partiallyFilled,
};

/// Terminal states: the order will not move again without a brand-new order.
const Set<OrderStatus> doneOrderStatuses = {
  OrderStatus.rejectedRisk,
  OrderStatus.rejectedUser,
  OrderStatus.expired,
  OrderStatus.filled,
  OrderStatus.cancelled,
  OrderStatus.failed,
};

/// True while the order is still working or waiting.
bool isOpenOrderStatus(OrderStatus status) => openOrderStatuses.contains(status);

/// True once the order reached a terminal state.
bool isDoneOrderStatus(OrderStatus status) => doneOrderStatuses.contains(status);

/// "max_position" becomes "Max position".
String ruleName(String rule) {
  final s = rule.replaceAll('_', ' ');
  return s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

/// "2026-12-18" -> "Fri, Dec 18 2026" for option expirations. Falls back to
/// the input when it is not a real date.
String optionExpiryLabel(String expiration) {
  if (!_isRealDate(expiration)) return expiration;
  final year = expiration.substring(0, 4);
  return '${isoDay(expiration)} $year';
}
