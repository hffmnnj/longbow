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

/// Opens the new-simulation form as a tall sheet. On a successful start the
/// sheet closes, a toast confirms, and the new run opens.
Future<void> showNewSimSheet(BuildContext context) async {
  final id = await showLbSheet<String>(
    context,
    (_) => const NewSimForm(),
    title: 'New simulation',
    fullHeight: true,
  );
  if (id == null || !context.mounted) return;
  showToast(context, 'Simulation started', tone: ToastTone.success);
  await AppNav.run(context, id);
}

String _ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// The new-simulation form. Public so tests can pump it directly.
class NewSimForm extends ConsumerStatefulWidget {
  const NewSimForm({super.key});

  @override
  ConsumerState<NewSimForm> createState() => _NewSimFormState();
}

class _NewSimFormState extends ConsumerState<NewSimForm> {
  final _name = TextEditingController();
  final _seed = TextEditingController();
  final _startDate = TextEditingController();
  final _cash = TextEditingController();
  final _strategy = TextEditingController();

  String? _scenarioId;
  bool _scenarioTouched = false;
  SimMode _mode = SimMode.blind;
  bool _modeTouched = false;
  SimExecution _execution = SimExecution.realistic;
  SimModel _model = SimModel.main;
  int _days = 10;
  int _cycles = 2;
  List<String> _watchlist = const [];
  Map<RiskKey, String> _overrides = const {};
  String? _serverError;

