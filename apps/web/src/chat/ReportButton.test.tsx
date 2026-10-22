// @vitest-environment jsdom
// Task 12.2c: closed shows one "Report" button; open shows the category radio group with Send
// (disabled until a category is chosen) and Cancel; a successful send shows the thanks line and
// stays that way; a failure shows fixed text and the form reopens, ready to retry.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { ReportButton } from './ReportButton';
import type { ReportMessageResult } from './reportMessage';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const PROPS = { agentId: 'agt_1', sessionId: 'ses_1', messageId: 'msg_1' };

describe('ReportButton', () => {
  it('renders nothing without an open session', () => {
    const { container } = renderIntl(<ReportButton {...PROPS} sessionId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the category form, a11y clean closed and open', async () => {
    const { container } = renderIntl(<ReportButton {...PROPS} report={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Send is disabled until a category is chosen', () => {
    renderIntl(<ReportButton {...PROPS} report={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    const send = screen.getByRole('button', { name: 'Send report' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Harmful' }));
    expect(send).not.toBeDisabled();
  });

  it('sends the chosen category, disables the form while busy, shows thanks on success', async () => {
    let resolve!: (r: ReportMessageResult) => void;
    const report = vi.fn(() => new Promise<ReportMessageResult>((r) => (resolve = r)));
    renderIntl(<ReportButton {...PROPS} report={report} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Copyright' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Copyright' })).toBeDisabled();
    expect(report).toHaveBeenCalledWith({
      sessionId: 'ses_1',
      agentId: 'agt_1',
      messageId: 'msg_1',
      category: 'copyright',
    });
    resolve({ ok: true });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Thanks, our team will review this.'));
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull();
  });

  it('a failed send shows fixed text (never the server message) and reopens to retry', async () => {
    const report = vi
      .fn<() => Promise<ReportMessageResult>>()
      .mockResolvedValueOnce({ ok: false, code: 'not_found', retryable: false });
    renderIntl(<ReportButton {...PROPS} report={report} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/available any more/));
    const send = screen.getByRole('button', { name: 'Send report' });
    expect(send).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Other' })).not.toBeDisabled();
  });

  it('a rejected promise is also a fixed failure, not an uncaught error', async () => {
    const report = vi.fn().mockRejectedValueOnce(new Error('boom'));
    renderIntl(<ReportButton {...PROPS} report={report} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Wrong information' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('Cancel closes the form without sending', () => {
    const report = vi.fn();
    renderIntl(<ReportButton {...PROPS} report={report} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Inappropriate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Report' })).toBeInTheDocument();
    expect(report).not.toHaveBeenCalled();
  });
});
