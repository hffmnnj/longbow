import 'package:flutter/material.dart';

import '../icons.dart';
import '../motion.dart';
import '../theme/theme.dart';

/// Collapsible section: a 48dp+ header row with an animated chevron over
/// content that expands in place. Uncontrolled; set [initiallyExpanded].
class Disclosure extends StatefulWidget {
  const Disclosure({
    super.key,
    required this.title,
    required this.child,
    this.initiallyExpanded = false,
    this.trailing,
    this.onChanged,
  });

  final String title;
  final Widget child;
  final bool initiallyExpanded;

  /// Shown before the chevron (a count, a chip).
  final Widget? trailing;
  final ValueChanged<bool>? onChanged;

  @override
  State<Disclosure> createState() => _DisclosureState();
}

class _DisclosureState extends State<Disclosure> {
  late bool _open = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final d = LbMotion.duration(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          button: true,
          expanded: _open,
          child: InkWell(
            borderRadius: BorderRadius.circular(LbRadius.md),
            onTap: () {
              setState(() => _open = !_open);
              widget.onChanged?.call(_open);
            },
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: kMinTarget),
              child: Row(
                children: [
                  Expanded(child: Text(widget.title, style: Theme.of(context).textTheme.titleSmall)),
                  if (widget.trailing != null) ...[widget.trailing!, const SizedBox(width: 8)],
                  AnimatedRotation(
                    turns: _open ? 0.5 : 0,
                    duration: d,
                    curve: LbMotion.curve,
                    child: LbIcon(LbIcons.chevronDown, size: 20, color: context.lb.mutedForeground),
                  ),
                  const SizedBox(width: 4),
                ],
              ),
            ),
          ),
        ),
        AnimatedSize(
          duration: d,
          curve: LbMotion.curve,
          alignment: Alignment.topCenter,
          child: _open ? widget.child : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}
