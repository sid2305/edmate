// Task 13.3a: proxy.ts's nonce/CSP/HSTS logic, called directly (no dev server) with a
// constructed NextRequest, the pattern src/auth/rate-limit.test.ts uses.
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCsp, proxy, storageOrigin } from './proxy';

function req(url = 'http://localhost:3000/'): NextRequest {
  return new NextRequest(url);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildCsp', () => {
  it('builds every expected directive, with the nonce only in script-src', () => {
    const csp = buildCsp('abc123');
    expect(csp).toContain(`script-src 'self' 'nonce-abc123' 'strict-dynamic'`);
    expect(csp).toContain(`style-src 'self' 'unsafe-inline'`);
    expect(csp).toContain(`connect-src 'self'`);
    expect(csp).toContain(`img-src 'self'`);
    expect(csp).toContain(`font-src 'self'`);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain(`base-uri 'self'`);
    expect(csp).toContain(`form-action 'self'`);
    expect(csp).toContain(`object-src 'none'`);
    expect(csp).toContain(`default-src 'self'`);
    // nonce never leaks into style-src or elsewhere
    expect(csp.match(/nonce-abc123/g)).toHaveLength(1);
  });

  it('adds unsafe-eval to script-src outside production only', () => {
    const dev = buildCsp('n', { NODE_ENV: 'development' });
    const prod = buildCsp('n', { NODE_ENV: 'production' });
    expect(dev).toContain(`'unsafe-eval'`);
    expect(prod).not.toContain(`'unsafe-eval'`);
  });

  it('adds the configured storage origin to connect-src', () => {
    const csp = buildCsp('n', { S3_PUBLIC_ENDPOINT: 'https://cdn.example.com' });
    expect(csp).toContain(`connect-src 'self' https://cdn.example.com`);
  });

  it('falls back to S3_ENDPOINT when S3_PUBLIC_ENDPOINT is unset', () => {
    const csp = buildCsp('n', { S3_ENDPOINT: 'http://minio.internal:9000' });
    expect(csp).toContain(`connect-src 'self' http://minio.internal:9000`);
  });

  it('falls back to self-only connect-src on a missing or malformed storage origin', () => {
    expect(buildCsp('n', {})).toContain(`connect-src 'self'`);
    expect(buildCsp('n', {})).not.toMatch(/connect-src 'self' \S/);
    const malformed = buildCsp('n', { S3_ENDPOINT: 'not a url' });
    expect(malformed).not.toMatch(/connect-src 'self' \S/);
    const nonHttp = buildCsp('n', { S3_ENDPOINT: 'ftp://example.com' });
    expect(nonHttp).not.toMatch(/connect-src 'self' \S/);
  });
});

describe('storageOrigin', () => {
  it('returns null with no setting', () => {
    expect(storageOrigin({})).toBeNull();
  });

  it('prefers S3_PUBLIC_ENDPOINT over S3_ENDPOINT', () => {
    expect(
      storageOrigin({
        S3_PUBLIC_ENDPOINT: 'https://public.example.com/ignored/path',
        S3_ENDPOINT: 'http://internal:9000',
      }),
    ).toBe('https://public.example.com');
  });
});

describe('proxy', () => {
  it('sets a per-request nonce (non-empty, different across calls) only via CSP + x-nonce', () => {
    const r1 = proxy(req());
    const r2 = proxy(req());
    const nonce1 = r1.headers.get('content-security-policy')?.match(/nonce-([^']+)'/)?.[1];
    const nonce2 = r2.headers.get('content-security-policy')?.match(/nonce-([^']+)'/)?.[1];
    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });

  it('sets Content-Security-Policy on the response', () => {
    const res = proxy(req());
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('sets HSTS only when NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const prod = proxy(req());
    expect(prod.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains',
    );

    vi.stubEnv('NODE_ENV', 'test');
    const nonProd = proxy(req());
    expect(nonProd.headers.get('strict-transport-security')).toBeNull();
  });

  it('never sends the preload directive', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = proxy(req());
    expect(res.headers.get('strict-transport-security')).not.toContain('preload');
  });
});
