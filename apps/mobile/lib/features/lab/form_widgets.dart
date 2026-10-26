import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/settings_form.dart' as sf;
import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;
import 'package:longbow/models/models.dart';

import 'lab_widgets.dart';

/// Scrolling form body with a pinned footer. Used inside a full-height
/// [showLbSheet]: the fields scroll, the Start button stays put above the
/// keyboard.
class LabFormFrame extends StatelessWidget {
  const LabFormFrame({super.key, required this.children, required this.footer});

  final List<Widget> children;
  final Widget footer;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(
              LbSpace.screen,
              4,
              LbSpace.screen,
              LbSpace.screen,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < children.length; i++) ...[
                  if (i > 0) const SizedBox(height: 20),
                  children[i],
                ],
              ],
            ),
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: c.popover,
            border: Border(top: BorderSide(color: c.border)),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              LbSpace.screen,
              10,
              LbSpace.screen,
              10,
            ),
            child: footer,
          ),
        ),
      ],
    );
  }
}

/// A labelled form block: a small caption over its content.
class FormBlock extends StatelessWidget {
  const FormBlock({
    super.key,
    required this.label,
    required this.child,
    this.note,
    this.trailing,
  });

  final String label;
  final Widget child;

  /// Plain explanation under the control.
  final String? note;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: SectionLabel(label)),
            ?trailing,
          ],
        ),
        const SizedBox(height: 8),
        child,
        if (note != null) ...[
          const SizedBox(height: 6),
          Text(note!, style: LbText.muted(context, size: 12.5)),
        ],
      ],
    );
  }
}

/// A selectable card for a scenario or any single or multiple choice with a
/// short description.
class ChoiceTile extends StatelessWidget {
  const ChoiceTile({
    super.key,
    required this.title,
    required this.selected,
    required this.onTap,
    this.description,
    this.tag,
    this.multi = false,
  });

  final String title;
  final String? description;

  /// Short caps tag on the right, such as the regime.
  final String? tag;
  final bool selected;
  final bool multi;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final mark = DecoratedBox(
      decoration: BoxDecoration(
        shape: multi ? BoxShape.rectangle : BoxShape.circle,
        borderRadius: multi ? BorderRadius.circular(5) : null,
        color: selected ? c.lab : null,
        border: Border.all(color: selected ? c.lab : c.input, width: 1.5),
      ),
      child: SizedBox(
        width: 20,
        height: 20,
        child: selected
            ? LbIcon(LbIcons.check, size: 14, color: c.background)
            : null,
      ),
    );
    return Semantics(
      checked: selected,
      inMutuallyExclusiveGroup: !multi,
      child: LbCard(
        color: selected ? c.labBg : null,
        borderColor: selected ? c.lab.withValues(alpha: 0.6) : null,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        onTap: onTap,
        semanticLabel: title,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(padding: const EdgeInsets.only(top: 2), child: mark),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: t.titleSmall),
                  if (description != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      description!,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: LbText.muted(context, size: 12.5),
                    ),
                  ],
                ],
              ),
            ),
            if (tag != null) ...[
              const SizedBox(width: 8),
              LabTag(tag!.toUpperCase(), neutral: true),
            ],
          ],
        ),
      ),
    );
  }
}

const List<LbSegment<int>> cycleSegments = [
  LbSegment(2, '2'),
  LbSegment(3, '3'),
  LbSegment(4, '4'),
];

/// What the chosen number of agent cycles per simulated day means.
String cycleNote(int cycles) => switch (cycles) {
  3 => 'Open check, close review, plus a pre-open check at 09:00 ET.',
  4 => 'Open check, close review, plus pre-open (09:00) and midday (12:30) checks.',
  _ => 'An open check at 10:15 ET and a close review at 15:45 ET.',
};

