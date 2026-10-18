import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BROKEN_ALL, copyValid, edit, tempDir, VALID } from './test-helpers.js';
import { validateContentDir } from './validate.js';

describe('validateContentDir', () => {
  it('passes the valid fixture with no issues', () => {
    expect(validateContentDir(VALID)).toEqual({ ok: true, issues: [] });
  });

  it('reports every issue in the broken-all fixture, not just the first', () => {
    const { ok, issues } = validateContentDir(BROKEN_ALL);
    expect(ok).toBe(false);
    const expected = [
      // missing licence entry
      'common-mistakes.yaml: no entry in licences.yaml',
      // licence type outside the allowed list
      'licences.yaml: course.yaml has licence "CC-BY-NC-4.0"; allowed: CC-BY-4.0, CC-BY-SA-4.0, CC0-1.0, public-domain',
      // fewer than 30 rubric answers
      'rubric-answers/: 29 rubric-scored answers; at least 30 are required',
      // dangling module reference
      'qa-recall.yaml: recall-2 expectedModuleId "dictionaries" is not a module in course.yaml',
      // paid package not a superset of free
      'packages/paid.yaml: moduleIds is missing "variables" from the free package',
      'packages/paid.yaml: skills is missing "explain" from the free package',
    ];
    for (const issue of expected) expect(issues).toContain(issue);
    // style card over 300 words (a schema error from the frozen StyleCardSchema refine)
    expect(
      issues.some((i) => /^style-card\.yaml: invalid content[\s\S]*at most 300 words/.test(i)),
    ).toBe(true);
    expect(issues).toHaveLength(expected.length + 1);
  });

  it('collects file-level errors together with rule issues', () => {
    const dir = copyValid();
    writeFileSync(join(dir, 'common-mistakes.yaml'), 'not: [valid\n');
    edit(dir, 'rubric-answers/loops.yaml', (s) => s.split('- id: loops-r15')[0] ?? '');
    const { ok, issues } = validateContentDir(dir);
    expect(ok).toBe(false);
    expect(issues[0]).toMatch(/^common-mistakes\.yaml: invalid YAML/);
    expect(issues).toContain('rubric-answers/: 29 rubric-scored answers; at least 30 are required');
  });

  it('fails a directory that is not a content tree', () => {
    expect(validateContentDir(tempDir())).toEqual({
      ok: false,
      issues: ['course.yaml: missing; not a recognised content directory'],
    });
  });

  it('fails a directory that does not exist', () => {
    const missing = join(tempDir(), 'nope');
    expect(validateContentDir(missing)).toEqual({
      ok: false,
      issues: [`${missing}: no such content directory`],
    });
  });
});
