import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../haptics.dart';
import '../icons.dart';
import '../theme/theme.dart';
import 'toast.dart';

/// Monospace code panel that scrolls horizontally and has a 48dp copy button.
/// Selectable. Used by `LbMarkdown` for fenced code, and usable directly for
/// JSON or tool output.
class CodeBlock extends StatelessWidget {
  const CodeBlock(this.code, {super.key, this.maxHeight});

  final String code;

  /// Caps the height (the block scrolls vertically past it).
  final double? maxHeight;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    Widget text = SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(12, 12, 0, 12),
      child: Padding(
        padding: const EdgeInsets.only(right: 48),
        child: SelectableText(code, style: LbText.number(context, size: 12.5, weight: FontWeight.w400).copyWith(height: 1.5)),
      ),
    );
    if (maxHeight != null) {
      text = ConstrainedBox(constraints: BoxConstraints(maxHeight: maxHeight!), child: SingleChildScrollView(child: text));
    }
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.muted,
        borderRadius: BorderRadius.circular(LbRadius.md),
        border: Border.all(color: c.border),
      ),
      child: Stack(
        children: [
          text,
          Positioned(
            top: 0,
            right: 0,
            child: IconButton(
              tooltip: 'Copy code',
              icon: LbIcon(LbIcons.copy01, size: 18, color: c.mutedForeground),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: code));
                Haptics.light();
                if (context.mounted) showToast(context, 'Copied', tone: ToastTone.success);
              },
            ),
          ),
        ],
      ),
    );
  }
}
