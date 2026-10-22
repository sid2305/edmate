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

  it.each([
    'postgres://localhost:55432/edmate?host=prod-db.example.com',
    'postgres://localhost:55432/edmate?hostaddr=10.0.0.5',
    'postgres://localhost:55432/edmate?HOST=prod-db.example.com',
  ])('refuses a host/hostaddr query override (%s)', (url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow(/query parameter/);
  });

  it('allows a local host with an unrelated query parameter', () => {
    expect(() => assertLocalDatabaseUrl('postgres://localhost:55432/edmate?sslmode=disable')).not.toThrow();
  });

  it('allows an uppercase local host', () => {
    expect(() => assertLocalDatabaseUrl('postgres://LOCALHOST:55432/edmate')).not.toThrow();
  });
});
