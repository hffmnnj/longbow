import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';

/// Longest message the server accepts.
const int kMaxMessageChars = 8000;

/// Counter appears once the draft is this long.
const int kCounterFrom = 7000;

/// Message box docked under the transcript. Grows to about five lines; Send is
/// a 48dp button, disabled when empty or over [kMaxMessageChars]. Sends
/// optimistically through the harness outbox, so the bubble appears at once.
class Composer extends ConsumerStatefulWidget {
  const Composer({super.key});

  @override
  ConsumerState<Composer> createState() => _ComposerState();
}

class _ComposerState extends ConsumerState<Composer> {
  final TextEditingController _text = TextEditingController();
  final FocusNode _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _text.addListener(_changed);
  }

  @override
  void dispose() {
    _text.removeListener(_changed);
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  String _lastShape = '';

  // Rebuild only when the send state or the counter could change.
  void _changed() {
    final len = _text.text.length;
    final shape = '${_text.text.trim().isEmpty}|${len > kMaxMessageChars}|${len >= kCounterFrom ? len : 0}';
    if (shape != _lastShape) {
      _lastShape = shape;
      setState(() {});
    }
  }

  bool get _canSend {
    final value = _text.text;
    return value.trim().isNotEmpty && value.length <= kMaxMessageChars;
  }

  void _send() {
    if (!_canSend) return;
    final value = _text.text.trim();
    _text.clear();
    Haptics.light();
    ref.read(harnessProvider.notifier).send(value);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final running = ref.watch(agentRunningProvider);
    final length = _text.text.length;
    final over = length > kMaxMessageChars;
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return DecoratedBox(
      decoration: BoxDecoration(color: c.bar, border: Border(top: BorderSide(color: c.border))),
      child: Padding(
        padding: EdgeInsets.fromLTRB(LbSpace.gap, LbSpace.gap, LbSpace.gap, LbSpace.gap + inset),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Focus(
                    onKeyEvent: (node, event) {
                      // Hardware keyboards: Enter sends, Shift+Enter breaks the line.
                      if (event is KeyDownEvent &&
                          event.logicalKey == LogicalKeyboardKey.enter &&
                          !HardwareKeyboard.instance.isShiftPressed &&
                          _canSend) {
                        _send();
                        return KeyEventResult.handled;
                      }
                      return KeyEventResult.ignored;
                    },
                    child: Semantics(
                      label: 'Message the agent',
                      textField: true,
                      child: LbTextField(
                        controller: _text,
                        focusNode: _focus,
                        hint: running ? 'Agent is working. Messages queue.' : 'Message the agent',
                        minLines: 1,
                        maxLines: 5,
                        keyboardType: TextInputType.multiline,
                        textInputAction: TextInputAction.newline,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox.square(
                  dimension: kMinTarget,
                  child: IconButton.filled(
                    tooltip: 'Send message',
                    onPressed: _canSend ? _send : null,
                    style: IconButton.styleFrom(minimumSize: const Size.square(kMinTarget), fixedSize: const Size.square(kMinTarget)),
                    icon: const LbIcon(LbIcons.arrowUp02, size: 22),
                  ),
                ),
              ],
            ),
            if (length >= kCounterFrom)
              Padding(
                padding: const EdgeInsets.only(top: 4, right: 56),
                child: Semantics(
                  liveRegion: over,
                  child: Text(
                    over ? '$length / $kMaxMessageChars \u00b7 too long to send' : '$length / $kMaxMessageChars',
                    textAlign: TextAlign.end,
                    style: LbText.number(context, size: 11.5, weight: FontWeight.w400, color: over ? c.loss : c.mutedForeground),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
