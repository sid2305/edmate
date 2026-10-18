// Trace capture (build plan § Turn pipeline spec, step 11). The trace has no text field (ADR-0003):
// only step names, timings, outcomes, intent, move, guard verdicts and usage.
import {
  type Intent,
  type PedagogyDecision,
  type TurnTrace,
  TurnTraceSchema,
  type Usage,
} from '@edmate/contracts';
import { STEP_NAMES, type StepName } from './spec.js';
import type { GuardTrace } from './types.js';

export type StepOutcome = TurnTrace['steps'][number]['outcome'];

/**
 * Collects step results as they finish (completion order varies under concurrency) and emits them
 * in spec order. A step recorded twice (generate's retry) adds up its ms; the last outcome wins.
 */
export class TraceBuilder {
  private readonly steps = new Map<StepName, { ms: number; outcome: StepOutcome }>();
  private readonly guards: GuardTrace[] = [];
  private readonly usageRows: Usage[] = [];

  step(name: StepName, ms: number, outcome: StepOutcome): void {
    const prev = this.steps.get(name);
    this.steps.set(name, { ms: (prev?.ms ?? 0) + Math.max(0, ms), outcome });
  }

  /** Changes a recorded step's outcome (e.g. buildContext when its context fails the refine). */
  outcome(name: StepName, outcome: StepOutcome): void {
    const prev = this.steps.get(name);
    this.steps.set(name, { ms: prev?.ms ?? 0, outcome });
  }

  /** Copies only name, ok and action: a guard's reason or rewrite text never enters a trace. */
  addGuards(g: readonly GuardTrace[]): void {
    for (const x of g) {
      this.guards.push(
        x.action === undefined
          ? { name: x.name, ok: x.ok }
          : { name: x.name, ok: x.ok, action: x.action },
      );
    }
  }

  addUsage(u: readonly Usage[]): void {
    this.usageRows.push(...u);
  }

  /** All usage so far (copies), for `done.usage` and `meter`. */
  get usage(): Usage[] {
    return this.usageRows.map((u) => ({ ...u }));
  }

  build(x: {
    turnId: string;
    sessionId: string;
    agentVersion: number;
    packageVersion: number;
    intent: Intent;
    move: PedagogyDecision['move'];
  }): TurnTrace {
    return TurnTraceSchema.parse({
      ...x,
      steps: STEP_NAMES.flatMap((name) => {
        const s = this.steps.get(name);
        return s === undefined ? [] : [{ name, ms: s.ms, outcome: s.outcome }];
      }),
      guards: this.guards,
      usage: this.usage,
    });
  }
}
