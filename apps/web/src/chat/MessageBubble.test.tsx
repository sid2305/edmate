// @vitest-environment jsdom
// Task 9.4 Phase C: one message. Provisional text is muted, busy and labelled "Still checking";
// a corrected reply shows "Updated"; a teacher message is labelled; withheld text stays literal.
import { screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderIntl } from '../../test/intl';
import { MessageBubble } from './MessageBubble';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('MessageBubble', () => {
  it('a provisional reply is busy, muted and labelled "Still checking"', async () => {
    const { container } = renderIntl(<MessageBubble role="agent" text="Half a" provisional />);
    const bubble = container.querySelector('.bubble');
    expect(bubble).toHaveAttribute('aria-busy', 'true');
    expect(bubble).toHaveClass('bubble-provisional');
    expect(screen.getByText('Still checking…')).toBeInTheDocument();
    expect(screen.getByText('Half a')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a final reply has no busy state and no label', () => {
    const { container } = renderIntl(<MessageBubble role="agent" text="A half." />);
    const bubble = container.querySelector('.bubble');
    expect(bubble).not.toHaveAttribute('aria-busy');
    expect(bubble).not.toHaveClass('bubble-provisional');
    expect(screen.queryByText('Still checking…')).toBeNull();
    expect(screen.queryByText('Updated')).toBeNull();
    expect(screen.getByText('Tutor')).toBeInTheDocument();
  });

  it('a corrected reply shows the "Updated" marker with its explanation', async () => {
    const { container } = renderIntl(<MessageBubble role="agent" text="Fixed." replaced />);
    expect(screen.getByText('Updated')).toHaveAttribute('title', 'This reply was corrected');
    expect(screen.getByText('This reply was corrected')).toHaveClass('visually-hidden');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a teacher message is labelled "Your teacher" with its own style', () => {
    const { container } = renderIntl(<MessageBubble role="teacher" text="See you Friday." />);
    expect(screen.getByText('Your teacher')).toBeInTheDocument();
    expect(container.querySelector('.bubble')).toHaveClass('bubble-teacher');
  });

  it('a student message is plain text labelled "You"', () => {
    renderIntl(<MessageBubble role="student" text={'<b>hi</b>\nthere'} />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText(/<b>hi<\/b>/)).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('withheld history text renders literally', () => {
    renderIntl(<MessageBubble role="agent" text="[message withheld: guard_blocked]" />);
    expect(screen.getByText('[message withheld: guard_blocked]')).toBeInTheDocument();
  });
});
