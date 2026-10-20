// Property (task 5.4, access rule 5): for random registries and entitlements, the tools the policy
// sees and the tools generate offers are always within the entitlement's skills; a duplicate name
// fails closed. Seeded PRNG, no fast-check (1.2 decision).
import type { Skill } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { memoryToolRegistry, testTool } from '../testing/memoryToolRegistry.js';
import { type Prng, prng } from '../testing/prng.js';
import { DuplicateToolError, entitledTools, offeredTools, policyTools } from './tools.js';

const SEED = 20261020;
const ITERATIONS = 2_000;
const log = (s: string): void =>
  (globalThis as { console?: { log(s: string): void } }).console?.log(s);

const SKILLS: Skill[] = [
  'explain',
  'coach',
  'practice',
  'feedback',
  'mock_interview',
  'revision',
  'study_plan',
];
const NAMES = ['calculator', 'flashcards', 'quiz', 'planner', 'grader', 'timer'];

function registry(r: Prng) {
  // Distinct names, and a duplicate in about 15% of registries.
  const names = NAMES.filter(() => r.chance(0.5));
  if (names.length > 0 && r.chance(0.15)) names.splice(r.int(names.length + 1), 0, r.pick(names));
  return memoryToolRegistry(names.map((name) => testTool({ name, skill: r.pick(SKILLS) })));
}

describe('access property: tool registry (task 5.4)', () => {
  it(`${String(ITERATIONS)} random registries × entitlements offer only entitled tools`, () => {
    const r = prng(SEED);
    const tally = { duplicate: 0, offered: 0, none: 0 };
    for (let i = 0; i < ITERATIONS; i++) {
      const at = `seed ${String(SEED)} iteration ${String(i)}`;
      const reg = registry(r);
      const skills = SKILLS.filter(() => r.chance(0.5));
      const e = { skills };
      const names = reg.list().map((t) => t.tool.name);
      const duplicate = new Set(names).size !== names.length;
      const decision = Array.from({ length: r.int(5) }, () =>
        r.pick([...NAMES, 'not_a_tool', 'run_sql']),
      );

      if (duplicate) {
        expect(() => entitledTools(reg, e), at).toThrow(DuplicateToolError);
        expect(() => policyTools(reg, e), at).toThrow(DuplicateToolError);
        if (decision.length > 0) {
          expect(() => offeredTools(reg, decision, e), at).toThrow(DuplicateToolError);
        }
        tally.duplicate++;
        continue;
      }

      const entitled = entitledTools(reg, e);
      expect(
        entitled.map((t) => t.tool.name),
        at,
      ).toEqual(
        reg
          .list()
          .filter((t) => skills.includes(t.tool.skill))
          .map((t) => t.tool.name),
      );
      for (const p of policyTools(reg, e)) expect(skills, at).toContain(p.skill);
      expect(policyTools(reg, e), at).toEqual(
        entitled.map((t) => ({ name: t.tool.name, skill: t.tool.skill })),
      );

      const offered = offeredTools(reg, decision, e);
      for (const t of offered) expect(skills, at).toContain(t.tool.skill);
      const allowed = new Set(entitled.map((t) => t.tool.name));
      expect(
        offered.map((t) => t.tool.name),
        at,
      ).toEqual([...new Set(decision)].filter((n) => allowed.has(n)));
      if (offered.length > 0) tally.offered++;
      else tally.none++;
      expect(reg.runs, at).toEqual([]);
    }
    log(`access tools property: seed ${String(SEED)}, ${JSON.stringify(tally)}`);
    expect(tally.duplicate).toBeGreaterThan(0);
    expect(tally.offered).toBeGreaterThan(0);
    expect(tally.none).toBeGreaterThan(0);
  });
});
