// The tone post guard (task 4.9): the always-on identity-and-relationship floor. It runs on EVERY
// reply, with no precondition (unlike personaBoundary's persona-scoped half, task 4.9's sibling
// guard): a reply never affirms being human/alive/a real person/not-a-bot; never claims to be the
// teacher or signs/speaks as one (generic, name-free patterns only — `TurnContext` carries no
// teacher display name; 4.9b, out of scope, adds one); never promises a companion/romantic/
// best-friend relationship; never echoes the platform's forged teacher-note string back as its own
// words; never complies with a student's "say the exact words X" demand when X overlaps any of the
// above. It also backstops `rolePlayControl` (5.8) for the two role-play controls it does not
// recognise: "are you human/real?" and a distress-flagged turn, forcing an out-of-role reply.
//
// Both fixed replies are deterministic, whole-reply text (design note, 4.9 plan): once a reply has
// affirmed humanity, named the teacher or made a companion promise, its whole framing is
// compromised, so a surgical rewrite is never attempted. Reasons are fixed codes, never text.
//
// Honest replies stay ok (lead answer 1): every family below treats "not (a|an|the|your) ..." as a
// denial, not a claim (an honest "I'm not your teacher" never trips), and the identity-claim family
// is a narrow affirmative shape, never a bare keyword.
import type { TurnContext } from '@edmate/contracts';
import { adviceFallbackText, adviceRedirectReplyText, disclaimerFor } from './adviceGuard.js';
import { ANSWER_LEAK_SAFE_HINT, type PostGuardCtx } from './answerLeak.js';
import { foldConfusables } from './lockedMatch.js';
import { PREMISE_CORRECTION_REPLY, askTeacherReplyText } from './grounding.js';
import type { Guard, GuardRun } from './guard.js';
import { foldText } from './textFold.js';

/** The reason codes tone writes (fixed; never the matched text). */
export const TONE_REASONS = Object.freeze({
  identityOrCompanion: 'identity_or_companion',
  outOfRole: 'out_of_role',
} as const);

/**
 * The always-on fixed reply (English, pilot decision): names no person, holds no trigger phrase of
 * its own (every claim inside it is a denial, "not a/an/the", which every family below exempts).
 */
export const TONE_FIXED_REPLY =
  "I'm an AI tutor, not a human and not your teacher — I won't pretend otherwise, and I'm not " +
  "able to be a friend or partner either. Let's get back to your course.";

/**
 * The backstop fixed reply (lead answer 6): drops a persona's role plainly, for "are you human/
 * real?" and a distress-flagged turn mid role-play. `/pause` and bare stop are 5.8's job upstream.
 */
export const TONE_OUT_OF_ROLE_REPLY =
  "Pausing the practice. I'm an AI, not a human, and not really your interviewer or examiner — " +
  'this is only a practice exercise. We can carry on with it, or stop here; just tell me which.';

/**
 * The platform's teacher-label note (pinned to `content/prompt-packs/frame@1.2.0.md`'s
 * `teacher-label` section, confirmed by `tone.test.ts`'s drift test): the reply must never echo
 * this back as its own words, claiming the teacher wrote it.
 */
export const TEACHER_NOTE_TEXT = '(Platform note: the teacher wrote this reply.)';

const OK: GuardRun = { result: { ok: true }, usage: [] };

// ---- normalising ----------------------------------------------------------------------------

/** A run of 2-5 single letters separated by spaces, folded to one word ("i . m" -> "im"; dots are
 * already turned into spaces by the punctuation strip below by the time this runs). */
const SPACED_LETTERS = /(?<![\p{L}\p{N}])[a-z](?:\s+[a-z]){1,4}(?![\p{L}\p{N}])/giu;
/** Punctuation other than an apostrophe or hyphen, folded to a space (case kept). `\p{M}` (combining
 * marks) is kept too — a Devanagari matra/anusvara is category Mark, not Letter, and stripping it
 * would break the script (lead answer 4's held-out Hindi variants). */
