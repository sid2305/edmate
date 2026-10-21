'use client';
// Task 9.3 Phase B: one card per live package, with a Start button that posts to
// `/api/subscriptions` and, on success, goes to `/learn/[agentId]` -- the package unlocks on the
// next message there. No payment screen anywhere (CLAUDE.md: a paid package starts as an active
// subscription with no payment until M10).
import type { LivePackage } from '@edmate/db';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface PackageCompareProps {
  agentId: string;
  packages: readonly LivePackage[];
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
        {packages.map(({ config }) => (
          <li key={config.id}>
            <h2>{config.name}</h2>
            <p>{formatPrice(config.pricePerMonth.amountMinor, config.pricePerMonth.currency)}</p>
            {config.trialDays !== undefined && config.trialDays > 0 ? (
              <p>{t('trialDays', { days: config.trialDays })}</p>
            ) : null}
            <p>{t('dailyMessageLimit', { count: config.dailyMessageLimit })}</p>
            <p>{t('liveClassesPerMonth', { count: config.liveClassesPerMonth })}</p>
            <ul>
              {config.skills.map((skill) => (
                <li key={skill}>{t(`skills.${skill}`)}</li>
              ))}
            </ul>
            <button
              type="button"
              disabled={startingId !== null}
              onClick={() => void onStart(config.id)}
            >
              {startingId === config.id ? t('starting') : t('startButton')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
