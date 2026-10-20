// Locale-pack rules (task 3.10), run by `edmate content validate <locale-packs dir>`. Each rule
// takes every loaded pack and returns plain-words issues, named by file; all of them run, never
// fail-fast. A pack is committed with the literal `pending` wherever a person has not yet checked
// a fact (a helpline, the grievance contact, the compliance sign-off): that is a valid schema
// value, and these rules are what keep such a pack from passing validation.
import type { LocalePack } from '@edmate/contracts';
import { compileLocalePatterns } from '@edmate/harness';
import { PILOT_LANGUAGES } from './pilotLanguages.js';
import { checkSafeRegex } from './safeRegex.js';

export type LocalePacks = ReadonlyMap<string, LocalePack>;
export type LocaleRule = (packs: LocalePacks) => string[];

/** The fallback pack's market: it serves every market without a usable pack of its own. */
export const DEFAULT_LOCALE_MARKET = 'global';

const isPending = (s: string): boolean => s.trim().toLowerCase() === 'pending';
const fileOf = (p: LocalePack): string => `${p.market}.yaml`;
const each = (packs: LocalePacks, check: (p: LocalePack) => string[]): string[] =>
  [...packs.values()].flatMap((p) => check(p).map((issue) => `${fileOf(p)}: ${issue}`));

/**
 * Why each helpline of `pack` is not ready to show a student: a `pending` or blank number, or a
 * `pending` verifier. Empty when every helpline is signed off, or when there are none (an honest
 * empty state: the reply then tells the student to contact local emergency services).
 */
export function unverifiedHelplines(pack: LocalePack): string[] {
  return pack.helplines.flatMap((h) => {
    const why: string[] = [];
    if (h.number.trim() === '') why.push('number is blank');
    else if (isPending(h.number)) why.push('number is "pending"');
    if (isPending(h.verifiedBy)) why.push('verifiedBy is "pending"');
    return why.map((w) => `helpline "${h.name}": ${w}`);
  });
}

export const defaultPackPresent: LocaleRule = (packs) =>
  packs.has(DEFAULT_LOCALE_MARKET)
    ? []
    : [
        `${DEFAULT_LOCALE_MARKET}.yaml: missing; the default pack is required (it serves every market without a pack)`,
      ];

export const helplinesVerified: LocaleRule = (packs) => each(packs, unverifiedHelplines);

const COMPLIANCE_TEXT = ['privacyLaw', 'dataRegion', 'grievance'] as const;

/**
 * No compliance text is left `pending`; a market pack (not the default) has a reviewedBy /
 * reviewedOn sign-off that is not `pending` (ADR-0008).
 */
export const complianceReviewed: LocaleRule = (packs) =>
  each(packs, (p) => {
    const issues = COMPLIANCE_TEXT.filter((k) => isPending(p.compliance[k])).map(
      (k) => `compliance.${k} is "pending"`,
    );
    if (p.market === DEFAULT_LOCALE_MARKET) return issues;
    if (p.reviewedBy === undefined) {
      issues.push('compliance has no reviewedBy / reviewedOn sign-off');
    } else if (isPending(p.reviewedBy)) {
      issues.push('reviewedBy is "pending"');
    }
    return issues;
  });

/** English only during the pilot (18 Oct 2026 decision; crisis replies too, B-14). */
export const localeLanguages: LocaleRule = (packs) =>
  each(packs, (p) => {
    const ok =
      p.languages.length === PILOT_LANGUAGES.length &&
      p.languages.every((l, i) => l === PILOT_LANGUAGES[i]);
    return ok
      ? []
      : [
          `languages must be exactly [${PILOT_LANGUAGES.join(', ')}] during the pilot; got [${p.languages.join(', ')}]`,
        ];
  });

function compilesWithGu(source: string): boolean {
  try {
    compileLocalePatterns([source]);
    return true;
  } catch {
    return false;
  }
}

/** The patterns of `pack` that do not compile with exactly 'gu' (the guard's own compiler), by position. */
function guIssues(p: LocalePack): string[] {
  return p.piiPatterns.flatMap((source, i) =>
    compilesWithGu(source) ? [] : [`piiPatterns[${i}] does not compile with flags gu`],
  );
}

/** The patterns of `pack` that fail the safe-regex check (structure first, then a timing probe). */
function safeRegexIssues(p: LocalePack): string[] {
  return p.piiPatterns.flatMap((source, i) =>
    checkSafeRegex(source).map((issue) => `piiPatterns[${i}] ${issue}`),
  );
}

/** Every PII-pattern problem of one pack (gu compile, then safe-regex); empty when it may be used. */
export function piiPatternIssues(pack: LocalePack): string[] {
  return [...guIssues(pack), ...safeRegexIssues(pack)];
}

/** Every PII pattern compiles with exactly the flags the guard uses ('gu'), through the guard's own compiler. */
export const piiPatternsCompileWithGu: LocaleRule = (packs) => each(packs, guIssues);

/** Every PII pattern passes the safe-regex check (structure first, then a timing probe). */
export const piiPatternsSafeRegex: LocaleRule = (packs) => each(packs, safeRegexIssues);

export const LOCALE_RULES: readonly LocaleRule[] = [
  defaultPackPresent,
  helplinesVerified,
  complianceReviewed,
  localeLanguages,
  piiPatternsCompileWithGu,
  piiPatternsSafeRegex,
];

export function checkLocalePacks(packs: LocalePacks): string[] {
  return LOCALE_RULES.flatMap((rule) => rule(packs));
}
