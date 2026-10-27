'use client';
// Task 6.4a Phase B: a real "this chat is over" trigger (same size/pattern as `ReportButton.tsx`,
// 12.2c). Closed shows one small "End chat" button; clicking it asks for a plain confirm (no
// destructive action without one) before POSTing. On success the page reloads: the server's own
// `loadChat.ts` already treats an ended session's `?s=` as a fresh, empty chat (6.4a plan), so no
// new client-side "ended" state is needed here. A failure shows fixed text (never the server's
// own message) and returns to the confirm step so the student can retry.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { responseError } from './sse';

export type EndSessionResult = { ok: true } | { ok: false };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** POSTs /api/sessions/:id/end. Never throws: a network failure or a non-2xx status is a typed
 * failure the caller shows fixed text for. */
export async function endSession(
  sessionId: string,
  agentId: string,
  fetchImpl?: FetchLike,
): Promise<EndSessionResult> {
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init));
  let res: Response;
  try {
    res = await doFetch(`/api/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId }),
      cache: 'no-store',
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) {
    await responseError(res);
    return { ok: false };
  }
  return { ok: true };
}

export interface EndSessionButtonProps {
  agentId: string;
  /** The open session to end; no session, no button (nothing is rendered). */
  sessionId: string | null;
  /** Injected in tests; the real fetch-based client otherwise. */
  end?: typeof endSession;
  /** Called once the session has ended; defaults to reloading the page (see the file comment). */
  onEnded?: () => void;
}

type Phase = 'closed' | 'confirm' | 'busy';

export function EndSessionButton({
  agentId,
  sessionId,
  end = endSession,
  onEnded = () => window.location.reload(),
}: EndSessionButtonProps) {
  const t = useTranslations('endSession');
  const [phase, setPhase] = useState<Phase>('closed');
  const [error, setError] = useState<string | null>(null);

  if (sessionId === null) return null;
  const openSessionId: string = sessionId;

  async function send() {
    setPhase('busy');
    setError(null);
    const result = await end(openSessionId, agentId);
    if (result.ok) {
      onEnded();
      return;
    }
    setError(t('failed'));
    setPhase('confirm');
  }

  if (phase === 'closed') {
    return (
      <button type="button" className="end-session-open" onClick={() => setPhase('confirm')}>
        {t('button')}
      </button>
    );
  }

  const busy = phase === 'busy';
  return (
    <div className="end-session-confirm">
      <p>{t('confirm')}</p>
      {error === null ? null : (
        <p className="end-session-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => void send()}>
        {busy ? t('ending') : t('button')}
      </button>
      <button type="button" disabled={busy} onClick={() => setPhase('closed')}>
        {t('cancel')}
      </button>
    </div>
  );
}
