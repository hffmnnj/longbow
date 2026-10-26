import 'package:json_annotation/json_annotation.dart';

part 'notes.g.dart';

/// A file in the agent's durable notes workspace (theses, plans, lessons).
@JsonSerializable(createToJson: false)
class NoteFile {
  const NoteFile({
    required this.path,
    required this.size,
    required this.updatedAt,
  });

  factory NoteFile.fromJson(Map<String, dynamic> json) =>
      _$NoteFileFromJson(json);

  final String path;
  final int size;
  final int updatedAt;
}

@JsonSerializable(createToJson: false)
class NoteContent {
  const NoteContent({
    required this.path,
    required this.content,
    required this.updatedAt,
  });

  factory NoteContent.fromJson(Map<String, dynamic> json) =>
      _$NoteContentFromJson(json);

  final String path;
  final String content;
  final int updatedAt;
}

@JsonSerializable(createToJson: false)
class SkillSummary {
  const SkillSummary({required this.name, required this.description});

  factory SkillSummary.fromJson(Map<String, dynamic> json) =>
      _$SkillSummaryFromJson(json);

  final String name;
  final String description;
}

@JsonSerializable(createToJson: false)
class Skill {
  const Skill({
    required this.name,
    required this.description,
    required this.body,
    required this.files,
  });

  factory Skill.fromJson(Map<String, dynamic> json) => _$SkillFromJson(json);

  final String name;
  final String description;

  /// SKILL.md body (markdown, frontmatter removed).
  final String body;

  /// Extra files in the skill folder, relative to it.
  final List<String> files;
}
