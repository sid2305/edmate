// The real tool registry (task 5.5; 5.6 appends `practice.next_item`). 5.7/5.8 append the
// feedback and role-play tools here. Callers opt in: the harness's own fallback stays `noTools`,
// and wiring this into an app's composition root is a later task (5.5 Q4). 5.4's filter
// (`access/tools.ts`) decides which of these a turn is offered.
import type { ToolRegistry } from '../pipeline/tools.js';
import { calculatorTool } from './calculator.js';
import { demoPracticeBank } from './demoPracticeBank.js';
import { practiceNextItemTool, type PracticeToolOptions } from './practice.js';
import type { PracticeBank } from './practiceItems.js';

/**
 * `bank` defaults to `demoPracticeBank()` (a fixture, never real teacher content — 5.11/8.x fill
 * a real one later). `practiceOpts` passes through to `practiceNextItemTool` (Phase C's
 * active-item hook, once it exists).
 */
export function defaultToolRegistry(
  bank: PracticeBank = demoPracticeBank(),
  practiceOpts?: PracticeToolOptions,
): ToolRegistry {
  const tools = [calculatorTool, practiceNextItemTool(bank, practiceOpts)] as const;
  return { list: () => tools };
}
