// Task 6.3a on Postgres: `mistakeProposalsRepo.record`/`listPending`/`approve`/`reject`, the
// "How it is shown" cases in docs/tasks/6.3a/plan.md. See test/pg.ts for how to start a Postgres.
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  MISTAKE_PROPOSAL_PATCH_MAX,
  MISTAKE_PROPOSALS_MAX,
  type Repositories,
  RepositoryError,
  STYLE_CARD_LIMITS,
} from '../src/index.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('mistake proposal tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: 'tch_mp_a' };
const B = { teacherId: 'tch_mp_b' };

async function failure(p: Promise<unknown>): Promise<{ kind: string; method: string }> {
  const e = await p.then(
    () => new Error('resolved'),
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  const { kind, method } = e as RepositoryError;
  return { kind, method };
}

const AT = '2026-10-27T10:00:00.000Z';
const LATER = '2026-10-27T11:00:00.000Z';

describe.skipIf(!up)(`mistakeProposals on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await handle.db.execute(
      sql`insert into users (id, name, locale, market, role) values
        (${A.teacherId}, '[mp] teacher A', 'en', 'test', 'teacher'),
        (${B.teacherId}, '[mp] teacher B', 'en', 'test', 'teacher'),
        ('stu_mp_c', '[mp] student C', 'en', 'test', 'student'),
        ('tch_mp_d', '[mp] teacher D (no style card)', 'en', 'test', 'teacher'),
        ('tch_mp_e', '[mp] teacher E (at tagsMax)', 'en', 'test', 'teacher'),
        ('tch_mp_g', '[mp] teacher G (concurrency)', 'en', 'test', 'teacher')`,
    );
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await repos.styleCards.create(A, { text: '[A] style', mistakeTags: ['units'] });
    await repos.styleCards.create(B, { text: '[B] style', mistakeTags: ['units'] });
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  it('record stores a teacher’s proposed tags, aggregated by tag (count summed, lastSeen the later), scoped per teacher', async () => {
    await repos.mistakeProposals.record(A, [{ tag: 'sign_error', count: 2, lastSeen: AT }]);
    await repos.mistakeProposals.record(A, [{ tag: 'sign_error', count: 3, lastSeen: LATER }]);
    const pending = await repos.mistakeProposals.listPending(A);
    expect(pending.find((p) => p.tag === 'sign_error')).toEqual({
      tag: 'sign_error',
      count: 5,
      lastSeen: LATER,
      status: 'pending',
    });
    // Another teacher's listPending never sees it.
    expect(await repos.mistakeProposals.listPending(B)).toEqual(
      (await repos.mistakeProposals.listPending(B)).filter((p) => p.tag !== 'sign_error'),
    );
  });

  it('listPending returns only pending rows for the scope’s own teacher; approved/rejected never reappear', async () => {
    await repos.mistakeProposals.record(A, [{ tag: 'carry_error', count: 1, lastSeen: AT }]);
    await repos.mistakeProposals.approve(A, 'carry_error');
    await repos.mistakeProposals.record(A, [{ tag: 'decimal_point', count: 1, lastSeen: AT }]);
    await repos.mistakeProposals.reject(A, 'decimal_point');
    const pending = await repos.mistakeProposals.listPending(A);
    expect(pending.map((p) => p.tag)).not.toContain('carry_error');
    expect(pending.map((p) => p.tag)).not.toContain('decimal_point');
  });

  it('approve creates a new style-card version with the tag added, deduped, to mistakeTags', async () => {
    await repos.mistakeProposals.record(A, [{ tag: 'late_carry', count: 1, lastSeen: AT }]);
    const before = await repos.styleCards.latest(A);
    expect(before!.mistakeTags).not.toContain('late_carry');
    const result = await repos.mistakeProposals.approve(A, 'late_carry');
    expect(result.approved).toBe(true);
    expect(result.card!.mistakeTags).toEqual([...before!.mistakeTags, 'late_carry']);
    expect(result.card!.version).toBe(before!.version + 1);
    // The tag is absent from every earlier version, present only in the new one.
    const prior = await repos.styleCards.get(A, before!.id);
    expect(prior!.mistakeTags).not.toContain('late_carry');
    const latest = await repos.styleCards.latest(A);
    expect(latest).toEqual(result.card);
  });

  it('a race of two concurrent approve calls for the same tag: one wins, the other no-ops', async () => {
    await repos.mistakeProposals.record(A, [{ tag: 'race_tag', count: 1, lastSeen: AT }]);
    const before = await repos.styleCards.latest(A);
    const [one, two] = await Promise.all([
      repos.mistakeProposals.approve(A, 'race_tag'),
      repos.mistakeProposals.approve(A, 'race_tag'),
    ]);
    const outcomes = [one, two].sort((x, y) => Number(y.approved) - Number(x.approved));
    expect(outcomes[0]).toEqual({ approved: true, card: outcomes[0]!.card });
    expect(outcomes[1]).toEqual({ approved: false, card: null });
    const after = await repos.styleCards.latest(A);
    expect(after!.version).toBe(before!.version + 1);
  });

  it('concurrent approvals of two different tags for the same teacher both land in mistakeTags (6.3f fix round 1)', async () => {
    await repos.mistakeProposals.record(A, [
      { tag: 'concurrent_tag_one', count: 1, lastSeen: AT },
      { tag: 'concurrent_tag_two', count: 1, lastSeen: AT },
    ]);
    const before = await repos.styleCards.latest(A);
    const [one, two] = await Promise.all([
      repos.mistakeProposals.approve(A, 'concurrent_tag_one'),
      repos.mistakeProposals.approve(A, 'concurrent_tag_two'),
    ]);
    expect(one.approved).toBe(true);
    expect(two.approved).toBe(true);
    const after = await repos.styleCards.latest(A);
    expect(after!.version).toBe(before!.version + 2);
    expect(after!.mistakeTags).toContain('concurrent_tag_one');
    expect(after!.mistakeTags).toContain('concurrent_tag_two');
    const pending = await repos.mistakeProposals.listPending(A);
    expect(pending.map((p) => p.tag)).not.toContain('concurrent_tag_one');
    expect(pending.map((p) => p.tag)).not.toContain('concurrent_tag_two');
  });

  it('reject marks a pending proposal rejected and never touches style_cards', async () => {
    await repos.mistakeProposals.record(A, [{ tag: 'reject_only', count: 1, lastSeen: AT }]);
    const before = await repos.styleCards.latest(A);
    const result = await repos.mistakeProposals.reject(A, 'reject_only');
    expect(result).toEqual({ rejected: true });
    const after = await repos.styleCards.latest(A);
    expect(after).toEqual(before);
    expect((await repos.mistakeProposals.listPending(A)).map((p) => p.tag)).not.toContain(
      'reject_only',
    );
  });

  it('record over MISTAKE_PROPOSAL_PATCH_MAX is invalid before any row is touched', async () => {
    const patch = Array.from({ length: MISTAKE_PROPOSAL_PATCH_MAX + 1 }, (_, i) => ({
      tag: `bulk_${i}`,
      count: 1,
      lastSeen: AT,
    }));
    expect(await failure(repos.mistakeProposals.record(A, patch))).toEqual({
      kind: 'invalid',
      method: 'mistakeProposals.record',
    });
    const pending = await repos.mistakeProposals.listPending(A);
    expect(pending.some((p) => p.tag === 'bulk_0')).toBe(false);
  });

  it('a teacher already at MISTAKE_PROPOSALS_MAX stored rows gets limit on a record that adds a new tag, no partial write', async () => {
    const existing = await repos.mistakeProposals.listPending(B);
    const toFill = MISTAKE_PROPOSALS_MAX - existing.length;
    for (let i = 0; i < toFill; i += 1) {
      await repos.mistakeProposals.record(B, [{ tag: `fill_${i}`, count: 1, lastSeen: AT }]);
    }
    const rowCount = async () =>
      Number(
        (
          await raw.query<{ n: string }>(
            'select count(*) as n from mistake_tag_proposals where teacher_id = $1',
            [B.teacherId],
          )
        ).rows[0]?.n,
      );
    expect(await rowCount()).toBe(MISTAKE_PROPOSALS_MAX);
    expect(
      await failure(
        repos.mistakeProposals.record(B, [{ tag: 'over_limit', count: 1, lastSeen: AT }]),
      ),
    ).toEqual({ kind: 'limit', method: 'mistakeProposals.record' });
    expect(await rowCount()).toBe(MISTAKE_PROPOSALS_MAX);
    // A patch that only touches already-stored pending tags (no new tag) still succeeds at the cap.
    await expect(
      repos.mistakeProposals.record(B, [{ tag: 'fill_0', count: 1, lastSeen: LATER }]),
    ).resolves.toBeUndefined();
  });

  it('approve/reject for an existing non-teacher user is scope, not not_found', async () => {
    expect(
      await failure(repos.mistakeProposals.approve({ teacherId: 'stu_mp_c' }, 'any_tag')),
    ).toEqual({ kind: 'scope', method: 'mistakeProposals.approve' });
    expect(
      await failure(repos.mistakeProposals.reject({ teacherId: 'stu_mp_c' }, 'any_tag')),
    ).toEqual({ kind: 'scope', method: 'mistakeProposals.reject' });
  });

  it('approve is not_found when the teacher has no style card yet', async () => {
    const D = { teacherId: 'tch_mp_d' };
    await repos.mistakeProposals.record(D, [{ tag: 'no_card_tag', count: 1, lastSeen: AT }]);
    expect(await failure(repos.mistakeProposals.approve(D, 'no_card_tag'))).toEqual({
      kind: 'not_found',
      method: 'mistakeProposals.approve',
    });
  });

  it('reject on an already-decided proposal is a no-op, not an error', async () => {
    await repos.mistakeProposals.record(A, [{ tag: 'already_rejected', count: 1, lastSeen: AT }]);
    expect(await repos.mistakeProposals.reject(A, 'already_rejected')).toEqual({
      rejected: true,
    });
    expect(await repos.mistakeProposals.reject(A, 'already_rejected')).toEqual({
      rejected: false,
    });
  });

  it('approve/reject/listPending for another teacher is not_found/scope', async () => {
    await repos.mistakeProposals.record(A, [{ tag: 'owned_by_a', count: 1, lastSeen: AT }]);
    expect(await failure(repos.mistakeProposals.approve(B, 'owned_by_a'))).toEqual({
      kind: 'not_found',
      method: 'mistakeProposals.approve',
    });
    expect(await failure(repos.mistakeProposals.reject(B, 'owned_by_a'))).toEqual({
      kind: 'not_found',
      method: 'mistakeProposals.reject',
    });
    expect((await repos.mistakeProposals.listPending(B)).some((p) => p.tag === 'owned_by_a')).toBe(
      false,
    );
    expect(
      await failure(repos.mistakeProposals.approve({ teacherId: 'stu_x' }, 'owned_by_a')),
    ).toEqual({ kind: 'not_found', method: 'mistakeProposals.approve' });
    expect(
      await failure(repos.mistakeProposals.reject({ teacherId: 'stu_x' }, 'owned_by_a')),
    ).toEqual({ kind: 'not_found', method: 'mistakeProposals.reject' });
  });

  it('approve refuses a 21st tag past STYLE_CARD_LIMITS.tagsMax; no new style-card version', async () => {
    const E = { teacherId: 'tch_mp_e' };
    const tagsAtCap = Array.from({ length: STYLE_CARD_LIMITS.tagsMax }, (_, i) => `cap_${i}`);
    await repos.styleCards.create(E, { text: '[E] style', mistakeTags: tagsAtCap });
    await repos.mistakeProposals.record(E, [{ tag: 'one_too_many', count: 1, lastSeen: AT }]);
    const before = await repos.styleCards.latest(E);
    expect(await failure(repos.mistakeProposals.approve(E, 'one_too_many'))).toEqual({
      kind: 'limit',
      method: 'mistakeProposals.approve',
    });
    const after = await repos.styleCards.latest(E);
    expect(after).toEqual(before);
    expect((await repos.mistakeProposals.listPending(E)).map((p) => p.tag)).toContain(
      'one_too_many',
    );
  });

  it('record for an existing non-teacher user is scope, not a silent write', async () => {
    expect(
      await failure(
        repos.mistakeProposals.record({ teacherId: 'stu_mp_c' }, [
          { tag: 'student_cannot_record', count: 1, lastSeen: AT },
        ]),
      ),
    ).toEqual({ kind: 'scope', method: 'mistakeProposals.record' });
    const rowCount = Number(
      (
        await raw.query<{ n: string }>(
          'select count(*) as n from mistake_tag_proposals where teacher_id = $1',
          ['stu_mp_c'],
        )
      ).rows[0]?.n,
    );
    expect(rowCount).toBe(0);
  });

  it('record for a teacherId with no such user is not_found, not a silent write', async () => {
    expect(
      await failure(
        repos.mistakeProposals.record({ teacherId: 'no_such_user_mp' }, [
          { tag: 'never_written', count: 1, lastSeen: AT },
        ]),
      ),
    ).toEqual({ kind: 'not_found', method: 'mistakeProposals.record' });
  });

  it('concurrent record calls for the same teacher never push the stored row count over MISTAKE_PROPOSALS_MAX', async () => {
    const G = { teacherId: 'tch_mp_g' };
    const batchSize = 40;
    const batch = (prefix: string) =>
      Array.from({ length: batchSize }, (_, i) => ({
        tag: `${prefix}_${i}`,
        count: 1,
        lastSeen: AT,
      }));
    // Three concurrent batches of 40 distinct new tags each (120 total) against a 100-row cap,
    // starting from zero rows for this teacher: without a lock serialising the count check against
    // the write, each of the three transactions can see "0 existing" and all three would pass.
    const settled = await Promise.allSettled([
      repos.mistakeProposals.record(G, batch('race_x')),
      repos.mistakeProposals.record(G, batch('race_y')),
      repos.mistakeProposals.record(G, batch('race_z')),
    ]);
    const rowCount = Number(
      (
        await raw.query<{ n: string }>(
          'select count(*) as n from mistake_tag_proposals where teacher_id = $1',
          [G.teacherId],
        )
      ).rows[0]?.n,
    );
    expect(rowCount).toBeLessThanOrEqual(MISTAKE_PROPOSALS_MAX);
    // 6.3f fix round 1 (LOW): 120 tags against a 100-row cap means the lock must have actually
    // refused at least one of the three batches, not merely left the count under the cap by luck.
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(RepositoryError);
      expect((r as PromiseRejectedResult).reason).toMatchObject({ kind: 'limit' });
    }
  });

  it('record with a lastSeen that is not a valid offset-bearing ISO datetime is invalid; no row written', async () => {
    expect(
      await failure(
        repos.mistakeProposals.record(A, [
          { tag: 'bad_last_seen', count: 1, lastSeen: 'not-a-date' },
        ]),
      ),
    ).toEqual({ kind: 'invalid', method: 'mistakeProposals.record' });
    expect((await repos.mistakeProposals.listPending(A)).map((p) => p.tag)).not.toContain(
      'bad_last_seen',
    );
  });
});
