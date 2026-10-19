// The default step set. Each later task replaces its own file; until then every step is a stub
// that fails closed through its policy.
import type { Steps } from '../types.js';
import { admit } from './admit.js';
import { buildContext } from './buildContext.js';
import { commit } from './commit.js';
import { decide } from './decide.js';
import { entitle } from './entitle.js';
import { escalate } from './escalate.js';
import { generate } from './generate.js';
import { meter } from './meter.js';
import { postGuard } from './postGuard.js';
import { preGuard } from './preGuard.js';
import { route } from './route.js';
import { scrub } from './scrub.js';

export const defaultSteps: Steps = {
  admit,
  entitle,
  scrub,
  preGuard,
  route,
  buildContext,
  escalate,
  decide,
  generate,
  postGuard,
  meter,
  commit,
};