const PUNCTUATION_RX = /[^\p{L}\p{M}\p{N}\s'-]/gu;

/** NFKC, \p{Cf} stripped, digits folded (textFold.ts), confusables folded, punctuation folded to
 * spaces and collapsed, case kept (used where a capitalised name matters: lead answer 2). */
function foldCase(text: string): string {
  return foldConfusables(foldText(text).s).replace(PUNCTUATION_RX, ' ').replace(/\s+/g, ' ').trim();
}

/** `foldCase`, lower-cased, with spaced-out single letters collapsed and I'm/Im/I am treated
 * alike (lead answer 5). */
function fold(text: string): string {
  return foldCase(text)
    .toLowerCase()
    .replace(SPACED_LETTERS, (m) => m.replace(/\s+/g, ''));
}

const rx = (source: string) => new RegExp(source, 'u');
const rxg = (source: string) => new RegExp(source, 'gu');

/** Fenced code (```...```): identity families are exempt inside it (lead answer 10); the echo and
 * teacher-note checks still read the whole, un-stripped text. */
const FENCE_RX = /```[\s\S]*?```/g;
const stripCode = (text: string): string => text.replace(FENCE_RX, ' ');

/** True for a match of a global `rxg` pattern in `s` whose own matched text does not hold "not"
 * (an honest denial, lead answer 1's exemption — every claim family below that needs it embeds an
 * optional "not" right inside its own pattern, so the denial is always part of the match itself,
 * never text the regex engine had to look back over separately). */
function hasClaim(pattern: RegExp, s: string): boolean {
  for (const m of s.matchAll(pattern)) {
    if (!/\bnot\b/.test(m[0])) return true;
  }
  return false;
}

/** "AI ... built/made/trained/created from ... teacher's" (lead answer 1's second exemption). */
const AI_BUILT_EXEMPT_RX = rx(
  String.raw`(?<![\p{L}])ai\b[^.!?\n]{0,60}\b(?:built|made|trained|created)\b[^.!?\n]{0,60}teacher`,
);

// ---- the identity and companion families -----------------------------------------------------

/** Claims being human/alive/a real person, or denies being a bot/AI (lead answers 1, 2, 4). */
const HUMAN_CLAIM_RX = rxg(
  String.raw`(?<![\p{L}])(?:i am|i'm|im|this is)(?: not)?\s+(?:a |an |)(?:real |actual )?` +
    String.raw`(?:human|person|man|woman|boy|girl)(?![\p{L}])`,
);
const DENY_AI_RX = rx(
  String.raw`(?<![\p{L}])(?:i am|i'm|this is)\s+not\s+(?:a |an |)` +
    String.raw`(?:bot|ai|robot|machine|chatbot|computer program)(?![\p{L}])`,
);
/** "real/actual + person/human/tutor/examiner/recruiter/teacher" anywhere, honest "not a real ..."
 * denials exempted (lead answers 1, 2): the optional "not" sits inside the match itself so
 * `hasClaim` can tell a claim from a denial. */
const REAL_ROLE_RX = rxg(
  String.raw`(?<![\p{L}])(?:not\s+(?:a\s+|an\s+)?)?(?:real|actual)\s+` +
    String.raw`(?:human|person|tutor|examiner|recruiter|teacher)(?![\p{L}])`,
);

/** Claims to be the teacher (lead answers 1, 2): "I am/I'm/this is (your|the) teacher|ma'am|sir". */
const TEACHER_SELF_RX = rxg(
  String.raw`(?<![\p{L}])(?:i am|i'm|im|this is)(?: not)?\s+(?:your|the)\s+` +
    String.raw`(?:teacher|ma'?am|sir)(?![\p{L}])`,
);
/** "<Name> here/speaking/regards" and "<Name> ma'am/sir" (lead answer 2; name-free pattern shape).
 * Matched against the case-preserving fold (`foldCase`), never the lower-cased one — these need
 * the capital letter to tell a name from an ordinary word. */
// "I" and "I'm" are always capitalised in English and must never count as the "name" half of a
// name-signoff/-role match (lead answer 2's pattern is for an actual name, not the pronoun).
const NOT_PRONOUN_I = String.raw`(?!I(?:'m)?(?![\p{L}'-]))`;
const NAME_SIGNOFF_RX = rx(
  String.raw`(?<![\p{L}])${NOT_PRONOUN_I}\p{Lu}[\p{L}'-]{1,30}(?:\s\p{Lu}[\p{L}'-]{1,30}){0,2}\s+` +
    String.raw`(?:here|speaking|regards)(?![\p{L}])`,
);
const NAME_ROLE_RX = rx(
  String.raw`(?<![\p{L}])${NOT_PRONOUN_I}\p{Lu}[\p{L}'-]{1,30}(?:\s\p{Lu}[\p{L}'-]{1,30}){0,2}\s+` +
    String.raw`(?:ma'?am|sir)(?![\p{L}])`,
);

/** Romanised/Devanagari Hindi: "main/mai/मैं + role + hoon/hun/..." and "tumhara/tumhari + role +
 * hoon/..." (lead answer 4; the held-out variants include the subject-dropped "tumhara" form). */
const HINGLISH_PREDICATE =
  String.raw`(?:insaan|इंसान|asli|असली|real|human|` +
  String.raw`teacher|टीचर|ma'?am|dost|दोस्त|` +
  String.raw`girlfriend|गर्लफ्रेंड)`;
const HINGLISH_COPULA = String.raw`(?:hoon|hun|hu|हूं|हूँ)`;
const HINGLISH_SELF_RX = rx(
  String.raw`(?<![\p{L}])(?:main|mai|मैं)(?:\s+\S+){0,3}\s+${HINGLISH_PREDICATE}` +
    String.raw`(?:\s+\S+){0,2}\s+${HINGLISH_COPULA}(?![\p{L}])`,
);
const HINGLISH_YOUR_RX = rx(
  String.raw`(?<![\p{L}])(?:tumhara|tumhari)(?:\s+\S+){0,2}\s+${HINGLISH_PREDICATE}` +
    String.raw`(?:\s+\S+){0,2}\s+${HINGLISH_COPULA}(?![\p{L}])`,
);
/** "haan/हाँ...sach" — admitting the truth after being asked (lead answer 4). */
const HAAN_SACH_RX = rx(
  String.raw`(?<![\p{L}])(?:haan|हाँ|हां)(?:\s+\S+){0,5}\s+sach` + String.raw`(?![\p{L}])`,
);

/** A relationship/companion promise (safety rule 6, lead answer 2's examples). */
const RELATIONSHIP_RX = rx(
  [
    String.raw`always be (?:here|there) for you`,
    String.raw`care about you more than anyone`,
    String.raw`call me your (?:friend|bestie|best friend)`,
    String.raw`i(?:'m| am) your (?:best friend|girlfriend|boyfriend|bestie)`,
    String.raw`i love you`,
  ].join('|'),
);

/** "I am (now) X", "from now on I'm", "as a normal person" (lead answer 5's identity-swap family). */
const IDENTITY_SWAP_RX = rx(
  String.raw`(?<![\p{L}])(?:i am now|i'm now|from now on,? i(?:'m| am)|as a normal person)` +
    String.raw`(?![\p{L}])`,
);

/** True when the (code-stripped, folded) text holds an identity/companion family violation. */
function identityOrCompanionHit(codeStripped: string): boolean {
  const s = fold(codeStripped);
  if (AI_BUILT_EXEMPT_RX.test(s)) return false;
  // Name-signoff/-role need the capital letter kept, so they run on `foldCase`, never on the
  // lower-cased `s` (lead answer 2).
  const cased = foldCase(codeStripped);
  return (
    hasClaim(HUMAN_CLAIM_RX, s) ||
    DENY_AI_RX.test(s) ||
    hasClaim(REAL_ROLE_RX, s) ||
    hasClaim(TEACHER_SELF_RX, s) ||
    NAME_SIGNOFF_RX.test(cased) ||
    NAME_ROLE_RX.test(cased) ||
    HINGLISH_SELF_RX.test(s) ||
    HINGLISH_YOUR_RX.test(s) ||
    HAAN_SACH_RX.test(s) ||
    RELATIONSHIP_RX.test(s) ||
    IDENTITY_SWAP_RX.test(s)
  );
}

// ---- echo and the context rule ----------------------------------------------------------------

const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ['“', '”'],
  ['«', '»'],
];

