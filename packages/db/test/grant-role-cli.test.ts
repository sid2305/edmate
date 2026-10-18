// Task 1.3: `db:grant-role` argument parsing and redacted failures. The identity store is a fake;
// identity.int.test.ts covers grantRole itself on Postgres.
import { describe, expect, it, vi } from 'vitest';
import { runGrantRoleCli, type OpenIdentity } from '../src/cli.js';
import type { IdentityStore, IdentityUser } from '../src/index.js';

const URL_WITH_PASSWORD = 'postgres://edmate:hunter2-secret@127.0.0.1:5432/edmate';
const EMAIL = 'new.staff@example.test';
const USER: IdentityUser = {
  id: 'usr_1',
  role: 'student',
  email: EMAIL,
  emailVerifiedAt: null,
  name: 'New Staff',
};

function fakeOpen(overrides: Partial<IdentityStore> = {}) {
  const close = vi.fn(async () => undefined);
  const identity = {
    getUserByEmail: vi.fn(async () => USER),
    grantRole: vi.fn(async (g: { role: IdentityUser['role'] }) => ({ ...USER, role: g.role })),
    ...overrides,
  } as unknown as IdentityStore;
  const open: OpenIdentity = vi.fn(() => ({ identity, close }));
  return { open, identity, close };
}

async function run(argv: string[], open: OpenIdentity, env = { DATABASE_URL: URL_WITH_PASSWORD }) {
  const lines: string[] = [];
  const code = await runGrantRoleCli(argv, env, (l) => lines.push(l), open);
  return { code, out: lines.join('\n') };
}

const GOOD = ['--email', EMAIL, '--role', 'staff', '--by', 'operator'];

describe('db:grant-role', () => {
  it('grants the role by email and prints the user id, never the email', async () => {
    const f = fakeOpen();
    const { code, out } = await run(['--', ...GOOD, '--reason', 'bootstrap'], f.open);
    expect(code).toBe(0);
    expect(out).toBe('db:grant-role: user usr_1 is now staff');
    expect(out).not.toContain(EMAIL);
    expect(f.identity.getUserByEmail).toHaveBeenCalledWith(EMAIL);
    expect(f.identity.grantRole).toHaveBeenCalledWith({
      userId: 'usr_1',
      role: 'staff',
      by: 'operator',
      reason: 'bootstrap',
    });
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('passes no reason when none is given', async () => {
    const f = fakeOpen();
    expect((await run(GOOD, f.open)).code).toBe(0);
    expect(f.identity.grantRole).toHaveBeenCalledWith({
      userId: 'usr_1',
      role: 'staff',
      by: 'operator',
    });
  });

  it.each([
    ['no arguments', []],
    ['a missing --by', ['--email', EMAIL, '--role', 'staff']],
    ['an unknown flag', [...GOOD, '--force']],
    ['a positional', [...GOOD, 'extra']],
    ['a flag with no value', ['--email', EMAIL, '--role', 'staff', '--by']],
  ])('prints usage and exits 1 on %s, without opening the database', async (_l, argv) => {
    const f = fakeOpen();
    const { code, out } = await run(argv, f.open);
    expect(code).toBe(1);
    expect(out).toMatch(/^db:grant-role: usage: /);
    expect(f.open).not.toHaveBeenCalled();
  });

  it('rejects an unknown role', async () => {
    const f = fakeOpen();
    const { code, out } = await run(['--email', EMAIL, '--role', 'admin', '--by', 'x'], f.open);
    expect(code).toBe(1);
    expect(out).toBe('db:grant-role: --role must be one of student, teacher, staff');
  });

  it('needs DATABASE_URL', async () => {
    const f = fakeOpen();
    const { code, out } = await run(GOOD, f.open, { DATABASE_URL: '' });
    expect(code).toBe(1);
    expect(out).toBe('db:grant-role: DATABASE_URL is not set');
  });

  it('exits 1 when no user has the email, without granting', async () => {
    const f = fakeOpen({ getUserByEmail: vi.fn(async () => null) });
    const { code, out } = await run(GOOD, f.open);
    expect(code).toBe(1);
    expect(out).toContain('no user has that email');
    expect(out).not.toContain(EMAIL);
    expect(f.identity.grantRole).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('redacts a connection string in a failure and still closes', async () => {
    const f = fakeOpen({
      grantRole: vi.fn(async () => {
        throw new Error(`connect failed for ${URL_WITH_PASSWORD}`);
      }),
    });
    const { code, out } = await run(GOOD, f.open);
    expect(code).toBe(1);
    expect(out).toBe('db:grant-role: failed: connect failed for postgres://<redacted>');
    expect(out).not.toContain('hunter2');
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('reports a non-Error throw and a failing open', async () => {
    const f = fakeOpen({
      getUserByEmail: vi.fn(async () => {
        throw 'plain string';
      }),
    });
    expect((await run(GOOD, f.open)).out).toBe('db:grant-role: failed: plain string');
    const throwingOpen: OpenIdentity = () => {
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
    // The default opener builds a pool from the URL; a query to an unreachable host fails and is
    // redacted. Port 9 on localhost refuses at once.
    const lines: string[] = [];
    const code = await runGrantRoleCli(
      GOOD,
      { DATABASE_URL: 'postgres://u:pw-secret@127.0.0.1:9/none' },
      (l) => lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).not.toContain('pw-secret');
  });
});
