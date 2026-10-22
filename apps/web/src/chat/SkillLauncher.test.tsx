// @vitest-environment jsdom
// Task 9.5a: the skill launcher's Practice button.
import { fireEvent, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test/intl';
import { SkillLauncher } from './SkillLauncher';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('SkillLauncher', () => {
  it('calls onStartPractice when the Practice button is clicked', async () => {
    const onStartPractice = vi.fn();
    const view = renderIntl(<SkillLauncher disabled={false} onStartPractice={onStartPractice} />);
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(onStartPractice).toHaveBeenCalledTimes(1);
    expect(await axe(view.container)).toHaveNoViolations();
  });

  it('disables the button while a reply streams', () => {
    renderIntl(<SkillLauncher disabled={true} onStartPractice={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Practice' })).toBeDisabled();
  });
});
