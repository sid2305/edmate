// Structured log lines for the worker (task 3.8). One JSON object per line. Lines carry ids, job
// names, counts and an error's name and message only: never a job's payload (student text, the
// help state's answer key) or a raw driver error. @edmate/db errors are already scrubbed
// (RepositoryError: "<method>: <kind>").

export type LogLevel = 'info' | 'warn' | 'error';

export type LogLine = { level: LogLevel; event: string } & Record<string, unknown>;

export type Log = (line: LogLine) => void;

/** The default sink: stderr for warnings and errors, stdout otherwise. */
export function jsonLog(
  write: (level: LogLevel, text: string) => void = (level, text) => {
    if (level === 'info') console.log(text);
    else console.error(text);
  },
): Log {
  return (line) => {
    write(line.level, JSON.stringify(line));
  };
}

/** At most this many characters of an error message reach a log line. */
export const ERROR_MESSAGE_MAX = 200;

/** An error's name and (capped) message, for a log line. */
export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, ERROR_MESSAGE_MAX) };
  }
  return { name: typeof error, message: '' };
}

/** Task 3.9e (3.9c review LOW): `warmPreGuardPatterns()` never throws -- it returns the names of
 * any matchers that failed instead, so a throw during guard warm-up no longer leaves no trace.
 * Logs only the matcher names (never the sample text or an error); a no-op when the list is
 * empty (every matcher warmed up cleanly). */
export function logGuardWarmupFailures(matchers: readonly string[], log: Log): void {
  if (matchers.length > 0) {
    log({ level: 'error', event: 'guard_warmup.matcher_failed', matchers: [...matchers] });
  }
}
