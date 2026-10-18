import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyValid, edit, VALID } from './test-helpers.js';
import { readContentTree, type ContentTree } from './loader.js';
import {
  CONTENT_RULES,
  licenceCoverage,
  licenceTypes,
  mistakeTagsKnown,
  moduleReferences,
  MIN_RUBRIC_ANSWERS,
  paidSupersetOfFree,
  questionAnswers,
  reviewerPresent,
  rubricCount,
} from './rules.js';

function tree(dir: string): ContentTree {
  return readContentTree(dir).tree;
}

describe('content rules on the valid fixture', () => {
  it.each(CONTENT_RULES.map((r) => [r.name, r] as const))('%s passes', (_name, rule) => {
    expect(rule(tree(VALID))).toEqual([]);
  });

  it('has the eight rules from the plan', () => {
    expect(CONTENT_RULES).toHaveLength(8);
    expect(MIN_RUBRIC_ANSWERS).toBe(30);
  });
});

describe('rule 1: licence coverage', () => {
  it('reports a content file with no licence entry', () => {
    const dir = copyValid();
    edit(dir, 'licences.yaml', (s) =>
      s.replace('  - path: common-mistakes.yaml\n    licence: CC0-1.0\n', ''),
    );
    expect(licenceCoverage(tree(dir))).toEqual(['common-mistakes.yaml: no entry in licences.yaml']);
  });

  it('reports duplicate entries and entries for files that do not exist', () => {
    const dir = copyValid();
    edit(
      dir,
      'licences.yaml',
      (s) =>
        s +
        '  - path: course.yaml\n    licence: CC0-1.0\n' +
        '  - path: modules/gone/notes.md\n    licence: CC0-1.0\n',
    );
    expect(licenceCoverage(tree(dir))).toEqual([
      'licences.yaml: course.yaml has 2 entries (expected exactly one)',
      'licences.yaml: entry for modules/gone/notes.md, but there is no such file',
    ]);
  });

  it('needs no entry for licences.yaml itself', () => {
    const dir = copyValid();
    edit(dir, 'licences.yaml', (s) => s + '  - path: licences.yaml\n    licence: CC0-1.0\n');
    expect(licenceCoverage(tree(dir))).toEqual([
      'licences.yaml: entry for licences.yaml, but licences.yaml needs none',
    ]);
  });

  it('is skipped when licences.yaml did not load', () => {
    const dir = copyValid();
    unlinkSync(join(dir, 'licences.yaml'));
    expect(licenceCoverage(tree(dir))).toEqual([]);
  });
});

describe('rule 2: licence types', () => {
  it.each(['CC-BY-NC-4.0', 'CC-BY-ND-4.0', 'GPL-3.0'])('rejects %s', (bad) => {
    const dir = copyValid();
    edit(dir, 'licences.yaml', (s) =>
      s.replace(
        'path: course.yaml\n    licence: CC0-1.0',
        `path: course.yaml\n    licence: ${bad}`,
      ),
    );
    expect(licenceTypes(tree(dir))).toEqual([
      `licences.yaml: course.yaml has licence "${bad}"; allowed: CC-BY-4.0, CC-BY-SA-4.0, CC0-1.0, public-domain`,
    ]);
  });

  it('requires source_url for third-party (non-CC0) material and attribution for CC BY', () => {
    const dir = copyValid();
    edit(dir, 'licences.yaml', (s) =>
      s
        .replace(
          'path: course.yaml\n    licence: CC0-1.0',
          'path: course.yaml\n    licence: public-domain',
        )
        .replace(
          '    source_url: https://example.org/fixture-source\n    attribution: Fixture Author\n',
          '',
        ),
    );
    expect(licenceTypes(tree(dir))).toEqual([
      'licences.yaml: course.yaml is public-domain third-party material; add source_url',
      'licences.yaml: modules/loops/notes.md is CC-BY-SA-4.0 third-party material; add source_url',
      'licences.yaml: modules/loops/notes.md is CC-BY-SA-4.0; add attribution',
    ]);
  });

  it('is skipped when licences.yaml did not load', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'licences.yaml'), 'entries: 3\n');
    expect(licenceTypes(tree(dir))).toEqual([]);
  });
});

