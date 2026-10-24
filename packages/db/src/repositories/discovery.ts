// Public discovery (task 9.2): anyone can search verified teachers with a live, sellable package,
// and open their public page by slug. No scope, no login: every input is parsed strictly before
// any SQL, like `agents.owner`/`packageVersions.liveForAgent` -- a malformed input is `scope`,
// never `invalid` -- and the WHERE clause itself enforces who is public (scope decision 1), so a
// pending, rejected, role-changed, draft-agent, suspended-agent or no-live-package teacher is
// absent from `search` and `null` by slug -- the same as a missing one (no enumeration). Only the
// documented public fields ever leave this file.
//
// Task 9.2d: `displayName` comes from the teacher's own `teacher_profiles.display_name`, never
// the account's sign-in name -- it falls back to the public `slug` when the teacher has not
// set one yet (scope decision 2). The `users` join stays only for `users.role`.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { agents, packages, packageVersions, teacherProfiles, users } from '../schema/index.js';
import { queryTerms, tsTerm } from './retrieval.js';
import { RepositoryError } from './errors.js';
import { LanguageTag, Slug } from './teacher-profiles.js';

export const DISCOVERY_PAGE_SIZE = 20;
export const DISCOVERY_MAX_PAGE = 50;
export const DISCOVERY_QUERY_MAX_LENGTH = 100;
/** The teacher page shows at most this many live agent ids (one teacher has one agent, MVP). */
const AGENT_IDS_MAX = 5;

const SearchInput = z.strictObject({
  q: z.string().max(DISCOVERY_QUERY_MAX_LENGTH).optional(),
  language: LanguageTag.optional(),
  page: z.int().min(1).max(DISCOVERY_MAX_PAGE).optional(),
});
const TeacherBySlugInput = z.strictObject({ slug: Slug });

/** What a search card or a teacher page shows (scope decision 2): never userId, email, phone,
 * photo, payout ref or verification status. `displayName` is the teacher's own public name
 * (`teacher_profiles.display_name`, falling back to `slug`), never the account's sign-in
 * name. */
export interface PublicTeacherCard {
  slug: string;
  displayName: string;
  subject: string;
  bio: string;
  languages: string[];
  packageCount: number;
  hasFree: boolean;
}
/** The teacher page also gets the live agent ids (already public via `agents.owner`), capped. */
export interface PublicTeacherPage extends PublicTeacherCard {
  agentIds: string[];
}

/**
 * The AND of the query's prefix terms (`'term':* & 'term':*`), built from `retrieval.ts`'s own
 * `queryTerms` + `tsTerm` (5.4 precedent: every term is a quoted literal, so no input -- quotes,
 * `&|!():*`, backslashes, emoji -- can make `to_tsquery` raise). Null when the query is empty or
 * every word is a stop word (behaves like no query).
 */
function andQuery(q: string): string | null {
  const terms = queryTerms(q);
  return terms.length === 0 ? null : terms.map(tsTerm).join(' & ');
}

/** A live package of a live agent, owned by `teacherProfiles.userId` (the `liveForAgent` join). */
const livePackageJoin = sql`
  exists (
    select 1
    from ${packages} p
    inner join ${agents} a on a.id = p.agent_id and a.status = 'live'
    inner join ${packageVersions} pv on pv.package_id = p.id and pv.version = p.live_version
    where p.teacher_id = ${teacherProfiles.userId} and p.live_version is not null
  )
`;

const packageCountExpr = sql<number>`(
  select count(*)::int
  from ${packages} p
  inner join ${agents} a on a.id = p.agent_id and a.status = 'live'
  inner join ${packageVersions} pv on pv.package_id = p.id and pv.version = p.live_version
  where p.teacher_id = ${teacherProfiles.userId} and p.live_version is not null
)`;

const hasFreeExpr = sql<boolean>`exists (
  select 1
  from ${packages} p
  inner join ${agents} a on a.id = p.agent_id and a.status = 'live'
  inner join ${packageVersions} pv on pv.package_id = p.id and pv.version = p.live_version
  where p.teacher_id = ${teacherProfiles.userId} and p.live_version is not null
    and (pv.config -> 'pricePerMonth' ->> 'amountMinor')::int = 0
)`;

const agentIdsExpr = sql<string[]>`(
  select coalesce(array_agg(x.id), '{}')
  from (
    select a.id
    from ${agents} a
    where a.teacher_id = ${teacherProfiles.userId} and a.status = 'live' and a.live_version is not null
      and exists (
        select 1
        from ${packages} p
        inner join ${packageVersions} pv on pv.package_id = p.id and pv.version = p.live_version
        where p.agent_id = a.id and p.live_version is not null
      )
    order by a.created_at, a.id
    limit ${AGENT_IDS_MAX}
  ) x
)`;

