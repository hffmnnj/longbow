import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/domain/control.dart';
import 'package:longbow/domain/roles.dart';
import 'package:longbow/features/control/agent_icons.dart';
import 'package:longbow/features/control/kill_switch.dart';
import 'package:longbow/features/control/mode_control.dart';
import 'package:longbow/features/control/system_one_control.dart';
import 'package:longbow/features/feed/decision_card.dart';
import 'package:longbow/features/history/history_screen.dart';
import 'package:longbow/features/shared/shared.dart';
import 'package:longbow/models/models.dart';

const _brokerLabels = {
  BrokerState.connected: 'Connected',
  BrokerState.disconnected: 'Not connected',
  BrokerState.needsAuth: 'Sign-in needed',
  BrokerState.connecting: 'Connecting',
  BrokerState.error: 'Error',
};

const _sessionLabels = {
  MarketSession.regular: 'Market open',
  MarketSession.pre: 'Pre-market',
  MarketSession.post: 'After hours',
  MarketSession.closed: 'Market closed',
};

const _agentLabels = {
  AgentState.idle: 'Idle',
  AgentState.running: 'Working',
  AgentState.error: 'Error',
  AgentState.needsLogin: 'Needs login',
};

const _haltLabels = {
  HaltReason.killSwitch: 'Kill switch engaged',
  HaltReason.modeOff: 'Mode is Off',
  HaltReason.dailyLoss: 'Daily limit reached',
  HaltReason.drawdown: 'Monthly drawdown halt',
  HaltReason.brokerDisconnected: 'Robinhood disconnected',
};

const _cycleLabels = {
  CycleKind.preOpen: 'Pre-open',
  CycleKind.intraday: 'Intraday',
  CycleKind.postClose: 'Post-close',
  CycleKind.overnight: 'Overnight',
  CycleKind.manual: 'Manual',
};

/// The Agent tab: what the system may do right now, the fleet's models,
/// connections and cycle, the running subagents and helpers, and what the
/// agent just decided. A bottom-tab root (the shell draws the header), so
/// there is no app bar here.
class AgentScreen extends ConsumerWidget {
  const AgentScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final meta = ref.watch(harnessProvider.select(
      (s) => (s.loaded, s.loadError, s.connection),
    ));
    final store = ref.read(harnessProvider.notifier);

    if (status == null) {
      return LbTabBody.children(
        onRefresh: store.refresh,
        children: [
          if (meta.$3 == ConnectionStatus.offline) const StaleBanner(),
          if (meta.$2 != null)
            ErrorState(message: meta.$2!, onRetry: store.refresh)
          else ...[
            LbCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SkeletonBlock(height: 20, width: 200),
                  const SizedBox(height: 8),
                  const SkeletonLines(lines: 2),
                  const SizedBox(height: LbSpace.gap),
                  const SkeletonBlock(height: kMinTarget),
                  const SizedBox(height: LbSpace.gap),
                  ...List.generate(
                    4,
                    (_) => const Padding(
                      padding: EdgeInsets.symmetric(vertical: 6),
                      child: SkeletonBlock(height: 14),
                    ),
                  ),
                ],
              ),
            ),
            const Panel(title: 'Models', child: SkeletonLines(lines: 2)),
            const Panel(title: 'Connections and cycle', child: SkeletonLines(lines: 4)),
          ],
        ],
      );
    }

    final state = controlState(status);
    final subagents = ref.watch(harnessProvider.select((s) => s.feed.subagents));
    final journal = ref.watch(harnessProvider.select((s) => s.feed.journal));
    final running = subagents
        .where((r) => r.background != true && r.status == SubagentStatus.running)
        .toList();
    final helpers = subagents.where((r) => r.background == true).toList();
    final recent = journal.where((j) => j.action != JournalAction.none).take(4).toList();
    final offline = meta.$3 == ConnectionStatus.offline;

    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 840;
        final authority = _AuthorityCard(state: state, status: status);
        final models = _ModelsPanel(status: status);
        final connections = _ConnectionsPanel(status: status);
        final working = _WorkingPanel(runs: running);
        final helpersPanel = _HelpersPanel(helpers: helpers);
        final recentPanel = _RecentPanel(entries: recent);
        return LbTabBody.children(
          onRefresh: store.refresh,
          children: [
            if (offline) const StaleBanner(),
            authority,
            if (wide)
              _TwoColumn(left: models, right: connections)
            else ...[models, connections],
            if (wide)
              _TwoColumn(left: working, right: helpersPanel)
            else ...[working, helpersPanel],
            recentPanel,
          ],
        );
      },
    );
  }
}

