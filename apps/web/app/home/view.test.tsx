// @vitest-environment jsdom
// Task 9.1 Phase C: the student home view -- pure, no `requireRole` to stub. Written and red
// before `view.tsx` exists (TDD).
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

vi.mock('./actions', () => ({ signOutAndRedirect: vi.fn() }));
// Same reason as `app/sign-in/page.test.tsx`: next-intl's real server API isn't callable under
// jsdom (no server/client runtime split there); the mock reads the same `en.json` the production
// `src/i18n/request.ts` loads, so a typo'd or missing key still fails the test.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));

import { HomeView } from './view';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('HomeView', () => {
  it('shows the placeholder and a Home nav link and sign-out button', async () => {
    render(await HomeView());
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText(/teacher.*agent.*here soon/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(await HomeView());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
