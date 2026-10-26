import 'package:flutter/widgets.dart';
import 'package:longbow/core/core.dart';
import 'package:longbow/domain/roles.dart';
import 'package:longbow/domain/tool_meta.dart';

/// Maps the pure-Dart [ToolIcon] keys to Hugeicons glyphs.
IconData toolIconData(ToolIcon icon) => switch (icon) {
      ToolIcon.briefcase => LbIcons.briefcase01,
      ToolIcon.chartLine => LbIcons.chartLineData01,
      ToolIcon.bookOpen => LbIcons.bookOpen01,
      ToolIcon.search => LbIcons.search01,
      ToolIcon.command => LbIcons.command,
      ToolIcon.notebook => LbIcons.notebook01,
      ToolIcon.note => LbIcons.note01,
      ToolIcon.shield => LbIcons.shield01,
      ToolIcon.wrench => LbIcons.wrench01,
      ToolIcon.flask => LbIcons.flaskConical,
      ToolIcon.code => LbIcons.code,
      ToolIcon.analytics => LbIcons.analytics01,
      ToolIcon.tradeUp => LbIcons.tradeUp,
      ToolIcon.tradeDown => LbIcons.tradeDown,
      ToolIcon.searching => LbIcons.searching,
    };

/// Maps the pure-Dart [RoleIcon] keys to Hugeicons glyphs.
IconData roleIconData(RoleIcon icon) => switch (icon) {
      RoleIcon.analytics => LbIcons.analytics01,
      RoleIcon.tradeUp => LbIcons.tradeUp,
      RoleIcon.tradeDown => LbIcons.tradeDown,
      RoleIcon.shield => LbIcons.shield01,
      RoleIcon.searching => LbIcons.searching,
    };
