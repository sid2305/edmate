// Task 1.5: `corepack pnpm seed` (runSeedCli) with a fake seed; seed.int.test.ts runs the real one.
import { describe, expect, it, vi } from 'vitest';
import { runSeedCli, type RunSeed } from '../src/cli.js';
import type { SeedResult } from '../src/seed.js';

const URL_WITH_PASSWORD = 'postgres://edmate:hunter2-secret@127.0.0.1:5432/edmate';

const zero = {
  users: 0,
  teacherProfiles: 0,
  courses: 0,
  modules: 0,
  styleCards: 0,
  agents: 0,
  agentVersions: 0,
  packages: 0,
  packageVersions: 0,
  subscriptions: 0,
};

async function run(seed: RunSeed, env: Record<string, string | undefined>) {
  const lines: string[] = [];
  const code = await runSeedCli(env, (l) => lines.push(l), seed);
  return { code, out: lines.join('\n') };
}

describe('seed CLI', () => {
  it('needs DATABASE_URL', async () => {
    const seed = vi.fn();
    const { code, out } = await run(seed, {});
    expect(code).toBe(1);
    expect(out).toBe('seed: DATABASE_URL is not set');
    expect(seed).not.toHaveBeenCalled();
  });

  it('prints what each table got and passes the content dir override', async () => {
    const result: SeedResult = { inserted: { ...zero, users: 21, modules: 5 }, drift: [] };
    const seed: RunSeed = vi.fn(async () => result);
    const { code, out } = await run(seed, {
      DATABASE_URL: URL_WITH_PASSWORD,
      EDMATE_SEED_CONTENT_DIR: '/tmp/fixture',
    });
    expect(code).toBe(0);
    expect(seed).toHaveBeenCalledWith(URL_WITH_PASSWORD, { contentDir: '/tmp/fixture' });
    expect(out).toContain('seed: inserted 26 rows');
    expect(out).toContain('users=21');
    expect(out).toContain('modules=5');
    expect(out).not.toContain('hunter2');
  });

  it('says "already seeded" when nothing was inserted', async () => {
    const seed: RunSeed = vi.fn(async () => ({ inserted: zero, drift: [] }));
    const { code, out } = await run(seed, { DATABASE_URL: URL_WITH_PASSWORD });
    expect(code).toBe(0);
    expect(seed).toHaveBeenCalledWith(URL_WITH_PASSWORD, {});
    expect(out).toContain('seed: already seeded (inserted 0 rows)');
  });

  it('warns about drift but still succeeds', async () => {
    const seed: RunSeed = vi.fn(async () => ({ inserted: zero, drift: ['styleCards demo-x'] }));
    const { code, out } = await run(seed, { DATABASE_URL: URL_WITH_PASSWORD });
    expect(code).toBe(0);
    expect(out).toContain(
      'seed: warning: existing row differs from content, left as is: styleCards demo-x',
    );
  });

  it('fails with a redacted message', async () => {
    const seed: RunSeed = vi.fn(async () => {
      throw new Error(`connect failed for ${URL_WITH_PASSWORD}`);
    });
    const { code, out } = await run(seed, { DATABASE_URL: URL_WITH_PASSWORD });
    expect(code).toBe(1);
    expect(out).toMatch(/^seed: failed: /);
    expect(out).not.toContain('hunter2');
  });

  it('fails on a non-Error throw too', async () => {
    const seed: RunSeed = vi.fn(async () => {
      throw 'boom';
    });
    const { code, out } = await run(seed, { DATABASE_URL: URL_WITH_PASSWORD });
    expect(code).toBe(1);
    expect(out).toBe('seed: failed: boom');
  });
});
