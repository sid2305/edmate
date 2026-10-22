// @vitest-environment jsdom
// Task 9.2 Phase B. Written and red before page.tsx exists (TDD). Repos mocked, no database, no
// model, no real Redis.
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

const state = vi.hoisted(() => ({
  currentPrincipal: vi.fn(),
  search: vi.fn(),
  allow: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('../../src/auth', () => ({
  currentPrincipal: state.currentPrincipal,
  requireRole: state.requireRole,
  serverDatabase: () => ({ repos: { discovery: { search: state.search } } }),
  HOME_PATH: '/home',
  SIGN_IN_PATH: '/sign-in',
  TEACHER_PATH: '/teacher',
}));
vi.mock('../../src/discovery/rateLimit', () => ({
  discoveryRateLimiter: () => ({ allow: state.allow }),
}));
vi.mock('../../app/home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));

import TeachersPage from './page';

const TEACHERS = [
  {
    slug: 'ada-lovelace',
    displayName: 'Ada Lovelace',
    subject: 'Mathematics',
    bio: 'Teaches calculus and algebra.',
    languages: ['en'],
    packageCount: 2,
    hasFree: true,
  },
];

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

beforeEach(() => {
  state.currentPrincipal.mockReset();
  state.search.mockReset();
  state.allow.mockReset();
  state.requireRole.mockReset();
  state.currentPrincipal.mockResolvedValue(null);
  state.search.mockResolvedValue({ teachers: TEACHERS, hasMore: false });
  state.allow.mockResolvedValue(true);
});

function page(searchParams: Record<string, string | string[] | undefined> = {}) {
  return TeachersPage({ searchParams: Promise.resolve(searchParams) });
}

describe('/teachers page', () => {
  it('renders for an anonymous visitor without calling requireRole', async () => {
    render(await page());
    expect(state.requireRole).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('passes parsed params to discovery.search', async () => {
    await page({ q: '  finance  ', lang: 'en', page: '2' });
    expect(state.search).toHaveBeenCalledWith({ q: 'finance', language: 'en', page: 2 });
  });

  it('shows a card per teacher with name, subject, excerpt, languages and a free badge, linking to the slug', async () => {
    render(await page());
    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/teachers/ada-lovelace');
    expect(screen.getByText('Mathematics')).toBeInTheDocument();
    expect(screen.getByText('Teaches calculus and algebra.')).toBeInTheDocument();
    expect(screen.getByText('en')).toBeInTheDocument();
    expect(screen.getByText('Free package')).toBeInTheDocument();
  });

  it('shows an empty state with the query echoed as text', async () => {
    state.search.mockResolvedValue({ teachers: [], hasMore: false });
    render(await page({ q: 'astrophysics' }));
    expect(screen.getByText(/No teachers found/)).toBeInTheDocument();
    expect(screen.getByText(/astrophysics/)).toBeInTheDocument();
  });

  it('keeps q and lang on next/previous links', async () => {
    state.search.mockResolvedValue({ teachers: TEACHERS, hasMore: true });
    render(await page({ q: 'finance', lang: 'en', page: '2' }));
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/teachers?q=finance&lang=en',
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/teachers?q=finance&lang=en&page=3',
    );
  });

  it('propagates a repository error instead of showing "no teachers found"', async () => {
    state.search.mockRejectedValue(new Error('db down'));
    await expect(page()).rejects.toThrow('db down');
  });

  it('shows Home and a sign-out button for a signed-in student, instead of Sign in', async () => {
    state.currentPrincipal.mockResolvedValue({ userId: 'u1', role: 'student' });
    render(await page());
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('shows the rate-limited state and does not query the repository when over the limit', async () => {
    state.allow.mockResolvedValue(false);
    render(await page());
    expect(screen.getByRole('status')).toHaveTextContent('Too many searches. Try again in a minute.');
    expect(state.search).not.toHaveBeenCalled();
  });

  it('links to the public rights-and-takedowns page (task 12.3c)', async () => {
    render(await page());
    expect(screen.getByRole('link', { name: 'Rights and takedowns' })).toHaveAttribute(
      'href',
      '/legal/rights',
    );
  });

  it('has no axe violations', async () => {
    const { container } = render(await page());
    expect(await axe(container)).toHaveNoViolations();
  });
});
