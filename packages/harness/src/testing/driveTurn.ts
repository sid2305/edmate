// Runs a turn to the end on a virtual clock and collects what the student and the system saw.
import type { TurnEvent } from '@edmate/contracts';
import type { TurnRun, TurnRunResult } from '../pipeline/types.js';
import type { VirtualClock } from './virtualClock.js';

export interface TimedEvent {
  event: TurnEvent;
  /** Virtual time the consumer received it. */
  at: number;
}

async function consume(run: TurnRun, clock: VirtualClock, out: TimedEvent[]): Promise<void> {
  for await (const event of run.events) out.push({ event, at: clock.now() });
}

/** Consumes the stream and awaits `finished`, firing virtual timers until both settle. */
export async function driveTurn(
  run: TurnRun,
  clock: VirtualClock,
): Promise<{ events: TurnEvent[]; timed: TimedEvent[]; result: TurnRunResult }> {
  const timed: TimedEvent[] = [];
  const [, result] = await clock.drive(Promise.all([consume(run, clock, timed), run.finished]));
  return { events: timed.map((t) => t.event), timed, result };
}

/** Consumes only the stream (for turns whose background work never settles). */
export async function driveEvents(run: TurnRun, clock: VirtualClock): Promise<TimedEvent[]> {
  const timed: TimedEvent[] = [];
  await clock.drive(consume(run, clock, timed));
  return timed;
}
