import 'package:flutter/material.dart';
import 'package:longbow/core/charts/charts.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/models/models.dart';

import 'package:longbow/domain/sim_calc.dart' hide upsertSimRun, upsertSuite;

/// Wraps lab screens so the whole surface carries the lab identity: a faint
/// violet wash on the background and app bar, plus a 2dp lab rule along the
/// top edge (the web's `border-t-lab`). Everything below reads
/// `context.lb`, so cards and text keep their normal tokens.
class LabTheme extends StatelessWidget {
  const LabTheme({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final tinted = c.copyWith(
      background: Color.alphaBlend(c.lab.withValues(alpha: 0.05), c.background),
      bar: Color.alphaBlend(c.lab.withValues(alpha: 0.08), c.bar),
    );
    final theme = Theme.of(context);
    return Theme(
      data: theme.copyWith(
        scaffoldBackgroundColor: tinted.background,
        extensions: <ThemeExtension<dynamic>>[tinted],
      ),
      child: Stack(
        children: [
          Positioned.fill(child: child),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            child: IgnorePointer(
              child: ColoredBox(color: c.lab.withValues(alpha: 0.7)),
            ),
          ),
        ],
      ),
    );
  }
}

/// "Paper money": the persistent mark that this is not the live account.
class PaperBadge extends StatelessWidget {
  const PaperBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Semantics(
      label: 'Paper money. Simulated, not your live account',
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: c.labBg,
          borderRadius: BorderRadius.circular(LbRadius.sm),
          border: Border.all(color: c.lab.withValues(alpha: 0.45)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              LbIcon(LbIcons.flaskConical, size: 12, color: c.lab),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  'PAPER MONEY',
                  style: LbText.caption(context, color: c.lab).copyWith(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.8,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Small lab-tinted tag such as "Blind · fictional dates" or "By agent".
class LabTag extends StatelessWidget {
  const LabTag(this.text, {super.key, this.neutral = false});

  final String text;

  /// Neutral tags (By agent) use the secondary surface instead of lab.
  final bool neutral;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: neutral ? c.secondary : c.labBg,
        borderRadius: BorderRadius.circular(LbRadius.sm),
        border: neutral
            ? null
            : Border.all(color: c.lab.withValues(alpha: 0.4)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Text(
          text,
          style: LbText.caption(
            context,
            color: neutral ? c.foreground : c.lab,
          ).copyWith(fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}

/// Status of a run or suite: a dot or glyph plus the word. Running uses the
/// lab pulse, never the live accent; failed uses the loss color.
class RunStatusLabel extends StatelessWidget {
  const RunStatusLabel(this.status, {super.key, this.detail});

  final SimRunStatus status;

  /// Appended after the word, for example "Day 3/10".
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final failed = status == SimRunStatus.failed;
    final running = status == SimRunStatus.running;
    final color = failed ? c.loss : (running ? c.lab : c.mutedForeground);
    final Widget lead = switch (status) {
      SimRunStatus.running => PulseDot(color: c.lab, size: 7),
      SimRunStatus.queued => LbIcon(LbIcons.clock01, size: 14, color: color),
      SimRunStatus.failed => LbIcon(
        LbIcons.alertCircle,
        size: 14,
        color: color,
      ),
      SimRunStatus.done => LbIcon(LbIcons.check, size: 14, color: color),
      SimRunStatus.stopped => LbIcon(LbIcons.stop, size: 13, color: color),
    };
    final text = detail == null
        ? statusLabel[status]!
        : '${statusLabel[status]} \u00b7 $detail';
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        lead,
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            text,
            style: Theme.of(context).textTheme.labelMedium!
                .copyWith(color: color, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}

/// Determinate progress bar in the lab color. [value] is 0 to 1.
class LabProgress extends StatelessWidget {
  const LabProgress({super.key, required this.value, required this.label});

  final double value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return Semantics(
      label: label,
      value: '${(value * 100).round()} percent',
      child: ExcludeSemantics(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(2),
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: value.clamp(0, 1)),
            duration: LbMotion.duration(
              context,
              const Duration(milliseconds: 500),
            ),
            curve: LbMotion.curve,
            builder: (context, v, _) => LinearProgressIndicator(
              value: v,
              minHeight: 4,
              color: c.lab,
              backgroundColor: c.muted,
            ),
          ),
        ),
      ),
    );
  }
}

/// Equity against SPY for a run card: the run's equity (gain or loss tone by
/// result) over a dashed benchmark, both starting from the starting cash.
class RunSpark extends StatelessWidget {
  const RunSpark({super.key, required this.run, this.height = 36});

  final SimRun run;
  final double height;

  @override
  Widget build(BuildContext context) {
    final base = run.config.startingCash;
    final eq = [base, ...run.equity.map((p) => p.equity)];
    final bm = [base, ...run.equity.map((p) => p.benchmark)];
    return Sparkline(
      values: eq,
      benchmark: bm,
      width: double.infinity,
      height: height,
      semanticsLabel: run.equity.isEmpty
          ? 'No closes yet'
          : 'Equity against SPY over ${run.equity.length} days',
    );
  }
}

/// The lab FAB color pair.
({Color bg, Color fg}) labFabColors(BuildContext context) {
  final c = context.lb;
  return (bg: c.lab, fg: c.background);
}

/// Wraps [children] in rows of [columns] cards, built lazily as a sliver.
/// With one column this is a plain separated list.
class AdaptiveCardSliver extends StatelessWidget {
  const AdaptiveCardSliver({
    super.key,
    required this.count,
    required this.itemBuilder,
    this.columns = 1,
  });

  final int count;
  final int columns;
  final Widget Function(BuildContext context, int index) itemBuilder;

  @override
  Widget build(BuildContext context) {
    final rows = (count / columns).ceil();
    return SliverList.separated(
      itemCount: rows,
      separatorBuilder: (_, _) => const SizedBox(height: LbSpace.gap),
      itemBuilder: (context, row) {
        if (columns == 1) return itemBuilder(context, row);
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < columns; i++) ...[
              if (i > 0) const SizedBox(width: LbSpace.gap),
              Expanded(
                child: row * columns + i < count
                    ? itemBuilder(context, row * columns + i)
                    : const SizedBox.shrink(),
              ),
            ],
          ],
        );
      },
    );
  }
}

/// Columns for card lists: one on phones, two from 840dp.
int labColumns(BuildContext context) =>
    MediaQuery.sizeOf(context).width >= 840 ? 2 : 1;

/// Two panes at expanded widths, a single column below.
class TwoUp extends StatelessWidget {
  const TwoUp({super.key, required this.left, required this.right});

