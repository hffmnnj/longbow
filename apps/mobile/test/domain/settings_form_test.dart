import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/domain/settings_form.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('settingsForm_untouchedFormProducesEmptyPatch', () {
    expect(buildPatch(defaultSettings, toForm(defaultSettings)).toJson(), isEmpty);
    expect(isEmptyPatch(buildPatch(defaultSettings, toForm(defaultSettings))), isTrue);
  });

  test('settingsForm_patchCarriesOnlyChangedFields', () {
    final f = toForm(defaultSettings);
    f.risk[RiskKey.maxPositions] = '8';
    f.cycleMinutesOpen = '15';
    f.watchlist.add('NVDA');

    final patch = buildPatch(defaultSettings, f);

    expect(patch.cycleMinutesOpen, 15);
    expect(patch.cycleMinutesClosed, isNull);
    expect(patch.watchlist, [...defaultSettings.watchlist, 'NVDA']);
    expect(patch.risk?.maxPositions, 8);
    expect(patch.risk?.toJson().keys, ['maxPositions']);
    expect(isEmptyPatch(patch), isFalse);
  });

  test('settingsForm_validateReportsRangeIntegerAndRequiredInline', () {
    final f = toForm(defaultSettings);
    f.risk[RiskKey.maxRiskPerTradePct] = '9';
    f.risk[RiskKey.maxPositions] = '2.5';
    f.risk[RiskKey.maxSpreadBps] = '';
    f.cycleMinutesOpen = '1';

    final e = validateSettingsForm(f);

    expect(e['risk.maxRiskPerTradePct'], 'Max 5');
    expect(e['risk.maxPositions'], 'Whole number');
    expect(e['risk.maxSpreadBps'], 'Required');
    expect(e['cycleMinutesOpen'], 'Min 5');
    expect(validateSettingsForm(toForm(defaultSettings)), isEmpty);
  });

  test('settingsForm_cryptoRoundTripsThroughTheForm', () {
    final f = toForm(defaultSettings);

    expect(f.cryptoEnabled, isFalse);
    expect(f.crypto[CryptoKey.maxPortfolioPct], '8');
    expect(f.crypto[CryptoKey.maxOrderNotionalUsd], '40');
    expect(validateSettingsForm(f), isEmpty);
  });

  test('settingsForm_cryptoPatchCarriesOnlyChangedFields', () {
    final f = toForm(defaultSettings);
    f.cryptoEnabled = true;
    f.crypto[CryptoKey.maxPortfolioPct] = '10';

    final patch = buildPatch(defaultSettings, f);

    expect(patch.crypto?.enabled, isTrue);
    expect(patch.crypto?.maxPortfolioPct, 10.0);
    expect(patch.crypto?.maxOrderNotionalUsd, isNull);
    expect(patch.crypto?.toJson().keys, ['enabled', 'maxPortfolioPct']);
    expect(patch.risk, isNull);
    expect(isEmptyPatch(patch), isFalse);
  });

  test('settingsForm_cryptoValidateEnforcesSleeveLimits', () {
    final f = toForm(defaultSettings);
    f.crypto[CryptoKey.maxPortfolioPct] = '30';
    f.crypto[CryptoKey.maxOrderNotionalUsd] = '0';

    final e = validateSettingsForm(f);

    expect(e['crypto.maxPortfolioPct'], 'Max 25');
    expect(e['crypto.maxOrderNotionalUsd'], 'Must be above 0');

    f.crypto[CryptoKey.maxPortfolioPct] = '0.5';
    expect(validateSettingsForm(f)['crypto.maxPortfolioPct'], 'Min 1');
  });

  test('settingsForm_validateRejectsOversizedWatchlist', () {
    final f = toForm(defaultSettings);
    f.watchlist = List.generate(51, (i) => 'T$i');

    expect(validateSettingsForm(f)['watchlist'], 'At most 50 tickers');
  });

  test('settingsForm_parseTickersUppercasesDedupesAndRejectsJunk', () {
    final parsed = parseTickers('nvda, spy aapl, 12x, brk.b', ['SPY']);

    expect(parsed.added, ['NVDA', 'AAPL', 'BRK.B']);
    expect(parsed.rejected, ['12x']);
  });

  test('settingsForm_fieldErrorMessagesMatchWebCopy', () {
    expect(fieldError(const FieldLimit(min: 0, minInclusive: false), ''), 'Required');
    expect(fieldError(const FieldLimit(), 'abc'), 'Enter a number');
    expect(
      fieldError(const FieldLimit(integer: true), '2.5'),
      'Whole number',
    );
    expect(
      fieldError(const FieldLimit(min: 0, minInclusive: false), '0'),
      'Must be above 0',
    );
    expect(fieldError(const FieldLimit(min: 5), '1'), 'Min 5');
    expect(fieldError(const FieldLimit(max: 5), '9'), 'Max 5');
    expect(fieldError(const FieldLimit(min: 5, max: 240, integer: true), '30'), isNull);
  });
}
