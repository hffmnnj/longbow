// Dart port of `apps/web/src/lib/toolMeta.ts`. Pure Dart: no Flutter imports.
//
// Human titles, icons and grouping for the agent feed's Trace lines.
//
// The UI layer maps each [ToolIcon] value to a Hugeicons glyph:
// briefcase -> Briefcase01, chartLine -> ChartLineData01, bookOpen ->
// BookOpen01, search -> Search01, command -> Command, notebook -> Notebook01,
// note -> Note01, shield -> Shield01, wrench -> Wrench01, flask ->
// FlaskConical, code -> Code, analytics -> Analytics01, tradeUp -> TradeUp,
// tradeDown -> TradeDown, searching -> Searching.
import 'dart:convert';

import 'package:longbow/models/models.dart';

/// One icon per tool family (Robinhood, market data, SEC, web, skills, notes,
/// journal, risk and orders, delegate), following the AI Elements Tool pattern.
enum ToolFamily {
  robinhood,
  market,
  sec,
  web,
  skills,
  notes,
  journal,
  risk,
  delegate,
  lab,
  code,
  other,
}

ToolFamily toolFamily(String? name) {
  if (name == null || name.isEmpty) return ToolFamily.other;
  if (name == 'delegate') return ToolFamily.delegate;
  if (name == 'codemode') return ToolFamily.code;
  if (name == 'submit_order' ||
      name == 'cancel_order' ||
      name == 'get_risk_state') {
    return ToolFamily.risk;
  }
  if (name == 'record_decision') return ToolFamily.journal;
  if (name.startsWith('rh_') ||
      name == 'get_portfolio' ||
      name == 'get_quote') {
    return ToolFamily.robinhood;
  }
  if (name == 'market' || name.startsWith('market_')) return ToolFamily.market;
  if (name.startsWith('sec_')) return ToolFamily.sec;
  if (name == 'web_search' || name == 'open_page' || name == 'find_in_page') {
    return ToolFamily.web;
  }
  if (name == 'skills' || name.startsWith('skills_')) return ToolFamily.skills;
  if (name.startsWith('notes_')) return ToolFamily.notes;
  if (name.startsWith('sim_')) return ToolFamily.lab;
  return ToolFamily.other;
}

/// Icon key for a tool call. The UI layer maps these to Hugeicons glyphs.
enum ToolIcon {
  briefcase,
  chartLine,
  bookOpen,
  search,
  command,
  notebook,
  note,
  shield,
  wrench,
  flask,
  code,
  analytics,
  tradeUp,
  tradeDown,
  searching,
}

const Map<ToolFamily, ToolIcon> _familyIcons = {
  ToolFamily.robinhood: ToolIcon.briefcase,
  ToolFamily.market: ToolIcon.chartLine,
  ToolFamily.sec: ToolIcon.bookOpen,
  ToolFamily.web: ToolIcon.search,
  ToolFamily.skills: ToolIcon.command,
  ToolFamily.notes: ToolIcon.notebook,
  ToolFamily.journal: ToolIcon.note,
  ToolFamily.risk: ToolIcon.shield,
  ToolFamily.delegate: ToolIcon.wrench,
  ToolFamily.lab: ToolIcon.flask,
  ToolFamily.code: ToolIcon.code,
  ToolFamily.other: ToolIcon.wrench,
};

const _roles = [
  SubagentRole.analyst,
  SubagentRole.bull,
  SubagentRole.bear,
  SubagentRole.riskReviewer,
  SubagentRole.researcher,
];

ToolIcon _roleIcon(SubagentRole role) => switch (role) {
  SubagentRole.analyst => ToolIcon.analytics,
  SubagentRole.bull => ToolIcon.tradeUp,
  SubagentRole.bear => ToolIcon.tradeDown,
  SubagentRole.riskReviewer => ToolIcon.shield,
  SubagentRole.researcher => ToolIcon.searching,
};

/// Wire name ("risk_reviewer") for a subagent role.
String _roleName(SubagentRole role) => switch (role) {
  SubagentRole.analyst => 'analyst',
  SubagentRole.bull => 'bull',
  SubagentRole.bear => 'bear',
  SubagentRole.riskReviewer => 'risk_reviewer',
  SubagentRole.researcher => 'researcher',
};

