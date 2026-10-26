import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// Confirmation dialog. Resolves true only when the user presses the confirm
/// button; cancel, back, and tapping outside resolve false. [destructive]
/// colors the confirm button red.
Future<bool> showLbConfirm(
  BuildContext context, {
  required String title,
  String? message,
  String confirmLabel = 'Confirm',
  String cancelLabel = 'Cancel',
  bool destructive = false,
}) async {
  final c = context.lb;
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: message == null ? null : Text(message),
      actionsOverflowDirection: VerticalDirection.down,
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          style: TextButton.styleFrom(foregroundColor: c.mutedForeground),
          child: Text(cancelLabel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          style: destructive ? FilledButton.styleFrom(backgroundColor: c.destructive, foregroundColor: c.primaryForeground) : null,
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}
