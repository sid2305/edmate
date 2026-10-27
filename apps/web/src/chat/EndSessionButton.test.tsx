// @vitest-environment jsdom
// Task 6.4a Phase B: closed shows one "End chat" button; clicking asks for a plain confirm; a
// successful send calls `onEnded` (no raw session/agent ids in any rendered text); a failure
// shows fixed text and stays on the confirm step, ready to retry.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { endSession, EndSessionButton, type EndSessionResult } from './EndSessionButton';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

const PROPS = { agentId: 'agt_1', sessionId: 'ses_1' };

describe('EndSessionButton', () => {
  it('renders nothing without an open session', () => {
    const { container } = renderIntl(<EndSessionButton {...PROPS} sessionId={null} end={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the confirm step, a11y clean closed and open', async () => {
    const { container } = renderIntl(<EndSessionButton {...PROPS} end={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    expect(screen.getByText('End this chat? You can start a new one any time.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sends on confirm, disables both buttons while busy, calls onEnded on success', async () => {
    let resolve!: (r: EndSessionResult) => void;
    const end = vi.fn(() => new Promise<EndSessionResult>((r) => (resolve = r)));
    const onEnded = vi.fn();
    renderIntl(<EndSessionButton {...PROPS} end={end} onEnded={onEnded} />);
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    expect(screen.getByRole('button', { name: 'Ending…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep chatting' })).toBeDisabled();
    expect(end).toHaveBeenCalledWith('ses_1', 'agt_1');
    resolve({ ok: true });
    await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
  });

  it('cancel returns to the closed button without sending', () => {
    const end = vi.fn();
    renderIntl(<EndSessionButton {...PROPS} end={end} />);
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep chatting' }));
    expect(screen.getByRole('button', { name: 'End chat' })).toBeInTheDocument();
    expect(end).not.toHaveBeenCalled();
  });

  it('a failure shows fixed text and stays on the confirm step', async () => {
    const end = vi.fn(async (): Promise<EndSessionResult> => ({ ok: false }));
    const onEnded = vi.fn();
    renderIntl(<EndSessionButton {...PROPS} end={end} onEnded={onEnded} />);
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not end the chat. Try again.'),
    );
    expect(onEnded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'End chat' })).not.toBeDisabled();
  });
});

describe('endSession (the fetch layer)', () => {
  it('posts the session and agent id, no body text, and returns ok on 200', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await endSession('ses_1', 'agt_1', fetchImpl);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith('/api/sessions/ses_1/end', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agt_1' }),
      cache: 'no-store',
    });
  });

  it('a non-2xx response is ok: false; never throws', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 }),
    );
    expect(await endSession('ses_1', 'agt_1', fetchImpl)).toEqual({ ok: false });
  });

  it('a network failure is ok: false; never throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await endSession('ses_1', 'agt_1', fetchImpl)).toEqual({ ok: false });
  });

  it('encodes the session id in the URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await endSession('ses/1', 'agt_1', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/sessions/ses%2F1/end', expect.anything());
  });
});
