// @vitest-environment jsdom
// Task 9.1 Phase C: the student home view -- pure, no `requireRole` to stub. Written and red
// before `view.tsx` exists (TDD).
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { createTranslator } from 'next-intl';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

vi.mock('./actions', () => ({ signOutAndRedirect: vi.fn() }));
// 11.2b: `AskQuestionForm` is a client component (`useTranslations` from `next-intl`, which needs
// a real provider this file doesn't set up -- see the mock below for `next-intl/server`, the
// server-side API `HomeView` itself calls). Mocked here the same way `LiveClassesView` is mocked
// in `page.test.tsx`; its own interactive behaviour (submit, busy state, errors) is covered by
// `AskQuestionForm.test.tsx` under the real `NextIntlClientProvider`.
vi.mock('./AskQuestionForm', () => ({
  AskQuestionForm: ({ liveClassId }: { liveClassId: string }) => (
    <span data-testid={`ask-question-${liveClassId}`}>ask form for {liveClassId}</span>
  ),
}));
// Same reason as `app/sign-in/page.test.tsx`: next-intl's real server API isn't callable under
// jsdom (no server/client runtime split there); the mock reads the same `en.json` the production
// `src/i18n/request.ts` loads, so a typo'd or missing key still fails the test. `createTranslator`
// (re-exported by `next-intl` from `use-intl/core`) is the same formatter the real server API
// uses underneath -- nested keys (e.g. `liveClasses.window.reminder_24h`) and ICU params (e.g.
// `unavailableLine`'s plural, task 9.3f Phase C) both work exactly as in production.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) =>
    createTranslator({ locale: 'en', messages, namespace }),
}));

