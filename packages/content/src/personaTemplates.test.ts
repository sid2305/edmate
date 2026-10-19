import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readPersonaTemplateDir, validatePersonaTemplateDir } from './personaTemplates.js';

const here = dirname(fileURLToPath(import.meta.url));
const VALID = resolve(here, '../test/fixtures/skills/mock_interview/valid');

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A copy of the valid fixture directory with one change applied. */
function broken(edit: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-persona-'));
  temps.push(dir);
  cpSync(VALID, dir, { recursive: true });
  edit(dir);
  return dir;
}

function editFile(dir: string, file: string, fn: (text: string) => string): void {
  const p = join(dir, file);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

describe('readPersonaTemplateDir', () => {
  it('loads exactly the two mock-interview templates, both valid', () => {
    const { templates, issues } = readPersonaTemplateDir(VALID);
    expect(issues).toEqual([]);
    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.name).sort()).toEqual(['Interviewer', 'Viva examiner']);
    for (const t of templates) {
      expect(t.reviewedBy).toBe('fixture');
      expect(t.mustNot.length).toBeGreaterThan(0);
      expect(t.style.length).toBeGreaterThan(0);
    }
  });

  it('a missing directory', () => {
    const r = validatePersonaTemplateDir(join(tmpdir(), 'edmate-no-such-persona-dir'));
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/no such persona-template directory$/);
  });

  it('ignores a README and hidden files', () => {
    const dir = broken((d) => {
      writeFileSync(join(d, 'README.md'), '# Persona templates\n');
      writeFileSync(join(d, '.DS_Store'), '');
    });
    expect(validatePersonaTemplateDir(dir)).toEqual({ ok: true, issues: [] });
  });

  it('a file outside the layout', () => {
    const dir = broken((d) => {
      writeFileSync(join(d, 'notes.txt'), 'x');
    });
    const r = validatePersonaTemplateDir(dir);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([
      'notes.txt: not part of the persona-template layout (<id>@<semver>.yaml)',
    ]);
  });
});

describe('validatePersonaTemplateDir: each broken fixture gives one named issue', () => {
  const cases: [string, (dir: string) => void, RegExp][] = [
    [
      'bad semver-less version in the file name',
      (d) => {
        cpSync(join(d, 'viva@1.0.0.yaml'), join(d, 'viva@latest.yaml'));
      },
      /^viva@latest\.yaml: bad semver "latest"$/,
    ],
    [
      'file name and template version disagree',
      (d) => {
        editFile(d, 'viva@1.0.0.yaml', (t) => t.replace('version: 1.0.0', 'version: 1.0.1'));
      },
      /^viva@1\.0\.0\.yaml: the file name says version 1\.0\.0 but the template says 1\.0\.1$/,
    ],
    [
      'missing must_not',
      (d) => {
        editFile(d, 'viva@1.0.0.yaml', (t) =>
          t.replace(/must_not:\n(?:\s+-.*\n)+/, ''),
        );
      },
      /^viva@1\.0\.0\.yaml: invalid persona template: /,
    ],
    [
      'empty style',
      (d) => {
        editFile(d, 'viva@1.0.0.yaml', (t) => t.replace(/style:.*/, 'style: ""'));
      },
      /^viva@1\.0\.0\.yaml: invalid persona template: /,
    ],
    [
      'missing reviewed_by',
      (d) => {
        editFile(d, 'viva@1.0.0.yaml', (t) => t.replace(/reviewed_by:.*\n/, ''));
      },
      /^viva@1\.0\.0\.yaml: invalid persona template: /,
    ],
    [
      'invalid YAML',
      (d) => {
        writeFileSync(join(d, 'viva@1.0.0.yaml'), 'id: [unclosed\n');
      },
      /^viva@1\.0\.0\.yaml: invalid YAML: /,
    ],
  ];

  it.each(cases)('%s', (_name, edit, issue) => {
    const r = validatePersonaTemplateDir(broken(edit));
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatch(issue);
  });
});
