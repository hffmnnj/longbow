import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';

/// Where the More sheet can send the user.
enum MoreDestination { reports, history, lab, settings }

/// Opens the More menu. Resolves to the chosen destination once the sheet has
/// closed, so the caller can push the next screen without stacking on top of
/// the sheet; null when dismissed.
Future<MoreDestination?> showMoreSheet(BuildContext context) =>
    showLbSheet<MoreDestination>(context, (_) => const _MoreList(), title: 'More');

class _MoreList extends StatelessWidget {
  const _MoreList();

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    Widget tile(MoreDestination dest, IconData icon, String label) => ListTile(
          minTileHeight: 56,
          contentPadding: EdgeInsets.zero,
          leading: LbIcon(icon, color: c.mutedForeground),
          title: Text(label),
          trailing: LbIcon(LbIcons.chevronRight, size: 18, color: c.mutedForeground),
          onTap: () => Navigator.of(context).pop(dest),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        tile(MoreDestination.reports, LbIcons.news01, 'Reports'),
        tile(MoreDestination.history, LbIcons.notebook01, 'Journal and orders'),
        tile(MoreDestination.lab, LbIcons.flaskConical, 'Lab'),
        tile(MoreDestination.settings, LbIcons.settings02, 'Settings'),
      ],
    );
  }
}
