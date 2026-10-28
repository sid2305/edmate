// The post phase's guard registry (task 4.5). Each post guard task (4.6-4.9) adds its own
// `register(...)` line here; GUARD_ORDER, not this file, decides the order they run in.
//
// Weights (task 4.7, lead answer 1): a guard that makes a model or port call gets a larger share
// of the post budget than a rules-only one (default 1). postGuard computes each slice from the
// budget still left (steps/postGuard.ts). Provisional; tuned with live latency in 7.x (with 4.4b).
import { createAdviceGuard } from './adviceGuard.js';
import { createAnswerLeakGuard, type PostGuardCtx } from './answerLeak.js';
import { createGroundingGuard } from './grounding.js';
import { createLockedLeakGuard } from './lockedLeak.js';
import { createPersonaBoundaryGuard } from './personaBoundary.js';
import { GuardRegistry } from './registry.js';
import { createToneGuard } from './tone.js';

export const postGuards = new GuardRegistry<PostGuardCtx>('post');
// A port call with its own 150 ms timeout.
postGuards.register(createLockedLeakGuard(), { weight: 2 });
// One small-tier rewrite, only on a leak.
postGuards.register(createAnswerLeakGuard(), { weight: 3 });
// One small-tier judge call on most replies.
postGuards.register(createGroundingGuard(), { weight: 4 });
// One small-tier judge call, and on a hit one rewrite, only when the turn holds a decision signal
// (task 4.8). postGuard counts it as rules-only (weight 1) on a turn with none.
postGuards.register(createAdviceGuard(), { weight: 4 });
// Rules only, no model or port call (task 4.9): the persona must-not floor (interview/viva skills).
postGuards.register(createPersonaBoundaryGuard());
// Rules only, no model or port call (task 4.9): the always-on identity/companion floor.
postGuards.register(createToneGuard());