class _TwoColumn extends StatelessWidget {
  const _TwoColumn({required this.left, required this.right});

  final Widget left;
  final Widget right;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: left),
        const SizedBox(width: LbSpace.gap),
        Expanded(child: right),
      ],
    );
  }
}

class _AuthorityCard extends StatelessWidget {
  const _AuthorityCard({required this.state, required this.status});

  final ControlState state;
  final StatusResponse status;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final killed = state.authority == Authority.killed;
    final auto = state.authority == Authority.auto;
    return LbCard(
      borderColor: killed ? c.destructive : (auto ? c.warn : null),
      color: killed ? Color.alphaBlend(c.destructive.withValues(alpha: 0.08), c.card) : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: killed
                      ? c.destructive
                      : auto
                          ? c.warnBg
                          : c.secondary,
                  borderRadius: BorderRadius.circular(LbRadius.md),
                ),
                child: LbIcon(
                  killed ? LbIcons.power : LbIcons.lock,
                  color: killed
                      ? c.primaryForeground
                      : auto
                          ? c.warn
                          : c.foreground,
                ),
              ),
              const SizedBox(width: LbSpace.gap),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      header: true,
                      child: Text(state.headline, style: Theme.of(context).textTheme.titleMedium),
                    ),
                    const SizedBox(height: 2),
                    Text(state.detail, style: LbText.muted(context)),
                    if (state.liveLocked && state.authority == Authority.killed)
                      Text('Live trading is also locked on the server.', style: LbText.muted(context)),
                    if (state.authority == Authority.locked)
                      Text(
                        'Mode is ${switch (status.settings.mode) { TradingMode.off => 'Off', TradingMode.approve => 'Approve', TradingMode.auto => 'Auto' }}, but the server lock overrides it.',
                        style: LbText.muted(context),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: LbSpace.gap),
          const KillSwitchButton(),
          const SizedBox(height: LbSpace.gap),
          const SectionLabel('Mode'),
          const SizedBox(height: 4),
          const ModeControl(),
          const SizedBox(height: LbSpace.gap),
          const SectionLabel('System One'),
          const SizedBox(height: 4),
          const SystemOneControl(),
          const SizedBox(height: LbSpace.gap),
          const SectionLabel('What it can do right now'),
          const SizedBox(height: 4),
          ...state.capabilities.map((cap) => _CapabilityRow(cap: cap)),
          if (status.halts.isNotEmpty) ...[
            const SizedBox(height: LbSpace.gap),
            Semantics(
              label: 'Active halts',
              container: true,
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final h in status.halts)
                    StatusChip(_haltLabels[h]!, tone: StatusTone.warn),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _CapabilityRow extends StatelessWidget {
  const _CapabilityRow({required this.cap});

  final Capability cap;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final (IconData icon, Color color, String word) = switch (cap.state) {
      CapabilityState.yes => (LbIcons.checkmarkCircle02, c.gain, 'On'),
      CapabilityState.gated => (LbIcons.clock01, c.warn, 'Needs you'),
      CapabilityState.no => (LbIcons.cancel01, c.mutedForeground, 'Off'),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          LbIcon(icon, size: 16, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(cap.label, style: Theme.of(context).textTheme.bodyMedium),
                Text(cap.detail, style: LbText.muted(context, size: 12)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            word,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}

class _ModelsPanel extends StatelessWidget {
  const _ModelsPanel({required this.status});

  final StatusResponse status;

  KeyValueRow _row(BuildContext context, String label, IconData icon, String spec) {
    final info = parseModelSpec(spec);
    return KeyValueRow(
      label,
      valueWidget: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              LbIcon(icon, size: 14, color: context.lb.mutedForeground),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  info.thinking == null ? info.model : '${info.model} · ${info.thinking}',
                  textAlign: TextAlign.end,
                  style: LbText.number(context),
                ),
              ),
            ],
          ),
          if (info.provider.isNotEmpty)
            Text(info.provider, style: LbText.muted(context, size: 11.5)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Panel(
      title: 'Models',
      child: KeyValueList(
        rows: [
          _row(context, 'Lead agent', LbIcons.aiBrain01, status.models.main),
          _row(context, 'Subagents', LbIcons.chip02, status.models.subagents),
        ],
      ),
    );
  }
}

class _ConnectionsPanel extends ConsumerWidget {
  const _ConnectionsPanel({required this.status});

  final StatusResponse status;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final busyCycle = ref.watch(harnessProvider.select((s) => s.busy['cycle'] ?? false));
    final now = ref.watch(clockProvider);
    final c = context.lb;
    final broker = status.broker;
    final agent = status.agent;
    final market = status.market;
    final dot = switch (broker.state) {
      BrokerState.connected => c.live,
      BrokerState.error => c.destructive,
      _ => c.mutedForeground,
    };
    final lastCycle = agent.lastCycleAt == null
        ? '—'
        : agent.lastCycleKind == null
            ? ago(agent.lastCycleAt!, now: now.millisecondsSinceEpoch)
            : '${ago(agent.lastCycleAt!, now: now.millisecondsSinceEpoch)} · ${_cycleLabels[agent.lastCycleKind]}';
    final nextText = agent.nextCycleAt == null
        ? 'Not scheduled'
        : '${etTime(agent.nextCycleAt!)}${agent.nextCycleKind == null ? '' : ' · ${_cycleLabels[agent.nextCycleKind]}'} · in ${countdown(agent.nextCycleAt! - now.millisecondsSinceEpoch)}';
    return Panel(
      title: 'Connections and cycle',
      child: Column(
        children: [
          KeyValueList(
            rows: [
              KeyValueRow(
                'Robinhood',
                valueWidget: Wrap(
                  alignment: WrapAlignment.end,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                    ),
                    Text(_brokerLabels[broker.state]!, style: Theme.of(context).textTheme.bodyMedium),
                    if (broker.state != BrokerState.connected && broker.state != BrokerState.connecting)
                      TextButton(
                        onPressed: busyCycle
                            ? null
                            : () => ref.read(harnessProvider.notifier).connectRobinhood(),
                        child: const Text('Connect'),
                      ),
                  ],
                ),
              ),
              KeyValueRow('Market', value: _sessionLabels[market.session]),
              KeyValueRow(
                'Agent',
                valueWidget: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (agent.state == AgentState.running)
                      const Padding(
                        padding: EdgeInsets.only(right: 6),
                        child: SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                        ),
                      ),
                    Flexible(
                      child: Text(
                        _agentLabels[agent.state]!,
                        textAlign: TextAlign.end,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),
              ),
              KeyValueRow('Last cycle', value: lastCycle),
              KeyValueRow(
                'Next cycle',
                valueWidget: Wrap(
                  alignment: WrapAlignment.end,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  children: [
                    Text(nextText, textAlign: TextAlign.end, style: LbText.number(context)),
                    TextButton.icon(
                      onPressed: agent.state == AgentState.running || busyCycle
                          ? null
                          : () => ref.read(harnessProvider.notifier).runCycle(),
                      icon: busyCycle
                          ? const SizedBox(
                              width: 14, height: 14,
                              child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                            )
                          : const LbIcon(LbIcons.play, size: 14),
                      label: const Text('Run now'),
                    ),
                  ],
                ),
              ),
              KeyValueRow(
                'Cadence',
                value: '${status.settings.cycleMinutesOpen}m open · ${status.settings.cycleMinutesClosed}m closed',
              ),
            ],
          ),
          if (agent.state == AgentState.error && (agent.lastError?.isNotEmpty ?? false))
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LbIcon(LbIcons.alertCircle, size: 16, color: c.loss),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(agent.lastError!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: c.loss)),
                  ),
                ],
              ),
            ),
          if (agent.state == AgentState.needsLogin)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LbIcon(LbIcons.informationCircle, size: 16, color: c.warn),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'The agent needs Robinhood sign-in. Run the login on the server, then reconnect.',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _WorkingPanel extends ConsumerWidget {
  const _WorkingPanel({required this.runs});

  final List<SubagentRun> runs;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = ref.watch(clockProvider).millisecondsSinceEpoch;
    return Panel(
      title: 'Working now',
      reading: runs.isEmpty ? 'No subagents running' : '${runs.length} subagent${runs.length == 1 ? '' : 's'} running',
      padChild: runs.isNotEmpty,
      child: runs.isEmpty
          ? Empty(
              title: 'Nothing running',
              message: 'The next cycle can delegate research to subagents.',
              icon: LbIcons.searching,
            )
          : Column(
              children: [
                for (var i = 0; i < runs.length; i++) ...[
                  if (i > 0) const Divider(height: 1),
                  _RunRow(run: runs[i], now: now),
                ],
              ],
            ),
    );
  }
}

