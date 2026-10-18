// Every exported schema must be registered and have valid and invalid fixtures.
import { describe, expect, it } from 'vitest';
import { invalidFixtures, schemas, unknownInvalidCases, validFixtures } from '../fixtures/index.js';
import * as C from '../src/index.js';

const exportedSchemaNames = Object.keys(C)
  .filter((k) => k.endsWith('Schema'))
  .map((k) => k.slice(0, -'Schema'.length))
  .sort();

describe('fixture registry', () => {
  it('registers exactly the exported schemas, by the same object', () => {
    expect(Object.keys(schemas).sort()).toEqual(exportedSchemaNames);
    for (const name of exportedSchemaNames) {
      expect(schemas[name as keyof typeof schemas]).toBe(C[`${name}Schema` as keyof typeof C]);
    }
  });

  it('covers all 32 data types of Core contracts', () => {
    expect(exportedSchemaNames).toHaveLength(32);
  });

  it.each(exportedSchemaNames)('%s has at least one valid and one invalid fixture', (name) => {
    const key = name as keyof typeof schemas;
    expect(validFixtures[key]?.length ?? 0).toBeGreaterThan(0);
    expect(invalidFixtures[key]?.length ?? 0).toBeGreaterThan(0);
  });

  it('every invalid case names a registered schema', () => {
    expect(unknownInvalidCases).toEqual([]);
  });

  it('has one fixture per variant of each union', () => {
    const types = (xs: readonly { type: string }[]) => new Set(xs.map((x) => x.type));
    expect(types(validFixtures.TurnEvent).size).toBe(10);
    expect(types(validFixtures.ModelChunk).size).toBe(3);
    expect(new Set(validFixtures.GuardResult.map((g) => (g.ok ? 'ok' : g.action))).size).toBe(4);
    expect(new Set(validFixtures.Entitlement.map((e) => e.source))).toEqual(
      new Set(C.EntitlementSchema.shape.source.options),
    );
    const enums: [readonly string[], readonly string[]][] = [
      [validFixtures.Skill, C.SkillSchema.options],
      [validFixtures.ErrorCode, C.ErrorCodeSchema.options],
      [validFixtures.ChunkKind, C.ChunkKindSchema.options],
      [validFixtures.Intent, C.IntentSchema.options],
      [validFixtures.Attempt, C.AttemptSchema.options],
    ];
    for (const [fixtures, options] of enums) expect(new Set(fixtures)).toEqual(new Set(options));
  });
});
