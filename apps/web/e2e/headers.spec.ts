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

  test('/ hydrates under the real CSP with no violations, and Next nonces its own scripts', async ({
    page,
    baseURL,
  }) => {
    // Regression for the bug this fix round closes: the CSP was set only on the response, so
    // Next's own inline bootstrap/hydration <script> tags got no nonce and 'strict-dynamic'
    // blocked them silently (no console error from the page's own JS, only a CSP violation).
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __cspViolations: string[] }).__cspViolations ??= [];
        (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
          `${e.violatedDirective}: ${e.blockedURI}`,
        );
      });
    });
    const consoleCspMessages: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Content Security Policy')) consoleCspMessages.push(msg.text());
    });

    const res = await page.goto(`${baseURL}/`);
    const responseCsp = res?.headers()['content-security-policy'] ?? '';
    const nonce = responseCsp.match(/nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();

    // Give any deferred/hydration scripts a moment to run and report violations, if any.
    await page.waitForLoadState('networkidle');
    const violations = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    );
    expect(violations).toEqual([]);
    expect(consoleCspMessages).toEqual([]);

    // Browsers hide the `nonce` *content attribute* after parsing (getAttribute returns '') to
    // stop CSS-selector exfiltration; the IDL property `.nonce` still returns the real value.
    const scriptNonces = await page.evaluate(() =>
      Array.from(document.scripts)
        .map((s) => s.nonce)
        .filter((n): n is string => Boolean(n)),
    );
    expect(scriptNonces.length).toBeGreaterThan(0);
    expect(scriptNonces).toContain(nonce);
  });
});
