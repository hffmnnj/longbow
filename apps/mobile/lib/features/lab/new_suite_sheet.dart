import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;
import 'package:longbow/models/models.dart';

import 'form_widgets.dart';
import 'lab_widgets.dart';

/// Opens the new-suite form as a tall sheet. On a successful start the sheet
/// closes, a toast confirms, and the new suite opens.
Future<void> showNewSuiteSheet(BuildContext context) async {
  final id = await showLbSheet<String>(
    context,
    (_) => const NewSuiteForm(),
    title: 'New suite',
    fullHeight: true,
  );
  if (id == null || !context.mounted) return;
  showToast(context, 'Suite started', tone: ToastTone.success);
  await AppNav.suite(context, id);
}

const int _maxScenarios = 12;

class _VariantDraft {
  _VariantDraft(String label, this.model)
    : label = TextEditingController(text: label);

  final TextEditingController label;
  final TextEditingController strategy = TextEditingController();
  SimModel model;
  Map<RiskKey, String> overrides = const {};

  void dispose() {
    label.dispose();
    strategy.dispose();
  }
}

/// The new-suite form. Public so tests can pump it directly.
class NewSuiteForm extends ConsumerStatefulWidget {
  const NewSuiteForm({super.key});

  @override
  ConsumerState<NewSuiteForm> createState() => _NewSuiteFormState();
}

class _NewSuiteFormState extends ConsumerState<NewSuiteForm> {
  final _name = TextEditingController();
  final _cash = TextEditingController(text: '1200');
  final _a = _VariantDraft('A', SimModel.main);
  final _b = _VariantDraft('B', SimModel.subagent);

