// Dart port of `apps/web/src/lib/settingsForm.ts`. Pure Dart: no Flutter
// imports.
//
// The web app validates through zod schemas (`RiskConfigSchema` and
// `SettingsSchema.shape` in `packages/shared`). The limits below mirror those
// schemas by hand; `fieldError` reproduces the same messages.
import 'package:longbow/models/models.dart';

/// Every risk field shown in the form. `minOrderNotionalUsd`,
/// `earningsBlackoutDays` and `minAvgDollarVolumeUsd` exist on the server but
/// are not form fields, exactly like TS `RISK_KEYS`.
enum RiskKey {
  maxRiskPerTradePct,
  maxPositionPct,
  maxSectorPct,
  maxPositions,
  maxOrderNotionalUsd,
  dailyLossHaltPct,
  monthlyDrawdownHaltPct,
  maxEntriesPerDay,
  maxDayTrades5d,
  minHoldDays,
  noTradeOpenMinutes,
  noTradeCloseMinutes,
  maxSpreadBps,
  maxSlippageBps,
  minEvToCost,
}

class FieldMeta {
  const FieldMeta({
    required this.key,
    required this.label,
    required this.unit,
    required this.step,
  });

  final RiskKey key;
  final String label;
  final String unit;
  final String step;
}

class RiskGroup {
  const RiskGroup({required this.title, required this.fields});

  final String title;
  final List<FieldMeta> fields;
}

const List<RiskGroup> riskGroups = [
  RiskGroup(
    title: 'Sizing',
    fields: [
      FieldMeta(
        key: RiskKey.maxRiskPerTradePct,
        label: 'Risk per trade',
        unit: '% equity',
        step: '0.1',
      ),
      FieldMeta(
        key: RiskKey.maxPositionPct,
        label: 'Max position',
        unit: '% equity',
        step: '0.5',
      ),
      FieldMeta(
        key: RiskKey.maxSectorPct,
        label: 'Max sector',
        unit: '% equity',
        step: '1',
      ),
      FieldMeta(
        key: RiskKey.maxPositions,
        label: 'Max positions',
        unit: 'count',
        step: '1',
      ),
      FieldMeta(
        key: RiskKey.maxOrderNotionalUsd,
        label: 'Max order size',
        unit: 'USD',
        step: '100',
      ),
    ],
  ),
  RiskGroup(
    title: 'Loss limits',
    fields: [
      FieldMeta(
        key: RiskKey.dailyLossHaltPct,
        label: 'Daily loss halt',
        unit: '% equity',
        step: '0.1',
      ),
      FieldMeta(
        key: RiskKey.monthlyDrawdownHaltPct,
        label: 'Monthly drawdown halt',
        unit: '% from peak',
        step: '0.5',
      ),
      FieldMeta(
        key: RiskKey.maxEntriesPerDay,
        label: 'Entries per day',
        unit: 'count',
        step: '1',
      ),
      FieldMeta(
        key: RiskKey.maxDayTrades5d,
        label: 'Day trades, 5 days',
        unit: 'count',
        step: '1',
      ),
    ],
  ),
  RiskGroup(
    title: 'Timing',
    fields: [
      FieldMeta(
        key: RiskKey.minHoldDays,
        label: 'Min hold',
        unit: 'days',
        step: '1',
      ),
      FieldMeta(
        key: RiskKey.noTradeOpenMinutes,
        label: 'Quiet after open',
        unit: 'min',
        step: '5',
      ),
      FieldMeta(
        key: RiskKey.noTradeCloseMinutes,
        label: 'Quiet before close',
        unit: 'min',
        step: '5',
      ),
    ],
  ),
  RiskGroup(
    title: 'Execution',
    fields: [
      FieldMeta(
        key: RiskKey.maxSpreadBps,
        label: 'Max spread',
        unit: 'bps',
        step: '1',
      ),
      FieldMeta(
        key: RiskKey.maxSlippageBps,
        label: 'Max slippage',
        unit: 'bps',
        step: '1',
      ),
      FieldMeta(
        key: RiskKey.minEvToCost,
        label: 'Min EV to cost',
        unit: 'x',
        step: '0.1',
      ),
    ],
  ),
];

