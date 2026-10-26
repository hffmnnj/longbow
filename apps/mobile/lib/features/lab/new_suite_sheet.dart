// STUB: replaced by the owning feature slice. Keep the public class name and constructor.
import 'package:flutter/material.dart';

Future<void> showNewSuiteSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const SizedBox(height: 300, child: Center(child: Text('New suite'))),
  );
}
