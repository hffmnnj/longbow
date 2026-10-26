import 'package:flutter/material.dart';

import '../motion.dart';
import '../theme/theme.dart';

/// Placeholder block that reserves the loaded geometry. Pulses gently; static
/// under reduced motion. Give it the same [width]/[height] as the content it
/// stands in for (null width fills the parent).
class SkeletonBlock extends StatefulWidget {
  const SkeletonBlock({super.key, this.width, this.height = 16, this.radius = LbRadius.sm});

  final double? width;
  final double height;
  final double radius;

  @override
  State<SkeletonBlock> createState() => _SkeletonBlockState();
}

class _SkeletonBlockState extends State<SkeletonBlock> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (LbMotion.reduced(context)) {
      _c.stop();
      _c.value = 0;
    } else if (!_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return ExcludeSemantics(
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            color: Color.lerp(c.secondary, c.accent, Curves.easeInOut.transform(_c.value)),
            borderRadius: BorderRadius.circular(widget.radius),
          ),
        ),
      ),
    );
  }
}

/// A paragraph of [lines] skeleton bars; the last is [lastFraction] wide.
/// Announces a single "Loading" label.
class SkeletonLines extends StatelessWidget {
  const SkeletonLines({super.key, this.lines = 3, this.lineHeight = 12, this.gap = 8, this.lastFraction = 0.6});

  final int lines;
  final double lineHeight;
  final double gap;
  final double lastFraction;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < lines; i++) ...[
            if (i > 0) SizedBox(height: gap),
            i == lines - 1 && lines > 1
                ? FractionallySizedBox(widthFactor: lastFraction, child: SkeletonBlock(height: lineHeight))
                : SkeletonBlock(height: lineHeight),
          ],
        ],
      ),
    );
  }
}
