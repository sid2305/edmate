import { describe, expect, it } from 'vitest';
import type { LogLine } from '../log.js';
import { logRetentionRun, logRetentionTable } from './logSink.js';

describe('logRetentionTable', () => {
  it('logs the table, count, dryRun and call count, info when under the cap', () => {
    const lines: LogLine[] = [];
    logRetentionTable((l) => lines.push(l), {
      table: 'sessions',
      count: 5,
      dryRun: true,
      calls: 1,
      maxIterationsHit: false,
    });
    expect(lines).toEqual([
      {
        level: 'info',
        event: 'retention.table',
        table: 'sessions',
        count: 5,
        dryRun: true,
        calls: 1,
        maxIterationsHit: false,
      },
    ]);
  });

  it('logs warn when the table hit the per-run iteration cap', () => {
    const lines: LogLine[] = [];
    logRetentionTable((l) => lines.push(l), {
      table: 'turnTraces',
      count: 2000,
      dryRun: false,
      calls: 1000,
      maxIterationsHit: true,
    });
    expect(lines[0]?.level).toBe('warn');
  });
});

describe('logRetentionRun', () => {
  it('logs info with per-table counts when nothing hit the cap', () => {
    const lines: LogLine[] = [];
    logRetentionRun((l) => lines.push(l), {
      dryRun: true,
      tables: [
        { table: 'sessions', count: 5, dryRun: true, calls: 1, maxIterationsHit: false },
        { table: 'turnTraces', count: 9, dryRun: true, calls: 1, maxIterationsHit: false },
      ],
    });
    expect(lines).toEqual([
      {
        level: 'info',
        event: 'retention.run',
        dryRun: true,
        tables: { sessions: 5, turnTraces: 9 },
        anyMaxIterationsHit: false,
      },
    ]);
  });

  it('logs warn when any table hit the iteration cap', () => {
    const lines: LogLine[] = [];
    logRetentionRun((l) => lines.push(l), {
      dryRun: false,
      tables: [{ table: 'turnTraces', count: 2000, dryRun: false, calls: 1000, maxIterationsHit: true }],
    });
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.anyMaxIterationsHit).toBe(true);
  });
});
