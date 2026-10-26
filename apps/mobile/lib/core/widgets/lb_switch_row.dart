import 'package:flutter/material.dart';

import '../haptics.dart';

/// Settings row with a title, optional subtitle, and a trailing Switch. The
/// whole row is the tap target (56dp+).
class LbSwitchRow extends StatelessWidget {
  const LbSwitchRow({super.key, required this.title, required this.value, required this.onChanged, this.subtitle});

  final String title;
  final String? subtitle;
  final bool value;

  /// Null disables the row.
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(title),
      subtitle: subtitle == null ? null : Text(subtitle!),
      value: value,
      onChanged: onChanged == null
          ? null
          : (v) {
              Haptics.selection();
              onChanged!(v);
            },
    );
  }
}
