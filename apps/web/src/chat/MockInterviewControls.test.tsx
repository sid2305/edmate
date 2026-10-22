// @vitest-environment jsdom
// Task 9.5b: the mock-interview Pause/Stop controls.
import { fireEvent, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { MockInterviewControls } from './MockInterviewControls';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('MockInterviewControls', () => {
  it('calls onPause and onStop when clicked', async () => {
    const onPause = vi.fn();
    const onStop = vi.fn();
    const view = renderIntl(<MockInterviewControls disabled={false} onPause={onPause} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(await axe(view.container)).toHaveNoViolations();
  });

  it('disables both buttons while a reply streams', () => {
    renderIntl(<MockInterviewControls disabled={true} onPause={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });
});
