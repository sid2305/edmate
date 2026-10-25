// The retention job's own structured log lines (task 13.4, Phase B; mirrors
// `../insights/logSink.ts`'s "only the named fields reach the line" discipline). Counts only --
// never a row id, never message/transcript text, never a student or teacher name.
import type { Log } from '../log.js';
import type { TablePurgeResult } from './workers.js';

/** One table's result: `warn` when it hit the per-run iteration cap, else `info`. */
export function logRetentionTable(log: Log, result: TablePurgeResult): void {
  log({
    level: result.maxIterationsHit ? 'warn' : 'info',
    event: 'retention.table',
    table: result.table,
    count: result.count,
    dryRun: result.dryRun,
    calls: result.calls,
    maxIterationsHit: result.maxIterationsHit,
  });
}

/** The run summary: counts only, `warn` when any table hit the iteration cap, else `info`. */
export function logRetentionRun(
  log: Log,
  summary: { dryRun: boolean; tables: TablePurgeResult[] },
): void {
  const anyMaxIterationsHit = summary.tables.some((t) => t.maxIterationsHit);
  log({
    level: anyMaxIterationsHit ? 'warn' : 'info',
    event: 'retention.run',
    dryRun: summary.dryRun,
    tables: Object.fromEntries(summary.tables.map((t) => [t.table, t.count])),
    anyMaxIterationsHit,
  });
}