interface SearchArgs {
  q?: string;
  language?: string;
  page: number;
}

/**
 * The exact drizzle query `discovery.search` runs (not executed): exported so the int test can
 * `EXPLAIN` the statement the repository actually issues. One select, no N+1: `packageCount` and
 * `hasFree` are correlated scalar subqueries in the same statement, not a second round trip.
 */
export function searchQuery(db: Db, { q, language, page }: SearchArgs) {
  const tsq = q === undefined ? null : andQuery(q);
  const offset = (page - 1) * DISCOVERY_PAGE_SIZE;
  const where = [
    eq(teacherProfiles.verificationStatus, 'verified'),
    eq(users.role, 'teacher'),
    livePackageJoin,
  ];
  if (language !== undefined) {
    where.push(sql`${teacherProfiles.languages} @> array[${language}]::text[]`);
  }
  if (tsq !== null) {
    where.push(sql`${teacherProfiles.search} @@ to_tsquery('simple', ${tsq})`);
  }
  const query = db
    .select({
      slug: teacherProfiles.slug,
      displayName: sql<string>`coalesce(${teacherProfiles.displayName}, ${teacherProfiles.slug})`,
      subject: teacherProfiles.subject,
      bio: teacherProfiles.bio,
      languages: teacherProfiles.languages,
      packageCount: packageCountExpr,
      hasFree: hasFreeExpr,
    })
    .from(teacherProfiles)
    .innerJoin(users, eq(users.id, teacherProfiles.userId))
    .where(and(...where))
    .limit(DISCOVERY_PAGE_SIZE + 1)
    .offset(offset);
  return tsq !== null
    ? query.orderBy(
        desc(sql`ts_rank(${teacherProfiles.search}, to_tsquery('simple', ${tsq}))`),
        asc(teacherProfiles.slug),
      )
    : query.orderBy(asc(teacherProfiles.subject), asc(teacherProfiles.slug));
}

/** The first `DISCOVERY_QUERY_MAX_LENGTH` characters shown on a search card (scope decision 2). */
const SEARCH_CARD_BIO_MAX = 280;

export function discoveryRepo(db: Db) {
  return {
    /**
     * Verified teachers with a live, sellable package; public fields only (scope decision 2).
     * Like `agents.owner`, the whole input is parsed like a scope (no teacher or student scope
     * exists here): a malformed input is `scope`, never `invalid`. Pass `{}` for no filters.
     */
    async search(input: unknown): Promise<{ teachers: PublicTeacherCard[]; hasMore: boolean }> {
      const method = 'discovery.search';
      const r = SearchInput.safeParse(input);
      if (!r.success) throw new RepositoryError('scope', method);
      const p = r.data;
      const q = p.q?.trim();
      const rows = await searchQuery(db, {
        ...(q === undefined || q === '' ? {} : { q }),
        ...(p.language === undefined ? {} : { language: p.language }),
        page: p.page ?? 1,
      });
      const teachers = rows.slice(0, DISCOVERY_PAGE_SIZE).map((r) => ({
        ...r,
        bio: r.bio.slice(0, SEARCH_CARD_BIO_MAX),
      }));
      return { teachers, hasMore: rows.length > DISCOVERY_PAGE_SIZE };
    },

    /** A verified teacher's public page by slug; null if missing or private; `scope` if malformed. */
    async teacherBySlug(input: unknown): Promise<PublicTeacherPage | null> {
      const method = 'discovery.teacherBySlug';
      const r = TeacherBySlugInput.safeParse(input);
      if (!r.success) throw new RepositoryError('scope', method);
      const p = r.data;
      const [row] = await db
        .select({
          slug: teacherProfiles.slug,
          displayName: sql<string>`coalesce(${teacherProfiles.displayName}, ${teacherProfiles.slug})`,
          subject: teacherProfiles.subject,
          bio: teacherProfiles.bio,
          languages: teacherProfiles.languages,
          packageCount: packageCountExpr,
          hasFree: hasFreeExpr,
          agentIds: agentIdsExpr,
        })
        .from(teacherProfiles)
        .innerJoin(users, eq(users.id, teacherProfiles.userId))
        .where(
          and(
            eq(teacherProfiles.slug, p.slug),
            eq(teacherProfiles.verificationStatus, 'verified'),
            eq(users.role, 'teacher'),
            livePackageJoin,
          ),
        )
        .limit(1);
      return row ?? null;
    },
  };
}
