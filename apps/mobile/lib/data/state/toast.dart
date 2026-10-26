import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Toasts are a broadcast [Stream]: the store enqueues them, the shell shows
/// snackbars. This mirrors the web `toast` calls in store.svelte.ts and
/// sim.svelte.ts without importing any widget code.
enum ToastTone { success, error, info }

class ToastEvent {
  const ToastEvent({
    required this.tone,
    required this.title,
    this.body = '',
    this.actionLabel,
    this.reportId,
  });

  final ToastTone tone;
  final String title;
  final String body;

  /// Label of the snackbar action (for example "Open"); when set with
  /// [reportId], the action opens that report.
  final String? actionLabel;
  final String? reportId;
}

class ToastQueue {
  final _controller = StreamController<ToastEvent>.broadcast();

  Stream<ToastEvent> get stream => _controller.stream;

  void add(ToastEvent event) {
    if (!_controller.isClosed) _controller.add(event);
  }

  void dispose() {
    unawaited(_controller.close());
  }
}

final toastQueueProvider = Provider<ToastQueue>((ref) {
  final queue = ToastQueue();
  ref.onDispose(queue.dispose);
  return queue;
});

/// Toast events for the shell's snackbar layer, in enqueue order.
final toastEventsProvider =
    StreamProvider<ToastEvent>((ref) => ref.watch(toastQueueProvider).stream);
