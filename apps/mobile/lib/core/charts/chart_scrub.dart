import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'chart_palette.dart';

/// How a chart starts a scrub.
///
/// [drag] (default): a horizontal-drag recognizer that begins at the touch-down
/// point. A vertical swipe still scrolls the parent because the drag only wins
/// the gesture arena once movement is mostly horizontal. Use [longPress] when
/// the chart sits inside a horizontal pager or tab swipe: the finger must rest
/// for a moment first, then dragging scrubs and the parent never sees it.
enum ChartScrubMode { drag, longPress }

/// Fires a selection haptic when the scrubbed point changes, at most once per
/// [minInterval]. Time and the haptic call are injectable for tests.
class ScrubHaptics {
  ScrubHaptics({
    this.minInterval = const Duration(milliseconds: 40),
    DateTime Function()? now,
    VoidCallback? fire,
  }) : _now = now ?? DateTime.now,
       _fire = fire ?? HapticFeedback.selectionClick;

  final Duration minInterval;
  final DateTime Function() _now;
  final VoidCallback _fire;
  DateTime? _last;

  /// Call when the scrubbed index moved to a new point. Returns whether a
  /// haptic fired.
  bool indexChanged() {
    final t = _now();
    final last = _last;
    if (last != null && t.difference(last) < minInterval) return false;
    _last = t;
    _fire();
    return true;
  }

  void reset() => _last = null;
}

/// Turns drags (or long-press drags) over [child] into scrub indexes.
///
/// [indexAt] maps a local x to a data index (or null when there is none).
/// [onChanged] gets the new index whenever it changes and null when the finger
/// lifts. Haptics fire on index changes after the first point.
class ScrubRegion extends StatefulWidget {
  const ScrubRegion({
    super.key,
    required this.child,
    required this.indexAt,
    required this.onChanged,
    this.mode = ChartScrubMode.drag,
    this.enabled = true,
    this.haptics = true,
    this.hapticsOverride,
  });

  final Widget child;
  final int? Function(double dx) indexAt;
  final ValueChanged<int?> onChanged;
  final ChartScrubMode mode;
  final bool enabled;
  final bool haptics;

  /// Replaces the real haptics (tests).
  final ScrubHaptics? hapticsOverride;

  @override
  State<ScrubRegion> createState() => _ScrubRegionState();
}

class _ScrubRegionState extends State<ScrubRegion> {
  int? _index;
  late final ScrubHaptics _haptics = widget.hapticsOverride ?? ScrubHaptics();

  void _begin(double dx) {
    _haptics.reset();
    _move(dx, first: true);
  }

  void _move(double dx, {bool first = false}) {
    final next = widget.indexAt(dx);
    if (next == _index) return;
    _index = next;
    if (next != null && !first && widget.haptics) _haptics.indexChanged();
    widget.onChanged(next);
  }

  void _end() {
    if (_index == null) return;
    _index = null;
    widget.onChanged(null);
  }

  @override
  void dispose() {
    _index = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return widget.child;
    final isDrag = widget.mode == ChartScrubMode.drag;
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      dragStartBehavior: DragStartBehavior.down,
      onHorizontalDragStart: isDrag ? (d) => _begin(d.localPosition.dx) : null,
      onHorizontalDragUpdate: isDrag ? (d) => _move(d.localPosition.dx) : null,
      onHorizontalDragEnd: isDrag ? (_) => _end() : null,
      onHorizontalDragCancel: isDrag ? _end : null,
      onLongPressStart: isDrag ? null : (d) => _begin(d.localPosition.dx),
      onLongPressMoveUpdate: isDrag ? null : (d) => _move(d.localPosition.dx),
      onLongPressEnd: isDrag ? null : (_) => _end(),
      onLongPressCancel: isDrag ? null : _end,
      child: widget.child,
    );
  }
}

/// A small readout bubble pinned to the top of the chart, following the
/// scrubbed x and kept inside the chart width. Ignores pointers.
class ScrubBubble extends StatelessWidget {
  const ScrubBubble({
    super.key,
    required this.scrub,
    required this.xAt,
    required this.builder,
  });

  final ValueListenable<int?> scrub;
  final double Function(int index) xAt;
  final Widget Function(BuildContext context, int index) builder;

  @override
  Widget build(BuildContext context) {
    final palette = ChartPalette.of(context);
    return IgnorePointer(
      child: ValueListenableBuilder<int?>(
        valueListenable: scrub,
        builder: (context, index, _) {
          if (index == null) return const SizedBox.shrink();
          return CustomSingleChildLayout(
            delegate: _BubbleLayout(xAt(index)),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: palette.bubble,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: palette.bubbleBorder),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: builder(context, index),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _BubbleLayout extends SingleChildLayoutDelegate {
  _BubbleLayout(this.x);
  final double x;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) =>
      constraints.loosen();

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final maxLeft = (size.width - childSize.width).clamp(0.0, double.infinity);
    return Offset((x - childSize.width / 2).clamp(0.0, maxLeft), 0);
  }

  @override
  bool shouldRelayout(_BubbleLayout old) => old.x != x;
}
