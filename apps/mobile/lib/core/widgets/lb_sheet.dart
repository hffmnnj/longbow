import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme/theme.dart';

/// Opens a modal bottom sheet in the Longbow style: grabber, 20dp top
/// corners, drag to dismiss, at most 92% of the screen height, safe-area and
/// keyboard aware.
///
/// By default the content from [builder] is placed in a scroll view and the
/// sheet is as tall as its content. With [fullHeight] the sheet fills the 92%
/// and the content gets a bounded box, so return your own scrollable (a
/// ListView). Pop with `Navigator.pop(context, value)`; the future resolves
/// to that value (null when dismissed). [title] adds a header with a close
/// button.
Future<T?> showLbSheet<T>(
  BuildContext context,
  WidgetBuilder builder, {
  String? title,
  bool fullHeight = false,
}) {
  final maxHeight = MediaQuery.sizeOf(context).height * 0.92;
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    enableDrag: true,
    showDragHandle: true,
    constraints: BoxConstraints(maxWidth: 640, maxHeight: maxHeight),
    builder: (ctx) => _SheetFrame(title: title, fullHeight: fullHeight, builder: builder),
  );
}

class _SheetFrame extends StatelessWidget {
  const _SheetFrame({required this.title, required this.fullHeight, required this.builder});

  final String? title;
  final bool fullHeight;
  final WidgetBuilder builder;

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final bottom = mq.viewInsets.bottom > 0 ? mq.viewInsets.bottom : mq.padding.bottom;
    final body = Builder(builder: builder);
    final header = title == null
        ? null
        : Padding(
            padding: const EdgeInsets.only(left: LbSpace.screen + 4, right: 4),
            child: Row(
              children: [
                Expanded(
                  child: Semantics(header: true, child: Text(title!, style: Theme.of(context).textTheme.titleLarge)),
                ),
                IconButton(
                  tooltip: 'Close',
                  onPressed: () => Navigator.of(context).maybePop(),
                  icon: const LbIcon(LbIcons.close),
                ),
              ],
            ),
          );
    final content = fullHeight
        ? Expanded(child: body)
        : Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: LbSpace.screen),
              child: body,
            ),
          );
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: Column(
        mainAxisSize: fullHeight ? MainAxisSize.max : MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ?header,
          content,
          if (!fullHeight) const SizedBox(height: LbSpace.screen),
        ],
      ),
    );
  }
}
