import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixturePromptPackLibrary } from '@edmate/harness/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { readPromptPackLibrary, validatePromptPackDir } from './promptPacks.js';

const here = dirname(fileURLToPath(import.meta.url));
const VALID = resolve(here, '../test/fixtures/prompt-packs/valid');
const SET = 'set@0.1.0-fixture.yaml';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A copy of the valid fixture directory with one change applied. */
function broken(edit: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-packs-'));
  temps.push(dir);
  cpSync(VALID, dir, { recursive: true });
  edit(dir);
  return dir;
}

function editFile(dir: string, file: string, fn: (text: string) => string): void {
  const p = join(dir, file);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

describe('readPromptPackLibrary', () => {
  it('loads the fixture directory into exactly the harness fixture library', () => {
    const lib = readPromptPackLibrary(VALID);
    expect(lib).toEqual(fixturePromptPackLibrary);
    expect([...lib.keys()]).toEqual(['0.1.0-fixture']);
  });

  it('throws with every issue when the directory has any', () => {
    const dir = broken((d) => {
      writeFileSync(join(d, 'notes.txt'), 'x');
    });
    expect(() => readPromptPackLibrary(dir)).toThrow(
      /notes\.txt: not part of the prompt-pack layout/,
    );
  });

  it('keeps an older pack file no manifest refers to, and allows a README', () => {
    const dir = broken((d) => {
      cpSync(join(d, 'coach@0.1.0.md'), join(d, 'coach@0.0.9.md'));
      editFile(d, 'coach@0.0.9.md', (t) => t.replace('version: 0.1.0', 'version: 0.0.9'));
      writeFileSync(join(d, 'README.md'), '# Prompt packs\n');
      writeFileSync(join(d, '.DS_Store'), '');
    });
    expect(validatePromptPackDir(dir)).toEqual({ ok: true, issues: [] });
  });

  it('loads two sets side by side', () => {
    const dir = broken((d) => {
      cpSync(join(d, SET), join(d, 'set@0.2.0.yaml'));
      editFile(d, 'set@0.2.0.yaml', (t) => t.replace('version: 0.1.0-fixture', 'version: 0.2.0'));
    });
    expect([...readPromptPackLibrary(dir).keys()]).toEqual(['0.1.0-fixture', '0.2.0']);
  });
});

describe('validatePromptPackDir: each broken fixture gives one named issue', () => {
  const cases: [string, (dir: string) => void, RegExp][] = [
    [
      'missing pack for a mode',
      (d) => {
        editFile(d, SET, (t) => t.replace('  distress: 0.1.0\n', ''));
      },
      /^set@0\.1\.0-fixture\.yaml: packs\.distress: missing required pack$/,
    ],
    [
      'missing pack for a skill',
      (d) => {
        editFile(d, SET, (t) => t.replace('  practice: 0.1.0\n', ''));
      },
      /^set@0\.1\.0-fixture\.yaml: packs\.practice: missing required pack$/,
    ],
    [
      'file name and front-matter version disagree',
      (d) => {
        editFile(d, 'coach@0.1.0.md', (t) => t.replace('version: 0.1.0', 'version: 0.1.1'));
      },
      /^coach@0\.1\.0\.md: the file name says coach@0\.1\.0 but the front matter says coach@0\.1\.1$/,
    ],
    [
      'file name and front-matter name disagree',
      (d) => {
        editFile(d, 'coach@0.1.0.md', (t) => t.replace('name: coach', 'name: coach2'));
      },
      /^coach@0\.1\.0\.md: the file name says coach@0\.1\.0 but the front matter says coach2@0\.1\.0$/,
    ],
    [
      'unknown placeholder',
      (d) => {
        editFile(d, 'coach@0.1.0.md', (t) => `${t.trimEnd()} {{answer}}\n`);
      },
      /^coach@0\.1\.0\.md: body: unknown placeholder \{\{answer\}\}$/,
    ],
    [
      'missing required placeholder',
      (d) => {
        editFile(d, 'frame@0.1.0.md', (t) => t.replace('{{helplines}}', ''));
      },
      /^frame@0\.1\.0\.md: locale: missing required placeholder \{\{helplines\}\}$/,
    ],
    [
      'bad semver in a pack file name',
      (d) => {
        cpSync(join(d, 'coach@0.1.0.md'), join(d, 'coach@1.0.md'));
      },
      /^coach@1\.0\.md: bad semver "1\.0"$/,
    ],
    [
      'bad semver in a set file name',
      (d) => {
        renameSync(join(d, SET), join(d, 'set@latest.yaml'));
        cpSync(join(d, 'set@latest.yaml'), join(d, SET));
      },
      /^set@latest\.yaml: bad semver "latest"$/,
    ],
    [
      'duplicate set version',
      (d) => {
        cpSync(join(d, SET), join(d, 'set@0.1.0-fixture+b2.yaml'));
        editFile(d, 'set@0.1.0-fixture+b2.yaml', (t) =>
          t.replace('version: 0.1.0-fixture', 'version: 0.1.0-fixture+b2'),
        );
      },
      // Files are read in sorted order, so `+b2` comes first and the plain one is the duplicate.
      /^duplicate prompt-pack set version 0\.1\.0-fixture$/,
    ],
    [
      'set file name and manifest version disagree',
      (d) => {
        editFile(d, SET, (t) => t.replace('version: 0.1.0-fixture', 'version: 0.1.1'));
      },
      /^set@0\.1\.0-fixture\.yaml: the file name says 0\.1\.0-fixture but the manifest says 0\.1\.1$/,
    ],
    [
      'a manifest pointing at a missing file',
      (d) => {
        editFile(d, SET, (t) => t.replace('  coach: 0.1.0', '  coach: 0.2.0'));
      },
      /^set@0\.1\.0-fixture\.yaml: pack coach@0\.2\.0 not found \(no coach@0\.2\.0\.md\)$/,
    ],
    [
      'a file outside the layout',
      (d) => {
        writeFileSync(join(d, 'coach.md'), 'x');
      },
      /^coach\.md: not part of the prompt-pack layout/,
    ],
    [
      'a file in a subdirectory',
      (d) => {
        mkdirSync(join(d, 'old'));
        cpSync(join(d, 'coach@0.1.0.md'), join(d, 'old/coach@0.1.0.md'));
      },
      /^old\/coach@0\.1\.0\.md: not part of the prompt-pack layout/,
    ],
    [
      'no front matter',
      (d) => {
        writeFileSync(join(d, 'coach@0.3.0.md'), 'no front matter here\n');
      },
      /^coach@0\.3\.0\.md: no front matter \(the file must start with a --- block\)$/,
    ],
    [
      'unclosed front matter',
      (d) => {
        writeFileSync(join(d, 'coach@0.3.0.md'), '---\nname: coach\n');
      },
      /^coach@0\.3\.0\.md: no front matter \(the file must start with a --- block\)$/,
    ],
    [
      'front matter that is not a mapping',
      (d) => {
        writeFileSync(join(d, 'coach@0.3.0.md'), '---\n- a\n---\nbody\n');
      },
      /^coach@0\.3\.0\.md: invalid front matter: /,
    ],
    [
      'invalid YAML in the manifest',
      (d) => {
        writeFileSync(join(d, SET), 'version: [unclosed\n');
      },
      /^set@0\.1\.0-fixture\.yaml: invalid YAML: /,
    ],
    [
      'a manifest with a wrong shape',
      (d) => {
        editFile(d, SET, (t) => t.replace('reviewed_by: fixture\n', ''));
      },
      /^set@0\.1\.0-fixture\.yaml: invalid manifest: /,
    ],
    [
      'a pack with the wrong kind',
      (d) => {
        editFile(d, 'locked@0.1.0.md', (t) => t.replace('kind: mode', 'kind: skill'));
      },
      /^locked@0\.1\.0\.md: kind: must be "mode", got "skill"$/,
    ],
  ];

  it.each(cases)('%s', (_name, edit, issue) => {
    const r = validatePromptPackDir(broken(edit));
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatch(issue);
  });

  it('an empty directory has no set manifest', () => {
    const dir = broken((d) => {
      rmSync(d, { recursive: true });
      mkdirSync(d);
    });
    expect(validatePromptPackDir(dir)).toEqual({
      ok: false,
      issues: ['no set@<semver>.yaml manifest'],
    });
  });

  it('a missing directory', () => {
    const r = validatePromptPackDir(join(tmpdir(), 'edmate-no-such-dir-3-6'));
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/no such prompt-pack directory$/);
  });

  it('collects issues from several files, sorted', () => {
    const r = validatePromptPackDir(
      broken((d) => {
        writeFileSync(join(d, 'z.txt'), 'x');
        writeFileSync(join(d, 'a.txt'), 'x');
      }),
    );
    expect(r.issues.map((i) => i.split(':')[0])).toEqual(['a.txt', 'z.txt']);
  });
});
