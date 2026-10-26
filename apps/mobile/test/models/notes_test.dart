import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:longbow/models/models.dart';

void main() {
  test('notes_parsesLiveNoteFiles', () {
    final list =
        jsonDecode(File('test/fixtures/notes.json').readAsStringSync()) as List;
    final notes =
        list.map((n) => NoteFile.fromJson(n as Map<String, dynamic>)).toList();

    expect(notes, hasLength(17));
    expect(notes.first.path, 'README.md');
    expect(notes.first.size, 371);
  });

  test('notes_parsesLiveSkills', () {
    final list =
        jsonDecode(File('test/fixtures/skills.json').readAsStringSync())
            as List;
    final skills = list
        .map((s) => SkillSummary.fromJson(s as Map<String, dynamic>))
        .toList();

    expect(skills, hasLength(18));
    expect(skills.first.name, 'code-mode-recipes');
    expect(skills.first.description, contains('JavaScript patterns'));
  });

  test('notes_parsesFullSkill', () {
    final skill = Skill.fromJson({
      'name': 'code-mode-recipes',
      'description': 'Tested JavaScript patterns for the sandbox.',
      'body': '# Code mode recipes\n\nSome markdown.',
      'files': ['examples/scan.js'],
    });

    expect(skill.name, 'code-mode-recipes');
    expect(skill.body, startsWith('# Code mode'));
    expect(skill.files, ['examples/scan.js']);
  });

  test('notes_parsesThesisContent', () {
    final json =
        jsonDecode(File('test/fixtures/symbol_nvda.json').readAsStringSync())
            as Map<String, dynamic>;
    final thesis =
        NoteContent.fromJson(json['thesis'] as Map<String, dynamic>);

    expect(thesis.path, 'theses/NVDA.md');
    expect(thesis.content.length, greaterThan(1000));
  });
}
