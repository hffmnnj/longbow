import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;
import 'package:longbow/domain/control.dart';
import 'package:longbow/domain/settings_form.dart';
import 'package:longbow/features/control/kill_switch.dart';
import 'package:longbow/features/control/mode_control.dart';
import 'package:longbow/models/models.dart';

import 'settings_sections.dart';

/// Opens the settings modal sheet (full height, with a pinned Save bar).
Future<void> showSettingsSheet(BuildContext context) {
  return showLbSheet<void>(
    context,
    (_) => const SettingsSheet(),
    title: 'Settings',
    fullHeight: true,
  );
}

/// Port of SettingsSheet.svelte. Mode, kill switch, risk limits, cycle
/// cadence and the watchlist edit one form that saves as a single patch;
/// Robinhood, alerts, theme and server address act immediately.
class SettingsSheet extends ConsumerStatefulWidget {
  const SettingsSheet({super.key});

  @override
  ConsumerState<SettingsSheet> createState() => _SettingsSheetState();
}

class _SettingsSheetState extends ConsumerState<SettingsSheet> {
  static const _openKey = 'cycleMinutesOpen';
  static const _closedKey = 'cycleMinutesClosed';

  Settings? _saved;
  SettingsForm? _form;
  final Map<String, TextEditingController> _ctrls = {};
  final TextEditingController _tickerCtrl = TextEditingController();
  bool _syncing = false;
  String? _tickerError;
  String? _formError;
  Map<String, String> _serverErrors = {};
  bool _saving = false;
  bool _justSaved = false;

  bool get _dirty {
    final saved = _saved;
    final form = _form;
    return saved != null && form != null && !isEmptyPatch(buildPatch(saved, form));
  }

  @override
  void initState() {
    super.initState();
    _adopt(ref.read(harnessProvider).feed.status?.settings, force: true);
    ref.listenManual<Settings?>(harnessProvider.select((s) => s.feed.status?.settings), (_, next) {
      if (next != null && mounted) setState(() => _adopt(next));
    });
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    _tickerCtrl.dispose();
    super.dispose();
  }

  /// Takes new saved settings. Unsaved edits survive a background update;
  /// a clean form follows the server.
  void _adopt(Settings? next, {bool force = false}) {
    if (next == null) return;
    final clean = force || _form == null || !_dirty;
    _saved = next;
    if (clean) _resetForm(next);
  }

  void _resetForm(Settings s) {
    final form = toForm(s);
    _form = form;
    _syncing = true;
    _ctrlFor(_openKey).text = form.cycleMinutesOpen;
    _ctrlFor(_closedKey).text = form.cycleMinutesClosed;
    for (final k in riskKeys) {
      _ctrlFor('risk.${k.name}').text = form.risk[k] ?? '';
    }
    for (final k in cryptoKeys) {
      _ctrlFor('crypto.${k.name}').text = form.crypto[k] ?? '';
    }
    _syncing = false;
    _serverErrors = {};
    _formError = null;
  }

  TextEditingController _ctrlFor(String key) => _ctrls.putIfAbsent(key, () {
        final c = TextEditingController();
        c.addListener(() => _onFieldChanged(key));
        return c;
      });

  void _onFieldChanged(String key) {
    final form = _form;
    if (_syncing || form == null) return;
    final text = _ctrls[key]!.text;
    setState(() {
      if (key == _openKey) {
        form.cycleMinutesOpen = text;
      } else if (key == _closedKey) {
        form.cycleMinutesClosed = text;
      } else if (key.startsWith('crypto.')) {
        form.crypto[CryptoKey.values.byName(key.substring(7))] = text;
      } else {
        form.risk[RiskKey.values.byName(key.substring(5))] = text;
      }
      _serverErrors.remove(key);
      _formError = null;
      _justSaved = false;
    });
  }

  void _toggleCrypto(bool next) {
    final form = _form;
    if (form == null) return;
    Haptics.selection();
    setState(() {
      form.cryptoEnabled = next;
      _justSaved = false;
    });
  }

  void _resetRiskToDefaults() {
    final defaults = toForm(defaultSettings).risk;
    Haptics.selection();
    for (final k in riskKeys) {
      _ctrlFor('risk.${k.name}').text = defaults[k] ?? '';
    }
  }

  void _addTickers() {
    final form = _form;
    if (form == null) return;
    final (:added, :rejected) = parseTickers(_tickerCtrl.text, form.watchlist);
    setState(() {
      form.watchlist = [...form.watchlist, ...added];
      _tickerError = rejected.isEmpty ? null : 'Not a ticker: ${rejected.join(', ')}';
      _tickerCtrl.text = rejected.join(' ');
      _justSaved = false;
    });
  }

  void _removeTicker(String t) {
    final form = _form;
    if (form == null) return;
    setState(() {
      form.watchlist = form.watchlist.where((x) => x != t).toList();
      _justSaved = false;
    });
  }

