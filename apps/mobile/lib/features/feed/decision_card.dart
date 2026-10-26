// STUB: replaced by the owning slice. Keep the public class name and constructor.
import 'package:flutter/material.dart';
import 'package:longbow/models/models.dart';

/// One journal decision: action, symbol, headline, rationale, confidence, evidence.
class DecisionCard extends StatelessWidget {
  const DecisionCard({super.key, required this.entry});

  final JournalEntry entry;

  @override
  Widget build(BuildContext context) => Text(entry.summary);
}
