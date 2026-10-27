// Regression (task 12.2i, review LOW from 12.2h): importing `takedowns.ts` directly, before
// anything else in this package has been loaded, must not throw. See
// import-order-reports.test.ts for the full root-cause explanation (same bug, reached by
// requesting `takedowns.ts` itself instead of `reports.ts`). This file's only top-level import of
// this package is `takedowns.js` itself.
import { describe, expect, it } from 'vitest';
import { notTakenDown, TAKEDOWN_KINDS } from '../src/repositories/takedowns.js';
import { documents } from '../src/schema/index.js';

describe('import order: takedowns.ts first', () => {
  it('loads without throwing and its exports work', () => {
    expect(TAKEDOWN_KINDS).toContain('document');
    expect(notTakenDown(documents.id)).toBeDefined();
  });
});
