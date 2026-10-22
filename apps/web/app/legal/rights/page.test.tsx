// @vitest-environment jsdom
// Task 12.3 Phase C: the public rights-declaration page. Public access (no `requireRole`, no
// client fetch); `loadRightsPageData` is mocked so the test never touches the real content
// directory (that is `src/legal/page-data.test.ts`'s job, mirroring the real file directly).
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  currentPrincipal: vi.fn(),
  loadRightsPageData: vi.fn(),
}));

vi.mock('../../../src/auth', () => ({
  currentPrincipal: state.currentPrincipal,
  HOME_PATH: '/home',
  SIGN_IN_PATH: '/sign-in',
  TEACHER_PATH: '/teacher',
}));
vi.mock('../../../src/legal/page-data', () => ({
  loadRightsPageData: state.loadRightsPageData,
  RIGHTS_PAGE_MARKET: 'US',
}));
vi.mock('../../home/actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, unknown>;
    return (key: string, params?: Record<string, string>) => {
      const template = bundle[key] as string;
      return params
        ? template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
        : template;
    };
  },
}));

import RightsPage from './page';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

beforeEach(() => {
  state.currentPrincipal.mockReset();
  state.loadRightsPageData.mockReset();
  state.currentPrincipal.mockResolvedValue(null);
  state.loadRightsPageData.mockReturnValue({
    declaration: { body: 'Para one.\n\nPara two.', version: 'draft-0', reviewedBy: 'pending', reviewedOn: '2026-10-22' },
    grievance: null,
  });
});

describe('/legal/rights page', () => {
  it('renders for an anonymous visitor without any sign-in prompt', async () => {
    render(await RightsPage());
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByText(/sign in to continue/i)).toBeNull();
  });

  it('renders the declaration body as paragraphs', async () => {
    render(await RightsPage());
    expect(screen.getByText('Para one.')).toBeInTheDocument();
    expect(screen.getByText('Para two.')).toBeInTheDocument();
  });

  it('shows the neutral fallback while the grievance contact is pending', async () => {
    render(await RightsPage());
    expect(
      screen.getByText('A grievance contact for this market has not yet been published.'),
    ).toBeInTheDocument();
  });

  it('shows the real grievance contact once it is signed off', async () => {
    state.loadRightsPageData.mockReturnValue({
      declaration: { body: 'Para one.', version: 'draft-0', reviewedBy: 'pending', reviewedOn: '2026-10-22' },
      grievance: 'Edmate Trust & Safety, trust@example.test',
    });
    render(await RightsPage());
    expect(
      screen.getByText('Grievance contact: Edmate Trust & Safety, trust@example.test'),
    ).toBeInTheDocument();
  });

  it('shows the repeat-infringer note with no number or threshold named', async () => {
    render(await RightsPage());
    expect(
      screen.getByText("Repeated upheld takedowns can end a teacher's account on Edmate."),
    ).toBeInTheDocument();
  });

  it('shows Home and a sign-out button for a signed-in teacher', async () => {
    state.currentPrincipal.mockResolvedValue({ userId: 't1', role: 'teacher' });
    render(await RightsPage());
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(await RightsPage());
    expect(await axe(container)).toHaveNoViolations();
  });
});
