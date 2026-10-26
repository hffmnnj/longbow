import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/format.dart' show Tone;
import 'package:longbow/domain/analytics_calc.dart';
import 'package:longbow/models/models.dart';

ClosedTrade _trade({
  String symbol = 'NVDA',
  int closedAt = 1,
  double pnl = 0,
}) =>
    ClosedTrade(
      symbol: symbol,
      closedAt: closedAt,
      quantity: 1,
      exitPrice: 10,
      pnl: pnl,
      source: TradeSource.harness,
    );

EquityHistory _history(List<double?> benchmarks) => EquityHistory(
      points: [
        for (var i = 0; i < benchmarks.length; i++)
          EquityPoint(
            at: i,
            date: '2026-10-${10 + i}',
            equity: (1000 + i).toDouble(),
            benchmark: benchmarks[i],
          ),
      ],
      holdingsReplay: const [],
    );

void main() {
  group('thinSeries', () {
    test('keeps first and last item and the requested count over 1000 points', () {
      final items = List.generate(1000, (i) => i);
      final out = thinSeries(items, 50);
      expect(out, hasLength(50));
      expect(out.first, 0);
      expect(out.last, 999);
      expect(out, orderedEquals(out.toList()..sort()));
    });

    test('returns a short series unchanged and as a copy', () {
      final items = [1, 2, 3];
      final out = thinSeries(items, 10);
      expect(out, [1, 2, 3]);
      expect(identical(out, items), isFalse);
    });
  });

  group('indexToStart', () {
    test('expresses each value as percent change from the first', () {
      expect(indexToStart([200, 210, 190]), [0.0, 5.0, -5.0]);
    });

    test('returns zeros when the start is zero rather than infinities', () {
      expect(indexToStart([0, 5]), [0.0, 0.0]);
    });
  });

  group('rebase', () {
    test('lifts a narrow band off the zero floor and keeps differences intact', () {
      final r = rebase([
        [25000, 25500],
        [24900, 25200],
      ]);
      expect(r.offset, greaterThan(24000));
      expect(r.offset, lessThanOrEqualTo(24900));
      expect(r.rows[0][1] - r.rows[0][0], 500);
      expect(r.rows[1][0] + r.offset, 24900);
    });

    test('floors the offset to a round number so added-back ticks stay readable', () {
      final r = rebase([
        [25123, 25678]
      ]);
      expect(r.offset % 100, 0);
      expect(r.offset, lessThanOrEqualTo(25123));
    });

    test('never produces a negative offset for small values', () {
      expect(rebase([
        [0.05, 1]
      ]).offset, 0);
    });
  });

  group('equityRows', () {
    test('drops the benchmark entirely when any mark lacks one', () {
      final r = equityRows(_history([1000.0, null, 1002.0]));
      expect(r.hasBenchmark, isFalse);
      expect(r.rows.every((row) => row.benchmark == null), isTrue);
    });

    test('keeps the benchmark when every mark has one', () {
      final r = equityRows(_history([1000.0, 1001.0, 1002.0]));
      expect(r.hasBenchmark, isTrue);
      expect(r.rows.map((row) => row.benchmark), [1000.0, 1001.0, 1002.0]);
    });
  });

  group('equityReading', () {
    EquityHistory base() => EquityHistory(
          points: const [
            EquityPoint(at: 1, date: '2026-10-24', equity: 25000),
            EquityPoint(at: 2, date: '2026-10-26', equity: 25475),
          ],
          holdingsReplay: const [],
          returnPct: 1.9,
          benchmarkReturnPct: -0.6,
        );

    test('states the account against SPY since the first mark', () {
      expect(equityReading(base()), 'Up 1.90% vs SPY\'s \u22120.60% since Oct 24');
    });

    test('says Down for a negative return and drops SPY when there is no benchmark', () {
      final h = base();
      expect(
        equityReading(EquityHistory(
          points: h.points,
          holdingsReplay: h.holdingsReplay,
          returnPct: -2,
        )),
        'Down 2.00% since Oct 24',
      );
    });

    test('gives no reading for a single mark', () {
      final h = base();
      expect(
        equityReading(EquityHistory(
          points: h.points.sublist(0, 1),
          holdingsReplay: h.holdingsReplay,
          returnPct: h.returnPct,
          benchmarkReturnPct: h.benchmarkReturnPct,
        )),
        isNull,
      );
    });
  });

  group('replay labelling', () {
    test('names the replay as holdings and never as account history', () {
      expect(replayLabel, "Today's holdings, replayed");
      final reading = replayReading(EquityHistory(
        points: const [],
        holdingsReplay: const [
          HoldingsReplayPoint(date: '2026-08-03', value: 1000),
          HoldingsReplayPoint(date: '2026-10-23', value: 1064),
        ],
      ));
      expect(reading, 'Replay: today\'s holdings are +6.40% since Aug 3');
    });
  });

  group('calibration', () {
    List<CalibrationBucket> buckets() => const [
          CalibrationBucket(from: 0.5, to: 0.6, predicted: 0.55, realized: 0.4, count: 10),
          CalibrationBucket(from: 0.6, to: 0.7, predicted: 0.65, realized: 0.65, count: 10),
          CalibrationBucket(from: 0.7, to: 0.8, predicted: 0.75, realized: 0, count: 0),
        ];

    test('shows only buckets that have trades, as percentages, with counts', () {
      final rows = calibrationRows(buckets());
      expect(
        rows.map((r) => [r.label, r.predicted, r.realized, r.count]).toList(),
        [
          ['50\u201360%', 55.0, 40.0, 10],
          ['60\u201370%', 65.0, 65.0, 10],
        ],
      );
    });

    test('weights the gap by trade count: a 15 point miss on half reads as 8', () {
      expect(
        calibrationReading(buckets()),
        'Realized win rate runs 8 points below predictions across 20 trades',
      );
    });

    test('gives no reading without trades', () {
      expect(
        calibrationReading(const [
          CalibrationBucket(from: 0.5, to: 0.6, predicted: 0.55, realized: 0, count: 0),
        ]),
        isNull,
      );
    });
  });

  group('pnlBars', () {
    test('orders by close time, splits wins and losses, keeps the latest when capped', () {
      final bars = pnlBars(
        [
          _trade(symbol: 'B', closedAt: 20, pnl: -30),
          _trade(symbol: 'A', closedAt: 10, pnl: 50),
          _trade(symbol: 'C', closedAt: 30, pnl: 5),
        ],
        2,
      );
      expect(
        bars.map((b) => [b.label, b.gain, b.loss]).toList(),
        [
          ['B', 0.0, 30.0],
          ['C', 5.0, 0.0],
        ],
      );
    });
  });

  group('stops and heat', () {
    const position = Position(
      symbol: 'NVDA',
      quantity: 10,
      averageCost: 100,
      marketValue: 1200,
      unrealizedPnl: 200,
    );

    test('measures distance to the stop as a percent of price', () {
      expect(distanceToStopPct(120, 108), 10);
      expect(distanceToStopPct(100, 103), -3);
    });

    test('joins positions with the server stop and falls back to equity weight', () {
      final joined = positionStops(
        const [position],
        const [
          ExposureRow(
            symbol: 'NVDA',
            marketValue: 1200,
            weightPct: 4.8,
            unrealizedPnl: 200,
            stopPrice: 108,
          ),
        ],
        25000,
      );
      expect(joined.single.distancePct, 10);
      expect(joined.single.weightPct, 4.8);
      final bare = positionStops(const [position], const [], 24000);
      expect(bare.single.stopPrice, isNull);
      expect(bare.single.weightPct, 5);
    });

    test('caps heat at max positions times risk per trade', () {
      expect(
        heatCapPct(const RiskConfig(
          maxRiskPerTradePct: 1.5,
          maxPositionPct: 30,
          maxSectorPct: 60,
          maxPositions: 4,
          maxOrderNotionalUsd: 500,
          minOrderNotionalUsd: 5,
          dailyLossHaltPct: 3,
          monthlyDrawdownHaltPct: 8,
          maxEntriesPerDay: 2,
          minHoldDays: 1,
          maxSpreadBps: 20,
          maxSlippageBps: 10,
          noTradeOpenMinutes: 30,
          noTradeCloseMinutes: 15,
          maxDayTrades5d: 3,
          minEvToCost: 2,
          earningsBlackoutDays: 5,
          minAvgDollarVolumeUsd: 20000000,
        )),
        6,
      );
    });
  });

  group('orderOutcomes', () {
    test('lists non-zero statuses largest first with plain labels', () {
      expect(
        orderOutcomes(const {
          OrderStatus.filled: 3,
          OrderStatus.rejectedRisk: 5,
          OrderStatus.failed: 0,
        }),
        [
          const OrderOutcome(status: OrderStatus.rejectedRisk, label: 'Blocked by risk', count: 5),
          const OrderOutcome(status: OrderStatus.filled, label: 'Filled', count: 3),
        ],
      );
    });
  });

  group('ditherRampSvg', () {
    test('is solid at the left edge and sparser at the right', () {
      final svg = ditherRampSvg(8, 2);
      int at(int x) =>
          svg.split('<rect').where((r) => r.contains('x="$x"')).length;
      expect(at(0), 4);
      expect(at(14), lessThan(at(0)));
    });
  });

  group('market readings', () {
    test('describes a normal curve in basis points', () {
      expect(
        yieldReading(const [
          YieldPoint(tenor: '2Y', yieldPct: 3.86),
          YieldPoint(tenor: '10Y', yieldPct: 4.18),
        ]),
        '10Y at 4.18%, 32 bp above 2Y: the curve slopes up',
      );
    });

    test('calls a negative 2s10s spread inverted', () {
      expect(
        yieldReading(const [
          YieldPoint(tenor: '2Y', yieldPct: 4.5),
          YieldPoint(tenor: '10Y', yieldPct: 4.2),
        ]),
        '10Y at 4.20%, 30 bp below 2Y: the curve is inverted',
      );
    });

    test('returns nothing when 2Y or 10Y is missing', () {
      expect(
        yieldReading(const [YieldPoint(tenor: '10Y', yieldPct: 4)]),
        isNull,
      );
    });

    test('states VIX rank with the right ordinal and the term structure', () {
      expect(
        vixReading(const VolatilityInfo(vix: 14.8, percentile: 22, contango: true, history: [])),
        'VIX 14.8 at the 22nd percentile of the past year; near-term fear is below the 3-month level (contango)',
      );
      expect(
        vixReading(const VolatilityInfo(vix: 31, percentile: 93, contango: false, history: [])),
        contains('93rd percentile'),
      );
    });

    test('computes breadth as the share above the 50 day, zero for empty', () {
      expect(breadthPct(const BreadthInfo(aboveSma50: 250, total: 500)), 50);
      expect(breadthPct(const BreadthInfo(aboveSma50: 0, total: 0)), 0);
    });
  });

  group('list keys', () {
    test('stays unique when two calendar rows share a date and name', () {
      const a = CalendarEvent(date: '2026-10-26', event: 'FOMC minutes');
      final keys = [calendarKey(a, 0), calendarKey(a, 1)];
      expect(keys.toSet(), hasLength(keys.length));
    });

    test('stays unique when two earnings rows share a symbol and date', () {
      const e = EarningsEvent(symbol: 'NVDA', date: '2026-10-26', held: true);
      final keys = [earningsKey(e, 0), earningsKey(e, 1)];
      expect(keys.toSet(), hasLength(keys.length));
    });

    test('stays unique when two closed trades share a symbol and close time', () {
      final t = _trade(symbol: 'MSFT', closedAt: 5);
      final keys = [closedTradeKey(t, 0), closedTradeKey(_trade(symbol: 'MSFT', closedAt: 5), 1)];
      expect(keys.toSet(), hasLength(keys.length));
    });

    test('stays unique when two fills share an order and timestamp', () {
      const f = SimFill(
        at: 7,
        date: '2026-10-26',
        symbol: 'SPY',
        side: OrderSide.buy,
        quantity: 1,
        price: 500,
        orderId: 'o1',
      );
      final keys = [simFillKey(f, 0), simFillKey(f, 1)];
      expect(keys.toSet(), hasLength(keys.length));
    });

    test('groups the calendar by date in first-seen order', () {
      final days = groupCalendarDays(
        const [
          CalendarEvent(date: '2026-10-27', event: 'B'),
          CalendarEvent(date: '2026-10-26', event: 'A'),
          CalendarEvent(date: '2026-10-26', event: 'A again'),
        ],
        (c) => c.date,
      );
      expect(days.map((d) => d.date), ['2026-10-27', '2026-10-26']);
      expect(days[1].items.map((i) => i.event), ['A', 'A again']);
    });
  });

  group('tone mapping', () {
    test('exposes the shared gain/loss/flat tone for UI colours', () {
      expect(Tone.values, containsAll([Tone.gain, Tone.loss, Tone.flat]));
    });
  });
}