SubagentRole? _roleFromName(String name) {
  for (final role in _roles) {
    if (_roleName(role) == name) return role;
  }
  return null;
}

SubagentRole? _roleFromSummary(String? summary) {
  if (summary == null) return null;
  final m = RegExp(r'"role"\s*:\s*"([a-z_]+)"').firstMatch(summary);
  if (m == null) return null;
  return _roleFromName(m.group(1)!);
}

/// Subagent role named in a delegate call's summary (JSON arguments, possibly
/// truncated).
SubagentRole? delegateRole(ToolCallSummary call) =>
    _roleFromSummary(call.summary);

/// Family icon; delegate calls use their subagent role glyph when it parses.
ToolIcon toolIcon(String? name, {String? summary, String? role}) {
  if (name == 'delegate') {
    final parsed = summary == null ? null : _roleFromSummary(summary);
    final direct = role == null ? null : _roleFromName(role);
    final found = direct ?? parsed;
    if (found != null) return _roleIcon(found);
  }
  return _familyIcons[toolFamily(name)]!;
}

/// Best-effort parse of a call summary, which is usually JSON-encoded
/// arguments.
Map<String, Object?> toolArgs(String? summary) {
  if (summary == null || summary.isEmpty) return {};
  try {
    final parsed = jsonDecode(summary);
    if (parsed is Map<String, Object?>) return parsed;
    if (parsed is Map) return Map<String, Object?>.from(parsed);
  } catch (_) {
    // Plain-text summaries (transcript tool messages) carry no arguments.
  }
  return {};
}

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;
double? _num(Object? v) => v is num && v.isFinite ? v.toDouble() : null;

/// Shorten long queries, URLs and text to a readable length.
String truncate(String text, [int max = 64]) {
  final t = text.trim();
  return t.length > max ? '${t.substring(0, max - 1).trimRight()}…' : t;
}

/// First line of a tool message, for the TraceDescription slot.
String? firstLine(String? text, [int max = 72]) {
  if (text == null || text.isEmpty) return null;
  final line = text.split('\n', ).first.trim();
  return line.isEmpty ? null : truncate(line, max);
}

String humanize(String name) {
  final s = name.replaceAll('_', ' ').trim();
  return s.isEmpty ? 'Tool' : s[0].toUpperCase() + s.substring(1);
}

String _hostAndPath(String url) {
  final u = Uri.tryParse(url);
  if (u == null || u.host.isEmpty) return truncate(url, 56);
  final path = u.path == '/' || u.path.isEmpty ? '' : u.path;
  return truncate('${u.host}$path', 56);
}

