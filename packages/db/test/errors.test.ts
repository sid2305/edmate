// Unit: RepositoryError and the translation of driver errors (no database).
import { describe, expect, it } from 'vitest';
import {
  guarded,
  RepositoryError,
  ScrubbedDbError,
  translateWrite,
} from '../src/repositories/errors.js';
import { everything } from './scrub.js';
import { written } from '../src/repositories/insert.js';

const pgError = (code: string, detail: string) =>
  Object.assign(new Error(`violates constraint: ${detail}`), { code, detail });

describe('RepositoryError', () => {
  it.each([
    ['scope', 'forbidden'],
    ['not_found', 'not_found'],
    ['invalid', 'validation'],
    ['integrity', 'validation'],
    ['failed', 'provider_error'],
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

describe('translateWrite unique-violation cause (task 9.3b)', () => {
  it('attaches the constraint name on the unique-violation cause, so a caller can tell which one fired', async () => {
    const err = await translateWrite('subscriptions.start', async () => {
      throw pgError('23505', 'Key (student_id, teacher_id)=(stu_x, tch_x) already exists');
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'invalid', method: 'subscriptions.start' });
    const cause = (err as RepositoryError).cause as ScrubbedDbError;
    expect(cause).toBeInstanceOf(ScrubbedDbError);
    expect(cause.code).toBe('23505');
  });

  it('the constraint itself travels when the driver sets it (not just code/detail)', async () => {
    const err = await translateWrite('subscriptions.start', async () => {
      throw Object.assign(new Error('violates unique constraint'), {
        code: '23505',
        constraint: 'subscriptions_one_live_per_pair_key',
      });
    }).catch((e: unknown) => e);
    const cause = (err as RepositoryError).cause as ScrubbedDbError;
    expect(cause.constraint).toBe('subscriptions_one_live_per_pair_key');
  });
});

describe('translateWrite onDuplicate', () => {
  it('can report a duplicate key as not_found (caller-chosen global ids)', async () => {
    await expect(
      translateWrite(
        'messages.append',
        async () => {
          throw pgError('23505', 'Key (id)=(msg_x) already exists');
        },
        'not_found',
      ),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('guarded', () => {
  it('returns the result and passes a RepositoryError through', async () => {
    expect(await guarded('m', async () => 'ok')).toBe('ok');
    const inner = new RepositoryError('scope', 'm');
    await expect(
      guarded('m', async () => {
        throw inner;
      }),
    ).rejects.toBe(inner);
  });

  it('keeps only the code and constraint of a driver error', async () => {
    const driver = Object.assign(new Error('duplicate key value violates "x" stu_secret'), {
      code: '23514',
      constraint: 'payments_amount_minor_check',
      detail: 'Failing row contains (stu_secret, private text)',
    });
    const drizzle = new Error('Failed query: insert ... params: stu_secret,private text', {
      cause: driver,
    });
    const err = await guarded('sessions.create', async () => {
      throw drizzle;
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      kind: 'failed',
      code: 'provider_error',
      method: 'sessions.create',
    });
    const cause = (err as RepositoryError).cause as ScrubbedDbError;
    expect(cause).toBeInstanceOf(ScrubbedDbError);
    expect(cause).toMatchObject({ code: '23514', constraint: 'payments_amount_minor_check' });
    expect(cause.message).toBe('database error 23514 (payments_amount_minor_check)');
    expect(cause.cause).toBeUndefined();
    const all = everything(err);
    expect(all).not.toContain('stu_secret');
    expect(all).not.toContain('private text');
  });

  it('scrubs errors with no code and non-errors', async () => {
    for (const thrown of [new Error('params: stu_secret'), 'stu_secret', null]) {
      const err = await guarded('m', async () => {
        throw thrown;
      }).catch((e: unknown) => e);
      expect((err as RepositoryError).cause).toMatchObject({ code: undefined });
      expect(((err as RepositoryError).cause as Error).message).toBe('database error');
      expect(everything(err)).not.toContain('stu_secret');
    }
  });
});

describe('written', () => {
  it('counts a null rowCount as zero rows', () => {
    expect(written({ rowCount: null })).toBe(0);
    expect(written({ rowCount: 1 })).toBe(1);
  });
});
