import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;

/// Host or URL field with a Connect button. Validates through the locator
/// (`normalizeManualHost`), shows its message inline, and re-probes on success.
class HostForm extends ConsumerStatefulWidget {
  const HostForm({super.key, this.submitLabel = 'Connect', this.initialValue, this.autofocus = false, this.onSubmitted});

  final String submitLabel;
  final String? initialValue;
  final bool autofocus;

  /// Called after the locator accepted the host (it may still be unreachable).
  final VoidCallback? onSubmitted;

  @override
  ConsumerState<HostForm> createState() => _HostFormState();
}

class _HostFormState extends ConsumerState<HostForm> {
  late final TextEditingController _controller = TextEditingController(text: widget.initialValue);
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || _controller.text.trim().isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(serverLocatorProvider.notifier).setManualHost(_controller.text);
      widget.onSubmitted?.call();
    } on FormatException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _controller,
      builder: (context, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LbTextField(
            controller: _controller,
            label: 'Host or URL',
            hint: 'name.tailnet.ts.net',
            errorText: _error,
            mono: true,
            autofocus: widget.autofocus,
            keyboardType: TextInputType.url,
            textInputAction: TextInputAction.go,
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: LbSpace.gap),
          FilledButton(
            onPressed: _busy || _controller.text.trim().isEmpty ? null : _submit,
            child: Text(_busy ? 'Connecting\u2026' : widget.submitLabel),
          ),
        ],
      ),
    );
  }
}
