// The tool registry seam (task 3.7; 5.5 builds the real registry and its tools). Access rule 5:
// a tool is offered to the model, and run, only when its skill is in the student's entitlement.
// decide gets the entitled list for the policy, and generate checks it again (defence in depth).
import type { Entitlement, Skill, Tool, TurnContext } from '@edmate/contracts';
import { z } from 'zod';
import type { PolicyTool } from '../pedagogy/policy.js';

/** What a tool result shows the student as a `skill` event; written by the tool's author. */
export interface SkillPresentation {
  skill: Skill;
  payload: unknown;
}

export interface RegisteredTool {
  tool: Tool<unknown, unknown>;
  /** Optional: turns a checked output into a `skill` event (5.5/M6). */
  present?(output: unknown, ctx: TurnContext): SkillPresentation | undefined;
}

export interface ToolRegistry {
  list(): readonly RegisteredTool[];
}

export const noTools: ToolRegistry = { list: () => [] };

/** Two registry tools share a name, so which one would run is ambiguous. Fails closed. */
export class DuplicateToolError extends Error {
  override readonly name = 'DuplicateToolError';

  constructor(readonly tool: string) {
    super(`the tool registry has two tools named "${tool}"`);
  }
}

/** The registry's tools whose skill is in the entitlement, in registry order. */
export function entitledTools(
  registry: ToolRegistry,
  entitlement: Pick<Entitlement, 'skills'>,
): RegisteredTool[] {
  const seen = new Set<string>();
  const out: RegisteredTool[] = [];
  for (const r of registry.list()) {
    if (seen.has(r.tool.name)) throw new DuplicateToolError(r.tool.name);
    seen.add(r.tool.name);
    if (entitlement.skills.includes(r.tool.skill)) out.push(r);
  }
  return out;
}

/** What decide passes the policy: names and skills of the entitled tools only. */
export function policyTools(
  registry: ToolRegistry,
  entitlement: Pick<Entitlement, 'skills'>,
): PolicyTool[] {
  return entitledTools(registry, entitlement).map((r) => ({
    name: r.tool.name,
    skill: r.tool.skill,
  }));
}

/**
 * The tools generate offers: the decision's names, in its order and once each, that are both in
 * the registry and entitled. The registry is not read when the decision names none.
 */
export function offeredTools(
  registry: ToolRegistry,
  names: readonly string[],
  entitlement: Pick<Entitlement, 'skills'>,
): RegisteredTool[] {
  if (names.length === 0) return [];
  const byName = new Map(entitledTools(registry, entitlement).map((r) => [r.tool.name, r]));
  const out: RegisteredTool[] = [];
  for (const name of new Set(names)) {
    const r = byName.get(name);
    if (r !== undefined) out.push(r);
  }
  return out;
}

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
