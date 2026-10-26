import 'dart:async';

/// A controllable clock and delay for connection tests: no real time passes.
/// Tests advance time explicitly; pending delays fire in due order with the
/// event loop pumped between them so reconnect loops can progress.
class ManualClock {
  DateTime now = DateTime.utc(2026, 10, 26);

  final List<_Slot> _pending = [];

  DateTime call() => now;

  Future<void> delay(Duration duration) {
    final completer = Completer<void>();
    _pending.add(_Slot(now.add(duration), completer));
    return completer.future;
  }

  double noJitter() => 0;

  Future<void> advance(Duration duration) async {
    final target = now.add(duration);
    while (true) {
      _pending.sort((a, b) => a.at.compareTo(b.at));
      final index = _pending.indexWhere(
          (slot) => !slot.done && slot.at.compareTo(target) <= 0);
      if (index < 0) break;
      final slot = _pending.removeAt(index);
      if (slot.at.isAfter(now)) now = slot.at;
      slot.complete();
      await pump();
    }
    now = target;
    await pump();
  }

  Future<void> pump([int rounds = 30]) async {
    for (var i = 0; i < rounds; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }
}

class _Slot {
  _Slot(this.at, this.completer);

  final DateTime at;
  final Completer<void> completer;
  bool done = false;

  void complete() {
    if (!done) {
      done = true;
      completer.complete();
    }
  }
}
