// @vitest-environment jsdom
// Task 9.6 Phase B: the progress view (module/topic titles, counts, next steps, both export
// links) and its accessibility.
import { axe, toHaveNoViolations } from 'jest-axe';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderIntl } from '../../test/intl';
import type { Progress } from './progress';
import { ProgressView } from './ProgressView';

expect.extend(toHaveNoViolations);

const PROGRESS: Progress = {
  modules: [
    {
      id: 'mod_1',
      title: 'Fractions',
      topics: [
        { id: 'top_1', title: 'Adding fractions', state: 'mastered' },
        { id: 'top_2', title: 'Subtracting fractions', state: 'practising' },
      ],
    },
  ],
  counts: { topicsCovered: 2, topicsMastered: 1 },
  nextSteps: [{ id: 'top_2', title: 'Subtracting fractions', moduleId: 'mod_1' }],
  other: [],
};

describe('ProgressView', () => {
  it('renders module and topic titles, counts and next steps', () => {
    renderIntl(<ProgressView agentId="agt_1" progress={PROGRESS} />);
    expect(screen.getByText('Fractions')).toBeInTheDocument();
    expect(screen.getByText(/Adding fractions:/)).toHaveTextContent('Adding fractions: mastered');
    expect(screen.getByText(/Subtracting fractions:/)).toHaveTextContent('Subtracting fractions: practising');
    expect(screen.getByText((_, el) => el?.textContent === '2 topics covered · 1 mastered')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeInTheDocument();
  });

  it('links to both exports, with download', () => {
    renderIntl(<ProgressView agentId="agt_1" progress={PROGRESS} />);
    const json = screen.getByText('Download the complete JSON export') as HTMLAnchorElement;
    const pdf = screen.getByText('Download your notes (PDF)') as HTMLAnchorElement;
    expect(json.getAttribute('href')).toBe('/api/me/export/agt_1');
    expect(json.hasAttribute('download')).toBe(true);
    expect(pdf.getAttribute('href')).toBe('/api/me/export/agt_1/notes');
    expect(pdf.hasAttribute('download')).toBe(true);
  });

  it('shows the empty state with no outline', () => {
    const empty: Progress = { modules: [], counts: { topicsCovered: 0, topicsMastered: 0 }, nextSteps: [], other: [] };
    renderIntl(<ProgressView agentId="agt_1" progress={empty} />);
    expect(screen.getByText('Nothing to show yet -- keep learning and it will show up here.')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderIntl(<ProgressView agentId="agt_1" progress={PROGRESS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
