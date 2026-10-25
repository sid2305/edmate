// Task 13.3a: security headers against the real `next dev` e2e server (playwright.config.ts,
// NODE_ENV unset -> development, so no HSTS assertion here -- proxy.test.ts covers that).
import { expect, test } from '@playwright/test';

test.describe('security headers', () => {
  test('/ sets the four security headers', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/`);
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBeTruthy();
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  });

  test('/api/health sets the four security headers', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/health`);
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBeTruthy();
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  });
});
