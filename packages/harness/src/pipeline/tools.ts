// The tool registry seam (task 3.7; 5.5 builds the real registry and its tools). The access rule
// (a tool is offered and run only when its skill is entitled) lives in `access/tools.ts` (5.4) and
// is re-exported here, so imports don't churn.
import type { Skill, Tool, TurnContext } from '@edmate/contracts';
import { z } from 'zod';

export { DuplicateToolError, entitledTools, offeredTools, policyTools } from '../access/tools.js';

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
