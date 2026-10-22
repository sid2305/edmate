// The committed `content/legal/rights-declaration/global.md` (task 12.3 Phase A). Until a named
// person writes and signs it, it is marked a placeholder with `reviewedBy: pending`. These checks
// hold before and after that sign-off, except the placeholder block, which goes with it.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readRightsDeclaration, rightsDeclarationSigned } from './rightsDeclaration.js';

const GLOBAL = fileURLToPath(
  new URL('../../../content/legal/rights-declaration/global.md', import.meta.url),
);

describe('content/legal/rights-declaration/global.md', () => {
  it('loads', () => {
    expect(() => readRightsDeclaration(GLOBAL)).not.toThrow();
  });

  it('is not yet signed: pending reviewer, placeholder body, draft version', () => {
    const doc = readRightsDeclaration(GLOBAL);
    expect(doc.version).toBe('draft-0');
    expect(doc.reviewedBy).toBe('pending');
    expect(doc.body).toMatch(/\[PLACEHOLDER\]/);
    expect(doc.body).toMatch(/not legal text/i);
    expect(rightsDeclarationSigned(doc)).toBe(false);
  });
});