/// Sentence-like title for one tool call ("Indicators for NVDA",
/// "Searched the web for …", "Delegated to bear · SMH"). Falls back to a
/// plain sentence when the summary is not JSON arguments.
String toolTitle(String name, [String? summary]) {
  final args = toolArgs(summary);
  final hasArgs = args.isNotEmpty;
  if (hasArgs) {
    final symbol = _str(args['symbol']);
    switch (name) {
      case 'market_indicators':
        return symbol != null ? 'Indicators for $symbol' : 'Checked indicators';
      case 'market_price_history':
        return symbol != null
            ? 'Price history for $symbol'
            : 'Fetched price history';
      case 'market_compare':
        final symbols = args['symbols'] is List
            ? (args['symbols'] as List).whereType<String>().toList()
            : <String>[];
        return symbols.isNotEmpty
            ? 'Compared ${symbols.join(' vs ')}'
            : 'Compared symbols';
      case 'market_earnings':
        return symbol != null ? 'Earnings for $symbol' : 'Checked earnings';
      case 'market_earnings_calendar':
        return 'Earnings calendar';
      case 'market_economic_calendar':
        return 'Economic calendar';
      case 'market_volatility':
        return symbol != null ? 'Volatility for $symbol' : 'Checked volatility';
      case 'market_yields':
        return 'Treasury yields';
      case 'market':
        return 'Market overview';
      case 'sec_company':
        final cik = _str(args['cik']);
        final who = symbol ?? cik;
        return who != null ? 'SEC profile for $who' : 'Checked SEC profile';
      case 'get_quote':
        return symbol != null ? 'Quote for $symbol' : 'Checked quote';
      case 'get_portfolio':
        return 'Portfolio snapshot';
      case 'web_search':
        final query = _str(args['query']);
        return query != null
            ? 'Searched the web for ${truncate(query)}'
            : 'Searched the web';
      case 'open_page':
        final url = _str(args['url']);
        return url != null ? 'Opened ${_hostAndPath(url)}' : 'Opened page';
      case 'find_in_page':
        final pattern = _str(args['pattern']);
        return pattern != null
            ? 'Searched the page for ${truncate(pattern, 48)}'
            : 'Searched within page';
      case 'skills_load':
        final skill = _str(args['name']);
        return skill != null ? 'Loaded skill $skill' : 'Loaded skill';
      case 'skills_read_file':
        final path = _str(args['path']);
        return path != null ? 'Read $path' : 'Read skill file';
      case 'skills':
        return 'Listed skills';
      case 'notes_list':
        return 'Listed notes';
      case 'notes_read':
        return _str(args['path']) != null
            ? 'Read ${args['path']}'
            : 'Read note';
      case 'notes_write':
        return _str(args['path']) != null
            ? 'Wrote ${args['path']}'
            : 'Wrote note';
      case 'notes_append':
        return _str(args['path']) != null
            ? 'Appended to ${args['path']}'
            : 'Appended to note';
      case 'record_decision':
        final action = _str(args['action']);
        if (action != null && symbol != null) {
          return 'Recorded $action $symbol';
        }
        if (action != null) return 'Recorded $action';
        if (symbol != null) return 'Recorded decision for $symbol';
        return 'Recorded decision';
      case 'submit_order':
        final side = _str(args['side']);
        final quantity = _num(args['quantity']);
        if (side != null && quantity != null && symbol != null) {
          return 'Submitted $side ${_fmtQty(quantity)} $symbol';
        }
        if (symbol != null) return 'Submitted order for $symbol';
        return 'Submitted order';
      case 'cancel_order':
        return symbol != null ? 'Cancelled order for $symbol' : 'Cancelled order';
      case 'get_risk_state':
        return 'Checked risk state';
      case 'delegate':
        final role = _str(args['role']);
        if (role != null && symbol != null) return 'Delegated to $role · $symbol';
        if (role != null) return 'Delegated to $role';
        return 'Delegated';
      case 'codemode':
        return 'Ran script';
      default:
        if (name.startsWith('rh_')) return humanize(name.substring(3));
        return humanize(name);
    }
  }
  switch (name) {
    case 'market_indicators':
      return 'Checked indicators';
    case 'market_price_history':
      return 'Fetched price history';
    case 'market_compare':
      return 'Compared symbols';
    case 'market_earnings':
      return 'Checked earnings';
    case 'market_earnings_calendar':
      return 'Checked earnings calendar';
    case 'market_economic_calendar':
      return 'Checked economic calendar';
    case 'market_volatility':
      return 'Checked volatility';
    case 'market_yields':
      return 'Checked Treasury yields';
    case 'market':
      return 'Checked market data';
    case 'sec_company':
      return 'Checked SEC profile';
    case 'get_quote':
      return 'Checked quote';
    case 'get_portfolio':
      return 'Checked portfolio';
    case 'rh_status':
      return 'Checked broker status';
    case 'web_search':
      return 'Searched the web';
    case 'open_page':
      return 'Opened page';
    case 'find_in_page':
      return 'Searched within page';
    case 'skills_load':
      return 'Loaded skill';
    case 'skills_read_file':
      return 'Read skill file';
    case 'skills':
      return 'Listed skills';
    case 'notes_list':
      return 'Listed notes';
    case 'notes_read':
      return 'Read note';
    case 'notes_write':
      return 'Wrote note';
    case 'notes_append':
      return 'Appended to note';
    case 'record_decision':
      return 'Recorded decision';
    case 'submit_order':
      return 'Submitted order';
    case 'cancel_order':
      return 'Cancelled order';
    case 'get_risk_state':
      return 'Checked risk state';
    case 'delegate':
      return 'Delegated';
    case 'codemode':
      return 'Ran script';
    default:
      if (name.startsWith('rh_')) return humanize(name.substring(3));
      return humanize(name);
  }
}