  /// Puts a server rejection next to the field it names, else in the bar.
  void _applyServerError(String message) {
    final lower = message.toLowerCase();
    final keys = <String>[
      if (lower.contains(_openKey.toLowerCase())) _openKey,
      if (lower.contains(_closedKey.toLowerCase())) _closedKey,
      for (final k in riskKeys)
        if (lower.contains(k.name.toLowerCase())) 'risk.${k.name}',
      for (final k in cryptoKeys)
        if (lower.contains(k.name.toLowerCase())) 'crypto.${k.name}',
    ];
    if (keys.isEmpty) {
      _formError = message;
    } else {
      _serverErrors = {for (final k in keys) k: message};
      _formError = null;
    }
  }

  Future<void> _save() async {
    final saved = _saved;
    final form = _form;
    if (saved == null || form == null || _saving) return;
    if (validateSettingsForm(form).isNotEmpty || !_dirty) return;
    final patch = buildPatch(saved, form);
    setState(() {
      _saving = true;
      _formError = null;
      _serverErrors = {};
      _justSaved = false;
    });
    try {
      await ref.read(harnessProvider.notifier).patchSettings(patch);
      Haptics.success();
      if (!mounted) return;
      setState(() {
        final fresh = ref.read(harnessProvider).feed.status?.settings;
        if (fresh != null) {
          _saved = fresh;
          _resetForm(fresh);
        }
        _justSaved = true;
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => _applyServerError(e.message));
    } catch (_) {
      if (mounted) setState(() => _formError = 'Could not save settings. Check the connection and try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _confirmDiscard() async {
    final discard = await showLbConfirm(
      context,
      title: 'Discard changes?',
      message: 'Your edits to the settings have not been saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    );
    if (discard && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(harnessProvider.select((s) => s.feed.status));
    final form = _form;
    final errors = form == null ? const <String, String>{} : validateSettingsForm(form);
    final dirty = _dirty;
    final patch = _saved != null && form != null ? buildPatch(_saved!, form) : null;
    final changeCount = patch == null ? 0 : patch.toJson().entries.fold<int>(0, (n, e) => n + (e.key == 'risk' || e.key == 'crypto' ? (e.value as Map).length : 1));
    final canSave = dirty && errors.isEmpty && !_saving;

    final children = <Widget>[
      if (status != null && form != null) ...[
        _TradingSection(status: status),
        _section(
          'Risk limits',
          trailing: TextButton(onPressed: _resetRiskToDefaults, child: const Text('Reset to defaults')),
          child: _riskFields(errors),
        ),
        _section('Crypto', child: _cryptoFields(form, errors)),
        _section('Cycles', child: _cycleFields(errors)),
        _section('Watchlist', child: _watchlist(form, errors['watchlist'])),
        _section('Robinhood', child: const RobinhoodSection()),
      ] else
        _section('Trading', child: Text('Settings load once the server responds. Everything below works now.', style: LbText.muted(context))),
      _section('Notifications', child: const NotificationsSection()),
      _section('Appearance', child: const AppearanceSection()),
      _section('Server', child: const ServerSection()),
      _section('About', child: const AboutSection()),
    ];

    return PopScope(
      canPop: !dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmDiscard();
      },
      child: Column(
        children: [
          Expanded(
            child: ListView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(LbSpace.screen, 4, LbSpace.screen, LbSpace.screen),
              children: [
                for (final w in children) Padding(padding: const EdgeInsets.only(bottom: LbSpace.gap), child: w),
              ],
            ),
          ),
          if (form != null) _SaveBar(
            dirty: dirty,
            canSave: canSave,
            saving: _saving,
            justSaved: _justSaved && !dirty,
            changeCount: changeCount,
            error: _formError,
            onSave: _save,
            onRevert: () => setState(() {
              final s = _saved;
              if (s != null) _resetForm(s);
              _justSaved = false;
            }),
          ),
        ],
      ),
    );
  }

  Widget _section(String title, {required Widget child, Widget? trailing}) => SectionCard(title: title, trailing: trailing, child: child);

  Widget _fields(List<Widget> items) => LayoutBuilder(
        builder: (context, box) {
          final cols = box.maxWidth >= 460 ? 2 : 1;
          final w = (box.maxWidth - (cols - 1) * LbSpace.gap) / cols;
          return Wrap(
            spacing: LbSpace.gap,
            runSpacing: LbSpace.gap,
            children: [for (final i in items) SizedBox(width: w, child: i)],
          );
        },
      );

  Widget _numberField(String key, String label, String unit, Map<String, String> errors, String? clientError) => LbNumberField(
        key: ValueKey('field-$key'),
        label: label,
        unit: unit,
        controller: _ctrlFor(key),
        errorText: _serverErrors[key] ?? clientError,
      );

  Widget _riskFields(Map<String, String> errors) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final g in riskGroups) ...[
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 8),
            child: SectionLabel(g.title),
          ),
          _fields([
            for (final f in g.fields) _numberField('risk.${f.key.name}', f.label, f.unit, errors, errors['risk.${f.key.name}']),
          ]),
          const SizedBox(height: LbSpace.gap),
        ],
      ],
    );
  }

  Widget _cryptoFields(SettingsForm form, Map<String, String> errors) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LbSwitchRow(
          title: 'Crypto',
          value: form.cryptoEnabled,
          onChanged: _toggleCrypto,
        ),
        _fields([
          for (final f in cryptoFields) _numberField('crypto.${f.key.name}', f.label, f.unit, errors, errors['crypto.${f.key.name}']),
        ]),
      ],
    );
  }

  Widget _cycleFields(Map<String, String> errors) => _fields([
        _numberField(_openKey, 'Market open', 'min', errors, errors[_openKey]),
        _numberField(_closedKey, 'Market closed', 'min', errors, errors[_closedKey]),
      ]);

  Widget _watchlist(SettingsForm form, String? listError) {
    final c = context.lb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (form.watchlist.isEmpty)
          Text('No tickers', style: LbText.muted(context))
        else
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final t in form.watchlist)
                InputChip(
                  key: ValueKey('chip-$t'),
                  label: Text(t, style: LbText.number(context, size: 13)),
                  onDeleted: () => _removeTicker(t),
                  deleteButtonTooltipMessage: 'Remove $t',
                  deleteIcon: const LbIcon(LbIcons.close, size: 16),
                  backgroundColor: c.secondary,
                  side: BorderSide.none,
                ),
            ],
          ),
        const SizedBox(height: LbSpace.gap),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: LbTextField(
                controller: _tickerCtrl,
                label: 'Add tickers',
                hint: 'NVDA, AAPL',
                mono: true,
                errorText: _tickerError ?? listError,
                textInputAction: TextInputAction.done,
                onChanged: (_) => setState(() => _tickerError = null),
                onSubmitted: (_) => _addTickers(),
              ),
            ),
            const SizedBox(width: 8),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: FilledButton.tonal(
                onPressed: _tickerCtrl.text.trim().isEmpty ? null : _addTickers,
                child: const Text('Add'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Mode and kill switch with what the system may do right now.
class _TradingSection extends StatelessWidget {
  const _TradingSection({required this.status});

  final StatusResponse status;

  @override
  Widget build(BuildContext context) {
    final control = controlState(status);
    return SectionCard(
      title: 'Trading',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(liveRegion: true, child: Text(control.headline, style: Theme.of(context).textTheme.titleSmall)),
          const SizedBox(height: 2),
          Text(control.detail, style: LbText.muted(context)),
          const SizedBox(height: LbSpace.gap),
          const ModeControl(),
          const SizedBox(height: LbSpace.gap),
          const Align(alignment: Alignment.centerLeft, child: KillSwitchButton()),
        ],
      ),
    );
  }
}

