import { describe, expect, it } from 'vitest';
import {
  demoAgentConfig,
  demoPackageFree,
  demoTurnInput,
  schemas,
  validFixtures,
} from './index.js';

// The harness has no zod dependency yet, so the schemas are used through this minimal shape.
type Parser = { safeParse(value: unknown): { success: boolean } };

describe('harness/testing re-exports the contracts fixtures', () => {
  const names = Object.keys(schemas) as (keyof typeof schemas)[];

  it('covers every schema', () => {
    expect(names).toHaveLength(32);
  });

  it.each(names)('%s: the first fixture parses', (name) => {
    const [first] = validFixtures[name];
    expect(first).toBeDefined();
    expect((schemas[name] as Parser).safeParse(first).success).toBe(true);
  });

  it('exposes the named demo fixtures', () => {
    expect(schemas.AgentConfig.parse(demoAgentConfig).id).toBe('agt_test_01');
    expect(schemas.PackageConfig.parse(demoPackageFree).pricePerMonth.amountMinor).toBe(0);
    expect(schemas.TurnInput.parse(demoTurnInput).kind).toBe('message');
  });
});