/// Plain-language title and explanation of an environment.
({String title, String note}) modeCopy(SimMode mode) => switch (mode) {
  SimMode.historical => (
    title: 'Historical',
    note: 'Real dates and tickers. Good for replaying a known period, though the agent may remember how it ended.',
  ),
  SimMode.blind => (
    title: 'Blind',
    note: 'Real market moves with the dates shifted and the tickers renamed, so memory of real events cannot help.',
  ),
  SimMode.bootstrap => (
    title: 'Bootstrap',
    note: 'Synthetic markets built by resampling about ten years of daily returns. No real dates at all.',
  ),
};

const List<LbSegment<SimExecution>> executionSegments = [
  LbSegment(SimExecution.realistic, 'Realistic'),
  LbSegment(SimExecution.ideal, 'Ideal'),
];

const List<LbSegment<SimModel>> modelSegments = [
  LbSegment(SimModel.main, 'Lead'),
  LbSegment(SimModel.subagent, 'Subagent'),
];

const String executionNote =
    'Realistic pays spread and slippage. Ideal fills at the limit price.';

/// Cash validation shared by both forms.
String? cashProblem(String raw) {
  final n = double.tryParse(raw.trim());
  if (n == null || !n.isFinite || n <= 0) return 'Enter an amount above zero';
  if (n > 1000000) return 'Max \$1,000,000';
  return null;
}

/// Ticker chips plus an add field.
class WatchlistEditor extends StatefulWidget {
  const WatchlistEditor({
    super.key,
    required this.tickers,
    required this.onChanged,
  });

  final List<String> tickers;
  final ValueChanged<List<String>> onChanged;

  @override
  State<WatchlistEditor> createState() => _WatchlistEditorState();
}

class _WatchlistEditorState extends State<WatchlistEditor> {
  final TextEditingController _input = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _add() {
    final r = sf.parseTickers(_input.text, widget.tickers);
    widget.onChanged([...widget.tickers, ...r.added]);
    setState(() {
      _error = r.rejected.isEmpty
          ? null
          : 'Not a ticker: ${r.rejected.join(', ')}';
      _input.text = r.rejected.join(' ');
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.tickers.isEmpty)
          Text(
            'No tickers. Add at least one.',
            style: LbText.muted(context, size: 13),
          )
        else
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final t in widget.tickers)
                InputChip(
                  label: Text(t, style: LbText.number(context, size: 13)),
                  deleteButtonTooltipMessage: 'Remove $t',
                  deleteIconColor: c.mutedForeground,
                  onDeleted: () =>
                      widget.onChanged([...widget.tickers]..remove(t)),
                ),
            ],
          ),
        const SizedBox(height: 8),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: LbTextField(
                controller: _input,
                hint: 'Add tickers, e.g. NVDA AAPL',
                mono: true,
                errorText: _error,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _add(),
              ),
            ),
            const SizedBox(width: 8),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: OutlinedButton(onPressed: _add, child: const Text('Add')),
            ),
          ],
        ),
      ],
    );
  }
}

num _liveRisk(RiskConfig r, sf.RiskKey k) => switch (k) {
  sf.RiskKey.maxRiskPerTradePct => r.maxRiskPerTradePct,
  sf.RiskKey.maxPositionPct => r.maxPositionPct,
  sf.RiskKey.maxSectorPct => r.maxSectorPct,
  sf.RiskKey.maxPositions => r.maxPositions,
  sf.RiskKey.maxOrderNotionalUsd => r.maxOrderNotionalUsd,
  sf.RiskKey.dailyLossHaltPct => r.dailyLossHaltPct,
  sf.RiskKey.monthlyDrawdownHaltPct => r.monthlyDrawdownHaltPct,
  sf.RiskKey.maxEntriesPerDay => r.maxEntriesPerDay,
  sf.RiskKey.maxDayTrades5d => r.maxDayTrades5d,
  sf.RiskKey.minHoldDays => r.minHoldDays,
  sf.RiskKey.noTradeOpenMinutes => r.noTradeOpenMinutes,
  sf.RiskKey.noTradeCloseMinutes => r.noTradeCloseMinutes,
  sf.RiskKey.maxSpreadBps => r.maxSpreadBps,
  sf.RiskKey.maxSlippageBps => r.maxSlippageBps,
  sf.RiskKey.minEvToCost => r.minEvToCost,
};

