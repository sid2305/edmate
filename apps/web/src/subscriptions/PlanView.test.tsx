// @vitest-environment jsdom
// Task 9.6 Phase D: the plan view (current package, other offers, pause/resume/cancel). Fetch and
// `next/navigation` are stubbed (rule 4).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { PlanView, type PlanOffer, type PlanSubscription } from './PlanView';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const SUBSCRIPTION: PlanSubscription = {
  id: 'sub_1',
  status: 'active',
  periodEnd: '2026-11-21T00:00:00.000Z',
  packageId: 'pkg_paid',
};

const OFFERS: PlanOffer[] = [
  { packageId: 'pkg_free', name: 'Free', amountMinor: 0, currency: 'USD' },
  { packageId: 'pkg_paid', name: 'Full Course', amountMinor: 1999, currency: 'USD' },
  { packageId: 'pkg_premium', name: 'Premium', amountMinor: 4999, currency: 'USD' },
];

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PlanView', () => {
  it('shows the current package, status and period end', () => {
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    expect(screen.getByText('Full Course')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/2026-11-21/)).toBeInTheDocument();
  });

  it('labels the lower-priced offer Downgrade and the higher-priced one Upgrade', () => {
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    const free = screen.getByText(/Free -/).closest('li') as HTMLElement;
    expect(within(free).getByRole('button')).toHaveTextContent('Downgrade');
    const premium = screen.getByText(/Premium -/).closest('li') as HTMLElement;
    expect(within(premium).getByRole('button')).toHaveTextContent('Upgrade');
  });

  it('with no live subscription, links to the compare page instead of showing plan controls', () => {
    renderIntl(<PlanView agentId="agt_1" subscription={null} offers={OFFERS} />);
    expect(screen.getByText("You don't have a package with this teacher yet.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a package' })).toHaveAttribute(
      'href',
      '/packages/agt_1',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a successful change navigates to /learn/<agentId> with no ?s=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'active', packageId: 'pkg_premium' }));
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    const premium = screen.getByText(/Premium -/).closest('li') as HTMLElement;
    fireEvent.click(within(premium).getByRole('button'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/learn/agt_1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/subscriptions/sub_1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agt_1', action: 'change', packageId: 'pkg_premium' }),
    });
  });

  it('a failed change shows a fixed alert and does not navigate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(409, { error: { message: 'nope' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    const premium = screen.getByText(/Premium -/).closest('li') as HTMLElement;
    fireEvent.click(within(premium).getByRole('button'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'));
    expect(push).not.toHaveBeenCalled();
  });

  it('an unreadable body (network failure) shows the fixed alert too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('pause sends the pause action and re-renders in place (no navigation)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'paused', packageId: 'pkg_paid' }));
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(push).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/subscriptions/sub_1',
      expect.objectContaining({ body: JSON.stringify({ agentId: 'agt_1', action: 'pause' }) }),
    );
  });

  it('shows Resume when paused, and navigates on a successful resume', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'active', packageId: 'pkg_paid' }));
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(
      <PlanView agentId="agt_1" subscription={{ ...SUBSCRIPTION, status: 'paused' }} offers={OFFERS} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/learn/agt_1'));
  });

  it('a resume refused with 409 shows the fixed "paused by Edmate" text, not a resume button', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(409, { error: { message: 'nope' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(
      <PlanView agentId="agt_1" subscription={{ ...SUBSCRIPTION, status: 'paused' }} offers={OFFERS} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() =>
      expect(
        screen.getByText("This plan was paused by Edmate and can't be resumed here."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('cancel is behind a confirm step that offers both exports first', async () => {
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('link', { name: 'Download the complete JSON export' })).toHaveAttribute(
      'href',
      '/api/me/export/agt_1',
    );
    expect(screen.getByRole('link', { name: 'Download your notes (PDF)' })).toHaveAttribute(
      'href',
      '/api/me/export/agt_1/notes',
    );
    expect(screen.getByRole('button', { name: 'Yes, cancel my plan' })).toBeInTheDocument();
  });

  it('keep my plan dismisses the confirm step without a fetch', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my plan' }));
    expect(screen.queryByRole('button', { name: 'Yes, cancel my plan' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('confirming cancel navigates to /learn/<agentId>', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ended', packageId: 'pkg_paid' }));
    vi.stubGlobal('fetch', fetchMock);
    renderIntl(<PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel my plan' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/learn/agt_1'));
  });

  it('has no axe violations, with or without a live subscription', async () => {
    const { container: withSub } = renderIntl(
      <PlanView agentId="agt_1" subscription={SUBSCRIPTION} offers={OFFERS} />,
    );
    expect(await axe(withSub)).toHaveNoViolations();
    const { container: noSub } = renderIntl(<PlanView agentId="agt_1" subscription={null} offers={OFFERS} />);
    expect(await axe(noSub)).toHaveNoViolations();
  });
});
