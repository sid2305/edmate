// Task 9.1 Phase C: the student home view -- pure (no `requireRole`, so `view.test.tsx` renders
// it directly). 9.4: a link to the chat for each live subscription; with none, the placeholder.
// 9.3 Phase C: a second list, "packages you can start", for a live agent with no live
// subscription -- each links to the compare-and-start page, not straight to chat.
// 11.1c Phase C: a third block, "Upcoming live classes" -- title, start time, the join link (new
// tab, since it leaves the app) and the window label. Shown whenever there is at least one
// entitled class; it never affects the existing chats/startable placeholder.
// 11.2b: each listed class also gets a small "ask a question" form (`AskQuestionForm`), feeding
// the teacher's pre-class queue (`/api/live-classes/[id]/questions`).
// Security review fix (22 Oct 2026): `AskQuestionForm` is a `'use client'` component that calls
// `useTranslations('home')`; next-intl v4 throws ("No intl context found") when that runs with no
// `NextIntlClientProvider` ancestor, so without this it crashed `/home` for every student with an
// upcoming live class. Wrapped the same way `apps/web/app/teacher/live-classes/page.tsx` wraps
// `LiveClassesView` -- locale "en", only the `home` messages the client form needs -- but here,
// around the list itself (not in `page.tsx`), since `HomeView` is rendered directly in tests too.
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { UpcomingLiveClass } from '@edmate/db';
import messages from '../../messages/en.json';
import { AppShell } from '../../src/ui/AppShell';
import { AskQuestionForm } from './AskQuestionForm';
import { signOutAndRedirect } from './actions';

export interface HomeViewProps {
  /** Agent ids the student has a live subscription with (task 9.4). */
  chats?: readonly string[];
  /** Agent ids the student can start a package with -- no live subscription yet (task 9.3). */
  startable?: readonly string[];
  /** Agent ids with a paused subscription -- links to the plan page, not chat (task 9.6e). */
  paused?: readonly string[];
  /** The scope's own upcoming, entitled live classes, soonest first (task 11.1c). */
  liveClasses?: readonly UpcomingLiveClass[];
}

export async function HomeView({
  chats = [],
  startable = [],
  paused = [],
  liveClasses = [],
}: HomeViewProps = {}) {
  const shell = await getTranslations('shell');
  const t = await getTranslations('home');
  // 9.2: a link to the public discovery page; its label lives under `discovery`, not `home` (9.2
  // Phase B only adds a new top-level `discovery` key to en.json).
  const discovery = await getTranslations('discovery');
  return (
    <AppShell
      brand={shell('brand')}
      skipLabel={shell('skipToContent')}
      nav={[{ href: '/teachers', label: discovery('findTeacherNav') }]}
      signOutAction={signOutAndRedirect}
      signOutLabel={shell('signOut')}
    >
      <h1>{t('title')}</h1>
      {chats.length === 0 && startable.length === 0 && paused.length === 0 ? (
        <p>{t('placeholder')}</p>
      ) : (
        <>
          {chats.length > 0 && (
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
          {startable.length > 0 && (
            <>
              <h2>{t('startableTitle')}</h2>
              <ul className="home-startable">
                {startable.map((agentId) => (
                  <li key={agentId}>
                    <a className="button" href={`/packages/${encodeURIComponent(agentId)}`}>
                      {t('startLink')}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {paused.length > 0 && (
            <>
              <h2>{t('pausedTitle')}</h2>
              <ul className="home-paused">
                {paused.map((agentId) => (
                  <li key={agentId}>
                    <a className="button" href={`/learn/${encodeURIComponent(agentId)}/plan`}>
                      {t('pausedLink')}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {liveClasses.length > 0 && (
        <>
          <h2>{t('liveClasses.title')}</h2>
          <NextIntlClientProvider locale="en" messages={{ home: messages.home }}>
            <ul className="home-live-classes">
              {liveClasses.map((liveClass) => (
                <li key={liveClass.id}>
                  <span>{liveClass.title}</span>{' '}
                  <time dateTime={liveClass.startsAt}>{liveClass.startsAt}</time>{' '}
                  {liveClass.window !== 'later' && (
                    <span>{t(`liveClasses.window.${liveClass.window}`)}</span>
                  )}{' '}
                  {liveClass.link !== null && (
                    <a href={liveClass.link} target="_blank" rel="noopener noreferrer">
                      {t('liveClasses.join')}
                    </a>
                  )}
                  <AskQuestionForm liveClassId={liveClass.id} />
                </li>
              ))}
            </ul>
          </NextIntlClientProvider>
        </>
      )}
    </AppShell>
  );
}
