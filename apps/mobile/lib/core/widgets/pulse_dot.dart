import 'package:flutter/material.dart';

import '../motion.dart';
import '../theme/theme.dart';

/// Live indicator: a solid dot with a slow expanding ring. Static when the
/// platform requests reduced motion. Decorative; give the surrounding text
/// the meaning.
class PulseDot extends StatefulWidget {
  const PulseDot({super.key, this.color, this.size = 8});

  /// Defaults to `context.lb.live`.
  final Color? color;
  final double size;

  @override
  State<PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<PulseDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (LbMotion.reduced(context)) {
      _c.stop();
      _c.value = 0;
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? context.lb.live;
    final s = widget.size;
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: s * 2,
        child: AnimatedBuilder(
          animation: _c,
          builder: (context, _) {
            final t = Curves.easeOut.transform(_c.value);
            return CustomPaint(painter: _DotPainter(color, s, t));
          },
        ),
      ),
    );
  }
}

class _DotPainter extends CustomPainter {
  _DotPainter(this.color, this.dot, this.t);
  final Color color;
  final double dot;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    if (t > 0) {
      canvas.drawCircle(c, dot / 2 + (dot / 2) * t, Paint()..color = color.withValues(alpha: 0.45 * (1 - t)));
    }
    canvas.drawCircle(c, dot / 2, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_DotPainter old) => old.t != t || old.color != color || old.dot != dot;
}
