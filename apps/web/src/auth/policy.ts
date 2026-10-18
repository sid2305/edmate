// The route policy table (task 1.3), built from the build plan's API surface `Who` column. Deny by
// default: a method + path that matches no row is denied for everyone. There is no role
// inheritance: staff are not a superuser on student or teacher routes.
import type { Role } from '@edmate/db';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export const METHODS: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Who may call: anyone, a signed webhook (no session), or signed-in users with one of the roles. */
export type Access = 'public' | 'provider' | readonly Role[];

export interface PolicyRow {
  /** `/`-separated; `*` is one segment, a trailing `**` is one or more segments. */
  pattern: string;
  methods: readonly Method[];
  access: Access;
}

export const ROUTE_POLICY: readonly PolicyRow[] = [
  { pattern: '/api/health', methods: ['GET'], access: 'public' },
  // Auth.js's own endpoints (sign-in, callback, session, csrf, sign-out); CSRF-protected by it.
  { pattern: '/api/auth/**', methods: ['GET', 'POST'], access: 'public' },
  { pattern: '/api/teachers', methods: ['GET'], access: 'public' },
  { pattern: '/api/teachers/*', methods: ['GET'], access: 'public' },
  // Signature checks come with the payment webhooks (10.x).
  { pattern: '/api/webhooks/**', methods: ['POST'], access: 'provider' },
  { pattern: '/api/subscriptions', methods: ['POST'], access: ['student'] },
  { pattern: '/api/subscriptions/*', methods: ['PATCH'], access: ['student'] },
  { pattern: '/api/sessions', methods: ['POST'], access: ['student'] },
  { pattern: '/api/sessions/**', methods: ['POST'], access: ['student'] },
  { pattern: '/api/me', methods: ['DELETE'], access: ['student'] },
  { pattern: '/api/me/**', methods: ['GET'], access: ['student'] },
  { pattern: '/api/studio/**', methods: ['GET', 'POST', 'PUT'], access: ['teacher'] },
  { pattern: '/api/staff/**', methods: ['GET', 'POST'], access: ['staff'] },
];

/** Path segments, or null for a path we refuse to match (empty or dot segments, encoded slashes). */
function segments(path: string): string[] | null {
  if (!path.startsWith('/')) return null;
  const parts = path.slice(1).split('/');
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..' || /%(2f|5c|2e)/i.test(p)) return null;
  }
  return parts;
}

function matches(pattern: string, parts: readonly string[]): boolean {
  const pat = pattern.slice(1).split('/');
  for (let i = 0; i < pat.length; i += 1) {
    const p = pat[i];
    if (p === '**') return i === pat.length - 1 && parts.length > i;
    if (i >= parts.length) return false;
    if (p !== '*' && p !== parts[i]) return false;
  }
  return parts.length === pat.length;
}

/**
 * The access of the first row matching the method and path, or `null` (deny) when none does. HEAD
 * is treated as GET (Next.js answers HEAD with the GET handler).
 */
export function policyFor(method: string, path: string): Access | null {
  const m = (method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase()) as Method;
  const parts = segments(path);
  if (!parts) return null;
  for (const row of ROUTE_POLICY) {
    if (row.methods.includes(m) && matches(row.pattern, parts)) return row.access;
  }
  return null;
}

/** Whether two access values are the same (role lists compared as sets). */
export function sameAccess(a: Access, b: Access): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((r) => b.includes(r));
}