/// All form risk keys, in group order. Mirrors TS `RISK_KEYS`.
final List<RiskKey> riskKeys =
    riskGroups.expand((g) => g.fields.map((f) => f.key)).toList();

/// Every crypto field shown in the form. Mirrors the form subset of TS
/// `CryptoSettings` (the allowlist and the entry budget stay server-side).
enum CryptoKey { maxPortfolioPct, maxOrderNotionalUsd }

class CryptoFieldMeta {
  const CryptoFieldMeta({
    required this.key,
    required this.label,
    required this.unit,
    required this.step,
  });

  final CryptoKey key;
  final String label;
  final String unit;
  final String step;
}

/// One compact group: the sleeve's share of equity and its per-order cap.
const List<CryptoFieldMeta> cryptoFields = [
  CryptoFieldMeta(
    key: CryptoKey.maxPortfolioPct,
    label: 'Max crypto share',
    unit: '% equity',
    step: '1',
  ),
  CryptoFieldMeta(
    key: CryptoKey.maxOrderNotionalUsd,
    label: 'Max crypto order',
    unit: 'USD',
    step: '10',
  ),
];

/// All form crypto keys, in display order.
const List<CryptoKey> cryptoKeys = CryptoKey.values;

/// Mirrors `CryptoSettingsSchema` for the form fields: the sleeve holds 1 to
/// 25% of equity, and one order must be worth something (above 0).
const Map<CryptoKey, FieldLimit> cryptoFieldLimits = {
  CryptoKey.maxPortfolioPct: FieldLimit(min: 1, max: 25),
  CryptoKey.maxOrderNotionalUsd: FieldLimit(min: 0, minInclusive: false),
};

/// Numeric limits for one text field, mirroring the matching zod schema.
class FieldLimit {
  const FieldLimit({
    this.min,
    this.minInclusive = true,
    this.max,
    this.integer = false,
  });

  final double? min;
  final bool minInclusive;
  final double? max;
  final bool integer;
}

/// Mirrors `RiskConfigSchema` for the form fields (positive/max/int as in
/// `packages/shared`). Fields the form does not show have no entry.
const Map<RiskKey, FieldLimit> riskFieldLimits = {
  RiskKey.maxRiskPerTradePct: FieldLimit(min: 0, minInclusive: false, max: 5),
  RiskKey.maxPositionPct: FieldLimit(min: 0, minInclusive: false, max: 100),
  RiskKey.maxSectorPct: FieldLimit(min: 0, minInclusive: false, max: 100),
  RiskKey.maxPositions: FieldLimit(
    min: 0,
    minInclusive: false,
    max: 50,
    integer: true,
  ),
  RiskKey.maxOrderNotionalUsd: FieldLimit(min: 0, minInclusive: false),
  RiskKey.dailyLossHaltPct: FieldLimit(min: 0, minInclusive: false, max: 50),
  RiskKey.monthlyDrawdownHaltPct: FieldLimit(
    min: 0,
    minInclusive: false,
    max: 80,
  ),
  RiskKey.maxEntriesPerDay: FieldLimit(min: 0, max: 50, integer: true),
  RiskKey.maxDayTrades5d: FieldLimit(min: 0, max: 10, integer: true),
  RiskKey.minHoldDays: FieldLimit(min: 0, max: 30, integer: true),
  RiskKey.noTradeOpenMinutes: FieldLimit(min: 0, max: 120, integer: true),
  RiskKey.noTradeCloseMinutes: FieldLimit(min: 0, max: 120, integer: true),
  RiskKey.maxSpreadBps: FieldLimit(min: 0, minInclusive: false, max: 1000),
  RiskKey.maxSlippageBps: FieldLimit(min: 0, max: 500),
  RiskKey.minEvToCost: FieldLimit(min: 0, max: 20),
};

/// Mirrors `SettingsSchema.shape.cycleMinutesOpen` (int, 5..240).
const FieldLimit cycleMinutesOpenLimit = FieldLimit(
  min: 5,
  max: 240,
  integer: true,
);

