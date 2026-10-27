// The Practice skill's item model, bank interface and deterministic generator (task 5.6 Phase A).
// Pure logic only: no pipeline wiring, no registry, no tool. See 5.6's plan, Decision 1 and Q1/Q2,
// and the architect's Phase A review (20 Oct 2026, see the handoff's "Deviations" section):
//
//   1. Scoped reads: every bank read takes a `PracticeScope` (`{ teacherId, allowedModuleIds }`,
//      the same shape as `TurnContext.entitlement`'s scope fields) and returns only items whose
//      `moduleId` is in it and whose `teacherId` is the scope's (5.6c). `answerKeyFor` re-checks
//      the scope before returning a key.
//   2. The model chooses no topic and no item id: `PracticeBank.pick` picks the topic itself
//      (lowest mastery first if a `LearnerPracticeProfile` is given, else the bank's own order —
//      "outline order" once 6.1/5.11 exist; today the fixture's own array order).
//   3. The answer key is never part of the model-visible item shape. `PracticeItem` has no
//      `answerKey` field; a key is obtained only through `PracticeBank.answerKeyFor` (bank items)
//      or `generatedAnswerKeyFor` (generated items, recomputed from the item id).
//   4. `mcq` and `code_output` are served (5.6b Phase C): the pipeline passes the active item's
//      context to the stream gate and the post guards, so a re-show of the item is exempt while
//      a real leak of its key (a label, the correct option's text, its output) is still held.
//
// 5.6b Phase B: `validateItem` enforces the item rules (an MCQ has 3-6 options labelled "A) ",
// "B) ", ... in order and one bare capital label key in range; prompts and options are capped;
// label keys are checked with the label matcher; an MCQ's correct option text and position stay
// out of its prompt). `PracticeBank.itemFor` and `generatedPrompt` let the harness rebuild the
// active item each turn (its prompt and options are never stored in HelpState).
import { evaluateExpression } from './sandbox.js';
import type { TopicMap } from '../memory/topicMap.js';
import { PRACTICE_ID_MAX } from '../pedagogy/helpState.js';
import { compileAnswerKeys, normaliseForMatch } from '../pipeline/generate/answerKey.js';
import { contextAnswerKeys } from '../pipeline/generate/answerKeyContext.js';
import { type ItemContext, optionText } from '../pipeline/generate/itemContext.js';
import {
  foldLabels,
  labelLeaks,
  labelOf,
  NO_ITEM_SCOPE,
  positionLeaks,
} from '../pipeline/generate/labelKeys.js';

/** Longest prompt an item may have (5.6b): bounds the stream gate's re-show hold-back. */
export const PRACTICE_PROMPT_MAX = 600;
/** Longest option an item may have (5.6b), for the same reason. */
export const PRACTICE_OPTION_MAX = 160;
/** An MCQ has 3 to 6 options (5.6b, Q1). */
export const MCQ_OPTIONS_MIN = 3;
export const MCQ_OPTIONS_MAX = 6;

/** Difficulty tier (distinct from the help-ladder rung in `pedagogy/ladder.ts`). */
export type PracticeLevel = 1 | 2 | 3;

/**
 * `code_output`: the printed output legitimately appears in the question text itself ("what does
 * this print?") — the 19 Oct decision's exception, the only kind `validateItem` exempts from the
 * no-key-in-prompt check (Q2). Neither `mcq` nor `code_output` is served today (point 4 above).
 */
export type PracticeItemKind = 'numeric' | 'mcq' | 'short' | 'code_output';

/** Kinds a `PracticeBank` may serve (architect review point 4; mcq and code_output since 5.6b). */
export const SERVABLE_KINDS: ReadonlySet<PracticeItemKind> = new Set([
  'numeric',
  'short',
  'mcq',
  'code_output',
]);

/** The model-visible item shape: never the answer key (architect review point 3). */
export interface PracticeItem {
  readonly id: string;
  /**
   * The teacher whose content this is (5.6c): an item is served only inside its own teacher's
   * scope. Harness-internal: the tool's output never copies it.
   */
  readonly teacherId: string;
  /** An opaque string, echoed unchanged; 5.6 does not validate it against a real outline (Q4). */
  readonly topicId: string;
  /** The module this item belongs to, for entitlement scoping (architect review point 1). */
  readonly moduleId: string;
  readonly level: PracticeLevel;
  readonly kind: PracticeItemKind;
  readonly prompt: string;
  /** Shown to the model/student regardless of kind (MCQ options, for instance). */
  readonly options?: readonly string[];
  /**
   * A content-author-set candidate mistake tag (6.3c), like `topicId`: never a classifier
   * output. `classifyMistakeTags` splits it into `known`/`proposed` against the style card's
   * `mistakeTags` once the item is graded wrong.
   */
  readonly mistakeTag?: string;
}

