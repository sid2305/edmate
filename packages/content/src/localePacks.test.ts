import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalePack } from '@edmate/contracts';
import { demoLocalePack, localePackMinimal } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE_MARKET,
  loadLocalePacks,
  LocalePackError,
  pickLocalePack,
} from './localePacks.js';
import { copyLocalesValid, edit, LOCALES_VALID } from './test-helpers.js';

const XX: LocalePack = { ...demoLocalePack, market: 'XX', languages: ['en'] };
const GLOBAL: LocalePack = localePackMinimal;
const line = demoLocalePack.helplines[0]!;
const pendingXX: LocalePack = { ...XX, helplines: [{ ...line, verifiedBy: 'pending' }] };
const packs = (...ps: LocalePack[]) => new Map(ps.map((p) => [p.market, p]));

describe('pickLocalePack', () => {
  it('returns the market pack when it is there and verified', () => {
    expect(DEFAULT_LOCALE_MARKET).toBe('global');
    expect(pickLocalePack('XX', packs(XX, GLOBAL))).toBe(XX);
    expect(pickLocalePack('global', packs(XX, GLOBAL))).toBe(GLOBAL);
  });

  it('an unknown market falls back to the default pack', () => {
    expect(pickLocalePack('ZZ', packs(XX, GLOBAL))).toBe(GLOBAL);
    expect(pickLocalePack('', packs(XX, GLOBAL))).toBe(GLOBAL);
  });

  it('refuses a market pack with an unverified helpline: the default pack serves instead', () => {
    expect(pickLocalePack('XX', packs(pendingXX, GLOBAL))).toBe(GLOBAL);
    const pendingNumber = { ...XX, helplines: [{ ...line, number: 'pending' }] };
    expect(pickLocalePack('XX', packs(pendingNumber, GLOBAL))).toBe(GLOBAL);
  });

  it('throws when there is no default pack to fall back to', () => {
    expect(() => pickLocalePack('ZZ', packs(XX))).toThrow(LocalePackError);
    expect(() => pickLocalePack('ZZ', packs(XX))).toThrow(
      'no usable locale pack for market "ZZ": the default pack (global) is missing',
    );
    // Even a verified market pack needs the default to exist (it is the safety floor).
    expect(() => pickLocalePack('XX', packs(XX))).toThrow(LocalePackError);
  });

  it('throws when the default pack itself has an unverified helpline', () => {
    const badGlobal = { ...GLOBAL, helplines: [{ ...line, verifiedBy: 'pending' }] };
    expect(() => pickLocalePack('ZZ', packs(XX, badGlobal))).toThrow(
      'the default locale pack (global) has an unverified helpline: helpline "Example Helpline": verifiedBy is "pending"',
    );
  });
});

describe('loadLocalePacks', () => {
  it('loads a clean directory: every pack served, none refused', () => {
    const { packs: loaded, refused } = loadLocalePacks(LOCALES_VALID);
    expect([...loaded.keys()]).toEqual(['XX', 'global']);
    expect(refused).toEqual([]);
  });

  it('refuses a pack with an unverified helpline, by market and reason; it is never served', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace('verifiedBy: Example Reviewer', 'verifiedBy: pending'));
    const { packs: loaded, refused } = loadLocalePacks(dir);
    expect([...loaded.keys()]).toEqual(['global']);
    expect(refused).toEqual([
      { market: 'XX', reasons: ['helpline "Example Helpline": verifiedBy is "pending"'] },
    ]);
    expect(pickLocalePack('XX', loaded).market).toBe('global');
  });

  it('serves a pack whose compliance sign-off is missing (only helplines gate a crisis reply)', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace(/^reviewed(?:By|On): .*\n/gm, ''));
    expect(loadLocalePacks(dir).refused).toEqual([]);
  });

  it('fails closed on a file that does not load', () => {
    const dir = copyLocalesValid();
    writeFileSync(join(dir, 'YY.yaml'), 'market: YY\n');
    expect(() => loadLocalePacks(dir)).toThrow(LocalePackError);
    expect(() => loadLocalePacks(dir)).toThrow(/^locale packs in .* failed to load:\nYY\.yaml: /);
  });

  it('fails closed on an unsafe or non-gu PII pattern', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace(String.raw`'ID-\d{3}(?!\d)'`, () => `'(a+)+$'`));
    expect(() => loadLocalePacks(dir)).toThrow(
      /failed to load:\nXX\.yaml: piiPatterns\[0\] nests a quantifier inside a repeated group$/,
    );
    const dir2 = copyLocalesValid();
    edit(dir2, 'XX.yaml', (s) => s.replace(String.raw`'ID-\d{3}(?!\d)'`, String.raw`'\a'`));
    expect(() => loadLocalePacks(dir2)).toThrow(/piiPatterns\[0\] does not compile with flags gu/);
  });

  it('fails closed without a default pack', () => {
    const dir = copyLocalesValid();
    rmSync(join(dir, 'global.yaml'));
    expect(() => loadLocalePacks(dir)).toThrow(/global\.yaml: missing/);
  });

  it('fails closed when the default pack has an unverified helpline', () => {
    const dir = copyLocalesValid();
    edit(dir, 'global.yaml', (s) =>
      s.replace(
        'helplines: []',
        'helplines:\n  - { name: L, number: "0", kind: k, verifiedBy: pending, verifiedOn: "2026-01-01" }',
      ),
    );
    expect(() => loadLocalePacks(dir)).toThrow(/default locale pack \(global\) has an unverified/);
  });
});
