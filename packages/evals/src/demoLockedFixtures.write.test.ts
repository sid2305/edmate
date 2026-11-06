// Two parts (task 7.5 plan, Phase A "Tests first" step 2):
//
// 1. A freshness guard that ALWAYS runs, as part of the normal `test` step CI already runs: it
//    recomputes today's real locked-case id set from `content/demo-teacher` and asserts it is
//    exactly the file set committed under `evals/fixtures/demo-good` and `evals/fixtures/demo-leaky`,
//    so a content change that isn't followed by regenerating the fixtures fails CI here, loudly
//    (lessons.md: "a check that silently skips looks like a pass"), and that `DEMO_LEAK_CASE_ID`
//    is still among today's real locked case ids.
//
// 2. A gated write path (`describe.skipIf(process.env.WRITE_DEMO_FIXTURES !== '1')`) that never
//    runs in CI (no step sets that env var): it regenerates both committed fixture trees via
//    `fileRecorder(dir, 'record')` (`recorder.ts`), the project's one recording mechanism. Run it
//    yourself to regenerate the committed files after a `content/demo-teacher` change:
//
//      WRITE_DEMO_FIXTURES=1 corepack pnpm --filter @edmate/evals exec vitest run \
//        src/demoLockedFixtures.write.test.ts
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadDemoTeacherContent } from '@edmate/content';
import { adaptDemoTeacherContent } from './demoContentAdapter.js';
import { generatePerAgentSuite } from './perAgentSuite.js';
import { demoLockedFixtureEntries, DEMO_LEAK_CASE_ID } from './demoLockedFixtures.js';
import { fileRecorder } from './recorder.js';

const DEMO_DIR = fileURLToPath(new URL('../../../content/demo-teacher', import.meta.url));
const GOOD_DIR = fileURLToPath(new URL('../../../evals/fixtures/demo-good', import.meta.url));
const LEAKY_DIR = fileURLToPath(new URL('../../../evals/fixtures/demo-leaky', import.meta.url));

function demoInput() {
  return adaptDemoTeacherContent(loadDemoTeacherContent(DEMO_DIR));
}

function todaysLockedCaseIds(): string[] {
  return generatePerAgentSuite(demoInput())
    .filter((c) => c.suite === 'locked')
    .map((c) => c.id)
    .sort();
}

/** Every `<id>/turn-0/{agent,judge-0}.json` file under `dir`, as the case ids it covers (a case
 * is only "there" once both its files exist). */
function fixtureCaseIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) =>
    e.isFile(),
  );
  const byId = new Map<string, Set<string>>();
  for (const file of files) {
    const rel = `${file.parentPath ?? file.path}/${file.name}`.slice(dir.length + 1);
    const match = /^(.+)\/turn-0\/(agent|judge-0)\.json$/.exec(rel);
    if (match === undefined || match === null) continue;
    const [, id, kind] = match;
    const have = byId.get(id!) ?? new Set<string>();
    have.add(kind!);
    byId.set(id!, have);
  }
  return [...byId.entries()]
    .filter(([, kinds]) => kinds.has('agent') && kinds.has('judge-0'))
    .map(([id]) => id)
    .sort();
}

describe('demo locked fixtures freshness (always runs)', () => {
  it('DEMO_LEAK_CASE_ID is still a real, current locked case id', () => {
    expect(todaysLockedCaseIds()).toContain(DEMO_LEAK_CASE_ID);
  });

  it('evals/fixtures/demo-good covers exactly today\'s real locked case ids', () => {
    expect(fixtureCaseIds(GOOD_DIR)).toEqual(todaysLockedCaseIds());
  });

  it('evals/fixtures/demo-leaky covers exactly today\'s real locked case ids', () => {
    expect(fixtureCaseIds(LEAKY_DIR)).toEqual(todaysLockedCaseIds());
  });
});

describe.skipIf(process.env.WRITE_DEMO_FIXTURES !== '1')(
  'write the committed demo-good / demo-leaky fixture trees (gated, local only)',
  () => {
    it('writes evals/fixtures/demo-good', async () => {
      const recorder = fileRecorder(GOOD_DIR, 'record');
      for (const { key, value } of demoLockedFixtureEntries(demoInput())) {
        await recorder.run(key, async () => value);
      }
    });

    it('writes evals/fixtures/demo-leaky', async () => {
      const recorder = fileRecorder(LEAKY_DIR, 'record');
      for (const { key, value } of demoLockedFixtureEntries(demoInput(), {
        leakCaseId: DEMO_LEAK_CASE_ID,
      })) {
        await recorder.run(key, async () => value);
      }
    });
  },
);
