import 'package:longbow/models/models.dart';

/// Plain wording for each halt reason (port of HaltBanner.svelte).
const Map<HaltReason, String> haltWords = {
  HaltReason.killSwitch: 'Kill switch is engaged. No orders will be placed.',
  HaltReason.modeOff: 'Mode is Off. The agent only researches.',
  HaltReason.dailyLoss: 'Daily loss limit reached. New entries are paused until the next session.',
  HaltReason.drawdown: 'Monthly drawdown limit reached. New entries stay halted until you re-arm.',
  HaltReason.brokerDisconnected: 'Robinhood is not connected. Nothing can trade.',
};

/// Countdown for pills: drops seconds above one minute so the header does not
/// reflow every tick. Falls back to seconds under a minute.
String coarseCountdown(int ms) {
  final total = ms <= 0 ? 0 : ms ~/ 1000;
  final d = total ~/ 86400;
  final h = (total % 86400) ~/ 3600;
  final m = (total % 3600) ~/ 60;
  if (d > 0) return '${d}d ${h}h';
  if (h > 0) return '${h}h ${m}m';
  if (m > 0) return '${m}m';
  return '${total}s';
}

String sessionLabel(MarketSession session) => switch (session) {
      MarketSession.regular => 'Market open',
      MarketSession.pre => 'Pre-market',
      MarketSession.post => 'After hours',
      MarketSession.closed => 'Market closed',
    };

/// "Closes in" while open (or "Early close in"), otherwise "Opens in", with
/// the epoch-ms instant it counts down to.
({String verb, int at}) sessionNext(MarketClock market) => market.isOpen
    ? (verb: market.earlyClose ? 'Early close in' : 'Closes in', at: market.nextClose)
    : (verb: 'Opens in', at: market.nextOpen);

String agentLabel(AgentState state) => switch (state) {
      AgentState.idle => 'Agent idle',
      AgentState.running => 'Agent working',
      AgentState.error => 'Agent error',
      AgentState.needsLogin => 'Agent needs login',
    };

String brokerLabel(BrokerState state) => switch (state) {
      BrokerState.connected => 'Connected',
      BrokerState.disconnected => 'Not connected',
      BrokerState.needsAuth => 'Sign-in needed',
      BrokerState.connecting => 'Connecting',
      BrokerState.error => 'Error',
    };

bool brokerNeedsConnect(BrokerState state) =>
    state == BrokerState.disconnected || state == BrokerState.needsAuth || state == BrokerState.error;

String modeLabel(TradingMode mode) => switch (mode) {
      TradingMode.off => 'Off',
      TradingMode.approve => 'Approve',
      TradingMode.auto => 'Auto',
    };
