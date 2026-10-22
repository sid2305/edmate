// Task 12.3 Phase C: the public page's data read. Written before page.tsx renders it. The real
// `content/` is read directly (same pattern as `apps/web/src/auth/age.test.ts`), confirming the
// committed declaration is still pending and the US pack's grievance contact is still pending too
// (task 12.3's lead answer, Q1) -- both assertions flip once a person signs them.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRightsPageData, RIGHTS_PAGE_MARKET } from './page-data';

const CONTENT = fileURLToPath(new URL('../../../../content', import.meta.url));
const GLOBAL_PACK = readFileSync(join(CONTENT, 'locales', 'global.yaml'), 'utf8');

/** A minimal content dir: the real `global` pack (always needed as the default), a `US` pack with
 * the given grievance text, and a placeholder declaration. */
function fixtureDir(usGrievance: string): string {
  const dir = mktempContentDir();
  writeFileSync(join(dir, 'locales', 'global.yaml'), GLOBAL_PACK);
  writeFileSync(
    join(dir, 'locales', 'US.yaml'),
    GLOBAL_PACK.replace('market: global', 'market: US').replace(
      /grievance: .*/,
      `grievance: "${usGrievance}"`,
    ),
  );
  writeFileSync(
    join(dir, 'legal', 'rights-declaration', 'global.md'),
    `---\nversion: draft-0\nreviewedBy: pending\nreviewedOn: "2026-10-22"\n---\n[PLACEHOLDER] draft text.\n`,
  );
  return dir;
}

function mktempContentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rights-page-data-'));
  mkdirSync(join(dir, 'locales'), { recursive: true });
  mkdirSync(join(dir, 'legal', 'rights-declaration'), { recursive: true });
  return dir;
}

describe('loadRightsPageData', () => {
  it('reads the real committed declaration and the US pack is still pending (not yet signed)', () => {
    const data = loadRightsPageData({ EDMATE_CONTENT_DIR: CONTENT });
    expect(data.declaration.reviewedBy).toBe('pending');
    expect(data.declaration.body).toContain('[PLACEHOLDER]');
    expect(data.grievance).toBeNull();
    expect(RIGHTS_PAGE_MARKET).toBe('US');
  });

  it('treats a pending grievance as no contact (the neutral placeholder case)', () => {
    const dir = fixtureDir('pending');
    const data = loadRightsPageData({ EDMATE_CONTENT_DIR: dir });
    expect(data.grievance).toBeNull();
  });

  it('treats a blank grievance as no contact', () => {
    const dir = fixtureDir('');
    const data = loadRightsPageData({ EDMATE_CONTENT_DIR: dir });
    expect(data.grievance).toBeNull();
  });

  it('shows a real, signed-off grievance contact', () => {
    const dir = fixtureDir('Edmate Trust & Safety, trust@example.test');
    const data = loadRightsPageData({ EDMATE_CONTENT_DIR: dir });
    expect(data.grievance).toBe('Edmate Trust & Safety, trust@example.test');
  });

  it('throws when the declaration file is missing', () => {
    const dir = mktempContentDir();
    writeFileSync(join(dir, 'locales', 'global.yaml'), GLOBAL_PACK);
    expect(() => loadRightsPageData({ EDMATE_CONTENT_DIR: dir })).toThrow();
  });
});
