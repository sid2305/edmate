// @vitest-environment jsdom
// Task 8.2 Phase 4: the upload centre. Fetch is stubbed with a tiny in-memory studio API (rule 4)
// and the bucket PUT is injected; fake timers prove a poll tick updates a row. Written red before
// UploadsView.tsx. Synthetic titles and bytes only.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { DocumentView, PutFile } from '../../../src/studio/uploadClient';
import { POLL_MAX_MS, POLL_MS, UploadsView } from './UploadsView';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const doc = (over: Partial<DocumentView>): DocumentView => ({
  id: 'doc_1',
  moduleId: 'mod_1',
  kind: 'material',
  sourceTitle: 'Algebra notes.pdf',
  source: 'file',
  status: 'ready',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  takenDown: false,
  ...over,
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

/** A scripted studio API: `docs` is what the list returns; `next` queues replies per route. */
function api(initial: DocumentView[]) {
  const state = { docs: initial };
  const queued: Record<string, Reply[]> = {};
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, ...(body === undefined ? {} : { body }) });
    const key = `${method} ${url}`;
    const next = queued[key]?.shift();
    if (next) return json(next);
    if (key === 'GET /api/studio/documents')
      return json({ status: 200, body: { documents: state.docs } });
    return json(err(500, 'provider_error'));
  });
  vi.stubGlobal('fetch', fetchFn);
  return {
    state,
    calls,
    next: (key: string, reply: Reply) => (queued[key] ??= []).push(reply),
  };
}

const ticket = (id: string, type: string) => ({
  status: 201,
  body: {
    documentId: id,
    uploadUrl: `https://bucket.test/${id}`,
    uploadHeaders: { 'content-type': type },
  },
});

const okPut: PutFile = async (_u, _h, _f, onProgress) => {
  onProgress(50);
};

