// Task 9.2 Phase C: the public teacher page. Anonymous access (`requireRole` is never called),
// server-rendered, no client component and no client fetch. Missing and private teachers both
// 404 the same way (`teacherBySlug` is null for either: no enumeration). A repository error
// propagates to Next's error page (scope decision 5). Teacher-written text is plain React text.
import type { PackageOffer } from '@edmate/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { currentPrincipal, serverDatabase } from '../../../src/auth';
import type { Translate } from '../../../src/discovery/format';
import { publicNav } from '../../../src/discovery/nav';
import { PackageList } from '../../../src/discovery/PackageList';
import { ScorecardPanel } from '../../../src/discovery/ScorecardPanel';
import { toPublicScorecard, type PublicScorecard } from '../../../src/discovery/scorecard';
import { AppShell } from '../../../src/ui/AppShell';

export const dynamic = 'force-dynamic';

/**
 * Copy of `@edmate/db`'s teacher `Slug` rule (teacher-profiles.ts, not exported from the package
 * root): lower-case words joined by single hyphens, 3 to 60 characters. Checked here so a
 * malformed URL 404s before any SQL instead of surfacing the repository's scope error.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const META_DESCRIPTION_MAX = 160;

export interface TeacherPageProps {
  params: Promise<{ slug: string }>;
}

function validSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 60 && SLUG.test(slug);
}

/** One read per request, shared by `generateMetadata` and the page. */
const teacherBySlug = cache(async (slug: string) =>
  serverDatabase().repos.discovery.teacherBySlug({ slug }),
);

/**
 * The stored scorecard for the teacher's (one, MVP) live agent, as the public projection. A
 * missing agent, a draft agent, or no passed gate run all come back `null` from
 * `publicScorecard` itself (it joins on `agents.status = 'live'` and a verified teacher), so the
 * page never special-cases them. A read failure never 500s the page: it logs only the error name
 * and renders "no published scorecard yet" (plan Phase E).
 */
async function teacherScorecard(
  repos: ReturnType<typeof serverDatabase>['repos'],
  agentIds: string[],
): Promise<PublicScorecard | null> {
  const agentId = agentIds[0];
  if (agentId === undefined) return null;
  try {
    const stored = await repos.publish.publicScorecard({ agentId });
    return stored === null ? null : toPublicScorecard(stored);
  } catch (err) {
    console.error('teacher_page.scorecard_read_failed', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

function describe(bio: string): string {
  const flat = bio.replace(/\s+/g, ' ').trim();
  if (flat.length <= META_DESCRIPTION_MAX) return flat;
  return `${flat.slice(0, META_DESCRIPTION_MAX - 1).trimEnd()}…`;
}

export async function generateMetadata({ params }: TeacherPageProps): Promise<Metadata> {
  const t = (await getTranslations('teacherPage')) as unknown as Translate;
  const { slug } = await params;
  const teacher = validSlug(slug) ? await teacherBySlug(slug) : null;
  if (teacher === null) return { title: t('defaultTitle') };
  return {
    title: t('metaTitle', { name: teacher.displayName, subject: teacher.subject }),
    description: describe(teacher.bio),
  };
}

export default async function TeacherPage({ params }: TeacherPageProps) {
  const { slug } = await params;
  if (!validSlug(slug)) return notFound();
  const teacher = await teacherBySlug(slug);
  if (teacher === null) return notFound();

  const { repos } = serverDatabase();
  // Each live agent's live packages, as 9.3's compare page reads them. Only the public offer is
  // kept (never the packageVersionId); an agent with none left gets no section and no link. Run
  // alongside the scorecard read (independent of each other); `teacherScorecard` keeps its own
  // try/catch so a scorecard-read failure never makes this `Promise.all` reject.
  const [offers, scorecard] = await Promise.all([
    Promise.all(
      teacher.agentIds.map(async (agentId) => ({
        agentId,
        packages: (await repos.packageVersions.liveForAgent({ agentId })).map(
          (p): PackageOffer => p.offer,
        ),
      })),
    ),
    teacherScorecard(repos, teacher.agentIds),
  ]);
  const agents = offers.filter((a) => a.packages.length > 0);

  const shell = await getTranslations('shell');
  const discovery = await getTranslations('discovery');
  const t = (await getTranslations('teacherPage')) as unknown as Translate;
  const principal = await currentPrincipal();
  const nav = publicNav(principal, { signIn: discovery('signInNav'), home: discovery('homeNav') });

  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={nav.nav}
      {...(nav.signOutAction
        ? { signOutAction: nav.signOutAction, signOutLabel: shell('signOut') }
        : {})}
    >
      <h1>{teacher.displayName}</h1>
      <p className="teacher-subject">{teacher.subject}</p>
      <p className="teacher-bio">{teacher.bio}</p>
      {teacher.languages.length > 0 ? (
        <p className="teacher-languages">
          {t('languagesLabel')}: {teacher.languages.join(', ')}
        </p>
      ) : null}
      <section aria-labelledby="teacher-packages-heading">
        <h2 id="teacher-packages-heading">{t('packagesHeading')}</h2>
        {agents.length === 0 ? (
          <p>{t('noPackages')}</p>
        ) : (
          agents.map((agent) => (
            <div key={agent.agentId} className="teacher-agent-packages">
              <PackageList packages={agent.packages} t={t} />
              <a className="button" href={`/packages/${encodeURIComponent(agent.agentId)}`}>
                {t('choosePackage')}
              </a>
            </div>
          ))
        )}
      </section>
      <ScorecardPanel scorecard={scorecard} t={t} />
    </AppShell>
  );
}
