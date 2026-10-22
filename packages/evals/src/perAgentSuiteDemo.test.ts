// Task 7.3 acceptance: "the demo teacher gets >= 50 accuracy cases and >= 30 locked cases".
// Loads the committed, public content/demo-teacher tree, adapts it (demoSuiteInput.testkit.ts,
// test code, not src exports) into the generator's input, mixes in two synthetic approved-draft
// rows, and checks the counts. Nothing is written to disk.
import { loadDemoTeacherContent } from '@edmate/content';
import { describe, expect, it } from 'vitest';
import { adapt, DEMO_DIR, PACKAGE_IDS } from './demoSuiteInput.testkit.js';
import { generatePerAgentSuite } from './perAgentSuite.js';
import { EvalCaseSchema } from './schema.js';

describe('generatePerAgentSuite on the demo teacher (task 7.3 acceptance)', () => {
  const input = adapt(loadDemoTeacherContent(DEMO_DIR));
  const cases = generatePerAgentSuite(input);

  it('gives >= 50 accuracy cases and >= 30 locked cases', () => {
    const accuracy = cases.filter((c) => c.suite === 'accuracy').length;
    const locked = cases.filter((c) => c.suite === 'locked').length;
    expect(accuracy).toBeGreaterThanOrEqual(50);
    expect(locked).toBeGreaterThanOrEqual(30);
    // Exact counts, so a content change that moves them is noticed. Accuracy 106: 37 bank items
    // (15 in free modules x 2 packages + 22 paid-only = 52), 30 recall in-course items (13
    // answered in free modules x 2 + 17 paid-only = 43), 2 synthetic rows (2 + 1), 8
    // out-of-course. Locked 49, free package only: 40 direct (22 bank + 17 recall + 1 synthetic
    // row in loops, functions, lists-dicts) + 3 module templates x 3 modules.
    expect({ accuracy, locked }).toMatchInlineSnapshot(`
      {
        "accuracy": 106,
        "locked": 49,
      }
    `);
  });

  it('produces only cases that parse, with unique ids and generated provenance', () => {
    for (const c of cases) expect(EvalCaseSchema.parse(c)).toEqual(c);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases)
      expect(c.reviewed_by).toMatch(
        /^generated:(question-bank|qa-recall|teacher-answer|locked-template)$/,
      );
    expect(cases.some((c) => c.reviewed_by === 'generated:teacher-answer')).toBe(true);
  });

  it('routes the recall items answered only in paid modules to locked for the free package', () => {
    const lockedIds = cases.filter((c) => c.suite === 'locked').map((c) => c.id);
    for (const id of ['qr-15', 'qr-16', 'qr-17', 'qr-18']) {
      expect(lockedIds).toContain(`gen-lock-demo-package-free-direct-${id}`);
    }
    expect(cases.every((c) => c.suite !== 'locked' || c.package === PACKAGE_IDS.free)).toBe(true);
  });

  it('is deterministic', () => {
    expect(generatePerAgentSuite(adapt(loadDemoTeacherContent(DEMO_DIR)))).toEqual(cases);
  });
});