  List<String> _picked = const [];
  bool _pickedTouched = false;
  ScenarioMode _scenarioMode = ScenarioMode.blind;
  int _bootstrapRuns = 0;
  int _bootstrapDays = 40;
  SimExecution _execution = SimExecution.realistic;
  int _cycles = 2;
  int _variantCount = 2;
  String? _serverError;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      if (!mounted) return;
      await ref.read(simProvider.notifier).loadScenarios();
      if (mounted) _defaultPicks(ref.read(simProvider).scenarios);
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _cash.dispose();
    _a.dispose();
    _b.dispose();
    super.dispose();
  }

  /// The first two scenarios, until the user chooses.
  void _defaultPicks(List<SimScenario> scenarios) {
    if (_pickedTouched || _picked.isNotEmpty || scenarios.isEmpty) return;
    setState(() => _picked = scenarios.take(2).map((s) => s.id).toList());
  }

  void _toggleScenario(String id) {
    setState(() {
      _pickedTouched = true;
      _picked = _picked.contains(id)
          ? _picked.where((x) => x != id).toList()
          : [..._picked, id].take(_maxScenarios).toList();
    });
  }

  Future<void> _start(
    RiskOverridesResult riskA,
    RiskOverridesResult riskB,
  ) async {
    setState(() => _serverError = null);
    final two = _variantCount == 2;
    SimVariant variant(
      _VariantDraft d,
      String fallback,
      RiskOverridesResult risk,
    ) {
      final label = d.label.text.trim();
      final strategy = d.strategy.text.trim();
      return SimVariant(
        label: label.isEmpty ? fallback : label,
        strategy: strategy.isEmpty ? null : strategy,
        risk: risk.risk,
        model: d.model,
      );
    }

    final config = SimSuiteConfig(
      name: _name.text.trim(),
      scenarios: _picked,
      bootstrapRuns: _bootstrapRuns,
      scenarioMode: _scenarioMode,
      bootstrapDays: _bootstrapDays,
      startingCash: double.parse(_cash.text.trim()),
      cyclesPerDay: _cycles,
      execution: _execution,
      watchlist: ref.read(harnessProvider).feed.status?.settings.watchlist,
      variants: [variant(_a, 'A', riskA), if (two) variant(_b, 'B', riskB)],
    );
    final res = await ref.read(simProvider.notifier).startSuite(config);
    if (!mounted) return;
    final suite = res.suite;
    if (suite == null) {
      setState(() => _serverError = res.error ?? 'Could not start the suite');
      return;
    }
    Haptics.success();
    Navigator.of(context).pop(suite.id);
  }

  Widget _variantEditor(
    BuildContext context,
    String title,
    _VariantDraft d,
    RiskOverridesResult risk,
    RiskConfig? live,
  ) {
    return LbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Text(title, style: Theme.of(context).textTheme.titleSmall),
          ),
          const SizedBox(height: 12),
          LbTextField(
            controller: d.label,
            label: 'Label',
            inputFormatters: [LengthLimitingTextInputFormatter(24)],
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          FormBlock(
            label: 'Model',
            child: LbSegmented<SimModel>(
              semanticLabel: '$title model',
              selected: d.model,
              onChanged: (v) => setState(() => d.model = v),
              segments: modelSegments,
            ),
          ),
          const SizedBox(height: 12),
          LbTextField(
            controller: d.strategy,
            label: 'Strategy',
            hint: 'What this variant does differently',
            minLines: 3,
            maxLines: 6,
            keyboardType: TextInputType.multiline,
            inputFormatters: [LengthLimitingTextInputFormatter(2000)],
          ),
          const SizedBox(height: 4),
          RiskOverridesEditor(
            title: 'Risk overrides',
            live: live,
            errors: risk.errors,
            onChanged: (v) => setState(() => d.overrides = v),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sim = ref.watch(simProvider);
    final settings = ref.watch(
      harnessProvider.select((s) => s.feed.status?.settings),
    );
    ref.listen(
      simProvider.select((s) => s.scenarios),
      (_, next) => _defaultPicks(next),
    );

    final scenarios = sim.scenarios;
    final two = _variantCount == 2;
    final markets = _picked.length + _bootstrapRuns;
    final cashError = cashProblem(_cash.text);
    final riskA = riskOverrides(_a.overrides);
    final riskB = two
        ? riskOverrides(_b.overrides)
        : const RiskOverridesResult(errors: {});
    final labelA = _a.label.text.trim();
    final labelB = _b.label.text.trim();
    final labelClash =
        two && labelA.isNotEmpty && labelB.isNotEmpty && labelA == labelB;
    final blocker = _name.text.trim().isEmpty
        ? 'Name the suite'
        : markets == 0
        ? 'Pick at least one scenario or bootstrap market'
        : cashError ??
              (labelClash ? 'Variant labels must differ' : null) ??
              (riskA.errors.isNotEmpty || riskB.errors.isNotEmpty
                  ? 'Fix the risk overrides'
                  : null);
    final canStart = blocker == null && !sim.startingSuite;
    final summary =
        '$markets market${markets == 1 ? '' : 's'} \u00d7 ${two ? 2 : 1} variant${two ? 's' : ''}';

    return LabFormFrame(
      footer: FormFooter(
        summary: summary,
        buttonLabel: 'Start suite',
        busy: sim.startingSuite,
        problem: blocker,
        serverError: _serverError,
        onPressed: canStart ? () => _start(riskA, riskB) : null,
      ),
      children: [
        const Align(alignment: Alignment.centerLeft, child: PaperBadge()),
        LbTextField(
          controller: _name,
          label: 'Name',
          hint: 'Momentum vs defensive',
          inputFormatters: [LengthLimitingTextInputFormatter(80)],
          textInputAction: TextInputAction.next,
          onChanged: (_) => setState(() {}),
        ),
        FormBlock(
          label: 'Scenarios \u00b7 ${_picked.length} picked',
          child: scenarios.isEmpty
              ? Text(
                  sim.scenariosLoaded
                      ? 'The scenario library did not load. Add bootstrap markets below.'
                      : 'Loading scenarios\u2026',
                  style: LbText.muted(context),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < scenarios.length; i++) ...[
                      if (i > 0) const SizedBox(height: 8),
                      ChoiceTile(
                        multi: true,
                        title: scenarios[i].name,
                        description: scenarios[i].description,
                        tag: scenarios[i].regime.name,
                        selected: _picked.contains(scenarios[i].id),
                        onTap: () => _toggleScenario(scenarios[i].id),
                      ),
                    ],
                  ],
                ),
        ),
        if (_picked.isNotEmpty)
          FormBlock(
            label: 'Scenarios run',
            note: 'Blind is recommended: it hides dates and tickers so memory cannot help.',
            child: LbSegmented<ScenarioMode>(
              semanticLabel: 'Scenarios run',
              selected: _scenarioMode,
              onChanged: (v) => setState(() => _scenarioMode = v),
              segments: const [
                LbSegment(ScenarioMode.blind, 'Blind'),
                LbSegment(ScenarioMode.historical, 'Historical'),
              ],
            ),
          ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            LbSliderRow(
              label: 'Bootstrap markets',
              value: _bootstrapRuns.toDouble(),
              min: 0,
              max: 10,
              divisions: 10,
              format: (v) => '${v.round()}',
              onChanged: (v) => setState(() => _bootstrapRuns = v.round()),
            ),
            if (_bootstrapRuns > 0)
              LbSliderRow(
                label: 'Bootstrap days',
                value: _bootstrapDays.toDouble(),
                min: 5,
                max: 120,
                divisions: 115,
                format: (v) => '${v.round()}',
                onChanged: (v) => setState(() => _bootstrapDays = v.round()),
              ),
          ],
        ),
        FormBlock(
          label: 'Execution',
          note: executionNote,
          child: LbSegmented<SimExecution>(
            semanticLabel: 'Execution',
            selected: _execution,
            onChanged: (v) => setState(() => _execution = v),
            segments: executionSegments,
          ),
        ),
        LbNumberField(
          label: 'Cash per run',
          controller: _cash,
          unit: 'USD',
          errorText: cashError,
          onChanged: (_) => setState(() {}),
        ),
        FormBlock(
          label: 'Cycles per day',
          note: cycleNote(_cycles),
          child: LbSegmented<int>(
            semanticLabel: 'Cycles per day',
            selected: _cycles,
            onChanged: (v) => setState(() => _cycles = v),
            segments: cycleSegments,
          ),
        ),
        FormBlock(
          label: 'Variants',
          child: LbSegmented<int>(
            semanticLabel: 'Variants',
            selected: _variantCount,
            onChanged: (v) => setState(() => _variantCount = v),
            segments: const [
              LbSegment(1, 'One'),
              LbSegment(2, 'Two, compared'),
            ],
          ),
        ),
        _variantEditor(context, 'Variant 1', _a, riskA, settings?.risk),
        if (two)
          _variantEditor(context, 'Variant 2', _b, riskB, settings?.risk),
        if (labelClash)
          Text(
            'Variant labels must differ',
            style: Theme.of(context).textTheme.bodySmall
                ?.copyWith(color: context.lb.loss),
          ),
        Text(
          'Every run trades the live watchlist (${settings?.watchlist.length ?? 0} tickers).',
          style: LbText.muted(context, size: 12.5),
        ),
      ],
    );
  }
}
