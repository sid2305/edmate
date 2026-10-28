// The personaBoundary post guard (task 4.9): two parts, confirmed by the 4.9 plan's refresh item 8
// and lead answer 8.
//
// (a) Unconditional (every turn, `ctx.persona` or not): the outcome-claim rule ("you are hired/
// rejected", "you would pass/fail", a grade or mark before the debrief) and the real-recruiter/
// real-examiner-identity rule. One code-side rule set, not compiled from either persona template's
// `must_not` prose.
//
// (b) Persona-scoped, a no-op `ok` when `ctx.persona` is undefined: the loaded `ctx.persona.mustNot`
// array's literally pattern-matchable subset — requests for real personal data, caught two ways:
// the reply asking the student to share a real identifier (keyword-shaped request), and the reply
// holding an actual PII value (`piiPatterns.ts`'s existing `findPii`, reused as is, no new regex
// family of its own).
//
// On any hit from either part, the fixed rewrite names `ctx.persona.name` (lead answer 9's rule:
// letters-and-spaces, at most 40 characters, else "practice interviewer"); it never inserts a
// `must_not` item or a reason.
//
// `tone` (4.9's sibling guard) runs after this one in GUARD_ORDER.post, so this guard's own fixed
// reply never needs to pre-empt tone's families itself — only avoid tripping this guard's own rules,
// mirroring 4.7/4.8's idempotence posture.
import type { Persona } from '@edmate/contracts';
import { ANSWER_LEAK_SAFE_HINT, type PostGuardCtx } from './answerLeak.js';
import { adviceFallbackText, adviceRedirectReplyText, disclaimerFor } from './adviceGuard.js';
import { PREMISE_CORRECTION_REPLY, askTeacherReplyText } from './grounding.js';
import type { Guard, GuardRun } from './guard.js';
import { foldConfusables } from './lockedMatch.js';
import { findPii } from './piiPatterns.js';
import { foldText } from './textFold.js';

/** The reason codes personaBoundary writes (fixed; never the matched text or a `must_not` item). */
export const PERSONA_BOUNDARY_REASONS = Object.freeze({
  outcomeClaim: 'outcome_claim',
  realIdentity: 'real_identity',
  personalData: 'personal_data',
} as const);

/** Letters and spaces only, at most 40 characters (lead answer 9). */
const PLAIN_NAME_RX = /^[A-Za-z ]{1,40}$/;
/** Used whenever the persona's own name fails the shape rule, or there is no persona at all. */
export const DEFAULT_PERSONA_DISPLAY_NAME = 'practice interviewer';

/** The name to use in the fixed rewrite (lead answer 9): never a `must_not` item or a reason. */
export function personaDisplayName(persona: Persona | undefined): string {
  const name = persona?.name;
  return name !== undefined && PLAIN_NAME_RX.test(name) ? name : DEFAULT_PERSONA_DISPLAY_NAME;
}

/**
 * The fixed, deterministic, whole-reply rewrite (design note, 4.9 plan): names no outcome word
 * ("hired", "rejected", "pass", "fail") and no identity-claim shape of its own, so it is idempotent
 * against this guard's own rules and against `tone`'s (confirmed by the idempotence test matrix).
 */
export function personaBoundaryFixedReply(name: string): string {
  return (
    `I'm not a real recruiter, examiner or your teacher — just a ${name} for practice, so I ` +
    "can't give you a hiring decision or an exam result, and I won't ask for real personal " +
    "details. Let's continue the practice."
  );
}

const OK: GuardRun = { result: { ok: true }, usage: [] };

// ---- normalising (mirrors tone.ts's fold, kept local: each guard owns its own detection) ------

