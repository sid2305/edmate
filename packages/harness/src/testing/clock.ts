// A minimal injected clock for test doubles. Local to harness/testing on purpose (lead answer Q1):
// the platform-wide clock/id-generator shape is task 3.1's to define.

export interface Clock {
  sleep(ms: number): Promise<void>;
}

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
