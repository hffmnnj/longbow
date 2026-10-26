import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/data/data.dart';

/// Notification links waiting for the shell. The gate fills it from the cold
/// start link and the native link stream, so a link that arrives while the
/// app is still connecting is not lost; the shell drains it once mounted.
class DeepLinkQueue extends Notifier<List<DeepLink>> {
  @override
  List<DeepLink> build() => const [];

  void add(DeepLink link) => state = [...state, link];

  /// Returns the queued links in arrival order and empties the queue.
  List<DeepLink> take() {
    final links = state;
    if (links.isNotEmpty) state = const [];
    return links;
  }
}

final deepLinkQueueProvider = NotifierProvider<DeepLinkQueue, List<DeepLink>>(DeepLinkQueue.new);
