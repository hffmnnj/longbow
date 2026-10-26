import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

Map<String, dynamic> fixture(String name) =>
    jsonDecode(File('test/fixtures/$name').readAsStringSync())
        as Map<String, dynamic>;

Map<String, dynamic> withUnknown(
  Map<String, dynamic> base,
  String key,
  Object? value,
) => {...base, key: value};

void main() {
  test('enums_unknownTradingModeFallsBackToOff', () {
    final settings = Settings.fromJson(
      withUnknown(fixture('settings.json'), 'mode', 'turbo'),
    );

    expect(settings.mode, TradingMode.off);
  });

  test('enums_unknownMarketAndBrokerStatesFailClosed', () {
    final clock = MarketClock.fromJson(
      withUnknown(fixture('status.json')['market'], 'session', 'half_open'),
    );
    final broker = BrokerStatus.fromJson(
      withUnknown(fixture('status.json')['broker'], 'state', 'sometimes'),
    );

    expect(clock.session, MarketSession.closed);
    expect(broker.state, BrokerState.disconnected);
  });

  test('enums_unknownOrderFieldsFallBack', () {
    final raw = (jsonDecode(File('test/fixtures/orders.json').readAsStringSync())
        as List)
        .single as Map<String, dynamic>;
    final order = OrderRecord.fromJson({
      ...raw,
      'status': 'teleported',
      'intent': withUnknown(
        withUnknown(
          withUnknown(raw['intent'], 'side', 'sideways'),
          'orderType',
          'market',
        ),
        'timeInForce',
        'whenever',
      ),
    });

    expect(order.status, OrderStatus.pendingApproval);
    expect(order.intent.side, OrderSide.buy);
    expect(order.intent.orderType, OrderType.limit);
    expect(order.intent.timeInForce, TimeInForce.day);
  });

  test('enums_unknownJournalAndChatValuesFallBack', () {
    final entry = JournalEntry.fromJson(
      withUnknown(
        (jsonDecode(File('test/fixtures/journal.json').readAsStringSync())
                as List)
            .first,
        'action',
        'yolo',
      ),
    );
    final message = ChatMessage.fromJson(
      withUnknown(
        (jsonDecode(File('test/fixtures/messages.json').readAsStringSync())
                as List)
            .first,
        'role',
        'narrator',
      ),
    );

    expect(entry.action, JournalAction.none);
    expect(message.role, ChatRole.assistant);
  });

  test('enums_unknownAgentValuesFallBack', () {
    final status = AgentStatus.fromJson(
      withUnknown(
        withUnknown(fixture('status.json')['agent'], 'state', 'dreaming'),
        'lastCycleKind',
        'brunch',
      ),
    );
    final run = SubagentRun.fromJson(
      withUnknown(
        withUnknown(
          (jsonDecode(File('test/fixtures/subagents.json').readAsStringSync())
                  as List)
              .single,
          'role',
          'oracle',
        ),
        'status',
        'transcended',
      ),
    );

    expect(status.state, AgentState.idle);
    expect(status.lastCycleKind, CycleKind.manual);
    expect(run.role, SubagentRole.analyst);
    expect(run.status, SubagentStatus.failed);
  });

  test('enums_unknownHaltBlocksEntries', () {
    final status = StatusResponse.fromJson(
      withUnknown(fixture('status.json'), 'halts', ['solar_flare']),
    );

    expect(status.halts, [HaltReason.brokerDisconnected]);
  });

  test('enums_unknownReportKindAndGradeFallBack', () {
    final summary = ReportSummary.fromJson(
      withUnknown(
        withUnknown(
          (jsonDecode(File('test/fixtures/reports.json').readAsStringSync())
                  as List)
              .single,
          'kind',
          'novel',
        ),
        'grade',
        'S',
      ),
    );

    expect(summary.kind, ReportKind.daily);
    expect(summary.grade, ReportGrade.c);
  });

  test('enums_unknownAnalyticsSourcesFallBack', () {
    final trade = ClosedTrade.fromJson(
      withUnknown(
        fixture('performance.json')['trades'][0],
        'source',
        'paper',
      ),
    );
    final event = CalendarEvent.fromJson(
      withUnknown(
        fixture('market_overview.json')['calendar'][0],
        'importance',
        'critical',
      ),
    );
    final stop = StopInfo.fromJson({'price': 10.0, 'source': 'vibes'});

    expect(trade.source, TradeSource.robinhood);
    expect(event.importance, CalendarImportance.medium);
    expect(stop.source, StopSource.thesis);
  });

  test('enums_unknownSimValuesFallBack', () {
    final entry = SimSuiteRunEntry.fromJson({
      'runId': 'r1',
      'variant': 'A',
      'mode': 'dream',
    });
    final config = SimRunConfig.fromJson({
      'days': 10,
      'startingCash': 1000.0,
      'cyclesPerDay': 2,
      'mode': 'lucid',
      'execution': 'perfect',
    });
    final suiteConfig = SimSuiteConfig.fromJson({
      'name': 'x',
      'startingCash': 1000.0,
      'variants': [
        {'label': 'A', 'model': 'quantum'},
      ],
      'scenarioMode': 'anything',
    });
    final scenario = SimScenario.fromJson({
      'id': 's',
      'name': 'n',
      'description': 'd',
      'startDate': '2020-01-02',
      'days': 10,
      'regime': 'goldilocks',
    });
    final run = SimRun.fromJson(
      withUnknown(
        withUnknown(fixture('sim_run.json'), 'status', 'ascending'),
        'startedBy',
        'ghost',
      ),
    );

    expect(entry.mode, SimMode.historical);
    expect(config.mode, SimMode.historical);
    expect(config.execution, SimExecution.realistic);
    expect(suiteConfig.scenarioMode, ScenarioMode.blind);
    expect(suiteConfig.variants.single.model, SimModel.main);
    expect(scenario.regime, SimRegime.chop);
    expect(run.status, SimRunStatus.failed);
    expect(run.startedBy, StartedBy.user);
  });

  test('enums_sendableEnumsEmitWireStrings', () {
    final json = const SimRunConfig(
      days: 10,
      startingCash: 1000,
      cyclesPerDay: 2,
      mode: SimMode.bootstrap,
      execution: SimExecution.ideal,
      model: SimModel.subagent,
    ).toJson();

    expect(json['mode'], 'bootstrap');
    expect(json['execution'], 'ideal');
    expect(json['model'], 'subagent');

    final variant = const SimVariant(label: 'B', model: SimModel.subagent).toJson();
    expect(variant['model'], 'subagent');
  });
}
