import { demoEntitlementPreview, demoEntitlementSubscription } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { memoryToolRegistry, testTool } from '../testing/memoryToolRegistry.js';
import {
  DuplicateToolError,
  entitledTools,
  noTools,
  offeredTools,
  policyTools,
  toolSpec,
} from './tools.js';

const calc = testTool({ name: 'calculator', skill: 'coach' });
const nextItem = testTool({ name: 'practice.next_item', skill: 'practice' });
const plan = testTool({ name: 'plan.make', skill: 'study_plan' });

describe('tool registry', () => {
  it('noTools lists nothing', () => {
    expect(noTools.list()).toEqual([]);
    expect(entitledTools(noTools, demoEntitlementSubscription)).toEqual([]);
  });

  it('only tools whose skill is in the entitlement are entitled', () => {
    const r = memoryToolRegistry([calc, nextItem, plan]);
    expect(entitledTools(r, demoEntitlementSubscription).map((t) => t.tool.name)).toEqual([
      'calculator',
      'practice.next_item',
    ]);
    // The preview package has explain and coach only.
    expect(entitledTools(r, demoEntitlementPreview).map((t) => t.tool.name)).toEqual([
      'calculator',
    ]);
  });

  it('a duplicate name is rejected (fail closed: which one would run is ambiguous)', () => {
    const r = memoryToolRegistry([calc, { ...calc }]);
    expect(() => entitledTools(r, demoEntitlementSubscription)).toThrow(DuplicateToolError);
  });

  it('policyTools gives decide the names and skills only', () => {
    const r = memoryToolRegistry([calc, plan]);
    expect(policyTools(r, demoEntitlementSubscription)).toEqual([
      { name: 'calculator', skill: 'coach' },
    ]);
  });

  it('offeredTools keeps the decision order and drops unknown and unentitled names', () => {
    const r = memoryToolRegistry([calc, nextItem, plan]);
    const names = (xs: { tool: { name: string } }[]) => xs.map((t) => t.tool.name);
    expect(
      names(
        offeredTools(
          r,
          ['practice.next_item', 'unknown', 'plan.make', 'calculator', 'calculator'],
          demoEntitlementSubscription,
        ),
      ),
    ).toEqual(['practice.next_item', 'calculator']);
    expect(offeredTools(r, [], demoEntitlementSubscription)).toEqual([]);
  });

  it('offeredTools never reads the registry when the decision names no tool', () => {
    const throwing = {
      list: () => {
        throw new Error('registry must not be read');
      },
    };
    expect(offeredTools(throwing, [], demoEntitlementSubscription)).toEqual([]);
  });

  it('toolSpec gives the model the name, description and the input JSON schema', () => {
    const spec = toolSpec(
      testTool({
        name: 'calculator',
        skill: 'coach',
        input: z.strictObject({ expression: z.string() }),
      }),
    );
    expect(spec).toMatchObject({
      name: 'calculator',
      description: expect.any(String),
      inputSchema: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
    });
  });
});
