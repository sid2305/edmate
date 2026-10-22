// @vitest-environment jsdom
// Task 11.1b Phase B: the live classes studio view. `scheduleLiveClass` is injected (rule 4: no
// real network); a malformed or non-200 reply must show an error and re-enable the form
// (lessons: "a studio page that trusts a 200 response gets stuck").
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveClassRecording, TeacherLiveClassRow } from '@edmate/db';
import type { ApiResult, DocumentView } from '../../../src/studio/uploadClient';
import { renderIntl } from '../../../test/intl';
import { LiveClassesView } from './LiveClassesView';

const PACKAGES = [{ packageId: 'pkg_1', name: 'Grade 8 Math', moduleIds: ['mod_1'] }];

function fillForm() {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Ratios review' } });
  fireEvent.change(screen.getByLabelText('Join link (https://…)'), {
    target: { value: 'https://meet.example.com/abc' },
  });
  fireEvent.change(screen.getByLabelText('Start time'), {
    target: { value: '2026-11-01T10:00' },
  });
  fireEvent.click(screen.getByLabelText('Grade 8 Math'));
}

describe('LiveClassesView', () => {
  it('shows the empty state when there are no classes yet', () => {
    renderIntl(<LiveClassesView classes={[]} packages={PACKAGES} />);
    expect(screen.getByText('No live classes scheduled yet.')).toBeInTheDocument();
  });

  it('shows an existing scheduled class', () => {
    renderIntl(
      <LiveClassesView
        classes={[
          {
            id: 'lc_1',
            title: 'Ratios review',
            link: 'https://meet.example.com/abc',
            startsAt: '2026-11-01T10:00:00.000Z',
            packageIds: ['pkg_1'],
          },
        ]}
        packages={PACKAGES}
      />,
    );
    expect(screen.getByText('Ratios review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join link' })).toHaveAttribute(
      'href',
      'https://meet.example.com/abc',
    );
    expect(screen.getByRole('link', { name: 'Join link' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Join link' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('schedules a class and adds it to the list, clearing the form', async () => {
    const scheduleLiveClass = vi.fn(async () => ({ ok: true as const, id: 'lc_new' }));
    renderIntl(
      <LiveClassesView classes={[]} packages={PACKAGES} scheduleLiveClass={scheduleLiveClass} />,
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule class' }));
    await waitFor(() => expect(scheduleLiveClass).toHaveBeenCalled());
    expect(scheduleLiveClass).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ratios review',
        link: 'https://meet.example.com/abc',
        packageIds: ['pkg_1'],
      }),
    );
    await waitFor(() => expect(screen.getByText('The class is scheduled.')).toBeInTheDocument());
    expect(screen.getByText('Ratios review')).toBeInTheDocument();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
  });

  it('a missing field is a validation error, nothing sent', () => {
    const scheduleLiveClass = vi.fn();
    renderIntl(
      <LiveClassesView classes={[]} packages={PACKAGES} scheduleLiveClass={scheduleLiveClass} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Schedule class' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check the title, link, start time and packages, and try again.',
    );
    expect(scheduleLiveClass).not.toHaveBeenCalled();
  });

  it('a malformed 200 reply does not leave the button stuck disabled', async () => {
    const scheduleLiveClass = vi.fn(async () => {
      throw new Error('bad body');
    });
    renderIntl(
      <LiveClassesView classes={[]} packages={PACKAGES} scheduleLiveClass={scheduleLiveClass} />,
    );
    fillForm();
    const button = screen.getByRole('button', { name: 'Schedule class' });
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('a failed schedule shows an error and re-enables the form', async () => {
    const scheduleLiveClass = vi.fn(async () => ({
      ok: false as const,
      code: 'provider_error' as const,
      retryable: true,
    }));
    renderIntl(
      <LiveClassesView classes={[]} packages={PACKAGES} scheduleLiveClass={scheduleLiveClass} />,
    );
    fillForm();
    const button = screen.getByRole('button', { name: 'Schedule class' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'));
    expect(button).not.toBeDisabled();
  });

  // Task 11.2b: the pre-class question queue, grouped by topic, fed by students and by
  // unanswered ask-the-teacher questions.
  describe('question queues (task 11.2b)', () => {
    it('shows the empty state for both queues when there are none', () => {
      renderIntl(<LiveClassesView classes={[]} packages={PACKAGES} studentQueue={[]} askQueue={[]} />);
      expect(screen.getByText('No pre-class questions yet.')).toBeInTheDocument();
      expect(screen.getByText('No unanswered questions right now.')).toBeInTheDocument();
    });

    it('shows a student-fed topic group, grouped count and sample', () => {
      renderIntl(
        <LiveClassesView
          classes={[]}
          packages={PACKAGES}
          studentQueue={[
            {
              groupId: 'g1',
              count: 3,
              oldestAt: '2026-10-20T00:00:00.000Z',
              sample: 'What is a ratio?',
              liveClassIds: ['lc_1', 'lc_2'],
            },
          ]}
          askQueue={[]}
        />,
      );
      expect(screen.getByText('3 asked near-identically since 2026-10-20')).toBeInTheDocument();
      expect(screen.getByText('What is a ratio?')).toBeInTheDocument();
    });

    it('shows an ask-the-teacher group', () => {
      renderIntl(
        <LiveClassesView
          classes={[]}
          packages={PACKAGES}
          studentQueue={[]}
          askQueue={[
            {
              groupId: 'g2',
              count: 2,
              oldestAt: '2026-10-19T00:00:00.000Z',
              questions: [{ id: 'q1', text: 'How do fractions work?', createdAt: '2026-10-19T00:00:00.000Z' }],
            },
          ]}
        />,
      );
      expect(screen.getByText('2 asked near-identically since 2026-10-19')).toBeInTheDocument();
      expect(screen.getByText('How do fractions work?')).toBeInTheDocument();
    });

    it('renders a student question as literal text, never HTML (11.2a review, LOW)', () => {
      const hostile = '<img src=x onerror=alert(1)>';
      renderIntl(
        <LiveClassesView
          classes={[]}
          packages={PACKAGES}
          studentQueue={[
            {
              groupId: 'g3',
              count: 1,
              oldestAt: '2026-10-20T00:00:00.000Z',
              sample: hostile,
              liveClassIds: ['lc_1'],
            },
          ]}
          askQueue={[]}
        />,
      );
      expect(screen.getByText(hostile)).toBeInTheDocument();
      expect(document.querySelector('img')).toBeNull();
    });
  });

  describe('class recordings (11.4c)', () => {
    const NOW = '2026-10-22T12:00:00.000Z';
    const PKGS = [
      { packageId: 'pkg_1', name: 'Grade 8 Math', moduleIds: ['mod_1', 'mod_2'] },
      { packageId: 'pkg_2', name: 'Grade 9 Math', moduleIds: ['mod_2', 'mod_3'] },
      { packageId: 'pkg_3', name: 'Other', moduleIds: ['mod_x'] },
    ];
    const cls = (over: Partial<TeacherLiveClassRow>): TeacherLiveClassRow => ({
      id: 'lc_past',
      title: 'Past class',
      link: 'https://meet.example.com/past',
      startsAt: '2026-10-20T10:00:00.000Z',
      packageIds: ['pkg_1', 'pkg_2'],
      ...over,
    });
    const PAST = cls({});
    const FUTURE = cls({
      id: 'lc_future',
      title: 'Future class',
      link: 'https://meet.example.com/future',
      startsAt: '2026-11-01T10:00:00.000Z',
    });
    const rec = (over: Partial<LiveClassRecording>): LiveClassRecording => ({
      liveClassId: 'lc_past',
      documentId: 'doc_1',
      sourceTitle: 'Live class: Past class, 2026-10-20',
      status: 'ready',
      ...over,
    });
    const view = (over: Partial<DocumentView>): DocumentView => ({
      id: 'doc_1',
      moduleId: 'mod_1',
      kind: 'transcript',
      sourceTitle: 'Live class: Past class, 2026-10-20',
      source: 'file',
      status: 'ready',
      createdAt: NOW,
      updatedAt: NOW,
      ...over,
    });
    type ListResult = ApiResult<DocumentView[]>;

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows Add recording only on a class that has started (fixed now)', () => {
      renderIntl(
        <LiveClassesView classes={[PAST, FUTURE]} packages={PKGS} recordings={[]} now={NOW} />,
      );
      expect(screen.getByRole('button', { name: 'Add a recording to Past class' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a recording to Future class' })).toBeNull();
    });

    it('a class starting exactly now can take a recording; without now, none can', () => {
      const { unmount } = renderIntl(
        <LiveClassesView classes={[cls({ startsAt: NOW })]} packages={PKGS} recordings={[]} now={NOW} />,
      );
      expect(screen.getByRole('button', { name: 'Add a recording to Past class' })).toBeInTheDocument();
      unmount();
      renderIntl(<LiveClassesView classes={[PAST]} packages={PKGS} />);
      expect(screen.queryByRole('button', { name: 'Add a recording to Past class' })).toBeNull();
    });

    it("opens the form with only the class's attached packages' modules, and closes it", () => {
      renderIntl(<LiveClassesView classes={[PAST]} packages={PKGS} recordings={[]} now={NOW} />);
      const toggle = screen.getByRole('button', { name: 'Add a recording to Past class' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const options = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
      expect(options).toEqual(['', 'mod_1', 'mod_2', 'mod_3']);
      fireEvent.click(toggle);
      expect(screen.queryByRole('form', { name: 'Add a recording' })).toBeNull();
    });

    it('renders recordings under their own class only, with status and the fixed failure reason', () => {
      renderIntl(
        <LiveClassesView
          classes={[PAST, FUTURE]}
          packages={PKGS}
          now={NOW}
          recordings={[
            rec({}),
            rec({ documentId: 'doc_2', sourceTitle: 'Second part', status: 'failed', failureReason: 'unsupported' }),
            rec({ liveClassId: 'lc_other', documentId: 'doc_3', sourceTitle: 'Elsewhere' }),
          ]}
          listDocuments={vi.fn()}
        />,
      );
      const past = screen.getByRole('list', { name: 'Recordings: Past class' });
      expect(within(past).getByText('Live class: Past class, 2026-10-20')).toBeInTheDocument();
      expect(within(past).getByText('Ready')).toBeInTheDocument();
      expect(within(past).getByText('Failed')).toBeInTheDocument();
      expect(within(past).getByText(/can't be read/)).toBeInTheDocument();
      expect(screen.queryByText('Elsewhere')).toBeNull();
      expect(screen.queryByRole('list', { name: 'Recordings: Future class' })).toBeNull();
    });

    it('polls while a recording is processing, updates it to ready, then stops', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const listDocuments = vi.fn(
        async (): Promise<ListResult> => ({ ok: true, value: [view({ status: 'ready' })] }),
      );
      renderIntl(
        <LiveClassesView
          classes={[PAST]}
          packages={PKGS}
          now={NOW}
          recordings={[rec({ status: 'processing' })]}
          listDocuments={listDocuments}
        />,
      );
      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(listDocuments).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(listDocuments).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(listDocuments).toHaveBeenCalledTimes(1);
    });

    it('does not poll when nothing is pending', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const listDocuments = vi.fn();
      renderIntl(
        <LiveClassesView
          classes={[PAST]}
          packages={PKGS}
          now={NOW}
          recordings={[rec({})]}
          listDocuments={listDocuments}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(listDocuments).not.toHaveBeenCalled();
    });

    it('unmount clears the timer', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const listDocuments = vi.fn(async (): Promise<ListResult> => ({ ok: true, value: [] }));
      const { unmount } = renderIntl(
        <LiveClassesView
          classes={[PAST]}
          packages={PKGS}
          now={NOW}
          recordings={[rec({ status: 'uploading' })]}
          listDocuments={listDocuments}
        />,
      );
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(listDocuments).not.toHaveBeenCalled();
    });

    it.each<[string, () => Promise<ListResult>]>([
      ['a malformed payload', async () => ({ ok: true, value: [{ id: 5 }] as unknown as DocumentView[] })],
      ['a refused call', async () => ({ ok: false, status: 500, code: 'provider_error' })],
      ['a thrown call', async () => Promise.reject(new Error('bad json'))],
    ])('%s keeps the last good view and keeps polling', async (_name, impl) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const listDocuments = vi.fn(impl);
      renderIntl(
        <LiveClassesView
          classes={[PAST]}
          packages={PKGS}
          now={NOW}
          recordings={[rec({ status: 'processing' })]}
          listDocuments={listDocuments}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(listDocuments).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Processing')).toBeInTheDocument();
    });

    it('shows a failed status with its reason after a poll, ignoring other documents', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const listDocuments = vi.fn(
        async (): Promise<ListResult> => ({
          ok: true,
          value: [
            view({ status: 'failed', failureReason: 'input_too_large' }),
            view({ id: 'doc_unrelated', sourceTitle: 'Unrelated notes' }),
          ],
        }),
      );
      renderIntl(
        <LiveClassesView
          classes={[PAST]}
          packages={PKGS}
          now={NOW}
          recordings={[rec({ status: 'processing' })]}
          listDocuments={listDocuments}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument());
      expect(screen.getByText('The file is too big.')).toBeInTheDocument();
      expect(screen.queryByText('Unrelated notes')).toBeNull();
    });

    it('a new upload appears under its class with its status', async () => {
      const createDocument = vi.fn(async () => ({
        ok: true as const,
        value: { documentId: 'doc_new', uploadUrl: 'https://bucket.example.test/p', uploadHeaders: {} },
      }));
      const putFile = vi.fn(async () => undefined);
      const completeDocument = vi.fn(async () => ({
        ok: true as const,
        value: { documentId: 'doc_new', status: 'processing' },
      }));
      renderIntl(
        <LiveClassesView
          classes={[PAST]}
          packages={PKGS}
          now={NOW}
          recordings={[]}
          listDocuments={vi.fn(async (): Promise<ListResult> => ({ ok: true, value: [] }))}
          recordingClient={{ createDocument, putFile, completeDocument }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Add a recording to Past class' }));
      fireEvent.change(screen.getByLabelText('Recording or transcript'), {
        target: { files: [new File(['WEBVTT'], 'c.vtt', { type: 'text/vtt' })] },
      });
      fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'mod_3' } });
      fireEvent.click(screen.getByLabelText('I confirm I hold the rights to upload this material.'));
      fireEvent.click(screen.getByLabelText(/Everyone heard in this recording agreed/));
      fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
      await waitFor(() => expect(completeDocument).toHaveBeenCalled());
      const list = await screen.findByRole('list', { name: 'Recordings: Past class' });
      expect(within(list).getByText('Live class: Past class, 2026-10-20')).toBeInTheDocument();
      expect(within(list).getByText('Processing')).toBeInTheDocument();
    });
  });
});
