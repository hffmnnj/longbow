import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/app/status/status_text.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('coarseCountdown_dropsSecondsOnceAboveAMinute', () {
    expect(coarseCountdown(45 * 1000), '45s');
    expect(coarseCountdown(5 * 60 * 1000 + 7000), '5m');
    expect(coarseCountdown(3 * 3600 * 1000 + 12 * 60 * 1000 + 59000), '3h 12m');
    expect(coarseCountdown(2 * 86400 * 1000 + 2 * 3600 * 1000), '2d 2h');
    expect(coarseCountdown(-5000), '0s');
  });

  test('sessionNext_openCountsToCloseAndClosedCountsToOpen', () {
    MarketClock clock({required bool open, bool early = false}) => MarketClock(
          now: 1,
          session: open ? MarketSession.regular : MarketSession.closed,
          isOpen: open,
          tradingDay: '2026-10-26',
          nextOpen: 111,
          nextClose: 222,
          earlyClose: early,
        );

    expect(sessionNext(clock(open: true)), (verb: 'Closes in', at: 222));
    expect(sessionNext(clock(open: true, early: true)), (verb: 'Early close in', at: 222));
    expect(sessionNext(clock(open: false)), (verb: 'Opens in', at: 111));
  });

  test('haltWords_coverEveryReasonWithADistinctSentence', () {
    expect(haltWords.keys.toSet(), HaltReason.values.toSet());
    expect(haltWords.values.toSet(), hasLength(HaltReason.values.length));
  });

  test('brokerNeedsConnect_onlyForStatesWhereSignInHelps', () {
    expect(BrokerState.values.where(brokerNeedsConnect), [BrokerState.disconnected, BrokerState.needsAuth, BrokerState.error]);
  });
}
