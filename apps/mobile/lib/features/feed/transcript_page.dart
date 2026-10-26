// STUB: replaced by the owning feature slice. Keep the public class name and constructor.
import 'package:flutter/material.dart';

class TranscriptPage extends StatelessWidget {
  const TranscriptPage({super.key, required this.conversationId, this.simRunId});

  final String conversationId;

  /// Set when the conversation belongs to a simulation run.
  final String? simRunId;

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(), body: Center(child: Text('Transcript')));
}
