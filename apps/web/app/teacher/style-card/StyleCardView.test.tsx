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
    renderIntl(<StyleCardView initialCard={null} />);
    expect(screen.getByText(/no style card yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Style card text')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the saved card text, tags and version when one exists', () => {
    api();
    renderIntl(<StyleCardView initialCard={CARD} />);
    expect(screen.getByText('Current version: 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Style card text')).toHaveValue('Old text.');
    expect(screen.getByLabelText('Mistake tags')).toHaveValue('x');
  });

  it('drafts from the interview, filling the editable text and tags', async () => {
    const { next, calls } = api();
    next('POST /api/studio/style-card/draft', { status: 200, body: { draft: DRAFT } });
    renderIntl(<StyleCardView initialCard={null} />);

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
    renderIntl(<StyleCardView initialCard={CARD} />);

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
    renderIntl(<StyleCardView initialCard={CARD} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Check the text and try again.'),
    );
    expect(screen.getByText('Current version: 1')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    api();
    const { container } = renderIntl(<StyleCardView initialCard={CARD} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
