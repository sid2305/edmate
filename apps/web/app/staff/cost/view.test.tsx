// @vitest-environment jsdom
// Task 13.5 Phase B: the staff cost dashboard. A malformed `initialRows` shows the fallback (not
// a crash); Reload and Apply (period change) each re-fetch and reset their busy flag on success,
// error reply and thrown call; a divide-by-zero case (no live version/price, or zero active
// students) renders `—`, never `NaN`/`Infinity`; a row over the 25% threshold is flagged.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test/intl';
import type { CostRowView } from './client';
import { StaffCostView } from './view';

function row(o: Partial<CostRowView> & { packageId: string }): CostRowView {
  return {
    teacherId: 'tch_a',
    packageName: 'Algebra',
    activeStudents: 4,
    costMicroUsd: 500_000,
    calls: 10,
    unknown: 0,
    unpriced: 0,
    costPerTurnMicroUsd: 100_000,
    costPerActiveStudentMicroUsd: 125_000,
    pricePerMonth: { amountMinor: 2000, currency: 'USD' },
    costAsPctOfPrice: 2.5,
    ...o,
  };
}

const SINCE = '2026-09-25T00:00:00.000Z';
const UNTIL = '2026-10-25T00:00:00.000Z';

describe('StaffCostView', () => {
  it('renders the table for good initial rows', () => {
    renderIntl(<StaffCostView initialRows={[row({ packageId: 'pkg_1' })]} initialSince={SINCE} initialUntil={UNTIL} />);
    expect(screen.getByRole('table', { name: 'Cost by package' })).toBeInTheDocument();
    expect(screen.getByText('Algebra')).toBeInTheDocument();
    expect(screen.getByText('0.50')).toBeInTheDocument();
    expect(screen.getByText(/2\.5%/)).toBeInTheDocument();
  });

  it('a malformed initialRows shows the fallback (loadFailed), not a crash', () => {
    renderIntl(<StaffCostView initialRows={{ not: 'an array' }} initialSince={SINCE} initialUntil={UNTIL} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the cost dashboard');
  });

  it('no rows at all is the empty message', () => {
    renderIntl(<StaffCostView initialRows={[]} initialSince={SINCE} initialUntil={UNTIL} />);
    expect(screen.getByText('No usage in this period.')).toBeInTheDocument();
  });

  it('zero active students, no live version/price -- renders — not NaN/Infinity', () => {
    const r = row({
      packageId: 'pkg_2',
      activeStudents: 0,
      costMicroUsd: 0,
      costPerTurnMicroUsd: null,
      costPerActiveStudentMicroUsd: null,
      pricePerMonth: null,
      costAsPctOfPrice: null,
    });
    renderIntl(<StaffCostView initialRows={[r]} initialSince={SINCE} initialUntil={UNTIL} />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });

  it('a row at or above 25% of price is flagged', () => {
    const r = row({ packageId: 'pkg_3', costAsPctOfPrice: 30 });
    renderIntl(<StaffCostView initialRows={[r]} initialSince={SINCE} initialUntil={UNTIL} />);
    expect(screen.getByText(/Over 25% of price/)).toBeInTheDocument();
  });

  it('Reload re-fetches and resets the busy flag on success', async () => {
    const loadCost = vi.fn(async () => ({ ok: true as const, rows: [row({ packageId: 'pkg_new' })] }));
    renderIntl(
      <StaffCostView initialRows={[]} initialSince={SINCE} initialUntil={UNTIL} loadCost={loadCost} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByText('Algebra')).toBeInTheDocument());
    expect(loadCost).toHaveBeenCalledWith({});
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeDisabled();
  });

  it('Reload a repository failure shows the error and resets the busy flag', async () => {
    const loadCost = vi.fn(async () => ({ ok: false as const, code: 'provider_error' as const }));
    renderIntl(<StaffCostView initialRows={[]} initialSince={SINCE} initialUntil={UNTIL} loadCost={loadCost} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeDisabled();
  });

  it('Reload a thrown call shows a generic error and resets the busy flag', async () => {
    const loadCost = vi.fn(async () => {
      throw new TypeError('boom');
    });
    renderIntl(<StaffCostView initialRows={[]} initialSince={SINCE} initialUntil={UNTIL} loadCost={loadCost} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'));
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeDisabled();
  });

  it('Apply sends the picked since/until as full-day ISO instants', async () => {
    const loadCost = vi.fn(async () => ({ ok: true as const, rows: [] }));
    renderIntl(<StaffCostView initialRows={[]} initialSince={SINCE} initialUntil={UNTIL} loadCost={loadCost} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(loadCost).toHaveBeenCalledWith({
        since: '2026-10-01T00:00:00.000Z',
        until: '2026-10-20T00:00:00.000Z',
      }),
    );
    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled();
  });

  it('a failed Apply keeps the typed dates and the last good rows, and resets busy', async () => {
    const loadCost = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, code: 'validation' as const });
    renderIntl(
      <StaffCostView
        initialRows={[row({ packageId: 'pkg_1' })]}
        initialSince={SINCE}
        initialUntil={UNTIL}
        loadCost={loadCost}
      />,
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Check the dates'));
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-01');
    expect(screen.getByText('Algebra')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled();
  });
});
