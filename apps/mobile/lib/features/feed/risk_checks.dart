import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/orders.dart';
import 'package:longbow/models/models.dart';

/// Port of RiskChecks.svelte. A summary line ("Risk checks 7 passed, 1
/// failed") that opens the full list; failed checks stay visible while closed.
class RiskChecks extends StatefulWidget {
  const RiskChecks({super.key, required this.verdict, this.initiallyOpen = false});

  final RiskVerdict verdict;
  final bool initiallyOpen;

  @override
  State<RiskChecks> createState() => _RiskChecksState();
}

class _RiskChecksState extends State<RiskChecks> {
  late bool _open = widget.initiallyOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final checks = widget.verdict.checks;
    final failed = checks.where((x) => !x.ok).toList();
    final passed = checks.length - failed.length;
    final summary = failed.isEmpty ? '$passed passed' : '$passed passed, ${failed.length} failed';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          button: true,
          expanded: _open,
          label: 'Risk checks, $summary',
          excludeSemantics: true,
          onTap: () => setState(() => _open = !_open),
          child: InkWell(
            borderRadius: BorderRadius.circular(LbRadius.md),
            onTap: () => setState(() => _open = !_open),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: kMinTarget),
              child: Row(
                children: [
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(text: 'Risk checks  ', style: Theme.of(context).textTheme.titleSmall),
                          TextSpan(
                            text: summary,
                            style: LbText.number(context, size: 12, weight: FontWeight.w400, color: failed.isEmpty ? c.mutedForeground : c.loss),
                          ),
                        ],
                      ),
                    ),
                  ),
                  AnimatedRotation(
                    turns: _open ? 0.5 : 0,
                    duration: LbMotion.duration(context, LbMotion.fast),
                    child: LbIcon(LbIcons.chevronDown, size: 18, color: c.mutedForeground),
                  ),
                  const SizedBox(width: 2),
                ],
              ),
            ),
          ),
        ),
        if (!_open)
          for (final check in failed) _CheckLine(check),
        if (_open)
          for (final check in checks) _CheckLine(check),
      ],
    );
  }
}

class _CheckLine extends StatelessWidget {
  const _CheckLine(this.check);

  final RiskCheck check;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final color = check.ok ? c.mutedForeground : c.loss;
    final style = Theme.of(context).textTheme.bodySmall!.copyWith(color: color, fontSize: 12.5, height: 1.4);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: LbIcon(check.ok ? LbIcons.check : LbIcons.close, size: 15, color: check.ok ? c.gain : c.loss),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${ruleName(check.rule)}. ',
                    style: style.copyWith(fontWeight: FontWeight.w600, color: check.ok ? c.foreground : c.loss),
                  ),
                  TextSpan(text: check.detail),
                ],
              ),
              style: style,
            ),
          ),
        ],
      ),
    );
  }
}