class _SaveBar extends StatelessWidget {
  const _SaveBar({
    required this.dirty,
    required this.canSave,
    required this.saving,
    required this.justSaved,
    required this.changeCount,
    required this.error,
    required this.onSave,
    required this.onRevert,
  });

  final bool dirty;
  final bool canSave;
  final bool saving;
  final bool justSaved;
  final int changeCount;
  final String? error;
  final VoidCallback onSave;
  final VoidCallback onRevert;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final label = saving
        ? 'Saving\u2026'
        : dirty
            ? 'Save $changeCount change${changeCount == 1 ? '' : 's'}'
            : 'Save';
    return DecoratedBox(
      decoration: BoxDecoration(color: c.bar, border: Border(top: BorderSide(color: c.border))),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(LbSpace.screen, LbSpace.gap, LbSpace.screen, LbSpace.gap),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (error != null)
              Semantics(
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(padding: const EdgeInsets.only(top: 2), child: LbIcon(LbIcons.alertCircle, size: 16, color: c.destructive)),
                      const SizedBox(width: 8),
                      Expanded(child: Text(error!, style: LbText.muted(context).copyWith(color: c.destructive))),
                    ],
                  ),
                ),
              ),
            if (justSaved)
              Semantics(
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    children: [
                      LbIcon(LbIcons.checkmarkCircle02, size: 16, color: c.gain),
                      const SizedBox(width: 8),
                      Text('Settings saved', style: LbText.muted(context)),
                    ],
                  ),
                ),
              ),
            Row(
              children: [
                Expanded(child: FilledButton(onPressed: canSave ? onSave : null, child: Text(label))),
                const SizedBox(width: 8),
                TextButton(onPressed: dirty && !saving ? onRevert : null, child: const Text('Revert')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