/** An item plus its server-only answer key, returned together only on the server side. */
export interface PickedPracticeItem {
  readonly item: PracticeItem;
  readonly answerKey: readonly string[];
}

/**
 * The entitlement scope a bank read must stay inside: the same `{ teacherId, allowedModuleIds }`
 * shape as `TurnContext.entitlement` (harness-internal here, not a `@edmate/contracts` import —
 * Decision 1 keeps `PracticeBank` out of `@edmate/contracts`).
 */
export interface PracticeScope {
  readonly teacherId: string;
  readonly allowedModuleIds: readonly string[];
}

/** One topic's mastery (lower = weaker); untracked topics are treated as the weakest. */
export interface TopicMastery {
  readonly topicId: string;
  readonly mastery: number;
}

export interface LearnerPracticeProfile {
  readonly topics: readonly TopicMastery[];
}

/** A harness-internal item source (Decision 1): never a `@edmate/contracts` port. */
export interface PracticeBank {
  /**
   * Picks the next item inside `scope`: the bank chooses which topic (lowest mastery first if
   * `profile` is given, else its own order), never the caller. Never returns an item whose
   * `moduleId` is outside `scope.allowedModuleIds`, whose `teacherId` is not `scope.teacherId`
   * (5.6c), or whose kind is not in `SERVABLE_KINDS`.
   */
  pick(
    scope: PracticeScope,
    level: PracticeLevel,
    exclude: readonly string[],
    profile?: LearnerPracticeProfile,
  ): PracticeItem | undefined;
  /** The server-only answer key for an item this bank can serve, re-checked against `scope`. */
  answerKeyFor(itemId: string, scope: PracticeScope): readonly string[] | undefined;
  /**
   * The item itself (prompt, options), scoped exactly like `answerKeyFor` (5.6b): the harness
   * rebuilds the active item each turn to exempt its re-show. `undefined` outside `scope`.
   */
  itemFor(itemId: string, scope: PracticeScope): PracticeItem | undefined;
}

/**
 * A caller's extra filter on an item and its server-only key (the practice tool: no earlier key
 * in its prompt, and, 5.6a, its own key in none of the turn's retrieved chunks).
 */
export type AcceptItem = (item: PracticeItem, answerKey: readonly string[]) => boolean;

/** Most bank picks `pickItem` tries before falling back to the generator. */
export const BANK_TRIES = 20;
/** Most generator variants `generateItem` tries before failing closed. */
export const GEN_VARIANTS = 64;

/**
 * Whether an item may be served (5.6 review): a servable kind, inside `scope` (its module and, 5.6c,
 * its teacher, checked here too in case a bank ignores the teacher), an id short enough
 * for HelpState, not excluded, its key passes `validateItem` and the caller accepts it. When
 * `topicMap` is given (6.1a Q1), the item's `topicId` must also exist in it under the item's own
 * `moduleId` — an unknown or module-mismatched topic id is not servable.
 */
function servable(
  picked: PickedPracticeItem,
  scope: PracticeScope,
  exclude: readonly string[],
  accept: AcceptItem,
  topicMap?: TopicMap,
): boolean {
  const { item, answerKey } = picked;
  return (
    SERVABLE_KINDS.has(item.kind) &&
    item.teacherId === scope.teacherId &&
    scope.allowedModuleIds.includes(item.moduleId) &&
    item.id.length <= PRACTICE_ID_MAX &&
    !exclude.includes(item.id) &&
    (topicMap === undefined || topicMap.getTopic(item.topicId)?.moduleId === item.moduleId) &&
    validateItem(item, answerKey) &&
    accept(item, answerKey)
  );
}

