// Task 9.1 Phase C: the student home view -- pure (no `requireRole`, so `view.test.tsx` renders
// it directly). 9.4: a link to the chat for each live subscription; with none, the placeholder.
import { getTranslations } from 'next-intl/server';
import { AppShell } from '../../src/ui/AppShell';
import { signOutAndRedirect } from './actions';

export interface HomeViewProps {
  /** Agent ids the student has a live subscription with (task 9.4). */
  chats?: readonly string[];
}

export async function HomeView({ chats = [] }: HomeViewProps = {}) {
  const shell = await getTranslations('shell');
  const t = await getTranslations('home');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/home', label: t('nav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {chats.length === 0 ? (
        <p>{t('placeholder')}</p>
      ) : (
        <ul className="home-chats">
          {chats.map((agentId) => (
            <li key={agentId}>
              <a className="button" href={`/learn/${encodeURIComponent(agentId)}`}>
                {t('chatLink')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
