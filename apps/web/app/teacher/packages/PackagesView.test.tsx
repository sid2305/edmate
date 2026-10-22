// @vitest-environment jsdom
// Task 8.6 Phase D: the package builder. Fetch is stubbed with a tiny in-memory studio API (rule
// 4, as UploadsView.test.tsx), no database, no model. Written red before PackagesView.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import { PackagesView } from './PackagesView';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const MODULES = [
  { id: 'mod_1', title: 'Algebra' },
  { id: 'mod_2', title: 'Geometry' },
];
const SETUP = { styleCard: true, styleCardLink: '/teacher/style-card' };
const PER_TURN_MICRO_USD = 21_000;

type GetBody = {
  packages: unknown[];
  modules: typeof MODULES;
  setup: typeof SETUP;
  perTurnMicroUsd: number;
};

type Reply = { status: number; body?: unknown };
const json = ({ status, body }: Reply) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const err = (status: number, code: string, extra: Record<string, unknown> = {}): Reply => ({
  status,
  body: { error: { code, message: 'x', retryable: false }, ...extra },
});

/** A scripted studio packages API: `get` is the current GET reply; `next` queues POST/PUT replies. */
function api(get: GetBody) {
  const state = { get };
  const queued: Record<string, Reply[]> = {};
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, ...(body === undefined ? {} : { body }) });
    const key = `${method} ${url}`;
    const next = queued[key]?.shift();
    if (next) return json(next);
    if (method === 'GET' && url === '/api/studio/packages') {
      return json({ status: 200, body: state.get });
    }
    return json(err(500, 'provider_error'));
  });
  vi.stubGlobal('fetch', fetchFn);
  return { state, calls, next: (key: string, reply: Reply) => (queued[key] ??= []).push(reply) };
}

function getBody(packages: unknown[] = [], over: Partial<GetBody> = {}): GetBody {
  return { packages, modules: MODULES, setup: SETUP, perTurnMicroUsd: PER_TURN_MICRO_USD, ...over };
}

