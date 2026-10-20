// The post phase's guard registry (task 4.5). Each post guard task (4.6-4.9) adds its own
// `register(...)` line here; GUARD_ORDER, not this file, decides the order they run in.
//
// Weights (task 4.7, lead answer 1): a guard that makes a model or port call gets a larger share
// of the post budget than a rules-only one (default 1). postGuard computes each slice from the
// budget still left (steps/postGuard.ts). Provisional; tuned with live latency in 7.x (with 4.4b).
import { createAnswerLeakGuard, type PostGuardCtx } from './answerLeak.js';
import { createGroundingGuard } from './grounding.js';
import { createLockedLeakGuard } from './lockedLeak.js';
import { GuardRegistry } from './registry.js';

export const postGuards = new GuardRegistry<PostGuardCtx>('post');
// A port call with its own 150 ms timeout.
postGuards.register(createLockedLeakGuard(), { weight: 2 });
// One small-tier rewrite, only on a leak.
postGuards.register(createAnswerLeakGuard(), { weight: 3 });
// One small-tier judge call on most replies.
postGuards.register(createGroundingGuard(), { weight: 4 });
