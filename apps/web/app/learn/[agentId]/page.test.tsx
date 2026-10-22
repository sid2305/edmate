// @vitest-environment jsdom
// Task 9.4 Phase C: the /learn/[agentId] page under the real `createGuard` with fake deps.
// Clearance (9.1 lead requirement): a `parent_needed` student is redirected to the age gate
// before any database read; a teacher is refused; a `clear` student gets the chat. Another
// student's `?s=` is ignored; a non-live agent is not found.
import type { Message } from '@edmate/contracts';
import type { StudentScope } from '@edmate/db';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
class NotFound extends Error {}

const state = vi.hoisted(() => ({
  who: 'clear' as string,
  dbOpened: 0,
}));

vi.mock('../../../src/auth', async () => {
  const { createGuard } = await import('../../../src/auth/guard');
  const people: Record<string, { userId: string; role: 'student' | 'teacher'; status?: string }> = {
    clear: { userId: 'stu_1', role: 'student', status: 'clear' },
    parent: { userId: 'stu_1', role: 'student', status: 'parent_needed' },
    teacher: { userId: 'tch_a', role: 'teacher' },
  };
  const guard = createGuard(
    () => ({
      getPrincipal: async () => {
        const p = people[state.who];
        return p === undefined ? null : { userId: p.userId, role: p.role };
      },
      learnerStatus: async () => (people[state.who]?.status ?? 'clear') as never,
      allowedOrigin: 'http://localhost:8080',
    }),
    () => ({
      cookies: async () => ({ get: () => undefined }),
      redirect: (url: string) => {
        throw new Redirect(url);
      },
      notFound: () => {
        throw new NotFound();
      },
    }),
  );
  const history: Message[] = [
    { id: 'msg_1', role: 'student', text: 'Earlier question', createdAt: '2026-10-20T10:00:00.000Z' },
    { id: 'msg_2', role: 'teacher', text: 'Teacher note', createdAt: '2026-10-20T10:00:01.000Z' },
  ];
  const repos = {
    agents: {
      owner: async ({ agentId }: { agentId: string }) => (agentId === 'agt_a' ? { teacherId: 'tch_a' } : null),
    },
    sessions: {
      get: async (scope: StudentScope, id: string) =>
        id === 'ses_own' && scope.studentId === 'stu_1'
          ? { agentId: 'agt_a', endedAt: null }
          : null,
    },
    messages: { history: async () => history },
  };
  return {
    requireRole: guard.requireRole,
    serverDatabase: () => {
      state.dbOpened += 1;
      return { repos, identity: {} };
    },
    HOME_PATH: '/home',
  };
});

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound();
  },
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));

vi.mock('../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));

import LearnPage from './page';

const props = (agentId: string, s?: string) => ({
  params: Promise.resolve({ agentId }),
  searchParams: Promise.resolve(s === undefined ? {} : { s }),
});

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

beforeEach(() => {
  state.who = 'clear';
  state.dbOpened = 0;
});

describe('/learn/[agentId] clearance', () => {
  it('a parent_needed student is redirected to the age gate, before any database read', async () => {
    state.who = 'parent';
    const err = await LearnPage(props('agt_a', 'ses_own')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Redirect);
    expect((err as Redirect).url).toBe('/welcome/age');
    expect(state.dbOpened).toBe(0);
  });

  it('a teacher is refused (not found)', async () => {
    state.who = 'teacher';
    await expect(LearnPage(props('agt_a'))).rejects.toBeInstanceOf(NotFound);
    expect(state.dbOpened).toBe(0);
  });

  it('anonymous is sent to sign in', async () => {
    state.who = 'nobody';
    const err = await LearnPage(props('agt_a')).catch((e: unknown) => e);
    expect((err as Redirect).url).toBe('/sign-in');
  });

  it('a clear student gets the chat, with the own session history', async () => {
    const { container } = render(await LearnPage(props('agt_a', 'ses_own')));
    expect(screen.getByRole('heading', { name: "Chat with your teacher's agent" })).toBeInTheDocument();
    expect(screen.getByText('Earlier question')).toBeInTheDocument();
    expect(screen.getByText('Your teacher')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    // 6.5: the nav link to the student's own view, export and reset of what the agent remembers.
    expect(screen.getByRole('link', { name: 'What your tutor remembers' })).toHaveAttribute(
      'href',
      '/learn/agt_a/memory',
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('/learn/[agentId] loading', () => {
  it("another student's or an unknown ?s= is ignored: the chat starts empty", async () => {
    render(await LearnPage(props('agt_a', 'ses_someone_else')));
    expect(screen.queryByText('Earlier question')).toBeNull();
    expect(screen.getByText('Ask your first question below.')).toBeInTheDocument();
  });

  it('a non-live agent is not found', async () => {
    await expect(LearnPage(props('agt_draft'))).rejects.toBeInstanceOf(NotFound);
  });
});