/// Format a quantity the way JS template interpolation does (3, not 3.0).
String _fmtQty(double quantity) {
  if (quantity == quantity.truncateToDouble()) {
    return quantity.truncate().toString();
  }
  return '$quantity';
}

// `\]` is for the regexp engine: unescaped, `]` would close the class early.
// ignore: unnecessary_string_escapes
final _urlRe = RegExp(r'https?://[^\s<>")' "'" r'\]]+');

/// URLs found in a call summary or message text, for the Sources pattern.
List<String> extractUrls(String? text) {
  if (text == null || text.isEmpty) return [];
  final out = <String>[];
  for (final m in _urlRe.allMatches(text)) {
    final url = m.group(0)!.replaceAll(RegExp(r'[.,;:!?]+$'), '');
    if (url.isNotEmpty && !out.contains(url)) out.add(url);
    if (out.length >= 12) break;
  }
  return out;
}

class CallGroup<T> {
  const CallGroup({required this.name, required this.items});

  final String name;
  final List<T> items;
}

/// Group consecutive calls of the same tool into runs ("market_indicators
/// ×11"). Delegate calls always stay solo so each keeps its own subagent link.
List<CallGroup<T>> groupConsecutive<T>(
  List<T> items,
  String Function(T) nameOf,
) {
  final groups = <CallGroup<T>>[];
  for (final item in items) {
    final name = nameOf(item);
    final last = groups.isEmpty ? null : groups.last;
    if (last != null &&
        last.name == name &&
        name != 'delegate' &&
        name != 'submit_order') {
      last.items.add(item);
    } else {
      groups.add(CallGroup(name: name, items: [item]));
    }
  }
  return groups;
}

/// Link a `submit_order` tool message ("order ord-1: pending_approval …") to
/// its order.
OrderRecord? matchSubmitOrder(String text, List<OrderRecord> orders) {
  final id = RegExp(r'\border\s+([A-Za-z0-9_-]+):').firstMatch(text)?.group(1);
  if (id == null) return null;
  for (final o in orders) {
    if (o.id == id) return o;
  }
  return null;
}

const _badOrderStatuses = {
  OrderStatus.rejectedRisk,
  OrderStatus.rejectedUser,
  OrderStatus.failed,
  OrderStatus.expired,
};

/// True when the linked order ended badly, so the TraceLine shows the error
/// status. A `filled` order reads as success and a `cancelled` one as neutral:
/// both render a plain line, the same way `submitted` and the rejections do
/// today.
bool submitOrderFailed(OrderRecord? order) =>
    order != null && _badOrderStatuses.contains(order.status);

/// Display host and label for a source URL, with a favicon served from the
/// domain.
SourceMeta sourceMeta(String url) {
  final u = Uri.tryParse(url);
  if (u == null || u.host.isEmpty) {
    return SourceMeta(host: url, label: truncate(url, 56));
  }
  final path = u.path == '/' || u.path.isEmpty ? '' : u.path;
  return SourceMeta(host: u.host, label: truncate('${u.host}$path', 56));
}

class SourceMeta {
  const SourceMeta({required this.host, required this.label});

  final String host;
  final String label;

  @override
  bool operator ==(Object other) =>
      other is SourceMeta && host == other.host && label == other.label;

  @override
  int get hashCode => Object.hash(host, label);
}

/// Either participant in the feed: a transcript message or a script's nested
/// tool-call summary.
typedef AnyCall = Object;

bool isMessageCall(AnyCall call) => call is ChatMessage;

String callName(AnyCall call) =>
    isMessageCall(call) ? ((call as ChatMessage).toolName ?? 'tool') : (call as ToolCallSummary).name;

String? callSummary(AnyCall call) =>
    isMessageCall(call) ? null : (call as ToolCallSummary).summary;
