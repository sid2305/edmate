// Unit (no database, task 6.3a): mistakeProposals rejects bad input as `invalid` before any SQL,
// and a malformed scope is `scope`. The pool points at an unreachable host, so a call that reached
// the database would fail as `failed` instead.
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import {
  createRepositories,
  MISTAKE_PROPOSAL_PATCH_MAX,
  MISTAKE_PROPOSALS_LIST_MAX,
  MISTAKE_PROPOSALS_MAX,
  RepositoryError,
} from '../src/index.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

const BAD_SCOPE = [{ teacherId: '' }, { teacherId: 'has space' }, null, undefined, 7, 'tch_1'];

describe('mistakeProposals constants', () => {
  it('exports the caps', () => {
    expect(MISTAKE_PROPOSAL_PATCH_MAX).toBe(50);
    expect(MISTAKE_PROPOSALS_MAX).toBe(100);
    expect(MISTAKE_PROPOSALS_LIST_MAX).toBe(50);
  });
});

describe('mistakeProposals input validation', () => {
  it('record: a malformed scope is scope', async () => {
    for (const scope of BAD_SCOPE) {
      expect(
        await kind(
          repos.mistakeProposals.record(scope as never, [
            { tag: 'x', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' },
          ]),
        ),
      ).toBe('scope');
    }
  });

  it('listPending/approve/reject: a malformed scope is scope', async () => {
    for (const scope of BAD_SCOPE) {
      expect(await kind(repos.mistakeProposals.listPending(scope as never))).toBe('scope');
      expect(await kind(repos.mistakeProposals.approve(scope as never, 'x'))).toBe('scope');
      expect(await kind(repos.mistakeProposals.reject(scope as never, 'x'))).toBe('scope');
    }
  });

  it('record: a patch over MISTAKE_PROPOSAL_PATCH_MAX is invalid before any SQL', async () => {
    const patch = Array.from({ length: MISTAKE_PROPOSAL_PATCH_MAX + 1 }, (_, i) => ({
      tag: `tag_${i}`,
      count: 1,
      lastSeen: '2026-10-27T10:00:00.000Z',
    }));
    expect(await kind(repos.mistakeProposals.record({ teacherId: 'tch_1' }, patch))).toBe(
      'invalid',
    );
  });

  it('record: a bad tag, count or lastSeen, or an extra key, is invalid', async () => {
    const bad = [
      [{ tag: '', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
      [{ tag: '   ', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
      [{ tag: 'x'.repeat(61), count: 1, lastSeen: '2026-10-27T10:00:00.000Z' }],
      [{ tag: 'x', count: 0, lastSeen: '2026-10-27T10:00:00.000Z' }],
      [{ tag: 'x', count: -1, lastSeen: '2026-10-27T10:00:00.000Z' }],
      [{ tag: 'x', count: 1.5, lastSeen: '2026-10-27T10:00:00.000Z' }],
      [{ tag: 'x', count: 1 }],
      [{ tag: 'x', count: 1, lastSeen: '2026-10-27T10:00:00.000Z', extra: true }],
    ];
    for (const patch of bad) {
      expect(
        await kind(repos.mistakeProposals.record({ teacherId: 'tch_1' }, patch as never)),
      ).toBe('invalid');
    }
  });

  it('record: an empty patch is a no-op (never reaches the database)', async () => {
    await expect(
      repos.mistakeProposals.record({ teacherId: 'tch_1' }, []),
    ).resolves.toBeUndefined();
  });

  it('approve/reject: an empty or overlong tag is invalid', async () => {
    for (const tag of ['', '   ', 'x'.repeat(61)]) {
      expect(await kind(repos.mistakeProposals.approve({ teacherId: 'tch_1' }, tag))).toBe(
        'invalid',
      );
      expect(await kind(repos.mistakeProposals.reject({ teacherId: 'tch_1' }, tag))).toBe(
        'invalid',
      );
    }
  });

  it('a well-formed call reaches the database and fails as failed', async () => {
    expect(
      await kind(
        repos.mistakeProposals.record({ teacherId: 'tch_1' }, [
          { tag: 'x', count: 1, lastSeen: '2026-10-27T10:00:00.000Z' },
        ]),
      ),
    ).toBe('failed');
    expect(await kind(repos.mistakeProposals.listPending({ teacherId: 'tch_1' }))).toBe('failed');
    expect(await kind(repos.mistakeProposals.approve({ teacherId: 'tch_1' }, 'x'))).toBe('failed');
    expect(await kind(repos.mistakeProposals.reject({ teacherId: 'tch_1' }, 'x'))).toBe('failed');
  });
});
