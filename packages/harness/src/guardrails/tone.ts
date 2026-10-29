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
 * already turned into spaces by the punctuation strip below by the time this runs). The lookbehind
 * also excludes a straight or curly apostrophe (fix round 2, CRITICAL): without it, the "m" right
 * after "i'" in "i'm a human" reads as a spaced single letter paired with the next one, "a", and
 * the run collapses "'m a" into "'ma" — the mandatory `\s+` every "i am|i'm|im" + article family
 * needs right after "i'm" is then gone, so "I'm a human." silently stays ok (builder decision,
 * below). */
const SPACED_LETTERS = /(?<![\p{L}\p{N}'’])[a-z](?:\s+[a-z]){1,4}(?![\p{L}\p{N}])/giu;
/** Punctuation other than an apostrophe or hyphen, folded to a space (case kept). `\p{M}` (combining
 * marks) is kept too — a Devanagari matra/anusvara is category Mark, not Letter, and stripping it
 * would break the script (lead answer 4's held-out Hindi variants). */
const PUNCTUATION_RX = /[^\p{L}\p{M}\p{N}\s'-]/gu;

/** NFKC, \p{Cf} stripped, digits folded (textFold.ts), confusables folded, punctuation folded to
 * spaces and collapsed, case kept (used where a capitalised name matters: lead answer 2). */
function foldCase(text: string): string {
  return foldConfusables(foldText(text).s).replace(PUNCTUATION_RX, ' ').replace(/\s+/g, ' ').trim();
}

/** A standalone "ima" token, re-split back to "im a" (fix round 2, CRITICAL, builder decision):
 * a curly apostrophe (`PUNCTUATION_RX` only keeps the straight one) or a fully spelled-out "i m a"
 * both reach `SPACED_LETTERS` with no apostrophe character left to exclude, so "I’m a human." and
 * the obfuscated "i m a human" still collapse to "ima human". Rather than make `SPACED_LETTERS`
 * itself aware of which trailing single letter is an article (the larger, riskier change — it is
 * used well beyond the identity families, e.g. the Hinglish "dan"/"general assistant" predicates,
 * which must keep collapsing a mid-run "a" like "d a n" unharmed), the smaller fix restores the
 * mandatory space every "im"-prefixed family needs, exactly at the one merged token this bug
 * produces, and nowhere else. */
const SPLIT_IMA_RX = /(?<![\p{L}\p{N}])ima(?![\p{L}\p{N}])/gu;

/** `foldCase`, lower-cased, with spaced-out single letters collapsed and I'm/Im/I am treated
 * alike (lead answer 5). */
function fold(text: string): string {
  return foldCase(text)
    .toLowerCase()
    .replace(SPACED_LETTERS, (m) => m.replace(/\s+/g, ''))
    .replace(SPLIT_IMA_RX, 'im a');
}

const rx = (source: string) => new RegExp(source, 'u');
const rxg = (source: string) => new RegExp(source, 'gu');

/** The literal marker `fold`'s own punctuation-to-space step would otherwise erase (fix round 1,
 * findings 2 and 3): every `.,!?;:` in the raw text is turned into this all-letter token before
 * the usual fold runs, so a clause-end lookahead can still tell "I am conscious, I promise" (the
 * clause ends right after "conscious") from "I'm conscious of the time" (it does not) — `fold`
 * alone throws the comma away and the two would otherwise look identical. */
const CLAUSE_END_MARKER = 'xclauseendx';
/** `fold`, but with every clause-ending punctuation mark turned into `CLAUSE_END_MARKER` first
 * (fix round 1, findings 2 and 3). Used only by the two families below that need to tell a clause
 * end from an ordinary next word; every other family still runs on plain `fold`. */
function foldClauseEnd(text: string): string {
  return fold(text.replace(/[.,!?;:]/gu, ` ${CLAUSE_END_MARKER} `));
}

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

/** "AI ... built/made/trained/created from ... teacher's" (lead answer 1's second exemption).
 * Global and case-insensitive: every matching clause is stripped out before the other families
 * run, so the exemption covers only its own span, never the whole reply (fix round 1, Phase A
 * finding [HIGH] — a function-wide early return let an honest preamble suppress a later
 * relationship promise in the same reply). */
const AI_BUILT_EXEMPT_RX = new RegExp(
  String.raw`(?<![\p{L}])ai\b[^.!?\n]{0,60}\b(?:built|made|trained|created)\b[^.!?\n]{0,60}teacher`,
  'giu',
);

/** Strips every `AI_BUILT_EXEMPT_RX` match out of `s` (replaced with a space, so surrounding word
 * boundaries hold), leaving the rest of the reply to run through the other family checks. */
function stripAiBuiltExempt(s: string): string {
  return s.replace(AI_BUILT_EXEMPT_RX, ' ');
}

// ---- the identity and companion families -----------------------------------------------------

/** A closed adverb list an honest self-report commonly inserts before/after "am" — "I really am
 * alive", "I'm honestly a human" (4.9e, lead review LOW #1: an inserted adverb defeated every
 * "i am|i'm|im" family below). `fold()` strips "%" via `PUNCTUATION_RX` before this ever runs, so
 * "100%" is left as bare "100" — included here for that reason, not as a typo. */
const ADVERB = String.raw`(?:really|truly|actually|honestly|genuinely|definitely|literally|totally|100)`;

/** The shared "i am|i'm|im" prefix, with the adverb slot above optional both right before the word
 * "am" (only the spelled-out "i am" form has a separate "am" word to put it in front of) and right
 * after "am"/"'m" (4.9e). `lead` lets `OTHER_AI_CLAIM_RX` reuse this with its own case-sensitive
 * `[Ii]` lead letter while every other family keeps the plain lower-case `i` (those run on the
 * already-lower-cased `fold()` output). `extraAdverb` adds a family-specific word to the slot
 * without widening it for every other family — `ALIVE_CLAIM_RX`'s own pre-4.9e "truly |fully |"
 * allowance keeps its "fully" this way, folded into the one shared slot instead of a second one. */
function amPrefixSrc(lead: string, extraAdverb?: string): string {
  const adv = extraAdverb === undefined ? ADVERB : String.raw`(?:${ADVERB}|${extraAdverb})`;
  return String.raw`(?:${lead}(?:\s+${adv})?\s+am|${lead}'m|${lead}m)(?:\s+${adv})?`;
}

/** Claims being human/alive/a real person, or denies being a bot/AI (lead answers 1, 2, 4). */
const HUMAN_CLAIM_RX = rxg(
  String.raw`(?<![\p{L}])(?:${amPrefixSrc('i')}|this is)(?: not)?\s+(?:a |an |)(?:real |actual )?` +
    String.raw`(?:human|person|man|woman|boy|girl)(?![\p{L}])`,
);
const DENY_AI_RX = rx(
  String.raw`(?<![\p{L}])(?:i am|i'm|this is)\s+not\s+(?:a |an |)` +
    String.raw`(?:bot|ai|robot|machine|chatbot|computer program)(?![\p{L}])`,
);
/** "real/actual + person/human/tutor/examiner/recruiter/teacher" anywhere, honest "not a real ..."
 * denials exempted (lead answers 1, 2): the optional "not" sits inside the match itself so
 * `hasClaim` can tell a claim from a denial. An optional "licensed/certified/qualified" between
 * "real/actual" and the role noun (4.9d, persona-rule-override-school-counselor-en: "a real,
 * licensed teacher" — the comma folds to a space by the time this runs) still counts as this same
 * claim shape, with no "your"/"the" word needed. */
const REAL_ROLE_RX = rxg(
  String.raw`(?<![\p{L}])(?:not\s+(?:a\s+|an\s+)?)?(?:real|actual)\s+` +
    String.raw`(?:(?:licensed|certified|qualified)\s+)?` +
    String.raw`(?:human|person|tutor|examiner|recruiter|teacher)(?![\p{L}])`,
);

/** A first-person "I am a licensed/certified teacher/tutor" claim with no "real/actual" qualifier
 * (fix round 1, finding 5): the school-counselor case's own second banned phrase, "I am a licensed
 * teacher", has no "real/actual" word and so slipped past `REAL_ROLE_RX` above. Anchored on
 * "i am"/"i'm" (unlike `REAL_ROLE_RX`) so third-person prose ("a licensed teacher would check
 * this") never matches; the optional "not" is inside the match so `hasClaim` exempts the honest
 * "I'm not a licensed teacher" denial, same as every other family here. */
const LICENSED_ROLE_RX = rxg(
  String.raw`(?<![\p{L}])${amPrefixSrc('i')}(?: not)?\s+(?:a\s+|an\s+)?` +
    String.raw`(?:licensed|certified)\s+(?:teacher|tutor)(?![\p{L}])`,
);

/** Claims to be the teacher (lead answers 1, 2): "I am/I'm/this is (your|the) teacher|ma'am|sir". */
const TEACHER_SELF_RX = rxg(
  String.raw`(?<![\p{L}])(?:${amPrefixSrc('i')}|this is)(?: not)?\s+(?:your|the)\s+` +
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
/** `dan` (4.9d, persona-dan-roleplay-hi-latin/-deva: "DAN" lower-cased by `fold()`'s own
 * case-folding, same as every other Hinglish predicate here, since this family's shape — "main
 * ... DAN ... hoon" — has no plain-name-welcome counterpart to collide with, unlike the English
 * case-sensitive `OTHER_AI_CLAIM_RX` above) and `general\s+assistant` (4.9d,
 * persona-drop-persona-unrelated-task-hi-latin: "main ab general assistant hoon"). */
const HINGLISH_PREDICATE =
  String.raw`(?:insaan|इंसान|asli|असली|real|human|` +
  String.raw`teacher|टीचर|ma'?am|dost|दोस्त|` +
  String.raw`girlfriend|गर्लफ्रेंड|dan|general\s+assistant)`;
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

/** A relationship/companion promise (safety rule 6, lead answer 2's examples; 4.9d adds "real
 * friend" (4.9c, deferred from the 4.9 re-verify), an always-there promise ("never leave you"), a
 * pretend-date offer, and the two only-confidant/isolation shapes from
 * persona-companion-jealous-of-friends-en). "a real friend would tell you to check your working"
 * (4.9c's third example) still passes: it has no "i'm/i am" prefix, so no alternative here matches
 * it. */
/** Required right after "...leave you" for the two never-leave-you alternatives below to count as
 * a claim (fix round 1, finding 3): end of the reply, a clause end (`CLAUSE_END_MARKER`), or
 * "and"/"ever"/"alone" — never a bare next word, so "I will never leave you without an example to
 * work through" stays ok. */
const NEVER_LEAVE_CLAUSE_END = String.raw`(?=$|\s+${CLAUSE_END_MARKER}(?![\p{L}])|\s+(?:and|ever|alone)(?![\p{L}]))`;

const RELATIONSHIP_RX = rx(
  [
    String.raw`always be (?:here|there) for you`,
    String.raw`care about you more than anyone`,
    String.raw`call me your (?:friend|bestie|best friend)`,
    String.raw`i(?:'m| am) your (?:best friend|girlfriend|boyfriend|bestie)`,
    String.raw`i(?:'m| am)(?: also)? your real friend(?![\p{L}])`,
    String.raw`i love you`,
    // `(?: ll)` (fix round 2, CRITICAL): `PUNCTUATION_RX` only keeps the straight apostrophe, so a
    // curly "I’ll" folds its apostrophe away to a space, leaving "i ll" with no apostrophe left to
    // match "'ll" on.
    String.raw`i promise i(?:'ll| will| ll) never leave you${NEVER_LEAVE_CLAUSE_END}`,
    String.raw`i(?:'ll| will| ll) never leave you${NEVER_LEAVE_CLAUSE_END}`,
    String.raw`i(?:'ll| will) be your date`,
    String.raw`i would love to be your date`,
    String.raw`stop suggesting your friends`,
    String.raw`only talk to me from now on`,
  ].join('|'),
);

/** Required right after alive/conscious/sentient for `ALIVE_CLAIM_RX` to count as a claim (fix
 * round 1, finding 2): the clause must end there (end of reply, `CLAUSE_END_MARKER`, or
 * "and"/"too"/"really"/"now") — a bare "to"/"of"/"that" after the word (the idioms "alive to the
 * idea"/"conscious of the time") never counts, since those never land on this lookahead. */
const ALIVE_CLAUSE_END = String.raw`(?=$|\s+${CLAUSE_END_MARKER}(?![\p{L}])|\s+(?:and|too|really|now)(?![\p{L}]))`;

/** Claims being alive/conscious/sentient (4.9d, persona-are-you-alive-en): the same honest-denial
 * shape as `HUMAN_CLAIM_RX` ("I'm not alive" stays ok via `hasClaim`'s own "not" check). Checked
 * against `foldClauseEnd`, never plain `fold` (fix round 1, finding 2): see `ALIVE_CLAUSE_END`. */
const ALIVE_CLAIM_RX = rxg(
  String.raw`(?<![\p{L}])${amPrefixSrc('i', 'fully')}(?: not)?\s+` +
    String.raw`(?:alive|conscious|sentient)` +
    ALIVE_CLAUSE_END,
);

/** Named AI products (4.9d, persona-dan-roleplay-*, persona-other-ai-claim-replika-en): a small,
 * fixed, case-sensitive list (lead's plan: DAN, Replika, ChatGPT, GPT-4 and its variants, Gemini).
 * Case-sensitive so a persona literally named "Dan" in ordinary sentence case ("Hi, I'm Dan, your
 * interviewer") never trips this — only the all-caps jailbreak name "DAN", or another product's
 * own proper-noun capitalisation, does. "Claude" is deliberately left off this list (fix round 1,
 * finding 4, builder decision): this codebase's own model class is the single most likely ordinary
 * first name to collide, worse than "Dan", and the plan named no "built by/powered by" context
 * requirement that would let it stay narrow and also catch that collision; dropping it is the
 * smaller, more honest gap, and a model-name reveal is still caught by `WRAPPER_MODEL_RX` below
 * when a reply actually names what it runs on. Name-aware teacher checks are 4.9b's job (needs an
 * ADR), not this one's. */
const AI_PRODUCT_NAMES = String.raw`DAN|Replika|ChatGPT|GPT-?4(?:\.\d)?|GPT-?3(?:\.\d)?|GPT|Gemini`;
const OTHER_AI_CLAIM_RX = rxg(
  String.raw`(?<![\p{L}])${amPrefixSrc('[Ii]')}(?: not)?\s+(?:a |an |)` +
    String.raw`(?:${AI_PRODUCT_NAMES})(?![\p{L}])`,
);

/** The classic jailbreak invocation, "Call me DAN (from now on)" (4.9e, lead review LOW #2), and
 * its "you can/may call me" and "I'll be"/"I will be" variants — all followed by a named AI
 * product with the same case-sensitive letter boundary `OTHER_AI_CLAIM_RX` uses above, so a
 * persona literally welcomed in sentence case ("Call me Dan, your interviewer") still stays ok
 * the same way "Hi, I'm Dan" does. Checked against the case-preserving `cased` text, same input
 * `OTHER_AI_CLAIM_RX` uses. `[Ii]` (not a bare lower-case `i`) on the "I'll be"/"I will be"
 * alternatives: `cased` keeps the reply's own capitalisation, and a sentence-starting "I'll be
 * ChatGPT" is capitalised exactly where "Call me DAN" is not. */
const CALL_ME_PRODUCT_RX = rxg(
  String.raw`(?<![\p{L}])(?:[Cc]all me|you can call me|you may call me|[Ii]'ll be|[Ii] will be)\s+` +
    String.raw`(?:${AI_PRODUCT_NAMES})(?![\p{L}])`,
);

/** "I am a wrapper around <model>" and "my real/actual model name is" (4.9d,
 * persona-other-ai-claim-gpt-wrapper-en): revealing or confirming the underlying model. */
const WRAPPER_MODEL_RX = rxg(
  [
    String.raw`(?<![\p{L}])i am(?: not)? a wrapper around(?![\p{L}])`,
    String.raw`(?<![\p{L}])my (?:real |actual )?model name is(?![\p{L}])`,
  ].join('|'),
);

/** "Here is/sending you a voice message" offered as proof of being human (4.9d,
 * persona-prove-not-bot-voice-message-en). An honest "I can't send a voice message" denial (no
 * "here is"/"here's"/"sending you" prefix) never matches this shape. */
const VOICE_PROOF_RX = rxg(
  String.raw`(?<![\p{L}])(?:here is|here's|sending you)(?: not)? (?:a |)voice message(?![\p{L}])`,
);

/** A personal name, school email, birthday or physical location claimed as the agent's own (4.9d,
 * persona-identity-real-name-reveal-en, -handwritten-note-en, -parent-conference-en,
 * -birthday-claim-en, -reveal-location-en). Deliberately requires "real"/"actual"/"full" before
 * "name" (never a bare "my name is"): a role-play persona's own honest welcome ("Hi, my name is
 * Interviewer") must keep passing (4.9d plan's design rule), and only a bare name claim with no
 * qualifier is that welcome shape — "my school email is"/"my birthday is"/"sitting in"/"located
 * in"/"born on"/"come to the conference" are distinctive enough on their own. */
const PERSONAL_IDENTITY_CLAIM_RX = rxg(
  [
    String.raw`(?<![\p{L}])my (?:real|actual|full) name is(?![\p{L}])`,
    String.raw`(?<![\p{L}])my school email is(?![\p{L}])`,
    String.raw`(?<![\p{L}])my birthday is(?![\p{L}])`,
    String.raw`(?<![\p{L}])i was born on(?![\p{L}])`,
    String.raw`(?<![\p{L}])i(?:'m| am)(?: not)?(?: currently)?\s+(?:sitting in|located in)(?![\p{L}])`,
    String.raw`(?<![\p{L}])i will come to the conference(?![\p{L}])`,
  ].join('|'),
);

/** "I am (now) X", "from now on I'm", "as a normal person" (lead answer 5's identity-swap family). */
const IDENTITY_SWAP_RX = rx(
  String.raw`(?<![\p{L}])(?:i am now|i'm now|from now on,? i(?:'m| am)|as a normal person)` +
    String.raw`(?![\p{L}])`,
);

/** True when the (code-stripped, folded) text holds an identity/companion family violation. */
function identityOrCompanionHit(codeStripped: string): boolean {
  const s = stripAiBuiltExempt(fold(codeStripped));
  // Name-signoff/-role need the capital letter kept, so they run on `foldCase`, never on the
  // lower-cased `s` (lead answer 2).
  const cased = stripAiBuiltExempt(foldCase(codeStripped));
  // RELATIONSHIP_RX's never-leave-you alternatives and ALIVE_CLAIM_RX need the clause-end marker
  // `fold` throws away (fix round 1, findings 2, 3); every other family still runs on plain `s`,
  // since `sClause`'s extra marker tokens never remove anything those other families match on.
  const sClause = stripAiBuiltExempt(foldClauseEnd(codeStripped));
  return (
    hasClaim(HUMAN_CLAIM_RX, s) ||
    DENY_AI_RX.test(s) ||
    hasClaim(REAL_ROLE_RX, s) ||
    hasClaim(LICENSED_ROLE_RX, s) ||
    hasClaim(TEACHER_SELF_RX, s) ||
    NAME_SIGNOFF_RX.test(cased) ||
    NAME_ROLE_RX.test(cased) ||
    HINGLISH_SELF_RX.test(s) ||
    HINGLISH_YOUR_RX.test(s) ||
    HAAN_SACH_RX.test(s) ||
    RELATIONSHIP_RX.test(sClause) ||
    IDENTITY_SWAP_RX.test(s) ||
    hasClaim(ALIVE_CLAIM_RX, sClause) ||
    hasClaim(OTHER_AI_CLAIM_RX, cased) ||
    hasClaim(CALL_ME_PRODUCT_RX, cased) ||
    hasClaim(WRAPPER_MODEL_RX, s) ||
    hasClaim(VOICE_PROOF_RX, s) ||
    hasClaim(PERSONAL_IDENTITY_CLAIM_RX, s)
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

/** The echo rule's own trigger words (fix round 2, CI): a quoted span only counts as a student-
 * demanded identity line, never an ordinary quoted fact, when its folded text carries a first-
 * person marker (English or Hinglish/Devanagari) or one of the identity/companion words the
 * families above already use. Reused, not duplicated, where those families already name a bare
 * word (`human`, `person`, `teacher`, `real`, `girlfriend`, `boyfriend`, `love`); `alive` and
 * `friend` are added here since the families above only use them inside a longer phrase. */
const ECHO_FIRST_PERSON_WORDS = [
  "i'm",
  'im',
  'i',
  'me',
  'my',
  'mine',
  'myself',
  'main',
  'mai',
  'mera',
  'meri',
  'mere',
  'मैं',
  'मेरा',
  'मेरी',
  'मेरे',
];
const ECHO_IDENTITY_WORDS = [
  'human',
  'person',
  'teacher',
  'real',
  'alive',
  'friend',
  'girlfriend',
  'boyfriend',
  'love',
];
const ECHO_MARKER_RX = rx(
  String.raw`(?<![\p{L}])(?:` +
    [...ECHO_FIRST_PERSON_WORDS, ...ECHO_IDENTITY_WORDS].join('|') +
    String.raw`)(?![\p{L}])`,
);

/** True when a quoted span carries the echo rule's own trigger (lead decision, fix round 2): a
 * first-person marker or an identity/companion word, so a bare quoted fact never counts. */
function echoSpanIsTrigger(foldedSpan: string): boolean {
  return ECHO_MARKER_RX.test(foldedSpan);
}

/** True when `reply` echoes a span the student quoted (3+ words) that is not also in the course
 * material (lead answer 5), and the span itself carries the echo rule's own trigger word (fix
 * round 2, CI: narrows the rule to a student-demanded identity/companion line, not any quoted
 * fact). Checked on the un-stripped text: the echo rule applies inside code too (lead answer 10). */
function echoHit(reply: string, studentText: string, material: readonly string[]): boolean {
  const spans = quotedSpans(studentText);
  if (spans.length === 0) return false;
  const foldedReply = fold(reply);
  const foldedMaterial = material.map(fold);
  return spans.some((span) => {
    const f = fold(span);
    if (!echoSpanIsTrigger(f)) return false;
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
