import { describe, expect, it } from 'vitest';
import { EvalAgentReplySchema } from './agent.js';
import { RecordedJudgeSchema } from './runner.js';
import { adaptDemoTeacherContent } from './demoContentAdapter.js';
import { loadDemoTeacherContent } from '@edmate/content';
import { fileURLToPath } from 'node:url';
import { demoLockedFixtureEntries, DEMO_LEAK_CASE_ID } from './demoLockedFixtures.js';
import { generatePerAgentSuite } from './perAgentSuite.js';

/** Repo-root `content/demo-teacher`, the same tree `apps/cli`'s `edmate gate demo` loads by
 * default (`apps/cli/src/commands/gate/demoInput.ts`), so generated case ids match exactly. */
const DEMO_DIR = fileURLToPath(new URL('../../../content/demo-teacher', import.meta.url));

function demoInput() {
  return adaptDemoTeacherContent(loadDemoTeacherContent(DEMO_DIR));
}

function lockedCaseIds(): string[] {
  return generatePerAgentSuite(demoInput())
    .filter((c) => c.suite === 'locked')
    .map((c) => c.id);
}

describe('demoLockedFixtureEntries', () => {
  it('confirms DEMO_LEAK_CASE_ID is still a real, current locked case id', () => {
    expect(lockedCaseIds()).toContain(DEMO_LEAK_CASE_ID);
  });

  it('makes exactly two entries per locked case, keyed like the runner', () => {
    const ids = lockedCaseIds();
    const entries = demoLockedFixtureEntries(demoInput());
    expect(entries).toHaveLength(ids.length * 2);
    for (const id of ids) {
      expect(entries.map((e) => e.key)).toContain(`${id}/turn-0/agent`);
      expect(entries.map((e) => e.key)).toContain(`${id}/turn-0/judge-0`);
    }
  });

  it('every key matches the fileRecorder key pattern (lowercase, /-joined)', () => {
    const entries = demoLockedFixtureEntries(demoInput());
    for (const { key } of entries) {
      expect(key).toMatch(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/);
    }
  });

  it('every good entry parses, cites no source, and names the package when it must', () => {
    const input = demoInput();
    const packageById = new Map(input.packages.map((p) => [p.id, p]));
    const cases = new Map(
      generatePerAgentSuite(input)
        .filter((c) => c.suite === 'locked')
        .map((c) => [c.id, c]),
    );
    const entries = demoLockedFixtureEntries(input);
    for (const { key, value } of entries) {
      const [caseId, , kind] = key.split('/');
      if (kind === 'agent') {
        const reply = EvalAgentReplySchema.parse(value);
        expect(reply.sources ?? []).toHaveLength(0);
        const evalCase = cases.get(caseId!);
        const pkg = packageById.get(evalCase!.package)!;
        if (pkg.lockedReply === 'name_package') {
          expect(reply.text.toLowerCase()).toContain(pkg.name.toLowerCase());
        }
      } else {
        const judge = RecordedJudgeSchema.parse(value);
        expect(judge.verdict.pass).toBe(true);
      }
    }
  });

  it('with leakCaseId set, only that case differs, and its verdict is pass:false', () => {
    const input = demoInput();
    const good = demoLockedFixtureEntries(input);
    const leaky = demoLockedFixtureEntries(input, { leakCaseId: DEMO_LEAK_CASE_ID });
    expect(leaky).toHaveLength(good.length);

    const goodByKey = new Map(good.map((e) => [e.key, e.value]));
    const leakyByKey = new Map(leaky.map((e) => [e.key, e.value]));
    expect([...leakyByKey.keys()].sort()).toEqual([...goodByKey.keys()].sort());

    const changedKeys = [...leakyByKey.keys()].filter(
      (key) => JSON.stringify(leakyByKey.get(key)) !== JSON.stringify(goodByKey.get(key)),
    );
    expect(changedKeys.sort()).toEqual(
      [`${DEMO_LEAK_CASE_ID}/turn-0/agent`, `${DEMO_LEAK_CASE_ID}/turn-0/judge-0`].sort(),
    );

    const leakJudge = RecordedJudgeSchema.parse(leakyByKey.get(`${DEMO_LEAK_CASE_ID}/turn-0/judge-0`));
    expect(leakJudge.verdict.pass).toBe(false);
    const leakReply = EvalAgentReplySchema.parse(leakyByKey.get(`${DEMO_LEAK_CASE_ID}/turn-0/agent`));
    expect(leakReply.sources ?? []).toHaveLength(0);
  });
});
