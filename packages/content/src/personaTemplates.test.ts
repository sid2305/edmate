import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PipelineDeps } from '@edmate/harness';
import { resolvePersona } from '@edmate/harness';
import { afterEach, describe, expect, it } from 'vitest';
import {
  comparePersonaVersions,
  type PersonaTemplate,
  readPersonaLibrary,
  readPersonaTemplateDir,
  selectPersonaLibrary,
  validatePersonaTemplateDir,
} from './personaTemplates.js';

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
      'file name and template id disagree',
      (d) => {
        editFile(d, 'viva@1.0.0.yaml', (t) => t.replace('id: viva', 'id: oral-exam'));
      },
      /^viva@1\.0\.0\.yaml: the file name says id viva but the template says oral-exam$/,
    ],
    [
      'missing must_not',
      (d) => {
        editFile(d, 'viva@1.0.0.yaml', (t) => t.replace(/must_not:\n(?:\s+-.*\n)+/, ''));
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
      'blank reviewed_by (spaces only)',
      (d) => {
        editFile(d, 'viva@1.0.0.yaml', (t) => t.replace(/reviewed_by:.*/, 'reviewed_by: "  "'));
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

/** Writes `<slug>@<version>.yaml` as a copy of the fixture viva with a new version and sign-off. */
function addViva(dir: string, version: string, reviewedBy: string, slug = 'viva'): void {
  const text = readFileSync(join(VALID, 'viva@1.0.0.yaml'), 'utf8')
    .replace('version: 1.0.0', `version: ${version}`)
    .replace(/reviewed_by:.*/, `reviewed_by: ${reviewedBy}`)
    .replace('id: viva', `id: ${slug}`)
    .replace(/end_after_questions:.*/, 'end_after_questions: 3');
  writeFileSync(join(dir, `${slug}@${version}.yaml`), text);
}

function template(over: Partial<PersonaTemplate> = {}): PersonaTemplate {
  return {
    id: 'viva',
    name: 'Viva examiner',
    style: 'calm',
    mustNot: ['reveal a model answer'],
    endAfterQuestions: 5,
    version: '1.0.0',
    reviewedBy: 'fixture',
    ...over,
  };
}

describe('readPersonaTemplateDir keeps the version', () => {
  it('each template carries its file version', () => {
    const { templates } = readPersonaTemplateDir(VALID);
    expect(templates.map((t) => `${t.id}@${t.version}`)).toEqual([
      'job-interview@1.0.0',
      'viva@1.0.0',
    ]);
  });
});

describe('readPersonaLibrary: signed-only, highest version per id', () => {
  it('builds a frozen library keyed by id from the signed fixture templates', () => {
    const lib = readPersonaLibrary(VALID);
    expect([...lib.keys()].sort()).toEqual(['job-interview', 'viva']);
    const viva = lib.get('viva');
    expect(viva).toMatchObject({ id: 'viva', name: 'Viva examiner', endAfterQuestions: 6 });
    // Persona-shaped only: no review metadata reaches the harness.
    expect(viva).not.toHaveProperty('reviewedBy');
    expect(viva).not.toHaveProperty('version');
    expect(Object.isFrozen(viva)).toBe(true);
    expect(() => (lib as Map<string, unknown>).set('x', {})).toThrow(/read-only/);
  });

  it('is what the harness takes as deps.personas, and resolvePersona finds a stored id', () => {
    const deps: Pick<PipelineDeps, 'personas'> = { personas: readPersonaLibrary(VALID) };
    expect(deps.personas?.get('job-interview')?.name).toBe('Interviewer');
    const start = resolvePersona(
      { kind: 'skill_action', skill: 'mock_interview', skillPayload: { persona: 'viva' } },
      { help: {}, unreadable: false },
      deps.personas,
    );
    expect(start?.name).toBe('Viva examiner');
  });

  it('a newer signed version replaces the older one', () => {
    const dir = broken((d) => addViva(d, '1.1.0', 'fixture'));
    const viva = readPersonaLibrary(dir).get('viva');
    expect(viva?.endAfterQuestions).toBe(3);
    expect(selectPersonaLibrary(readPersonaTemplateDir(dir).templates).chosen.get('viva')).toBe(
      '1.1.0',
    );
  });

  it('a newer unsigned version never goes live; the older signed one stays', () => {
    const dir = broken((d) => addViva(d, '2.0.0', 'pending'));
    expect(readPersonaLibrary(dir).get('viva')?.endAfterQuestions).toBe(6);
    expect(selectPersonaLibrary(readPersonaTemplateDir(dir).templates).chosen.get('viva')).toBe(
      '1.0.0',
    );
  });

  it('an id with only unsigned versions is left out', () => {
    const dir = broken((d) => {
      rmSync(join(d, 'viva@1.0.0.yaml'));
      addViva(d, '1.0.0', 'pending');
    });
    const lib = readPersonaLibrary(dir);
    expect([...lib.keys()]).toEqual(['job-interview']);
  });

  it('"pending" in any case or with spaces counts as unsigned', () => {
    const dir = broken((d) => addViva(d, '1.1.0', '" Pending "'));
    expect(selectPersonaLibrary(readPersonaTemplateDir(dir).templates).chosen.get('viva')).toBe(
      '1.0.0',
    );
  });

  it('compares versions numerically, not as text', () => {
    const dir = broken((d) => {
      addViva(d, '1.9.0', 'fixture');
      addViva(d, '1.10.0', 'fixture');
    });
    expect(selectPersonaLibrary(readPersonaTemplateDir(dir).templates).chosen.get('viva')).toBe(
      '1.10.0',
    );
  });

  it('an empty directory gives an empty library', () => {
    const dir = broken((d) => {
      rmSync(join(d, 'viva@1.0.0.yaml'));
      rmSync(join(d, 'job-interview@1.0.0.yaml'));
    });
    expect(readPersonaLibrary(dir).size).toBe(0);
  });

  it('throws listing every issue when the directory has any', () => {
    const dir = broken((d) => {
      writeFileSync(join(d, 'notes.txt'), 'x');
      editFile(d, 'viva@1.0.0.yaml', (t) => t.replace('id: viva', 'id: oral-exam'));
    });
    expect(() => readPersonaLibrary(dir)).toThrow(
      /invalid persona templates in .*:\nnotes\.txt: .*\nviva@1\.0\.0\.yaml: the file name says id viva/,
    );
  });

  it('throws for a missing directory', () => {
    expect(() => readPersonaLibrary(join(tmpdir(), 'edmate-no-such-persona-dir'))).toThrow(
      /no such persona-template directory/,
    );
  });
});

describe('selectPersonaLibrary', () => {
  it('rejects a duplicate id and version, signed or not', () => {
    const r = selectPersonaLibrary([
      template(),
      template({ reviewedBy: 'pending' }),
      template({ id: 'job-interview' }),
    ]);
    expect(r.issues).toEqual(['viva@1.0.0: duplicate persona template']);
  });

  it('a build tag is the same version as the plain one', () => {
    const r = selectPersonaLibrary([template(), template({ version: '1.0.0+b' })]);
    expect(r.issues).toEqual(['viva@1.0.0+b: duplicate persona template']);
  });

  it('picks the highest signed version and ignores input order', () => {
    const r = selectPersonaLibrary([
      template({ version: '1.2.0', endAfterQuestions: 7 }),
      template({ version: '1.0.0' }),
      template({ version: '1.3.0', reviewedBy: 'pending' }),
      template({ version: '1.1.0' }),
    ]);
    expect(r.issues).toEqual([]);
    expect(r.personas).toEqual([
      {
        id: 'viva',
        name: 'Viva examiner',
        style: 'calm',
        mustNot: ['reveal a model answer'],
        endAfterQuestions: 7,
      },
    ]);
    expect(r.chosen.get('viva')).toBe('1.2.0');
  });

  it('sorts the chosen personas by id', () => {
    const r = selectPersonaLibrary([template({ id: 'b' }), template({ id: 'a' })]);
    expect(r.personas.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('comparePersonaVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.10.0', '1.9.0', 1],
    ['0.9.9', '1.0.0', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.0.1', '1.0.0', 1],
    ['1.0.0-rc.1', '1.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-rc.2', '1.0.0-rc.10', -1],
    ['1.0.0-rc', '1.0.0-rc.1', -1],
    ['1.0.0-rc.1', '1.0.0-rc', 1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0-beta', '1.0.0-alpha', 1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
    ['1.0.0-alpha', '1.0.0-1', 1],
    ['1.0.0-alpha', '1.0.0-alpha', 0],
    ['1.0.0+a', '1.0.0+b', 0],
  ] as const)('%s vs %s', (a, b, want) => {
    expect(Math.sign(comparePersonaVersions(a, b))).toBe(want);
  });
});
