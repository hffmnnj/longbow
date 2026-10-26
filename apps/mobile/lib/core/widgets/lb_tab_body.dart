import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// Scrolling body for a bottom-navigation tab root (Portfolio, Markets,
/// Performance, Agent). The shell draws the status header above it, so there is
/// no app bar here. Content gets 16dp side margins, a 12dp top gap and
/// safe-area bottom padding; do not add your own. Pull-to-refresh is enabled
/// when [onRefresh] is set.
class LbTabBody extends StatelessWidget {
  const LbTabBody({
    super.key,
    required this.slivers,
    this.onRefresh,
    this.controller,
  });

  /// Stacks [children] with 12dp gaps in a single sliver.
  factory LbTabBody.children({
    Key? key,
    required List<Widget> children,
    Future<void> Function()? onRefresh,
    ScrollController? controller,
  }) {
    return LbTabBody(
      key: key,
      onRefresh: onRefresh,
      controller: controller,
      slivers: [
        SliverList.separated(
          itemCount: children.length,
          separatorBuilder: (_, _) => const SizedBox(height: LbSpace.gap),
          itemBuilder: (_, i) => children[i],
        ),
      ],
    );
  }

  final List<Widget> slivers;
  final Future<void> Function()? onRefresh;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    final scroll = CustomScrollView(
      controller: controller,
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        SliverPadding(
          padding: EdgeInsets.fromLTRB(
              LbSpace.screen, LbSpace.gap, LbSpace.screen, LbSpace.screen + bottom),
          sliver: SliverMainAxisGroup(slivers: slivers),
        ),
      ],
    );
    final refresh = onRefresh;
    if (refresh == null) return scroll;
    return RefreshIndicator(onRefresh: refresh, child: scroll);
  }
}