/**
 * Picks an item inside `scope`: the bank first (teacher content), then the generator, which uses
 * the first allowed module as a placeholder topic (no real outline yet, Q4). Every item is checked
 * at runtime (`servable`): a bank item that fails is skipped and the bank asked again (at most
 * BANK_TRIES times), then the generator. Returns `undefined` (fail closed) when nothing is valid.
 *
 * `topicMap` (6.1a Q1, optional, last parameter): when given, gates only the bank-read loop below
 * (a bank item's `topicId` must exist in `topicMap` under its own `moduleId`) — never the
 * generator fallback, whose placeholder `${moduleId}:practice` topic id would never be in a real
 * topic map (6.1's own Q4; see the plan's Design for why).
 */
export function pickItem(
  bank: PracticeBank,
  scope: PracticeScope,
  level: PracticeLevel,
  exclude: readonly string[],
  profile?: LearnerPracticeProfile,
  accept: AcceptItem = () => true,
  topicMap?: TopicMap,
): PickedPracticeItem | undefined {
  const skipped = [...exclude];
  for (let i = 0; i < BANK_TRIES; i++) {
    const item = bank.pick(scope, level, skipped, profile);
    if (item === undefined || skipped.includes(item.id)) break;
    const answerKey = bank.answerKeyFor(item.id, scope);
    if (
      answerKey !== undefined &&
      servable({ item, answerKey }, scope, skipped, accept, topicMap)
    ) {
      return { item, answerKey };
    }
    skipped.push(item.id);
  }
  return generateItem(scope, level, exclude, accept);
}

/** A small, seeded string hash (djb2 variant): deterministic, no dependency. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** An operand in `[min, max]` derived from `seed`, advancing it for the next draw. */
function nextOperand(seed: number, min: number, max: number): { value: number; seed: number } {
  const next = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
  const span = max - min + 1;
  return { value: min + (next % span), seed: next };
}

interface Template {
  readonly op: '+' | '-' | '*';
  readonly min: number;
  readonly max: number;
}

const TEMPLATES: Record<PracticeLevel, Template> = {
  1: { op: '+', min: 1, max: 9 },
  2: { op: '-', min: 10, max: 99 },
  3: { op: '*', min: 2, max: 12 },
};

/**
 * `gen:<moduleId>:practice:<level>:<a><op><b>` — enough to recompute the answer from the id alone.
 * Operands are 1–999 with no leading zero, which covers every template (the subtraction nudge
 * included) and bounds what `evaluateExpression` is ever asked (5.6c).
 */
const GEN_ID = /^gen:(.+):([123]):([1-9]\d{0,2})([+\-*])([1-9]\d{0,2})$/;
const PRACTICE_TOPIC_SUFFIX = ':practice';

/** A generated item id, read back by `parseGeneratedId`. */
export interface GeneratedId {
  readonly topicId: string;
  readonly moduleId: string;
  readonly level: PracticeLevel;
  readonly a: number;
  readonly op: Template['op'];
  readonly b: number;
}

/**
 * The one parser for generated item ids (5.6c). `undefined` unless `id` is at most
 * PRACTICE_ID_MAX long, its operands are 1–999 with no leading zero, its op is its level's
 * template op, and its topic is `<non-empty moduleId>:practice` (the only shape `generateItem`
 * makes). A module id may itself hold `:`.
 */
export function parseGeneratedId(id: string): GeneratedId | undefined {
  if (id.length > PRACTICE_ID_MAX) return undefined;
  const m = GEN_ID.exec(id);
  if (m === null) return undefined;
  const [, topicId = '', levelText, a, op, b] = m;
  const level = Number(levelText) as PracticeLevel;
  if (op !== TEMPLATES[level].op) return undefined;
  if (!topicId.endsWith(PRACTICE_TOPIC_SUFFIX)) return undefined;
  const moduleId = topicId.slice(0, -PRACTICE_TOPIC_SUFFIX.length);
  if (moduleId === '') return undefined;
  return { topicId, moduleId, level, a: Number(a), op, b: Number(b) };
}

/**
 * Deterministic numeric/arithmetic fallback item for (topicId, level) (Q1), split from its answer
 * key (architect review point 3). The expression is evaluated through the restricted mathjs
 * sandbox (`evaluateExpression`), the same one the calculator tool uses.
 */
