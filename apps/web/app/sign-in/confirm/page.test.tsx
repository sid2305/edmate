// @vitest-environment jsdom
// Task 1.4b: the magic link's confirm page. Opening the link signs in straight away only in the
// browser holding the binding cookie for that address (`auto`); anywhere else (a scanner, another
// browser, a cookie for another address) it shows the address and waits for one click.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmView } from '../../../src/auth';

const view = vi.fn<(params: unknown) => Promise<ConfirmView>>();
vi.mock('../../../src/auth', () => ({
  confirmSignInView: (params: unknown) => view(params),
  SIGN_IN_PATH: '/sign-in',
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));
const action = vi.fn<(prev: string | null, fd: FormData) => Promise<string>>();
vi.mock('./actions', () => ({
  confirmEmailSignIn: (prev: string | null, fd: FormData) => action(prev, fd),
}));

import { ConfirmForm } from './ConfirmForm';
import ConfirmSignInPage, { metadata } from './page';

const TOKEN = 'ab'.repeat(32);
const PARAMS = { token: TOKEN, email: 'student1@example.test', callbackUrl: 'http://localhost:8080/' };
const CALLBACK = `http://localhost:8080/api/auth/callback/email?token=${TOKEN}`;
const page = (search: Record<string, string | string[] | undefined> = PARAMS) =>
  ConfirmSignInPage({ searchParams: Promise.resolve(search) });

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

beforeEach(() => {
  view.mockReset();
  redirect.mockClear();
  action.mockReset();
});

describe('ConfirmSignInPage', () => {
  it('hands the query to src/auth and keeps the token out of cross-origin Referers', async () => {
    view.mockResolvedValue({ kind: 'invalid' });
    await page({ ...PARAMS, extra: ['a', 'b'] });
    expect(view).toHaveBeenCalledWith({ ...PARAMS, extra: ['a', 'b'] });
    expect(metadata.referrer).toBe('same-origin');
  });

  it('invalid: a generic message and a link back to sign-in, no redirect, no form', async () => {
    view.mockResolvedValue({ kind: 'invalid' });
    render(await page({}));
    expect(screen.getByRole('heading', { name: /isn.t valid/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new link/i })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByRole('button')).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('auto: redirects straight to the real callback and renders nothing', async () => {
    view.mockResolvedValue({ kind: 'auto', url: CALLBACK });
    await expect(page()).rejects.toThrow(`REDIRECT ${CALLBACK}`);
    expect(redirect).toHaveBeenCalledExactlyOnceWith(CALLBACK);
  });

  it('manual: shows the address and one sign-in button carrying the link fields; no redirect', async () => {
    view.mockResolvedValue({ kind: 'manual', ...PARAMS });
    const { container } = render(await page());
    expect(screen.getByText('student1@example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    const fields = Object.fromEntries(
      [...container.querySelectorAll<HTMLInputElement>('form input[type=hidden]')].map((i) => [
        i.name,
        i.value,
      ]),
    );
    expect(fields).toEqual(PARAMS);
    expect(redirect).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('manual: has no axe violations', async () => {
    view.mockResolvedValue({ kind: 'manual', ...PARAMS });
    const { container } = render(await page());
    expect(await axe(container)).toHaveNoViolations();
  });

  it('invalid: has no axe violations', async () => {
    view.mockResolvedValue({ kind: 'invalid' });
    const { container } = render(await page({}));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ConfirmForm', () => {
  it('a click runs the server action with the fields, then navigates to its URL', async () => {
    action.mockResolvedValue(CALLBACK);
    const navigate = vi.fn();
    render(<ConfirmForm {...PARAMS} navigate={navigate} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith(CALLBACK));
    const fd = action.mock.calls[0]![1];
    expect(Object.fromEntries(fd.entries())).toEqual(PARAMS);
    // A fallback link in case the navigation is blocked.
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', CALLBACK);
  });

  it('defaults to a full-page navigation (window.location.assign)', () => {
    render(<ConfirmForm {...PARAMS} />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
