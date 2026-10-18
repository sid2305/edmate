// Assertions that an error carries no ids or student text (fix round 1, security review).
import { inspect } from 'node:util';
import { expect } from 'vitest';
import { RepositoryError } from '../src/index.js';

/** The error, its whole cause chain and util.inspect of it, as one string. */
export function everything(err: unknown): string {
  const parts: string[] = [inspect(err, { depth: 10, showHidden: true })];
  let e: unknown = err;
  for (let i = 0; e && i < 10; i += 1) {
    parts.push(String((e as Error).message), String((e as Error).stack), JSON.stringify(e));
    e = (e as { cause?: unknown }).cause;
  }
  return parts.join('\n');
}

/** A scrubbed `failed` RepositoryError for `method` that mentions none of `secrets`. */
export function expectScrubbed(err: unknown, method: string, secrets: string[]) {
  expect(err).toBeInstanceOf(RepositoryError);
  expect(err).toMatchObject({ kind: 'failed', code: 'provider_error', method });
  const all = everything(err);
  for (const s of secrets) expect(all, `leaks ${s}`).not.toContain(s);
  expect(all).not.toMatch(/params:|Failed query|insert into|select /i);
}