describe('rule 3: reviewer present', () => {
  it('passes when every entry names its own reviewer and there is no default', () => {
    const dir = copyValid();
    edit(dir, 'licences.yaml', (s) =>
      s
        .replace('reviewed_by: fixture-reviewer\n', '')
        .replaceAll(/( {4}licence: [^\n]+\n)/g, '$1    reviewed_by: someone\n'),
    );
    expect(reviewerPresent(tree(dir))).toEqual([]);
  });

  it('reports entries with no reviewer when there is no default', () => {
    const dir = copyValid();
    edit(dir, 'licences.yaml', (s) =>
      s
        .replace('reviewed_by: fixture-reviewer\n', '')
        .replace(
          'path: course.yaml\n    licence: CC0-1.0\n',
          'path: course.yaml\n    licence: CC0-1.0\n    reviewed_by: someone\n',
        ),
    );
    const issues = reviewerPresent(tree(dir));
    expect(issues).toHaveLength(tree(dir).files.length - 2); // all but licences.yaml and course.yaml
    expect(issues[0]).toBe(
      'licences.yaml: common-mistakes.yaml has no reviewed_by (and no top-level default)',
    );
  });

  it('is skipped when licences.yaml did not load', () => {
    const dir = copyValid();
    unlinkSync(join(dir, 'licences.yaml'));
    expect(reviewerPresent(tree(dir))).toEqual([]);
  });
});

describe('rule 4: rubric count', () => {
  it('fails with 29 rubric answers', () => {
    const dir = copyValid();
    edit(dir, 'rubric-answers/loops.yaml', (s) => s.split('- id: loops-r15')[0] ?? '');
    expect(rubricCount(tree(dir))).toEqual([
      'rubric-answers/: 29 rubric-scored answers; at least 30 are required',
    ]);
  });

  it('counts across files and passes at exactly 30', () => {
    expect(tree(VALID).rubricAnswers.map((f) => f.items.length)).toEqual([15, 15]);
    expect(rubricCount(tree(VALID))).toEqual([]);
  });
});

describe('rule 5: question-bank answers', () => {
  it('reports every question with a blank answer', () => {
    const dir = copyValid();
    edit(dir, 'question-bank/loops.yaml', (s) =>
      s
        .replace('answer: Fixture answer one.', 'answer: ""')
        .replace('answer: Fixture answer two.', "answer: '   '"),
    );
    expect(questionAnswers(tree(dir))).toEqual([
      'question-bank/loops.yaml: question loops-q1 has no answer',
      'question-bank/loops.yaml: question loops-q2 has no answer',
    ]);
  });
});

describe('rule 6: module and question references', () => {
  it('reports dangling module ids everywhere they appear', () => {
    const dir = copyValid();
    edit(dir, 'qa-recall.yaml', (s) =>
      s.replace('expectedModuleId: loops', 'expectedModuleId: dictionaries'),
    );
    edit(dir, 'question-bank/variables.yaml', (s) =>
      s.replace(
        'moduleId: variables\n  question: Fixture question two',
        'moduleId: sets\n  question: Fixture question two',
      ),
    );
    edit(dir, 'rubric-answers/loops.yaml', (s) =>
      s.replace('id: loops-r01\n  moduleId: loops', 'id: loops-r01\n  moduleId: tuples'),
    );
    edit(dir, 'packages/free.yaml', (s) =>
      s.replace('  - variables', '  - variables\n  - classes'),
    );
    expect(moduleReferences(tree(dir))).toEqual([
      'packages/free.yaml: moduleIds entry "classes" is not a module in course.yaml',
      'qa-recall.yaml: recall-2 expectedModuleId "dictionaries" is not a module in course.yaml',
      'question-bank/variables.yaml: variables-q2 moduleId "sets" is not a module in course.yaml',
      'rubric-answers/loops.yaml: loops-r01 moduleId "tuples" is not a module in course.yaml',
    ]);
  });

  it('reports a rubric answer pointing at an unknown question', () => {
    const dir = copyValid();
    edit(dir, 'rubric-answers/variables.yaml', (s) =>
      s.replace('questionId: variables-q1', 'questionId: variables-q9'),
    );
    expect(moduleReferences(tree(dir))).toContain(
      'rubric-answers/variables.yaml: variables-r01 questionId "variables-q9" is not in the question bank',
    );
  });

  it('reports a course module with no notes and a notes folder with no module', () => {
    const dir = copyValid();
    rmSync(join(dir, 'modules', 'loops'), { recursive: true });
    mkdirSync(join(dir, 'modules', 'strings'));
    writeFileSync(join(dir, 'modules', 'strings', 'notes.md'), '# Strings\n');
    expect(moduleReferences(tree(dir))).toEqual([
      'course.yaml: module loops has no modules/loops/notes.md',
      'modules/strings/: folder is not a module in course.yaml',
    ]);
  });

  it('reports duplicate ids', () => {
    const dir = copyValid();
    edit(dir, 'question-bank/loops.yaml', (s) => s.replace('id: loops-q2', 'id: variables-q1'));
    edit(dir, 'course.yaml', (s) =>
      s.replace(
        '  - id: loops\n    title: Loops\n',
        '  - id: loops\n    title: Loops\n  - id: loops\n    title: Again\n',
      ),
    );
    edit(dir, 'qa-recall.yaml', (s) =>
      s.replace('id: recall-2', 'id: recall-1').replace('moduleId: loops', 'moduleId: graphs'),
    );
    edit(dir, 'rubric-answers/loops.yaml', (s) => s.replace('id: loops-r02', 'id: loops-r01'));
    const issues = moduleReferences(tree(dir));
    expect(issues).toContain('rubric-answers/: answer id "loops-r01" appears 2 times');
    expect(issues).toContain(
      'qa-recall.yaml: recall-1 moduleId "graphs" is not a module in course.yaml',
    );
    expect(issues).toContain('course.yaml: module id "loops" appears 2 times');
    expect(issues).toContain('question-bank/: question id "variables-q1" appears 2 times');
    expect(issues).toContain('qa-recall.yaml: id "recall-1" appears 2 times');
  });

  it('is skipped when course.yaml did not load', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'course.yaml'), 'id: x\n');
    expect(moduleReferences(tree(dir))).toEqual([]);
  });
});