function generateArithmeticItem(
  teacherId: string,
  topicId: string,
  moduleId: string,
  level: PracticeLevel,
  variant: number,
): PickedPracticeItem {
  const template = TEMPLATES[level];
  // Variant 0 keeps the original seed; later variants vary the operands deterministically.
  const seed0 = hashString(
    variant === 0 ? `${topicId}:${level}` : `${topicId}:${level}:${variant}`,
  );
  const draw1 = nextOperand(seed0, template.min, template.max);
  const draw2 = nextOperand(draw1.seed, template.min, template.max);
  let a = draw1.value;
  let b = draw2.value;
  if (template.op === '-') {
    if (b > a) [a, b] = [b, a];
    // Addition (level 1) and multiplication (level 3) can never produce an answer equal to one
    // of their own operands here, since both operands are at least 1 (proved in the handoff:
    // sum === an operand would need the other to be 0; product === an operand would need the
    // other to be 1, and both templates' minimums rule that out). Subtraction can: `a - b === b`
    // exactly when `a === 2b`. A single deterministic nudge (never a retry loop) rules it out:
    // `a += 1` changes the answer (`a - b`) by +1 without touching `b`, so the two can never
    // coincide again; `a + 1` never exceeds `template.max` here, since `a === 2b <= 2 * 49 < 99`
    // whenever `b` is at most half of `template.max` (`b <= 49`, as `a <= template.max === 99`).
    if (a - b === b) a += 1;
  }
  const answer = evaluateExpression(`${a} ${template.op} ${b}`);
  return {
    item: {
      id: `gen:${topicId}:${level}:${a}${template.op}${b}`,
      teacherId,
      topicId,
      moduleId,
      level,
      kind: 'numeric',
      prompt: generatedPrompt({ topicId, moduleId, level, a, op: template.op, b }),
    },
    answerKey: [answer],
  };
}

/**
 * The scoped generator fallback: picks the first allowed module as a placeholder topic (no real
 * outline yet, Q4), or `undefined` when `scope` allows no module at all (fail closed, architect
 * review point 1 — the generator never serves outside scope either). Honours `exclude` and
 * `accept` (5.6 review): it tries up to GEN_VARIANTS deterministic variants and serves the first
 * that is servable, else `undefined` (fail closed; also when the id would pass PRACTICE_ID_MAX).
 */
export function generateItem(
  scope: PracticeScope,
  level: PracticeLevel,
  exclude: readonly string[] = [],
  accept: AcceptItem = () => true,
): PickedPracticeItem | undefined {
  const moduleId = scope.allowedModuleIds[0];
  if (moduleId === undefined) return undefined;
  for (let v = 0; v < GEN_VARIANTS; v++) {
    const picked = generateArithmeticItem(
      scope.teacherId,
      `${moduleId}${PRACTICE_TOPIC_SUFFIX}`,
      moduleId,
      level,
      v,
    );
    if (servable(picked, scope, exclude, accept)) return picked;
  }
  return undefined;
}

/** A generated item's prompt, rebuilt from its id (5.6b): the one source `generateItem` uses too. */
export function generatedPrompt(g: GeneratedId): string {
  return `What is ${String(g.a)} ${g.op} ${String(g.b)}?`;
}

/**
 * Recomputes a generated item's answer key from its id alone (architect review point 3: "the
 * answer key can be recomputed on the server from the id"), or `undefined` for an id this
 * generator did not produce. `parseGeneratedId` only passes operands of 1–999 and one of `+ - *`,
 * so `evaluateExpression` here gets a small, bounded integer expression and cannot throw (no
 * retry/catch needed, and none left uncovered).
 */
export function generatedAnswerKeyFor(itemId: string): readonly string[] | undefined {
  const g = parseGeneratedId(itemId);
  if (g === undefined) return undefined;
  return [evaluateExpression(`${String(g.a)} ${g.op} ${String(g.b)}`)];
}

/**
 * Whether `key` occurs in `prompt` as a whole word or number — not embedded in a larger run of
 * letters, digits or underscores (so a single-digit key like "7" never matches inside "37", the
 * same guarantee `answerKey.ts`'s own matcher gives for numbers) — case-insensitively. A light,
 * Phase-A-local check: the full `answerKey.ts` matcher (NFKC, scripts, number words, arithmetic
 * grounding) is what the real do-not-say gate uses later; this only needs to keep a generated or
 * authored item's own prompt honest about its own key.
 */
function keyInPrompt(prompt: string, key: string): boolean {
  // Callers only ever reach here with a key `validateItem` has already proven non-blank (its own
  // `normaliseForMatch(k) === ''` check rejects every all-punctuation/whitespace form first), so
  // there is no separate blank guard to leave untested here.
  const k = key.trim();
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(prompt);
}

