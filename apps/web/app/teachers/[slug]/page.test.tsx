// @vitest-environment jsdom
// Task 9.2 Phase C. Written and red before page.tsx exists (TDD). Repos mocked, no database, no
// model.
import { render, screen, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { createTranslator } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  currentPrincipal: vi.fn(),
  teacherBySlug: vi.fn(),
  liveForAgent: vi.fn(),
  publicScorecard: vi.fn(),
  requireRole: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('../../../src/auth', () => ({
  currentPrincipal: state.currentPrincipal,
  requireRole: state.requireRole,
  serverDatabase: () => ({
    repos: {
      discovery: { teacherBySlug: state.teacherBySlug },
      packageVersions: { liveForAgent: state.liveForAgent },
      publish: { publicScorecard: state.publicScorecard },
    },
  }),
  HOME_PATH: '/home',
  SIGN_IN_PATH: '/sign-in',
  TEACHER_PATH: '/teacher',
}));
vi.mock('../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: state.notFound }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) =>
    createTranslator({ locale: 'en', messages, namespace }),
}));

import TeacherPage, { generateMetadata } from './page';

const TEACHER = {
  slug: 'ada-lovelace',
  displayName: 'Ada Lovelace',
  subject: 'Mathematics',
  bio: 'Teaches calculus and algebra to adults returning to study. '.repeat(6).trim(),
  languages: ['en', 'es'],
  packageCount: 2,
  hasFree: true,
  agentIds: ['agent-1', 'agent-2'],
};

