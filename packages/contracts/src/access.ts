import { z } from 'zod';
import { count, id, market, timestamp } from './formats.js';
import { SkillSchema } from './shared.js';

/** Computed server-side; never from the client. */
export const EntitlementSchema = z
  .strictObject({
    source: z.enum(['subscription', 'teacher_preview', 'eval']),
    subscriptionId: id().exactOptional(),
    studentId: id(),
    teacherId: id(),
    agentId: id(),
    market: market(),
    packageId: id(),
    packageVersion: count(),
    /** `entitle` refuses paused and ended. */
    status: z.enum(['trial', 'active', 'past_due', 'paused', 'ended']),
    periodEnd: timestamp(),
    allowedModuleIds: z.array(id()),
    lockedModuleIds: z.array(id()),
    skills: z.array(SkillSchema),
  })
  .superRefine((e, ctx) => {
    // subscriptionId is present exactly when source = 'subscription'.
    if (e.source === 'subscription' && e.subscriptionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subscriptionId'],
        message: 'required when source is "subscription"',
      });
    }
    if (e.source !== 'subscription' && e.subscriptionId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subscriptionId'],
        message: 'only allowed when source is "subscription"',
      });
    }
    // Fail closed: a module can't be both allowed and locked.
    const allowed = new Set(e.allowedModuleIds);
    const overlap = e.lockedModuleIds.filter((m) => allowed.has(m));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['lockedModuleIds'],
        message: `modules both allowed and locked: ${overlap.join(', ')}`,
      });
    }
  });
export type Entitlement = z.infer<typeof EntitlementSchema>;
