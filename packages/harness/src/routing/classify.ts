// route's rules (task 3.3): intent and `attempt` from the scrubbed text, pure and model-free.
//
// - Intent: fixed phrase rules in priority order (distress, misuse, answer_seeking, meta,
//   off_topic, on_task). A hit is confident; nothing hitting is not, and only then does route ask
//   the small model (modelFallback.ts). off_topic, misuse and meta make decide redirect, so their
//   rules are narrow on purpose: a missed one costs a model call, a false one a redirect.
// - Distress: a hard keyword phrase (the same tables as the runner's last-resort check) is
//   `distress`. A soft phrase alone is not confident: preGuard's classifier already judges soft
//   hits (4.3), so route asks its own model rather than escalate every bare "suicide" in a lesson.
// - Attempt: never through a model. correct / partial only against the session's stored answer
//   key; with no readable key, answer-shaped text is `wrong` (an attempt that cannot be credited)
//   and anything else `none`. Each key item is one required part of the answer.
import type { Attempt, Intent, TurnInput } from '@edmate/contracts';
import { distressKeywordLevel } from '../guardrails/distressKeywords.js';
import { parseSessionHelp } from '../pedagogy/helpState.js';

export interface RuleIntent {
  intent: Intent;
  /** False: no rule hit, so route may ask the model. `intent` is then the default, `on_task`. */
  confident: boolean;
}

type Kind = TurnInput['kind'];

/** Lower case, NFKC, straight apostrophes, ASCII minus, single spaces. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/gu, "'")
    .replace(/[−‒–]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** A phrase not inside a longer word. */
const words = (src: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'u');

const WORK = '(?:homework|assignment|essay|project|coursework|report)';
const MISUSE: readonly RegExp[] = [
  words(
    `(?:^|please |pls |just |and |then |can you |could you |will you |would you |u )` +
      `(?:do|write|finish|complete) (?:my|this|the) (?:whole )?${WORK}`,
  ),
  words(`(?:do|write|finish|complete) (?:my|this|the) (?:whole )?${WORK} for me`),
  words('(?:take|sit|write|do) (?:my|the) (?:exam|test|quiz) for me'),
  words(
    'ignore (?:all |your |the |any )?(?:previous |prior |above |earlier )?(?:instructions|rules|prompt)',
  ),
  words('act as dan|developer mode|jailbreak mode'),
  // Romanised Hindi safety net (pilot scope: English, Hindi only where routing feeds safety).
  words(`(?:mera |meri |mere )?${WORK} (?:kar|likh|bana) (?:do|de|dena)`),
  words('mere liye (?:likh|kar|bana) (?:do|de|dena)'),
];

const ANSWER_SEEKING: readonly RegExp[] = [
  words(
    '(?:tell|give|show|send) me (?:the |your )?(?:final |full |whole |correct |right )?(?:answers?|solutions?)',
  ),
  words("what(?:'s| is) the (?:final |correct |right )?answer"),
  words(
    "skip (?:the )?hints?|no (?:more )?hints|(?:don't|dont|do not) want (?:any )?(?:more )?hints",
  ),
  words('(?:show|give) (?:me )?the (?:full |whole |complete )?(?:solution|working)'),
  words('solve (?:it|this|that)(?: question| problem| one)? for me'),
  words('answer (?:bata|batao|de) ?(?:do|de|dijiye)?'),
];

const META: readonly RegExp[] = [
  words('are you (?:an? )?(?:real )?(?:ai|bot|robot|chatbot|human|person|chatgpt|gpt|machine)'),
  words('are you real'),
  words('who (?:made|built|created|programmed|trained|owns) you'),
  words('how do you work'),
  words('what (?:ai |language )?model are you'),
  words('what can you do'),
  words('do you remember'),
  words('who are you|what are you'),
  words('are you (?:recording|saving|storing)|is this (?:chat )?(?:private|recorded)'),
];

const OFF_TOPIC: readonly RegExp[] = [
  words('tell me a (?:joke|story)'),
  words(
    'favou?rite (?:movie|film|song|singer|band|food|colou?r|game|show|actor|actress|team|player)',
  ),
  words('who (?:will|is going to) win'),
  words('(?:cricket|football|ipl|match) score'),
  words("what(?:'s| is) the weather|weather (?:today|tomorrow|like)"),
  words('talk about something else'),
  words("how are you(?: doing)?|what's up|wassup"),
  words('(?:are you|r u) (?:single|married)|do you have a (?:girlfriend|boyfriend)'),
];

