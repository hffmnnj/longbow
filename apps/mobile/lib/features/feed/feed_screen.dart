import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';

import 'approvals.dart';
import 'composer.dart';
import 'transcript_view.dart';

/// Width from which the Feed shows the transcript beside approvals and orders.
const double kFeedTwoPaneWidth = 840;

/// Width of the right pane in the two-pane layout.
const double kFeedSidePaneWidth = 380;

/// The home tab: pending approvals, the live agent transcript and the
/// composer. The shell draws the header above it, so there is no app bar.
class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen> {
  @override
  void initState() {
    super.initState();
    // Opening the tab while offline: try once for fresh data.
    Future.microtask(() {
      if (!mounted) return;
      final state = ref.read(harnessProvider);
      if (state.connection == ConnectionStatus.offline) ref.read(harnessProvider.notifier).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final offline = ref.watch(harnessProvider.select((s) => s.connection == ConnectionStatus.offline));
    final cachedAt = ref.watch(harnessProvider.select((s) => s.cachedAt));
    final store = ref.read(harnessProvider.notifier);
    final banner = offline ? StaleBanner(updatedAtMs: cachedAt, onRetry: store.refresh) : null;

    return Material(
      color: c.background,
      child: LayoutBuilder(
        builder: (context, box) {
          final twoPane = box.maxWidth >= kFeedTwoPaneWidth;
          final main = Column(
            children: [
              if (!twoPane) ApprovalsArea(maxHeight: box.maxHeight * 0.38),
              const Expanded(child: _TranscriptRegion()),
              const Composer(),
            ],
          );
          return Column(
            children: [
              ?banner,
              Expanded(
                child: twoPane
                    ? Row(
                        children: [
                          Expanded(child: main),
                          VerticalDivider(width: 1, color: c.border),
                          SizedBox(
                            width: kFeedSidePaneWidth,
                            child: const _SidePane(),
                          ),
                        ],
                      )
                    : main,
              ),
            ],
          );
        },
      ),
    );
  }
}

class _SidePane extends StatelessWidget {
  const _SidePane();

  @override
  Widget build(BuildContext context) {
    return const SingleChildScrollView(
      padding: EdgeInsets.all(LbSpace.screen),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ApprovalsArea(constrained: false, showEmpty: true),
          SizedBox(height: LbSpace.screen),
          RecentOrders(),
        ],
      ),
    );
  }
}

/// Loading, error and the live transcript.
class _TranscriptRegion extends ConsumerWidget {
  const _TranscriptRegion();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final loaded = ref.watch(harnessProvider.select((s) => s.loaded));
    final loadError = ref.watch(harnessProvider.select((s) => s.loadError));
    final feed = ref.watch(harnessProvider.select((s) => s.feed));
    final store = ref.read(harnessProvider.notifier);

    if (!loaded) {
      return Padding(
        padding: const EdgeInsets.all(LbSpace.screen),
        child: Semantics(
          label: 'Loading the feed',
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SkeletonBlock(height: 40, radius: LbRadius.lg),
              SizedBox(height: LbSpace.gap),
              SkeletonBlock(height: 72, radius: LbRadius.lg),
              SizedBox(height: LbSpace.gap),
              SkeletonBlock(height: 40, radius: LbRadius.lg),
            ],
          ),
        ),
      );
    }
    if (loadError != null && feed.messages.isEmpty) {
      return ErrorState(title: 'Could not load the feed', message: loadError, onRetry: store.refresh);
    }
    return FeedTranscriptView(
      feed: feed,
      loadTranscript: store.loadTranscript,
      emptyAction: Consumer(
        builder: (context, ref, _) {
          final busy = ref.watch(harnessProvider.select((s) => s.busy['cycle'] ?? false));
          return FilledButton.icon(
            onPressed: busy ? null : store.runCycle,
            icon: const LbIcon(LbIcons.play, size: 18),
            label: Text(busy ? 'Starting\u2026' : 'Run cycle'),
          );
        },
      ),
    );
  }
}
