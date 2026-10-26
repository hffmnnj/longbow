// STUB: replaced by the owning feature slice. Keep the public class name and constructor.
import 'package:flutter/material.dart';

/// Opens the order detail modal sheet for [orderId].
Future<void> showOrderSheet(BuildContext context, String orderId) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => SizedBox(height: 300, child: Center(child: Text(orderId))),
  );
}
