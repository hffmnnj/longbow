import 'package:flutter/widgets.dart';
import 'package:hugeicons/hugeicons.dart';

/// Hugeicons (stroke rounded) used across the app, named after the web app's
/// `icons.ts`. Three web icons have no Flutter twin and use the nearest match:
/// `flaskConical` is TestTube, `cloudOff` is WifiDisconnected01, `power` is ShutDown.
abstract final class LbIcons {
  static const IconData aiBrain01 = HugeIcons.strokeRoundedAiBrain01;
  static const IconData barChart = HugeIcons.strokeRoundedBarChart;
  static const IconData chip02 = HugeIcons.strokeRoundedChip02;
  static const IconData globe02 = HugeIcons.strokeRoundedGlobe02;
  static const IconData lock = HugeIcons.strokeRoundedSquareLock01;
  static const IconData moreHorizontal = HugeIcons.strokeRoundedMoreHorizontal;
  static const IconData chartIncrease = HugeIcons.strokeRoundedChartIncrease;
  static const IconData calendar03 = HugeIcons.strokeRoundedCalendar03;
  static const IconData chartLineData01 = HugeIcons.strokeRoundedChartLineData01;
  static const IconData analytics01 = HugeIcons.strokeRoundedAnalytics01;
  static const IconData bookOpen01 = HugeIcons.strokeRoundedBookOpen01;
  static const IconData code = HugeIcons.strokeRoundedCode;
  static const IconData command = HugeIcons.strokeRoundedCommand;
  static const IconData file01 = HugeIcons.strokeRoundedFile01;
  static const IconData news01 = HugeIcons.strokeRoundedNews01;
  static const IconData printer = HugeIcons.strokeRoundedPrinter;
  static const IconData keyboard = HugeIcons.strokeRoundedKeyboard;
  static const IconData search01 = HugeIcons.strokeRoundedSearch01;
  static const IconData searching = HugeIcons.strokeRoundedSearching;
  static const IconData shield01 = HugeIcons.strokeRoundedShield01;
  static const IconData tradeDown = HugeIcons.strokeRoundedTradeDown;
  static const IconData tradeUp = HugeIcons.strokeRoundedTradeUp;
  static const IconData arrowUpRight01 = HugeIcons.strokeRoundedArrowUpRight01;
  static const IconData note01 = HugeIcons.strokeRoundedNote01;
  static const IconData target01 = HugeIcons.strokeRoundedTarget01;
  static const IconData add01 = HugeIcons.strokeRoundedAdd01;
  static const IconData alert02 = HugeIcons.strokeRoundedAlert02;
  static const IconData alertCircle = HugeIcons.strokeRoundedAlertCircle;
  static const IconData arrowDown01 = HugeIcons.strokeRoundedArrowDown01;
  static const IconData arrowLeft01 = HugeIcons.strokeRoundedArrowLeft01;
  static const IconData flaskConical = HugeIcons.strokeRoundedTestTube;
  static const IconData gitCompare = HugeIcons.strokeRoundedGitCompare;
  static const IconData helpCircle = HugeIcons.strokeRoundedHelpCircle;
  static const IconData informationCircle = HugeIcons.strokeRoundedInformationCircle;
  static const IconData notification01 = HugeIcons.strokeRoundedNotification01;
  static const IconData share01 = HugeIcons.strokeRoundedShare01;
  static const IconData cloudOff = HugeIcons.strokeRoundedWifiDisconnected01;
  static const IconData stop = HugeIcons.strokeRoundedStop;
  static const IconData arrowRight01 = HugeIcons.strokeRoundedArrowRight01;
  static const IconData arrowUp02 = HugeIcons.strokeRoundedArrowUp02;
  static const IconData message01 = HugeIcons.strokeRoundedMessage01;
  static const IconData briefcase01 = HugeIcons.strokeRoundedBriefcase01;
  static const IconData cancel01 = HugeIcons.strokeRoundedCancel01;
  static const IconData checkmarkCircle02 = HugeIcons.strokeRoundedCheckmarkCircle02;
  static const IconData clock01 = HugeIcons.strokeRoundedClock01;
  static const IconData flash = HugeIcons.strokeRoundedFlash;
  static const IconData link04 = HugeIcons.strokeRoundedLink04;
  static const IconData loading03 = HugeIcons.strokeRoundedLoading03;
  static const IconData logout01 = HugeIcons.strokeRoundedLogout01;
  static const IconData menu01 = HugeIcons.strokeRoundedMenu01;
  static const IconData moon02 = HugeIcons.strokeRoundedMoon02;
  static const IconData notebook01 = HugeIcons.strokeRoundedNotebook01;
  static const IconData play = HugeIcons.strokeRoundedPlay;
  static const IconData pulse01 = HugeIcons.strokeRoundedPulse01;
  static const IconData power = HugeIcons.strokeRoundedShutDown;
  static const IconData settings02 = HugeIcons.strokeRoundedSettings02;
  static const IconData shieldKey = HugeIcons.strokeRoundedShieldKey;
  static const IconData sun03 = HugeIcons.strokeRoundedSun03;
  static const IconData tick02 = HugeIcons.strokeRoundedTick02;
  static const IconData time04 = HugeIcons.strokeRoundedTime04;
  static const IconData wallet01 = HugeIcons.strokeRoundedWallet01;
  static const IconData wrench01 = HugeIcons.strokeRoundedWrench01;
  static const IconData copy01 = HugeIcons.strokeRoundedCopy01;
  static const IconData delete02 = HugeIcons.strokeRoundedDelete02;
  static const IconData refresh = HugeIcons.strokeRoundedRefresh;

  /// Chevrons use the arrow glyphs the web app uses for disclosure.
  static const IconData chevronDown = HugeIcons.strokeRoundedArrowDown01;
  static const IconData chevronRight = HugeIcons.strokeRoundedArrowRight01;
  static const IconData back = HugeIcons.strokeRoundedArrowLeft01;
  static const IconData close = HugeIcons.strokeRoundedCancel01;
  static const IconData check = HugeIcons.strokeRoundedTick02;
}

/// Renders a Hugeicons [IconData]. Decorative (hidden from screen readers)
/// unless [semanticLabel] is set; icon-only buttons must set it.
class LbIcon extends StatelessWidget {
  const LbIcon(this.icon, {super.key, this.size = 20, this.color, this.semanticLabel});

  final IconData icon;
  final double size;

  /// Defaults to the ambient [IconTheme] color.
  final Color? color;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) =>
      Icon(icon, size: size, color: color, semanticLabel: semanticLabel);
}
