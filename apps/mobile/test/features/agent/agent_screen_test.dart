import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/features/agent/agent_screen.dart';
import 'package:longbow/features/feed/transcript_page.dart';
import 'package:longbow/features/history/history_screen.dart';
import 'package:longbow/models/models.dart';

import '../../support/pump_screen.dart';

StatusResponse _fixture() => StatusResponse.fromJson(
      jsonDecode(File('test/fixtures/status.json').readAsStringSync())
          as Map<String, dynamic>,
    );

List<JournalEntry> _journalFixture() =>
    (jsonDecode(File('test/fixtures/journal.json').readAsStringSync()) as List)
        .map((e) => JournalEntry.fromJson(e as Map<String, dynamic>))
        .toList();

StatusResponse _with({
  StatusResponse? base,
  TradingMode? mode,
  bool? killSwitch,
  bool? liveTrading,
  AgentState? agentState,
  String? lastError,
  int? nextCycleAt,
}) {
  final b = base ?? _fixture();
  final agent = agentState == null && lastError == null && nextCycleAt == null
      ? b.agent
      : b.agent.copyWith(
          state: agentState ?? b.agent.state,
          lastError: lastError ?? b.agent.lastError,
          nextCycleAt: nextCycleAt ?? b.agent.nextCycleAt,
        );
  return b.copyWith(
    agent: agent,
    liveTrading: liveTrading ?? b.liveTrading,
    settings: b.settings.copyWith(
      mode: mode ?? b.settings.mode,
      killSwitch: killSwitch ?? b.settings.killSwitch,
    ),
  );
}

Future<StoreHarness> _start(
  WidgetTester tester,
  StatusResponse status, {
  List<SubagentRun>? subagents,
  List<JournalEntry>? journal,
  Size size = const Size(360, 800),
  double textScale = 1.0,
}) async {
  final api = FakeApi()..defaults();
  api.on('status', () async => status);
  if (subagents != null) api.on('subagents', () async => subagents);
  if (journal != null) api.on('journal', () async => journal);
  final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
  addTearDown(h.dispose);
  await tester.runAsync(h.start);
  await pumpScreen(
    tester,
    const AgentScreen(),
    harness: h,
    size: size,
    textScale: textScale,
  );
  await tester.pump();
  return h;
}

Future<void> _settle(WidgetTester tester, StoreHarness h) async {
  await tester.runAsync(() => h.pump());
  await tester.pump();
  await tester.pump();
}

/// Stop the 1 Hz clock before the test returns: the binding fails a test that
/// leaves a real timer pending, and addTearDown runs too late to help.
void _stopClock(StoreHarness h) {
  h.container.read(clockProvider.notifier).pause();
}

/// Scrolls [finder] into view: slivers only build visible children, so
/// below-the-fold rows must be revealed before asserting or tapping them.
Future<void> _reveal(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 40; i++) {
    await tester.pump();
    if (finder.evaluate().isNotEmpty) {
      await tester.ensureVisible(finder);
      await tester.pump();
      return;
    }
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -400));
  }
  // Final attempt surfaces a clear finder error instead of timing out.
  await tester.ensureVisible(finder);
  await tester.pump();
}

Future<void> _scrollDown(WidgetTester tester) async {
  final view = find.byType(CustomScrollView);
  for (var i = 0; i < 6; i++) {
    await tester.drag(view, const Offset(0, -500));
    await tester.pump();
  }
}

