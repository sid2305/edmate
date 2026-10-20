// The committed `content/legal/privacy-notice` (task 1.7 Phase B). Until a named person writes
// and signs each notice, they are marked placeholders and `content validate` fails on them. These
// checks hold before and after that sign-off, except the placeholder block, which goes with it.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readLocalePacksDir } from './localeLoader.js';
import {
  noticeCoverageIssues,
  noticeSigned,
  pickPrivacyNotice,
  PLACEHOLDER_MARKER,
  readPrivacyNoticesDir,
} from './privacyNotices.js';
import { validateContentDir } from './validate.js';

const LOCALES = fileURLToPath(new URL('../../../content/locales', import.meta.url));
const NOTICES = fileURLToPath(new URL('../../../content/legal/privacy-notice', import.meta.url));

describe('content/legal/privacy-notice', () => {
  const { notices, errors } = readPrivacyNoticesDir(NOTICES);
  const packMarkets = [...readLocalePacksDir(LOCALES).packs.keys()];

  it('every file loads', () => {
    expect(errors).toEqual([]);
  });

  it('every locale-pack market has its own notice, and nothing else does', () => {
    expect(noticeCoverageIssues(packMarkets, notices)).toEqual([]);
    expect([...notices.keys()].sort()).toEqual([...packMarkets].sort());
  });

  it('an unknown market gets the default notice', () => {
    expect(pickPrivacyNotice('ZZ', notices).market).toBe('global');
  });

  describe.each([...notices.values()].filter((n) => !noticeSigned(n)))(
    'unsigned notice $market',
    (n) => {
      it('is a marked placeholder at draft-0, signer pending, and fails validation', () => {
        expect(n.version).toBe('draft-0');
        expect(n.reviewedBy).toBe('pending');
        expect(n.body).toContain(PLACEHOLDER_MARKER);
        expect(n.body).toMatch(/not legal text/i);
        const { ok, issues } = validateContentDir(NOTICES);
        expect(ok).toBe(false);
        expect(issues).toContain(
          `${n.market}.md: reviewedBy is "pending"; a named person must sign this notice`,
        );
      });
    },
  );
});
