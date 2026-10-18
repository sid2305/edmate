import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyValid, tempDir, VALID } from './test-helpers.js';
import { ContentLoadError, loadDemoTeacherContent, readContentTree } from './loader.js';

describe('loadDemoTeacherContent', () => {
  it('loads the valid fixture into a structured object', () => {
    const c = loadDemoTeacherContent(VALID);
    expect(c.course.id).toBe('fixture-course');
    expect(c.course.modules.map((m) => m.id)).toEqual(['variables', 'loops']);
    expect([...c.notes.keys()].sort()).toEqual(['loops', 'variables']);
    expect(c.questionBank.map((f) => f.file)).toEqual([
      'question-bank/loops.yaml',
      'question-bank/variables.yaml',
    ]);
    expect(c.rubricAnswers.flatMap((f) => f.items)).toHaveLength(30);
    expect(c.styleCard.mistakeTags).toEqual(['off-by-one']);
    expect(c.commonMistakes.map((m) => m.tag)).toEqual(['off-by-one', 'string-number-mixup']);
    expect(c.qaRecall).toHaveLength(2);
    expect(c.packages.free.name).toBe('Free');
    expect(c.packages.paid.moduleIds).toEqual(['variables', 'loops']);
    expect(c.licences.reviewed_by).toBe('fixture-reviewer');
    expect(c.files).toContain('licences.yaml');
    expect(c.files).toContain('modules/loops/notes.md');
    expect(c.files).toEqual([...c.files].sort());
  });

  it('throws ContentLoadError naming the file for malformed YAML', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'course.yaml'), 'id: [unclosed\n');
    expect(() => loadDemoTeacherContent(dir)).toThrow(ContentLoadError);
    try {
      loadDemoTeacherContent(dir);
    } catch (e) {
      expect((e as ContentLoadError).filePath).toBe('course.yaml');
      expect((e as Error).message).toMatch(/^course\.yaml: invalid YAML/);
    }
  });

  it('throws ContentLoadError naming the file for a schema-invalid file', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'style-card.yaml'), `text: ${'word '.repeat(301)}\nmistakeTags: []\n`);
    expect(() => loadDemoTeacherContent(dir)).toThrow(/^style-card\.yaml: invalid content/);
  });

  it('throws when a required file is missing', () => {
    const dir = copyValid();
    unlinkSync(join(dir, 'packages', 'paid.yaml'));
    expect(() => loadDemoTeacherContent(dir)).toThrow(
      /packages\/paid\.yaml: missing required file/,
    );
  });
});

describe('readContentTree', () => {
  it('reports no errors for the valid fixture', () => {
    expect(readContentTree(VALID).errors).toEqual([]);
  });

  it('collects an error per bad file and keeps loading the others', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'course.yaml'), 'id: [unclosed\n');
    writeFileSync(join(dir, 'qa-recall.yaml'), '- id: only-an-id\n');
    const { tree, errors } = readContentTree(dir);
    expect(errors.map((e) => e.filePath)).toEqual(['course.yaml', 'qa-recall.yaml']);
    expect(tree.course).toBeUndefined();
    expect(tree.qaRecall).toBeUndefined();
    expect(tree.styleCard).toBeDefined();
    expect(tree.packages.free).toBeDefined();
  });

  it('reports missing required files and empty folders', () => {
    const dir = tempDir();
    const { errors } = readContentTree(dir);
    expect(errors.map((e) => e.message)).toEqual([
      // Sorted by path, so the output is stable.
      'common-mistakes.yaml: missing required file',
      'course.yaml: missing required file',
      'licences.yaml: missing required file',
      'packages/free.yaml: missing required file',
      'packages/paid.yaml: missing required file',
      'qa-recall.yaml: missing required file',
      'question-bank/: no .yaml files',
      'rubric-answers/: no .yaml files',
      'style-card.yaml: missing required file',
    ]);
  });

  it('reports a file that is not part of the layout', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'notes.txt'), 'stray\n');
    writeFileSync(join(dir, 'question-bank', 'readme.md'), 'stray\n');
    writeFileSync(join(dir, 'packages', 'gold.yaml'), 'name: Gold\n');
    const { errors } = readContentTree(dir);
    expect(errors.map((e) => e.filePath)).toEqual([
      'notes.txt',
      'packages/gold.yaml',
      'question-bank/readme.md',
    ]);
    expect(errors[0]?.message).toMatch(/not part of the content layout/);
  });

  it('ignores hidden files such as .gitkeep and .DS_Store', () => {
    const dir = copyValid();
    writeFileSync(join(dir, '.gitkeep'), '');
    writeFileSync(join(dir, 'modules', '.DS_Store'), 'x');
    const { tree, errors } = readContentTree(dir);
    expect(errors).toEqual([]);
    expect(tree.files.some((f) => f.includes('.gitkeep') || f.includes('.DS_Store'))).toBe(false);
  });

  it('reads module notes by folder and rejects blank notes', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'modules', 'loops', 'notes.md'), '  \n');
    mkdirSync(join(dir, 'modules', 'extra'));
    writeFileSync(join(dir, 'modules', 'extra', 'diagram.svg'), '<svg/>');
    const { tree, errors } = readContentTree(dir);
    expect(errors.map((e) => e.message)).toEqual(['modules/loops/notes.md: notes are empty']);
    expect([...tree.notes.keys()]).toEqual(['variables']);
    expect(tree.moduleDirs).toEqual(['extra', 'loops', 'variables']);
  });

  it('rejects a file that is valid YAML but the wrong shape (list expected)', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'rubric-answers', 'loops.yaml'), 'id: not-a-list\n');
    const { tree, errors } = readContentTree(dir);
    expect(errors.map((e) => e.filePath)).toEqual(['rubric-answers/loops.yaml']);
    expect(tree.rubricAnswers.map((f) => f.file)).toEqual(['rubric-answers/variables.yaml']);
  });

  it('throws for a directory that does not exist', () => {
    expect(() => readContentTree(join(tempDir(), 'missing'))).toThrow(/no such content directory/);
  });
});
