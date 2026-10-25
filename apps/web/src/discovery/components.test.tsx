// @vitest-environment jsdom
// Task 9.2 Phase C. Written and red before PackageList.tsx / ScorecardPanel.tsx exist (TDD).
// Real en.json strings through next-intl's own translator; no database, no model.
import type { PackageOffer } from '@edmate/db';
import { render, screen, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { createTranslator } from 'next-intl';
import { beforeAll, describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import { PackageList } from './PackageList';
import { ScorecardPanel } from './ScorecardPanel';
import type { PublicScorecard } from './scorecard';
import type { Translate } from './format';

const translator = createTranslator({ locale: 'en', messages, namespace: 'teacherPage' });
// Real next-intl translator, typed only loosely against `messages`' inferred shape; cast to the
// app's `Translate` (the type `getTranslations('teacherPage')` actually returns) for the test.
const t = translator as unknown as Translate;

const PAID: PackageOffer = {
  packageId: 'pkg-paid',
  name: 'Exam prep',
  pricePerMonth: { amountMinor: 1999, currency: 'USD' },
  trialDays: 7,
  dailyMessageLimit: 50,
  liveClassesPerMonth: 2,
  skills: ['explain', 'mock_interview'],
};

const FREE: PackageOffer = {
  packageId: 'pkg-free',
  name: 'Starter',
  pricePerMonth: { amountMinor: 0, currency: 'USD' },
  trialDays: 0,
  dailyMessageLimit: 10,
  liveClassesPerMonth: 0,
  skills: ['explain'],
};

const SCORECARD: PublicScorecard = {
  categories: [
    { key: 'hints_before_answers', measured: true, percent: 99, pass: true },
    { key: 'locked_content', measured: false, percent: null, pass: false },
    { key: 'accuracy', measured: true, percent: 80, pass: false },
  ],
};

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('PackageList', () => {
  it('renders the public offer fields of each package', () => {
    render(<PackageList packages={[PAID, FREE]} t={t} />);
    const paid = screen.getByRole('heading', { name: 'Exam prep' }).closest('li') as HTMLElement;
    expect(within(paid).getByText('$19.99 a month')).toBeInTheDocument();
    expect(within(paid).getByText('7 day free trial')).toBeInTheDocument();
    expect(within(paid).getByText('50 messages a day')).toBeInTheDocument();
    expect(within(paid).getByText('2 live classes a month')).toBeInTheDocument();
    expect(within(paid).getByText('Explain')).toBeInTheDocument();
    expect(within(paid).getByText('Mock interview')).toBeInTheDocument();
  });

  it('shows "Free" at a zero price and no trial line when trialDays is 0', () => {
    render(<PackageList packages={[FREE]} t={t} />);
    const free = screen.getByRole('heading', { name: 'Starter' }).closest('li') as HTMLElement;
    expect(within(free).getByText('Free')).toBeInTheDocument();
    expect(within(free).queryByText(/free trial/)).toBeNull();
  });

  it('renders nothing but the offer: no internal ids or extra fields leak into the markup', () => {
    const leaky = { ...PAID, packageVersionId: 'pv-secret', teacherId: 'teacher-secret' };
    const { container } = render(<PackageList packages={[leaky]} t={t} />);
    expect(container.innerHTML).not.toContain('pv-secret');
    expect(container.innerHTML).not.toContain('teacher-secret');
    expect(container.innerHTML).not.toContain('pkg-paid');
  });

  it('shows an empty state for no packages', () => {
    render(<PackageList packages={[]} t={t} />);
    expect(screen.getByText('No packages are available yet.')).toBeInTheDocument();
  });

  it('renders teacher-written names as plain text, never markup', () => {
    const { container } = render(
      <PackageList packages={[{ ...PAID, name: '<img src=x onerror=alert(1)>' }]} t={t} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<PackageList packages={[PAID, FREE]} t={t} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ScorecardPanel', () => {
  it('shows the honest "no published scorecard yet" state for null, never zeros', () => {
    const { container } = render(<ScorecardPanel scorecard={null} t={t} />);
    expect(screen.getByRole('heading', { name: 'Teaching scorecard' })).toBeInTheDocument();
    expect(screen.getByText('No published scorecard yet.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('renders the three categories with whole percents and "not measured yet"', () => {
    render(<ScorecardPanel scorecard={SCORECARD} t={t} />);
    expect(screen.getByText('Hints before answers')).toBeInTheDocument();
    expect(screen.getByText('99% of checks passed')).toBeInTheDocument();
    expect(screen.getByText('Locked content')).toBeInTheDocument();
    expect(screen.getByText('Not measured yet')).toBeInTheDocument();
    expect(screen.getByText('Accuracy')).toBeInTheDocument();
    expect(screen.getByText('80% of checks passed')).toBeInTheDocument();
    expect(screen.getByText('Not passed')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('shows 99, not 100, for a stored 99.6 (floored by toPublicScorecard)', async () => {
    const { toPublicScorecard } = await import('./scorecard');
    const category = (key: string, percent: number) => ({
      key,
      measured: true,
      total: 1000,
      passed: 996,
      percent,
      pass: true,
      byOrigin: [],
    });
    const card = toPublicScorecard({
      pass: true,
      changes: [],
      categories: [
        category('hints_before_answers', 99.6),
        category('locked_content', 100),
        category('accuracy', 100),
      ],
    });
    render(<ScorecardPanel scorecard={card} t={t} />);
    expect(screen.getByText('99% of checks passed')).toBeInTheDocument();
    expect(screen.getAllByText('100% of checks passed')).toHaveLength(2);
  });

  it('shows "not measured yet" for a measured category with no cases (null percent), not 0%', () => {
    render(
      <ScorecardPanel
        scorecard={{
          categories: [
            { key: 'hints_before_answers', measured: true, percent: null, pass: true },
            { key: 'locked_content', measured: true, percent: 100, pass: true },
            { key: 'accuracy', measured: true, percent: 100, pass: true },
          ],
        }}
        t={t}
      />,
    );
    expect(screen.getByText('Not measured yet')).toBeInTheDocument();
    expect(screen.queryByText(/^0%/)).toBeNull();
  });

  it('has no axe violations in either state', async () => {
    const empty = render(<ScorecardPanel scorecard={null} t={t} />);
    expect(await axe(empty.container)).toHaveNoViolations();
    empty.unmount();
    const full = render(<ScorecardPanel scorecard={SCORECARD} t={t} />);
    expect(await axe(full.container)).toHaveNoViolations();
  });
});
