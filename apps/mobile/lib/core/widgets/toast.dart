import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme/theme.dart';

enum ToastTone { info, success, warning, error }

/// Optional action on a toast ("Undo").
class ToastAction {
  const ToastAction(this.label, this.onPressed);
  final String label;
  final VoidCallback onPressed;
}

/// Shows a floating snack bar, replacing any current one. Safe to call when
/// no [ScaffoldMessenger] exists (does nothing).
void showToast(BuildContext context, String message, {ToastTone tone = ToastTone.info, ToastAction? action}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  final c = context.lb;
  final (IconData icon, Color color) = switch (tone) {
    ToastTone.info => (LbIcons.informationCircle, c.mutedForeground),
    ToastTone.success => (LbIcons.checkmarkCircle02, c.gain),
    ToastTone.warning => (LbIcons.alert02, c.warn),
    ToastTone.error => (LbIcons.alertCircle, c.loss),
  };
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Row(
          children: [
            LbIcon(icon, size: 18, color: color),
            const SizedBox(width: 10),
            Expanded(child: Text(message)),
          ],
        ),
        action: action == null ? null : SnackBarAction(label: action.label, onPressed: action.onPressed),
        duration: const Duration(seconds: 4),
        margin: const EdgeInsets.fromLTRB(LbSpace.screen, 0, LbSpace.screen, LbSpace.screen),
      ),
    );
}
