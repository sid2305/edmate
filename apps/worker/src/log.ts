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