/// Mirrors `SettingsSchema.shape.cycleMinutesClosed` (int, 30..1440).
const FieldLimit cycleMinutesClosedLimit = FieldLimit(
  min: 30,
  max: 1440,
  integer: true,
);

String _fmtBound(double v) =>
    v == v.truncateToDouble() ? v.truncate().toString() : '$v';

/// Turns a text input into a short inline error, or null when valid.
/// Messages match the TS `fieldError` exactly: "Required", "Enter a number",
/// "Whole number", "Must be above `min`", "Min `min`", "Max `max`".
String? fieldError(FieldLimit limit, String raw) {
  if (raw.trim().isEmpty) return 'Required';
  final n = double.tryParse(raw.trim());
  if (n == null || !n.isFinite) return 'Enter a number';
  if (limit.integer && n != n.truncateToDouble()) return 'Whole number';
  final min = limit.min;
  if (min != null && (n < min || (!limit.minInclusive && n == min))) {
    return limit.minInclusive ? 'Min ${_fmtBound(min)}' : 'Must be above ${_fmtBound(min)}';
  }
  final max = limit.max;
  if (max != null && n > max) return 'Max ${_fmtBound(max)}';
  return null;
}

/// Inline error for one risk field, or null when valid.
String? riskFieldError(RiskKey key, String raw) =>
    fieldError(riskFieldLimits[key]!, raw);

/// Inline error for one crypto field, or null when valid.
String? cryptoFieldError(CryptoKey key, String raw) =>
    fieldError(cryptoFieldLimits[key]!, raw);

/// The editable settings form: every number held as text.
class SettingsForm {
  SettingsForm({
    required this.cycleMinutesOpen,
    required this.cycleMinutesClosed,
    required this.watchlist,
    required this.risk,
    required this.cryptoEnabled,
    required this.crypto,
  });

  String cycleMinutesOpen;
  String cycleMinutesClosed;
  List<String> watchlist;
  Map<RiskKey, String> risk;
  bool cryptoEnabled;
  Map<CryptoKey, String> crypto;
}

String _numToString(num v) {
  if (v is int) return '$v';
  final d = v.toDouble();
  return d == d.truncateToDouble() ? d.truncate().toString() : '$d';
}

num _riskValue(RiskConfig risk, RiskKey key) => switch (key) {
  RiskKey.maxRiskPerTradePct => risk.maxRiskPerTradePct,
  RiskKey.maxPositionPct => risk.maxPositionPct,
  RiskKey.maxSectorPct => risk.maxSectorPct,
  RiskKey.maxPositions => risk.maxPositions,
  RiskKey.maxOrderNotionalUsd => risk.maxOrderNotionalUsd,
  RiskKey.dailyLossHaltPct => risk.dailyLossHaltPct,
  RiskKey.monthlyDrawdownHaltPct => risk.monthlyDrawdownHaltPct,
  RiskKey.maxEntriesPerDay => risk.maxEntriesPerDay,
  RiskKey.maxDayTrades5d => risk.maxDayTrades5d,
  RiskKey.minHoldDays => risk.minHoldDays,
  RiskKey.noTradeOpenMinutes => risk.noTradeOpenMinutes,
  RiskKey.noTradeCloseMinutes => risk.noTradeCloseMinutes,
  RiskKey.maxSpreadBps => risk.maxSpreadBps,
  RiskKey.maxSlippageBps => risk.maxSlippageBps,
  RiskKey.minEvToCost => risk.minEvToCost,
};

num _cryptoValue(CryptoSettings crypto, CryptoKey key) => switch (key) {
  CryptoKey.maxPortfolioPct => crypto.maxPortfolioPct,
  CryptoKey.maxOrderNotionalUsd => crypto.maxOrderNotionalUsd,
};

SettingsForm toForm(Settings s) {
  return SettingsForm(
    cycleMinutesOpen: _numToString(s.cycleMinutesOpen),
    cycleMinutesClosed: _numToString(s.cycleMinutesClosed),
    watchlist: [...s.watchlist],
    risk: {for (final k in riskKeys) k: _numToString(_riskValue(s.risk, k))},
    cryptoEnabled: s.crypto.enabled,
    crypto: {for (final k in cryptoKeys) k: _numToString(_cryptoValue(s.crypto, k))},
  );
}

