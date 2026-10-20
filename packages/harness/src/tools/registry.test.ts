import { demoEntitlementPreview, demoEntitlementSubscription } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { entitledTools, offeredTools, policyTools } from '../pipeline/tools.js';
import { calculatorTool } from './calculator.js';
import { defaultToolRegistry } from './registry.js';

const names = (xs: readonly { tool: { name: string } }[]) => xs.map((r) => r.tool.name);

describe('defaultToolRegistry', () => {
  it('lists exactly the calculator today (5.6–5.8 append theirs)', () => {
    expect(defaultToolRegistry().list()).toEqual([calculatorTool]);
  });

  it('goes through 5.4’s unchanged filter: a subscription is offered the calculator', () => {
    const r = defaultToolRegistry();
    expect(names(entitledTools(r, demoEntitlementSubscription))).toEqual(['calculator']);
    expect(policyTools(r, demoEntitlementSubscription)).toEqual([
      { name: 'calculator', skill: 'coach' },
    ]);
    expect(
      names(offeredTools(r, ['calculator', 'practice.next_item'], demoEntitlementSubscription)),
    ).toEqual(['calculator']);
  });

  it('a preview (explain and coach) is offered the calculator too', () => {
    const r = defaultToolRegistry();
    expect(names(offeredTools(r, ['calculator'], demoEntitlementPreview))).toEqual(['calculator']);
  });

  it('an entitlement without coach is offered nothing', () => {
    const r = defaultToolRegistry();
    const noCoach = { skills: demoEntitlementSubscription.skills.filter((s) => s !== 'coach') };
    expect(entitledTools(r, noCoach)).toEqual([]);
    expect(offeredTools(r, ['calculator'], noCoach)).toEqual([]);
  });
});
