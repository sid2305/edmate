// A fixed tool registry for pipeline tests (task 3.7; the real one is 5.5's). Synthetic tools only.
import type { Skill, Tool, TurnContext } from '@edmate/contracts';
import { z, type ZodType } from 'zod';
import type { RegisteredTool, SkillPresentation, ToolRegistry } from '../pipeline/tools.js';

export interface MemoryToolRegistry extends ToolRegistry {
  /** Every run, in order: tool name and the parsed input. */
  readonly runs: { name: string; input: unknown }[];
}

export function memoryToolRegistry(entries: readonly RegisteredTool[]): MemoryToolRegistry {
  const runs: MemoryToolRegistry['runs'] = [];
  const wrapped = entries.map((e): RegisteredTool => ({
    ...e,
    tool: {
      ...e.tool,
      run: (input, ctx) => {
        runs.push({ name: e.tool.name, input });
        return e.tool.run(input, ctx);
      },
    },
  }));
  return { runs, list: () => wrapped };
}

/** A synthetic tool: echoes its input as `{ echo }` unless `run` is given. */
export function testTool(o: {
  name: string;
  skill: Skill;
  description?: string;
  input?: ZodType<unknown>;
  output?: ZodType<unknown>;
  run?: (input: unknown, ctx: TurnContext) => Promise<unknown>;
  present?: (output: unknown, ctx: TurnContext) => SkillPresentation | undefined;
}): RegisteredTool {
  const tool: Tool<unknown, unknown> = {
    name: o.name,
    skill: o.skill,
    description: o.description ?? `Test tool ${o.name}.`,
    input: o.input ?? z.unknown(),
    output: o.output ?? z.unknown(),
    run: o.run ?? ((input) => Promise.resolve({ echo: input })),
  };
  return o.present === undefined ? { tool } : { tool, present: o.present };
}
