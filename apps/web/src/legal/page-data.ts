// Task 12.3 Phase C: the public rights-declaration page's server-only reads. A thin passthrough
// over packages/content (task 12.3a's reader, task 3.10's locale packs); no new runtime module,
// no state -- `contentDir` is read-only reuse of `apps/web/src/turn/runtime.ts`'s helper.
import { join } from 'node:path';
import {
  loadLocalePacks,
  pickLocalePack,
  readRightsDeclaration,
  type RightsDeclaration,
} from '@edmate/content';
import { contentDir, type Env } from '../turn/runtime';

/** The pilot is US-only (human's request, 21 Oct 2026): no per-visitor market detection. */
export const RIGHTS_PAGE_MARKET = 'US';

export interface RightsPageData {
  declaration: RightsDeclaration;
  /** The market's grievance contact, or `null` while `compliance.grievance` is still pending or blank. */
  grievance: string | null;
}

const isPendingOrBlank = (s: string): boolean => {
  const t = s.trim();
  return t === '' || t.toLowerCase() === 'pending';
};

/** Reads the rights-declaration text and the pilot market's grievance contact. Throws on a
 * broken committed file or locale pack directory, same as `loadAgeContent` (apps/web/src/auth/age.ts). */
export function loadRightsPageData(env: Env): RightsPageData {
  const dir = contentDir(env);
  const declaration = readRightsDeclaration(
    join(dir, 'legal', 'rights-declaration', 'global.md'),
  );
  const { packs } = loadLocalePacks(join(dir, 'locales'));
  const pack = pickLocalePack(RIGHTS_PAGE_MARKET, packs);
  const grievance = pack.compliance.grievance;
  return { declaration, grievance: isPendingOrBlank(grievance) ? null : grievance };
}
