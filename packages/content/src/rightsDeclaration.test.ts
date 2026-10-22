// Rights declaration (task 12.3 Phase A): one global file, no directory scan.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContentLoadError } from './loader.js';
import {
  parseRightsDeclaration,
  PLACEHOLDER_MARKER,
  readRightsDeclaration,
  type RightsDeclaration,
  RightsDeclarationFrontMatterSchema,
  rightsDeclarationSigned,
} from './rightsDeclaration.js';

const FRONT = {
  version: '2026-01-01.1',
  reviewedBy: 'Example Reviewer',
  reviewedOn: '2026-01-01',
};

function text(front: Record<string, string>, body = 'Body text.\n'): string {
  const yaml = Object.entries(front)
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n');
  return `---\n${yaml}\n---\n${body}`;
}

function declaration(over: Partial<RightsDeclaration> = {}): RightsDeclaration {
  return { ...FRONT, body: 'Body text.\n', ...over };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rights-declaration-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  dirs.length = 0;
});

describe('RightsDeclarationFrontMatterSchema', () => {
  it('accepts a full front matter', () => {
    expect(RightsDeclarationFrontMatterSchema.parse(FRONT)).toEqual(FRONT);
  });

  it('accepts "pending" as a signer (validation, not the schema, refuses it)', () => {
    expect(
      RightsDeclarationFrontMatterSchema.safeParse({ ...FRONT, reviewedBy: 'pending' }).success,
    ).toBe(true);
  });

  it.each([
    ['an extra field', { ...FRONT, extra: 'x' }],
    ['a missing version', { reviewedBy: 'R', reviewedOn: '2026-01-01' }],
    ['a blank version', { ...FRONT, version: '' }],
    ['a version over 64 characters', { ...FRONT, version: 'v'.repeat(65) }],
    ['a version with spaces', { ...FRONT, version: 'draft 0' }],
    ['an email as signer', { ...FRONT, reviewedBy: 'someone@example.com' }],
    ['a blank signer', { ...FRONT, reviewedBy: '  ' }],
    ['a signer over 200 characters', { ...FRONT, reviewedBy: 'r'.repeat(201) }],
    ['a date that is not a real day', { ...FRONT, reviewedOn: '2026-02-30' }],
  ])('refuses %s', (_why, value) => {
    expect(RightsDeclarationFrontMatterSchema.safeParse(value).success).toBe(false);
  });
});

describe('parseRightsDeclaration', () => {
  it('splits the front matter from the body', () => {
    expect(parseRightsDeclaration(text(FRONT, '# Title\n\nHello.\n'), 'global.md')).toEqual({
      ...FRONT,
      body: '# Title\n\nHello.\n',
    });
  });

  it('accepts CRLF line endings', () => {
    const crlf = text(FRONT, 'Hello.\n').replace(/\n/g, '\r\n');
    expect(parseRightsDeclaration(crlf, 'global.md').version).toBe(FRONT.version);
  });

  it('defaults the file name to global.md', () => {
    expect(parseRightsDeclaration(text(FRONT)).version).toBe(FRONT.version);
  });

  it.each([
    ['no front matter', 'Just a body.\n', /front matter/],
    ['an unclosed front matter', '---\nversion: "1"\n', /front matter/],
    ['invalid YAML', '---\nversion: [1\n---\nBody\n', /invalid YAML/],
    ['a front matter that is not a map', '---\n- a\n---\nBody\n', /invalid rights declaration/],
    ['an empty body', text(FRONT, '  \n'), /body is empty/],
  ])('refuses %s', (_why, value, message) => {
    expect(() => parseRightsDeclaration(value, 'global.md')).toThrow(ContentLoadError);
    expect(() => parseRightsDeclaration(value, 'global.md')).toThrow(message);
  });
});

describe('readRightsDeclaration', () => {
  it('reads and parses a real file', () => {
    const dir = tempDir();
    const path = join(dir, 'global.md');
    writeFileSync(path, text(FRONT, 'Hello.\n'));
    expect(readRightsDeclaration(path)).toEqual({ ...FRONT, body: 'Hello.\n' });
  });

  it('throws for a file that does not exist', () => {
    expect(() => readRightsDeclaration(join(tempDir(), 'nope.md'))).toThrow(
      /no such rights-declaration file/,
    );
  });

  it('throws for a path that is a directory, not a file', () => {
    expect(() => readRightsDeclaration(tempDir())).toThrow(/no such rights-declaration file/);
  });
});

describe('rightsDeclarationSigned', () => {
  it('is false while reviewedBy is pending', () => {
    expect(rightsDeclarationSigned(declaration({ reviewedBy: 'pending' }))).toBe(false);
  });

  it('is false while the body still carries the placeholder marker', () => {
    expect(
      rightsDeclarationSigned(declaration({ body: `${PLACEHOLDER_MARKER} not yet reviewed\n` })),
    ).toBe(false);
  });

  it('is true once signed and the placeholder is gone', () => {
    expect(rightsDeclarationSigned(declaration({ reviewedBy: 'A Real Name' }))).toBe(true);
  });
});
