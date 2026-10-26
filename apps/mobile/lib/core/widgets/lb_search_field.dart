import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme/theme.dart';

/// Search input with a leading magnifier and a clear button that appears
/// when there is text.
class LbSearchField extends StatefulWidget {
  const LbSearchField({super.key, this.controller, this.hint = 'Search', this.onChanged, this.onSubmitted, this.autofocus = false});

  final TextEditingController? controller;
  final String hint;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;

  @override
  State<LbSearchField> createState() => _LbSearchFieldState();
}

class _LbSearchFieldState extends State<LbSearchField> {
  TextEditingController? _own;
  TextEditingController get _c => widget.controller ?? (_own ??= TextEditingController());

  @override
  void dispose() {
    _own?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return ListenableBuilder(
      listenable: _c,
      builder: (context, _) => TextField(
        controller: _c,
        autofocus: widget.autofocus,
        textInputAction: TextInputAction.search,
        onChanged: widget.onChanged,
        onSubmitted: widget.onSubmitted,
        cursorColor: c.primary,
        style: Theme.of(context).textTheme.bodyMedium,
        decoration: InputDecoration(
          hintText: widget.hint,
          prefixIcon: LbIcon(LbIcons.search01, size: 20, color: c.mutedForeground),
          suffixIcon: _c.text.isEmpty
              ? null
              : IconButton(
                  tooltip: 'Clear search',
                  icon: const LbIcon(LbIcons.close, size: 18),
                  onPressed: () {
                    _c.clear();
                    widget.onChanged?.call('');
                  },
                ),
        ),
      ),
    );
  }
}