const ON_TASK: readonly RegExp[] = [
  words(
    'why|explain|example|examples|define|definition|meaning of|difference between|understand|' +
      'stuck|confused|confusing|hint|clue|formula|equation|step|steps|exercise|practice|quiz|' +
      'chapter|lesson|concept|solve|calculate|derive|prove|help me|teach me|show me how',
  ),
  words('(?:question|problem|exercise|q) ?\\d+'),
  words('how (?:do|does|can|to|is|are|would|should|did) (?:i|we|you|it|this|that|the|a|an|my)'),
  words('what (?:is|are|does|do) (?:a|an|the)'),
  words('can you (?:explain|help|check|show)|check my|did i'),
  words('is (?:it|this|that) (?:right|correct)'),
];

const ACK =
  /^(?:ok|okay|k|yes|yeah|yep|no|nope|sure|thanks?|thank you|thx|ty|got it|i see|cool|great|nice|next|continue|go on|hi|hello|hey|good (?:morning|afternoon|evening)|bye)[!. ]*$/u;

const hit = (res: readonly RegExp[], t: string): boolean => res.some((re) => re.test(t));

/** Intent by rules alone. `text` is the scrubbed input text. */
export function classifyIntentByRules(text: string | undefined, kind: Kind): RuleIntent {
  const t = normaliseText(text ?? '');
  const level = t === '' ? 'none' : distressKeywordLevel(t);
  if (level === 'hard') return { intent: 'distress', confident: true };
  // Hint requests, answer checks and skill actions are lesson turns by construction.
  if (kind !== 'message' || t === '') return { intent: 'on_task', confident: true };
  if (level === 'soft') return { intent: 'on_task', confident: false };
  if (hit(MISUSE, t)) return { intent: 'misuse', confident: true };
  if (hit(ANSWER_SEEKING, t)) return { intent: 'answer_seeking', confident: true };
  if (hit(META, t)) return { intent: 'meta', confident: true };
  if (hit(OFF_TOPIC, t)) return { intent: 'off_topic', confident: true };
  if (hit(ON_TASK, t) || isAnswerShaped(t, kind) || ACK.test(t)) {
    return { intent: 'on_task', confident: true };
  }
  return { intent: 'on_task', confident: false };
}

/** Words that make a short reply a request or a feeling, not an answer. */
const NOT_ANSWER = new Set([
  'i',
  "i'm",
  'im',
  'can',
  'could',
  'what',
  "what's",
  'why',
  'how',
  'when',
  'where',
  'who',
  'which',
  'please',
  'pls',
  'just',
  'tell',
  'give',
  'show',
  'explain',
  'help',
  'hint',
  'stuck',
  'confused',
  'lost',
  'hard',
  'easy',
  'confusing',
  'difficult',
  'boring',
  'fine',
  'done',
  'too',
  'very',
  'really',
  'not',
  'right',
  'correct',
  'wrong',
  'this',
  'that',
  'it',
  'impossible',
  'nothing',
  'idea',
  'answer',
  'solution',
  'again',
  'more',
]);

const LEAD_IN = new RegExp(
  "^(?:so |then |ok |okay |hmm |um )?(?:i (?:got|get|have|found|think (?:it's|its|it is|the answer is)?)|" +
    "(?:the |my )?(?:final )?answer (?:is|=|:)|is it|is the answer|it's|its|it is|it should be|" +
    'it equals|equals?|=) ?(.+)$',
  'u',
);

const splitWords = (t: string): string[] =>
  t
    .replace(/[?!.,;:]+/gu, ' ')
    .split(' ')
    .filter((w) => w !== '');

/** A short reply that names something (no request or feeling words). */
function namesSomething(t: string, maxWords: number): boolean {
  const ws = splitWords(t);
  return ws.length > 0 && ws.length <= maxWords && !ws.some((w) => NOT_ANSWER.has(w));
}

/** Digits, operators and single-letter variables only ("x = 4", "3x + 2 = 11", "5/6"). */
function mathOnly(t: string): boolean {
  const body = t.replace(/^(?:so|then) /u, '');
  return (
    /\d/u.test(body) &&
    /^[\d\s.,/+\-*×÷^()=<>√π%a-z]+$/u.test(body) &&
    (body.match(/\p{L}+/gu) ?? []).every((w) => w.length === 1)
  );
}

/** The text offers an answer: a code block, a bare expression, "I got ...", or a short answer. */
export function isAnswerShaped(text: string, kind: Kind): boolean {
  const t = normaliseText(text);
  if (t === '') return false;
  if (kind === 'check_answer') return true;
  if (t.includes('```')) return true;
  if (mathOnly(t)) return true;
  if (ACK.test(t)) return false;
  const lead = LEAD_IN.exec(t);
  if (lead !== null) {
    const rest = lead[1] ?? '';
    return /\d/u.test(rest) || namesSomething(rest, 4);
  }
  return !t.includes('?') && namesSomething(t, 3);
}

