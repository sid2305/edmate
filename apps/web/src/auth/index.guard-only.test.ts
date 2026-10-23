// Task 1.4d: the guard helpers (`withRole`/`publicRoute`/`providerRoute`/`requireRole` and the
// path constants) must import without reaching `ioredis` or `nodemailer` -- about 30 route files
// want only these and should never pull in either package just by importing `./index`. Unlike
// index.test.ts, this file does NOT mock ioredis/nodemailer to fake implementations; it makes
// each one throw on import, so importing `./index` alone (never calling anything that reaches
// `getRuntime()`'s email path) must not throw.
import { describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => {
  throw new Error('guard-only code must not import ioredis');
});
vi.mock('nodemailer', () => {
  throw new Error('guard-only code must not import nodemailer');
});

// This cold-imports next-auth (and the rest of index.ts's import graph) with no warm module
// cache; CI and a loaded machine are slower than a warm local run (same reason index.test.ts
// gives its own cold-import cases a longer bound).
const COLD_IMPORT_TIMEOUT_MS = 20_000;

describe('src/auth/index.ts: guard-only exports load without ioredis or nodemailer', () => {
  it(
    'imports the guard helpers and path constants without throwing',
    async () => {
      const auth = await import('./index');
      expect(typeof auth.withRole).toBe('function');
      expect(typeof auth.publicRoute).toBe('function');
      expect(typeof auth.providerRoute).toBe('function');
      expect(typeof auth.requireRole).toBe('function');
      expect(typeof auth.HOME_PATH).toBe('string');
      expect(typeof auth.SIGN_IN_PATH).toBe('string');
      expect(typeof auth.TEACHER_PATH).toBe('string');
    },
    COLD_IMPORT_TIMEOUT_MS,
  );
});
