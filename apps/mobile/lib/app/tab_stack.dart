import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';

/// Keeps every visited tab alive and cross-fades between them (about 200 ms,
/// instant under reduced motion). Hidden tabs are offstage with their tickers
/// paused, so scroll positions survive and nothing animates unseen. Tabs that
/// were never opened are not built.
class TabStack extends StatelessWidget {
  const TabStack({super.key, required this.index, required this.visited, required this.builders});

  final int index;
  final Set<int> visited;
  final List<WidgetBuilder> builders;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        for (var i = 0; i < builders.length; i++)
          if (visited.contains(i) || i == index)
            _TabFade(key: ValueKey('tab-$i'), active: i == index, child: builders[i](context)),
      ],
    );
  }
}

class _TabFade extends StatefulWidget {
  const _TabFade({super.key, required this.active, required this.child});

  final bool active;
  final Widget child;

  @override
  State<_TabFade> createState() => _TabFadeState();
}

class _TabFadeState extends State<_TabFade> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, value: widget.active ? 1 : 0);
  late final Animation<double> _fade = CurvedAnimation(parent: _c, curve: LbMotion.curve);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _c.duration = LbMotion.duration(context);
  }

  @override
  void didUpdateWidget(_TabFade old) {
    super.didUpdateWidget(old);
    if (old.active == widget.active) return;
    if (widget.active) {
      _c.forward();
    } else {
      _c.reverse();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      child: widget.child,
      builder: (context, child) {
        final hidden = !widget.active && _c.isDismissed;
        return Offstage(
          offstage: hidden,
          child: TickerMode(
            enabled: !hidden,
            child: IgnorePointer(
              ignoring: !widget.active,
              child: FadeTransition(opacity: _fade, child: child),
            ),
          ),
        );
      },
    );
  }
}
