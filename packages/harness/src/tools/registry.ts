// The real tool registry (task 5.5). 5.6/5.7/5.8 append `practice.next_item`, the feedback and
// role-play tools here. Callers opt in: the harness's own fallback stays `noTools`, and wiring this
// into an app's composition root is a later task (5.5 Q4). 5.4's filter (`access/tools.ts`)
// decides which of these a turn is offered.
import type { ToolRegistry } from '../pipeline/tools.js';
import { calculatorTool } from './calculator.js';

export function defaultToolRegistry(): ToolRegistry {
  const tools = [calculatorTool] as const;
  return { list: () => tools };
}
