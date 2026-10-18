// A minimal injected clock for test doubles. The full clock shape lives in pipeline/clock.ts
// (task 3.1); the scripted gateway only needs `sleep`.
import type { Clock as PipelineClock } from '../pipeline/clock.js';

export type Clock = Pick<PipelineClock, 'sleep'>;

export interface ManualClock extends Clock {
  /** Every requested sleep, in call order. */
  readonly sleeps: readonly number[];
}

/** A clock whose `sleep` resolves at once and records the requested duration. No real timers. */
export function manualClock(): ManualClock {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep(ms: number): Promise<void> {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}
