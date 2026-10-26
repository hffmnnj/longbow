import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/data/api/harness_api.dart';
import 'package:longbow/data/state/sim_store.dart';
import 'package:longbow/models/models.dart';

import 'fake_api.dart';
import 'model_builders.dart';

void main() {
  group('SimStore', () {
    test('loadRuns sorts newest first and merges live runs', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('simRuns', () async => [
            testRun('old', createdAt: 1),
            testRun('new', createdAt: 9),
          ]);
      h.api.on('simSuites', () async => [testSuite('s1')]);
      await h.start();

      expect(h.sim.runs.map((r) => r.id), ['new', 'old']);
      expect(h.sim.suites.map((s) => s.id), ['s1']);
      expect(h.sim.loaded, isTrue);
      expect(h.sim.loadError, isNull);

      // A live event for a run the fetched list does not know survives the
      // next fetch instead of being dropped.
      h.events.onEvent(SimEvent(testRun('live', createdAt: 5)));
      await h.pump();
      await h.container.read(simProvider.notifier).loadRuns();
      await h.pump();
      expect(h.sim.runs.map((r) => r.id), ['new', 'live', 'old']);
    });

    test('sim events upsert runs, suites, and per-run feeds', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      await h.start();

      h.events.onEvent(SimEvent(testRun('r1', createdAt: 5)));
      h.events.onEvent(
          MessageEvent(testMessage('m1'), simRunId: 'r1'));
      h.events
          .onEvent(DeltaEvent('hi', simRunId: 'r1'));
      h.events.onEvent(SimSuiteEvent(testSuite('s1')));
      await h.pump();

      expect(h.sim.runs.map((r) => r.id), ['r1']);
      expect(h.simStore.feed('r1').messages.map((m) => m.id), ['m1']);
      expect(h.simStore.feed('r1').draft, 'hi');
      expect(h.sim.suites.map((s) => s.id), ['s1']);
      // The live feed never sees simulation events.
      expect(h.state.feed.messages, isEmpty);
      expect(h.state.feed.draft, '');
      // Families serve the same data to screens.
      expect(h.container.read(simRunProvider('r1'))?.id, 'r1');
      expect(h.container.read(simFeedProvider('r1')).draft, 'hi');
      expect(h.container.read(simFeedProvider('missing')).messages, isEmpty);
    });

    test('loadFeed fetches once and streams keep it current', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('simMessages', () async => [testMessage('m1')]);
      h.api.on('simJournal', () async => [testEntry('j1')]);
      h.api.on('simOrders', () async => [testOrder('o1')]);
      await h.start();
      final sim = h.container.read(simProvider.notifier);

      await sim.loadFeed('r1');
      await sim.loadFeed('r1');
      await h.pump();
      expect(h.api.count('simMessages'), 1);
      expect(h.simStore.feed('r1').messages.map((m) => m.id), ['m1']);
      expect(h.simStore.feed('r1').journal.map((j) => j.id), ['j1']);
      expect(h.simStore.feed('r1').orders.map((o) => o.id), ['o1']);

      await sim.loadFeed('r1', true);
      await h.pump();
      expect(h.api.count('simMessages'), 2);
    });

    test('start returns the run; refusal returns the error', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      await h.start();
      final sim = h.container.read(simProvider.notifier);

      h.api.on('simStart',
          () async => testRun('n1', createdAt: 9));
      final config =
          const SimRunConfig(days: 10, startingCash: 1200, cyclesPerDay: 2);
      final created = await sim.start(config);
      await h.pump();
      expect(created.run?.id, 'n1');
      expect(created.error, isNull);
      expect(h.sim.runs.map((r) => r.id), contains('n1'));
      expect(h.sim.starting, isFalse);

      h.api.fail('simStart', const ApiError(400, 'bad config'));
      final refused = await sim.start(config);
      expect(refused.run, isNull);
      expect(refused.error, 'bad config');
    });

    test('stop updates the run and toasts', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      h.api.on('simRuns', () async => [testRun('r1', createdAt: 3)]);
      h.api.on('simStop', () async => testRun('r1', createdAt: 3));
      await h.start();
      await h.container.read(simProvider.notifier).loadRuns();
      await h.pump();

      await h.container.read(simProvider.notifier).stop('r1');
      await h.pump();
      expect(h.toasts.last.title, 'Stopping simulation');
    });

    test('compare selection toggles and clears', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      await h.start();
      final compare = h.container.read(simCompareProvider.notifier);

      compare.toggle('a');
      compare.toggle('b');
      compare.toggle('a');
      expect(h.container.read(simCompareProvider), {'b'});
      compare.clear();
      expect(h.container.read(simCompareProvider), isEmpty);
    });

    test('loadScenarios fetches once and fails soft', () async {
      final h = await StoreHarness.create();
      addTearDown(h.dispose);
      await h.start();
      final sim = h.container.read(simProvider.notifier);

      h.api.fail('simScenarios', const ApiError(500, 'down'));
      await sim.loadScenarios();
      await sim.loadScenarios();
      await h.pump();
      expect(h.api.count('simScenarios'), 1);
      expect(h.sim.scenarios, isEmpty);
      expect(h.sim.scenariosLoaded, isTrue);
    });
  });
}
