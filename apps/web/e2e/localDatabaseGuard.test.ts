import { describe, expect, it } from 'vitest';
import { assertLocalDatabaseUrl } from './localDatabaseGuard';

describe('assertLocalDatabaseUrl', () => {
  it.each([
    'postgres://127.0.0.1:55432/edmate',
    'postgres://localhost:55432/edmate',
    'postgres://[::1]:55432/edmate',
  ])('allows a local host (%s)', (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    'postgres://postgres:5432/edmate',
    'postgres://prod-db.example.com:5432/edmate',
    'postgres://evil.invalid:5432/edmate',
    'postgres://10.0.0.5:5432/edmate',
  ])('refuses a non-local host (%s)', (url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow(/refuses a non-local TEST_DATABASE_URL host/);
  });

  it('throws on an unparseable URL rather than writing anywhere', () => {
    expect(() => assertLocalDatabaseUrl('not-a-url')).toThrow();
  });
});
