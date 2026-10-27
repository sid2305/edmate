import type { LocalePack } from '@edmate/contracts';
import { demoLocalePack, localePackMinimal } from '@edmate/contracts/fixtures';
import { IN_PII_PATTERNS } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import {
  checkLocalePacks,
  complianceReviewed,
  defaultPackPresent,
  helplinesVerified,
  LOCALE_RULES,
  localeLanguages,
  minAgeInRange,
  piiPatternsCompileWithGu,
  piiPatternsSafeRegex,
  unverifiedHelplines,
} from './localeRules.js';

const XX: LocalePack = { ...demoLocalePack, market: 'XX', languages: ['en'] };
const packs = (...ps: LocalePack[]) => new Map(ps.map((p) => [p.market, p]));
const base = (): LocalePack => ({ ...localePackMinimal });
const line = demoLocalePack.helplines[0]!;

describe('unverifiedHelplines', () => {
  it('none for a pack whose helplines are all signed off, or that has none', () => {
    expect(unverifiedHelplines(XX)).toEqual([]);
    expect(unverifiedHelplines(base())).toEqual([]);
  });

  it.each([
    ['verifiedBy pending', { verifiedBy: 'pending' }, 'verifiedBy is "pending"'],
    ['verifiedBy Pending, padded', { verifiedBy: ' Pending ' }, 'verifiedBy is "pending"'],
    ['number pending', { number: 'pending' }, 'number is "pending"'],
    ['number blank', { number: '  ' }, 'number is blank'],
  ])('%s → named by helpline', (_label, change, why) => {
    const pack = { ...XX, helplines: [line, { ...line, name: 'Line B', ...change }] };
    expect(unverifiedHelplines(pack)).toEqual([`helpline "Line B": ${why}`]);
  });

  it('reports both problems of one helpline', () => {
    const pack = { ...XX, helplines: [{ ...line, number: 'pending', verifiedBy: 'pending' }] };
    expect(unverifiedHelplines(pack)).toEqual([
      'helpline "Example Helpline": number is "pending"',
      'helpline "Example Helpline": verifiedBy is "pending"',
    ]);
  });
});

describe('helplinesVerified', () => {
  it('passes verified packs and a pack with no helplines (an honest empty state)', () => {
    expect(helplinesVerified(packs(XX, base()))).toEqual([]);
  });

  it('names the market file and the helpline', () => {
    const pending = { ...XX, helplines: [{ ...line, verifiedBy: 'pending' }] };
    expect(helplinesVerified(packs(pending))).toEqual([
      'XX.yaml: helpline "Example Helpline": verifiedBy is "pending"',
    ]);
  });
});

describe('complianceReviewed', () => {
  it('passes a signed-off market pack and the unsigned default pack', () => {
    expect(complianceReviewed(packs(XX, base()))).toEqual([]);
  });

  it('a market pack needs a reviewedBy that is not pending', () => {
    const unsigned: LocalePack = { ...XX };
    delete unsigned.reviewedBy;
    delete unsigned.reviewedOn;
    expect(complianceReviewed(packs(unsigned))).toEqual([
      'XX.yaml: compliance has no reviewedBy / reviewedOn sign-off',
    ]);
    expect(complianceReviewed(packs({ ...XX, reviewedBy: 'pending' }))).toEqual([
      'XX.yaml: reviewedBy is "pending"',
    ]);
  });

  it('any compliance text left "pending" is an issue, in any pack', () => {
    const c = { ...XX.compliance, grievance: 'pending', privacyLaw: 'PENDING' };
    expect(complianceReviewed(packs({ ...XX, compliance: c }))).toEqual([
      'XX.yaml: compliance.privacyLaw is "pending"',
      'XX.yaml: compliance.grievance is "pending"',
    ]);
    const g = { ...base(), compliance: { ...base().compliance, dataRegion: 'pending' } };
    expect(complianceReviewed(packs(g))).toEqual([
      'global.yaml: compliance.dataRegion is "pending"',
    ]);
  });
});

