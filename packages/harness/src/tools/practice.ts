// The Practice skill's model-facing tool (task 5.6 Phase B). Wraps Phase A's pure
// `practiceItems.ts` bank/generator behind a `RegisteredTool`. See 5.6's plan, the architect's
// review (20 Oct 2026, docs/tasks/5.6/architect-adr-0010.md, decision 3) and the lead's Phase B
// brief, which overrides the plan's earlier, richer input/output shapes:
//
//   - The model passes no topic and no item ids: tool input is strict `{ level?: 1|2|3 }`.
//   - The model-visible output is exactly `{ id, kind, level, prompt, options? }` — never the
//     answer key, for a bank item or a generated one. The harness looks the key up server-side,
//     by item id, through this module's `answerKeyFor` hook. Phase C calls it right after a
//     successful `practice.next_item` call (same turn) to add the key to the stream gate,
//     postGuard and `GenerateResult.practiceAnswerKey` (Decision 1).
//   - `run` reads its scope only from `ctx.entitlement` (teacherId, allowedModuleIds). The module
//     comes from this turn's top retrieved chunk, else the active item's module, else the first
//     allowed module. The active-item tier is a hook (`activeModuleId`) that returns `undefined`
//     until Phase C's HelpState carries an active item id reachable from a turn — there is no
//     such state yet to read, so that tier is a documented no-op for now, not a guess.
import type { Tool, TurnContext } from '@edmate/contracts';
import { z } from 'zod';
import { HarnessError } from '../pipeline/errors.js';
import type { RegisteredTool } from '../pipeline/tools.js';
import {
  generatedAnswerKeyFor,
  pickItem,
  type PracticeBank,
  type PracticeItem,
  type PracticeLevel,
  type PracticeScope,
} from './practiceItems.js';

const input = z.strictObject({ level: z.literal([1, 2, 3]).exactOptional() });
const output = z.strictObject({
  id: z.string(),
  kind: z.enum(['numeric', 'mcq', 'short', 'code_output']),
  level: z.literal([1, 2, 3]),
  prompt: z.string(),
  options: z.array(z.string()).exactOptional(),
});
type PracticeOutput = z.infer<typeof output>;

/** No item fits the caller's entitlement at this level: the call fails rather than invent one. */
export class NoPracticeItemError extends HarnessError {
  override readonly name = 'NoPracticeItemError';

  constructor() {
    super('no practice item is available for this scope and level');
  }
}

/** The level when the model names none (provisional, like Phase A's Q1 generation scope). */
const DEFAULT_LEVEL: PracticeLevel = 1;

/**
 * A generated item's id carries its module in the topicId slot, as `<moduleId>:practice`
 * (`practiceItems.ts`'s `generateItem`, which always calls with that exact topicId shape). Reads
 * it back only to re-check scope here — recomputing the key stays `generatedAnswerKeyFor`'s job
 * alone, never duplicated.
 */
const GENERATED_TOPIC = /^gen:(.*):[123]:\d+[+\-*]\d+$/;
function generatedItemModuleId(itemId: string): string | undefined {
  const topicId = GENERATED_TOPIC.exec(itemId)?.[1];
  if (topicId === undefined || !topicId.endsWith(':practice')) return undefined;
  return topicId.slice(0, -':practice'.length);
}

function scopeOf(ctx: TurnContext): PracticeScope {
  return {
    teacherId: ctx.entitlement.teacherId,
    allowedModuleIds: ctx.entitlement.allowedModuleIds,
  };
}

/** `profile.mastery` (Topic id -> P(known)) is already `LearnerPracticeProfile`'s shape. */
function profileOf(ctx: TurnContext) {
  return {
    topics: Object.entries(ctx.profile.mastery).map(([topicId, m]) => ({
      topicId,
      mastery: m.p,
    })),
  };
}

/**
 * The module a turn's item should come from (architect review, "Scope from the entitlement"):
 * the top retrieved chunk, else the active item's module (`activeModuleId`, absent today), else
 * the first allowed module. Never the model's choice.
 */
function preferredModule(
  ctx: TurnContext,
  scope: PracticeScope,
  activeModuleId?: (ctx: TurnContext) => string | undefined,
): string | undefined {
  const allowed = new Set(scope.allowedModuleIds);
  const topChunk = ctx.retrieved[0]?.moduleId;
  if (topChunk !== undefined && allowed.has(topChunk)) return topChunk;
  const active = activeModuleId?.(ctx);
  if (active !== undefined && allowed.has(active)) return active;
  return scope.allowedModuleIds[0];
}

function toOutput(item: PracticeItem): PracticeOutput {
  return {
    id: item.id,
    kind: item.kind,
    level: item.level,
    prompt: item.prompt,
    ...(item.options === undefined ? {} : { options: [...item.options] }),
  };
}

export interface PracticeToolOptions {
  /**
   * Phase C's hook for the ladder's active item (once HelpState records one): its module, for
   * the middle fallback tier. Defaults to "none" — Phase B alone has no active-item state to
   * read.
   */
  activeModuleId?(ctx: TurnContext): string | undefined;
}

export interface PracticeRegisteredTool extends RegisteredTool {
  /**
   * The server-side answer-key lookup (architect review, Phase B, CRITICAL): never part of the
   * tool's own output. Phase C calls this right after a successful `practice.next_item` call,
   * with the same scope the call used, to add the key to the stream gate, postGuard and
   * `GenerateResult.practiceAnswerKey`. `undefined` when `itemId` is not one this bank/generator
   * can serve inside `scope` (fail closed: no key, nothing gets added).
   */
  answerKeyFor(itemId: string, scope: PracticeScope): readonly string[] | undefined;
}

/**
 * `practice.next_item`: picks the next item inside the caller's entitlement (Decision 1,
 * architect review decision 3). Never offers a topic or an item id to the model; never includes
 * the answer key in its output.
 */
export function practiceNextItemTool(
  bank: PracticeBank,
  opts: PracticeToolOptions = {},
): PracticeRegisteredTool {
  const tool: Tool<z.infer<typeof input>, PracticeOutput> = {
    name: 'practice.next_item',
    skill: 'practice',
    description:
      'Returns the next practice item for the student: its prompt, kind and, for an mcq, its ' +
      'options. Never includes the answer. Call this for every new practice problem; never ' +
      'write one yourself.',
    input,
    output,
    run: (args, ctx) => {
      const scope = scopeOf(ctx);
      const module = preferredModule(ctx, scope, opts.activeModuleId);
      const narrowed: PracticeScope =
        module === undefined ? scope : { ...scope, allowedModuleIds: [module] };
      const level = args.level ?? DEFAULT_LEVEL;
      const picked = pickItem(bank, narrowed, level, [], profileOf(ctx));
      if (picked === undefined) return Promise.reject(new NoPracticeItemError());
      return Promise.resolve(toOutput(picked.item));
    },
  };
  return {
    tool: tool as Tool<unknown, unknown>,
    present: (out) => ({ skill: 'practice', payload: out }),
    answerKeyFor(itemId, scope) {
      const fromBank = bank.answerKeyFor(itemId, scope);
      if (fromBank !== undefined) return fromBank;
      const moduleId = generatedItemModuleId(itemId);
      if (moduleId === undefined || !scope.allowedModuleIds.includes(moduleId)) return undefined;
      return generatedAnswerKeyFor(itemId);
    },
  };
}
