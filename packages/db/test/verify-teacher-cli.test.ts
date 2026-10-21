// Task 8.1: `db:verify-teacher` argument parsing and redacted failures. The identity store and the
// profile repository are fakes; teacher-profiles.int.test.ts covers setVerification on Postgres.
import { describe, expect, it, vi } from 'vitest';
import { runVerifyTeacherCli, type OpenVerify } from '../src/cli.js';
import {
  type IdentityStore,
  type IdentityUser,
  RepositoryError,
  type TeacherProfileRow,
} from '../src/index.js';

const URL_WITH_PASSWORD = 'postgres://edmate:hunter2-secret@127.0.0.1:5432/edmate';
const EMAIL = 'fictional.teacher@example.test';
const USER: IdentityUser = {
  id: 'usr_t1',
  role: 'teacher',
  email: EMAIL,
  emailVerifiedAt: null,
  name: 'Fictional Teacher',
};
const PROFILE: TeacherProfileRow = {
  id: 'tp_1',
  teacherId: 'usr_t1',
  slug: 'fictional-teacher',
  subject: 'Maths',
  bio: '',
  languages: ['en'],
  verificationStatus: 'pending',
};

function fakeOpen(
  identityOverrides: Partial<IdentityStore> = {},
  setVerification?: (...a: unknown[]) => Promise<TeacherProfileRow>,
) {
  const close = vi.fn(async () => undefined);
  const identity = {
    getUserByEmail: vi.fn(async () => USER),
    ...identityOverrides,
  } as unknown as IdentityStore;
  const teacherProfiles = {
    setVerification: vi.fn(
      setVerification ??
        (async (_s: unknown, v: { status: TeacherProfileRow['verificationStatus'] }) => ({
          ...PROFILE,
          verificationStatus: v.status,
        })),
    ),
  };
  const open: OpenVerify = vi.fn(() => ({ identity, teacherProfiles, close }));
  return { open, identity, teacherProfiles, close };
}

async function run(argv: string[], open: OpenVerify, env = { DATABASE_URL: URL_WITH_PASSWORD }) {
  const lines: string[] = [];
  const code = await runVerifyTeacherCli(argv, env, (l) => lines.push(l), open);
  return { code, out: lines.join('\n') };
}

const GOOD = ['--email', EMAIL, '--status', 'verified', '--by', 'stf_1'];

