// Dart port of `apps/web/src/lib/roles.ts`. Pure Dart: no Flutter imports.
//
// The UI layer maps each [RoleIcon] value to a Hugeicons glyph
// (analytics -> Analytics01, tradeUp -> TradeUp, tradeDown -> TradeDown,
// shield -> Shield01, searching -> Searching).
import 'package:longbow/models/models.dart';

/// Icon key for a subagent role. The UI layer maps these to Hugeicons glyphs.
enum RoleIcon {
  analytics,
  tradeUp,
  tradeDown,
  shield,
  searching,
}

/// Display label plus icon key for one subagent role.
class RoleMeta {
  const RoleMeta({required this.label, required this.icon});

  final String label;
  final RoleIcon icon;
}

/// Mirrors TS `ROLE_META`: label and icon key per subagent role.
const Map<SubagentRole, RoleMeta> roleMeta = {
  SubagentRole.analyst: RoleMeta(label: 'Analyst', icon: RoleIcon.analytics),
  SubagentRole.bull: RoleMeta(label: 'Bull', icon: RoleIcon.tradeUp),
  SubagentRole.bear: RoleMeta(label: 'Bear', icon: RoleIcon.tradeDown),
  SubagentRole.riskReviewer: RoleMeta(
    label: 'Risk reviewer',
    icon: RoleIcon.shield,
  ),
  SubagentRole.researcher: RoleMeta(
    label: 'Researcher',
    icon: RoleIcon.searching,
  ),
};

/// Human label for a subagent role ("risk_reviewer" reads "Risk reviewer").
String roleLabel(SubagentRole role) => roleMeta[role]!.label;

/// Icon key for a subagent role; the UI layer maps it to a Hugeicons glyph.
RoleIcon roleIcon(SubagentRole role) => roleMeta[role]!.icon;

/// Last non-empty line of the streamed text, else the last finished message,
/// else the task. Markdown markers and quote hashes are stripped.
String latestLine(String? draft, String? lastText, String fallback) {
  String? pick(String? s) {
    if (s == null) return null;
    String? found;
    for (final line in s.split('\n')) {
      final cleaned = line.replaceAll(RegExp(r'[*_`#>]'), '').trim();
      if (cleaned.isNotEmpty) found = cleaned;
    }
    return found;
  }

  return pick(draft) ?? pick(lastText) ?? fallback;
}
