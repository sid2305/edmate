// Unit: RepositoryError and the translation of driver errors (no database).
import { describe, expect, it } from 'vitest';
import { RepositoryError, translateWrite } from '../src/repositories/errors.js';
import { written } from '../src/repositories/insert.js';

const pgError = (code: string, detail: string) =>
  Object.assign(new Error(`violates constraint: ${detail}`), { code, detail });

describe('RepositoryError', () => {
  it.each([
    ['scope', 'forbidden'],
    ['not_found', 'not_found'],
    ['invalid', 'validation'],
    ['integrity', 'validation'],
  ] as const)('%s maps to the contracts error code %s', (kind, code) => {
    const e = new RepositoryError(kind, 'sessions.get');
    expect(e.code).toBe(code);
    expect(e.message).toBe(`sessions.get: ${kind}`);
    expect(e.name).toBe('RepositoryError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('translateWrite', () => {
  it('returns the result of a successful write', async () => {
    expect(await translateWrite('m', async () => 7)).toBe(7);
  });

  it('turns a foreign key violation into not_found, without the driver message', async () => {
    const err = await translateWrite('sessions.create', async () => {
      throw pgError('23503', 'Key (student_id)=(stu_secret) is not present');
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'not_found', method: 'sessions.create' });
    expect(String((err as Error).message)).not.toContain('stu_secret');
  });

  it('finds the code on a wrapped cause (Drizzle wraps driver errors)', async () => {
    const wrapped = new Error('Failed query', { cause: pgError('23505', 'Key (id)=(x) exists') });
    await expect(
      translateWrite('messages.append', async () => {
        throw wrapped;
      }),
    ).rejects.toMatchObject({ kind: 'invalid', method: 'messages.append' });
  });

  it('passes a RepositoryError through unchanged', async () => {
    const inner = new RepositoryError('scope', 'evidenceEvents.append');
    await expect(
      translateWrite('evidenceEvents.append', async () => {
        throw inner;
      }),
    ).rejects.toBe(inner);
  });

  it('rethrows anything else (a connection failure is not a missing row)', async () => {
    const down = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    await expect(
      translateWrite('m', async () => {
        throw down;
      }),
    ).rejects.toBe(down);
    await expect(
      translateWrite('m', async () => {
        throw 'a string';
      }),
    ).rejects.toBe('a string');
    const deep = new Error('a', {
      cause: new Error('b', { cause: new Error('c', { cause: pgError('23503', '') }) }),
    });
    // Only three levels are searched.
    await expect(
      translateWrite('m', async () => {
        throw deep;
      }),
    ).rejects.toBe(deep);
  });
});

describe('written', () => {
  it('counts a null rowCount as zero rows', () => {
    expect(written({ rowCount: null })).toBe(0);
    expect(written({ rowCount: 1 })).toBe(1);
  });
});
