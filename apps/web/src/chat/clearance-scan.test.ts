// Task 9.4 Phase C: a source scan for the 9.1 lead requirement, widened app-wide (1.7a, 1.7
// review deferral: any future requireRole(['student']) call site must say clearance: 'agent' or
// be a named exception, instead of silently defaulting to clearance: 'age'). Every
// `requireRole([...])` call whose role array contains 'student', anywhere under app/** or
// src/chat/**, must ask for `clearance: 'agent'`; a `['teacher']`/`['staff']` call is never
// flagged (those roles use a clearance the rule doesn't apply to). The separate "a server action
// with no requireRole at all" check stays scoped to app/learn/** and src/chat/** only: teacher
// and staff server actions legitimately call requireRole(['teacher']) etc. with no 'agent'
// clearance, so running this half of the check app-wide would flag nothing there (no bare
// student call), but running the "any requireRole present" half would also pass; it is scoped
// anyway, matching the plan precisely and keeping this test's intent narrow.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const ROOTS = ['app', 'src/chat'];
const SERVER_ACTION_CHECK_ROOTS = ['app/learn', 'src/chat'];
const SELF = fileURLToPath(import.meta.url);

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every `requireRole([...], ...)` call whose role array names 'student', with its full text. */
const STUDENT_REQUIRE_ROLE = /\brequireRole\s*\(\s*\[[^\]]*'student'[^\]]*\][^)]*\)/g;

/**
 * A problem with one source text, or null when it is fine. `checkServerAction` (default true)
 * gates the second, unrelated check: a bare `'use server'` file with no `requireRole` call of
 * any role at all. Pass `false` for a file outside `app/learn/**`/`src/chat/**`, where a
 * teacher/staff action's own role check doesn't need `clearance: 'agent'` and isn't this scan's
 * concern.
 */
export function clearanceProblem(text: string, checkServerAction = true): string | null {
  const studentCalls = [...text.matchAll(STUDENT_REQUIRE_ROLE)];
  const bare = studentCalls.find((m) => !/clearance:\s*['"]agent['"]/.test(m[0]));
  if (bare !== undefined) return `requireRole without clearance 'agent': ${bare[0]}`;
  if (checkServerAction) {
    const isServerAction = /^\s*['"]use server['"]/m.test(text);
    const hasAnyRequireRole = /\brequireRole\s*\(/.test(text);
    if (isServerAction && !hasAnyRequireRole) return 'a server action with no requireRole';
  }
  return null;
}

// Task 6.5: the one deliberate exception. `/learn/[agentId]/memory` is a student's own view,
// export and reset of their memory, reachable even with a parent's consent outstanding, so it
// asks for the default clearance ('age') on purpose -- it is not the chat itself.
const MEMORY_PAGE = join('app', 'learn', '[agentId]', 'memory', 'page.tsx');

// Task 9.6 Phase B: the same exception for the same reason -- a student's own progress page and
// exports, reachable even with a parent's consent outstanding. Not the chat itself.
const PROGRESS_PAGE = join('app', 'learn', '[agentId]', 'progress', 'page.tsx');

// Task 9.6 Phase D: the same exception for the same reason -- a student's own plan page
// (upgrade, downgrade, pause, resume, cancel), reachable even with a parent's consent
// outstanding. Not the chat itself.
const PLAN_PAGE = join('app', 'learn', '[agentId]', 'plan', 'page.tsx');

// Task 1.7a (1.7 review deferral): the same exception for the same reason -- a student's own
// dashboard, reachable even with a parent's consent outstanding. Not the chat itself.
const HOME_PAGE = join('app', 'home', 'page.tsx');

describe('clearance scan (app/**, src/chat/**)', () => {
  it('every requireRole([...student...]) call asks for clearance: agent', () => {
    const files = ROOTS.flatMap((r) => filesUnder(join(WEB, r)))
      .filter((f) => f !== SELF)
      .filter((f) => !f.endsWith(MEMORY_PAGE))
      .filter((f) => !f.endsWith(PROGRESS_PAGE))
      .filter((f) => !f.endsWith(PLAN_PAGE))
      .filter((f) => !f.endsWith(HOME_PAGE));
    expect(files.some((f) => f.includes(join('app', 'learn')))).toBe(true);
    const problems = files.flatMap((f) => {
      const rel = relative(WEB, f);
      const checkServerAction = SERVER_ACTION_CHECK_ROOTS.some((r) => rel.startsWith(r));
      const p = clearanceProblem(readFileSync(f, 'utf8'), checkServerAction);
      return p === null ? [] : [`${rel}: ${p}`];
    });
    expect(problems).toEqual([]);
  });

  it('a teacher/staff requireRole call is never flagged, even under app-wide scope', () => {
    const files = filesUnder(join(WEB, 'app', 'teacher')).concat(
      filesUnder(join(WEB, 'app', 'staff')),
    );
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((f) => {
      const p = clearanceProblem(readFileSync(f, 'utf8'), false);
      return p === null ? [] : [`${relative(WEB, f)}: ${p}`];
    });
    expect(problems).toEqual([]);
  });

  it('the scan catches a bare requireRole, a wrong clearance and an unguarded server action', () => {
    expect(clearanceProblem("await requireRole(['student']);")).toMatch(/without clearance/);
    expect(clearanceProblem("await requireRole(['student'], { clearance: 'age' });")).toMatch(
      /without/,
    );
    expect(clearanceProblem("'use server';\nexport async function act() {}")).toMatch(
      /no requireRole/,
    );
    expect(clearanceProblem("requireRole(['student'], { clearance: 'agent' })")).toBeNull();
    expect(clearanceProblem('export const x = 1;')).toBeNull();
    // A ['teacher']/['staff'] call is never flagged (1.7a): no 'student' in the role array.
    expect(clearanceProblem("await requireRole(['teacher']);")).toBeNull();
    expect(clearanceProblem("await requireRole(['staff']);")).toBeNull();
  });
});
