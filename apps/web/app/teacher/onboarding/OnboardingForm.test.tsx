// @vitest-environment jsdom
// Task 8.1a: the onboarding form. Fetch is stubbed (rule 4); no real model or database calls.
// Written red before OnboardingForm.tsx.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { TeacherProfileRow } from '@edmate/db';
import { OnboardingForm } from './OnboardingForm';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROFILE = (status: TeacherProfileRow['verificationStatus']): TeacherProfileRow => ({
  id: 'tp_1',
  teacherId: 't_asha',
  slug: 'asha-math',
  subject: 'Math',
  bio: 'I teach math.',
  languages: ['en'],
  verificationStatus: status,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OnboardingForm', () => {
  it('create mode: shows slug, subject, bio and languages fields with a create button', () => {
    renderIntl(<OnboardingForm initialProfile={null} />);
    expect(screen.getByLabelText(/Profile URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Bio/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Languages/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeInTheDocument();
  });

  it('create mode: submits a POST with the entered fields, then switches to edit mode', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { profile: PROFILE('pending') }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<OnboardingForm initialProfile={null} />);
    fireEvent.change(screen.getByLabelText(/Profile URL/i), { target: { value: 'asha-math' } });
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: 'Math' } });
    fireEvent.change(screen.getByLabelText(/Bio/i), { target: { value: 'I teach math.' } });
    fireEvent.change(screen.getByLabelText(/Languages/i), { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/studio/profile');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      slug: 'asha-math',
      subject: 'Math',
      bio: 'I teach math.',
      languages: ['en'],
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument(),
    );
  });

  it('edit mode: slug is read-only, submits a PUT with the changed fields', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { profile: PROFILE('pending') }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<OnboardingForm initialProfile={PROFILE('pending')} />);
    expect(screen.queryByLabelText(/Profile URL/i)).not.toBeInTheDocument();
    expect(screen.getByText('asha-math')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: 'Physics' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/studio/profile');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      subject: 'Physics',
      bio: 'I teach math.',
      languages: ['en'],
    });
  });

  it.each([
    ['pending', /waits on staff verification/i],
    ['rejected', /waits on staff verification/i],
    ['verified', /is verified/i],
  ] as const)('shows the %s banner', (status, matcher) => {
    renderIntl(<OnboardingForm initialProfile={PROFILE(status)} />);
    expect(screen.getByText(matcher)).toBeInTheDocument();
  });

  it('no profile yet shows the pending-style banner', () => {
    renderIntl(<OnboardingForm initialProfile={null} />);
    expect(screen.getByText(/waits on staff verification/i)).toBeInTheDocument();
  });

  it('a submit error is shown in an alert, and the submit stays enabled again', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, { error: { code: 'validation', message: 'Check the request and try again.', retryable: false } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<OnboardingForm initialProfile={PROFILE('pending')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Check the request and try again.'),
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
  });

  it('a rejected fetch (network failure) shows the generic error and re-enables submit', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<OnboardingForm initialProfile={PROFILE('pending')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.'),
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
  });

  it('a success response with invalid JSON shows the generic error and re-enables submit', async () => {
    const fetchMock = vi.fn(async () => {
      const res = new Response('not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      return res;
    });
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<OnboardingForm initialProfile={PROFILE('pending')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.'),
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
  });

  it('the submit button is disabled while the request is in flight', async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<OnboardingForm initialProfile={PROFILE('pending')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Saving/i })).toBeDisabled());
    resolve(jsonResponse(200, { profile: PROFILE('pending') }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled(),
    );
  });

  it('has no axe violations in create mode', async () => {
    const { container } = renderIntl(<OnboardingForm initialProfile={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations in edit mode', async () => {
    const { container } = renderIntl(<OnboardingForm initialProfile={PROFILE('verified')} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
