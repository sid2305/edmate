// The tool registry seam (task 3.7; 5.5 builds the real registry and its tools). The access rule
// (a tool is offered and run only when its skill is entitled) lives in `access/tools.ts` (5.4) and
// is re-exported here, so imports don't churn.
import type { Skill, Tool, TurnContext } from '@edmate/contracts';
import { z } from 'zod';
import type { ItemContext } from './generate/itemContext.js';

export { DuplicateToolError, entitledTools, offeredTools, policyTools } from '../access/tools.js';
export type { ItemContext } from './generate/itemContext.js';

/** What a tool result shows the student as a `skill` event; written by the tool's author. */
export interface SkillPresentation {
  skill: Skill;
  payload: unknown;
}

/**
 * A registry tool. Its `run` must scope every read to the entitlement's allowed modules
 * (`ctx.entitlement.allowedModuleIds`), never locked or another teacher's material: its output
 * goes back to the model. generate drops an output that holds a do-not-say string
 * (`revealsAnswerKey`); 4.5 adds the lockedLeak n-gram check on outputs here as well.
 */
export interface RegisteredTool {
  tool: Tool<unknown, unknown>;
  /** Optional: turns a checked output into a `skill` event (5.5/M6). */
  present?(output: unknown, ctx: TurnContext): SkillPresentation | undefined;
  /**
   * Optional (5.6, ADR-0010): this turn's copy of the tool, bound to the session's practice state
   * (items already served, the active item's module). generate calls it once per attempt.
   */
  forSession?(s: ToolSessionState): RegisteredTool;
  /**
   * Optional (5.6, ADR-0010): for a tool that issues items with a server-side answer key, the
   * item a checked output names and its key, looked up on the server by item id within the
   * turn's entitlement. Never part of the output the model sees. `undefined` fails the call
   * closed (the model never sees an item whose key the harness can't protect).
   */
  issuedItem?(output: unknown, ctx: TurnContext): IssuedItem | undefined;
  /**
   * Optional (5.6b): the active practice item a loaded HelpState names (`practiceItemId`), rebuilt
   * on the server (its prompt, options and own key) inside `ctx.entitlement`, so the leak matcher
   * can exempt its re-show. `undefined` for an id outside the entitlement or one the tool never
   * issued (the key then gets no spans and no derived keys, 5.6b Q6).
   */
  activeItem?(itemId: string, ctx: TurnContext): ItemContext | undefined;
}

/** The session's practice state a tool may read (5.6): never model-chosen. */
export interface ToolSessionState {
  /** Item ids already served this session (the exclude list). */
  servedItemIds: readonly string[];
  /** The active item's module, if the session has one. */
  activeModuleId?: string;
  /**
   * Keys this attempt must not reveal (the decision's and every item issued so far), read live:
   * no item whose prompt or options show one is served (5.6 review). Server-side only.
   */
  heldKeys?: readonly string[];
  /** Keys issued this turn so far (all attempts), read live: their union is capped (5.6 review). */
  issuedKeys?: readonly string[];
}

/** An item a tool issued (5.6): server-side only, it holds the answer key. */
export interface IssuedItem {
  itemId: string;
  moduleId: string;
  answerKey: readonly string[];
  /**
   * The text the item shows (its prompt and options). The answer-key check on the tool output and
   * on its skill payload reads only this, not the output's JSON, so an id or `"level":1` never
   * counts as revealing an earlier key "1" (5.6 review).
   */
  shown: readonly string[];
}

export interface ToolRegistry {
  list(): readonly RegisteredTool[];
}

export const noTools: ToolRegistry = { list: () => [] };

/** The model-facing description of a tool: its input as JSON Schema. */
export function toolSpec(r: RegisteredTool): {
  name: string;
  description: string;
  inputSchema: unknown;
} {
  return {
    name: r.tool.name,
    description: r.tool.description,
    inputSchema: z.toJSONSchema(r.tool.input),
  };
}