/// Errors keyed by "cycleMinutesOpen", "cycleMinutesClosed", "watchlist",
/// `risk.<key>` or `crypto.<key>`.
Map<String, String> validateSettingsForm(SettingsForm form) {
  final errors = <String, String>{};
  final open = fieldError(cycleMinutesOpenLimit, form.cycleMinutesOpen);
  if (open != null) errors['cycleMinutesOpen'] = open;
  final closed = fieldError(cycleMinutesClosedLimit, form.cycleMinutesClosed);
  if (closed != null) errors['cycleMinutesClosed'] = closed;
  for (final k in riskKeys) {
    final e = riskFieldError(k, form.risk[k] ?? '');
    if (e != null) errors['risk.${k.name}'] = e;
  }
  for (final k in cryptoKeys) {
    final e = cryptoFieldError(k, form.crypto[k] ?? '');
    if (e != null) errors['crypto.${k.name}'] = e;
  }
  if (form.watchlist.length > 50) errors['watchlist'] = 'At most 50 tickers';
  return errors;
}

int? _parseIntField(String raw) {
  final t = raw.trim();
  return int.tryParse(t) ?? double.tryParse(t)?.truncate();
}

double? _parseDoubleField(String raw) => double.tryParse(raw.trim());

/// Only the fields that differ from the saved settings. Unparseable inputs
/// are skipped; callers validate first.
SettingsPatch buildPatch(Settings saved, SettingsForm form) {
  final open = _parseIntField(form.cycleMinutesOpen);
  final closed = _parseIntField(form.cycleMinutesClosed);
  List<String>? watchlist;
  if (form.watchlist.length != saved.watchlist.length ||
      form.watchlist.asMap().entries.any((e) => e.value != saved.watchlist[e.key])) {
    watchlist = [...form.watchlist];
  }

  double? maxRiskPerTradePct;
  double? maxPositionPct;
  double? maxSectorPct;
  int? maxPositions;
  double? maxOrderNotionalUsd;
  double? dailyLossHaltPct;
  double? monthlyDrawdownHaltPct;
  int? maxEntriesPerDay;
  int? maxDayTrades5d;
  int? minHoldDays;
  int? noTradeOpenMinutes;
  int? noTradeCloseMinutes;
  double? maxSpreadBps;
  double? maxSlippageBps;
  double? minEvToCost;
  var hasRisk = false;

  void setDouble(RiskKey key, double? parsed, double current) {
    if (parsed == null || parsed == current) return;
    hasRisk = true;
    switch (key) {
      case RiskKey.maxRiskPerTradePct:
        maxRiskPerTradePct = parsed;
      case RiskKey.maxPositionPct:
        maxPositionPct = parsed;
      case RiskKey.maxSectorPct:
        maxSectorPct = parsed;
      case RiskKey.maxOrderNotionalUsd:
        maxOrderNotionalUsd = parsed;
      case RiskKey.dailyLossHaltPct:
        dailyLossHaltPct = parsed;
      case RiskKey.monthlyDrawdownHaltPct:
        monthlyDrawdownHaltPct = parsed;
      case RiskKey.maxSpreadBps:
        maxSpreadBps = parsed;
      case RiskKey.maxSlippageBps:
        maxSlippageBps = parsed;
      case RiskKey.minEvToCost:
        minEvToCost = parsed;
      default:
        break;
    }
  }

  void setInt(RiskKey key, int? parsed, int current) {
    if (parsed == null || parsed == current) return;
    hasRisk = true;
    switch (key) {
      case RiskKey.maxPositions:
        maxPositions = parsed;
      case RiskKey.maxEntriesPerDay:
        maxEntriesPerDay = parsed;
      case RiskKey.maxDayTrades5d:
        maxDayTrades5d = parsed;
      case RiskKey.minHoldDays:
        minHoldDays = parsed;
      case RiskKey.noTradeOpenMinutes:
        noTradeOpenMinutes = parsed;
      case RiskKey.noTradeCloseMinutes:
        noTradeCloseMinutes = parsed;
      default:
        break;
    }
  }

  const doubleKeys = {
    RiskKey.maxRiskPerTradePct,
    RiskKey.maxPositionPct,
    RiskKey.maxSectorPct,
    RiskKey.maxOrderNotionalUsd,
    RiskKey.dailyLossHaltPct,
    RiskKey.monthlyDrawdownHaltPct,
    RiskKey.maxSpreadBps,
    RiskKey.maxSlippageBps,
    RiskKey.minEvToCost,
  };
  for (final k in riskKeys) {
    final raw = form.risk[k] ?? '';
    if (doubleKeys.contains(k)) {
      setDouble(k, _parseDoubleField(raw), _riskValue(saved.risk, k).toDouble());
    } else {
      setInt(k, _parseIntField(raw), _riskValue(saved.risk, k).toInt());
    }
  }

  final cryptoEnabled =
      form.cryptoEnabled != saved.crypto.enabled ? form.cryptoEnabled : null;
  double? cryptoMaxPortfolioPct;
  double? cryptoMaxOrderNotionalUsd;
  var hasCrypto = cryptoEnabled != null;
  for (final k in cryptoKeys) {
    final parsed = _parseDoubleField(form.crypto[k] ?? '');
    final current = _cryptoValue(saved.crypto, k).toDouble();
    if (parsed == null || parsed == current) continue;
    hasCrypto = true;
    switch (k) {
      case CryptoKey.maxPortfolioPct:
        cryptoMaxPortfolioPct = parsed;
      case CryptoKey.maxOrderNotionalUsd:
        cryptoMaxOrderNotionalUsd = parsed;
    }
  }

  return SettingsPatch(
    cycleMinutesOpen: open != null && open != saved.cycleMinutesOpen
        ? open
        : null,
    cycleMinutesClosed: closed != null && closed != saved.cycleMinutesClosed
        ? closed
        : null,
    watchlist: watchlist,
    risk: hasRisk
        ? RiskConfigPatch(
            maxRiskPerTradePct: maxRiskPerTradePct,
            maxPositionPct: maxPositionPct,
            maxSectorPct: maxSectorPct,
            maxPositions: maxPositions,
            maxOrderNotionalUsd: maxOrderNotionalUsd,
            dailyLossHaltPct: dailyLossHaltPct,
            monthlyDrawdownHaltPct: monthlyDrawdownHaltPct,
            maxEntriesPerDay: maxEntriesPerDay,
            maxDayTrades5d: maxDayTrades5d,
            minHoldDays: minHoldDays,
            noTradeOpenMinutes: noTradeOpenMinutes,
            noTradeCloseMinutes: noTradeCloseMinutes,
            maxSpreadBps: maxSpreadBps,
            maxSlippageBps: maxSlippageBps,
            minEvToCost: minEvToCost,
          )
        : null,
    crypto: hasCrypto
        ? CryptoSettingsPatch(
            enabled: cryptoEnabled,
            maxPortfolioPct: cryptoMaxPortfolioPct,
            maxOrderNotionalUsd: cryptoMaxOrderNotionalUsd,
          )
        : null,
  );
}

bool isEmptyPatch(SettingsPatch p) => p.toJson().isEmpty;

final RegExp tickerPattern = RegExp(r'^[A-Z.]{1,10}$');

/// Parses typed ticker text ("nvda, aapl") into valid new tickers plus
/// rejected tokens. Comparison against [existing] is exact (already-uppercase).
({List<String> added, List<String> rejected}) parseTickers(
  String input,
  List<String> existing,
) {
  final added = <String>[];
  final rejected = <String>[];
  for (final raw in input.split(RegExp(r'[\s,]+'))) {
    final t = raw.trim().toUpperCase();
    if (t.isEmpty) continue;
    if (!tickerPattern.hasMatch(t)) {
      rejected.add(raw);
    } else if (!existing.contains(t) && !added.contains(t)) {
      added.add(t);
    }
  }
  return (added: added, rejected: rejected);
}
