import { describe, expect, it } from 'vitest';
import type { RetentionResult } from '@edmate/db';
import { purgeTable } from './workers.js';

const CUTOFF = new Date('2020-01-01T00:00:00Z');

interface PurgeSpy {
  (cutoff: Date, dryRun: boolean): Promise<RetentionResult>;
  cutoffs: Date[];
  dryRuns: boolean[];
}

function queue(results: RetentionResult[]): PurgeSpy {
  const calls: RetentionResult[] = [...results];
  const cutoffs: Date[] = [];
  const dryRuns: boolean[] = [];
  const fn = ((cutoff: Date, dryRun: boolean) => {
    cutoffs.push(cutoff);
    dryRuns.push(dryRun);
    const next = calls.length > 1 ? calls.shift()! : calls[0]!;
    return Promise.resolve(next);
  }) as PurgeSpy;
  fn.cutoffs = cutoffs;
  fn.dryRuns = dryRuns;
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
});
