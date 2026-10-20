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
  withVerifiedHelplines,
} from './localePacks.js';
import { copyLocalesValid, edit, LOCALES_VALID } from './test-helpers.js';

const XX: LocalePack = { ...demoLocalePack, market: 'XX', languages: ['en'] };
const GLOBAL: LocalePack = localePackMinimal;
const line = demoLocalePack.helplines[0]!;
const pendingLine = { ...line, name: 'Line P', verifiedBy: 'pending' };
const pendingXX: LocalePack = { ...XX, helplines: [pendingLine] };
const packs = (...ps: LocalePack[]) => new Map(ps.map((p) => [p.market, p]));

describe('withVerifiedHelplines', () => {
  it('returns a verified pack unchanged (same object), nothing dropped', () => {
    expect(withVerifiedHelplines(XX)).toEqual({ pack: XX, dropped: [] });
    expect(withVerifiedHelplines(XX).pack).toBe(XX);
  });

  it('removes every unverified helpline and keeps the verified ones and every other field', () => {
    const mixed = {
      ...XX,
      helplines: [line, pendingLine, { ...line, name: 'Line N', number: 'pending' }],
    };
    const { pack, dropped } = withVerifiedHelplines(mixed);
    expect(pack).toEqual({ ...mixed, helplines: [line] });
    expect(pack.piiPatterns).toBe(mixed.piiPatterns);
    expect(dropped).toEqual([
      { market: 'XX', helpline: 'Line P', reasons: ['verifier_pending'] },
      { market: 'XX', helpline: 'Line N', reasons: ['number_pending'] },
    ]);
    expect(mixed.helplines).toHaveLength(3); // the input is not changed
  });

  it('reason codes only: never the number or the verifier text', () => {
    const odd = { ...line, name: 'L', number: ' ', verifiedBy: 'PENDING' };
    const { dropped } = withVerifiedHelplines({ ...XX, helplines: [odd] });
    expect(dropped).toEqual([
      { market: 'XX', helpline: 'L', reasons: ['number_blank', 'verifier_pending'] },
    ]);
  });
});

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

  it('serves a market pack with unverified helplines without them (defence in depth)', () => {
    const picked = pickLocalePack('XX', packs(pendingXX, GLOBAL));
    expect(picked.market).toBe('XX');
    expect(picked.helplines).toEqual([]);
    expect(picked.piiPatterns).toEqual(XX.piiPatterns);
    const mixed = pickLocalePack('XX', packs({ ...XX, helplines: [line, pendingLine] }, GLOBAL));
    expect(mixed.helplines).toEqual([line]);
  });

  it('throws when there is no default pack', () => {
    expect(() => pickLocalePack('ZZ', packs(XX))).toThrow(LocalePackError);
    expect(() => pickLocalePack('ZZ', packs(XX))).toThrow(
      'no usable locale pack for market "ZZ": the default pack (global) is missing',
    );
    // Even a verified market pack needs the default to exist (it is the safety floor).
    expect(() => pickLocalePack('XX', packs(XX))).toThrow(LocalePackError);
  });

  it('strips an unverified helpline from the default pack too', () => {
    const g = { ...GLOBAL, helplines: [pendingLine] };
    expect(pickLocalePack('ZZ', packs(XX, g)).helplines).toEqual([]);
  });
});

