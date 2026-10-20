import { demoEntitlementPreview, demoEntitlementSubscription } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { entitledTools, offeredTools, policyTools } from '../pipeline/tools.js';
import { defaultToolRegistry } from './registry.js';

const names = (xs: readonly { tool: { name: string } }[]) => xs.map((r) => r.tool.name);

describe('defaultToolRegistry', () => {
  it('lists the calculator and practice.next_item today (5.7/5.8 append theirs)', () => {
    expect(names(defaultToolRegistry().list())).toEqual(['calculator', 'practice.next_item']);
  });

  it('goes through 5.4’s unchanged filter: a subscription is offered both', () => {
    const r = defaultToolRegistry();
    expect(names(entitledTools(r, demoEntitlementSubscription))).toEqual([
      'calculator',
      'practice.next_item',
    ]);
    expect(policyTools(r, demoEntitlementSubscription)).toEqual([
      { name: 'calculator', skill: 'coach' },
      { name: 'practice.next_item', skill: 'practice' },
    ]);
    expect(
      names(offeredTools(r, ['calculator', 'practice.next_item'], demoEntitlementSubscription)),
    ).toEqual(['calculator', 'practice.next_item']);
  });

  it('a preview (explain and coach, no practice) is offered the calculator only', () => {
    const r = defaultToolRegistry();
    expect(names(offeredTools(r, ['calculator'], demoEntitlementPreview))).toEqual(['calculator']);
    expect(
      names(offeredTools(r, ['calculator', 'practice.next_item'], demoEntitlementPreview)),
    ).toEqual(['calculator']);
  });

  it('an entitlement without coach or practice is offered nothing', () => {
    const r = defaultToolRegistry();
    const bare = {
      skills: demoEntitlementSubscription.skills.filter((s) => s !== 'coach' && s !== 'practice'),
    };
    expect(entitledTools(r, bare)).toEqual([]);
    expect(offeredTools(r, ['calculator', 'practice.next_item'], bare)).toEqual([]);
  });
});
