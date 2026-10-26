// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'notes.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

NoteFile _$NoteFileFromJson(Map<String, dynamic> json) => NoteFile(
  path: json['path'] as String,
  size: (json['size'] as num).toInt(),
  updatedAt: (json['updatedAt'] as num).toInt(),
);

NoteContent _$NoteContentFromJson(Map<String, dynamic> json) => NoteContent(
  path: json['path'] as String,
  content: json['content'] as String,
  updatedAt: (json['updatedAt'] as num).toInt(),
);

SkillSummary _$SkillSummaryFromJson(Map<String, dynamic> json) => SkillSummary(
  name: json['name'] as String,
  description: json['description'] as String,
);

Skill _$SkillFromJson(Map<String, dynamic> json) => Skill(
  name: json['name'] as String,
  description: json['description'] as String,
  body: json['body'] as String,
  files: (json['files'] as List<dynamic>).map((e) => e as String).toList(),
);
