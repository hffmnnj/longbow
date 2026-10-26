import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/domain/tool_meta.dart';
import 'package:longbow/models/models.dart';

OrderRecord _order(String id, OrderStatus status) {
  return OrderRecord(
    id: id,
    createdAt: 1,
    updatedAt: 1,
    intent: const OrderIntent(
      symbol: 'MSFT',
      side: OrderSide.buy,
      quantity: 3,
      orderType: OrderType.limit,
      limitPrice: 413.2,
      timeInForce: TimeInForce.day,
      invalidationPrice: 407.1,
      timeStopDate: '2026-10-30',
      thesis: ' Thesis with enough words to be a thesis.',
      probabilityWin: 0.5,
      expectedGainPct: 2,
      expectedLossPct: 1,
      estimatedCostPct: 0.1,
      evidence: ['q'],
    ),
    verdict: const RiskVerdict(approved: true, isExit: false, checks: []),
    status: status,
  );
}

void main() {
  test('toolMeta_familyMapsToolNames', () {
    expect(toolFamily('rh_status'), ToolFamily.robinhood);
    expect(toolFamily('rh_review_equity_order'), ToolFamily.robinhood);
    expect(toolFamily('get_portfolio'), ToolFamily.robinhood);
    expect(toolFamily('get_quote'), ToolFamily.robinhood);
    expect(toolFamily('market_indicators'), ToolFamily.market);
    expect(toolFamily('market'), ToolFamily.market);
    expect(toolFamily('sec_company'), ToolFamily.sec);
    expect(toolFamily('sec_filings'), ToolFamily.sec);
    expect(toolFamily('web_search'), ToolFamily.web);
    expect(toolFamily('open_page'), ToolFamily.web);
    expect(toolFamily('find_in_page'), ToolFamily.web);
    expect(toolFamily('skills_load'), ToolFamily.skills);
    expect(toolFamily('skills'), ToolFamily.skills);
    expect(toolFamily('notes_read'), ToolFamily.notes);
    expect(toolFamily('record_decision'), ToolFamily.journal);
    expect(toolFamily('submit_order'), ToolFamily.risk);
    expect(toolFamily('cancel_order'), ToolFamily.risk);
    expect(toolFamily('get_risk_state'), ToolFamily.risk);
    expect(toolFamily('delegate'), ToolFamily.delegate);
    expect(toolFamily('sim_start'), ToolFamily.lab);
    expect(toolFamily('codemode'), ToolFamily.code);
    expect(toolFamily('something_new'), ToolFamily.other);
    expect(toolFamily(null), ToolFamily.other);
  });

  test('toolMeta_iconUsesOneKeyPerFamily', () {
    expect(toolIcon('get_quote'), ToolIcon.briefcase);
    expect(toolIcon('market_indicators'), ToolIcon.chartLine);
    expect(toolIcon('sec_company'), ToolIcon.bookOpen);
    expect(toolIcon('web_search'), ToolIcon.search);
    expect(toolIcon('skills_load'), ToolIcon.command);
    expect(toolIcon('notes_write'), ToolIcon.notebook);
    expect(toolIcon('record_decision'), ToolIcon.note);
    expect(toolIcon('submit_order'), ToolIcon.shield);
    expect(toolIcon('cancel_order'), ToolIcon.shield);
    expect(toolIcon('sim_start'), ToolIcon.flask);
    expect(toolIcon('codemode'), ToolIcon.code);
    expect(toolIcon('mystery_tool'), ToolIcon.wrench);
  });

  test('toolMeta_iconUsesRoleGlyphForDelegateCalls', () {
    expect(
      toolIcon('delegate', summary: '{"role":"bear","symbol":"SMH"}'),
      ToolIcon.tradeDown,
    );
    expect(
      toolIcon('delegate', summary: '{"role":"risk_reviewer","task":"x"}'),
      ToolIcon.shield,
    );
    expect(toolIcon('delegate', summary: 'not json'), ToolIcon.wrench);
    expect(
      toolIcon('delegate', role: 'bull'),
      ToolIcon.tradeUp,
    );
  });

  test('toolMeta_titleNamesSubjectFromJsonArguments', () {
    expect(toolTitle('market_indicators', '{"symbol":"NVDA"}'), 'Indicators for NVDA');
    expect(
      toolTitle('market_price_history', '{"symbol":"QQQ"}'),
      'Price history for QQQ',
    );
    expect(toolTitle('get_quote', '{"symbol":"MSFT"}'), 'Quote for MSFT');
    expect(
      toolTitle('skills_load', '{"name":"market-regime"}'),
      'Loaded skill market-regime',
    );
    expect(toolTitle('notes_read', '{"path":"plan.md"}'), 'Read plan.md');
    expect(
      toolTitle('web_search', '{"query":"MSFT guidance Azure growth"}'),
      'Searched the web for MSFT guidance Azure growth',
    );
    expect(
      toolTitle('open_page', '{"url":"https://example.com/a/b"}'),
      'Opened example.com/a/b',
    );
    expect(
      toolTitle('delegate', '{"role":"bear","symbol":"SMH"}'),
      'Delegated to bear · SMH',
    );
    expect(toolTitle('delegate', '{"role":"bull"}'), 'Delegated to bull');
    expect(
      toolTitle('record_decision', '{"action":"buy","symbol":"MSFT"}'),
      'Recorded buy MSFT',
    );
    expect(
      toolTitle('submit_order', '{"symbol":"MSFT","side":"buy","quantity":3}'),
      'Submitted buy 3 MSFT',
    );
    expect(
      toolTitle('cancel_order', '{"symbol":"MSFT"}'),
      'Cancelled order for MSFT',
    );
  });

  test('toolMeta_titleFallsBackWhenSummaryIsNotArguments', () {
    expect(toolTitle('submit_order'), 'Submitted order');
    expect(toolTitle('cancel_order'), 'Cancelled order');
    expect(toolTitle('web_search'), 'Searched the web');
    expect(
      toolTitle('web_search', 'crude oil curve WTI backwardation narrows'),
      'Searched the web',
    );
    expect(toolTitle('delegate', 'not json'), 'Delegated');
    expect(toolTitle('market_indicators'), 'Checked indicators');
  });

  test('toolMeta_groupConsecutiveKeepsDelegateAndSubmitSolo', () {
    String nameOf(MapEntry<String, int> e) => e.key;
    MapEntry<String, int> call(String name, int i) => MapEntry(name, i);

    final groups = groupConsecutive(
      [call('market_indicators', 0), call('market_indicators', 1), call('web_search', 2), call('market_indicators', 3)],
      nameOf,
    );
    expect(
      groups.map((g) => [g.name, g.items.length]),
      [
        ['market_indicators', 2],
        ['web_search', 1],
        ['market_indicators', 1],
      ],
    );

    final solo = groupConsecutive(
      [call('delegate', 0), call('delegate', 1), call('submit_order', 2), call('submit_order', 3)],
      nameOf,
    );
    expect(solo, hasLength(4));
    expect(solo.every((g) => g.items.length == 1), isTrue);
  });

  test('toolMeta_extractUrlsFindsStripsAndDedupes', () {
    expect(
      extractUrls('see https://example.com/a and https://example.com/a.'),
      ['https://example.com/a'],
    );
    expect(extractUrls('no links here'), isEmpty);
    expect(extractUrls(null), isEmpty);
  });

  test('toolMeta_matchSubmitOrderLinksMessageToOrder', () {
    final orders = [
      _order('ord-1', OrderStatus.pendingApproval),
      _order('ord-2', OrderStatus.failed),
    ];

    expect(
      matchSubmitOrder('order ord-1: pending_approval (MSFT buy 3 @ 413.2)', orders)?.id,
      'ord-1',
    );
    expect(matchSubmitOrder('nothing to see', orders), isNull);
  });

  test('toolMeta_submitOrderFailedFlagsRejectedAndFailed', () {
    final orders = [
      _order('ord-1', OrderStatus.pendingApproval),
      _order('ord-2', OrderStatus.failed),
    ];

    expect(submitOrderFailed(orders[0]), isFalse);
    expect(submitOrderFailed(orders[1]), isTrue);
    expect(submitOrderFailed(null), isFalse);
  });

  test('toolMeta_filledAndCancelledAreNotFailures', () {
    for (final status in [
      OrderStatus.filled,
      OrderStatus.cancelled,
      OrderStatus.held,
      OrderStatus.triggering,
      OrderStatus.partiallyFilled,
    ]) {
      expect(submitOrderFailed(_order('x', status)), isFalse, reason: '$status');
    }
    for (final status in [
      OrderStatus.rejectedRisk,
      OrderStatus.rejectedUser,
      OrderStatus.failed,
      OrderStatus.expired,
    ]) {
      expect(submitOrderFailed(_order('x', status)), isTrue, reason: '$status');
    }
  });

  test('toolMeta_callHelpersDistinguishMessagesFromSummaries', () {
    const message = ChatMessage(
      id: 'm',
      at: 1,
      role: ChatRole.tool,
      text: 't',
      toolName: 'get_quote',
    );
    const summary = ToolCallSummary(name: 'get_quote', summary: '{"symbol":"MSFT"}');

    expect(isMessageCall(message), isTrue);
    expect(isMessageCall(summary), isFalse);
    expect(callName(message), 'get_quote');
    expect(callName(summary), 'get_quote');
    expect(callSummary(message), isNull);
    expect(callSummary(summary), '{"symbol":"MSFT"}');
  });

  test('toolMeta_sourceMetaKeepsHostAndShortPath', () {
    expect(
      sourceMeta('https://example.com/a/b'),
      const SourceMeta(host: 'example.com', label: 'example.com/a/b'),
    );
  });
}