/** The session's stored answer key, blank parts dropped; empty when unreadable or absent. */
export function answerKeyOf(helpState: unknown): string[] {
  return parseSessionHelp(helpState)
    .help.answerKey.map((k) => normaliseText(k))
    .filter((k) => k !== '');
}

const NUMBER = /(?:(?<![\d)\p{L}]\s*)-\s*)?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?/gu;
const FULL_NUMBER = /^(?:-\s*)?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?$/u;

interface Num {
  value: number;
  /** Decimal places the student wrote (0 for a whole number or a fraction). */
  places: number;
}

function toNum(src: string): Num | undefined {
  const s = src.replace(/\s+/gu, '');
  const [a = '', b] = s.split('/');
  const num = Number(a);
  const den = b === undefined ? 1 : Number(b);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined;
  const places = b === undefined ? (a.split('.')[1]?.length ?? 0) : 0;
  return { value: num / den, places };
}

/** Thousands separators out ("1,000" → "1000"); "2, 3" is a list, kept. */
const dropThousands = (t: string): string =>
  t.replace(/\d{1,3}(?:,\d{3})+(?![\d.])/gu, (m) => m.replace(/,/gu, ''));

function numbersIn(t: string): Num[] {
  return [...dropThousands(t).matchAll(NUMBER)]
    .map((m) => toNum(m[0]))
    .filter((n): n is Num => n !== undefined);
}

function sameNumber(student: Num, key: number): boolean {
  if (Math.abs(student.value - key) <= 1e-9 * Math.max(1, Math.abs(key))) return true;
  // A rounded decimal (two places or more) counts: 0.83 for 5/6.
  return (
    student.places >= 2 && Math.abs(student.value - key) <= 0.5 * 10 ** -student.places + 1e-12
  );
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** A label key part ("b", "(b)", "b)"), after normaliseText: its letter. */
const LABEL_PART = /^\(?([a-z])\)?$/u;
/** A letter standing as a word, and the word after it (if only spaces sit between them). */
const LETTER_WORD = /(?<![\p{L}\p{N}'])([a-z])(?![\p{L}\p{N}'])(?=(?: ([\p{L}\p{N}']+))?)/gu;
/** Words after an "a" that never make it an article: separators and the labels A-F. */
const NOT_ORDINARY = new Set(['or', 'and', 'nor', 'a', 'b', 'c', 'd', 'e', 'f']);

/**
 * The distinct labels (A-F) a message names (5.6b, design 5). A lowercase "a" before an ordinary
 * word is the article, not a label, unless it starts the message ("A because it loops").
 */
function labelsNamed(t: string): Set<string> {
  const out = new Set<string>();
  for (const m of t.matchAll(LETTER_WORD)) {
    const letter = m[1] as string;
    if (letter > 'f') continue;
    const next = m[2];
    const article = letter === 'a' && m.index > 0 && next !== undefined && !NOT_ORDINARY.has(next);
    if (!article) out.add(letter);
  }
  return out;
}

/**
 * `usedNums` holds the indices into `nums` already credited to an earlier key part (3.3a review:
 * a duplicate part, e.g. `['3', '3']`, must not let one student number match twice).
 */
function partMatched(
  t: string,
  nums: readonly Num[],
  part: string,
  usedNums: Set<number>,
): boolean {
  const label = LABEL_PART.exec(part)?.[1];
  if (label !== undefined) {
    // A label answer counts only when it is the one label the message names.
    const named = labelsNamed(t);
    return named.size === 1 && named.has(label);
  }
  const bare = part.replace(/^[a-z] ?= ?/u, '').replace(/[.!]+$/u, '');
  if (FULL_NUMBER.test(dropThousands(bare))) {
    const key = toNum(dropThousands(bare));
    if (key === undefined) return false;
    const idx = nums.findIndex((n, i) => !usedNums.has(i) && sameNumber(n, key.value));
    if (idx === -1) return false;
    usedNums.add(idx);
    return true;
  }
  return words(escapeRe(bare)).test(t);
}

/** `attempt` by rules alone. `helpState` is `Entitled.helpState`, raw. */
export function classifyAttempt(
  input: { text?: string | undefined; kind: Kind },
  helpState: unknown,
): Attempt {
  if (input.kind === 'skill_action') return 'none';
  const t = normaliseText(input.text ?? '');
  if (!isAnswerShaped(t, input.kind)) return 'none';
  const key = answerKeyOf(helpState);
  if (key.length === 0) return 'wrong';
  const nums = numbersIn(t);
  const usedNums = new Set<number>();
  const matched = key.filter((part) => partMatched(t, nums, part, usedNums)).length;
  if (matched === key.length) return 'correct';
  return matched > 0 ? 'partial' : 'wrong';
}