function pkgRow(over: Record<string, unknown> = {}) {
  return {
    packageId: 'pkg_1',
    version: 1,
    liveVersion: null,
    draft: {
      name: 'Free starter',
      moduleIds: ['mod_1'],
      skills: ['explain', 'practice'],
      helpCeiling: 2,
      finalAnswers: 'after_attempt',
      dailyMessageLimit: 10,
      liveClassesPerMonth: 0,
      pricePerMonth: { amountMinor: 0, currency: 'USD' },
      lockedReply: 'name_package',
    },
    estimate: { typicalMicroUsd: 2_100_000, maxMicroUsd: 6_300_000 },
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PackagesView', () => {
  it('shows an empty state when the teacher has no packages', async () => {
    api(getBody([]));
    renderIntl(<PackagesView />);
    expect(await screen.findByText(/You have no packages yet/)).toBeInTheDocument();
  });

  it('asks for a style card first, with a link, and shows no form', async () => {
    api(getBody([], { setup: { styleCard: false, styleCardLink: '/teacher/style-card' } }));
    renderIntl(<PackagesView />);
    expect(await screen.findByText(/Set up your style card/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your teaching style' })).toHaveAttribute(
      'href',
      '/teacher/style-card',
    );
    expect(screen.queryByLabelText('Package name')).toBeNull();
  });

  it('module checkboxes come from the GET modules', async () => {
    api(getBody([]));
    renderIntl(<PackagesView />);
    await screen.findByText('New package');
    expect(screen.getByRole('checkbox', { name: 'Algebra' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Geometry' })).toBeInTheDocument();
  });

  it('hides the trial input at price 0, shows it for a paid preset', async () => {
    api(getBody([]));
    renderIntl(<PackagesView />);
    await screen.findByText('New package');
    expect(screen.queryByLabelText('Trial days')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Free starter' }));
    expect(screen.queryByLabelText('Trial days')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Full course' }));
    expect(screen.getByLabelText('Trial days')).toBeInTheDocument();
  });

  it('the live estimate updates as the daily limit changes', async () => {
    api(getBody([]));
    renderIntl(<PackagesView />);
    await screen.findByText('New package');
    fireEvent.click(screen.getByRole('button', { name: 'Free starter' }));
    // Free starter: daily limit 10 -> typical $2.10, max $6.30 (21,000 x 10 x 10 / 21,000 x 10 x 30).
    expect(screen.getByText('about $2.10 a month per subscriber (up to $6.30)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Messages a day'), { target: { value: '20' } });
    expect(screen.getByText('about $4.20 a month per subscriber (up to $12.60)')).toBeInTheDocument();
  });

  it('shows the 25% cost warning only once the estimate crosses it', async () => {
    api(getBody([]));
    renderIntl(<PackagesView />);
    await screen.findByText('New package');
    fireEvent.click(screen.getByRole('button', { name: 'Full course' }));
    // Full course defaults: 20/day at $55 -> 23%, no warning.
    expect(screen.queryByText(/more than a quarter/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Messages a day'), { target: { value: '50' } });
    expect(screen.getByText(/more than a quarter/)).toBeInTheDocument();
  });

  it('creates two packages from the presets, one edit each, with exact POST bodies', async () => {
    const s = api(getBody([]));
    renderIntl(<PackagesView />);
    await screen.findByText('New package');

    fireEvent.click(screen.getByRole('button', { name: 'Free starter' }));
    fireEvent.change(screen.getByLabelText('Package name'), {
      target: { value: 'Starter plan' },
    });
    const created1 = pkgRow({
      packageId: 'pkg_1',
      draft: { ...pkgRow().draft, name: 'Starter plan' },
    });
    s.next('POST /api/studio/packages', { status: 201, body: { package: created1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Create package' }));
    await screen.findByRole('heading', { name: 'Starter plan' });

    expect(s.calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Starter plan',
      moduleIds: ['mod_1', 'mod_2'],
      skills: ['explain', 'practice'],
      helpCeiling: 2,
      finalAnswers: 'after_attempt',
      dailyMessageLimit: 10,
      liveClassesPerMonth: 0,
      pricePerMonth: { amountMinor: 0 },
      lockedReply: 'name_package',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full course' }));
    fireEvent.change(screen.getByLabelText('Live classes a month'), { target: { value: '3' } });
    const created2 = pkgRow({
      packageId: 'pkg_2',
      draft: { ...pkgRow().draft, name: 'Full course', liveClassesPerMonth: 3 },
      estimate: { typicalMicroUsd: 4_200_000, maxMicroUsd: 12_600_000, shareOfPrice: 23 },
    });
    s.next('POST /api/studio/packages', { status: 201, body: { package: created2 } });
    fireEvent.click(screen.getByRole('button', { name: 'Create package' }));
    await screen.findByRole('heading', { name: 'Full course' });

    const posts = s.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual({
      name: 'Full course',
      moduleIds: ['mod_1', 'mod_2'],
      skills: ['explain', 'coach', 'practice', 'feedback', 'mock_interview', 'revision'],
      helpCeiling: 3,
      finalAnswers: 'allowed',
      dailyMessageLimit: 20,
      liveClassesPerMonth: 3,
      pricePerMonth: { amountMinor: 5500 },
      trialDays: 7,
      lockedReply: 'generic',
    });

    const list = screen.getByRole('list', { name: 'Your packages' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Starter plan');
    expect(cards[0]).toHaveTextContent('about $2.10 a month per subscriber (up to $6.30)');
    expect(cards[1]).toHaveTextContent('Full course');
    expect(cards[1]).toHaveTextContent('about $4.20 a month per subscriber (up to $12.60)');
  });

  it('editing a package sends a PUT and shows the new version', async () => {
    const existing = pkgRow();
    const s = api(getBody([existing]));
    renderIntl(<PackagesView />);
    await screen.findByText('Version 1');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Free starter' }));
    fireEvent.change(screen.getByLabelText('Package name'), { target: { value: 'Starter plus' } });
    const saved = pkgRow({ version: 2, draft: { ...existing.draft, name: 'Starter plus' } });
    s.next('PUT /api/studio/packages', { status: 200, body: { package: saved } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Version 2');

    const put = s.calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({ packageId: 'pkg_1', name: 'Starter plus' });
    expect(screen.getByText('Starter plus')).toBeInTheDocument();
  });

  it('a 409 style_card_required on save shows the setup message and link', async () => {
    const s = api(getBody([]));
    renderIntl(<PackagesView />);
    await screen.findByText('New package');
    fireEvent.click(screen.getByRole('button', { name: 'Free starter' }));
    s.next(
      'POST /api/studio/packages',
      err(409, 'validation', { reason: 'style_card_required', link: '/teacher/style-card' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create package' }));
    await waitFor(() =>
      expect(screen.getAllByText(/Set up your style card/).length).toBeGreaterThan(0),
    );
  });

  it('a malformed GET body shows the error banner and stops loading', async () => {
    api({
      packages: 'not-an-array',
      modules: MODULES,
      setup: SETUP,
      perTurnMicroUsd: PER_TURN_MICRO_USD,
    } as unknown as GetBody);
    renderIntl(<PackagesView />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong|Try again/i);
    expect(screen.queryByText('New package')).toBeNull();
  });

  it('a malformed save body shows the error banner and does not change the list', async () => {
    const s = api(getBody([]));
    renderIntl(<PackagesView />);
    await screen.findByText('New package');
    fireEvent.click(screen.getByRole('button', { name: 'Free starter' }));
    s.next('POST /api/studio/packages', { status: 201, body: { package: { bogus: true } } });
    fireEvent.click(screen.getByRole('button', { name: 'Create package' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.queryByRole('list', { name: 'Your packages' })).toBeNull();
  });

  it('has no axe violations with a package card and the form open', async () => {
    api(getBody([pkgRow()]));
    const { container } = renderIntl(<PackagesView />);
    await screen.findByText('New package');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
