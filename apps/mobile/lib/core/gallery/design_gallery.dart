import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../core.dart';

/// Debug-only page that shows every kit widget in its states. Not wired into
/// app navigation; push it from a debug menu or run it with [DesignGalleryApp].
class DesignGallery extends StatefulWidget {
  const DesignGallery({super.key});

  @override
  State<DesignGallery> createState() => _DesignGalleryState();
}

class _DesignGalleryState extends State<DesignGallery> {
  String _range = '6M';
  bool _on = true;
  double _slider = 25;

  static const _long =
      'A very long label that must wrap onto several lines instead of clipping at large text sizes';

  @override
  Widget build(BuildContext context) {
    if (!kDebugMode) return const SizedBox.shrink();
    final now = DateTime.now().millisecondsSinceEpoch;
    return LbPageScaffold.children(
      title: 'Design gallery',
      onRefresh: () async => Future<void>.delayed(const Duration(milliseconds: 300)),
      banner: StaleBanner(updatedAtMs: now - 4 * 60000, now: now, onRetry: () {}),
      children: [
        SectionCard(
          title: 'Numbers',
          trailing: const StatusChip('Live', tone: StatusTone.live),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(usd(25432.1), style: LbText.display(context)),
              const SizedBox(height: 8),
              const Wrap(spacing: 12, runSpacing: 4, children: [
                Pnl(amount: 412.5, percent: 1.62),
                Pnl(amount: -88.2, percent: -0.35),
                Pnl(amount: 0, percent: 0),
                Pnl(percent: 3.4),
              ]),
              const SizedBox(height: 8),
              const Wrap(spacing: 12, runSpacing: 4, children: [
                Money(1234567.8),
                Money(-12.5, signed: true, colored: true),
                PctText(-4.2),
              ]),
            ],
          ),
        ),
        const SectionCard(
          title: 'Chips and badges',
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            StatusChip('Neutral'),
            StatusChip('Live', tone: StatusTone.live),
            StatusChip('Halted', tone: StatusTone.warn),
            StatusChip('Rejected', tone: StatusTone.loss),
            StatusChip('Filled', tone: StatusTone.gain),
            StatusChip('Simulation lab', tone: StatusTone.lab),
            ActionBadge('buy'),
            ActionBadge('sell'),
            ActionBadge('hold'),
            ActionBadge('watch'),
            ActionBadge('none'),
            SideBadge('buy'),
            SideBadge('sell'),
            GradeChip('A'),
            GradeChip('F', reason: 'Missed stop'),
            GradeChip('B', large: true),
            PulseDot(),
          ]),
        ),
        SectionCard(
          title: 'Key values',
          child: KeyValueList(rows: [
            const KeyValueRow('Equity', value: r'$25,432.10'),
            KeyValueRow('Day P&L', valueWidget: const Pnl(amount: 42.1, percent: 0.17)),
            const KeyValueRow(_long, value: 'Long value that also wraps when the text gets large', mono: false),
          ]),
        ),
        SectionCard(
          title: 'Controls',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              LbSegmented<String>(
                semanticLabel: 'Chart range',
                segments: [for (final r in ['1D', '1W', '1M', '6M', '1Y', 'All']) LbSegment(r, r)],
                selected: _range,
                onChanged: (v) => setState(() => _range = v),
              ),
              LbSwitchRow(title: 'Notifications', subtitle: 'Trade alerts and halts', value: _on, onChanged: (v) => setState(() => _on = v)),
              LbSliderRow(label: 'Max position size', value: _slider, min: 0, max: 100, divisions: 20, format: (v) => '${v.round()}%', onChanged: (v) => setState(() => _slider = v)),
              const SizedBox(height: 8),
              const LbTextField(label: 'Note', hint: 'Why this trade'),
              const SizedBox(height: 12),
              const LbNumberField(label: 'Daily loss limit', unit: 'USD', min: 0, max: 5000, initialValue: '9000'),
              const SizedBox(height: 12),
              const LbSearchField(hint: 'Search symbols'),
            ],
          ),
        ),
        SectionCard(
          title: 'Overlays',
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            FilledButton(
              onPressed: () => showLbSheet<void>(context, (_) => const Padding(padding: EdgeInsets.only(bottom: 16), child: Text('Sheet content')), title: 'Sheet'),
              child: const Text('Sheet'),
            ),
            OutlinedButton(
              onPressed: () => showLbConfirm(context, title: 'Engage kill switch?', message: 'No orders will be placed.', confirmLabel: 'Engage', destructive: true),
              child: const Text('Confirm'),
            ),
            OutlinedButton(onPressed: () => showToast(context, 'Saved', tone: ToastTone.success), child: const Text('Toast')),
            OutlinedButton(onPressed: () => showToast(context, 'Order rejected', tone: ToastTone.error, action: ToastAction('Undo', () {})), child: const Text('Error toast')),
          ]),
        ),
        const SectionCard(
          title: 'Loading',
          child: Column(children: [
            SkeletonLines(lines: 3),
            SizedBox(height: 12),
            Row(children: [
              SkeletonBlock(width: 96, height: 32, radius: LbRadius.md),
              SizedBox(width: 12),
              Expanded(child: SkeletonBlock(height: 32, radius: LbRadius.md)),
            ]),
          ]),
        ),
        SectionCard(
          title: 'Disclosure',
          child: Disclosure(
            title: 'Risk checks',
            trailing: const StatusChip('3 passed', tone: StatusTone.gain),
            child: const Padding(padding: EdgeInsets.only(bottom: 8), child: Text('All limits are within bounds.')),
          ),
        ),
        const LbCard(child: Empty(title: 'No orders yet', message: 'Orders the agent places show up here.', icon: LbIcons.briefcase01)),
        LbCard(child: ErrorState(message: 'Could not reach the server.', onRetry: () {})),
        const LbCard(
          child: LbMarkdown(_markdown),
        ),
        const CodeBlock('{\n  "symbol": "NVDA",\n  "side": "buy",\n  "qty": 3\n}'),
      ],
    );
  }
}

const String _markdown = '''
## Verdict

Held **NVDA**; trimmed ~1.3% of ~~old thesis~~. See [the report](https://example.com).

> Risk stays inside the daily limit.

- Equity up `+1.2%`
- Cash \$4,100

| Symbol | Weight | Note |
| --- | --- | --- |
| NVDA | 12.4% | Core position with a rather long explanation |

```
bun run test
```
''';

/// Standalone app wrapper for the gallery (run it from a scratch main).
class DesignGalleryApp extends StatelessWidget {
  const DesignGalleryApp({super.key, this.brightness = Brightness.dark});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildLongbowTheme(Brightness.light),
        darkTheme: buildLongbowTheme(Brightness.dark),
        themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
        home: const DesignGallery(),
      );
}
