// Task 1.3: deny by default for real routes. Every `app/api/**/route.ts` is imported; each exported
// HTTP method must carry a guard brand (withRole, publicRoute or providerRoute) whose access equals
// the ROUTE_POLICY row for that method and path. An unwrapped or mismatched export fails here.
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUARD } from './guard';
import { policyFor, sameAccess, type Access } from './policy';

const APP = fileURLToPath(new URL('../../app', import.meta.url));
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return /^route\.(ts|tsx|js)$/.test(e.name) ? [p] : [];
  });
}

/** `app/api/teachers/[slug]/route.ts` → `/api/teachers/x`; catch-alls get two segments. */
export function samplePath(file: string): string {
  const dir = relative(APP, file).split(sep).slice(0, -1);
  return `/${dir
    .filter((s) => !/^\(.*\)$/.test(s)) // route groups don't appear in the URL
    .map((s) => (/^\[\[?\.\.\./.test(s) ? 'x/y' : /^\[.*\]$/.test(s) ? 'x' : s))
    .join('/')}`;
}

const files = routeFiles(join(APP, 'api'));
/** `api/auth/[...nextauth]/route.ts` cold-imports next-auth; CI is slower than a warm local cache. */
const ROUTE_IMPORT_TIMEOUT_MS = 20_000;

describe('every API route is guarded and in the policy', () => {
  it('finds the route files', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  for (const file of files) {
    const path = samplePath(file);
    // The auth catch-all route cold-imports next-auth; the rest are cheap.
    const timeout = path === '/api/auth/x/y' ? ROUTE_IMPORT_TIMEOUT_MS : undefined;
    it(
      path,
      async () => {
        const mod = (await import(file)) as Record<string, unknown>;
        const methods = HTTP_METHODS.filter((m) => m in mod);
        expect(methods.length, `${path} exports no HTTP method`).toBeGreaterThan(0);
        for (const m of methods) {
          const brand = (mod[m] as { [GUARD]?: Access } | undefined)?.[GUARD];
          expect(
            brand,
            `${m} ${path} is not wrapped in withRole/publicRoute/providerRoute`,
          ).toBeDefined();
          const policy = policyFor(m, path);
          expect(policy, `${m} ${path} has no ROUTE_POLICY row`).not.toBeNull();
          expect(sameAccess(brand!, policy!), `${m} ${path}: wrapper and policy disagree`).toBe(
            true,
          );
        }
      },
      timeout,
    );
  }

  it('maps dynamic segments to sample paths', () => {
    expect(samplePath(join(APP, 'api/teachers/[slug]/route.ts'))).toBe('/api/teachers/x');
    expect(samplePath(join(APP, 'api/auth/[...nextauth]/route.ts'))).toBe('/api/auth/x/y');
    expect(samplePath(join(APP, 'api/(group)/me/[[...rest]]/route.ts'))).toBe('/api/me/x/y');
  });
});