import { HomeView } from './view';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('HomeView', () => {
  it('shows the placeholder and a sign-out button, with no self-link to /home (task 9.1b)', async () => {
    render(await HomeView());
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText(/teacher.*agent.*here soon/i)).toBeInTheDocument();
  });

  it('has a "Find a teacher" nav link to /teachers (task 9.2)', async () => {
    render(await HomeView());
    expect(screen.getByRole('link', { name: 'Find a teacher' })).toHaveAttribute('href', '/teachers');
  });

  it('with a live subscription, links to its chat instead of the placeholder (task 9.4)', async () => {
    const { container } = render(await HomeView({ chats: ['demo-agent'] }));
    expect(screen.getByRole('link', { name: "Chat with your teacher's agent" })).toHaveAttribute(
      'href',
      '/learn/demo-agent',
    );
    expect(screen.queryByText(/teacher.*agent.*here soon/i)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('with no live subscription, the placeholder stays', async () => {
    render(await HomeView({ chats: [] }));
    expect(screen.queryByRole('link', { name: "Chat with your teacher's agent" })).toBeNull();
    expect(screen.getByText(/teacher.*agent.*here soon/i)).toBeInTheDocument();
  });

  it('with a startable agent, links to its compare-and-start page (task 9.3)', async () => {
    const { container } = render(await HomeView({ startable: ['demo-agent'] }));
    expect(screen.getByRole('link', { name: 'Start a package' })).toHaveAttribute(
      'href',
      '/packages/demo-agent',
    );
    expect(screen.getByText('Packages you can start')).toBeInTheDocument();
    expect(screen.queryByText(/teacher.*agent.*here soon/i)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows both a chat link and a start link together, no placeholder', async () => {
    render(await HomeView({ chats: ['agt_a'], startable: ['agt_b'] }));
    expect(screen.getByRole('link', { name: "Chat with your teacher's agent" })).toHaveAttribute(
      'href',
      '/learn/agt_a',
    );
    expect(screen.getByRole('link', { name: 'Start a package' })).toHaveAttribute('href', '/packages/agt_b');
    expect(screen.queryByText(/teacher.*agent.*here soon/i)).toBeNull();
  });

  it('with neither chats nor startable agents, only the placeholder shows', async () => {
    render(await HomeView({ chats: [], startable: [] }));
    expect(screen.queryByText('Packages you can start')).toBeNull();
    expect(screen.getByText(/teacher.*agent.*here soon/i)).toBeInTheDocument();
  });

  // Task 9.6e: a paused subscription's own entry point, linking to the plan page.
  describe('paused plans (task 9.6e)', () => {
    it('with a paused agent, shows a Paused list linking to the plan page', async () => {
      const { container } = render(await HomeView({ paused: ['demo-agent'] }));
      expect(screen.getByText('Paused')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Manage plan' })).toHaveAttribute(
        'href',
        '/learn/demo-agent/plan',
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it('a paused plan alone suppresses the empty-state placeholder (the placeholder shows only when all three lists are empty)', async () => {
      render(await HomeView({ chats: [], startable: [], paused: ['demo-agent'] }));
      expect(screen.queryByText(/teacher.*agent.*here soon/i)).toBeNull();
      expect(screen.getByText('Paused')).toBeInTheDocument();
    });

    it('the placeholder shows only when all three lists are empty', async () => {
      render(await HomeView({ chats: [], startable: [], paused: [] }));
      expect(screen.getByText(/teacher.*agent.*here soon/i)).toBeInTheDocument();
    });

    it('with chats and a paused plan, no placeholder, both lists show', async () => {
      render(await HomeView({ chats: ['agt_a'], paused: ['agt_b'] }));
      expect(screen.queryByText(/teacher.*agent.*here soon/i)).toBeNull();
      expect(screen.getByRole('link', { name: "Chat with your teacher's agent" })).toHaveAttribute(
        'href',
        '/learn/agt_a',
      );
      expect(screen.getByRole('link', { name: 'Manage plan' })).toHaveAttribute(
        'href',
        '/learn/agt_b/plan',
      );
    });
  });

  // Task 9.3f Phase C / B-49: a subscription whose agent is no longer live shows one blame-free
  // line, no teacher name, placed after the chats/startable/paused block.
  describe('unavailable (task 9.3f Phase C / B-49)', () => {
    it('absent when unavailable is empty or omitted', async () => {
      render(await HomeView({ chats: ['agt_a'] }));
      expect(
        screen.queryByText(/isn't available right now|aren't available right now/i),
      ).toBeNull();
      render(await HomeView({ chats: ['agt_a'], unavailable: [] }));
      expect(
        screen.queryAllByText(/isn't available right now|aren't available right now/i),
      ).toHaveLength(0);
    });

    it('shows the singular line for exactly one unavailable agent', async () => {
      render(await HomeView({ chats: ['agt_a'], unavailable: ['agt_s'] }));
      expect(
        screen.getByText("One of your teachers' agents isn't available right now."),
      ).toBeInTheDocument();
    });

    it('shows the plural line for two or more unavailable agents', async () => {
      render(await HomeView({ chats: ['agt_a'], unavailable: ['agt_s', 'agt_t'] }));
      expect(
        screen.getByText("2 of your teachers' agents aren't available right now."),
      ).toBeInTheDocument();
    });

    it('shows alongside an active chat, naming no teacher detail', async () => {
      const { container } = render(
        await HomeView({ chats: ['agt_a'], unavailable: ['agt_s'] }),
      );
      expect(screen.getByRole('link', { name: "Chat with your teacher's agent" })).toHaveAttribute(
        'href',
        '/learn/agt_a',
      );
      expect(
        screen.getByText("One of your teachers' agents isn't available right now."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/agt_s/)).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('shows alongside the empty-state placeholder when there is nothing else', async () => {
      render(await HomeView({ chats: [], startable: [], paused: [], unavailable: ['agt_s'] }));
      expect(screen.getByText(/teacher.*agent.*here soon/i)).toBeInTheDocument();
      expect(
        screen.getByText("One of your teachers' agents isn't available right now."),
      ).toBeInTheDocument();
    });
  });

  it('has no axe violations', async () => {
    const { container } = render(await HomeView());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // Task 11.1c Phase C: upcoming live classes (docs/tasks/11.1/plan.md "Phase C").
  describe('live classes (task 11.1c)', () => {
    it('with no live classes, no section shows and the existing placeholder is unchanged', async () => {
      render(await HomeView({ liveClasses: [] }));
      expect(screen.queryByText('Upcoming live classes')).toBeNull();
      expect(screen.getByText(/teacher.*agent.*here soon/i)).toBeInTheDocument();
    });

    it('shows a class far out with no window label', async () => {
      render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_1',
              title: 'Algebra basics',
              link: 'https://meet.example.com/algebra',
              startsAt: '2099-01-01T00:00:00.000Z',
              status: 'scheduled',
              window: 'later',
            },
          ],
        }),
      );
      expect(screen.getByText('Upcoming live classes')).toBeInTheDocument();
      expect(screen.getByText('Algebra basics')).toBeInTheDocument();
      expect(screen.queryByText('Starting in 24 hours')).toBeNull();
      expect(screen.queryByText('Starting in 1 hour')).toBeNull();
      expect(screen.queryByText('Starting soon')).toBeNull();
    });

    it('shows the 24h window label inside 24 hours', async () => {
      render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_2',
              title: 'Geometry',
              link: 'https://meet.example.com/geometry',
              startsAt: '2099-01-02T00:00:00.000Z',
              status: 'scheduled',
              window: 'reminder_24h',
            },
          ],
        }),
      );
      expect(screen.getByText('Starting in 24 hours')).toBeInTheDocument();
    });

    it('shows the 1h window label inside 1 hour', async () => {
      render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_3',
              title: 'Trigonometry',
              link: 'https://meet.example.com/trig',
              startsAt: '2099-01-03T00:00:00.000Z',
              status: 'scheduled',
              window: 'reminder_1h',
            },
          ],
        }),
      );
      expect(screen.getByText('Starting in 1 hour')).toBeInTheDocument();
    });

    it('join link always opens in a new tab with rel="noopener noreferrer"', async () => {
      render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_4',
              title: 'Calculus',
              link: 'https://meet.example.com/calc',
              startsAt: '2099-01-04T00:00:00.000Z',
              status: 'scheduled',
              window: 'starting_soon',
            },
          ],
        }),
      );
      const link = screen.getByRole('link', { name: 'Join' });
      expect(link).toHaveAttribute('href', 'https://meet.example.com/calc');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders an ask-a-question form for each listed live class (task 11.2b)', async () => {
      render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_1',
              title: 'Algebra basics',
              link: null,
              startsAt: '2099-01-01T00:00:00.000Z',
              status: 'scheduled',
              window: 'later',
            },
            {
              id: 'lc_2',
              title: 'Geometry',
              link: null,
              startsAt: '2099-01-02T00:00:00.000Z',
              status: 'scheduled',
              window: 'later',
            },
          ],
        }),
      );
      expect(screen.getByTestId('ask-question-lc_1')).toBeInTheDocument();
      expect(screen.getByTestId('ask-question-lc_2')).toBeInTheDocument();
    });

    // Task 11.1d Phase C: a cancelled class shows "Cancelled" instead of the window label, with
    // no join link and no ask-a-question form; a scheduled class is unaffected.
    it('a cancelled class shows the Cancelled label, no join link, no ask-a-question form', async () => {
      render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_6',
              title: 'Cancelled class',
              link: 'https://meet.example.com/cancelled',
              startsAt: '2099-01-06T00:00:00.000Z',
              status: 'cancelled',
              window: 'reminder_1h',
            },
          ],
        }),
      );
      expect(screen.getByText('Cancelled class')).toBeInTheDocument();
      expect(screen.getByText('Cancelled')).toBeInTheDocument();
      expect(screen.queryByText('Starting in 1 hour')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Join' })).toBeNull();
      expect(screen.queryByTestId('ask-question-lc_6')).toBeNull();
    });

    it('a scheduled class alongside a cancelled one keeps its own join link and ask form', async () => {
      render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_7',
              title: 'Still on',
              link: 'https://meet.example.com/still-on',
              startsAt: '2099-01-07T00:00:00.000Z',
              status: 'scheduled',
              window: 'later',
            },
            {
              id: 'lc_8',
              title: 'Called off',
              link: 'https://meet.example.com/called-off',
              startsAt: '2099-01-08T00:00:00.000Z',
              status: 'cancelled',
              window: 'later',
            },
          ],
        }),
      );
      expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute(
        'href',
        'https://meet.example.com/still-on',
      );
      expect(screen.getByTestId('ask-question-lc_7')).toBeInTheDocument();
      expect(screen.getByText('Called off')).toBeInTheDocument();
      expect(screen.getByText('Cancelled')).toBeInTheDocument();
      expect(screen.queryByTestId('ask-question-lc_8')).toBeNull();
    });

    it('no axe violations with a cancelled live class shown', async () => {
      const { container } = render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_9',
              title: 'Cancelled, axe check',
              link: 'https://meet.example.com/axe',
              startsAt: '2099-01-09T00:00:00.000Z',
              status: 'cancelled',
              window: 'later',
            },
          ],
        }),
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it('no axe violations with a live class shown', async () => {
      const { container } = render(
        await HomeView({
          liveClasses: [
            {
              id: 'lc_5',
              title: 'Chemistry',
              link: 'https://meet.example.com/chem',
              startsAt: '2099-01-05T00:00:00.000Z',
              status: 'scheduled',
              window: 'reminder_1h',
            },
          ],
        }),
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
