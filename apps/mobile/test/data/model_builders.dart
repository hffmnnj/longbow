import 'package:longbow/models/models.dart';

/// Small inline builders for store tests (no fixture files: values are
/// chosen per test so swapped or ignored fields fail loudly).

ChatMessage testMessage(String id,
    {int at = 1, ChatRole role = ChatRole.user, String? text}) =>
    ChatMessage(id: id, at: at, role: role, text: text ?? id);

JournalEntry testEntry(String id, {int at = 1, String? symbol}) => JournalEntry(
      id: id,
      at: at,
      action: JournalAction.hold,
      symbol: symbol,
      summary: id,
      rationale: 'r',
      evidence: const [],
    );

OrderRecord testOrder(String id,
    {OrderStatus status = OrderStatus.pendingApproval, int createdAt = 1}) =>
    OrderRecord(
      id: id,
      createdAt: createdAt,
      updatedAt: createdAt,
      intent: const OrderIntent(
        symbol: 'SPY',
        side: OrderSide.buy,
        quantity: 2,
        orderType: OrderType.limit,
        limitPrice: 500,
        timeInForce: TimeInForce.day,
        invalidationPrice: 490,
        timeStopDate: '2026-10-26',
        thesis: 't',
        probabilityWin: 0.6,
        expectedGainPct: 2,
        expectedLossPct: 1,
        estimatedCostPct: 0.1,
        evidence: [],
      ),
      verdict: const RiskVerdict(approved: true, isExit: false, checks: []),
      status: status,
    );

StatusResponse testStatus({
  AgentState agentState = AgentState.idle,
  List<HaltReason> halts = const [],
  double? dayPnl,
}) =>
    StatusResponse(
      agent: AgentStatus(state: agentState, model: 'main'),
      broker: const BrokerStatus(state: BrokerState.disconnected, tools: []),
      market: const MarketClock(
        now: 1,
        session: MarketSession.closed,
        isOpen: false,
        tradingDay: '2026-10-26',
        nextOpen: 2,
        nextClose: 3,
        earlyClose: false,
      ),
      settings: defaultSettings,
      account: const AccountSnapshot(
        at: 1,
        equity: 1200,
        cash: 600,
        buyingPower: 600,
        positions: [
          Position(
            symbol: 'SPY',
            quantity: 1,
            averageCost: 500,
            marketValue: 600,
            unrealizedPnl: 100,
          ),
        ],
      ),
      halts: halts,
      dayPnl: dayPnl,
      liveTrading: false,
      models: const ModelsInfo(main: 'a', subagents: 'b'),
    );

/// Raw JSON mirroring [testStatus], for seeding the offline status cache.
Map<String, dynamic> testStatusJson({
  String agentState = 'running',
  List<String> halts = const [],
}) =>
    {
      'agent': {'state': agentState, 'model': 'main'},
      'broker': {'state': 'disconnected', 'tools': []},
      'market': {
        'now': 1,
        'session': 'closed',
        'isOpen': false,
        'tradingDay': '2026-10-26',
        'nextOpen': 2,
        'nextClose': 3,
        'earlyClose': false,
      },
      'settings': {
        'mode': 'auto',
        'killSwitch': false,
        'drawdownHalted': false,
        'cycleMinutesOpen': 30,
        'cycleMinutesClosed': 240,
        'watchlist': ['SPY'],
        'risk': {
          'maxRiskPerTradePct': 1.5,
          'maxPositionPct': 30.0,
          'maxSectorPct': 60.0,
          'maxPositions': 4,
          'maxOrderNotionalUsd': 500.0,
          'minOrderNotionalUsd': 5.0,
          'dailyLossHaltPct': 3.0,
          'monthlyDrawdownHaltPct': 8.0,
          'maxEntriesPerDay': 2,
          'minHoldDays': 1,
          'maxSpreadBps': 20.0,
          'maxSlippageBps': 10.0,
          'noTradeOpenMinutes': 30,
          'noTradeCloseMinutes': 15,
          'maxDayTrades5d': 3,
          'minEvToCost': 2.0,
          'earningsBlackoutDays': 5,
          'minAvgDollarVolumeUsd': 20000000.0,
        },
      },
      'account': {
        'at': 1,
        'equity': 1200.0,
        'cash': 600.0,
        'buyingPower': 600.0,
        'positions': [
          {
            'symbol': 'SPY',
            'quantity': 1.0,
            'averageCost': 500.0,
            'marketValue': 600.0,
            'unrealizedPnl': 100.0,
          },
        ],
      },
      'halts': halts,
      'liveTrading': false,
      'models': {'main': 'a', 'subagents': 'b'},
    };

SimRun testRun(String id, {int createdAt = 1}) => SimRun(
      id: id,
      createdAt: createdAt,
      startedBy: StartedBy.user,
      config: const SimRunConfig(
        days: 10,
        startingCash: 1200,
        cyclesPerDay: 2,
      ),
      status: SimRunStatus.done,
      progress: const SimProgress(day: 10, days: 10, cycle: 2, cyclesPerDay: 2),
      equity: const [],
      positions: const [],
      fills: const [],
    );

SimSuite testSuite(String id, {int createdAt = 1}) => SimSuite(
      id: id,
      createdAt: createdAt,
      startedBy: StartedBy.user,
      config: const SimSuiteConfig(
        name: 's',
        startingCash: 1200,
        variants: [],
      ),
      status: SimRunStatus.done,
      runs: const [],
      summary: const [],
    );

ReportSummary testReport(String id, {int at = 1}) => ReportSummary(
      id: id,
      kind: ReportKind.daily,
      at: at,
      periodStart: '2026-10-26',
      periodEnd: '2026-10-26',
      headline: 'headline $id',
    );
