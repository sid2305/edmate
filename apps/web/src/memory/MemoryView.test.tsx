// @vitest-environment jsdom
// Task 6.5 Phase B: the memory view (mastery, mistakes, summary, empty state, export link) and
// the reset button (confirm, fetch, refresh). Fetch and `next/navigation` are stubbed (rule 4).
import type { LearnerProfile } from '@edmate/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { MemoryView } from './MemoryView';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const PROFILE: LearnerProfile = {
  studentId: 'std_amy',
  teacherId: 'tch_asha',
  lang: 'en',
  mastery: { top_fractions: { p: 0.84, n: 6, updatedAt: '2026-10-01T00:00:00.000Z' } },
  mistakes: [{ tag: 'sign_error', count: 3, lastSeen: '2026-10-01T00:00:00.000Z' }],
  lastSummary: 'Worked on fractions and signs.',
};

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  refresh.mockReset();
  vi.spyOn(window, 'confirm');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MemoryView', () => {
  it('renders mastery as a percent with evidence count, mistakes with counts, and the summary', () => {
    renderIntl(<MemoryView agentId="agt_1" profile={PROFILE} />);
    expect(screen.getByText(/top_fractions/)).toHaveTextContent('top_fractions: 84% (6 checks)');
    expect(screen.getByText(/sign_error/)).toHaveTextContent('sign_error: 3 times');
    expect(screen.getByText('Worked on fractions and signs.')).toBeInTheDocument();
  });

  it('shows the empty state when there is no profile', () => {
    renderIntl(<MemoryView agentId="agt_1" profile={null} />);
    expect(screen.getByText("Your tutor doesn't remember anything about you yet.")).toBeInTheDocument();
  });

  it('shows the empty state for a profile with no mastery, mistakes or summary', () => {
    const empty: LearnerProfile = {
      studentId: PROFILE.studentId,
      teacherId: PROFILE.teacherId,
      lang: PROFILE.lang,
      mastery: {},
      mistakes: [],
    };
    renderIntl(<MemoryView agentId="agt_1" profile={empty} />);
    expect(screen.getByText("Your tutor doesn't remember anything about you yet.")).toBeInTheDocument();
  });

  it('renders the export link to this agent\'s memory route, with download', () => {
    renderIntl(<MemoryView agentId="agt_1" profile={PROFILE} />);
    const link = screen.getByText('Download what your tutor remembers') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/me/memory/agt_1');
    expect(link.hasAttribute('download')).toBe(true);
  });

  it('cancel sends no fetch', async () => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(window.confirm).mockReturnValue(false);
    renderIntl(<MemoryView agentId="agt_1" profile={PROFILE} />);
    fireEvent.click(screen.getByText('Reset what your tutor remembers'));
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('confirm sends one DELETE to the right URL and then refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { reset: true }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(window.confirm).mockReturnValue(true);
    renderIntl(<MemoryView agentId="agt_1" profile={PROFILE} />);
    fireEvent.click(screen.getByText('Reset what your tutor remembers'));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/me/memory/agt_1', { method: 'DELETE' });
  });

  it('a failed reset shows a fixed error line and does not refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(window.confirm).mockReturnValue(true);
    renderIntl(<MemoryView agentId="agt_1" profile={PROFILE} />);
    fireEvent.click(screen.getByText('Reset what your tutor remembers'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
