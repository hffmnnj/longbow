// STUB: replaced by the owning slice. Keep the public class name and constructor.
import 'package:flutter/material.dart';
import 'package:longbow/models/models.dart';

/// One order with status, plan, risk checks, and (when pending) approve and reject.
class OrderCard extends StatelessWidget {
  const OrderCard({super.key, required this.order});

  final OrderRecord order;

  @override
  Widget build(BuildContext context) => Text(order.id);
}