/**
 * Rejects an item/key pair whose `answerKey` is empty, or whose only forms normalise to nothing
 * (an all-punctuation/whitespace form the existing `answerKey.ts` matcher, built on the same
 * `normaliseForMatch`, could never catch), or whose key appears verbatim inside its own prompt
 * text — unless the item is `code_output` (Q2's exception; the full-turn leak proof in Phase C
 * still runs the shared, kind-unaware `answerKey.ts` matcher over model-visible context, so this
 * exemption lives only here, not in the shared matcher — architect review point 4). For `mcq`, a
 * "bare" key equal to one of the option's own visible texts (rather than an opaque id) is also
 * rejected: the option text is shown regardless of kind, so the key must never be indistinguishable
 * from it (architect review point 4).
 *
 * 5.6c: for every kind, a key in any option is rejected too (options are shown), and so is a key in
 * the item id (the model sees the id), except a short whole number written in digits: ids hold the
 * level digit and generated operands, so "1" must not reject `demo:fractions:1:a`. Number words
 * ("one") are still checked against the id.
 */
export function validateItem(item: PracticeItem, answerKey: readonly string[]): boolean {
  if (answerKey.length === 0) return false;
  if (answerKey.some((k) => normaliseForMatch(k) === '' || k.trim() === '')) return false;
  const options = item.options ?? [];
  if (item.prompt.length > PRACTICE_PROMPT_MAX) return false;
  if (options.some((o) => o.length > PRACTICE_OPTION_MAX)) return false;
  if (item.kind === 'mcq') return validMcq(item.id, item.prompt, options, answerKey);
  if (answerKey.some((k) => options.some((o) => keyShown(o, k)))) return false;
  const exempt = new Set(answerKey.filter((k) => /^\s*\d+\s*$/.test(k)));
  for (const k of contextAnswerKeys([...exempt])) exempt.delete(k);
  if (answerKey.some((k) => !exempt.has(k) && keyInId(item.id, k))) return false;
  if (item.kind === 'code_output') return true;
  return !answerKey.some((k) => keyShown(item.prompt, k));
}

/** Whether `text` shows `key`: the label matcher for a label key (5.6b), else `keyInPrompt`. */
function keyShown(text: string, key: string): boolean {
  return labelOf(key) === undefined ? keyInPrompt(text, key) : compileAnswerKeys([key]).leaks(text);
}

/**
 * Whether an item id names `key`. A label counts in an id only in an answer context or as the
 * whole id, as in decoded base64 (5.6b): ids end in a variant letter ("demo:algebra:3:a").
 */
function keyInId(id: string, key: string): boolean {
  const label = labelOf(key);
  if (label === undefined) return keyInPrompt(id, key);
  return labelLeaks(foldLabels(id), label, NO_ITEM_SCOPE, true);
}

/**
 * The MCQ item rules (5.6b, Q1): 3-6 options, each "A) text", "B) text", ... in order; the key is
 * exactly one bare capital label in range. The key is checked in the prompt and every option text
 * with the label matcher (the item's own labels as the list scope) and in the id as `keyInId`
 * does. The correct option's text (full strength, like any `mustNotReveal` key) and its position
 * must not appear in the prompt.
 */
function validMcq(
  id: string,
  prompt: string,
  options: readonly string[],
  answerKey: readonly string[],
): boolean {
  if (options.length < MCQ_OPTIONS_MIN || options.length > MCQ_OPTIONS_MAX) return false;
  const labelled = (o: string, k: number) =>
    o.startsWith(`${String.fromCharCode(0x41 + k)}) `) && optionText(o) !== '';
  if (!options.every(labelled)) return false;
  if (answerKey.length !== 1) return false;
  const key = answerKey[0] as string;
  if (!/^[A-Z]$/u.test(key)) return false;
  const index = key.charCodeAt(0) - 0x41;
  if (index >= options.length) return false;
  const listing: ItemContext = { prompt: '', options, answerKey: [] };
  const label = compileAnswerKeys([key], { items: [listing] });
  if (label.leaks(prompt) || options.some((o) => label.leaks(optionText(o)))) return false;
  if (keyInId(id, key)) return false;
  const correct = optionText(options[index] as string);
  return !compileAnswerKeys([correct]).leaks(prompt) && !positionLeaks(prompt, index);
}
