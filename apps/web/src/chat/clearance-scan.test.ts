// Task 9.4 Phase C: a source scan for the 9.1 lead requirement. Every file under app/learn/** and
// src/chat/** that guards a page (`requireRole`) or is a server action (`'use server'`) must ask
// for `clearance: 'agent'` (consent done). A bare `requireRole(['student'])` fails.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const ROOTS = ['app/learn', 'src/chat'];
const SELF = fileURLToPath(import.meta.url);

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** A problem with one source text, or null when it is fine. */
export function clearanceProblem(text: string): string | null {
  const guarded = /\brequireRole\s*\(/.test(text) || /^\s*['"]use server['"]/m.test(text);
  if (!guarded) return null;
  const calls = [...text.matchAll(/\brequireRole\s*\(([^)]*\))/g)];
  if (calls.length === 0) return 'a server action with no requireRole';
  const bare = calls.find((m) => !/clearance:\s*['"]agent['"]/.test(m[1] ?? ''));
  return bare === undefined ? null : `requireRole without clearance 'agent': ${bare[0]}`;
}

describe('clearance scan (app/learn/**, src/chat/**)', () => {
  it('every guarded file asks for clearance: agent', () => {
    const files = ROOTS.flatMap((r) => filesUnder(join(WEB, r))).filter((f) => f !== SELF);
    expect(files.some((f) => f.includes(join('app', 'learn')))).toBe(true);
    const problems = files.flatMap((f) => {
      const p = clearanceProblem(readFileSync(f, 'utf8'));
      return p === null ? [] : [`${relative(WEB, f)}: ${p}`];
    });
    expect(problems).toEqual([]);
  });

  it('the scan catches a bare requireRole, a wrong clearance and an unguarded server action', () => {
    expect(clearanceProblem("await requireRole(['student']);")).toMatch(/without clearance/);
    expect(clearanceProblem("await requireRole(['student'], { clearance: 'age' });")).toMatch(/without/);
    expect(clearanceProblem("'use server';\nexport async function act() {}")).toMatch(/no requireRole/);
    expect(clearanceProblem("requireRole(['student'], { clearance: 'agent' })")).toBeNull();
    expect(clearanceProblem('export const x = 1;')).toBeNull();
  });
});
