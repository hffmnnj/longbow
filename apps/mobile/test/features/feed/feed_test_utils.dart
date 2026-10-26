import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/feed/transcript_view.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

/// Starts a [StoreHarness] whose fake API is scripted by [script] before the
/// first refresh, and disposes it with the test.
Future<StoreHarness> startHarness(WidgetTester tester, {void Function(FakeApi api)? script}) async {
  final h = (await tester.runAsync(StoreHarness.create))!;
  addTearDown(() {
    if (!_disposed.contains(h)) h.dispose();
  });
  script?.call(h.api);
  await tester.runAsync(h.start);
  // The store's first refresh starts while the harness is created, before the
  // script ran: refresh again so every scripted response is in use.
  if (script != null) await tester.runAsync(h.notifier.refresh);
  return h;
}

final Set<StoreHarness> _disposed = <StoreHarness>{};

/// Unmounts the screen and disposes the stores now. Needed by tests that watch
/// the shared clock, whose periodic timer must be gone before the test ends.
Future<void> shutDown(WidgetTester tester, StoreHarness h) async {
  await tester.pumpWidget(const SizedBox());
  _disposed.add(h);
  h.dispose();
}

/// Taps an expandable row and lets its size animation run.
Future<void> tapRow(WidgetTester tester, Finder finder) async {
  await tester.tap(finder);
  await tester.pump();
  // Nested size animations restart when an inner one moves: allow both.
  await tester.pump(const Duration(milliseconds: 250));
  await tester.pump(const Duration(milliseconds: 250));
}

/// Lets real async work in the fake API finish, then renders the result.
Future<void> settle(WidgetTester tester, StoreHarness h) async {
  await tester.runAsync(h.pump);
  await tester.pump(const Duration(milliseconds: 400));
}

ChatMessage userMsg(String id, String text, {int at = 1000}) =>
    ChatMessage(id: id, at: at, role: ChatRole.user, text: text);

ChatMessage assistantMsg(String id, String text, {int at = 1000}) =>
    ChatMessage(id: id, at: at, role: ChatRole.assistant, text: text);

ChatMessage toolMsg(String id, String name, String text, {int at = 1000, bool? isError, String? child, String? agentRole}) =>
    ChatMessage(
      id: id,
      at: at,
      role: ChatRole.tool,
      text: text,
      toolName: name,
      isError: isError,
      childConversationId: child,
      agentRole: agentRole,
    );

ChatMessage codeMsg(String id, String code, {int at = 1000}) =>
    ChatMessage(id: id, at: at, role: ChatRole.tool, text: 'codemode', toolName: 'codemode', code: code);

ChatMessage resultMsg(String id, String text, {int at = 4000, List<ToolCallSummary>? calls, bool? isError}) =>
    ChatMessage(id: id, at: at, role: ChatRole.tool, text: text, toolName: 'codemode', calls: calls, isError: isError);

JournalEntry decision(String id, {int at = 2000, String? orderId, JournalAction action = JournalAction.buy}) => JournalEntry(
      id: id,
      at: at,
      action: action,
      symbol: 'NVDA',
      summary: 'Buy NVDA on the pullback',
      rationale: 'Trend intact, volume dried up on the dip.',
      confidence: 0.62,
      evidence: const ['RSI(2) at 8', 'Held the 50-day average'],
      orderId: orderId,
    );

/// A pending-approval order with a distinctive size and price so swapped
/// fields fail loudly.
OrderRecord order(
  String id, {
  OrderStatus status = OrderStatus.pendingApproval,
  List<RiskCheck> checks = const [],
  String? review,
  String? error,
  double? filled,
  double? fillPrice,
  int createdAt = 1000,
}) =>
    OrderRecord(
      id: id,
      createdAt: createdAt,
      updatedAt: createdAt,
      intent: const OrderIntent(
        symbol: 'NVDA',
        side: OrderSide.buy,
        quantity: 3,
        orderType: OrderType.limit,
        limitPrice: 501.25,
        timeInForce: TimeInForce.day,
        invalidationPrice: 480,
        timeStopDate: '2026-11-06',
        thesis: 'Pullback to the 50-day with falling volume.',
        probabilityWin: 0.62,
        expectedGainPct: 6,
        expectedLossPct: 3,
        estimatedCostPct: 0.2,
        sector: 'Technology',
        evidence: ['RSI(2) at 8', 'Held the 50-day average'],
      ),
      verdict: RiskVerdict(approved: true, isExit: false, checks: checks),
      status: status,
      review: review,
      error: error,
      filledQuantity: filled,
      averageFillPrice: fillPrice,
    );

const passCheck = RiskCheck(rule: 'max_position', ok: true, detail: 'Position stays under 30%.');
const failCheck = RiskCheck(rule: 'max_spread', ok: false, detail: 'Spread 42 bps is over the 20 bps limit.');

SubagentRun run(String id, {SubagentStatus status = SubagentStatus.running, int startedAt = 1500, int? endedAt, String? answer}) =>
    SubagentRun(
      id: id,
      role: SubagentRole.bull,
      symbol: 'NVDA',
      task: 'Argue the bull case for NVDA',
      startedAt: startedAt,
      endedAt: endedAt,
      status: status,
      answer: answer,
    );

/// A [FeedTranscriptView] driven by [feed] that tests can swap to simulate
/// stream updates.
class ViewHost extends StatelessWidget {
  const ViewHost({super.key, required this.feed, this.loaded, this.running, this.emptyAction});

  final ValueNotifier<FeedState> feed;
  final List<String>? loaded;
  final bool? running;
  final Widget? emptyAction;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ValueListenableBuilder<FeedState>(
        valueListenable: feed,
        builder: (context, state, _) => FeedTranscriptView(
          feed: state,
          running: running,
          emptyAction: emptyAction,
          loadTranscript: (id) async => loaded?.add(id),
        ),
      ),
    );
  }
}

Future<ValueNotifier<FeedState>> pumpView(
  WidgetTester tester,
  StoreHarness h,
  FeedState initial, {
  List<String>? loaded,
  bool? running,
  Size size = const Size(360, 800),
  double textScale = 1.0,
  Widget? emptyAction,
}) async {
  final feed = ValueNotifier<FeedState>(initial);
  addTearDown(feed.dispose);
  await pumpScreen(
    tester,
    ViewHost(feed: feed, loaded: loaded, running: running, emptyAction: emptyAction),
    harness: h,
    size: size,
    textScale: textScale,
  );
  await tester.pump(const Duration(milliseconds: 400));
  return feed;
}

/// Trace rows draw title and description in one rich text.
Finder rich(String text) => find.textContaining(text, findRichText: true);
