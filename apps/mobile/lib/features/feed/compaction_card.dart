import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';

/// A quiet timeline marker for context compaction, in the same muted card
/// language as [HelperReportCard] but never expandable: there is nothing to
/// disclose. The committed history card reads "Context compacted" with its
/// original timestamp and never renders the stored text (the server strips
/// summaries from API chat). The lead feed adds one live card while the
/// agent is compacting, or an honest failure card without any raw payload.
class CompactionCard extends StatelessWidget {
  /// Committed history marker.
  const CompactionCard.completed({super.key, required this.at}) : kind = CompactionKind.compacted, live = false;

  /// Live lead marker while the agent compacts.
  const CompactionCard.compacting({super.key})
    : kind = CompactionKind.compacting,
      at = null,
      live = true;

  /// Live lead marker after compaction failed.
  const CompactionCard.failed({super.key}) : kind = CompactionKind.failed, at = null, live = true;

  final CompactionKind kind;
  final int? at;

  /// True for the live lead card, false for committed history.
  final bool live;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final label = switch (kind) {
      CompactionKind.compacted => 'Context compacted',
      CompactionKind.compacting => 'Context compacting…',
      CompactionKind.failed => 'Context compaction failed',
    };
    final semanticLabel = switch (kind) {
      CompactionKind.compacted => 'Context compacted',
      CompactionKind.compacting => 'Context is compacting',
      CompactionKind.failed => 'Context compaction failed',
    };
    return Semantics(
      container: true,
      liveRegion: live,
      label: semanticLabel,
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: c.muted,
          borderRadius: BorderRadius.circular(LbRadius.md),
          border: Border.all(color: c.border),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (kind == CompactionKind.compacting)
                PulseDot(color: c.live, size: 6)
              else
                LbIcon(
                  kind == CompactionKind.failed ? LbIcons.alertCircle : LbIcons.file01,
                  size: 16,
                  color: kind == CompactionKind.failed ? c.loss : c.mutedForeground,
                ),
              const SizedBox(width: 8),
              Flexible(
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: label,
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: kind == CompactionKind.compacting ? c.primary : c.foreground,
                        ),
                      ),
                      if (at != null)
                        TextSpan(
                          text: '  ${etTime(at!)}',
                          style: LbText.number(context, size: 11.5, weight: FontWeight.w400, color: c.mutedForeground),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Which marker a [CompactionCard] shows.
enum CompactionKind { compacted, compacting, failed }
