// Regression (task 12.2i, review LOW from 12.2h): importing `reports.ts` directly, before
// anything else in this package has been loaded, must not throw. `reports.ts` imports
// `notTakenDown` from `./takedowns.js`, and `takedowns.ts` imports `bumpRevision` from
// `./chunks.js` *before* its own `notTakenDown`/`qualified` are defined; `chunks.ts` calls
// `notTakenDown` eagerly at module-eval time inside its top-level `documentColumns`. Requesting
// `reports.ts` first used to surface as `ReferenceError: Cannot access 'qualified' before
// initialization`. This file's only top-level import of this package is `reports.js` itself —
// vitest isolates each test file's module registry (no `isolate: false` in vitest.config.ts), so
// this is genuinely the package's first touch in this file's run.
import { describe, expect, it } from 'vitest';
import { reportRowId } from '../src/repositories/reports.js';

describe('import order: reports.ts first', () => {
  it('loads without throwing and its exports work', () => {
    expect(reportRowId('stu_1', 'msg_1')).toMatch(/^rp_/);
  });
});
