// @vitest-environment jsdom
// Task 9.3 Phase B: the compare-and-start view. Fetch is stubbed (rule 4); no real database or
// payment call -- there is no payment screen anywhere.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LivePackage } from '@edmate/db';
import { renderIntl } from '../../../test/intl';
import { PackageCompare } from './PackageCompare';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const originalLocation = window.location;

beforeEach(() => {
  // jsdom refuses a real cross-document navigation; replace `location` with a plain, settable
  // stand-in so the component's `window.location.href = ...` is observable.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

const FREE: LivePackage = {
  packageVersionId: 'pv_free_1',
  config: {
    id: 'pkg_free',
    version: 1,
    teacherId: 'tch_asha',
    agentId: 'agt_demo',
    name: 'Free',
    moduleIds: [],
    skills: ['explain'],
    helpCeiling: 2,
    finalAnswers: 'never',
    dailyMessageLimit: 20,
    liveClassesPerMonth: 0,
    pricePerMonth: { amountMinor: 0, currency: 'USD' },
    lockedReply: 'generic',
  },
};

const PAID: LivePackage = {
  packageVersionId: 'pv_paid_1',
  config: {
    ...FREE.config,
    id: 'pkg_paid',
    name: 'Full Course',
    skills: ['explain', 'coach'],
    dailyMessageLimit: 100,
    liveClassesPerMonth: 2,
    pricePerMonth: { amountMinor: 1999, currency: 'USD' },
    trialDays: 7,
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PackageCompare', () => {
  it('renders a card per package: name, price, trial, limits and skills', () => {
    renderIntl(<PackageCompare agentId="agt_demo" packages={[FREE, PAID]} />);
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Full Course')).toBeInTheDocument();
    expect(screen.getByText('$19.99')).toBeInTheDocument();
    expect(screen.getByText('7 day free trial')).toBeInTheDocument();
    expect(screen.getByText('100 messages a day')).toBeInTheDocument();
    expect(screen.getByText('2 live classes a month')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Start' })).toHaveLength(2);
  });

  it('renders the empty state with no packages', () => {
    renderIntl(<PackageCompare agentId="agt_demo" packages={[]} />);
    expect(screen.getByText('No packages are available yet.')).toBeInTheDocument();
  });

  it('starting a package posts to /api/subscriptions, then navigates to /learn/[agentId]', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { subscription: { id: 'sub_1' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<PackageCompare agentId="agt_demo" packages={[PAID]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/subscriptions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ agentId: 'agt_demo', packageId: 'pkg_paid' });
    await waitFor(() => expect(window.location.href).toBe('/learn/agt_demo'));
  });

  it('a failed start shows the fixed error text and stays usable', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, {
        error: { message: 'You already have a package with this teacher.', code: 'invalid', retryable: false },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<PackageCompare agentId="agt_demo" packages={[PAID]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You already have a package with this teacher.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();
  });

  it('a network failure shows the generic error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    renderIntl(<PackageCompare agentId="agt_demo" packages={[PAID]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.'),
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = renderIntl(
      <PackageCompare agentId="agt_demo" packages={[FREE, PAID]} />,
    ) as unknown as { container: HTMLElement };
    expect(await axe(container)).toHaveNoViolations();
  });
});
