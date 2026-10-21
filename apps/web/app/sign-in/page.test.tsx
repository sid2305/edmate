// @vitest-environment jsdom
// Task 9.1 Phase B: the sign-in page -- one Google button, one plain email link, no empty nav,
// wrapped in AppShell. Written and red before the page exists (TDD).
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

vi.mock('./actions', () => ({ signInWithGoogle: vi.fn() }));
// `getTranslations`'s real implementation picks next-intl's client build under jsdom (vitest has
// no server/client runtime split); the server-only API isn't callable there at all. Reading the
// same `en.json` the real config loads keeps the test exercising real strings, not fixtures.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, string>;
    return (key: string) => bundle[key];
  },
}));

import SignInPage from './page';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('SignInPage', () => {
  it('offers Google sign-in and a plain email sign-in link', async () => {
    render(await SignInPage());
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Sign in with email instead' });
    expect(link).toHaveAttribute('href', '/api/auth/signin');
  });

  it('has no axe violations', async () => {
    const { container } = render(await SignInPage());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
