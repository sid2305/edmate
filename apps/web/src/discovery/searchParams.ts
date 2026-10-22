// Task 9.2 Phase B: turns a Next.js page's raw `searchParams` into a validated, bounded input for
// `repos.discovery.search` -- trimmed, cut at `DISCOVERY_QUERY_MAX_LENGTH`, a bad `lang` or `page`
// dropped rather than thrown (this page is anonymous and public; a typo'd URL should show the
// default list, not an error page). The one-letter mismatch is intentional: the URL parameter is
// `lang` (short, user-facing); the repository's own field is `language`.
import { DISCOVERY_MAX_PAGE, DISCOVERY_QUERY_MAX_LENGTH } from '@edmate/db';

/**
 * Mirrors `packages/db/src/repositories/teacher-profiles.ts`'s `LanguageTag` zod schema, which
 * isn't exported from `@edmate/db`'s root barrel (it's an internal, read-only reuse by
 * `discovery.ts`). A copy here is only ever a pre-filter: a value that slips past it but fails the
 * repository's own schema still comes back as a `scope` error there, never SQL.
 */
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export interface DiscoveryParams {
  q?: string;
  language?: string;
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** The first value of a repeated parameter (Next gives an array when a key repeats). */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseDiscoveryParams(searchParams: RawSearchParams): DiscoveryParams {
  const result: DiscoveryParams = { page: 1 };

  const q = first(searchParams.q)?.trim();
  if (q) result.q = q.slice(0, DISCOVERY_QUERY_MAX_LENGTH);

  const language = first(searchParams.lang)?.trim();
  if (language && LANGUAGE_RE.test(language)) result.language = language;

  const pageRaw = first(searchParams.page)?.trim();
  if (pageRaw !== undefined && pageRaw !== '') {
    const page = Number(pageRaw);
    if (Number.isInteger(page) && page >= 1 && page <= DISCOVERY_MAX_PAGE) result.page = page;
  }

  return result;
}
