// STUB: replaced by the Feed slice. Keep the public class name and constructor.
import 'package:flutter/material.dart';
import 'package:longbow/data/data.dart';

/// The agent transcript (messages, work steps, tool traces, decisions, subagent
/// lane) rendered from any [FeedState]. The Feed screen feeds it the live
/// account; the Lab feeds it one simulation run's state.
class FeedTranscriptView extends StatelessWidget {
  const FeedTranscriptView({
    super.key,
    required this.feed,
    required this.loadTranscript,
    this.simRunId,
  });

  final FeedState feed;

  /// Loads a subagent conversation into the owning store.
  final Future<void> Function(String conversationId) loadTranscript;

  /// Set when [feed] belongs to a simulation run (routes transcript pages back to it).
  final String? simRunId;

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
