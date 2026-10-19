// The post phase's guard registry (task 4.5). Each post guard task (4.6-4.9) adds its own
// `register(...)` line here; GUARD_ORDER, not this file, decides the order they run in.
import { createAnswerLeakGuard, type PostGuardCtx } from './answerLeak.js';
import { createLockedLeakGuard } from './lockedLeak.js';
import { GuardRegistry } from './registry.js';

export const postGuards = new GuardRegistry<PostGuardCtx>('post');
postGuards.register(createAnswerLeakGuard());
postGuards.register(createLockedLeakGuard());