  @override
  void initState() {
    super.initState();
    final live =
        ref.read(harnessProvider).feed.status?.settings.watchlist ??
        const <String>[];
    final d = defaultSimConfig(watchlist: live);
    _mode = d.mode;
    _execution = d.execution;
    _model = d.model;
    _startDate.text = d.startDate ?? '';
    _days = d.days;
    _cash.text = '${d.startingCash.round()}';
    _cycles = d.cyclesPerDay;
    _watchlist = d.watchlist ?? const [];
    Future.microtask(() async {
      if (!mounted) return;
      await ref.read(simProvider.notifier).loadScenarios();
      if (mounted) _defaultScenario(ref.read(simProvider).scenarios);
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _seed.dispose();
    _startDate.dispose();
    _cash.dispose();
    _strategy.dispose();
    super.dispose();
  }

  /// First scenario, blind, once the library arrives, unless the user already chose.
  void _defaultScenario(List<SimScenario> scenarios) {
    if (_scenarioTouched || _scenarioId != null || scenarios.isEmpty) return;
    setState(() {
      _scenarioId = scenarios.first.id;
      if (!_modeTouched) _mode = SimMode.blind;
    });
  }

  void _pickScenario(String? id) {
    setState(() {
      _scenarioId = id;
      _scenarioTouched = true;
      if (id != null && !_modeTouched) _mode = SimMode.blind;
    });
  }

  void _pickMode(SimMode next) {
    setState(() {
      _mode = next;
      _modeTouched = true;
      _days = next == SimMode.bootstrap ? 40 : 10;
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final initial =
        DateTime.tryParse(_startDate.text.trim()) ??
        now.subtract(const Duration(days: 30));
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(now) ? now : initial,
      firstDate: DateTime(2010),
      lastDate: now,
    );
    if (picked != null) setState(() => _startDate.text = _ymd(picked));
  }

  String? _seedProblem() {
    final s = _seed.text.trim();
    if (s.isEmpty) return null;
    final n = int.tryParse(s);
    return n == null || n < 0 || n > 2147483647
        ? 'Whole number up to 2147483647'
        : null;
  }

  Future<void> _start({
    required SimScenario? scenario,
    required RiskOverridesResult risk,
  }) async {
    setState(() => _serverError = null);
    final bootstrap = _mode == SimMode.bootstrap;
    final name = _name.text.trim();
    final strategy = _strategy.text.trim();
    final seed = _seed.text.trim();
    final config = SimRunConfig(
      name: name.isEmpty ? null : name,
      scenario: bootstrap ? null : scenario?.id,
      mode: _mode,
      execution: _execution,
      model: _model,
      seed: seed.isEmpty ? null : int.parse(seed),
      startDate: bootstrap || scenario != null ? null : _startDate.text.trim(),
      days: !bootstrap && scenario != null ? scenario.days : _days,
      startingCash: double.parse(_cash.text.trim()),
      cyclesPerDay: _cycles,
      watchlist: _watchlist,
      strategy: strategy.isEmpty ? null : strategy,
      risk: risk.risk,
    );
    final res = await ref.read(simProvider.notifier).start(config);
    if (!mounted) return;
    final run = res.run;
    if (run == null) {
      setState(
        () => _serverError = res.error ?? 'Could not start the simulation',
      );
      return;
    }
    Haptics.success();
    Navigator.of(context).pop(run.id);
  }

  @override
  Widget build(BuildContext context) {
    final sim = ref.watch(simProvider);
    final live = ref.watch(
      harnessProvider.select((s) => s.feed.status?.settings),
    );
    ref.listen(
      simProvider.select((s) => s.scenarios),
      (_, next) => _defaultScenario(next),
    );

    final scenarios = sim.scenarios;
    final bootstrap = _mode == SimMode.bootstrap;
    final scenario = bootstrap
        ? null
        : scenarios.where((s) => s.id == _scenarioId).firstOrNull;
    final custom = !bootstrap && scenario == null;
    final maxDays = bootstrap ? 120 : 60;
    final minDays = bootstrap ? 5 : 1;
    final days = _days.clamp(minDays, maxDays);

    final dateProblem = bootstrap || scenario != null
        ? null
        : startDateProblem(_startDate.text.trim(), days);
    final seedProblem = _seedProblem();
    final cashError = cashProblem(_cash.text);
    final risk = riskOverrides(_overrides);
    final blocker =
        dateProblem ??
        cashError ??
        seedProblem ??
        (_watchlist.isEmpty
            ? 'Add at least one ticker to the watchlist'
            : null) ??
        (risk.errors.isNotEmpty ? 'Fix the risk overrides' : null);
    final canStart = blocker == null && !sim.starting;
    final runDays = scenario?.days ?? days;
    final daysLabel = bootstrap
        ? '$runDays bootstrap days'
        : '$runDays trading days';
    final summary =
        '$daysLabel \u00b7 ${formatEstimate(estimateMinutes(runDays, _cycles))}';

    return LabFormFrame(
      footer: FormFooter(
        summary: summary,
        buttonLabel: 'Start simulation',
        busy: sim.starting,
        problem: blocker,
        serverError: _serverError,
        onPressed: canStart
            ? () => _start(scenario: scenario, risk: risk)
            : null,
      ),
      children: [
        const Align(alignment: Alignment.centerLeft, child: PaperBadge()),
        LbTextField(
          controller: _name,
          label: 'Name',
          hint: 'Optional',
          inputFormatters: [LengthLimitingTextInputFormatter(80)],
          textInputAction: TextInputAction.next,
        ),
        FormBlock(
          label: 'Environment',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final m in SimMode.values) ...[
                if (m != SimMode.values.first) const SizedBox(height: 8),
                ChoiceTile(
                  title: modeCopy(m).title,
                  description: modeCopy(m).note,
                  selected: _mode == m,
                  onTap: () => _pickMode(m),
                ),
              ],
            ],
          ),
        ),
        if (!bootstrap)
          FormBlock(
            label: 'Scenario',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (scenarios.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      sim.scenariosLoaded
                          ? 'The scenario library did not load. Pick custom dates below.'
                          : 'Loading scenarios\u2026',
                      style: LbText.muted(context),
                    ),
                  ),
                for (final s in scenarios) ...[
                  ChoiceTile(
                    title: s.name,
                    description: s.description,
                    tag: s.regime.name,
                    selected: _scenarioId == s.id,
                    onTap: () => _pickScenario(s.id),
                  ),
                  const SizedBox(height: 8),
                ],
                ChoiceTile(
                  title: 'Custom dates',
                  description: 'Pick any window from real history.',
                  selected: _scenarioId == null,
                  onTap: () => _pickScenario(null),
                ),
              ],
            ),
          ),
        if (custom)
          LbTextField(
            controller: _startDate,
            label: 'Start date',
            hint: 'YYYY-MM-DD',
            mono: true,
            keyboardType: TextInputType.datetime,
            errorText: dateProblem,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9\-]')),
              LengthLimitingTextInputFormatter(10),
            ],
            onChanged: (_) => setState(() {}),
            suffix: IconButton(
              tooltip: 'Pick a date',
              onPressed: _pickDate,
              icon: const LbIcon(LbIcons.calendar03, size: 20),
            ),
          )
        else if (scenario != null)
          Text(
            '${scenario.days} trading days from ${scenario.startDate}.',
            style: LbText.number(
              context,
              size: 13,
              color: context.lb.mutedForeground,
              weight: FontWeight.w400,
            ),
          ),
        if (bootstrap || custom)
          LbSliderRow(
            label: bootstrap ? 'Bootstrap days' : 'Trading days',
            value: days.toDouble(),
            min: minDays.toDouble(),
            max: maxDays.toDouble(),
            divisions: maxDays - minDays,
            format: (v) => '${v.round()}',
            onChanged: (v) => setState(() => _days = v.round()),
          ),
        LbNumberField(
          label: 'Starting cash',
          controller: _cash,
          unit: 'USD',
          errorText: cashError,
          onChanged: (_) => setState(() {}),
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
        FormBlock(
          label: 'Model',
          child: LbSegmented<SimModel>(
            semanticLabel: 'Model',
            selected: _model,
            onChanged: (v) => setState(() => _model = v),
            segments: modelSegments,
          ),
        ),
        LbTextField(
          controller: _seed,
          label: 'Seed',
          hint: 'Random',
          mono: true,
          keyboardType: TextInputType.number,
          errorText: seedProblem,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
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
          label: 'Watchlist',
          child: WatchlistEditor(
            tickers: _watchlist,
            onChanged: (v) => setState(() => _watchlist = v),
          ),
        ),
        LbTextField(
          controller: _strategy,
          label: 'Strategy',
          hint: "Instructions for this run's agent, for example a hypothesis to test",
          helperText: '${_strategy.text.length}/2000',
          minLines: 4,
          maxLines: 8,
          keyboardType: TextInputType.multiline,
          inputFormatters: [LengthLimitingTextInputFormatter(2000)],
          onChanged: (_) => setState(() {}),
        ),
        RiskOverridesEditor(
          live: live?.risk,
          errors: risk.errors,
          onChanged: (v) => setState(() => _overrides = v),
        ),
      ],
    );
  }
}
