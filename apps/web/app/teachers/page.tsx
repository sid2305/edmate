// Task 9.2 Phase B: the public teacher search page. Anonymous access -- `requireRole` is never
// called -- and server-rendered: no client component, no client fetch, a plain GET search form.
// A `RepositoryError` with `kind === 'scope'` is caught and rendered as an empty result (scope
// decision 5: a scope error must never be distinguishable from "not found"); every other error
// still propagates. The rate limiter is the other guarded path, and fails open by design (see
// rateLimit.ts).
import { RepositoryError } from '@edmate/db';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { currentPrincipal, serverDatabase } from '../../src/auth';
import { discoveryRateLimiter } from '../../src/discovery/rateLimit';
import { parseDiscoveryParams, type DiscoveryParams } from '../../src/discovery/searchParams';
import { TeacherCard } from '../../src/discovery/TeacherCard';
import { publicNav } from '../../src/discovery/nav';
import { AppShell } from '../../src/ui/AppShell';

export const dynamic = 'force-dynamic';

export interface TeachersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Keeps `q` and `lang` across a page link; never emits `page=1`. */
function pageHref(params: DiscoveryParams, page: number): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.language) qs.set('lang', params.language);
  if (page > 1) qs.set('page', String(page));
  const search = qs.toString();
  return search ? `/teachers?${search}` : '/teachers';
}

export default async function TeachersPage({ searchParams }: TeachersPageProps) {
  const shell = await getTranslations('shell');
  const t = await getTranslations('discovery');
  const legal = await getTranslations('legal');
  const principal = await currentPrincipal();
  const nav = publicNav(principal, { signIn: t('signInNav'), home: t('homeNav') });
  const shellProps = {
    brand: shell('brand'),
    skipLabel: shell('skipToContent'),
    nav: nav.nav,
    ...(nav.signOutAction
      ? { signOutAction: nav.signOutAction, signOutLabel: shell('signOut') }
      : {}),
  };

  const params = parseDiscoveryParams(await searchParams);
  const allowed = await discoveryRateLimiter().allow(await headers());
  if (!allowed) {
    return (
      <AppShell {...shellProps}>
        <h1>{t('title')}</h1>
        <p role="status">{t('rateLimited')}</p>
      </AppShell>
    );
  }

  const { repos } = serverDatabase();
  const result = await repos.discovery
    .search({
      ...(params.q ? { q: params.q } : {}),
      ...(params.language ? { language: params.language } : {}),
      page: params.page,
    })
    .catch((error: unknown) => {
      // 9.2a scope decision: a scope error must never be distinguishable from "not found" --
      // render the same empty state a genuinely empty search gets. Any other error still
      // propagates; this isn't a blanket try/catch.
      if (error instanceof RepositoryError && error.kind === 'scope') {
        return { teachers: [], hasMore: false };
      }
      throw error;
    });

  return (
    <AppShell {...shellProps}>
      <h1>{t('title')}</h1>
      <form method="GET">
        <label htmlFor="discovery-q">{t('searchLabel')}</label>
        <input id="discovery-q" name="q" defaultValue={params.q ?? ''} maxLength={100} />
        {params.language ? <input type="hidden" name="lang" value={params.language} /> : null}
        <button type="submit">{t('searchButton')}</button>
      </form>
      {result.teachers.length === 0 ? (
        <p>
          {t('emptyState')}
          {params.q ? ` "${params.q}"` : ''}
        </p>
      ) : (
        <ul className="teacher-cards">
          {result.teachers.map((teacher) => (
            <li key={teacher.slug}>
              <TeacherCard teacher={teacher} freeLabel={t('freeBadge')} />
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Pagination">
        {params.page > 1 ? <a href={pageHref(params, params.page - 1)}>{t('prevLabel')}</a> : null}
        {result.hasMore ? <a href={pageHref(params, params.page + 1)}>{t('nextLabel')}</a> : null}
      </nav>
      <p className="app-footer">
        <a href="/legal/rights">{legal('footerLink')}</a>
      </p>
    </AppShell>
  );
}