function pick(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

/** Checks the rights checkbox, required before any upload, replace or link control works. */
function checkRights() {
  fireEvent.click(screen.getByLabelText(/confirm I hold the rights/));
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UploadsView', () => {
  it('lists the teacher’s files with their status in words', async () => {
    api([
      doc({ id: 'doc_1', sourceTitle: 'Algebra notes.pdf', status: 'ready' }),
      doc({
        id: 'doc_2',
        sourceTitle: 'Lecture.mp3',
        status: 'failed',
        failureReason: 'input_too_large',
      }),
      doc({
        id: 'doc_3',
        sourceTitle: 'Odd.pdf',
        status: 'failed',
        failureReason: 'something_new',
      }),
    ]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    const list = await screen.findByRole('list', { name: 'Your files' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Algebra notes.pdf');
    expect(rows[0]).toHaveTextContent('Ready');
    expect(rows[1]).toHaveTextContent('Failed');
    expect(rows[1]).toHaveTextContent('The file is too big.');
    expect(rows[2]).toHaveTextContent('Replace the file to try again.');
  });

  it('shows a "Removed by Edmate staff" badge only for a taken-down document, alongside its status (task 12.2f Phase C)', async () => {
    api([
      doc({ id: 'doc_1', sourceTitle: 'Algebra notes.pdf', status: 'ready', takenDown: true }),
      doc({ id: 'doc_2', sourceTitle: 'Lecture.mp3', status: 'ready', takenDown: false }),
    ]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    const list = await screen.findByRole('list', { name: 'Your files' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Removed by Edmate staff');
    expect(rows[0]).toHaveTextContent('Ready');
    expect(rows[1]).not.toHaveTextContent('Removed by Edmate staff');
  });

  it('accepts caption files and shows the YouTube hint (task 8.2c)', async () => {
    api([]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    await screen.findByText(/No files yet/);
    const picker = screen.getByLabelText('Upload a file');
    if (!(picker instanceof HTMLInputElement)) throw new Error('the file picker is not an input');
    expect(picker.accept.split(',')).toEqual(expect.arrayContaining(['.vtt', '.srt']));
    expect(await screen.findByText(/In YouTube Studio, download its captions/)).toBeInTheDocument();
  });

  it('shows an empty state, and no upload control without a module', async () => {
    api([]);
    renderIntl(<UploadsView moduleIds={[]} putFile={okPut} />);
    expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
    expect(screen.getByText(/Set up a module/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Upload a file')).toBeNull();
  });

  it('uploads: create with the exact type and size, PUT with exactly the headers, then complete', async () => {
    const s = api([]);
    const put = vi.fn<PutFile>(okPut);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={put} />);
    await screen.findByText(/No files yet/);
    checkRights();
    s.next('POST /api/studio/documents', ticket('doc_9', 'text/markdown'));
    s.next('POST /api/studio/documents/doc_9/complete', {
      status: 202,
      body: { documentId: 'doc_9', status: 'processing' },
    });
    s.state.docs = [doc({ id: 'doc_9', sourceTitle: 'Week 1.md', status: 'processing' })];
    const file = new File(['# hi'], 'Week 1.md', { type: '' });
    pick(screen.getByLabelText('Upload a file'), file);

    await screen.findByText('Processing');
    expect(
      s.calls.find((c) => c.method === 'POST' && c.url === '/api/studio/documents')!.body,
    ).toEqual({
      moduleId: 'mod_1',
      sourceTitle: 'Week 1.md',
      contentType: 'text/markdown',
      byteSize: 4,
      rightsDeclared: true,
    });
    expect(put).toHaveBeenCalledWith(
      'https://bucket.test/doc_9',
      { 'content-type': 'text/markdown' },
      file,
      expect.any(Function),
    );
    const order = s.calls.map((c) => `${c.method} ${c.url}`);
    expect(order.indexOf('POST /api/studio/documents/doc_9/complete')).toBeGreaterThan(
      order.indexOf('POST /api/studio/documents'),
    );
  });

  it('files under the chosen module when there are several', async () => {
    const s = api([]);
    renderIntl(<UploadsView moduleIds={['mod_1', 'mod_2']} putFile={okPut} />);
    await screen.findByText(/No files yet/);
    checkRights();
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'mod_2' } });
    s.next('POST /api/studio/documents', err(413, 'input_too_large'));
    pick(
      screen.getByLabelText('Upload a file'),
      new File(['x'], 'big.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/too big/);
    expect(s.calls.find((c) => c.method === 'POST')!.body).toMatchObject({ moduleId: 'mod_2' });
  });

  it('refuses an unsupported file before calling the API', async () => {
    const s = api([]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    await screen.findByText(/No files yet/);
    checkRights();
    pick(
      screen.getByLabelText('Upload a file'),
      new File(['x'], 'page.html', { type: 'text/html' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/can't be uploaded/);
    expect(s.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('a failed PUT says so and does not call complete', async () => {
    const s = api([]);
    renderIntl(
      <UploadsView
        moduleIds={['mod_1']}
        putFile={async () => Promise.reject(new Error('upload failed'))}
      />,
    );
    await screen.findByText(/No files yet/);
    checkRights();
    s.next('POST /api/studio/documents', ticket('doc_9', 'application/pdf'));
    s.state.docs = [doc({ id: 'doc_9', sourceTitle: 'a.pdf', status: 'uploading' })];
    pick(
      screen.getByLabelText('Upload a file'),
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByText(/didn't finish/)).toBeInTheDocument();
    expect(s.calls.some((c) => c.url.endsWith('/complete'))).toBe(false);
  });

  it('a 409 on complete asks to wait, and Try again completes it', async () => {
    const s = api([]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    await screen.findByText(/No files yet/);
    checkRights();
    s.next('POST /api/studio/documents', ticket('doc_9', 'application/pdf'));
    s.next('POST /api/studio/documents/doc_9/complete', err(409, 'validation'));
    s.state.docs = [doc({ id: 'doc_9', sourceTitle: 'a.pdf', status: 'uploading' })];
    pick(
      screen.getByLabelText('Upload a file'),
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByText(/hasn't arrived yet/)).toBeInTheDocument();

    s.next('POST /api/studio/documents/doc_9/complete', {
      status: 202,
      body: { documentId: 'doc_9', status: 'processing' },
    });
    s.state.docs = [doc({ id: 'doc_9', sourceTitle: 'a.pdf', status: 'processing' })];
    fireEvent.click(screen.getByRole('button', { name: 'Try again: a.pdf' }));
    await screen.findByText('Processing');
    expect(screen.queryByText(/hasn't arrived yet/)).toBeNull();
  });

  it('an enqueue_failed file can be retried; a 503 says so in words', async () => {
    const s = api([doc({ status: 'failed', failureReason: 'enqueue_failed' })]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    expect(await screen.findByText("Processing couldn't start.")).toBeInTheDocument();
    s.next('POST /api/studio/documents/doc_1/complete', err(503, 'provider_error'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again: Algebra notes.pdf' }));
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
  });

  it('polls about every 4 s while a file is processing, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = api([doc({ status: 'processing' })]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    const lists = () => s.calls.filter((c) => c.method === 'GET').length;
    const before = lists();

    s.state.docs = [doc({ status: 'ready' })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(lists()).toBe(before + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(lists()).toBe(before + 1);
  });

  it('stops polling after the poll cap and tells the teacher to check back later (11.4g)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = api([doc({ status: 'processing' })]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    const lists = () => s.calls.filter((c) => c.method === 'GET').length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MAX_MS + POLL_MS);
    });
    const callsAtCap = lists();
    expect(callsAtCap).toBeGreaterThan(0);
    expect(screen.getByText('Still processing. Check back later.')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    });
    expect(lists()).toBe(callsAtCap);
  });

  it('a row past the poll cap does not stop a newer row from polling to completion (11.4g fix round)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = api([doc({ id: 'doc_old', sourceTitle: 'Stuck.pdf', status: 'processing' })]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    const lists = () => s.calls.filter((c) => c.method === 'GET').length;

    // doc_old sits past its own window; polling for it alone stops (same as the cap test above).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MAX_MS + POLL_MS);
    });
    const callsAtCap = lists();
    expect(screen.getByText('Still processing. Check back later.')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(lists()).toBe(callsAtCap);

    // A brand-new upload (doc_new) must get its own full poll window, even while doc_old is
    // still sitting there, stuck past its cap.
    checkRights();
    s.next('POST /api/studio/documents', ticket('doc_new', 'application/pdf'));
    s.state.docs = [
      doc({ id: 'doc_old', sourceTitle: 'Stuck.pdf', status: 'processing' }),
      doc({ id: 'doc_new', sourceTitle: 'Fresh.pdf', status: 'uploading' }),
    ];
    pick(
      screen.getByLabelText('Upload a file'),
      new File(['x'], 'Fresh.pdf', { type: 'application/pdf' }),
    );
    s.next('POST /api/studio/documents/doc_new/complete', {
      status: 202,
      body: { documentId: 'doc_new', status: 'processing' },
    });
    await screen.findByText('Fresh.pdf');

    s.state.docs = [
      doc({ id: 'doc_old', sourceTitle: 'Stuck.pdf', status: 'processing' }),
      doc({ id: 'doc_new', sourceTitle: 'Fresh.pdf', status: 'ready' }),
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    await waitFor(() => expect(lists()).toBeGreaterThan(callsAtCap));
    const list = await screen.findByRole('list', { name: 'Your files' });
    expect(within(list).getByText('Fresh.pdf')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Your files' })).getAllByText('Ready').length,
      ).toBe(1),
    );
  });

  it('replaces a file through the hidden picker, then completes it', async () => {
    const s = api([doc({})]);
    const put = vi.fn<PutFile>(okPut);
    const { container } = renderIntl(<UploadsView moduleIds={['mod_1']} putFile={put} />);
    await screen.findByRole('button', { name: 'Replace Algebra notes.pdf' });
    checkRights();
    fireEvent.click(screen.getByRole('button', { name: 'Replace Algebra notes.pdf' }));
    s.next('POST /api/studio/documents/doc_1/replace', {
      status: 200,
      body: {
        documentId: 'doc_1',
        uploadUrl: 'https://bucket.test/r',
        uploadHeaders: { 'content-type': 'audio/wav' },
      },
    });
    s.next('POST /api/studio/documents/doc_1/complete', {
      status: 202,
      body: { documentId: 'doc_1', status: 'processing' },
    });
    s.state.docs = [doc({ status: 'processing' })];
    const picker = container.querySelector<HTMLInputElement>('input[data-replace-picker]')!;
    pick(picker, new File(['ab'], 'take2.wav', { type: 'audio/wav' }));
    await screen.findByText('Processing');
    expect(s.calls.find((c) => c.url.endsWith('/replace'))!.body).toEqual({
      contentType: 'audio/wav',
      byteSize: 2,
      rightsDeclared: true,
    });
    expect(put).toHaveBeenCalledWith(
      'https://bucket.test/r',
      { 'content-type': 'audio/wav' },
      expect.any(File),
      expect.any(Function),
    );
  });

  it('disables upload, replace and add-link until the rights checkbox is checked (task 12.3c)', async () => {
    const s = api([doc({})]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    await screen.findByRole('button', { name: 'Replace Algebra notes.pdf' });
    const filePicker = screen.getByLabelText('Upload a file') as HTMLInputElement;
    const replaceButton = screen.getByRole('button', { name: 'Replace Algebra notes.pdf' });
    const linkUrlInput = screen.getByLabelText('Add a web link');
    const addLinkButton = screen.getByRole('button', { name: 'Add link' });
    expect(filePicker.disabled).toBe(true);
    expect(replaceButton).toBeDisabled();
    fireEvent.change(linkUrlInput, { target: { value: 'https://example.org/a' } });
    expect(addLinkButton).toBeDisabled();

    checkRights();
    expect(filePicker.disabled).toBe(false);
    expect(replaceButton).not.toBeDisabled();
    expect(addLinkButton).not.toBeDisabled();
    expect(s.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('adds a link only once the rights box is checked, sending rightsDeclared: true', async () => {
    const s = api([]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    await screen.findByText(/No files yet/);
    checkRights();
    fireEvent.change(screen.getByLabelText('Add a web link'), {
      target: { value: 'https://example.org/a' },
    });
    s.next('POST /api/studio/links', {
      status: 202,
      body: { documentId: 'doc_9', status: 'processing' },
    });
    s.state.docs = [doc({ id: 'doc_9', source: 'link', status: 'processing' })];
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    await waitFor(() =>
      expect(s.calls.some((c) => c.method === 'POST' && c.url === '/api/studio/links')).toBe(true),
    );
    expect(s.calls.find((c) => c.url === '/api/studio/links')!.body).toEqual({
      moduleId: 'mod_1',
      url: 'https://example.org/a',
      rightsDeclared: true,
    });
  });

  it('deletes only after a confirm, and Cancel keeps the file', async () => {
    const s = api([doc({})]);
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Algebra notes.pdf' }));
    expect(screen.getByText(/stops using it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Algebra notes.pdf' }));
    s.next('DELETE /api/studio/documents/doc_1', { status: 204 });
    s.state.docs = [];
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
  });

  it('a list failure shows an alert', async () => {
    const s = api([]);
    s.next('GET /api/studio/documents', err(401, 'unauthorized'));
    renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in again.');
  });

  it('renders a title as text, never as markup', async () => {
    api([doc({ sourceTitle: '<b>bold</b> notes.md' })]);
    const { container } = renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    expect(await screen.findByText('<b>bold</b> notes.md')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('has no axe violations, with files, progress and a confirm open', async () => {
    api([
      doc({ id: 'doc_1', status: 'ready' }),
      doc({
        id: 'doc_2',
        sourceTitle: 'Talk.mp4',
        status: 'failed',
        failureReason: 'enqueue_failed',
      }),
    ]);
    const { container } = renderIntl(
      <UploadsView moduleIds={['mod_1', 'mod_2']} putFile={okPut} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Talk.mp4' }));
    await waitFor(() => expect(screen.getByText(/stops using it/)).toBeInTheDocument());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('unmounting mid-upload never refreshes or touches state after unmount (8.2a Phase B)', async () => {
    const calls: string[] = [];
    let resolveComplete: (() => void) | undefined;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (method === 'GET' && url === '/api/studio/documents') {
        return json({ status: 200, body: { documents: [] } });
      }
      if (method === 'POST' && url === '/api/studio/documents') {
        return json(ticket('doc_1', 'application/pdf'));
      }
      if (method === 'POST' && url === '/api/studio/documents/doc_1/complete') {
        await new Promise<void>((resolve) => {
          resolveComplete = resolve;
        });
        return json({ status: 200, body: { documentId: 'doc_1', status: 'ready' } });
      }
      return json(err(500, 'provider_error'));
    });
    vi.stubGlobal('fetch', fetchFn);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderIntl(<UploadsView moduleIds={['mod_1']} putFile={okPut} />);
    await screen.findByText(/No files yet/);
    checkRights();
    const picker = screen.getByLabelText('Upload a file');
    pick(picker, new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(calls).toContain('POST /api/studio/documents/doc_1/complete'));
    const callsBeforeUnmount = calls.length;
    expect(() => unmount()).not.toThrow();
    resolveComplete?.();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // A mounted guard skips `finish`'s post-completion `refresh()` once the component has
    // unmounted, so no further fetch call fires after the late `complete` response lands.
    expect(calls.length).toBe(callsBeforeUnmount);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
