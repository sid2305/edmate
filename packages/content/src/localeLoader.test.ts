import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalePackSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { ContentLoadError } from './loader.js';
import { isLocalePacksDir, readLocalePack, readLocalePacksDir } from './localeLoader.js';
import { copyLocalesValid, edit, LOCALES_VALID, tempDir, VALID } from './test-helpers.js';

describe('readLocalePack', () => {
  it('reads one file into a validated LocalePack', () => {
    const pack = readLocalePack(join(LOCALES_VALID, 'XX.yaml'));
    expect(LocalePackSchema.parse(pack)).toEqual(pack);
    expect(pack).toMatchObject({
      market: 'XX',
      helplines: [{ name: 'Example Helpline', verifiedBy: 'Example Reviewer' }],
      compliance: { parentalConsentRequired: true },
      reviewedBy: 'Example Reviewer',
      reviewedOn: '2026-01-01',
    });
  });

  it('throws a ContentLoadError naming the file on bad YAML', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'XX.yaml'), 'market: [oops\n');
    expect(() => readLocalePack(join(dir, 'XX.yaml'))).toThrow(ContentLoadError);
    expect(() => readLocalePack(join(dir, 'XX.yaml'))).toThrow(/^XX\.yaml: invalid YAML/);
  });

  it('throws naming the missing field on a schema mismatch', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace(/^ {2}grievance: .*\n/m, ''));
    expect(() => readLocalePack(join(dir, 'XX.yaml'))).toThrow(
      /^XX\.yaml: invalid locale pack[\s\S]*compliance\.grievance/,
    );
  });

  it('throws when the market does not match the file name', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace('market: XX', 'market: ZZ'));
    expect(() => readLocalePack(join(dir, 'XX.yaml'))).toThrow(
      'XX.yaml: market "ZZ" does not match the file name (expected "XX")',
    );
  });

  it('throws on a file that cannot be read', () => {
    expect(() => readLocalePack(join(tempDir(), 'XX.yaml'))).toThrow(/^XX\.yaml: cannot read/);
  });
});

describe('readLocalePacksDir', () => {
  it('reads every pack, keyed by market', () => {
    const { packs, errors } = readLocalePacksDir(LOCALES_VALID);
    expect(errors).toEqual([]);
    expect([...packs.keys()]).toEqual(['XX', 'global']);
  });

  it('collects every bad file instead of stopping at the first, keeping the good ones', () => {
    const dir = copyLocalesValid();
    writeFileSync(join(dir, 'YY.yaml'), 'market: [oops\n');
    writeFileSync(join(dir, 'ZZ.yaml'), 'market: ZZ\n');
    writeFileSync(join(dir, 'notes.txt'), 'hello\n');
    writeFileSync(join(dir, 'in.yaml'), 'market: IN\n');
    mkdirSync(join(dir, 'drafts'));
    writeFileSync(join(dir, '.hidden.yaml'), 'ignored\n');
    const { packs, errors } = readLocalePacksDir(dir);
    expect([...packs.keys()]).toEqual(['XX', 'global']);
    expect(errors.map((e) => e.filePath)).toEqual([
      'YY.yaml',
      'ZZ.yaml',
      'drafts',
      'in.yaml',
      'notes.txt',
    ]);
    expect(errors.every((e) => e instanceof ContentLoadError)).toBe(true);
    expect(errors[2]?.message).toBe(
      'drafts: unexpected entry (a locale pack is a file named <market>.yaml, e.g. IN.yaml or global.yaml)',
    );
  });

  it('throws on a directory that does not exist', () => {
    const missing = join(tempDir(), 'nope');
    expect(() => readLocalePacksDir(missing)).toThrow(`${missing}: no such locale-packs directory`);
  });
});

describe('isLocalePacksDir', () => {
  it('is true when a top-level file is named like a pack and there is no course.yaml', () => {
    expect(isLocalePacksDir(LOCALES_VALID)).toBe(true);
    const dir = tempDir();
    writeFileSync(join(dir, 'global.yaml'), '');
    writeFileSync(join(dir, 'notes.txt'), '');
    expect(isLocalePacksDir(dir)).toBe(true);
  });

  it('is false for a teacher content tree, an empty directory or other files only', () => {
    expect(isLocalePacksDir(VALID)).toBe(false);
    expect(isLocalePacksDir(tempDir())).toBe(false);
    // Separate directories: macOS file systems are case-insensitive, so in.yaml is IN.yaml there.
    const lower = tempDir();
    writeFileSync(join(lower, 'in.yaml'), '');
    expect(isLocalePacksDir(lower)).toBe(false);
    const both = tempDir();
    writeFileSync(join(both, 'IN.yaml'), '');
    writeFileSync(join(both, 'course.yaml'), '');
    expect(isLocalePacksDir(both)).toBe(false);
    rmSync(join(both, 'course.yaml'));
    expect(isLocalePacksDir(both)).toBe(true);
  });
});
