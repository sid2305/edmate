// @vitest-environment jsdom
// Task 8.3 Phase C: the outline editor. Fetch is stubbed with an in-memory studio outline API
// (same pattern as 8.2's UploadsView.test.tsx). Synthetic titles only. Written red before
// OutlineView.tsx.
import { fireEvent, screen, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { Outline } from '../../../src/studio/outlineClient';
import { OutlineView } from './OutlineView';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const source = (over: Partial<Outline['modules'][0]['topics'][0]['chunkIds'][0]>) => ({
  chunkId: 'c1',
  sourceTitle: 'File 1.pdf',
  locator: 'p1',
  ...over,
});

const outline = (): Outline => ({
  courseId: 'crs_1',
  outlineVersion: 1,
  modules: [
    {
      id: 'mod_1',
      title: 'Module 1',
      order: 0,
      topics: [
        {
          id: 'top_a',
          title: 'Topic A',
          order: 0,
          chunkIds: [source({ chunkId: 'c1', sourceTitle: 'File 1.pdf', locator: 'p1' })],
        },
        {
          id: 'top_b',
          title: 'Topic B',
          order: 1,
          chunkIds: [source({ chunkId: 'c2', sourceTitle: 'File 2.pdf', locator: 'p2' })],
        },
        {
          id: 'top_c',
          title: 'Topic C',
          order: 2,
          chunkIds: [
            source({ chunkId: 'c3', sourceTitle: 'File 3.pdf', locator: 'p3' }),
            source({ chunkId: 'c4', sourceTitle: 'File 4.pdf', locator: 'p4' }),
          ],
        },
      ],
    },
  ],
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

/** A scripted studio outline API: `state.outline` is what GET returns. */
function api(initial: Outline) {
  const state = { outline: initial };
  const queued: Record<string, Reply[]> = {};
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, ...(body === undefined ? {} : { body }) });
    const key = `${method} ${url}`;
    const next = queued[key]?.shift();
    if (next) return json(next);
    if (key === 'GET /api/studio/outline') return json({ status: 200, body: state.outline });
    return json(err(500, 'provider_error'));
  });
  vi.stubGlobal('fetch', fetchFn);
  return { state, calls, next: (key: string, reply: Reply) => (queued[key] ??= []).push(reply) };
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OutlineView', () => {
  it('renders the fetched modules and topics', async () => {
    api(outline());
    renderIntl(<OutlineView />);
    expect(await screen.findByDisplayValue('Module 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Topic A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Topic B')).toBeInTheDocument();
    expect(screen.getByText(/File 1.pdf/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no modules', async () => {
    api({ courseId: 'crs_1', outlineVersion: 1, modules: [] });
    renderIntl(<OutlineView />);
    expect(await screen.findByText(/No modules yet/)).toBeInTheDocument();
  });

  it('renaming a module or topic persists in local state', async () => {
    api(outline());
    renderIntl(<OutlineView />);
    const moduleTitle = await screen.findByDisplayValue('Module 1');
    fireEvent.change(moduleTitle, { target: { value: 'Renamed module' } });
    expect(screen.getByDisplayValue('Renamed module')).toBeInTheDocument();

    const topicTitle = screen.getByDisplayValue('Topic A');
    fireEvent.change(topicTitle, { target: { value: 'Renamed topic' } });
    expect(screen.getByDisplayValue('Renamed topic')).toBeInTheDocument();
  });

  it('reorder swaps two topic rows', async () => {
    api(outline());
    renderIntl(<OutlineView />);
    await screen.findByDisplayValue('Topic A');
    const titleInputs = () => screen.getAllByLabelText('Topic title').map((i) => (i as HTMLInputElement).value);
    expect(titleInputs()).toEqual(['Topic A', 'Topic B', 'Topic C']);

    fireEvent.click(screen.getByRole('button', { name: 'Move Topic A down' }));
    expect(titleInputs()).toEqual(['Topic B', 'Topic A', 'Topic C']);
  });

  it('merge combines two topics into one, removing the other', async () => {
    api(outline());
    renderIntl(<OutlineView />);
    await screen.findByDisplayValue('Topic A');
    fireEvent.click(screen.getByLabelText('Select Topic A to merge'));
    fireEvent.click(screen.getByLabelText('Select Topic B to merge'));
    fireEvent.click(screen.getByRole('button', { name: 'Merge selected topics' }));

    const titleInputs = screen.getAllByLabelText('Topic title').map((i) => (i as HTMLInputElement).value);
    expect(titleInputs).toEqual(['Topic A', 'Topic C']);
    const merged = screen.getByDisplayValue('Topic A').closest('li')!;
    expect(within(merged).getByText(/File 1.pdf/)).toBeInTheDocument();
    expect(within(merged).getByText(/File 2.pdf/)).toBeInTheDocument();
  });

  it('split produces two topics that partition the original chunks', async () => {
    api(outline());
    renderIntl(<OutlineView />);
    await screen.findByDisplayValue('Topic C');
    const topicC = screen.getByDisplayValue('Topic C').closest('li')!;
    fireEvent.click(within(topicC).getByLabelText(/Move File 4.pdf to a new topic/));
    fireEvent.change(within(topicC).getByLabelText('New topic title'), {
      target: { value: 'Topic D' },
    });
    fireEvent.click(within(topicC).getByRole('button', { name: 'Split selected into a new topic' }));

    const remaining = screen.getByDisplayValue('Topic C').closest('li')!;
    expect(within(remaining).getByText(/File 3.pdf/)).toBeInTheDocument();
    expect(within(remaining).queryByText(/File 4.pdf/)).toBeNull();
    const created = screen.getByDisplayValue('Topic D').closest('li')!;
    expect(within(created).getByText(/File 4.pdf/)).toBeInTheDocument();
  });

  it('Save sends the exact edited tree and shows the returned version', async () => {
    const s = api(outline());
    renderIntl(<OutlineView />);
    const moduleTitle = await screen.findByDisplayValue('Module 1');
    fireEvent.change(moduleTitle, { target: { value: 'Renamed module' } });

    s.next('PUT /api/studio/outline', {
      status: 200,
      body: { ...outline(), outlineVersion: 2, modules: [{ ...outline().modules[0], title: 'Renamed module' }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Saved — version 2\./)).toBeInTheDocument();
    const put = s.calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({
      modules: [
        {
          id: 'mod_1',
          title: 'Renamed module',
          order: 0,
          topics: [
            { id: 'top_a', title: 'Topic A', order: 0, chunkIds: ['c1'] },
            { id: 'top_b', title: 'Topic B', order: 1, chunkIds: ['c2'] },
            { id: 'top_c', title: 'Topic C', order: 2, chunkIds: ['c3', 'c4'] },
          ],
        },
      ],
    });
  });

  it('Generate warns before discarding unsaved edits, then replaces the tree', async () => {
    const s = api(outline());
    renderIntl(<OutlineView />);
    const moduleTitle = await screen.findByDisplayValue('Module 1');
    fireEvent.change(moduleTitle, { target: { value: 'Unsaved edit' } });

    fireEvent.click(screen.getByRole('button', { name: 'Generate from uploads' }));
    expect(screen.getByText(/loses any unsaved edits/)).toBeInTheDocument();

    const generated: Outline = {
      courseId: 'crs_1',
      outlineVersion: 5,
      modules: [
        {
          id: 'mod_1',
          title: 'Generated module',
          order: 0,
          topics: [
            { id: 'top_z', title: 'Generated topic', order: 0, chunkIds: [source({ chunkId: 'c9' })] },
          ],
        },
      ],
    };
    s.next('POST /api/studio/outline/generate', { status: 200, body: generated });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, generate' }));

    expect(await screen.findByDisplayValue('Generated module')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Unsaved edit')).toBeNull();
  });

  it('a GET failure shows an alert', async () => {
    const s = api(outline());
    s.next('GET /api/studio/outline', err(401, 'unauthorized'));
    renderIntl(<OutlineView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in again.');
  });

  it('has no axe violations', async () => {
    api(outline());
    const { container } = renderIntl(<OutlineView />);
    await screen.findByDisplayValue('Topic A');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