describe('rule 7: style card mistake tags', () => {
  it('reports tags missing from common-mistakes.yaml', () => {
    const dir = copyValid();
    edit(dir, 'style-card.yaml', (s) => s + '  - forgot-colon\n  - bad-indent\n');
    expect(mistakeTagsKnown(tree(dir))).toEqual([
      'style-card.yaml: mistakeTag "forgot-colon" is not in common-mistakes.yaml',
      'style-card.yaml: mistakeTag "bad-indent" is not in common-mistakes.yaml',
    ]);
  });

  it('reports duplicate common-mistake tags', () => {
    const dir = copyValid();
    edit(dir, 'common-mistakes.yaml', (s) =>
      s.replace('tag: string-number-mixup', 'tag: off-by-one'),
    );
    expect(mistakeTagsKnown(tree(dir))).toEqual([
      'common-mistakes.yaml: tag "off-by-one" appears 2 times',
    ]);
  });

  it('is skipped when the style card did not load', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'style-card.yaml'), `text: ${'w '.repeat(301)}\nmistakeTags: [nope]\n`);
    expect(mistakeTagsKnown(tree(dir))).toEqual([]);
  });
});

describe('rule 8: paid is a strict superset of free', () => {
  it('reports missing modules and skills, and no extras', () => {
    const dir = copyValid();
    edit(dir, 'packages/paid.yaml', (s) =>
      s
        .replace('  - variables\n  - loops', '  - loops')
        .replace('  - explain\n  - practice', '  - practice'),
    );
    expect(paidSupersetOfFree(tree(dir))).toEqual([
      'packages/paid.yaml: moduleIds is missing "variables" from the free package',
      'packages/paid.yaml: skills is missing "explain" from the free package',
    ]);
  });

  it('reports a paid package equal to free', () => {
    const dir = copyValid();
    edit(dir, 'packages/paid.yaml', (s) =>
      s
        .replace('  - variables\n  - loops', '  - variables')
        .replace('  - explain\n  - practice', '  - explain'),
    );
    expect(paidSupersetOfFree(tree(dir))).toEqual([
      'packages/paid.yaml: moduleIds adds no module beyond the free package',
      'packages/paid.yaml: skills adds no skill beyond the free package',
    ]);
  });

  it('is skipped when a package did not load', () => {
    const dir = copyValid();
    unlinkSync(join(dir, 'packages', 'free.yaml'));
    expect(paidSupersetOfFree(tree(dir))).toEqual([]);
  });
});