describe('minAgeInRange', () => {
  it.each([13, 18])('passes a minAge of %d', (minAge) => {
    const pack = { ...XX, compliance: { ...XX.compliance, minAge } };
    expect(minAgeInRange(packs(pack))).toEqual([]);
  });

  it.each([12, 19])('flags a minAge of %d', (minAge) => {
    const pack = { ...XX, compliance: { ...XX.compliance, minAge } };
    expect(minAgeInRange(packs(pack))).toEqual([
      `XX.yaml: compliance.minAge ${minAge} must be between 13 and 18`,
    ]);
  });

  it('flags a non-integer and NaN', () => {
    const nonInteger = { ...XX, compliance: { ...XX.compliance, minAge: 13.5 } };
    expect(minAgeInRange(packs(nonInteger))).toEqual([
      'XX.yaml: compliance.minAge 13.5 must be between 13 and 18',
    ]);
    const notANumber = { ...XX, compliance: { ...XX.compliance, minAge: NaN } };
    expect(minAgeInRange(packs(notANumber))).toEqual([
      'XX.yaml: compliance.minAge NaN must be between 13 and 18',
    ]);
  });

  it('checkLocalePacks picks it up', () => {
    const bad = { ...XX, compliance: { ...XX.compliance, minAge: 19 } };
    expect(checkLocalePacks(packs(bad, base()))).toEqual([
      'XX.yaml: compliance.minAge 19 must be between 13 and 18',
    ]);
  });
});

describe('piiPatternsCompileWithGu', () => {
  it('passes patterns that compile with exactly gu', () => {
    expect(piiPatternsCompileWithGu(packs(XX))).toEqual([]);
  });

  it('flags a pattern that compiles bare but not with u, by position', () => {
    // `\a` is an identity escape without u and a SyntaxError with u.
    const bad = { ...XX, piiPatterns: ['ok', String.raw`\a`] };
    expect(piiPatternsCompileWithGu(packs(bad))).toEqual([
      'XX.yaml: piiPatterns[1] does not compile with flags gu',
    ]);
  });
});

describe('piiPatternsSafeRegex', () => {
  it.each(['(a+)+$', '(a|a)+', '(a|aa)+c'])('flags the catastrophic pattern %s', (source) => {
    const issues = piiPatternsSafeRegex(packs({ ...XX, piiPatterns: ['ok', source] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^XX\.yaml: piiPatterns\[1\] (?:nests|repeats)/);
  });

  it('flags a backreference and a wide lookbehind', () => {
    expect(piiPatternsSafeRegex(packs({ ...XX, piiPatterns: ['(a)\\1', '(?<=ab)c'] }))).toEqual([
      'XX.yaml: piiPatterns[0] uses a backreference',
      'XX.yaml: piiPatterns[1] has a lookbehind longer than one character',
    ]);
  });

  it('leaves a pattern that does not compile with gu to the gu rule', () => {
    expect(piiPatternsSafeRegex(packs({ ...XX, piiPatterns: [String.raw`\a`] }))).toEqual([]);
  });

  it('passes the real India patterns', () => {
    const india = { ...XX, piiPatterns: Object.values(IN_PII_PATTERNS) };
    expect(piiPatternsSafeRegex(packs(india))).toEqual([]);
    expect(piiPatternsCompileWithGu(packs(india))).toEqual([]);
  });
});

describe('defaultPackPresent', () => {
  it('passes when global is there', () => {
    expect(defaultPackPresent(packs(XX, base()))).toEqual([]);
  });

  it('fails without it', () => {
    expect(defaultPackPresent(packs(XX))).toEqual([
      'global.yaml: missing; the default pack is required (it serves every market without a pack)',
    ]);
  });
});

describe('localeLanguages', () => {
  it('pins every pack to the pilot languages (English only)', () => {
    expect(localeLanguages(packs(XX, base()))).toEqual([]);
    expect(localeLanguages(packs({ ...XX, languages: ['en', 'hi'] }))).toEqual([
      'XX.yaml: languages must be exactly [en] during the pilot; got [en, hi]',
    ]);
  });
});

describe('checkLocalePacks', () => {
  it('runs every rule and collects every issue', () => {
    expect(LOCALE_RULES).toHaveLength(7);
    const bad = { ...XX, helplines: [{ ...line, verifiedBy: 'pending' }], piiPatterns: ['(a+)+'] };
    expect(checkLocalePacks(packs(bad))).toEqual([
      'global.yaml: missing; the default pack is required (it serves every market without a pack)',
      'XX.yaml: helpline "Example Helpline": verifiedBy is "pending"',
      'XX.yaml: piiPatterns[0] nests a quantifier inside a repeated group',
    ]);
  });
});
