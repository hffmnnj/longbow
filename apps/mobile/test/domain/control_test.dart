import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/domain/control.dart';
import 'package:longbow/models/models.dart';

StatusResponse _status({
  TradingMode mode = TradingMode.approve,
  bool killSwitch = false,
  bool liveTrading = true,
  BrokerState broker = BrokerState.connected,
}) {
  return StatusResponse(
    agent: const AgentStatus(state: AgentState.idle, model: 'm'),
    broker: BrokerStatus(state: broker, tools: const []),
    market: const MarketClock(
      now: 1,
      session: MarketSession.regular,
      isOpen: true,
      tradingDay: '2026-10-23',
      nextOpen: 2,
      nextClose: 3,
      earlyClose: false,
    ),
    settings: defaultSettings.copyWith(mode: mode, killSwitch: killSwitch),
    account: null,
    halts: const [],
    liveTrading: liveTrading,
    models: const ModelsInfo(main: 'm', subagents: 's'),
  );
}

Capability _cap(ControlState s, CapabilityKey key) =>
    s.capabilities.singleWhere((c) => c.key == key);

void main() {
  test('control_lockedServerRefusesPlacementEvenInAuto', () {
    final s = controlState(_status(mode: TradingMode.auto, liveTrading: false));

    expect(s.authority, Authority.locked);
    expect(s.headline, 'Live trading locked');
    expect(_cap(s, CapabilityKey.place).state, CapabilityState.no);
    expect(_cap(s, CapabilityKey.propose).state, CapabilityState.yes);
  });

  test('control_killSwitchOutranksLockAndBlocksProposals', () {
    final s = controlState(
      _status(mode: TradingMode.auto, liveTrading: false, killSwitch: true),
    );

    expect(s.authority, Authority.killed);
    expect(s.liveLocked, isTrue);
    expect(_cap(s, CapabilityKey.propose).state, CapabilityState.no);
  });

  test('control_approveQueuesOrdersForTheHuman', () {
    final s = controlState(_status(mode: TradingMode.approve));

    expect(s.authority, Authority.approve);
    expect(_cap(s, CapabilityKey.approve).state, CapabilityState.yes);
    expect(
      _cap(s, CapabilityKey.place).state,
      CapabilityState.gated,
    );
    expect(_cap(s, CapabilityKey.place).detail, 'Only after you approve');
  });

  test('control_autoPlacesWhenLockOpenAndBrokerUp', () {
    final s = controlState(_status(mode: TradingMode.auto));

    expect(s.authority, Authority.auto);
    expect(_cap(s, CapabilityKey.place).state, CapabilityState.yes);
  });

  test('control_disconnectedBrokerBlocksPlacementWithReason', () {
    final place = _cap(
      controlState(_status(mode: TradingMode.auto, broker: BrokerState.disconnected)),
      CapabilityKey.place,
    );

    expect(place.state, CapabilityState.no);
    expect(place.detail, 'Robinhood is not connected');
  });

  test('control_offIsResearchOnly', () {
    final s = controlState(_status(mode: TradingMode.off));

    expect(s.authority, Authority.off);
    expect(_cap(s, CapabilityKey.propose).state, CapabilityState.no);
  });

  test('control_parseModelSpecSplitsProviderModelAndThinking', () {
    expect(
      parseModelSpec('openai/gpt-5.5#high'),
      const ModelInfo(provider: 'openai', model: 'gpt-5.5', thinking: 'high'),
    );
  });

  test('control_parseModelSpecKeepsSlashesAndToleratesNoProvider', () {
    expect(
      parseModelSpec('openrouter/meta/llama-4'),
      const ModelInfo(
        provider: 'openrouter',
        model: 'meta/llama-4',
        thinking: null,
      ),
    );
    expect(
      parseModelSpec('muse-spark'),
      const ModelInfo(provider: '', model: 'muse-spark', thinking: null),
    );
  });
}
