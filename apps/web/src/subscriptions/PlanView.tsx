'use client';
// Task 9.6 Phase D: the student's plan page body. No payment screen: upgrade, downgrade and
// switch apply at once (9.6c, Q1 = (a)); the copy says so. Every action is try/catch/finally with
// a busy flag, a non-2xx or unreadable body shows a fixed `role="alert"` text, and on success
// after change, resume or cancel it navigates to `/learn/<agentId>` (no `?s=`) so the next
// message starts a fresh session on the new package (3.16 already ends the old one). After
// pause it re-renders in place (`router.refresh()`).
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface PlanOffer {
  packageId: string;
  name: string;
  amountMinor: number;
  currency: string;
}

export interface PlanSubscription {
  id: string;
  status: 'trial' | 'active' | 'past_due' | 'paused';
  periodEnd: string;
  packageId: string;
}

export interface PlanViewProps {
  agentId: string;
  subscription: PlanSubscription | null;
  /** Every live offer of this agent, including the current one (so a label can compare prices). */
  offers: PlanOffer[];
  /** Task 9.3i: false when the agent is suspended/draft (default true). Hides Resume and the
   * change-plan controls, shows a blame-free notice, and sends a successful pause/cancel to
   * /home instead of /learn/<agentId> (which would 404 for a non-live agent). */
  agentAvailable?: boolean;
}

type Action = 'pause' | 'resume' | 'cancel' | `change:${string}`;

function formatPrice(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
}

/** Upgrade (higher amountMinor), downgrade (lower) or switch (equal, or a different currency). */
function labelFor(offer: PlanOffer, current: PlanOffer | undefined): 'upgrade' | 'downgrade' | 'switch' {
  if (!current || current.currency !== offer.currency) return 'switch';
  if (offer.amountMinor > current.amountMinor) return 'upgrade';
  if (offer.amountMinor < current.amountMinor) return 'downgrade';
  return 'switch';
}

export function PlanView({ agentId, subscription, offers, agentAvailable = true }: PlanViewProps) {
  const t = useTranslations('plan');
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pausedByEdmate, setPausedByEdmate] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const exportJsonHref = `/api/me/export/${encodeURIComponent(agentId)}`;
  const exportPdfHref = `/api/me/export/${encodeURIComponent(agentId)}/notes`;

  async function send(body: Record<string, unknown>): Promise<boolean> {
    if (subscription === null) return false;
    try {
      const res = await fetch(`/api/subscriptions/${encodeURIComponent(subscription.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (body.action === 'resume' && res.status === 409) {
          setPausedByEdmate(true);
        } else {
          setError(t('actionError'));
        }
        return false;
      }
      // The body isn't read: the server page re-reads the subscription on the next navigation.
      return true;
    } catch {
      setError(t('actionError'));
      return false;
    }
  }

  async function onPause() {
    setBusy('pause');
    setError(null);
    try {
      const ok = await send({ agentId, action: 'pause' });
      if (ok) {
        if (agentAvailable) router.refresh();
        else router.push('/home');
      }
    } finally {
      setBusy(null);
    }
  }

  async function onResume() {
    setBusy('resume');
    setError(null);
    try {
      const ok = await send({ agentId, action: 'resume' });
      if (ok) router.push(`/learn/${encodeURIComponent(agentId)}`);
    } finally {
      setBusy(null);
    }
  }

  async function onCancel() {
    setBusy('cancel');
    setError(null);
    try {
      const ok = await send({ agentId, action: 'cancel' });
      if (ok) router.push(agentAvailable ? `/learn/${encodeURIComponent(agentId)}` : '/home');
    } finally {
      setBusy(null);
      setConfirmingCancel(false);
    }
  }

  async function onChange(packageId: string) {
    const key: Action = `change:${packageId}`;
    setBusy(key);
    setError(null);
    try {
      const ok = await send({ agentId, action: 'change', packageId });
      if (ok) router.push(`/learn/${encodeURIComponent(agentId)}`);
    } finally {
      setBusy(null);
    }
  }

  if (subscription === null) {
    return (
      <div>
        <p>{t('noSubscription')}</p>
        <p>
          <a href={`/packages/${encodeURIComponent(agentId)}`}>{t('choosePackageLink')}</a>
        </p>
      </div>
    );
  }

  const current = offers.find((o) => o.packageId === subscription.packageId);
  const others = offers.filter((o) => o.packageId !== subscription.packageId);
  const isPaused = subscription.status === 'paused';

  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <p>{t('noPaymentNotice')}</p>
      {agentAvailable === false ? <p>{t('agentUnavailable')}</p> : null}
      <section>
        <h2>{t('currentTitle')}</h2>
        <p>{current ? current.name : subscription.packageId}</p>
        <p>{t(`status.${subscription.status}`)}</p>
        <p>{t('periodEnd', { date: subscription.periodEnd })}</p>
      </section>

      {agentAvailable && others.length > 0 ? (
        <section>
          <h2>{t('otherPackagesTitle')}</h2>
          <ul>
            {others.map((offer) => {
              const label = labelFor(offer, current);
              const key: Action = `change:${offer.packageId}`;
              return (
                <li key={offer.packageId}>
                  <span>
                    {offer.name} - {formatPrice(offer.amountMinor, offer.currency)}
                  </span>
                  <button type="button" disabled={busy !== null} onClick={() => void onChange(offer.packageId)}>
                    {busy === key ? t('changing') : t(`actions.${label}`)}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <h2>{t('manageTitle')}</h2>
        {isPaused ? (
          pausedByEdmate ? (
            <p>{t('pausedByEdmate')}</p>
          ) : agentAvailable ? (
            <button type="button" disabled={busy !== null} onClick={() => void onResume()}>
              {busy === 'resume' ? t('resuming') : t('resumeButton')}
            </button>
          ) : null
        ) : (
          <button type="button" disabled={busy !== null} onClick={() => void onPause()}>
            {busy === 'pause' ? t('pausing') : t('pauseButton')}
          </button>
        )}
      </section>

      <section>
        <h2>{t('cancelTitle')}</h2>
        {confirmingCancel ? (
          <div>
            <p>{t('cancelConfirmIntro')}</p>
            <p>
              <a href={exportJsonHref} download>
                {t('exportJsonLink')}
              </a>
            </p>
            <p>
              <a href={exportPdfHref} download>
                {t('exportPdfLink')}
              </a>
            </p>
            <button type="button" disabled={busy !== null} onClick={() => void onCancel()}>
              {busy === 'cancel' ? t('cancelling') : t('cancelConfirmButton')}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => setConfirmingCancel(false)}>
              {t('cancelKeepButton')}
            </button>
          </div>
        ) : (
          <button type="button" disabled={busy !== null} onClick={() => setConfirmingCancel(true)}>
            {t('cancelButton')}
          </button>
        )}
      </section>
    </div>
  );
}