  final List<Widget> left;
  final List<Widget> right;

  static Widget _stack(List<Widget> items) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (var i = 0; i < items.length; i++) ...[
        if (i > 0) const SizedBox(height: LbSpace.gap),
        items[i],
      ],
    ],
  );

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.sizeOf(context).width >= 840) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: _stack(left)),
          const SizedBox(width: LbSpace.gap),
          Expanded(child: _stack(right)),
        ],
      );
    }
    return _stack([...left, ...right]);
  }
}

/// Full-width action button in the lab color.
class LabButton extends StatelessWidget {
  const LabButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final style = FilledButton.styleFrom(
      backgroundColor: c.lab,
      foregroundColor: c.background,
      disabledBackgroundColor: c.muted,
      disabledForegroundColor: c.mutedForeground,
    );
    if (busy) {
      return FilledButton(
        onPressed: null,
        style: style,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: c.mutedForeground,
              ),
            ),
            const SizedBox(width: 10),
            Flexible(child: Text(label, textAlign: TextAlign.center)),
          ],
        ),
      );
    }
    return icon == null
        ? FilledButton(
            onPressed: onPressed,
            style: style,
            child: Text(label, textAlign: TextAlign.center),
          )
        : FilledButton.icon(
            onPressed: onPressed,
            style: style,
            icon: LbIcon(icon!, size: 18),
            label: Text(label),
          );
  }
}
