// Task 12.3 Phase C: the public rights-declaration page. Public (no `requireRole`, no client
// fetch), same shell as `app/teachers/page.tsx` (task 9.2). Reads the declaration (task 12.3a)
// and the pilot's US locale pack's grievance contact (task 3.10, `pickLocalePack`); the human
// fills the contact in the US pack before the pilot gate (12.3's lead answer, Q1) -- this page
// never writes one. Reachable without sign-in from `/teachers` (a link in its footer area).
import { getTranslations } from 'next-intl/server';
import { currentPrincipal } from '../../../src/auth';
import { publicNav } from '../../../src/discovery/nav';
import { loadRightsPageData } from '../../../src/legal/page-data';
import { AppShell } from '../../../src/ui/AppShell';

export const dynamic = 'force-dynamic';

export default async function RightsPage() {
  const shell = await getTranslations('shell');
  const discovery = await getTranslations('discovery');
  const t = await getTranslations('legal');
  const principal = await currentPrincipal();
  const nav = publicNav(principal, {
    signIn: discovery('signInNav'),
    home: discovery('homeNav'),
  });
  const shellProps = {
    brand: shell('brand'),
    skipLabel: shell('skipToContent'),
    nav: nav.nav,
    ...(nav.signOutAction
      ? { signOutAction: nav.signOutAction, signOutLabel: shell('signOut') }
      : {}),
  };

  const data = loadRightsPageData(process.env);
  const paragraphs = data.declaration.body.split(/\n{2,}/).filter((p) => p.trim() !== '');

  return (
    <AppShell {...shellProps}>
      <h1>{t('title')}</h1>
      <article>
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </article>
      <p>
        {data.grievance === null
          ? t('grievanceFallback')
          : t('grievanceLabel', { contact: data.grievance })}
      </p>
      <p>{t('repeatInfringerNote')}</p>
    </AppShell>
  );
}
