import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BROKEN_ALL,
  copyLocalesValid,
  copyNoticesValid,
  copyValid,
  edit,
  LOCALES_VALID,
  NOTICES_VALID,
  tempDir,
  VALID,
} from './test-helpers.js';
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

  it('passes a valid locale-packs directory', () => {
    expect(validateContentDir(LOCALES_VALID)).toEqual({ ok: true, issues: [] });
  });

  it('fails a locale pack with a missing field, and runs the locale rules on the rest', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace(/^ {2}grievance: .*\n/m, ''));
    edit(dir, 'global.yaml', (s) => s.replace('languages: [en]', 'languages: [en, hi]'));
    const { ok, issues } = validateContentDir(dir);
    expect(ok).toBe(false);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/^XX\.yaml: invalid locale pack[\s\S]*compliance\.grievance/);
    // Without its one market pack, the remaining rules still run on the default pack.
    expect(issues.slice(1)).toEqual([
      'global.yaml: languages must be exactly [en] during the pilot; got [en, hi]',
    ]);
  });

  it('fails a directory that does not exist', () => {
    const missing = join(tempDir(), 'nope');
    expect(validateContentDir(missing)).toEqual({
      ok: false,
      issues: [`${missing}: no such content directory`],
    });
  });

  it('passes a signed privacy-notices directory', () => {
    expect(validateContentDir(NOTICES_VALID)).toEqual({ ok: true, issues: [] });
  });

  it('fails a privacy notice left "pending", with file errors collected too', () => {
    const dir = copyNoticesValid();
    edit(dir, 'XX.md', (s) => s.replace('reviewedBy: Example Reviewer', 'reviewedBy: pending'));
    edit(dir, 'global.md', (s) => s.replace('market: global', 'market: XX'));
    expect(validateContentDir(dir)).toEqual({
      ok: false,
      issues: [
        'global.md: market "XX" does not match the file name (expected "global")',
        'global.md: missing; the default notice is required (it serves every market without one)',
        'XX.md: reviewedBy is "pending"; a named person must sign this notice',
      ],
    });
  });
});
