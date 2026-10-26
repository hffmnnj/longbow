import 'package:flutter/material.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart';

/// Renders a [Loadable]: skeleton while loading, an error with Retry, or the
/// data (kept on screen during a refresh, with a quiet note if the refresh
/// failed). The web `DataState`.
class LoadableView<T> extends StatelessWidget {
  const LoadableView({super.key, required this.loadable, required this.onRetry, required this.builder, this.skeletonHeight = 160});

  final Loadable<T>? loadable;
  final VoidCallback onRetry;

  /// Height of the loading block; match the loaded layout so nothing jumps.
  final double skeletonHeight;
  final Widget Function(BuildContext context, T data) builder;

  @override
  Widget build(BuildContext context) {
    final l = loadable;
    final data = l?.data;
    if (data != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          builder(context, data),
          if (l?.error != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Could not refresh: ${l!.error}', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: context.lb.warn)),
            ),
        ],
      );
    }
    if (l?.state == LoadState.error) {
      return SizedBox(height: skeletonHeight, child: ErrorState(message: 'Could not load this: ${l!.error}', onRetry: onRetry));
    }
    return SkeletonBlock(height: skeletonHeight);
  }
}