class _RunRow extends StatelessWidget {
  const _RunRow({required this.run, required this.now});

  final SubagentRun run;
  final int now;

  @override
  Widget build(BuildContext context) {
    final meta = roleMeta[run.role]!;
    return Semantics(
      button: true,
      label: '${meta.label}${run.symbol == null ? '' : ' on ${run.symbol}'}: ${run.task}',
      excludeSemantics: true,
      child: InkWell(
        onTap: () => AppNav.transcript(context, run.id),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LbIcon(AgentIcons.role(meta.icon), size: 16, color: context.lb.live),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${meta.label}${run.symbol == null ? '' : ' on ${run.symbol}'}',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        run.task,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: LbText.muted(context, size: 12),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(ago(run.startedAt, now: now), style: LbText.number(context, size: 11.5, color: context.lb.mutedForeground)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HelpersPanel extends StatelessWidget {
  const _HelpersPanel({required this.helpers});

  final List<SubagentRun> helpers;

  @override
  Widget build(BuildContext context) {
    final working = helpers.where((h) => h.status == SubagentStatus.running).length;
    final idle = helpers.length - working;
    return Panel(
      title: 'Long-running helpers',
      reading: helpers.isEmpty ? 'None started' : '$working working, $idle idle',
      padChild: helpers.isNotEmpty,
      child: helpers.isEmpty
          ? const Empty(
              title: 'No helpers',
              message: 'Long-running helpers keep context between cycles.',
            )
          : Column(
              children: [
                for (var i = 0; i < helpers.length; i++) ...[
                  if (i > 0) const Divider(height: 1),
                  _HelperRow(helper: helpers[i]),
                ],
              ],
            ),
    );
  }
}

class _HelperRow extends StatelessWidget {
  const _HelperRow({required this.helper});

  final SubagentRun helper;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final meta = roleMeta[helper.role]!;
    final chip = switch (helper.status) {
      SubagentStatus.running => (StatusTone.live, 'Working'),
      SubagentStatus.failed => (StatusTone.loss, 'Failed'),
      SubagentStatus.done => (StatusTone.neutral, 'Idle'),
    };
    return Semantics(
      button: true,
      label: '${helper.name ?? meta.label}, ${meta.label}: ${helper.task}',
      excludeSemantics: true,
      child: InkWell(
        onTap: () => AppNav.transcript(context, helper.id),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LbIcon(
                  AgentIcons.role(meta.icon),
                  size: 16,
                  color: helper.status == SubagentStatus.running ? c.live : c.mutedForeground,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${helper.name ?? meta.label} · ${meta.label}',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        latestLine(null, helper.answer, helper.task),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: LbText.muted(context, size: 12),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                StatusChip(chip.$2, tone: chip.$1),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RecentPanel extends StatelessWidget {
  const _RecentPanel({required this.entries});

  final List<JournalEntry> entries;

  @override
  Widget build(BuildContext context) {
    return Panel(
      title: 'What it just did',
      reading: entries.isEmpty ? 'No decisions recorded yet' : null,
      padChild: entries.isNotEmpty,
      child: entries.isEmpty
          ? const Empty(
              title: 'No decisions yet',
              message: 'The agent records each cycle decision here.',
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < entries.length; i++) ...[
                  if (i > 0) const SizedBox(height: 8),
                  DecisionCard(entry: entries[i]),
                ],
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(builder: (_) => const HistoryScreen()),
                    ),
                    child: const Text('Open Journal and orders'),
                  ),
                ),
              ],
            ),
    );
  }
}
