import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show ScrollCacheExtent;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/models/models.dart';

import 'agents_lane.dart';
import 'feed_rows.dart';
import 'transcript_items.dart';

/// How close to the end (dp) still counts as "at the bottom".
const double _stickDistance = 80;

/// The agent transcript (messages, work steps, tool traces, decisions, subagent
/// lane) rendered from any [FeedState]. The Feed screen feeds it the live
/// account; the Lab feeds it one simulation run's state.
///
/// Scrolling follows the bottom while the reader is there. Scrolled up, it
/// stays put and offers a "Latest" pill with the count of new items. Rows are
/// built lazily and only rebuilt when the transcript data changes, so a
/// streaming delta repaints just the draft bubble.
class FeedTranscriptView extends ConsumerStatefulWidget {
  const FeedTranscriptView({
    super.key,
    required this.feed,
    required this.loadTranscript,
    this.simRunId,
    this.running,
    this.agentLabel = 'Agent',
    this.showLane = true,
    this.emptyTitle = 'No messages yet',
    this.emptyMessage = 'Run a cycle or say something.',
    this.emptyAction,
    this.footer,
    this.sidePadding = LbSpace.screen,
  });

  final FeedState feed;

  /// Loads a subagent conversation into the owning store.
  final Future<void> Function(String conversationId) loadTranscript;

  /// Set when [feed] belongs to a simulation run (routes transcript pages back to it).
  final String? simRunId;

  /// Whether the agent is working. Defaults to the feed's agent status or any
  /// live nested calls.
  final bool? running;

  /// Name above assistant messages.
  final String agentLabel;

  /// Show the running-subagents lane under the transcript.
  final bool showLane;
  final String emptyTitle;
  final String emptyMessage;
  final Widget? emptyAction;

  /// Shown after the last row (a subagent's final answer).
  final Widget? footer;

  /// Minimum side margin; pages that already pad their content pass 0.
  final double sidePadding;

  @override
  ConsumerState<FeedTranscriptView> createState() => _FeedTranscriptViewState();
}

class _FeedTranscriptViewState extends ConsumerState<FeedTranscriptView> {
  final ScrollController _controller = ScrollController();

  /// Row keys that already ran (or skipped) their ease-in.
  final Set<String> _played = <String>{};

  late FeedRows _built;
  Map<String, int> _index = const {};
  int _version = 0;
  bool _stick = true;
  bool _programmatic = false;
  bool _jumpQueued = false;
  int _unread = 0;

  bool get _running =>
      widget.running ?? (widget.feed.status?.agent.state == AgentState.running || widget.feed.calls.isNotEmpty);

  @override
  void initState() {
    super.initState();
    _rebuildRows(initial: true);
    _queueJump();
  }

  @override
  void didUpdateWidget(FeedTranscriptView old) {
    super.didUpdateWidget(old);
    final a = old.feed;
    final b = widget.feed;
    final changed = !identical(a.messages, b.messages) ||
        !identical(a.journal, b.journal) ||
        !identical(a.orders, b.orders) ||
        !identical(a.subagents, b.subagents) ||
        !identical(a.calls, b.calls) ||
        !identical(a.outbox, b.outbox) ||
        old.simRunId != widget.simRunId ||
        old.agentLabel != widget.agentLabel ||
        old.running != widget.running ||
        (a.status?.agent.state != b.status?.agent.state);
    if (changed) _rebuildRows();
  }

  void _rebuildRows({bool initial = false}) {
    final before = initial ? 0 : _built.rows.length;
    final feed = widget.feed;
    _built = buildFeedRows(FeedRowsInput(
      messages: feed.messages,
      journal: feed.journal,
      orders: feed.orders,
      subagents: feed.subagents,
      calls: feed.calls,
      outbox: feed.outbox,
      running: _running,
      simRunId: widget.simRunId,
      agentLabel: widget.agentLabel,
      onRetry: (o) => ref.read(harnessProvider.notifier).send(o.text, retryId: o.id),
      onDiscard: (id) => ref.read(harnessProvider.notifier).discardOutbox(id),
    ));
    _index = {for (var i = 0; i < _built.rows.length; i++) _built.rows[i].key: i};
    _version++;
    if (initial) {
      _played.addAll(_index.keys);
    } else if (!_stick) {
      _unread += math.max(0, _built.rows.length - before);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _queueJump() {
    if (_jumpQueued) return;
    _jumpQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _jumpQueued = false;
      if (!mounted || !_stick || !_controller.hasClients) return;
      final p = _controller.position;
      if (p.maxScrollExtent - p.pixels > 0.5) {
        _programmatic = true;
        _controller.jumpTo(p.maxScrollExtent);
        _programmatic = false;
      }
    });
  }

  bool _onMetrics(ScrollMetricsNotification n) {
    if (n.depth == 0 && n.metrics.axis == Axis.vertical && _stick) _queueJump();
    return false;
  }

  bool _onScroll(ScrollNotification n) {
    if (n.depth != 0 || n.metrics.axis != Axis.vertical || _programmatic) return false;
    final stick = n.metrics.extentAfter < _stickDistance;
    if (stick != _stick || (stick && _unread != 0)) {
      setState(() {
        _stick = stick;
        if (stick) _unread = 0;
      });
    }
    return false;
  }