/// Collapsible per-field risk overrides. Blank means "use the live setting"
/// (shown as the hint). Reports the raw text of every field on each edit;
/// validation comes from [riskOverrides] and arrives through [errors].
class RiskOverridesEditor extends StatefulWidget {
  const RiskOverridesEditor({
    super.key,
    required this.onChanged,
    required this.errors,
    this.live,
    this.title = 'Risk overrides',
  });

  final String title;
  final ValueChanged<Map<RiskKey, String>> onChanged;

  /// `risk.<key>` to message, from [RiskOverridesResult.errors].
  final Map<String, String> errors;

  /// The live risk settings, shown as placeholders.
  final RiskConfig? live;

  @override
  State<RiskOverridesEditor> createState() => _RiskOverridesEditorState();
}

class _RiskOverridesEditorState extends State<RiskOverridesEditor> {
  final Map<sf.RiskKey, TextEditingController> _controllers = {
    for (final k in sf.riskKeys) k: TextEditingController(),
  };

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _report() {
    widget.onChanged({
      for (final e in _controllers.entries)
        RiskKey.values.byName(e.key.name): e.value.text,
    });
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final set = _controllers.values
        .where((x) => x.text.trim().isNotEmpty)
        .length;
    return Disclosure(
      title: widget.title,
      trailing: set == 0
          ? null
          : Text(
              '$set set',
              style: LbText.number(context, size: 12, color: c.lab),
            ),
      child: Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 4),
        child: LayoutBuilder(
          builder: (context, box) {
            final cols = box.maxWidth >= 480 ? 2 : 1;
            const gap = 12.0;
            final w = (box.maxWidth - gap * (cols - 1)) / cols;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final group in sf.riskGroups) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 8, bottom: 8),
                    child: SectionLabel(group.title),
                  ),
                  Wrap(
                    spacing: gap,
                    runSpacing: 12,
                    children: [
                      for (final f in group.fields)
                        SizedBox(
                          width: w,
                          child: LbTextField(
                            controller: _controllers[f.key],
                            label: f.label,
                            hint: widget.live == null
                                ? null
                                : '${_liveRisk(widget.live!, f.key)}',
                            mono: true,
                            textAlign: TextAlign.end,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            suffix: Padding(
                              padding: const EdgeInsets.only(
                                right: 12,
                                left: 8,
                              ),
                              child: Center(
                                widthFactor: 1,
                                child: Text(
                                  f.unit,
                                  style: LbText.muted(context, size: 12),
                                ),
                              ),
                            ),
                            errorText: widget.errors['risk.${f.key.name}'],
                            onChanged: (_) => _report(),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The pinned footer of both forms: server or validation message, a summary,
/// and the lab-colored start button.
class FormFooter extends StatelessWidget {
  const FormFooter({
    super.key,
    required this.summary,
    required this.buttonLabel,
    required this.busy,
    required this.onPressed,
    this.problem,
    this.serverError,
  });

  final String summary;
  final String buttonLabel;
  final bool busy;

  /// Null disables the button.
  final VoidCallback? onPressed;

  /// Why the button is disabled, in one short sentence.
  final String? problem;
  final String? serverError;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (serverError != null)
          Semantics(
            liveRegion: true,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                serverError!,
                style: Theme.of(context).textTheme.bodySmall
                    ?.copyWith(color: c.loss),
              ),
            ),
          )
        else if (problem != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              problem!,
              style: Theme.of(context).textTheme.bodySmall
                  ?.copyWith(color: c.warn),
            ),
          ),
        Text(
          summary,
          style: LbText.number(
            context,
            size: 12,
            color: c.mutedForeground,
            weight: FontWeight.w400,
          ),
        ),
        const SizedBox(height: 8),
        LabButton(label: buttonLabel, busy: busy, onPressed: onPressed),
      ],
    );
  }
}
