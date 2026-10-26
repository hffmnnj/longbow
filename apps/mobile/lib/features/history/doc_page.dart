// STUB: replaced by the owning feature slice. Keep the public class name and constructor.
import 'package:flutter/material.dart';

enum DocKind { note, skill }

class DocPage extends StatelessWidget {
  const DocPage({super.key, required this.kind, required this.id});

  final DocKind kind;

  /// Note path such as `theses/NVDA.md`, or a skill name.
  final String id;

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(), body: Center(child: Text(id)));
}