describe('loadLocalePacks', () => {
  it('loads a clean directory: every pack served whole, nothing refused or dropped', () => {
    const r = loadLocalePacks(LOCALES_VALID);
    expect([...r.packs.keys()]).toEqual(['XX', 'global']);
    expect(r.refused).toEqual([]);
    expect(r.droppedHelplines).toEqual([]);
  });

  it('serves a pack with a pending helpline without it, and reports the drop once', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace('verifiedBy: Example Reviewer', 'verifiedBy: pending'));
    const r = loadLocalePacks(dir);
    expect(r.refused).toEqual([]);
    expect(r.packs.get('XX')).toMatchObject({ market: 'XX', helplines: [] });
    expect(r.packs.get('XX')?.piiPatterns).toEqual([String.raw`ID-\d{3}(?!\d)`]);
    expect(r.droppedHelplines).toEqual([
      { market: 'XX', helpline: 'Example Helpline', reasons: ['verifier_pending'] },
    ]);
  });

  it('one verified and one pending helpline: only the verified one is served', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) =>
      s.replace(
        'compliance:',
        [
          '  - name: Line P',
          '    number: pending',
          '    kind: crisis',
          '    verifiedBy: pending',
          '    verifiedOn: "2026-01-01"',
          'compliance:',
        ].join('\n'),
      ),
    );
    const r = loadLocalePacks(dir);
    expect(r.packs.get('XX')?.helplines.map((h) => h.name)).toEqual(['Example Helpline']);
    expect(r.droppedHelplines).toEqual([
      { market: 'XX', helpline: 'Line P', reasons: ['number_pending', 'verifier_pending'] },
    ]);
  });

  it('pending compliance fields do not block runtime use', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) =>
      s
        .replace('reviewedBy: Example Reviewer', 'reviewedBy: pending')
        .replace('grievance: Example grievance desk', 'grievance: pending'),
    );
    const r = loadLocalePacks(dir);
    expect(r.refused).toEqual([]);
    expect(r.packs.get('XX')?.compliance.grievance).toBe('pending');
  });

  it('refuses the whole pack on an unsafe pattern: its market gets the default pack', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace(String.raw`'ID-\d{3}(?!\d)'`, () => `'(a+)+$'`));
    const r = loadLocalePacks(dir);
    expect([...r.packs.keys()]).toEqual(['global']);
    expect(r.refused).toEqual([
      { file: 'XX.yaml', reasons: ['piiPatterns[0] nests a quantifier inside a repeated group'] },
    ]);
    expect(pickLocalePack('XX', r.packs).market).toBe('global');
  });

  it('refuses the whole pack on a pattern that does not compile with gu', () => {
    const dir = copyLocalesValid();
    edit(dir, 'XX.yaml', (s) => s.replace(String.raw`'ID-\d{3}(?!\d)'`, () => String.raw`'\a'`));
    expect(loadLocalePacks(dir).refused).toEqual([
      { file: 'XX.yaml', reasons: ['piiPatterns[0] does not compile with flags gu'] },
    ]);
  });

  it('refuses a file that fails the schema, and reports an unexpected entry', () => {
    const dir = copyLocalesValid();
    writeFileSync(join(dir, 'YY.yaml'), 'market: YY\n');
    writeFileSync(join(dir, 'notes.txt'), 'hello\n');
    const r = loadLocalePacks(dir);
    expect([...r.packs.keys()]).toEqual(['XX', 'global']);
    expect(r.refused.map((x) => x.file)).toEqual(['YY.yaml', 'notes.txt']);
    expect(r.refused[0]?.reasons[0]).toMatch(/^invalid locale pack/);
  });

  it('fails closed without a usable default pack', () => {
    const dir = copyLocalesValid();
    rmSync(join(dir, 'global.yaml'));
    expect(() => loadLocalePacks(dir)).toThrow(LocalePackError);
    expect(() => loadLocalePacks(dir)).toThrow(/global\.yaml: missing/);
    const bad = copyLocalesValid();
    edit(bad, 'global.yaml', (s) => s.replace('piiPatterns: []', "piiPatterns: ['(a|a)+']"));
    expect(() => loadLocalePacks(bad)).toThrow(
      /default locale pack \(global\.yaml\) is unusable: piiPatterns\[0\] repeats/,
    );
  });

  it('a default pack with a pending helpline loads without it', () => {
    const dir = copyLocalesValid();
    edit(dir, 'global.yaml', (s) =>
      s.replace(
        'helplines: []',
        'helplines:\n  - { name: L, number: "0", kind: k, verifiedBy: pending, verifiedOn: "2026-01-01" }',
      ),
    );
    const r = loadLocalePacks(dir);
    expect(r.packs.get('global')?.helplines).toEqual([]);
    expect(r.droppedHelplines).toEqual([
      { market: 'global', helpline: 'L', reasons: ['verifier_pending'] },
    ]);
  });
});