describe('db:verify-teacher', () => {
  it('verifies the teacher by email and prints the new status, never the email', async () => {
    const f = fakeOpen();
    const { code, out } = await run(['--', ...GOOD, '--reason', 'documents checked'], f.open);
    expect(code).toBe(0);
    expect(out).toBe('db:verify-teacher: teacher usr_t1 is now verified');
    expect(out).not.toContain(EMAIL);
    expect(f.identity.getUserByEmail).toHaveBeenCalledWith(EMAIL);
    expect(f.teacherProfiles.setVerification).toHaveBeenCalledWith(
      { teacherId: 'usr_t1' },
      { status: 'verified', by: 'stf_1', reason: 'documents checked' },
    );
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('rejects with no reason given', async () => {
    const f = fakeOpen();
    const { code, out } = await run(
      ['--email', EMAIL, '--status', 'rejected', '--by', 'stf_1'],
      f.open,
    );
    expect(code).toBe(0);
    expect(out).toBe('db:verify-teacher: teacher usr_t1 is now rejected');
    expect(f.teacherProfiles.setVerification).toHaveBeenCalledWith(
      { teacherId: 'usr_t1' },
      { status: 'rejected', by: 'stf_1' },
    );
  });

  it.each([
    ['no arguments', []],
    ['a missing --by', ['--email', EMAIL, '--status', 'verified']],
    ['a missing --status', ['--email', EMAIL, '--by', 'stf_1']],
    ['an unknown flag', [...GOOD, '--force']],
    ['a positional', [...GOOD, 'extra']],
    ['a flag with no value', ['--email', EMAIL, '--status', 'verified', '--by']],
  ])('prints usage and exits 1 on %s, without opening the database', async (_l, argv) => {
    const f = fakeOpen();
    const { code, out } = await run(argv, f.open);
    expect(code).toBe(1);
    expect(out).toMatch(/^db:verify-teacher: usage: /);
    expect(out).not.toContain(EMAIL);
    expect(f.open).not.toHaveBeenCalled();
  });

  it.each(['pending', 'approved'])(
    'rejects --status %s without opening the database',
    async (s) => {
      const f = fakeOpen();
      const { code, out } = await run(['--email', EMAIL, '--status', s, '--by', 'stf_1'], f.open);
      expect(code).toBe(1);
      expect(out).toBe('db:verify-teacher: --status must be one of verified, rejected');
      expect(f.open).not.toHaveBeenCalled();
    },
  );

  it('needs DATABASE_URL', async () => {
    const f = fakeOpen();
    const { code, out } = await run(GOOD, f.open, { DATABASE_URL: '' });
    expect(code).toBe(1);
    expect(out).toBe('db:verify-teacher: DATABASE_URL is not set');
    expect(f.open).not.toHaveBeenCalled();
  });

  it('exits 1 when no user has the email, without verifying', async () => {
    const f = fakeOpen({ getUserByEmail: vi.fn(async () => null) });
    const { code, out } = await run(GOOD, f.open);
    expect(code).toBe(1);
    expect(out).toBe('db:verify-teacher: no user has that email');
    expect(f.teacherProfiles.setVerification).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('a non-staff --by surfaces the repository scope failure on one line', async () => {
    const f = fakeOpen({}, async () => {
      throw new RepositoryError('scope', 'teacherProfiles.setVerification');
    });
    const { code, out } = await run(GOOD, f.open);
    expect(code).toBe(1);
    expect(out).toBe('db:verify-teacher: failed: teacherProfiles.setVerification: scope');
    expect(out).not.toContain(EMAIL);
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('a teacher with no profile surfaces not_found', async () => {
    const f = fakeOpen({}, async () => {
      throw new RepositoryError('not_found', 'teacherProfiles.setVerification');
    });
    expect((await run(GOOD, f.open)).out).toBe(
      'db:verify-teacher: failed: teacherProfiles.setVerification: not_found',
    );
  });

  it('redacts a connection string in a failure and still closes', async () => {
    const f = fakeOpen({
      getUserByEmail: vi.fn(async () => {
        throw new Error(`connect failed for ${URL_WITH_PASSWORD}`);
      }),
    });
    const { code, out } = await run(GOOD, f.open);
    expect(code).toBe(1);
    expect(out).toBe('db:verify-teacher: failed: connect failed for postgres://<redacted>');
    expect(out).not.toContain('hunter2');
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('reports a non-Error throw and a failing open', async () => {
    const f = fakeOpen({
      getUserByEmail: vi.fn(async () => {
        throw 'plain string';
      }),
    });
    expect((await run(GOOD, f.open)).out).toBe('db:verify-teacher: failed: plain string');
    const throwingOpen: OpenVerify = () => {
      throw new Error(`bad url ${URL_WITH_PASSWORD}`);
    };
    const r = await run(GOOD, throwingOpen);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain('hunter2');
  });

  it('ignores a failing close', async () => {
    const f = fakeOpen();
    f.close.mockRejectedValueOnce(new Error('already closed'));
    expect((await run(GOOD, f.open)).code).toBe(0);
  });

  it('opens a real pool lazily by default (no connection until a query)', async () => {
    const lines: string[] = [];
    const code = await runVerifyTeacherCli(
      GOOD,
      { DATABASE_URL: 'postgres://u:pw-secret@127.0.0.1:9/none' },
      (l) => lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).not.toContain('pw-secret');
  });
});
