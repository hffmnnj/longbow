import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/models/models.dart';

/// Installed skill names and descriptions. Port of the web `Skills`.
class SkillsTab extends ConsumerWidget {
  const SkillsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final loaded = ref.watch(harnessProvider.select((s) => s.loaded));
    final skills = ref.watch(harnessProvider.select((s) => s.skills));
    final loadError = ref.watch(harnessProvider.select((s) => s.loadError));

    if (!loaded) {
      return const SliverToBoxAdapter(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SkeletonBlock(height: 72),
            SizedBox(height: LbSpace.gap),
            SkeletonBlock(height: 72),
            SizedBox(height: LbSpace.gap),
            SkeletonBlock(height: 72),
          ],
        ),
      );
    }
    if (skills.isEmpty) {
      return SliverToBoxAdapter(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (loadError != null)
              Text(
                'Could not refresh: $loadError',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: context.lb.warn,
                ),
              ),
            const Empty(title: 'No skills installed'),
          ],
        ),
      );
    }

    final c = context.lb;
    return SliverMainAxisGroup(
      slivers: [
        if (loadError != null)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                'Could not refresh: $loadError',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: c.warn,
                ),
              ),
            ),
          ),
        SliverToBoxAdapter(
          child: LbCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < skills.length; i++) ...[
                  if (i > 0) Divider(height: 1, color: c.border),
                  _SkillRow(skill: skills[i]),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SkillRow extends StatelessWidget {
  const _SkillRow({required this.skill});

  final SkillSummary skill;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Open skill ${skill.name}',
      excludeSemantics: true,
      child: InkWell(
        onTap: () => AppNav.skill(context, skill.name),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: LbSpace.card,
              vertical: 10,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  skill.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LbText.number(
                    context,
                    size: 14,
                    weight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  skill.description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