  Future<void> _toLatest() async {
    if (!_controller.hasClients) return;
    final target = _controller.position.maxScrollExtent;
    final duration = LbMotion.duration(context, LbMotion.sheet);
    setState(() {
      _stick = true;
      _unread = 0;
      _programmatic = true;
    });
    if (duration == Duration.zero) {
      _controller.jumpTo(target);
    } else {
      await _controller.animateTo(target, duration: duration, curve: LbMotion.curve);
    }
    _programmatic = false;
    if (mounted) _queueJump();
  }

  @override
  Widget build(BuildContext context) {
    final feed = widget.feed;
    final empty = _built.rows.isEmpty && feed.draft.isEmpty && !_built.showWorking && widget.footer == null;
    final Widget body;
    if (empty) {
      body = Empty(
        title: widget.emptyTitle,
        message: widget.emptyMessage,
        icon: LbIcons.message01,
        action: widget.emptyAction,
      );
    } else {
      body = _list(context);
    }
    return Column(
      children: [
        Expanded(child: body),
        if (widget.showLane)
          AgentsLane(feed: feed, loadTranscript: widget.loadTranscript, simRunId: widget.simRunId),
      ],
    );
  }

  Widget _list(BuildContext context) {
    final feed = widget.feed;
    final c = context.lb;
    return LayoutBuilder(
      builder: (context, box) {
        final side = math.max(widget.sidePadding, (box.maxWidth - kTranscriptMaxWidth) / 2);
        final tail = feed.draft.isNotEmpty
            ? Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: DraftBubble(text: feed.draft, label: widget.agentLabel),
              )
            : _built.showWorking
                ? const Padding(padding: EdgeInsets.only(bottom: 12), child: WorkingIndicator())
                : const SizedBox.shrink();
        return Stack(
          children: [
            Semantics(
              container: true,
              label: 'Agent feed',
              child: NotificationListener<ScrollMetricsNotification>(
                onNotification: _onMetrics,
                child: NotificationListener<ScrollNotification>(
                  onNotification: _onScroll,
                  child: CustomScrollView(
                    controller: _controller,
                    scrollCacheExtent: const ScrollCacheExtent.pixels(900),
                    slivers: [
                      SliverPadding(
                        padding: EdgeInsets.fromLTRB(side, LbSpace.screen, side, 0),
                        sliver: SliverList(
                          delegate: _RowsDelegate(
                            rows: _built.rows,
                            index: _index,
                            version: _version,
                            played: _played,
                          ),
                        ),
                      ),
                      SliverPadding(
                        padding: EdgeInsets.fromLTRB(side, 0, side, LbSpace.screen),
                        sliver: SliverToBoxAdapter(
                          child: widget.footer == null
                              ? tail
                              : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [tail, widget.footer!]),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (!_stick)
              Positioned(
                left: 0,
                right: 0,
                bottom: LbSpace.gap,
                child: Center(child: _LatestPill(unread: _unread, color: c.popover, onTap: _toLatest)),
              ),
          ],
        );
      },
    );
  }
}

class _RowsDelegate extends SliverChildBuilderDelegate {
  _RowsDelegate({
    required this.rows,
    required Map<String, int> index,
    required this.version,
    required Set<String> played,
  }) : super(
          (context, i) {
            final row = rows[i];
            return _EaseIn(key: ValueKey<String>(row.key), id: row.key, played: played, child: row.widget);
          },
          childCount: rows.length,
          findChildIndexCallback: (key) => key is ValueKey<String> ? index[key.value] : null,
          addAutomaticKeepAlives: false,
        );

  final List<FeedRow> rows;
  final int version;

  @override
  bool shouldRebuild(covariant _RowsDelegate oldDelegate) => oldDelegate.version != version;
}

/// Fades and lifts a row in the first time it appears after the initial load.
class _EaseIn extends StatefulWidget {
  const _EaseIn({super.key, required this.id, required this.played, required this.child});

  final String id;
  final Set<String> played;
  final Widget child;

  @override
  State<_EaseIn> createState() => _EaseInState();
}

class _EaseInState extends State<_EaseIn> with SingleTickerProviderStateMixin {
  AnimationController? _anim;
  late final bool _fresh = widget.played.add(widget.id);
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    final duration = LbMotion.duration(context);
    if (_fresh && duration > Duration.zero) {
      _anim = AnimationController(vsync: this, duration: duration)..forward();
    }
  }

  @override
  void dispose() {
    _anim?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final anim = _anim;
    if (anim == null) return widget.child;
    final curved = CurvedAnimation(parent: anim, curve: LbMotion.curve);
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(begin: const Offset(0, 0.04), end: Offset.zero).animate(curved),
        child: widget.child,
      ),
    );
  }
}

class _LatestPill extends StatelessWidget {
  const _LatestPill({required this.unread, required this.color, required this.onTap});

  final int unread;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final label = unread > 0 ? 'Latest \u00b7 $unread new' : 'Latest';
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: LbMotion.duration(context, LbMotion.fast),
      builder: (context, t, child) => Opacity(opacity: t, child: child),
      child: Semantics(
        button: true,
        label: unread > 0 ? 'Jump to latest, $unread new' : 'Jump to latest',
        excludeSemantics: true,
        onTap: onTap,
        child: Material(
          color: color,
          elevation: 3,
          shape: StadiumBorder(side: BorderSide(color: c.border)),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: kMinTarget),
              child: Padding(
                padding: const EdgeInsets.only(left: 16, right: 12),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (unread > 0) ...[
                      DecoratedBox(
                        decoration: BoxDecoration(color: c.live, shape: BoxShape.circle),
                        child: const SizedBox.square(dimension: 6),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Text(label, style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(width: 4),
                    LbIcon(LbIcons.arrowDown01, size: 18, color: c.foreground),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
