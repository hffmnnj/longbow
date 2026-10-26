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