void main() {
  group('AgentScreen authority', () {
    final cases = {
      'killSwitch': (
        _with(killSwitch: true, liveTrading: false),
        'Kill switch engaged',
      ),
      'locked': (
        _with(liveTrading: false),
        'Live trading locked',
      ),
      'off': (
        _with(mode: TradingMode.off, liveTrading: true),
        'Research only',
      ),
      'approve': (
        _with(mode: TradingMode.approve, liveTrading: true),
        'Orders wait for you',
      ),
      'auto': (
        _with(mode: TradingMode.auto, liveTrading: true),
        'Auto: orders place themselves',
      ),
    };
    for (final entry in cases.entries) {
      testWidgets('headline for ${entry.key}', (tester) async {
        final h = await _start(tester, entry.value.$1);
        expect(find.text(entry.value.$2), findsOneWidget);
        _stopClock(h);
      });
    }

    testWidgets('capability list states what it can do', (tester) async {
      final h =
          await _start(tester, _with(mode: TradingMode.approve, liveTrading: true));
      expect(find.text('Research the market'), findsOneWidget);
      expect(find.text('Propose orders'), findsOneWidget);
      expect(find.text('Queue orders for approval'), findsOneWidget);
      expect(find.text('Place orders on Robinhood'), findsOneWidget);
      expect(find.text('Only after you approve'), findsOneWidget);
      _stopClock(h);
    });
  });

  group('AgentScreen panels', () {
    testWidgets('models panel shows lead and subagent specs', (tester) async {
      final h = await _start(tester, _fixture());
      await _reveal(tester, find.textContaining('gpt-6.1-sol'));
      // main: openai-codex/gpt-6.1-sol#xhigh, subagents: meta/muse-spark-1.3-contributor#xhigh
      expect(find.textContaining('gpt-6.1-sol'), findsOneWidget);
      expect(find.textContaining('openai-codex'), findsOneWidget);
      expect(find.textContaining('muse-spark-1.3-contributor'), findsOneWidget);
      expect(find.textContaining('meta'), findsWidgets);
      expect(find.textContaining('xhigh'), findsNWidgets(2));
      _stopClock(h);
    });

    testWidgets('connections panel and live countdown', (tester) async {
      final now = DateTime.now().millisecondsSinceEpoch;
      final h = await _start(
        tester,
        // Two minutes past the hour so the countdown text is stable.
        _with(nextCycleAt: now + (3 * 3600 + 120) * 1000),
      );
      await _reveal(tester, find.text('30m open · 240m closed'));
      expect(find.text('Connected'), findsOneWidget);
      expect(find.text('Market closed'), findsOneWidget);
      expect(find.textContaining('in 3h'), findsOneWidget);
      expect(find.text('Run now'), findsOneWidget);
      expect(find.text('30m open · 240m closed'), findsOneWidget);
      _stopClock(h);
    });

    testWidgets('run now calls the api with no confirmation', (tester) async {
      final api = FakeApi()..defaults();
      final status = _fixture();
      api.on('status', () async => status);
      api.on('runCycle', () async {});
      final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
      addTearDown(h.dispose);
      await tester.runAsync(h.start);
      await pumpScreen(tester, const AgentScreen(), harness: h);
      await tester.pump();
      await _reveal(tester, find.text('Run now'));
      await tester.tap(find.text('Run now'));
      await _settle(tester, h);
      expect(api.calls, contains('runCycle'));
      expect(
        h.toasts.where((t) => t.title == 'Cycle requested'),
        isNotEmpty,
      );
      _stopClock(h);
    });

    testWidgets('run now is disabled while the agent runs', (tester) async {
      final h = await _start(tester, _with(agentState: AgentState.running));
      await _reveal(tester, find.widgetWithText(TextButton, 'Run now'));
      final button = tester.widget<TextButton>(
        find.widgetWithText(TextButton, 'Run now'),
      );
      expect(button.onPressed, isNull);
      _stopClock(h);
    });

    testWidgets('run now shows a busy state while starting', (tester) async {
      final api = FakeApi()..defaults();
      api.on('status', () async => _fixture());
      final gate = Completer<void>();
      api.handlers['runCycle'] = (_) async {
        await gate.future;
        return null;
      };
      final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
      addTearDown(h.dispose);
      await tester.runAsync(h.start);
      await pumpScreen(tester, const AgentScreen(), harness: h);
      await tester.pump();
      await _reveal(tester, find.text('Run now'));
      await tester.tap(find.text('Run now'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsWidgets);
      gate.complete();
      await _settle(tester, h);
      _stopClock(h);
    });

    testWidgets('working subagents open their transcript', (tester) async {
      final now = DateTime.now().millisecondsSinceEpoch;
      final h = await _start(
        tester,
        _fixture(),
        subagents: [
          SubagentRun(
            id: 'c1',
            role: SubagentRole.bull,
            symbol: 'SPY',
            task: 'Check momentum into the close',
            startedAt: now - 5 * 60 * 1000,
            status: SubagentStatus.running,
          ),
          SubagentRun(
            id: 'h1',
            role: SubagentRole.researcher,
            name: 'earnings-watch',
            background: true,
            task: 'Watch the earnings calendar',
            startedAt: now - 60 * 60 * 1000,
            status: SubagentStatus.running,
            answer: 'Latest: all quiet on the calendar.',
          ),
        ],
      );
      await _reveal(tester, find.text('Bull on SPY'));
      expect(find.text('Bull on SPY'), findsOneWidget);
      expect(find.text('Check momentum into the close'), findsOneWidget);
      await _reveal(tester, find.text('earnings-watch · Researcher'));
      expect(find.text('earnings-watch · Researcher'), findsOneWidget);
      expect(find.text('Latest: all quiet on the calendar.'), findsOneWidget);
      expect(find.text('Working', skipOffstage: false), findsWidgets);
      await _reveal(tester, find.text('Check momentum into the close'));
      await tester.tap(find.text('Check momentum into the close'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(TranscriptPage), findsOneWidget);
      _stopClock(h);
    });

    testWidgets('recent decisions with a journal link', (tester) async {
      final h = await _start(tester, _fixture(), journal: _journalFixture());
      await _reveal(
        tester,
        find.text(
          'Quick status check: hold all positions, no new entries this cycle',
        ),
      );
      expect(
        find.text(
          'Quick status check: hold all positions, no new entries this cycle',
        ),
        findsOneWidget,
      );
      // "none" entries are recorded out of band, never shown as decisions.
      expect(find.textContaining('Settings changed'), findsNothing);
      await _reveal(tester, find.text('Open Journal and orders'));
      await tester.tap(find.text('Open Journal and orders'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(HistoryScreen), findsOneWidget);
      _stopClock(h);
    });
  });

  group('AgentScreen states', () {
    testWidgets('error shows the last error text', (tester) async {
      final h = await _start(
        tester,
        _with(agentState: AgentState.error, lastError: 'rate limited, retrying'),
      );
      expect(find.text('Error'), findsNothing); // below the fold, unbuilt
      await _reveal(tester, find.text('rate limited, retrying'));
      expect(find.text('Error'), findsOneWidget);
      expect(find.text('rate limited, retrying'), findsOneWidget);
      _stopClock(h);
    });

    testWidgets('needs login names the server-side step', (tester) async {
      final h = await _start(tester, _with(agentState: AgentState.needsLogin));
      await _reveal(tester, find.text('Needs login'));
      expect(find.text('Needs login'), findsWidgets);
      expect(
        find.textContaining('Run the login on the server'),
        findsOneWidget,
      );
      _stopClock(h);
    });

    testWidgets('loading reserves the loaded geometry', (tester) async {
      final api = FakeApi()..defaults();
      api.handlers['status'] = (_) => Completer<StatusResponse>().future;
      final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
      addTearDown(h.dispose);
      await pumpScreen(tester, const AgentScreen(), harness: h);
      await tester.pump();
      expect(find.byType(SkeletonBlock), findsWidgets);
      expect(find.text('Auto: orders place themselves'), findsNothing);
      _stopClock(h);
    });

    testWidgets('load error offers retry', (tester) async {
      final api = FakeApi()..defaults();
      var calls = 0;
      api.handlers['status'] = (_) async {
        calls++;
        if (calls == 1) throw const ApiError(500, 'boom');
        return _fixture();
      };
      final h = (await tester.runAsync(() => StoreHarness.create(api: api)))!;
      addTearDown(h.dispose);
      await tester.runAsync(h.start);
      await pumpScreen(tester, const AgentScreen(), harness: h);
      await tester.pump();
      expect(find.textContaining('boom'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await _settle(tester, h);
      expect(find.text('Auto: orders place themselves'), findsOneWidget);
      _stopClock(h);
    });

    testWidgets('offline keeps data under a stale banner', (tester) async {
      // The locator watches the real connectivity channel on first use;
      // keep that stream open and silent so dropping the event stream only
      // flips the harness connection.
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockStreamHandler(
        const EventChannel('dev.fluttercommunity.plus/connectivity_status'),
        MockStreamHandler.inline(
          onListen: (Object? args, MockStreamHandlerEventSink events) {},
        ),
      );
      final h = await _start(tester, _fixture());
      await tester.runAsync(() async {
        h.events.onClose();
        await h.pump();
      });
      await tester.pump();
      expect(find.textContaining('Offline'), findsOneWidget);
      expect(find.text('Auto: orders place themselves'), findsOneWidget);
      _stopClock(h);
    });
  });

  group('AgentScreen layout', () {
    testWidgets('360x640 at text scale 2.0 scrolls with no exceptions',
        (tester) async {
      final now = DateTime.now().millisecondsSinceEpoch;
      final h = await _start(
        tester,
        _with(nextCycleAt: now + 3 * 3600 * 1000),
        subagents: [
          SubagentRun(
            id: 'c1',
            role: SubagentRole.bull,
            symbol: 'SPY',
            task: 'Check momentum into the close',
            startedAt: now - 5 * 60 * 1000,
            status: SubagentStatus.running,
          ),
        ],
        journal: _journalFixture(),
        size: const Size(360, 640),
        textScale: 2.0,
      );
      await _scrollDown(tester);
      await tester.drag(
        find.byType(CustomScrollView),
        const Offset(0, 500),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      _stopClock(h);
    });

    testWidgets('840x900 wide layout shows both columns', (tester) async {
      final h = await _start(
        tester,
        _fixture(),
        journal: _journalFixture(),
        size: const Size(840, 900),
      );
      await tester.pump();
      await _reveal(tester, find.text('MODELS'));
      expect(find.text('MODELS'), findsOneWidget);
      await _reveal(tester, find.text('CONNECTIONS AND CYCLE'));
      expect(find.text('CONNECTIONS AND CYCLE'), findsOneWidget);
      expect(tester.takeException(), isNull);
      _stopClock(h);
    });
  });
}
