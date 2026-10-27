// @vitest-environment jsdom
// Task 8.4b: the style interview and editor. Fetch is stubbed (rule 4; no real model call).
// Written red before StyleCardView.tsx.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import { StyleCardView } from './StyleCardView';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

type Reply = { status: number; body?: unknown };
const json = ({ status, body }: Reply) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const err = (status: number, code: string): Reply => ({
  status,
  body: { error: { code, message: 'x', retryable: false } },
});

function api() {
  const queued: Record<string, Reply[]> = {};
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, ...(body === undefined ? {} : { body }) });
    const key = `${method} ${url}`;
    const next = queued[key]?.shift();
    if (next) return json(next);
    return json(err(500, 'provider_error'));
  });
  vi.stubGlobal('fetch', fetchFn);
  return { calls, next: (key: string, reply: Reply) => (queued[key] ??= []).push(reply) };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

const DRAFT = { text: 'Warm and brief. Ask before telling.', mistakeTags: ['units'] };
const CARD = { id: 'sty_1', teacherId: 't_1', version: 1, text: 'Old text.', mistakeTags: ['x'] };

describe('StyleCardView', () => {
  it('shows "no card yet" with an empty editor when nothing is saved', () => {
    api();
    renderIntl(<StyleCardView initialCard={null} initialProposals={[]} />);
    expect(screen.getByText(/no style card yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Style card text')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the saved card text, tags and version when one exists', () => {
    api();
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[]} />);
    expect(screen.getByText('Current version: 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Style card text')).toHaveValue('Old text.');
    expect(screen.getByLabelText('Mistake tags')).toHaveValue('x');
  });

  it('drafts from the interview, filling the editable text and tags', async () => {
    const { next, calls } = api();
    next('POST /api/studio/style-card/draft', { status: 200, body: { draft: DRAFT } });
    renderIntl(<StyleCardView initialCard={null} initialProposals={[]} />);

    fireEvent.change(screen.getByLabelText('What tone do you use with students?'), {
      target: { value: 'Warm, a little playful.' },
    });
    fireEvent.change(screen.getByLabelText('Common mistakes'), {
      target: { value: 'units\nsign-error' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));

    await waitFor(() => expect(screen.getByLabelText('Style card text')).toHaveValue(DRAFT.text));
    expect(screen.getByLabelText('Mistake tags')).toHaveValue('units');
    const sent = calls[0]!.body as { answers: Record<string, string>; mistakeCandidates: string[] };
    expect(sent.answers.tone).toBe('Warm, a little playful.');
    expect(sent.mistakeCandidates).toEqual(['units', 'sign-error']);
  });

  it('saves the current text and tags, and shows the new version', async () => {
    const { next, calls } = api();
    const saved = { ...CARD, version: 2, text: 'Fixed text.', mistakeTags: ['x', 'y'] };
    next('PUT /api/studio/style-card', { status: 201, body: { card: saved } });
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[]} />);

    fireEvent.change(screen.getByLabelText('Style card text'), {
      target: { value: 'Fixed text.' },
    });
    fireEvent.change(screen.getByLabelText('Mistake tags'), {
      target: { value: 'x, y' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Current version: 2')).toBeInTheDocument());
    expect(calls[0]!.body).toEqual({ text: 'Fixed text.', mistakeTags: ['x', 'y'] });
  });

  it('shows a save error and keeps the previous card unchanged', async () => {
    const { next } = api();
    next('PUT /api/studio/style-card', err(400, 'validation'));
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Check the text and try again.'),
    );
    expect(screen.getByText('Current version: 1')).toBeInTheDocument();
  });

  it('re-enables the save button and shows an error when the request rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[]} />);
    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
  });

  it('re-enables the draft button and shows an error when the request rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    renderIntl(<StyleCardView initialCard={null} initialProposals={[]} />);
    const button = screen.getByRole('button', { name: 'Generate draft' });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
  });

  it('discards a draft reply that resolves after a save has already landed', async () => {
    const draftCalls: ((reply: Response) => void)[] = [];
    const saved = { ...CARD, version: 2, text: 'Saved text.', mistakeTags: ['x'] };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST' && url.endsWith('/draft')) {
          return new Promise<Response>((resolve) => draftCalls.push(resolve));
        }
        return Promise.resolve(json({ status: 201, body: { card: saved } }));
      }),
    );
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
    await waitFor(() => expect(draftCalls).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Current version: 2')).toBeInTheDocument());

    // The slow draft now resolves, after the save already landed: it must be discarded.
    draftCalls[0]!(json({ status: 200, body: { draft: DRAFT } }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate draft' })).not.toBeDisabled(),
    );
    // The draft's text is discarded: the editable field still holds what was saved, not DRAFT.text.
    expect(screen.getByLabelText('Style card text')).toHaveValue(CARD.text);
    expect(screen.getByText('Current version: 2')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    api();
    const { container } = renderIntl(<StyleCardView initialCard={CARD} initialProposals={[]} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

const PROPOSAL = {
  tag: 'units',
  count: 3,
  lastSeen: '2026-10-01T00:00:00Z',
  status: 'pending' as const,
};

describe('StyleCardView: proposed tags', () => {
  it('shows "no proposed tags" when there are none', () => {
    api();
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[]} />);
    expect(screen.getByText('No proposed tags right now.')).toBeInTheDocument();
  });

  it("approving removes the tag from the pending list and shows the card's new mistakeTags", async () => {
    const { next, calls } = api();
    const newCard = { ...CARD, version: 2, mistakeTags: ['x', 'units'] };
    next('POST /api/studio/mistake-proposals', {
      status: 200,
      body: { approved: true, card: newCard },
    });
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[PROPOSAL]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(screen.getByText('Current version: 2')).toBeInTheDocument());
    expect(screen.getByText('No proposed tags right now.')).toBeInTheDocument();
    expect(screen.getByLabelText('Mistake tags')).toHaveValue('x, units');
    expect(calls[0]!.body).toEqual({ tag: 'units', action: 'approve' });
  });

  it('rejecting removes the tag from the pending list without changing the card', async () => {
    const { next } = api();
    next('POST /api/studio/mistake-proposals', { status: 200, body: { rejected: true } });
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[PROPOSAL]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(screen.getByText('No proposed tags right now.')).toBeInTheDocument(),
    );
    expect(screen.getByText('Current version: 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Mistake tags')).toHaveValue('x');
  });

  it('keeps a different tag disabled while its own decision is still in flight', async () => {
    const PROPOSAL_B = { ...PROPOSAL, tag: 'spelling' };
    let resolveA: ((reply: Response) => void) | undefined;
    let resolveB: ((reply: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        return new Promise<Response>((resolve) => {
          if (body?.tag === 'units') resolveA = resolve;
          else resolveB = resolve;
        });
      }),
    );
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[PROPOSAL, PROPOSAL_B]} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]!);
    await waitFor(() => expect(resolveA).toBeDefined());
    expect(screen.getAllByRole('button', { name: 'Approve' })[0]).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[1]!);
    await waitFor(() => expect(resolveB).toBeDefined());

    // A's buttons must still be disabled while A's own decide call is still in flight.
    expect(screen.getAllByRole('button', { name: 'Approve' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Approve' })[1]).toBeDisabled();

    resolveA!(json({ status: 200, body: { approved: true, card: CARD } }));
    resolveB!(json({ status: 200, body: { approved: true, card: CARD } }));
    await waitFor(() =>
      expect(screen.getByText('No proposed tags right now.')).toBeInTheDocument(),
    );
  });

  it('a failed decision shows the error banner, with no optimistic removal', async () => {
    const { next } = api();
    next('POST /api/studio/mistake-proposals', err(500, 'provider_error'));
    renderIntl(<StyleCardView initialCard={CARD} initialProposals={[PROPOSAL]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong. Please try again.',
      ),
    );
    expect(screen.getByText('units')).toBeInTheDocument();
    expect(screen.getByText('Current version: 1')).toBeInTheDocument();
  });
});
