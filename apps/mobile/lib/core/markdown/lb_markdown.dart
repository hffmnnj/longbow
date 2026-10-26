import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/theme.dart';
import '../widgets/code_block.dart';

/// Escapes single `~` (the agent writes "~1.3" to mean "about") so only
/// double-tilde strikes through. Leaves fenced and inline code untouched.
String protectSingleTildes(String source) {
  final single = RegExp(r'(?<!~)~(?!~)');
  var inFence = false;
  final out = <String>[];
  for (final line in source.split('\n')) {
    if (line.trimLeft().startsWith('```') || line.trimLeft().startsWith('~~~')) {
      inFence = !inFence;
      out.add(line);
      continue;
    }
    if (inFence || !line.contains('~')) {
      out.add(line);
      continue;
    }
    final parts = line.split('`');
    for (var i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replaceAll(single, r'\~');
    }
    out.add(parts.join('`'));
  }
  return out.join('\n');
}

/// True for links we are willing to open: http and https only.
bool isSafeLink(String? href) {
  final u = href == null ? null : Uri.tryParse(href);
  return u != null && (u.scheme == 'http' || u.scheme == 'https');
}

class _PreBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(BuildContext context, element, TextStyle? preferredStyle, TextStyle? parentStyle) {
    final text = element.textContent.replaceFirst(RegExp(r'\n$'), '');
    return Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: CodeBlock(text));
  }
}

/// Agent markdown rendered with Longbow tokens: headings, lists, quotes,
/// tables that scroll sideways, inline code and fenced [CodeBlock]s in Plex
/// Mono, links (http/https only, opened externally). Images and raw HTML
/// are not rendered. Single `~` stays literal. Soft line breaks are kept,
/// like the web renderer.
class LbMarkdown extends StatelessWidget {
  const LbMarkdown(this.data, {super.key, this.selectable = true});

  final String data;
  final bool selectable;

  @override
  Widget build(BuildContext context) {
    final c = context.lb;
    final t = Theme.of(context).textTheme;
    final body = t.bodyMedium!;
    TextStyle h(double size) => t.titleMedium!.copyWith(fontSize: size, fontWeight: FontWeight.w600, height: 1.3);
    final mono = LbText.number(context, size: 13, weight: FontWeight.w400);
    final cell = const EdgeInsets.symmetric(horizontal: 10, vertical: 8);
    final sheet = MarkdownStyleSheet(
      p: body,
      a: body.copyWith(color: c.primary, decoration: TextDecoration.underline, decorationColor: c.primary.withValues(alpha: 0.5)),
      h1: h(20),
      h2: h(17),
      h3: h(15),
      h4: h(15),
      h5: h(15),
      h6: h(15).copyWith(color: c.mutedForeground),
      em: body.copyWith(fontStyle: FontStyle.italic),
      strong: body.copyWith(fontWeight: FontWeight.w600),
      del: body.copyWith(decoration: TextDecoration.lineThrough, color: c.mutedForeground),
      code: mono.copyWith(backgroundColor: c.muted),
      listBullet: body.copyWith(color: c.mutedForeground),
      listIndent: 20,
      blockSpacing: 10,
      blockquote: body.copyWith(color: c.mutedForeground),
      blockquotePadding: const EdgeInsets.fromLTRB(12, 2, 4, 2),
      blockquoteDecoration: BoxDecoration(border: Border(left: BorderSide(color: c.input, width: 3))),
      horizontalRuleDecoration: BoxDecoration(border: Border(top: BorderSide(color: c.border))),
      tableHead: body.copyWith(fontWeight: FontWeight.w600),
      tableBody: body.copyWith(fontSize: 13.5),
      tableBorder: TableBorder.all(color: c.border),
      tableColumnWidth: const IntrinsicColumnWidth(),
      tableCellsPadding: cell,
      tableHeadCellsPadding: cell,
      tableHeadCellsDecoration: BoxDecoration(color: c.muted),
    );
    return MarkdownBody(
      data: protectSingleTildes(data),
      selectable: selectable,
      softLineBreak: true,
      styleSheet: sheet,
      builders: {'pre': _PreBuilder()},
      imageBuilder: (uri, title, alt) => alt == null || alt.isEmpty ? const SizedBox.shrink() : Text(alt, style: body),
      onTapLink: (text, href, title) {
        if (isSafeLink(href)) launchUrl(Uri.parse(href!), mode: LaunchMode.externalApplication);
      },
    );
  }
}
