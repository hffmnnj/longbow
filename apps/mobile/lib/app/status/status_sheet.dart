import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/features/control/kill_switch.dart';
import 'package:longbow/features/control/live_lock.dart';
import 'package:longbow/features/control/mode_control.dart';

import 'agent_chip.dart';
import 'broker_chip.dart';
import 'session_chip.dart';

/// Detail sheet behind the header's status pills: control (lock, mode, kill
/// switch) over the session, agent and broker rows.
Future<void> showStatusSheet(BuildContext context) =>
    showLbSheet<void>(context, (_) => const StatusSheetBody(), title: 'Status');

class StatusSheetBody extends StatelessWidget {
  const StatusSheetBody({super.key});

  @override
  Widget build(BuildContext context) {
    final divider = Divider(height: 24, color: context.lb.border);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Align(alignment: Alignment.centerLeft, child: LiveLockChip()),
        const ModeControl(),
        const SizedBox(height: LbSpace.gap),
        const Align(alignment: Alignment.centerLeft, child: KillSwitchButton()),
        divider,
        const SectionLabel('Market'),
        const SizedBox(height: 8),
        const SessionChip(detailed: true),
        divider,
        const SectionLabel('Agent'),
        const SizedBox(height: 8),
        const AgentChip(detailed: true),
        divider,
        const SectionLabel('Broker'),
        const SizedBox(height: 8),
        const BrokerChip(detailed: true),
      ],
    );
  }
}
