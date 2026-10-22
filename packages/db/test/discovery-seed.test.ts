// Task 9.2 Phase A, unit (no database): buildDiscoverySeed is pure and deterministic, and the
// seed-discovery CLI refuses to run in production or without an explicit, well-formed count
// before it ever opens a database connection. See discovery.int.test.ts for the real seed on
// Postgres.
import { describe, expect, it } from 'vitest';
import { PackageConfigSchema } from '@edmate/contracts';
import { runSeedDiscoveryCli } from '../src/cli.js';
import { buildDiscoverySeed } from '../src/discovery-seed.js';

describe('buildDiscoverySeed', () => {
  it('is deterministic: the same n builds identical rows', () => {
    expect(buildDiscoverySeed(200)).toEqual(buildDiscoverySeed(200));
  });

  it('gives 200 distinct slugs, all prefixed seed-, and example.invalid emails', () => {
    const { users, teacherProfiles } = buildDiscoverySeed(200);
    expect(users).toHaveLength(200);
    const slugs = teacherProfiles.map((t) => t.slug!);
    expect(new Set(slugs).size).toBe(200);
    for (const slug of slugs) expect(slug.startsWith('seed-')).toBe(true);
    for (const u of users) expect(u.email).toMatch(/@example\.invalid$/);
  });

  it('every teacher is verified with a live agent', () => {
    const { teacherProfiles, agents } = buildDiscoverySeed(50);
    for (const t of teacherProfiles) expect(t.verificationStatus).toBe('verified');
    for (const a of agents) {
      expect(a.status).toBe('live');
      expect(a.liveVersion).toBe(1);
    }
  });

  it('every package config passes PackageConfigSchema', () => {
    const { packageVersions } = buildDiscoverySeed(50);
    expect(packageVersions.length).toBeGreaterThan(50);
    for (const pv of packageVersions) {
      expect(() => PackageConfigSchema.parse(pv.config)).not.toThrow();
    }
  });
});

describe('seed-discovery CLI refuses before touching a database', () => {
  it('refuses in production', async () => {
    const lines: string[] = [];
    const code = await runSeedDiscoveryCli(
      ['--fake-teachers', '10'],
      { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none', NODE_ENV: 'production' },
      (l) => lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/production/);
  });

  it('refuses without --fake-teachers', async () => {
    const lines: string[] = [];
    const code = await runSeedDiscoveryCli(
      [],
      { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none', NODE_ENV: 'test' },
      (l) => lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/usage/);
  });

  it('refuses a non-numeric or non-positive --fake-teachers', async () => {
    for (const bad of ['0', '-1', 'abc', '1.5']) {
      const lines: string[] = [];
      const code = await runSeedDiscoveryCli(
        ['--fake-teachers', bad],
        { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none', NODE_ENV: 'test' },
        (l) => lines.push(l),
      );
      expect(code, bad).toBe(1);
    }
  });

  it('needs DATABASE_URL (checked after the flag, still before any connection)', async () => {
    const lines: string[] = [];
    const code = await runSeedDiscoveryCli(['--fake-teachers', '10'], { NODE_ENV: 'test' }, (l) =>
      lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/DATABASE_URL/);
  });
});
