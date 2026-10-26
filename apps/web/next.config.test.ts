// Task 13.3a: the three static security headers (X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy). Calls `headers()` directly, no dev server. The CSP/HSTS are proxy-owned
// (proxy.test.ts).
import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('next.config headers()', () => {
  it('sets X-Frame-Options, X-Content-Type-Options and Referrer-Policy on every path', async () => {
    const entries = await nextConfig.headers?.();
    expect(entries).toBeDefined();
    expect(entries).toHaveLength(1);
    const entry = entries![0]!;
    expect(entry.source).toBe('/(.*)');
    const byKey = new Map(entry.headers.map((h) => [h.key, h.value]));
    expect(byKey.get('X-Frame-Options')).toBe('DENY');
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('never sets Content-Security-Policy or Strict-Transport-Security here (proxy-owned)', async () => {
    const entries = await nextConfig.headers?.();
    const keys = entries![0]!.headers.map((h) => h.key);
    expect(keys).not.toContain('Content-Security-Policy');
    expect(keys).not.toContain('Strict-Transport-Security');
  });
});
