import { describe, expect, it } from 'vitest';
import type { RetentionResult } from '@edmate/db';
import { purgeTable, RetentionPurgeError } from './workers.js';

const CUTOFF = new Date('2020-01-01T00:00:00Z');

interface PurgeSpy {
  (cutoff: Date, dryRun: boolean, limit: number): Promise<RetentionResult>;
  cutoffs: Date[];
  dryRuns: boolean[];
  limits: number[];
}

function queue(results: RetentionResult[]): PurgeSpy {
  const calls: RetentionResult[] = [...results];
  const cutoffs: Date[] = [];
  const dryRuns: boolean[] = [];
  const limits: number[] = [];
  const fn = ((cutoff: Date, dryRun: boolean, limit: number) => {
    cutoffs.push(cutoff);
    dryRuns.push(dryRun);
    limits.push(limit);
    const next = calls.length > 1 ? calls.shift()! : calls[0]!;
    return Promise.resolve(next);
  }) as PurgeSpy;
  fn.cutoffs = cutoffs;
  fn.dryRuns = dryRuns;
  fn.limits = limits;
  return fn;
}

/** A fake purge that fails on a given 1-based call number, after returning full-batch results. */
function queueThatFails(failOnCall: number, resultBeforeFail: RetentionResult): PurgeSpy {
  let calls = 0;
  const cutoffs: Date[] = [];
  const dryRuns: boolean[] = [];
  const limits: number[] = [];
  const fn = ((cutoff: Date, dryRun: boolean, limit: number) => {
    calls += 1;
    cutoffs.push(cutoff);
    dryRuns.push(dryRun);
    limits.push(limit);
    if (calls === failOnCall) {
      return Promise.reject(new Error('db connection lost'));
    }
    return Promise.resolve(resultBeforeFail);
  }) as PurgeSpy;
  fn.cutoffs = cutoffs;
  fn.dryRuns = dryRuns;
  fn.limits = limits;
  return fn;
}

describe('purgeTable', () => {
  it('dry run makes exactly one call, reporting the unlimited count, and never writes', async () => {
    const purge = queue([{ count: 42, dryRun: true }]);
    const result = await purgeTable('sessions', purge, CUTOFF, true, 10);
    expect(result).toEqual({ table: 'sessions', count: 42, dryRun: true, calls: 1, maxIterationsHit: false });
    expect(purge.dryRuns).toEqual([true]);
    expect(purge.cutoffs).toEqual([CUTOFF]);
  });

  it('live mode calls again while a call reports the full limit, summing counts, stopping below it', async () => {
    const purge = queue([
      { count: 10, dryRun: false },
      { count: 10, dryRun: false },
      { count: 3, dryRun: false },
    ]);
    const result = await purgeTable('turnTraces', purge, CUTOFF, false, 10);
    expect(result).toEqual({
      table: 'turnTraces',
      count: 23,
      dryRun: false,
      calls: 3,
      maxIterationsHit: false,
    });
    expect(purge.dryRuns).toEqual([false, false, false]);
    expect(purge.limits).toEqual([10, 10, 10]);
  });

  it('live mode with nothing past cutoff makes one call and reports zero', async () => {
    const purge = queue([{ count: 0, dryRun: false }]);
    const result = await purgeTable('transcriptChunks', purge, CUTOFF, false, 1000);
    expect(result).toEqual({
      table: 'transcriptChunks',
      count: 0,
      dryRun: false,
      calls: 1,
      maxIterationsHit: false,
    });
  });

  it('passes purgeLimit into every live call, so the loop and the database agree on the limit', async () => {
    const purge = queue([{ count: 5, dryRun: false }]);
    await purgeTable('sessions', purge, CUTOFF, false, 7);
    expect(purge.limits).toEqual([7]);
  });

  it('a later call that throws loses nothing: the error carries the rows already deleted', async () => {
    const purge = queueThatFails(3, { count: 10, dryRun: false });
    const error = await purgeTable('sessions', purge, CUTOFF, false, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetentionPurgeError);
    const purgeError = error as RetentionPurgeError;
    expect(purgeError.table).toBe('sessions');
    expect(purgeError.deletedSoFar).toBe(20);
    expect(purgeError.calls).toBe(3);
    expect(purgeError.cause).toBeInstanceOf(Error);
  });
});
