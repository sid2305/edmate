'use client';
// Task 13.5 Phase B: the staff cost dashboard. The server's initial rows are still checked with
// zod (a wrong shape or a failed server read is the fallback view, recoverable with Reload); a
// period change (`since`/`until`) re-fetches via `client.ts`. No polling -- cost figures change
// slowly (the plan leaves this to the builder) -- so there is no stale-poll race to guard
// against; the only async actions are a manual Reload and Apply, one at a time, and the busy flag
// resets in `finally` on every path (lessons: "UI state and server replies: trust neither, reset
// everything"), including a failed period change (the fields keep the user's typed values; the
// table keeps the last good rows).
import type { ErrorCode } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CostRowListSchema, loadCost as defaultLoadCost, type CostRowView } from './client';

/** Cost as this fraction (or more) of monthly price is flagged (PRD's cost north-star, line 308). */
const FLAG_PCT = 25;

export interface StaffCostViewProps {
  /** The server's initial read; `null` when that read failed. Checked here, not trusted. */
  initialRows: unknown;
  initialSince: string;
  initialUntil: string;
  /** Tests inject a fake; defaults to the real `/api/staff/cost` call. */
  loadCost?: typeof defaultLoadCost;
}

type Busy = 'reload' | 'apply' | null;
type ErrorKey = 'forbidden' | 'validation' | 'generic' | 'loadFailed';

function errorKey(code: ErrorCode): ErrorKey {
  return code === 'forbidden' || code === 'validation' ? code : 'generic';
}

function parseRows(initial: unknown): CostRowView[] | null {
  const parsed = CostRowListSchema.safeParse(initial);
  return parsed.success ? parsed.data : null;
}

function usd(micro: number | null): string {
  return micro === null ? '—' : (micro / 1_000_000).toFixed(2);
}

function money(m: CostRowView['pricePerMonth']): string {
  return m === null ? '—' : (m.amountMinor / 100).toFixed(2) + ' ' + m.currency;
}

function pct(p: number | null): string {
  return p === null ? '—' : `${p.toFixed(1)}%`;
}

/** `yyyy-mm-dd` for a date input, from an ISO instant (UTC, matching the server's own window). */
function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export function StaffCostView({
  initialRows,
  initialSince,
  initialUntil,
  loadCost = defaultLoadCost,
}: StaffCostViewProps) {
  const t = useTranslations('staffCost');
  const [rows, setRows] = useState<CostRowView[] | null>(() => parseRows(initialRows));
  const [since, setSince] = useState(toDateInput(initialSince));
  const [until, setUntil] = useState(toDateInput(initialUntil));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ErrorKey | null>(() =>
    parseRows(initialRows) === null ? 'loadFailed' : null,
  );

  const refresh = async (period?: { since: string; until: string }) => {
    const result = await loadCost(
      period ? { since: `${period.since}T00:00:00.000Z`, until: `${period.until}T00:00:00.000Z` } : {},
    );
    if (!result.ok) {
      setError(errorKey(result.code));
      return;
    }
    setRows(result.rows);
    setError(null);
  };

  const onReload = async () => {
    setBusy('reload');
    try {
      await refresh();
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  const onApply = async () => {
    setBusy('apply');
    try {
      await refresh({ since, until });
    } catch {
      setError('generic');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="staff-cost">
      <p>{t('intro')}</p>
      {error ? (
        <p role="alert" className="staff-cost-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onApply();
        }}
      >
        <label>
          {t('sinceLabel')}{' '}
          <input
            type="date"
            value={since}
            disabled={busy !== null}
            onChange={(e) => setSince(e.target.value)}
          />
        </label>{' '}
        <label>
          {t('untilLabel')}{' '}
          <input
            type="date"
            value={until}
            disabled={busy !== null}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>{' '}
        <button type="submit" disabled={busy !== null}>
          {busy === 'apply' ? t('applying') : t('apply')}
        </button>{' '}
        <button type="button" disabled={busy !== null} onClick={() => void onReload()}>
          {busy === 'reload' ? t('reloading') : t('reload')}
        </button>
      </form>
      {rows === null ? null : rows.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <table aria-label={t('tableLabel')}>
          <thead>
            <tr>
              <th>{t('columnTeacher')}</th>
              <th>{t('columnPackage')}</th>
              <th>{t('columnActiveStudents')}</th>
              <th>{t('columnCost')}</th>
              <th>{t('columnCostPerTurn')}</th>
              <th>{t('columnCostPerStudent')}</th>
              <th>{t('columnPrice')}</th>
              <th>{t('columnPctOfPrice')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const flagged = row.costAsPctOfPrice !== null && row.costAsPctOfPrice >= FLAG_PCT;
              return (
                <tr key={`${row.teacherId}:${row.packageId}`}>
                  <td>{row.teacherId}</td>
                  <td>{row.packageName}</td>
                  <td>{row.activeStudents}</td>
                  <td>{usd(row.costMicroUsd)}</td>
                  <td>{usd(row.costPerTurnMicroUsd)}</td>
                  <td>{usd(row.costPerActiveStudentMicroUsd)}</td>
                  <td>{money(row.pricePerMonth)}</td>
                  <td className={flagged ? 'staff-cost-flagged' : undefined}>
                    {pct(row.costAsPctOfPrice)}
                    {flagged ? ` (${t('overThreshold')})` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
