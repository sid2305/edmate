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
//     allowed module. Phase C: generate binds each turn's copy to the session's practice state
//     (`forSession`: the active item's module and the served ids, kept in HelpState), and looks
//     each issued item's key up through `issuedItem` the moment the tool returns.
import type { Tool, TurnContext } from '@edmate/contracts';
import { z } from 'zod';
import { PRACTICE_ID_MAX, PRACTICE_KEYS_MAX_JSON } from '../pedagogy/helpState.js';
import { HarnessError } from '../pipeline/errors.js';
import { compileAnswerKeys, revealsAnswerKey } from '../pipeline/generate/answerKey.js';
import { chunkLeaks, contextAnswerKeys } from '../pipeline/generate/answerKeyContext.js';
import {
  type ItemContext,
  issueCheckContext,
  itemContextOf,
} from '../pipeline/generate/itemContext.js';
import type { IssuedItem, RegisteredTool, ToolSessionState } from '../pipeline/tools.js';
import {
  generatedAnswerKeyFor,
  generatedPrompt,
  parseGeneratedId,
  pickItem,
  type PracticeBank,
  type PracticeItem,
  type PracticeLevel,
  type PracticeScope,
} from './practiceItems.js';

const input = z.strictObject({ level: z.literal([1, 2, 3]).exactOptional() });
const output = z.strictObject({
  id: z.string().max(PRACTICE_ID_MAX),
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
  /** Item ids the bank should not serve again (the session's served list, 5.6 Phase C). */
  exclude?: readonly string[];
  /** Keys held this attempt, read live: no item showing one is served (5.6 review). */
  heldKeys?: readonly string[];
  /** Keys issued this turn so far, read live: the union with a new item's key is capped. */
  issuedKeys?: readonly string[];
}

/** The text an item shows: its prompt and options (the answer-key checks read only this). */
function shownText(item: Pick<PracticeItem, 'prompt' | 'options'>): string[] {
  return [item.prompt, ...(item.options ?? [])];
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
  forSession(s: ToolSessionState): PracticeRegisteredTool;
  activeItem(itemId: string, ctx: TurnContext): ItemContext | undefined;
  issuedItem(output: unknown, ctx: TurnContext): IssuedItem | undefined;
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
      const held = opts.heldKeys ?? [];
      // 5.6a: the turn's chunks are already in the model's context, so an item whose own key
      // (short numbers aside, contextAnswerKeys) shows in any of them is refused too.
      // 5.6b: the item's shown text is checked as one joined text with its own listing exempt
      // (an MCQ after an MCQ with the same key is served), as toolLoop and skillEvent do.
      const accept = (item: PracticeItem, answerKey: readonly string[]) => {
        const shown = shownText(item);
        const items = [issueCheckContext({ shown, answerKey })];
        if (revealsAnswerKey(shown.join('\n'), held, { items })) return false;
        const m = compileAnswerKeys(contextAnswerKeys(answerKey));
        return m.empty || !ctx.retrieved.some((c) => chunkLeaks(c, m));
      };
      const picked = pickItem(bank, narrowed, level, opts.exclude ?? [], profileOf(ctx), accept);
      if (picked === undefined) return Promise.reject(new NoPracticeItemError());
      return Promise.resolve(toOutput(picked.item));
    },
  };
  const answerKeyFor = (itemId: string, scope: PracticeScope): readonly string[] | undefined => {
    const fromBank = bank.answerKeyFor(itemId, scope);
    if (fromBank !== undefined) return fromBank;
    const moduleId = parseGeneratedId(itemId)?.moduleId;
    if (moduleId === undefined || !scope.allowedModuleIds.includes(moduleId)) return undefined;
    return generatedAnswerKeyFor(itemId);
  };
  // 5.6b: the active item, rebuilt inside the turn's entitlement: the bank first, then the
  // generator (its prompt and key recomputed from the id). Outside scope: undefined.
  const activeItem = (itemId: string, ctx: TurnContext): ItemContext | undefined => {
    const scope = scopeOf(ctx);
    const item = bank.itemFor(itemId, scope);
    if (item !== undefined) {
      const answerKey = bank.answerKeyFor(itemId, scope);
      if (answerKey === undefined || answerKey.length === 0) return undefined;
      return itemContextOf({ shown: shownText(item), answerKey });
    }
    const g = parseGeneratedId(itemId);
    if (g === undefined || !scope.allowedModuleIds.includes(g.moduleId)) return undefined;
    // A parsed id always has a key (generatedAnswerKeyFor parses the same id).
    const answerKey = generatedAnswerKeyFor(itemId) as readonly string[];
    return { prompt: generatedPrompt(g), answerKey: [...answerKey] };
  };
  return {
    tool: tool as Tool<unknown, unknown>,
    present: (out) => ({ skill: 'practice', payload: out }),
    answerKeyFor,
    activeItem,
    forSession: (s) =>
      practiceNextItemTool(bank, {
        exclude: s.servedItemIds,
        activeModuleId: (ctx) => s.activeModuleId ?? opts.activeModuleId?.(ctx),
        ...(s.heldKeys === undefined ? {} : { heldKeys: s.heldKeys }),
        ...(s.issuedKeys === undefined ? {} : { issuedKeys: s.issuedKeys }),
      }),
    // The key is looked up on the server by item id, inside the turn's entitlement (ADR-0010 §3);
    // the module is the one allowed module the id resolves in (exactly one, 5.6c). Fails closed
    // (undefined) when the ids, or the held keys plus the turn's issued keys plus this key (5.6c,
    // so a carried key always fits), would not fit the saved HelpState (5.6 review).
    issuedItem(out, ctx) {
      const parsed = output.safeParse(out);
      if (!parsed.success) return undefined;
      const itemId = parsed.data.id;
      const scope = scopeOf(ctx);
      const answerKey = answerKeyFor(itemId, scope);
      if (answerKey === undefined || answerKey.length === 0) return undefined;
      const modules = [...new Set(scope.allowedModuleIds)].filter(
        (m) => answerKeyFor(itemId, { ...scope, allowedModuleIds: [m] }) !== undefined,
      );
      const moduleId = modules.length === 1 ? modules[0] : undefined;
      if (moduleId === undefined || moduleId.length > PRACTICE_ID_MAX) return undefined;
      const union = [
        ...new Set([...(opts.heldKeys ?? []), ...(opts.issuedKeys ?? []), ...answerKey]),
      ];
      if (JSON.stringify(union).length > PRACTICE_KEYS_MAX_JSON) return undefined;
      return { itemId, moduleId, answerKey: [...answerKey], shown: shownText(parsed.data) };
    },
  };
}
