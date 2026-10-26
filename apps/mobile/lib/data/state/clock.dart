import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Tick interval for [clockProvider]. Overridden in tests with milliseconds.
final clockTickProvider =
    Provider<Duration>((_) => const Duration(seconds: 1));

/// One shared 1 Hz clock for countdowns (port of clock.svelte.ts). The store
/// layer never touches widgets, so the shell pauses and resumes this around
/// `AppLifecycleState` changes by calling [Clock.pause] and [Clock.resume].
class Clock extends Notifier<DateTime> {
  Timer? _timer;

  @override
  DateTime build() {
    final tick = ref.watch(clockTickProvider);
    _timer?.cancel();
    _timer = Timer.periodic(tick, (_) {
      if (!ref.mounted) return;
      state = DateTime.now();
    });
    ref.onDispose(() {
      _timer?.cancel();
      _timer = null;
    });
    return DateTime.now();
  }

  void pause() {
    _timer?.cancel();
    _timer = null;
  }

  void resume() {
    if (_timer != null) return;
    if (!ref.mounted) return;
    state = DateTime.now();
    final tick = ref.read(clockTickProvider);
    _timer = Timer.periodic(tick, (_) {
      if (!ref.mounted) return;
      state = DateTime.now();
    });
  }
}

final clockProvider = NotifierProvider<Clock, DateTime>(Clock.new);
