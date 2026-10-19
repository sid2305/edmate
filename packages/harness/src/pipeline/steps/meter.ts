// Step 10, meter (task 3.8): one UsageMeter.record per usage figure the turn reported, billed to
// the entitlement's teacher, package, student and source. It only calls the port: in production
// the port is the queue-backed adapter (@edmate/queue), so this resolves once the job is enqueued
// and never waits on the database. A port failure fails the step; the runner reports it.
import type { Steps } from '../types.js';

export const meter: Steps['meter'] = async (env, { usage, entitlement }) => {
  const ctx = {
    teacherId: entitlement.teacherId,
    packageId: entitlement.packageId,
    studentId: entitlement.studentId,
    turnId: env.turnId,
    source: entitlement.source,
  };
  for (const u of usage) await env.deps.usage.record(u, ctx);
};
