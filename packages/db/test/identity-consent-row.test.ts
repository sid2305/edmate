// Task 13.4f: `parseConsentRow` as a pure function (no I/O), same pattern as `age.test.ts`'s
// `ageStatus`. The `consents_granted_by_check` DB constraint already blocks a bad `grantedBy`
// value from ever being written through this store's own inserts, so this can't be shown as an
// `identity.int.test.ts` round trip; this is belt-and-braces against a future looser constraint
// or a row from outside this store's own writes.
import { describe, expect, it } from 'vitest';
import { parseConsentRow } from '../src/identity/store.js';

const GOOD_ROW = {
  kind: 'privacy_notice',
  version: 'v1',
  grantedBy: 'self',
  ts: new Date('2026-01-01T00:00:00.000Z'),
  withdrawnAt: null,
};

describe('parseConsentRow', () => {
  it('maps a good "self" row', () => {
    expect(parseConsentRow(GOOD_ROW)).toEqual({
      kind: 'privacy_notice',
      version: 'v1',
      grantedBy: 'self',
      ts: '2026-01-01T00:00:00.000Z',
      withdrawnAt: null,
    });
  });

  it('maps a good "parent" row with a withdrawal', () => {
    const row = {
      ...GOOD_ROW,
      kind: 'parental',
      grantedBy: 'parent',
      withdrawnAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    expect(parseConsentRow(row)).toEqual({
      kind: 'parental',
      version: 'v1',
      grantedBy: 'parent',
      ts: '2026-01-01T00:00:00.000Z',
      withdrawnAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it.each(['bad', '', 'parent ', 'Self', 'PARENT'])(
    'throws on a bad grantedBy value: %j',
    (grantedBy) => {
      expect(() => parseConsentRow({ ...GOOD_ROW, grantedBy })).toThrow();
    },
  );
});
