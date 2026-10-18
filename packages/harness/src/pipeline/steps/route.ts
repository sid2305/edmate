// Step 4 stub (built in 3.3). `run` throws; `onFailure` is the spec's default, not success data.
// 3.3 adds the distress keyword check to `onFailure` ("distress keywords still escalate").
import { StepNotImplementedError } from '../errors.js';
import { ROUTE_DEFAULT } from '../policies.js';
import type { Steps } from '../types.js';

export const route: Steps['route'] = {
  run: () => Promise.reject(new StepNotImplementedError('route')),
  onFailure: () => ({ ...ROUTE_DEFAULT }),
};
