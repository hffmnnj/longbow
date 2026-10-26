import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/data/data.dart' show AppSectionKey;
import 'package:longbow/features/agent/agent_screen.dart';
import 'package:longbow/features/feed/feed_screen.dart';
import 'package:longbow/features/markets/markets_screen.dart';
import 'package:longbow/features/performance/performance_screen.dart';
import 'package:longbow/features/portfolio/portfolio_screen.dart';

/// One bottom-navigation tab.
class ShellTab {
  const ShellTab(this.section, this.label, this.icon, this.builder);

  final AppSectionKey section;
  final String label;
  final IconData icon;
  final WidgetBuilder builder;
}

/// The five tabs, in navigation order. Feed is first and is where back lands.
final List<ShellTab> defaultShellTabs = [
  ShellTab(AppSectionKey.feed, 'Feed', LbIcons.message01, (_) => const FeedScreen()),
  ShellTab(AppSectionKey.portfolio, 'Portfolio', LbIcons.briefcase01, (_) => const PortfolioScreen()),
  ShellTab(AppSectionKey.markets, 'Markets', LbIcons.globe02, (_) => const MarketsScreen()),
  ShellTab(AppSectionKey.performance, 'Performance', LbIcons.chartIncrease, (_) => const PerformanceScreen()),
  ShellTab(AppSectionKey.agent, 'Agent', LbIcons.aiBrain01, (_) => const AgentScreen()),
];

/// The tabs the shell shows. Tests override this with light placeholders so
/// shell behavior is checked without each feature screen.
final shellTabsProvider = Provider<List<ShellTab>>((_) => defaultShellTabs);

/// Tab index for a section, or null for the pushed pages (history, reports, lab).
int? tabIndexOf(List<ShellTab> tabs, AppSectionKey section) {
  final i = tabs.indexWhere((t) => t.section == section);
  return i < 0 ? null : i;
}
