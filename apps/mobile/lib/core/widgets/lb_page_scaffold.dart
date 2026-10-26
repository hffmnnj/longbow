import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// The frame every feature screen uses: a collapsing large-title app bar over
/// [slivers], optional pull-to-refresh, edge-to-edge with safe-area padding.
///
/// Pass sliver content (`SliverList`, `SliverToBoxAdapter`...) or use
/// [LbPageScaffold.children] for a simple stack with 12dp gaps. Content gets
/// 16dp side margins; do not add your own. [onRefresh] enables pull-to-refresh
/// and must return a future that completes when data is fresh.
class LbPageScaffold extends StatelessWidget {
  const LbPageScaffold({
    super.key,
    required this.title,
    required this.slivers,
    this.onRefresh,
    this.actions,
    this.leading,
    this.bottom,
    this.floatingActionButton,
    this.banner,
    this.largeTitle = true,
    this.controller,
  });

  /// Stacks [children] with 12dp gaps in a single sliver.
  factory LbPageScaffold.children({
    Key? key,
    required String title,
    required List<Widget> children,
    Future<void> Function()? onRefresh,
    List<Widget>? actions,
    Widget? leading,
    PreferredSizeWidget? bottom,
    Widget? floatingActionButton,
    Widget? banner,
    bool largeTitle = true,
    ScrollController? controller,
  }) {
    return LbPageScaffold(
      key: key,
      title: title,
      onRefresh: onRefresh,
      actions: actions,
      leading: leading,
      bottom: bottom,
      floatingActionButton: floatingActionButton,
      banner: banner,
      largeTitle: largeTitle,
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

  final String title;
  final List<Widget> slivers;
  final Future<void> Function()? onRefresh;
  final List<Widget>? actions;
  final Widget? leading;

  /// A TabBar or similar under the title.
  final PreferredSizeWidget? bottom;
  final Widget? floatingActionButton;

  /// Pinned strip between the app bar and content (e.g. a StaleBanner).
  final Widget? banner;
  final bool largeTitle;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final bar = largeTitle
        ? SliverAppBar.large(
            title: Text(title),
            actions: actions,
            leading: leading,
            bottom: bottom,
            pinned: true,
            backgroundColor: c.bar,
            surfaceTintColor: Colors.transparent,
            scrolledUnderElevation: 0,
          )
        : SliverAppBar(
            title: Text(title),
            actions: actions,
            leading: leading,
            bottom: bottom,
            pinned: true,
            backgroundColor: c.bar,
            surfaceTintColor: Colors.transparent,
            scrolledUnderElevation: 0,
          );
    final scroll = CustomScrollView(
      controller: controller,
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        bar,
        if (banner != null) SliverToBoxAdapter(child: banner),
        const SliverToBoxAdapter(child: SizedBox(height: LbSpace.gap)),
        SliverSafeArea(
          top: false,
          sliver: SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: LbSpace.screen),
            sliver: SliverMainAxisGroup(slivers: slivers),
          ),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: LbSpace.screen)),
      ],
    );
    return Scaffold(
      backgroundColor: c.background,
      floatingActionButton: floatingActionButton,
      body: onRefresh == null
          ? scroll
          : RefreshIndicator(
              onRefresh: onRefresh!,
              color: c.primary,
              backgroundColor: c.popover,
              edgeOffset: 0,
              child: scroll,
            ),
    );
  }
}
