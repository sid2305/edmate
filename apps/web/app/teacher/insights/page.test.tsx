// @vitest-environment jsdom
// Task 8.8 Phase B: the /teacher/insights page. Teachers only, the guard runs before any read,
// and the scope passed to `loadInsights` is always `{ teacherId: <principal> }`, never a request
// field. No per-student row anywhere (the accept line): asserted by the fakes never exposing one.
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadInsights: vi.fn(),
  seenScope: [] as unknown[],
}));

vi.mock('../../../src/auth', () => ({
  requireRole: state.requireRole,
  serverDatabase: () => ({ repos: { fake: true } }),
}));
vi.mock('../actions', () => ({ signOutAndRedirect: vi.fn() }));
vi.mock('../../../src/studio/insights', () => ({
  loadInsights: (...args: unknown[]) => {
    state.seenScope.push(args[1]);
    return state.loadInsights(...args);
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace] as Record<string, unknown>;
    return (key: string, values?: Record<string, unknown>) => {
      const raw = bundle[key] as string;
      if (values === undefined) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));
    };
  },
}));

import InsightsPage from './page';

const emptyInsights = {
  windowDays: 7,
  health: {
    turns: 0,
    stepLatencyMs: {},
    errorRate: 0,
    errorsByStep: {},
    guardRate: 0,
    guardsByName: {},
  },
  capped: false,
  topQuestionGroups: [],
};

beforeEach(() => {
  state.requireRole.mockReset();
  state.loadInsights.mockReset();
  state.seenScope = [];
});

describe('/teacher/insights', () => {
  it("asks for a teacher, then reads only that teacher's insights", async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    state.loadInsights.mockResolvedValueOnce(emptyInsights);
    render(await InsightsPage());
    expect(state.requireRole).toHaveBeenCalledWith(['teacher']);
    expect(state.seenScope).toEqual([{ teacherId: 'tch_a' }]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Insights');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Insights' })).toHaveAttribute(
      'href',
      '/teacher/insights',
    );
  });

  it('reads nothing when the guard refuses', async () => {
    state.requireRole.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(InsightsPage()).rejects.toThrow('NOT_FOUND');
    expect(state.loadInsights).not.toHaveBeenCalled();
  });

  it('shows both empty states when there is no data', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    state.loadInsights.mockResolvedValueOnce(emptyInsights);
    render(await InsightsPage());
    expect(screen.getByText('No turns yet in the last 7 days.')).toBeInTheDocument();
    expect(screen.getByText('No open question groups right now.')).toBeInTheDocument();
  });

  it('shows the capped notice when the window hit the 200-turn cap', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    state.loadInsights.mockResolvedValueOnce({
      ...emptyInsights,
      health: {
        ...emptyInsights.health,
        turns: 200,
        stepLatencyMs: {
          generate: { p50: 120, p95: 340, n: 200 },
          firstToken: { p50: 30, p95: 80, n: 200 },
        },
        errorRate: 0.1,
        guardRate: 0.05,
      },
      capped: true,
    });
    render(await InsightsPage());
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing your most recent 200 turns, not the full week.',
    );
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('120ms / 340ms')).toBeInTheDocument();
    expect(screen.getByText('30ms / 80ms')).toBeInTheDocument();
  });

  it('shows up to 5 open question groups with no student id anywhere', async () => {
    state.requireRole.mockResolvedValueOnce({ userId: 'tch_a', role: 'teacher' });
    state.loadInsights.mockResolvedValueOnce({
      ...emptyInsights,
      topQuestionGroups: [
        { groupId: 'g1', count: 3, oldestAt: '2026-10-01T00:00:00.000Z', sample: 'How do I factor this?' },
      ],
    });
    render(await InsightsPage());
    expect(screen.getByText('3 asked near-identically since 2026-10-01')).toBeInTheDocument();
    expect(screen.getByText('How do I factor this?')).toBeInTheDocument();
    expect(JSON.stringify(state.loadInsights.mock.results)).not.toMatch(/student/i);
  });
});
