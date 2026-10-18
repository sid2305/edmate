// Record / replay (task 3.12). One mechanism for every non-deterministic call the runner makes,
// the agent's reply and each judge verdict alike. Replay never calls `fn`: a missing fixture
// throws, it never falls through to a live call.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type RecordMode = 'record' | 'replay';

export interface Recorder {
  readonly mode: RecordMode;
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export class MissingFixtureError extends Error {
  override readonly name = 'MissingFixtureError';

  constructor(readonly key: string) {
    super(`no recorded fixture for "${key}"; run with --record first`);
  }
}

export class InvalidFixtureKeyError extends Error {
  override readonly name = 'InvalidFixtureKeyError';

  constructor(readonly key: string) {
    super(`unsafe fixture key ${JSON.stringify(key)}: use lowercase segments joined by "/"`);
  }
}

export class FixtureReadError extends Error {
  override readonly name = 'FixtureReadError';

  constructor(
    readonly key: string,
    options: { cause: unknown },
  ) {
    super(`could not read the recorded fixture for "${key}"`, options);
  }
}

// Segments of lowercase letters, digits and -; no "..", no leading "/", no backslash. Keys are
// built by the runner from schema-checked case ids, so this is defence in depth.
const KEY = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

function checkKey(key: string): void {
  if (!KEY.test(key)) throw new InvalidFixtureKeyError(key);
}

/** Deterministic, diff-friendly fixture text. */
function serialise(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

/** One JSON file per key, at `<dir>/<key>.json`. */
export function fileRecorder(dir: string, mode: RecordMode): Recorder {
  return {
    mode,
    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      checkKey(key);
      const path = join(dir, `${key}.json`);
      if (mode === 'replay') {
        let text: string;
        try {
          text = readFileSync(path, 'utf8');
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
            throw new MissingFixtureError(key);
          throw new FixtureReadError(key, { cause });
        }
        try {
          return JSON.parse(text) as T;
        } catch (cause) {
          throw new FixtureReadError(key, { cause });
        }
      }
      const value = await fn();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, serialise(value));
      return value;
    },
  };
}

export interface MemoryRecorder extends Recorder {
  /** What has been recorded (or seeded), as plain JSON data. */
  snapshot(): Record<string, unknown>;
}

/** In-memory recorder for tests. Values are JSON round-tripped, exactly like the file recorder. */
export function memoryRecorder(
  mode: RecordMode,
  seed: Readonly<Record<string, unknown>> = {},
): MemoryRecorder {
  const store = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, serialise(v)]));
  return {
    mode,
    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      checkKey(key);
      if (mode === 'replay') {
        const text = store.get(key);
        if (text === undefined) throw new MissingFixtureError(key);
        return JSON.parse(text) as T;
      }
      const value = await fn();
      store.set(key, serialise(value));
      return value;
    },
    snapshot: () =>
      Object.fromEntries([...store].map(([k, text]) => [k, JSON.parse(text) as unknown])),
  };
}
