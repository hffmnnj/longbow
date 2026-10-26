/// Sections of the app a notification tap can open. The shell reuses this
/// enum for routing; the query values match the web `?view=` values
/// (apps/web/src/lib/nav.ts), including the `live` alias for the feed.
enum AppSectionKey {
  feed,
  portfolio,
  markets,
  performance,
  agent,
  history,
  reports,
  lab,
}

/// A parsed notification deep link such as `/?order=<id>`.
sealed class DeepLink {
  const DeepLink();
}

final class OrderLink extends DeepLink {
  const OrderLink(this.id);

  final String id;
}

final class ReportLink extends DeepLink {
  const ReportLink(this.id);

  final String id;
}

final class SectionLink extends DeepLink {
  const SectionLink(this.section);

  final AppSectionKey section;
}

final class KillSwitchLink extends DeepLink {
  const KillSwitchLink();
}

AppSectionKey? _sectionFromParam(String value) {
  if (value == 'live') return AppSectionKey.feed;
  for (final section in AppSectionKey.values) {
    if (section.name == value) return section;
  }
  return null;
}

/// Parses a notification URL or path into a [DeepLink]. Returns null for
/// null, empty, or unparsable input, for non-HTTP schemes such as
/// `javascript:`, and when no known query parameter is present.
///
/// Precedence when several match: order, report, view, action. This preserves
/// the old WebView bridge contract (`resolveLaunchUrl`): foreign or opaque
/// input never routes anywhere.
DeepLink? parseDeepLink(String? urlOrPath) {
  final trimmed = urlOrPath?.trim() ?? '';
  if (trimmed.isEmpty) return null;
  final uri = Uri.tryParse(trimmed);
  if (uri == null) return null;
  if (uri.hasScheme && uri.scheme != 'http' && uri.scheme != 'https') {
    return null;
  }
  final query = uri.queryParameters;
  final order = query['order'];
  if (order != null && order.isNotEmpty) return OrderLink(order);
  final report = query['report'];
  if (report != null && report.isNotEmpty) return ReportLink(report);
  final view = query['view'];
  if (view != null && view.isNotEmpty) {
    final section = _sectionFromParam(view);
    if (section == null) return null;
    return SectionLink(section);
  }
  if (query['action'] == 'kill') return const KillSwitchLink();
  return null;
}
