'use client';
// Task 6.5 Phase B: the client half of the memory page. `window.confirm` before anything is sent
// (a reset can't be undone); on confirm, one DELETE to this agent's memory route, then
// `router.refresh()` so the server component re-reads the now-empty profile. A failed request
// shows a fixed error line -- never the raw response text.
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface ResetMemoryButtonProps {
  agentId: string;
}

export function ResetMemoryButton({ agentId }: ResetMemoryButtonProps) {
  const t = useTranslations('memory');
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm(t('resetConfirm'))) return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/memory/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(t('resetError'));
        return;
      }
      router.refresh();
    } catch {
      setError(t('resetError'));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" disabled={resetting} onClick={() => void onClick()}>
        {resetting ? t('resetting') : t('resetButton')}
      </button>
    </div>
  );
}
