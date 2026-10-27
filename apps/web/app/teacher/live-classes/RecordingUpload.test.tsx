// @vitest-environment jsdom
// Task 11.4 Phase C: the "Add recording" form for one live class. The studio client calls are
// injected (rule 4: no real network); a malformed 200, a 404 and a failed PUT must each show an
// error, clear the busy flag and reset the form (lessons: "UI state and server replies").
// Synthetic titles and bytes only.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { ApiResult, UploadTicket } from '../../../src/studio/uploadClient';
import { RecordingUpload, type RecordingUploadProps } from './RecordingUpload';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const CLASS = { id: 'lc_1', title: 'Ratios review', startsAt: '2026-10-20T10:00:00.000Z' };
const TICKET: UploadTicket = {
  documentId: 'doc_9',
  uploadUrl: 'https://bucket.example.test/put',
  uploadHeaders: { 'content-type': 'text/vtt' },
};

function file(name: string, type: string, size = 10): File {
  const f = new File(['WEBVTT'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function setup(over: Partial<RecordingUploadProps> = {}) {
  const calls: string[] = [];
  const createDocument = vi.fn(async (): Promise<ApiResult<UploadTicket>> => {
    calls.push('create');
    return { ok: true, value: TICKET };
  });
  const putFile = vi.fn(
    async (_u: string, _h: Record<string, string>, _f: File, p: (n: number) => void) => {
      calls.push('put');
      p(50);
    },
  );
  const completeDocument = vi.fn(
    async (): Promise<ApiResult<{ documentId: string; status: string }>> => {
      calls.push('complete');
      return { ok: true, value: { documentId: 'doc_9', status: 'processing' } };
    },
  );
  const onRecording = vi.fn();
  const props: RecordingUploadProps = {
    liveClass: CLASS,
    moduleIds: ['mod_1', 'mod_2'],
    onRecording,
    createDocument,
    putFile,
    completeDocument,
    ...over,
  };
  const utils = renderIntl(<RecordingUpload {...props} />);
  return { ...utils, calls, createDocument, putFile, completeDocument, onRecording, props };
}

const submit = () => screen.getByRole('button', { name: 'Upload recording' });

function fill(f: File = file('class.vtt', 'text/vtt'), moduleId = 'mod_2') {
  fireEvent.change(screen.getByLabelText('Recording or transcript'), { target: { files: [f] } });
  fireEvent.change(screen.getByLabelText('Module'), { target: { value: moduleId } });
  fireEvent.click(screen.getByLabelText('I confirm I hold the rights to upload this material.'));
  fireEvent.click(screen.getByLabelText(/Everyone heard in this recording agreed/));
}

describe('RecordingUpload', () => {
  it('uploads: create, then PUT, then complete, with the class, module and rights declared', async () => {
    const { calls, createDocument, completeDocument, onRecording } = setup();
    fill();
    fireEvent.click(submit());
    await waitFor(() => expect(completeDocument).toHaveBeenCalled());
    expect(calls).toEqual(['create', 'put', 'complete']);
    expect(createDocument).toHaveBeenCalledWith({
      moduleId: 'mod_2',
      sourceTitle: 'Live class: Ratios review, 2026-10-20',
      contentType: 'text/vtt',
      byteSize: 10,
      rightsDeclared: true,
      liveClassId: 'lc_1',
    });
    expect(completeDocument).toHaveBeenCalledWith('doc_9');
    expect(onRecording).toHaveBeenNthCalledWith(1, {
      liveClassId: 'lc_1',
      documentId: 'doc_9',
      sourceTitle: 'Live class: Ratios review, 2026-10-20',
      status: 'uploading',
    });
    expect(onRecording).toHaveBeenLastCalledWith({
      liveClassId: 'lc_1',
      documentId: 'doc_9',
      sourceTitle: 'Live class: Ratios review, 2026-10-20',
      status: 'processing',
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/recording is uploaded/),
    );
    // Reset after success: both boxes cleared, so submit is disabled again.
    expect(
      screen.getByLabelText('I confirm I hold the rights to upload this material.'),
    ).not.toBeChecked();
    expect(submit()).toBeDisabled();
  });

  it('uses an edited title, trimmed', async () => {
    const { createDocument } = setup();
    fill();
    fireEvent.change(screen.getByLabelText('Title students see when it is cited'), {
      target: { value: '  Week 3 class  ' },
    });
    fireEvent.click(submit());
    await waitFor(() => expect(createDocument).toHaveBeenCalled());
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sourceTitle: 'Week 3 class' }),
    );
  });

  it('refuses an empty title without calling the server', () => {
    const { createDocument } = setup();
    fill();
    fireEvent.change(screen.getByLabelText('Title students see when it is cited'), {
      target: { value: '   ' },
    });
    fireEvent.click(submit());
    expect(screen.getByRole('alert')).toHaveTextContent(/title of up to 500/);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('keeps submit disabled until a file, a module and both boxes are chosen', () => {
    setup();
    expect(submit()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Recording or transcript'), {
      target: { files: [file('class.vtt', 'text/vtt')] },
    });
    expect(submit()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'mod_1' } });
    expect(submit()).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I confirm I hold the rights to upload this material.'));
    expect(submit()).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Everyone heard in this recording agreed/));
    expect(submit()).toBeEnabled();
  });

  it('shows the consent hint about removing students’ names', () => {
    setup();
    expect(
      screen.getByText("Best: upload your own transcript with students' names removed."),
    ).toBeInTheDocument();
  });

  it('a 30 MB .mp4 completes create, put and complete (11.4i: no client-side size refusal)', async () => {
    const { calls, createDocument, completeDocument } = setup();
    fill(file('class.mp4', 'video/mp4', 30 * 1024 * 1024));
    fireEvent.click(submit());
    await waitFor(() => expect(completeDocument).toHaveBeenCalled());
    expect(calls).toEqual(['create', 'put', 'complete']);
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'video/mp4', byteSize: 30 * 1024 * 1024 }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses a non-recording file type without calling the server', () => {
    const { createDocument } = setup();
    fill(file('notes.pdf', 'application/pdf'));
    fireEvent.click(submit());
    expect(screen.getByRole('alert')).toHaveTextContent(/can't be used for a recording/);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('a malformed 200 create reply shows an error, clears busy and resets the form', async () => {
    const { putFile } = setup({
      createDocument: vi.fn(async () => ({
        ok: true as const,
        value: { nope: 1 } as unknown as UploadTicket,
      })),
    });
    fill();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
    );
    expect(putFile).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Recording or transcript')).toBeEnabled();
    expect(screen.getByLabelText(/Everyone heard/)).not.toBeChecked();
    expect(submit()).toHaveTextContent('Upload recording');
  });

  it('a thrown create (unreadable body) shows an error and clears busy', async () => {
    setup({ createDocument: vi.fn(async () => Promise.reject(new Error('bad json'))) });
    fill();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
    );
    expect(screen.getByLabelText('Module')).toBeEnabled();
  });

  it('a 404 shows the not-found words and writes nothing more', async () => {
    const { putFile, onRecording } = setup({
      createDocument: vi.fn(async () => ({ ok: false as const, status: 404, code: 'not_found' })),
    });
    fill();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/class or module was not found/),
    );
    expect(putFile).not.toHaveBeenCalled();
    expect(onRecording).not.toHaveBeenCalled();
    expect(submit()).toBeDisabled();
  });

  it("shows the server's fixed message when one comes with the refusal", async () => {
    setup({
      createDocument: vi.fn(async () => ({
        ok: false as const,
        status: 413,
        code: 'input_too_large',
        message: 'Server fixed words.',
      })),
    });
    fill();
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server fixed words.'));
  });

  it('a failed PUT shows an error, skips complete, reports the row as failed and re-enables the form', async () => {
    const { completeDocument, onRecording } = setup({
      putFile: vi.fn(async () => Promise.reject(new Error('upload failed'))),
    });
    fill();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/upload didn't finish/),
    );
    expect(completeDocument).not.toHaveBeenCalled();
    expect(onRecording).toHaveBeenCalledTimes(2);
    expect(onRecording).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(screen.getByLabelText('Recording or transcript')).toBeEnabled();
  });

  it('a refused complete shows an error and reports the row as failed', async () => {
    const { onRecording } = setup({
      completeDocument: vi.fn(async () => ({
        ok: false as const,
        status: 500,
        code: 'enqueue_failed',
      })),
    });
    fill();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
    );
    expect(onRecording).toHaveBeenCalledTimes(2);
    expect(onRecording).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('a malformed complete reply falls back to processing', async () => {
    const { onRecording } = setup({
      completeDocument: vi.fn(async () => ({
        ok: true as const,
        value: { documentId: 'doc_9', status: 'weird' },
      })),
    });
    fill();
    fireEvent.click(submit());
    await waitFor(() => expect(onRecording).toHaveBeenCalledTimes(2));
    expect(onRecording).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'processing' }));
  });

  it('skips state updates and onRecording once unmounted mid-upload (11.4g)', async () => {
    const resolvePut: { fn: (() => void) | null } = { fn: null };
    const putFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePut.fn = () => resolve();
        }),
    );
    const { unmount, onRecording } = setup({ putFile });
    fill();
    fireEvent.click(submit());
    await waitFor(() => expect(putFile).toHaveBeenCalled());
    expect(onRecording).toHaveBeenCalledTimes(1);
    unmount();
    resolvePut.fn?.();
    // Let the pending microtasks (the rest of the async chain) settle; no further onRecording
    // call, and no React "update on an unmounted component" console error.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(onRecording).toHaveBeenCalledTimes(1);
  });

  it('ignores a progress event the fake putFile fires after unmount (11.4g fix round)', async () => {
    const hooks: { fireLateProgress: (() => void) | null; settlePut: (() => void) | null } = {
      fireLateProgress: null,
      settlePut: null,
    };
    const putFile = vi.fn(
      (_u: string, _h: Record<string, string>, _f: File, p: (n: number) => void) =>
        new Promise<void>((resolve) => {
          hooks.fireLateProgress = () => p(99);
          hooks.settlePut = () => resolve();
        }),
    );
    const { unmount, onRecording, container } = setup({ putFile });
    fill();
    fireEvent.click(submit());
    await waitFor(() => expect(putFile).toHaveBeenCalled());
    unmount();
    // A progress event that arrives after unmount must not call setState (no React warning) and
    // must not reach `onRecording` again.
    hooks.fireLateProgress?.();
    hooks.settlePut?.();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(onRecording).toHaveBeenCalledTimes(1);
    expect(container.querySelector('form')).toBeNull();
  });

  it('lists only the given modules', () => {
    setup({ moduleIds: ['mod_a'] });
    const options = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['', 'mod_a']);
  });

  it('shows a fixed hint and no form when the class has no modules', () => {
    setup({ moduleIds: [] });
    expect(screen.getByText(/have no modules yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload recording' })).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });
});
