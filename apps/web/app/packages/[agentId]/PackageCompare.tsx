'use client';
// Task 9.3 Phase B: one card per live package, with a Start button that posts to
// `/api/subscriptions` and, on success, goes to `/learn/[agentId]` -- the package unlocks on the
// next message there. No payment screen anywhere (CLAUDE.md: a paid package starts as an active
// subscription with no payment until M10).
import type { PackageOffer } from '@edmate/db';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface PackageCompareProps {
  agentId: string;
  packages: readonly PackageOffer[];
}

interface ErrorBody {
  error?: { message?: string };
}

/** `pricePerMonth` formatted currency-neutral (no hardcoded `$`; the pilot is US-only for now). */
function formatPrice(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
}

export function PackageCompare({ agentId, packages }: PackageCompareProps) {
  const t = useTranslations('packages');
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onStart(packageId: string) {
    setStartingId(packageId);
    setError(null);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, packageId }),
      });
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as ErrorBody;
        setError(parsed.error?.message ?? t('errors.generic'));
        setStartingId(null);
        return;
      }
      window.location.href = `/learn/${encodeURIComponent(agentId)}`;
    } catch {
      setError(t('errors.generic'));
      setStartingId(null);
    }
  }

  if (packages.length === 0) {
    return <p>{t('empty')}</p>;
  }

  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <ul className="package-compare">
        {packages.map((offer) => (
          <li key={offer.packageId}>
            <h2>{offer.name}</h2>
            <p>{formatPrice(offer.pricePerMonth.amountMinor, offer.pricePerMonth.currency)}</p>
            {offer.trialDays > 0 ? (
              <p>{t('trialDays', { days: offer.trialDays })}</p>
            ) : null}
            <p>{t('dailyMessageLimit', { count: offer.dailyMessageLimit })}</p>
            <p>{t('liveClassesPerMonth', { count: offer.liveClassesPerMonth })}</p>
            <ul>
              {offer.skills.map((skill) => (
                <li key={skill}>{t(`skills.${skill}`)}</li>
              ))}
            </ul>
            <button
              type="button"
              disabled={startingId !== null}
              onClick={() => void onStart(offer.packageId)}
            >
              {startingId === offer.packageId ? t('starting') : t('startButton')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
