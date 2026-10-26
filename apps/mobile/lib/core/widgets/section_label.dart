import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// Small uppercase section label ("POSITIONS"). Announced as a header.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.padding = EdgeInsets.zero});

  final String text;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Semantics(
        header: true,
        child: Text(
          text.toUpperCase(),
          style: LbText.caption(context).copyWith(letterSpacing: 0.9, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