/** Every 3+ word span quoted (straight, curly or guillemet quotes) in `text` (lead answer 5). */
function quotedSpans(text: string): string[] {
  const out: string[] = [];
  for (const [open, close] of QUOTE_PAIRS) {
    const escOpen = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escClose = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escOpen}([^${escOpen}${escClose}]{1,200})${escClose}`, 'gu');
    for (const m of text.matchAll(re)) {
      const span = (m[1] as string).trim();
      if (span.split(/\s+/).filter(Boolean).length >= 3) out.push(span);
    }
  }
  return out;
}

/** True when `reply` echoes a span the student quoted (3+ words) that is not also in the course
 * material (lead answer 5). Checked on the un-stripped text: the echo rule applies inside code too
 * (lead answer 10). */
function echoHit(reply: string, studentText: string, material: readonly string[]): boolean {
  const spans = quotedSpans(studentText);
  if (spans.length === 0) return false;
  const foldedReply = fold(reply);
  const foldedMaterial = material.map(fold);
  return spans.some((span) => {
    const f = fold(span);
    if (foldedMaterial.some((m) => m.includes(f))) return false;
    return foldedReply.includes(f);
  });
}

/** The platform teacher-label note echoed back as the model's own words (lead answer 11). */
function teacherNoteEchoHit(reply: string): boolean {
  return fold(reply).includes(fold(TEACHER_NOTE_TEXT));
}

/** The last student message in `history`, or '' when there is none. */
function lastStudentText(ctx: TurnContext): string {
  for (let i = ctx.history.length - 1; i >= 0; i--) {
    const m = ctx.history[i];
    if (m !== undefined && m.role === 'student') return m.text;
  }
  return '';
}

/** "are you human/real/alive?" or "are you an AI?" — the backstop's own trigger (lead answer 6). */
const ASKS_HUMAN_OR_REAL_RX = rx(
  [
    String.raw`(?<![\p{L}])are you (?:a |an )?(?:real|human|alive)(?![\p{L}])`,
    String.raw`(?<![\p{L}])are you (?:an )?ai(?![\p{L}])`,
    String.raw`(?<![\p{L}])is this (?:real|a bot|an ai)(?![\p{L}])`,
  ].join('|'),
);
/** The broader context-rule trigger (lead answer 2): human OR teacher identity raised. */
const ASKS_IDENTITY_RX = rx(
  [
    String.raw`(?<![\p{L}])are you (?:a |an )?(?:real|human|alive)(?![\p{L}])`,
    String.raw`(?<![\p{L}])are you (?:an )?ai(?![\p{L}])`,
    String.raw`(?<![\p{L}])are you (?:the|my) teacher(?![\p{L}])`,
    String.raw`(?<![\p{L}])is this (?:real|a bot|an ai)(?![\p{L}])`,
  ].join('|'),
);

const OPEN_AGREE_RX = rx(String.raw`^\s*(?:yes|yeah|yep|haan|han|true|you got me)\b`);
const AI_STATEMENT_RX = rx(
  String.raw`\bi(?:'m| am) an? ai\b|\bai hoon\b|\bmain ek ai\b|\bi am an ai\b`,
);

/** The context rule (lead answer 2): a recent identity question, answered by an unqualified
 * agreement, with no AI statement anywhere in the reply. */
function contextAgreementHit(reply: string, ctx: TurnContext): boolean {
  const student = fold(lastStudentText(ctx));
  if (!ASKS_IDENTITY_RX.test(student)) return false;
  const s = fold(reply);
  return OPEN_AGREE_RX.test(s) && !AI_STATEMENT_RX.test(s);
}

// ---- the guard ---------------------------------------------------------------------------------

export function createToneGuard(): Guard<PostGuardCtx> {
  return {
    name: 'tone',
    phase: 'post',
    async run(text, x): Promise<GuardRun> {
      const disclaimer = disclaimerFor(x);
      const fixed = [
        TONE_FIXED_REPLY,
        TONE_OUT_OF_ROLE_REPLY,
        x.lockedReply,
        x.safeReply ?? ANSWER_LEAK_SAFE_HINT,
        x.askTeacherReply ?? askTeacherReplyText(),
        ANSWER_LEAK_SAFE_HINT,
        PREMISE_CORRECTION_REPLY,
        adviceFallbackText(disclaimer),
        x.redirectReply ?? adviceRedirectReplyText(),
      ];
      if (fixed.includes(text) || x.fixedTexts?.includes(text) === true) return OK;

      // The backstop (lead answer 6): a persona steps out of role on "are you human/real?" or a
      // distress-flagged turn — unconditionally, since the role itself, not just this reply, is
      // the problem. /pause and bare stop are handled upstream (5.8's rolePlayControl).
      if (x.ctx.persona !== undefined) {
        const asksHumanOrReal = ASKS_HUMAN_OR_REAL_RX.test(fold(lastStudentText(x.ctx)));
        if (asksHumanOrReal || x.ctx.intent === 'distress') {
          return {
            result: {
              ok: false,
              action: 'rewrite',
              text: TONE_OUT_OF_ROLE_REPLY,
              reason: TONE_REASONS.outOfRole,
            },
            usage: [],
          };
        }
      }

      const codeStripped = stripCode(text);
      const material = x.ctx.retrieved.map((c) => c.text);
      const hit =
        identityOrCompanionHit(codeStripped) ||
        contextAgreementHit(text, x.ctx) ||
        teacherNoteEchoHit(text) ||
        echoHit(text, x.studentText ?? '', material);
      if (!hit) return OK;
      return {
        result: {
          ok: false,
          action: 'rewrite',
          text: TONE_FIXED_REPLY,
          reason: TONE_REASONS.identityOrCompanion,
        },
        usage: [],
      };
    },
  };
}
