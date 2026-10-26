// Dart port of `apps/web/src/lib/control.ts`. Pure Dart: no Flutter imports.
import 'package:longbow/models/models.dart';

/// What the system may do right now. Precedence: kill switch, then the
/// server's live-trading lock, then the mode.
enum Authority { killed, locked, off, approve, auto }

Authority _authorityOf(TradingMode mode) => switch (mode) {
  TradingMode.off => Authority.off,
  TradingMode.approve => Authority.approve,
  TradingMode.auto => Authority.auto,
};

/// Provider, model and optional thinking level of a model spec string.
class ModelInfo {
  const ModelInfo({required this.provider, required this.model, this.thinking});

  final String provider;
  final String model;
  final String? thinking;

  @override
  bool operator ==(Object other) =>
      other is ModelInfo &&
      provider == other.provider &&
      model == other.model &&
      thinking == other.thinking;

  @override
  int get hashCode => Object.hash(provider, model, thinking);

  @override
  String toString() =>
      'ModelInfo(provider: $provider, model: $model, thinking: $thinking)';
}

/// "openai/gpt-5.5#high" becomes provider, model and thinking. Anything
/// unparseable keeps the whole spec as the model.
ModelInfo parseModelSpec(String spec) {
  final parts = spec.split('#');
  final path = parts[0];
  final thinking = parts.length > 1 ? parts[1] : null;
  final slash = path.indexOf('/');
  if (slash < 0) return ModelInfo(provider: '', model: path.isEmpty ? spec : path, thinking: thinking);
  return ModelInfo(
    provider: path.substring(0, slash),
    model: path.substring(slash + 1),
    thinking: thinking,
  );
}

enum CapabilityKey { research, propose, approve, place }

/// "yes": enabled right now. "gated": needs you or the lock. "no": blocked.
enum CapabilityState { yes, gated, no }

class Capability {
  const Capability({
    required this.key,
    required this.label,
    required this.state,
    required this.detail,
  });

  final CapabilityKey key;
  final String label;
  final CapabilityState state;
  final String detail;
}

class ControlState {
  const ControlState({
    required this.authority,
    required this.headline,
    required this.detail,
    required this.liveLocked,
    required this.killed,
    required this.capabilities,
  });

  final Authority authority;
  final String headline;
  final String detail;
  final bool liveLocked;
  final bool killed;
  final List<Capability> capabilities;
}

/// What the system may do right now, in one place. Precedence: kill switch,
/// then the server's live-trading lock, then the mode. A locked server never
/// reaches the broker whatever the mode says.
ControlState controlState(StatusResponse status) {
  final mode = status.settings.mode;
  final killed = status.settings.killSwitch;
  final liveLocked = !status.liveTrading;
  final brokerUp = status.broker.state == BrokerState.connected;

  final Authority authority;
  if (killed) {
    authority = Authority.killed;
  } else if (liveLocked) {
    authority = Authority.locked;
  } else {
    authority = _authorityOf(mode);
  }

  const copy = {
    Authority.killed: (
      'Kill switch engaged',
      'No order of any kind is sent. Research cycles keep running.',
    ),
    Authority.locked: (
      'Live trading locked',
      'The broker is read-only. Orders are risk-checked and recorded, never sent.',
    ),
    Authority.off: (
      'Research only',
      'The agent reads and reasons. It does not propose orders.',
    ),
    Authority.approve: (
      'Orders wait for you',
      'Each risk-approved order is queued until you approve it.',
    ),
    Authority.auto: (
      'Auto: orders place themselves',
      'Risk-approved orders go to Robinhood without waiting for you.',
    ),
  };
  final headline = copy[authority]!.$1;
  final detail = copy[authority]!.$2;

  final canTrade = !killed && !liveLocked && brokerUp;
  return ControlState(
    authority: authority,
    headline: headline,
    detail: detail,
    liveLocked: liveLocked,
    killed: killed,
    capabilities: [
      const Capability(
        key: CapabilityKey.research,
        label: 'Research the market',
        state: CapabilityState.yes,
        detail: 'Always on, read-only',
      ),
      Capability(
        key: CapabilityKey.propose,
        label: 'Propose orders',
        state: killed
            ? CapabilityState.no
            : mode == TradingMode.off
                ? CapabilityState.no
                : CapabilityState.yes,
        detail: killed
            ? 'Blocked by the kill switch'
            : mode == TradingMode.off
                ? 'Mode is Off'
                : 'Checked by the risk engine first',
      ),
      Capability(
        key: CapabilityKey.approve,
        label: 'Queue orders for approval',
        state: killed || mode == TradingMode.off
            ? CapabilityState.no
            : mode == TradingMode.approve
                ? CapabilityState.yes
                : CapabilityState.gated,
        detail: mode == TradingMode.approve
            ? 'You decide each one'
            : mode == TradingMode.auto
                ? 'Skipped in Auto'
                : 'Mode is Off',
      ),
      Capability(
        key: CapabilityKey.place,
        label: 'Place orders on Robinhood',
        state: !canTrade || mode == TradingMode.off
            ? CapabilityState.no
            : mode == TradingMode.auto
                ? CapabilityState.yes
                : CapabilityState.gated,
        detail: killed
            ? 'Blocked by the kill switch'
            : liveLocked
                ? 'Live trading is locked on the server'
                : !brokerUp
                    ? 'Robinhood is not connected'
                    : mode == TradingMode.auto
                        ? 'Immediately after the risk check'
                        : mode == TradingMode.approve
                            ? 'Only after you approve'
                            : 'Mode is Off',
      ),
    ],
  );
}
