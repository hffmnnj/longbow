import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../format.dart';
import '../theme/theme.dart';
import 'lb_text_field.dart';

/// Decimal input with an optional [unit] suffix (right-aligned mono) and
/// inline range validation. Shows "Enter a number", "Must be at least N" or
/// "Must be at most N" as the user types. Empty input is allowed unless
/// [required]. [onChanged] receives the parsed value, or null when empty or
/// invalid. A caller-provided [errorText] wins over the built-in message.
class LbNumberField extends StatefulWidget {
  const LbNumberField({
    super.key,
    required this.label,
    this.controller,
    this.initialValue,
    this.unit,
    this.min,
    this.max,
    this.required = false,
    this.errorText,
    this.helperText,
    this.hint,
    this.onChanged,
  });

  final String label;
  final TextEditingController? controller;
  final String? initialValue;
  final String? unit;
  final double? min;
  final double? max;
  final bool required;
  final String? errorText;
  final String? helperText;
  final String? hint;
  final ValueChanged<double?>? onChanged;

  /// Returns the error message for [text], or null when it is acceptable.
  static String? validate(String text, {double? min, double? max, bool required = false}) {
    final t = text.trim();
    if (t.isEmpty) return required ? 'Required' : null;
    final v = double.tryParse(t);
    if (v == null) return 'Enter a number';
    if (min != null && v < min) return 'Must be at least ${qty(min)}';
    if (max != null && v > max) return 'Must be at most ${qty(max)}';
    return null;
  }

  @override
  State<LbNumberField> createState() => _LbNumberFieldState();
}

class _LbNumberFieldState extends State<LbNumberField> {
  TextEditingController? _own;
  TextEditingController get _c => widget.controller ?? (_own ??= TextEditingController(text: widget.initialValue));

  @override
  void dispose() {
    _own?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final signed = (widget.min ?? 0) < 0;
    return ListenableBuilder(
      listenable: _c,
      builder: (context, _) {
        final error = widget.errorText ?? LbNumberField.validate(_c.text, min: widget.min, max: widget.max, required: widget.required);
        return LbTextField(
          controller: _c,
          label: widget.label,
          hint: widget.hint,
          helperText: widget.helperText,
          errorText: error,
          mono: true,
          textAlign: TextAlign.end,
          keyboardType: TextInputType.numberWithOptions(decimal: true, signed: signed),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(signed ? r'[0-9.\-]' : r'[0-9.]'))],
          suffix: widget.unit == null
              ? null
              : Padding(
                  padding: const EdgeInsets.only(right: 14, left: 8),
                  child: Center(widthFactor: 1, child: Text(widget.unit!, style: LbText.muted(context, size: 12))),
                ),
          onChanged: (s) {
            final v = double.tryParse(s.trim());
            final bad = LbNumberField.validate(s, min: widget.min, max: widget.max, required: widget.required) != null;
            widget.onChanged?.call(bad ? null : v);
          },
        );
      },
    );
  }
}
