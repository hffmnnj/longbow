import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' hide ToastTone;

enum DocKind { note, skill }

/// A note file or a skill body as markdown, with title, updated time (notes)
/// or description (skills), and a Copy action. Port of the web `DocSheet` as
/// a full-screen pushed page. Watching the store keeps the text live: the
/// store refetches a note when its `NoteEvent` arrives.
class DocPage extends ConsumerStatefulWidget {
  const DocPage({super.key, required this.kind, required this.id});

  final DocKind kind;

  /// Note path such as `theses/NVDA.md`, or a skill name.
  final String id;

  @override
  ConsumerState<DocPage> createState() => _DocPageState();
}

class _DocPageState extends ConsumerState<DocPage> {
  String get _storeKind => widget.kind == DocKind.note ? 'note' : 'skill';
  String get _key => '$_storeKind:${widget.id}';

  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(harnessProvider.notifier).loadDoc(_storeKind, widget.id),
    );
  }

  Future<void> _reload() => ref
      .read(harnessProvider.notifier)
      .loadDoc(_storeKind, widget.id, true);

  Future<void> _copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    Haptics.light();
    if (mounted) showToast(context, 'Copied', tone: ToastTone.success);
  }

  @override
  Widget build(BuildContext context) {
    final loadable = ref.watch(
      harnessProvider.select((s) => s.docs[_key]),
    );
    final offline =
        ref.watch(harnessProvider.select((s) => s.connection)) ==
        ConnectionStatus.offline;
    final text = loadable?.data;

    String? subtitle;
    if (widget.kind == DocKind.note) {
      final notes = ref.watch(harnessProvider.select((s) => s.feed.notes));
      final match = notes.where((n) => n.path == widget.id).toList();
      if (match.isNotEmpty) {
        subtitle =
            'Updated ${ago(match.first.updatedAt)} · ${_fileSize(match.first.size)}';
      }
    } else {
      final skills = ref.watch(harnessProvider.select((s) => s.skills));
      final match = skills.where((s) => s.name == widget.id).toList();
      if (match.isNotEmpty) subtitle = match.first.description;
    }

    final title =
        widget.kind == DocKind.note
            ? widget.id.split('/').last.replaceAll(RegExp(r'\.md$'), '')
            : widget.id;

    return LbPageScaffold(
      title: title,
      largeTitle: false,
      onRefresh: _reload,
      banner: offline ? StaleBanner(offline: true, onRetry: _reload) : null,
      actions: [
        if (text != null)
          IconButton(
            tooltip: 'Copy',
            onPressed: () => _copy(text),
            icon: const LbIcon(LbIcons.copy01),
          ),
      ],
      slivers: [
        if (text != null) ...[
          if (loadable?.error != null)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  'Could not refresh: ${loadable!.error}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: context.lb.warn,
                  ),
                ),
              ),
            ),
          if (subtitle != null)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(subtitle, style: LbText.muted(context)),
              ),
            ),
          SliverToBoxAdapter(child: LbMarkdown(text)),
        ] else if (loadable?.state == LoadState.error)
          SliverToBoxAdapter(
            child: ErrorState(
              message: 'Could not load this: ${loadable?.error}',
              onRetry: _reload,
            ),
          )
        else
          const SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBlock(width: 160, height: 12),
                SizedBox(height: 8),
                SkeletonLines(lines: 4),
              ],
            ),
          ),
      ],
    );
  }
}

String _fileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  final kb = bytes / 1024;
  if (kb < 1024) return '${kb.toStringAsFixed(kb < 10 ? 1 : 0)} KB';
  return '${(kb / 1024).toStringAsFixed(1)} MB';
}