const OFFERS: Record<string, unknown[]> = {
  'agent-1': [
    {
      packageVersionId: 'pv-secret-1',
      offer: {
        packageId: 'pkg-1',
        name: 'Calculus monthly',
        pricePerMonth: { amountMinor: 1999, currency: 'USD' },
        trialDays: 7,
        dailyMessageLimit: 50,
        liveClassesPerMonth: 2,
        skills: ['explain', 'practice'],
      },
    },
  ],
  'agent-2': [
    {
      packageVersionId: 'pv-secret-2',
      offer: {
        packageId: 'pkg-2',
        name: 'Algebra starter',
        pricePerMonth: { amountMinor: 0, currency: 'USD' },
        trialDays: 0,
        dailyMessageLimit: 10,
        liveClassesPerMonth: 0,
        skills: ['revision'],
      },
    },
  ],
};

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const STORED_SCORECARD = {
  publishedAt: '2026-10-01T00:00:00.000Z',
  categories: [
    {
      key: 'hints_before_answers',
      measured: true,
      total: 10,
      passed: 9,
      percent: 90,
      pass: true,
      byOrigin: [],
    },
    {
      key: 'locked_content',
      measured: true,
      total: 5,
      passed: 5,
      percent: 100,
      pass: true,
      byOrigin: [],
    },
    {
      key: 'accuracy',
      measured: false,
      total: 0,
      passed: 0,
      percent: null,
      pass: false,
      byOrigin: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.currentPrincipal.mockResolvedValue(null);
  state.teacherBySlug.mockResolvedValue(TEACHER);
  state.liveForAgent.mockImplementation(
    async ({ agentId }: { agentId: string }) => OFFERS[agentId] ?? [],
  );
  state.publicScorecard.mockResolvedValue(null);
});

function page(slug = 'ada-lovelace') {
  return TeacherPage({ params: Promise.resolve({ slug }) });
}

describe('/teachers/[slug] page', () => {
  it.each(['Ada', 'ada--lovelace', '-ada', 'ab', 'a'.repeat(61), 'ada_lovelace', '%2e%2e', 'adá'])(
    'calls notFound() for the malformed slug %j without touching the repository',
    async (slug) => {
      await expect(page(slug)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(state.teacherBySlug).not.toHaveBeenCalled();
    },
  );

  it('calls notFound() when teacherBySlug returns null (missing or not public)', async () => {
    state.teacherBySlug.mockResolvedValue(null);
    await expect(page('private-teacher')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.teacherBySlug).toHaveBeenCalledWith({ slug: 'private-teacher' });
    expect(state.liveForAgent).not.toHaveBeenCalled();
  });

  it('renders for an anonymous visitor without calling requireRole', async () => {
    render(await page());
    expect(state.requireRole).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('renders the name, subject, full bio and languages as plain text', async () => {
    render(await page());
    expect(screen.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('Mathematics')).toBeInTheDocument();
    expect(screen.getByText(TEACHER.bio)).toBeInTheDocument();
    expect(screen.getByText('Teaches in: en, es')).toBeInTheDocument();
  });

  it('renders the live packages of each live agent from liveForAgent, with a Choose link each', async () => {
    const { container } = render(await page());
    expect(state.liveForAgent).toHaveBeenCalledWith({ agentId: 'agent-1' });
    expect(state.liveForAgent).toHaveBeenCalledWith({ agentId: 'agent-2' });
    const calculus = screen
      .getByRole('heading', { name: 'Calculus monthly' })
      .closest('li') as HTMLElement;
    expect(within(calculus).getByText('$19.99 a month')).toBeInTheDocument();
    expect(within(calculus).getByText('7 day free trial')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Algebra starter' })).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Choose a package' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/packages/agent-1',
      '/packages/agent-2',
    ]);
    expect(container.innerHTML).not.toContain('pv-secret');
  });

  it('shows no Choose link for an agent whose packages are gone since the profile read', async () => {
    state.liveForAgent.mockImplementation(async ({ agentId }: { agentId: string }) =>
      agentId === 'agent-1' ? OFFERS['agent-1'] : [],
    );
    render(await page());
    const links = screen.getAllByRole('link', { name: 'Choose a package' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/packages/agent-1']);
  });

  it('shows the "no published scorecard yet" panel when publicScorecard returns null', async () => {
    // Also covers a draft (not live) agent: publicScorecard itself filters on
    // agents.status = 'live', so a draft agent's run never qualifies and the repository
    // returns null the same way, landing on this same panel.
    render(await page());
    expect(state.publicScorecard).toHaveBeenCalledWith({ agentId: 'agent-1' });
    expect(screen.getByRole('heading', { name: 'Teaching scorecard' })).toBeInTheDocument();
    expect(screen.getByText('No published scorecard yet.')).toBeInTheDocument();
  });

  it('shows the stored scorecard through toPublicScorecard when publicScorecard returns one', async () => {
    state.publicScorecard.mockResolvedValue(STORED_SCORECARD);
    render(await page());
    expect(screen.getByText('90% of checks passed')).toBeInTheDocument();
    expect(screen.getByText('100% of checks passed')).toBeInTheDocument();
    expect(screen.getByText('Not measured yet')).toBeInTheDocument();
    expect(screen.queryByText('No published scorecard yet.')).not.toBeInTheDocument();
  });

  it('shows no scorecard (not a 500) when the scorecard read fails, logging only the error name', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.publicScorecard.mockRejectedValue(new Error('scorecard query failed: secret detail'));
    render(await page());
    expect(screen.getByText('No published scorecard yet.')).toBeInTheDocument();
    const logged = errorSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain('secret detail');
    errorSpy.mockRestore();
  });

  it('propagates a repository error instead of rendering a partial page', async () => {
    state.liveForAgent.mockRejectedValue(new Error('db down'));
    await expect(page()).rejects.toThrow('db down');
  });

  it('shows Home and sign-out for a signed-in student', async () => {
    state.currentPrincipal.mockResolvedValue({ userId: 'u1', role: 'student' });
    render(await page());
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(await page());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('generateMetadata', () => {
  function meta(slug = 'ada-lovelace') {
    return generateMetadata({ params: Promise.resolve({ slug }) });
  }

  it('gives "<name>, <subject> | Edmate" and a description of at most 160 characters', async () => {
    const m = await meta();
    expect(m.title).toBe('Ada Lovelace, Mathematics | Edmate');
    expect(typeof m.description).toBe('string');
    expect((m.description as string).length).toBeLessThanOrEqual(160);
    expect(m.description as string).toMatch(/^Teaches calculus/);
  });

  it('keeps a short bio whole', async () => {
    state.teacherBySlug.mockResolvedValue({ ...TEACHER, bio: 'Short bio.' });
    expect((await meta()).description).toBe('Short bio.');
  });

  it('gives the default title for a non-public slug, never calling notFound', async () => {
    state.teacherBySlug.mockResolvedValue(null);
    expect(await meta('private-teacher')).toEqual({ title: 'Teacher | Edmate' });
    expect(state.notFound).not.toHaveBeenCalled();
  });

  it('gives the default title for a malformed slug without touching the repository', async () => {
    expect(await meta('Bad Slug')).toEqual({ title: 'Teacher | Edmate' });
    expect(state.teacherBySlug).not.toHaveBeenCalled();
  });
});
