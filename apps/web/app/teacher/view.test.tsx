// @vitest-environment jsdom
// Task 9.1 Phase C: the teacher placeholder view -- pure, no `requireRole` to stub. 8.1 replaces
// or extends this. Written and red before `view.tsx` exists (TDD).
import { render, screen, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

vi.mock('./actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));

import { TeacherView } from './view';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('TeacherView', () => {
  it('shows the coming-soon placeholder and a sign-out button', async () => {
    render(await TeacherView());
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('links to the upload centre from the main nav', async () => {
    render(await TeacherView());
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Uploads' })).toHaveAttribute(
      'href',
      '/teacher/uploads',
    );
  });

  it('links to the outline editor from the main nav', async () => {
    render(await TeacherView());
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Outline' })).toHaveAttribute(
      'href',
      '/teacher/outline',
    );
  });

  it('links to the onboarding form from the main nav', async () => {
    render(await TeacherView());
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Your profile' })).toHaveAttribute(
      'href',
      '/teacher/onboarding',
    );
  });

  it('links to the style card studio from the main nav', async () => {
    render(await TeacherView());
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Teaching style' })).toHaveAttribute(
      'href',
      '/teacher/style-card',
    );
  });

  it('links to the publish page from the main nav', async () => {
    render(await TeacherView());
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Publish' })).toHaveAttribute(
      'href',
      '/teacher/publish',
    );
  });

  it('links to the package builder from the main nav', async () => {
    render(await TeacherView());
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Packages' })).toHaveAttribute(
      'href',
      '/teacher/packages',
    );
  });

  it('links to the insights page from the main nav', async () => {
    render(await TeacherView());
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Insights' })).toHaveAttribute(
      'href',
      '/teacher/insights',
    );
  });

  it('links to the questions inbox from the main nav', async () => {
    render(await TeacherView());
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Questions' })).toHaveAttribute(
      'href',
      '/teacher/questions',
    );
  });

  it('has no axe violations', async () => {
    const { container } = render(await TeacherView());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows the changed-since-publish note when the prop is true, with no axe violations (8.7k)', async () => {
    const { container } = render(await TeacherView({ changedSincePublish: true }));
    expect(
      screen.getByText("You've made changes since your last publish."),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows no note by default, with no axe violations', async () => {
    const { container } = render(await TeacherView());
    expect(
      screen.queryByText("You've made changes since your last publish."),
    ).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
