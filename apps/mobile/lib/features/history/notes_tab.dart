import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:longbow/app/nav.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';
import 'package:longbow/models/models.dart';

String _fileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  final kb = bytes / 1024;
  if (kb < 1024) return '${kb.toStringAsFixed(kb < 10 ? 1 : 0)} KB';
  return '${(kb / 1024).toStringAsFixed(1)} MB';
}

/// Agent note files grouped by folder, newest first in each folder. Port of
/// the web `Notes` (grouped by folder rather than the Plan/Theses/Other
/// split, so every folder the agent creates shows up).
class NotesTab extends ConsumerWidget {
  const NotesTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final loaded = ref.watch(harnessProvider.select((s) => s.loaded));
    final notes = ref.watch(harnessProvider.select((s) => s.feed.notes));
    final loadError = ref.watch(harnessProvider.select((s) => s.loadError));

    if (!loaded) {
      return const SliverToBoxAdapter(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SkeletonBlock(height: 120),
            SizedBox(height: LbSpace.gap),
            SkeletonBlock(height: 160),
          ],
        ),
      );
    }
    if (notes.isEmpty) {
      return SliverToBoxAdapter(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (loadError != null)
              Text(
                'Could not refresh: $loadError',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: context.lb.warn,
                ),
              ),
            const Empty(title: 'No notes yet'),
          ],
        ),
      );
    }

    final groups = <String, List<NoteFile>>{};
    for (final n in notes) {
      final folder = n.path.contains('/') ? n.path.split('/').first : 'General';
      (groups[folder] ??= []).add(n);
    }
    final folders = groups.keys.toList()
      ..sort((a, b) {
        if (a == 'General') return -1;
        if (b == 'General') return 1;
        return a.compareTo(b);
      });
    for (final entries in groups.values) {
      entries.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    }

    return SliverMainAxisGroup(
      slivers: [
        if (loadError != null)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                'Could not refresh: $loadError',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: context.lb.warn,
                ),
              ),
            ),
          ),
        for (final folder in folders) ...[
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(top: 4),
              child: SectionLabel(folder),
            ),
          ),
          SliverToBoxAdapter(child: _FolderCard(folder: folder, notes: groups[folder]!)),
        ],
      ],
    );
  }
}

class _FolderCard extends StatelessWidget {
  const _FolderCard({required this.folder, required this.notes});

  final String folder;
  final List<NoteFile> notes;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    return LbCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (var i = 0; i < notes.length; i++) ...[
            if (i > 0) Divider(height: 1, color: c.border),
            _NoteRow(note: notes[i], mono: folder != 'General'),
          ],
        ],
      ),
    );
  }
}

class _NoteRow extends StatelessWidget {
  const _NoteRow({required this.note, required this.mono});

  final NoteFile note;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final title =
        mono
            ? note.path.split('/').last.replaceAll(RegExp(r'\.md$'), '')
            : note.path.replaceAll(RegExp(r'\.md$'), '');
    return Semantics(
      button: true,
      label: 'Open note $title',
      excludeSemantics: true,
      child: InkWell(
        onTap: () => AppNav.note(context, note.path),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kMinTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: LbSpace.card,
              vertical: 10,
            ),
            child: Row(
              children: [
                LbIcon(
                  LbIcons.file01,
                  size: 16,
                  color: context.lb.mutedForeground,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style:
                            mono
                                ? LbText.number(
                                  context,
                                  size: 14,
                                  weight: FontWeight.w600,
                                )
                                : Theme.of(context).textTheme.bodyMedium
                                    ?.copyWith(fontWeight: FontWeight.w500),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Updated ${ago(note.updatedAt)}',
                        style: LbText.number(
                          context,
                          size: 11.5,
                          color: context.lb.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _fileSize(note.size),
                  style: LbText.number(
                    context,
                    size: 11.5,
                    color: context.lb.mutedForeground,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