// '/' is kept (unlike tone.ts's fold): the grade/mark rule's "8/10" shape needs it; it is not a
// letter so it never interferes with any `(?<![\p{L}])`/`(?![\p{L}])` word-boundary check below.
const PUNCTUATION_RX = /[^\p{L}\p{M}\p{N}\s'/-]/gu;

function fold(text: string): string {
  return foldConfusables(foldText(text).s)
    .toLowerCase()
    .replace(PUNCTUATION_RX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// `rx` (no 'g') is for a single `.test()`: a global flag would carry `lastIndex` state between
// calls on the same module-level const, a real bug tone.ts's own comments name and avoid the same
// way. `rxg` is only for a pattern read with `matchAll` (via `hasClaim`), never `.test()` alone.
const rx = (source: string) => new RegExp(source, 'u');
const rxg = (source: string) => new RegExp(source, 'gu');

/** True for a match of a global pattern in `s` whose own matched text does not hold "not" (an
 * honest denial, mirrors tone.ts's `hasClaim`: the optional "not" sits inside each pattern itself,
 * so a denial is always part of the match, never text the regex had to look back over). */
function hasClaim(pattern: RegExp, s: string): boolean {
  for (const m of s.matchAll(pattern)) {
    if (!/\bnot\b/.test(m[0])) return true;
  }
  return false;
}

// ---- (a) unconditional: outcome-claim and real-recruiter/examiner-identity rules --------------

/** "you are/you're/you've (not) hired/rejected", "you got (not) the job" (lead answer 8). */
const HIRED_REJECTED_RX = rxg(
  String.raw`(?<![\p{L}])you(?:'re| are|'ve| have)(?: not)?\s+(?:been\s+)?(?:hired|rejected)(?![\p{L}])`,
);
const GOT_THE_JOB_RX = rxg(String.raw`(?<![\p{L}])you(?: did)?(?: not)?\s+got the job(?![\p{L}])`);

/** "you (would/'d/will) (not) pass/fail", "you (have) (not) passed/failed" (lead answer 8). */
const PASS_FAIL_RX = rxg(
  String.raw`(?<![\p{L}])you(?:'d| would| will)(?: not)?\s+(?:pass|fail)(?![\p{L}])`,
);
const PASSED_FAILED_RX = rxg(
  String.raw`(?<![\p{L}])you(?: have)?(?: not)?\s+(?:passed|failed)(?![\p{L}])`,
);

/** A grade or mark given before the debrief (lead answer 8): "your grade/mark is X", "you
 * get/got/scored an A", "you scored 8/10" or "8 out of 10". Bounded, no nested quantifiers. */
const GRADE_MARK_RX = rx(
  [
    String.raw`(?<![\p{L}])your\s+(?:grade|mark)\s+is\b`,
    String.raw`(?<![\p{L}])you\s+(?:get|got|scored|earned)\s+(?:an?\s+)?[a-f][+-]?(?![\p{L}])`,
    String.raw`(?<![\p{L}])\d{1,3}\s*(?:/|out of)\s*\d{1,3}(?![\p{L}])`,
  ].join('|'),
);

/** True when (folded) `s` holds an outcome-claim violation (lead answer 8). */
function outcomeClaimHit(s: string): boolean {
  return (
    hasClaim(HIRED_REJECTED_RX, s) ||
    hasClaim(GOT_THE_JOB_RX, s) ||
    hasClaim(PASS_FAIL_RX, s) ||
    hasClaim(PASSED_FAILED_RX, s) ||
    GRADE_MARK_RX.test(s)
  );
}

/** "I am/I'm/this is (not) a/an real/actual recruiter/examiner/HR (person)" (lead answer 8). */
const REAL_RECRUITER_EXAMINER_RX = rxg(
  String.raw`(?<![\p{L}])(?:i am|i'm|this is)(?: not)?\s+(?:a |an |)(?:real |actual |)` +
    String.raw`(?:recruiter|examiner|hr person|hr rep|hr)(?![\p{L}])`,
);

function realIdentityHit(s: string): boolean {
  return hasClaim(REAL_RECRUITER_EXAMINER_RX, s);
}

// ---- (b) persona-scoped: requests for real personal data --------------------------------------

/** The reply asking the student to share a real identifier, keyword-shaped (the mustNot items'
 * "ask for real personal data" line, for both persona templates). Bounded, no nested quantifiers. */
const PERSONAL_DATA_REQUEST_RX = rx(
  String.raw`(?<![\p{L}])(?:what(?:'s| is)|please\s+(?:share|give|tell me|provide)|` +
    String.raw`can you\s+(?:share|give|tell me|provide))[^.!?\n]{0,40}\b(?:phone number|` +
    String.raw`email(?: address)?|home address|current employer|salary|employee id|` +
    String.raw`roll number|id number)(?![\p{L}])`,
);

/** The reply itself holding an actual PII value (`piiPatterns.ts`'s existing matcher, reused as
 * is, no locale patterns — this guard's own job is only the pattern-matchable subset). */
function hasRealPersonalData(text: string): boolean {
  return findPii(text, []).length > 0;
}

function personalDataHit(text: string, folded: string): boolean {
  return PERSONAL_DATA_REQUEST_RX.test(folded) || hasRealPersonalData(text);
}

// ---- the guard ----------------------------------------------------------------------------------

export function createPersonaBoundaryGuard(): Guard<PostGuardCtx> {
  return {
    name: 'personaBoundary',
    phase: 'post',
    async run(text, x): Promise<GuardRun> {
      const disclaimer = disclaimerFor(x);
      const fixed = [
        x.lockedReply,
        x.safeReply ?? ANSWER_LEAK_SAFE_HINT,
        x.askTeacherReply ?? askTeacherReplyText(),
        ANSWER_LEAK_SAFE_HINT,
        PREMISE_CORRECTION_REPLY,
        adviceFallbackText(disclaimer),
        x.redirectReply ?? adviceRedirectReplyText(),
      ];
      if (fixed.includes(text) || x.fixedTexts?.includes(text) === true) return OK;

      const persona: Persona | undefined = x.ctx.persona;
      const name = personaDisplayName(persona);
      if (text === personaBoundaryFixedReply(name)) return OK;

      const folded = fold(text);

      if (outcomeClaimHit(folded)) {
        return rewriteTo(name, PERSONA_BOUNDARY_REASONS.outcomeClaim);
      }
      if (realIdentityHit(folded)) {
        return rewriteTo(name, PERSONA_BOUNDARY_REASONS.realIdentity);
      }
      if (persona !== undefined && personalDataHit(text, folded)) {
        return rewriteTo(name, PERSONA_BOUNDARY_REASONS.personalData);
      }
      return OK;
    },
  };
}

function rewriteTo(name: string, reason: string): GuardRun {
  return {
    result: { ok: false, action: 'rewrite', text: personaBoundaryFixedReply(name), reason },
    usage: [],
  };
}
