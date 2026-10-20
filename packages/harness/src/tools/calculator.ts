// The calculator tool (task 5.5; PRD stack: "Calculator: mathjs, sandboxed — numeric checks in
// feedback and grounding"). A coach-skill tool, so 5.4's access filter offers it only when coach is
// entitled. No `present()`: the model uses the number in its reply; there is no skill event (Q3).
import type { Tool } from '@edmate/contracts';
import { z } from 'zod';
import type { RegisteredTool } from '../pipeline/tools.js';
import {
  ALLOWED_CONSTANTS,
  ALLOWED_FUNCTIONS,
  evaluateExpression,
  CALCULATOR_MAX_EXPRESSION_LENGTH,
} from './sandbox.js';

const input = z.strictObject({
  expression: z.string().min(1).max(CALCULATOR_MAX_EXPRESSION_LENGTH),
});
const output = z.strictObject({ value: z.string() });

const tool: Tool<z.infer<typeof input>, z.infer<typeof output>> = {
  name: 'calculator',
  skill: 'coach',
  description:
    'Evaluates one arithmetic expression over numbers and returns the value as a string. ' +
    `Allowed: numbers, + - * / ^ % ( ), the functions ${[...ALLOWED_FUNCTIONS].join(' ')} ` +
    `and the constants ${[...ALLOWED_CONSTANTS].join(' ')}. No variables and no scientific ` +
    `notation (write 10^5). At most ${CALCULATOR_MAX_EXPRESSION_LENGTH} characters.`,
  input,
  output,
  // Async so a sandbox refusal becomes a rejection, which the tool loop reports as `failed`.
  run: ({ expression }) =>
    Promise.resolve().then(() => ({ value: evaluateExpression(expression) })),
};

export const calculatorTool: RegisteredTool = { tool: tool as Tool<unknown, unknown> };
