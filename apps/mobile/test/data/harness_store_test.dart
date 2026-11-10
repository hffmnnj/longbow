import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/api/harness_api.dart';
import 'package:longbow/data/state/harness_store.dart';
import 'package:longbow/data/state/toast.dart';
import 'package:longbow/models/models.dart';

import 'fake_api.dart';
import 'model_builders.dart';

void main() {
  group('HarnessStore', () {
    test('refresh merges REST with SSE that arrives mid-refresh instead of wiping it', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('messages', () async => [testMessage('m1')]);
      await h.start();

      final gate = Completer<List<ChatMessage>>();
      h.api.handlers['messages'] = (_) => gate.future;
      final refreshing = h.notifier.refresh();
      // Let the gated fetch stay in flight while the event stream delivers.
      await h.pump(5);
      h.events.onEvent(MessageEvent(testMessage('sse-1', at: 2)));
      await h.pump();
      expect(h.state.feed.messages.map((m) => m.id), contains('sse-1'));

      // The snapshot predates the SSE event; the reconcile must keep both.
      gate.complete([testMessage('m1')]);
      await refreshing;
      await h.pump();
      expect(h.state.feed.messages.map((m) => m.id), containsAll(['m1', 'sse-1']));
    });

    test('refresh lets the fetch update records nothing touched mid-flight', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('orders',
          () async => [testOrder('o1', status: OrderStatus.pendingApproval)]);
      await h.start();
      expect(h.state.feed.orders.single.status, OrderStatus.pendingApproval);

      h.api.on('orders',
          () async => [testOrder('o1', status: OrderStatus.filled)]);
      await h.notifier.refresh();
      await h.pump();
      expect(h.state.feed.orders.single.status, OrderStatus.filled);
    });

    test('refresh keeps a mid-flight SSE order update over the older response', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('orders',
          () async => [testOrder('o1', status: OrderStatus.pendingApproval)]);
      await h.start();

      final gate = Completer<List<OrderRecord>>();
      h.api.handlers['orders'] = (_) => gate.future;
      final refreshing = h.notifier.refresh();
      await h.pump(5);
      // The stream replaces the order while the older snapshot is in flight.
      h.events.onEvent(OrderEvent(
          testOrder('o1', status: OrderStatus.rejectedUser, createdAt: 1)));
      await h.pump();
      gate.complete([testOrder('o1', status: OrderStatus.submitted)]);
      await refreshing;
      await h.pump();
      expect(h.state.feed.orders.single.status, OrderStatus.rejectedUser);
    });

    test('refresh marks loaded once messages settle while other reads hang', () async {
      final api = FakeApi()..defaults();
      final gate = Completer<List<OrderRecord>>();
      api.handlers['orders'] = (_) => gate.future;
      api.on('messages', () async => [testMessage('m1')]);
      final h = await StoreHarness.create(api: api);
      addTearDown(h.dispose);
      // The provider listener starts the first refresh on its own; only the
      // gated orders fetch is still in flight.
      await h.pump(10);

      expect(h.state.loaded, isTrue);
      expect(h.state.feed.messages.map((m) => m.id), contains('m1'));

      gate.complete(const []);
      await h.pump(10);
      expect(h.state.loadError, isNull);
      expect(h.state.loaded, isTrue);
    });

    test('stopped refresh drops its late response', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('messages', () async => [testMessage('m1')]);
      await h.start();

      final gate = Completer<List<ChatMessage>>();
      h.api.handlers['messages'] = (_) => gate.future;
      final refreshing = h.notifier.refresh();
      await h.pump(5);
      h.notifier.stop();
      gate.complete([testMessage('m2')]);
      await refreshing;
      await h.pump();
      expect(h.state.feed.messages.map((m) => m.id), ['m1']);
    });

    test('same API reattachment does not join the old refresh or publish its late response',
        () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('messages', () async => [testMessage('m1')]);
      await h.start();
      expect(h.state.feed.messages.map((m) => m.id), ['m1']);

      final gate = Completer<List<ChatMessage>>();
      h.api.handlers['messages'] = (_) => gate.future;
      final stale = h.notifier.refresh();
      await h.pump(5);
      final callsBefore = h.api.count('messages');

      // Stop and reattach the SAME FakeApi object: the old task must not be
      // joined and its late response must not leak into the new connection.
      h.notifier.stop();
      h.api.on('messages', () async => [testMessage('m2')]);
      await h.notifier.start();
      await h.pump();
      expect(h.state.feed.messages.map((m) => m.id), contains('m2'));
      expect(h.api.count('messages'), greaterThan(callsBefore));

      gate.complete([testMessage('stale')]);
      await stale;
      await h.pump();
      expect(h.state.feed.messages.map((m) => m.id), contains('m2'));
      expect(h.state.feed.messages.map((m) => m.id), isNot(contains('stale')));
    });

    test('primary messages failure surfaces loadError while orders still hang',
        () async {
      final api = FakeApi()..defaults();
      final ordersGate = Completer<List<OrderRecord>>();
      api.handlers['orders'] = (_) => ordersGate.future;
      api.fail('messages', const ApiError(500, 'history down'));
      final h = await StoreHarness.create(api: api);
      addTearDown(h.dispose);
      await h.pump(10);

      expect(h.state.loaded, isTrue);
      expect(h.state.loadError, 'history down');

      ordersGate.complete(const []);
      await h.pump(10);
      expect(h.state.loaded, isTrue);
      expect(h.state.loadError, 'history down');
    });

    test('overlapping refreshes join instead of racing', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      await h.start();
      final gate = Completer<List<ChatMessage>>();
      h.api.handlers['messages'] = (_) => gate.future;
      // A second refresh while the first is still in flight joins it: the
      // messages endpoint is hit once, not once per caller.
      final first = h.notifier.refresh();
      final second = h.notifier.refresh();
      await h.pump(5);
      gate.complete([testMessage('m1')]);
      await first;
      await second;
      await h.pump();
      expect(h.api.count('messages'), 2);
      expect(h.state.feed.messages.map((m) => m.id), ['m1']);
    });

    test('initial refresh populates the feed and loads sim runs', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('messages', () async => [testMessage('m1')]);
      h.api.on('journal', () async => [testEntry('j1')]);
      h.api.on('orders', () async => [testOrder('o1')]);
      h.api.on('simRuns', () async => [testRun('r1')]);
      await h.start();

      expect(h.state.loaded, isTrue);
      expect(h.state.loadError, isNull);
      expect(h.state.feed.messages.map((m) => m.id), ['m1']);
      expect(h.state.feed.journal.map((j) => j.id), ['j1']);
      expect(h.state.feed.orders.map((o) => o.id), ['o1']);
      expect(h.state.feed.status?.agent.model, 'main');
      expect(h.state.connection, ConnectionStatus.connecting);
      h.events.onOpen();
      await h.pump();
      expect(h.state.connection, ConnectionStatus.live);
      expect(h.sim.runs.map((r) => r.id), ['r1']);
      expect(h.events.baseUrl.toString(),
          'https://longbow.example.ts.net:8443');
    });

    test('folds events into the feed and routes sim events away', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      await h.start();

      h.events.onEvent(StatusEvent(testStatus(agentState: AgentState.running)));
      h.events.onEvent(MessageEvent(testMessage('m1')));
      await h.pump();
      expect(h.state.feed.status?.agent.state, AgentState.running);
      expect(h.state.feed.messages.map((m) => m.id), ['m1']);

      h.events.onEvent(
          MessageEvent(testMessage('sm1'), simRunId: 'run-1'));
      h.events.onEvent(SimEvent(testRun('run-1')));
      await h.pump();
      expect(h.state.feed.messages.map((m) => m.id), ['m1']);
      expect(h.simStore.feed('run-1').messages.map((m) => m.id), ['sm1']);
      expect(h.sim.runs.map((r) => r.id), ['run-1']);
    });

    test('stale-while-revalidate fetches once until forced', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on(
          'equity',
          () async => const EquityHistory(
              points: [], holdingsReplay: []));
      await h.start();

      await h.notifier.loadEquity(AnalyticsRange.threeMonths);
      await h.notifier.loadEquity(AnalyticsRange.threeMonths);
      await h.pump();
      expect(h.api.count('equity'), 1);
      expect(h.state.equity['3m']?.state, LoadState.ready);

      await h.notifier
          .loadEquity(AnalyticsRange.threeMonths, force: true);
      await h.pump();
      expect(h.api.count('equity'), 2);
    });

    test('send shows the message at once and drops it after the TTL',
        () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('sendMessage', () async => null);
      await h.start();

      await h.notifier.send('hello');
      expect(h.state.feed.outbox.map((o) => o.text), ['hello']);
      await h.pump();
      expect(h.state.feed.outbox, isEmpty);
    });

    test('send failure marks the outbox entry; retry replaces it', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.fail('sendMessage', const ApiError(400, 'bad'));
      await h.start();

      await h.notifier.send('hello');
      await h.pump();
      expect(h.state.feed.outbox, hasLength(1));
      expect(h.state.feed.outbox.single.failed, isTrue);
      expect(
          h.toasts.where((t) => t.tone == ToastTone.error),
          hasLength(1));
      expect(h.toasts.single.title, 'bad');

      final failedId = h.state.feed.outbox.single.id;
      await h.notifier.send('hello again', retryId: failedId);
      await h.pump();
      expect(h.state.feed.outbox, hasLength(1));
      expect(h.state.feed.outbox.single.id, isNot(failedId));
      expect(h.state.feed.outbox.single.failed, isTrue);
    });

    test('approve and reject track busy flags; failures toast', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      final gate = Completer<OrderRecord>();
      h.api.handlers['approve'] = (_) => gate.future;
      h.api.fail('reject', const ApiError(400, 'nope'));
      await h.start();

      final approving = h.notifier.approve('o1');
      await h.pump();
      expect(h.state.busy['order:o1'], isTrue);
      gate.complete(testOrder('o1'));
      await approving;
      await h.pump();
      expect(h.state.busy['order:o1'], isFalse);

      await h.notifier.reject('o2', 'too big');
      await h.pump();
      expect(h.state.busy['order:o2'], isFalse);
      final toast = h.toasts.last;
      expect(toast.tone, ToastTone.error);
      expect(toast.title, 'Could not reject the order');
      expect(toast.body, 'nope');
    });

    test('offline to live recovery refreshes', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      await h.start();
      expect(h.api.count('status'), 1);

      h.events.onClose();
      await h.pump();
      expect(h.state.connection, ConnectionStatus.offline);

      h.events.onOpen();
      await h.pump();
      await h.pump();
      expect(h.state.connection, ConnectionStatus.live);
      expect(h.api.count('status'), 2);
    });

    test('offline launch shows the cached account until a live status',
        () async {
      final h = await StoreHarness.create(prefs: {
        'status.cache': jsonEncode({
          'at': 7,
          'status': testStatusJson(agentState: 'running'),
        }),
      });
      addTearDown(h.dispose);
      h.api.fail('status', const ApiError(0, 'Cannot reach'));
      await h.start();

      expect(h.state.feed.status?.account?.equity, 1200);
      expect(h.state.cachedAt, 7);
      expect(h.state.loaded, isTrue);
      expect(h.state.loadError, isNotNull);

      h.api.on('status', () async => testStatus());
      await h.notifier.refreshStatus();
      await h.pump();
      expect(h.state.cachedAt, isNull);
    });

    test('derived providers summarize the feed', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      final now = DateTime.now().millisecondsSinceEpoch;
      h.api.on('status',
          () async => testStatus(halts: const [HaltReason.killSwitch]));
      h.api.on('orders', () async => [
            testOrder('pending', createdAt: now),
            testOrder('failed',
                status: OrderStatus.failed, createdAt: now),
          ]);
      h.api.on('journal',
          () async => [testEntry('j1', symbol: 'AAPL')]);
      h.api.on('reports',
          () async => [testReport('r1', at: 2), testReport('r2', at: 1)]);
      await h.start();
      await h.notifier.loadReports();
      await h.pump();

      final c = h.container;
      expect(
          c.read(pendingOrdersProvider).map((o) => o.id), ['pending']);
      expect(c.read(alertsCountProvider), 2);
      expect(c.read(positionsProvider).map((p) => p.symbol), ['SPY']);
      expect(c.read(agentRunningProvider), isFalse);
      expect(c.read(knownSymbolsProvider), containsAll(['SPY', 'AAPL']));
      expect(c.read(latestReportProvider)?.id, 'r1');
    });

    test('loadHistory fetches once; retryHistory refetches', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on(
          'history',
          () async => const PriceHistory(
              symbol: 'SPY', bars: [], source: 't', asOf: 1));
      await h.start();

      await h.notifier.loadHistory('SPY', HistoryRange.sixMonths);
      await h.notifier.loadHistory('SPY', HistoryRange.sixMonths);
      await h.pump();
      expect(h.api.count('history'), 1);

      h.notifier.retryHistory('SPY', HistoryRange.sixMonths);
      await h.pump();
      await h.pump();
      expect(h.api.count('history'), 2);
    });

    test('loadDoc caches markdown and refetches on force', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on(
          'note',
          () async => const NoteContent(
              path: 'n.md', content: '# hi', updatedAt: 1));
      await h.start();

      await h.notifier.loadDoc('note', 'n.md');
      await h.notifier.loadDoc('note', 'n.md');
      await h.pump();
      expect(h.api.count('note'), 1);
      expect(h.state.docs['note:n.md']?.data, '# hi');

      await h.notifier.loadDoc('note', 'n.md', true);
      await h.pump();
      expect(h.api.count('note'), 2);
    });

    test('connect and disconnect Robinhood', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('connectUrl',
          () async => const ConnectResponse(url: 'https://rh/signin'));
      h.api.on('disconnect', () async => null);
      await h.start();

      expect(await h.notifier.connectRobinhood(), 'https://rh/signin');
      await h.notifier.disconnectRobinhood();
      await h.pump();
      expect(h.toasts.last.title, 'Robinhood disconnected');
      expect(h.api.count('status'), greaterThan(1));
    });

    test('patchSettings throws; quickPatch toasts on success', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.fail('patchSettings', const ApiError(400, 'bad risk'));
      await h.start();

      await expectLater(
        h.notifier.patchSettings(const SettingsPatch(mode: TradingMode.off)),
        throwsA(isA<ApiError>()),
      );
      expect(h.toasts, isEmpty);

      h.api.on('patchSettings', () async => defaultSettings);
      final ok = await h.notifier.quickPatch(
          'mode', const SettingsPatch(mode: TradingMode.off), 'Saved');
      await h.pump();
      expect(ok, isTrue);
      expect(h.toasts.last.title, 'Saved');
    });

    test('report events toast with an open action; note events reload',
        () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on(
          'note',
          () async => const NoteContent(
              path: 'n.md', content: '# hi', updatedAt: 1));
      await h.start();

      h.events.onEvent(ReportEvent(testReport('r9')));
      await h.pump();
      final toast = h.toasts.last;
      expect(toast.tone, ToastTone.success);
      expect(toast.title, 'Daily report ready');
      expect(toast.actionLabel, 'Open');
      expect(toast.reportId, 'r9');

      // No cached doc: nothing to reload.
      h.events.onEvent(
          const NoteEvent(NoteFile(path: 'n.md', size: 1, updatedAt: 1)));
      await h.pump();
      expect(h.api.count('note'), 0);

      await h.notifier.loadDoc('note', 'n.md');
      h.events.onEvent(
          const NoteEvent(NoteFile(path: 'n.md', size: 2, updatedAt: 2)));
      await h.pump();
      await h.pump();
      expect(h.api.count('note'), 2);
    });
  });
}
