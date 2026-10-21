// @vitest-environment jsdom
// Task 9.4 Phase C: the small chat parts -- HintButton, SourcesList, LockedNotice,
// TeacherQuestionNotice, SkillCard and Composer.
import { fireEvent, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderIntl, withIntl } from '../../test/intl';
import { Composer } from './Composer';
import { HintButton } from './HintButton';
import { LockedNotice } from './LockedNotice';
import { SkillCard } from './SkillCard';
import { SourcesList } from './SourcesList';
import { TeacherQuestionNotice } from './TeacherQuestionNotice';

beforeAll(() => {
  expect.extend(toHaveNoViolations);
});

describe('HintButton', () => {
  it.each([
    [1, 'Hint'],
    [2, 'Hint'],
    [3, 'Worked example'],
    [4, 'Full solution'],
  ])('rung %i shows "%s"', (rung, label) => {
    renderIntl(<HintButton rung={rung} disabled={false} onHint={() => {}} />);
    expect(screen.getByText(`Last help: ${label}`)).toBeInTheDocument();
  });

  it.each([null, 0, 5])('rung %s shows no label', (rung) => {
    renderIntl(<HintButton rung={rung} disabled={false} onHint={() => {}} />);
    expect(screen.queryByText(/Last help/)).toBeNull();
  });

  it('calls onHint, and is disabled while a reply streams', async () => {
    const onHint = vi.fn();
    const { container, rerender } = renderIntl(<HintButton rung={3} disabled={false} onHint={onHint} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get a hint' }));
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
    rerender(withIntl(<HintButton rung={3} disabled onHint={onHint} />));
    expect(screen.getByRole('button', { name: 'Get a hint' })).toBeDisabled();
  });
});

describe('SourcesList', () => {
  it('shows each title and locator as text, never a link', async () => {
    const { container } = renderIntl(
      <SourcesList
        items={[
          { title: 'Fractions <b>1</b>', locator: 'p. 4', kind: 'material' },
          { title: 'javascript:alert(1)', locator: 'slide 2', kind: 'transcript' },
        ]}
      />,
    );
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText(/Fractions <b>1<\/b>/)).toBeInTheDocument();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders nothing for no sources', () => {
    const { container } = renderIntl(<SourcesList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('LockedNotice', () => {
  it('names the package when known', () => {
    renderIntl(<LockedNotice packageName="Algebra Plus" />);
    expect(screen.getByText('This is part of Algebra Plus.')).toBeInTheDocument();
  });

  it('uses the generic text without a name', async () => {
    const { container } = renderIntl(<LockedNotice />);
    expect(screen.getByText('This is not part of your package.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('TeacherQuestionNotice and SkillCard', () => {
  it('says the question went to the teacher', () => {
    renderIntl(<TeacherQuestionNotice />);
    expect(screen.getByText(/Sent to your teacher/)).toBeInTheDocument();
  });

  it('a skill card shows the skill name and "Coming soon", never the payload', async () => {
    const { container } = renderIntl(<SkillCard skill="practice" />);
    expect(screen.getByText('Practice')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Composer', () => {
  it('Enter sends the trimmed text and clears; Shift+Enter does not send', () => {
    const onSend = vi.fn();
    renderIntl(<Composer disabled={false} onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Your message' });
    fireEvent.change(box, { target: { value: '  What is 1/2?  ' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('What is 1/2?');
    expect(box).toHaveValue('');
  });

  it('the Send button sends; blank text is never sent', () => {
    const onSend = vi.fn();
    renderIntl(<Composer disabled={false} onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Your message' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  it('is disabled while a reply streams: Enter does nothing', async () => {
    const onSend = vi.fn();
    const { container } = renderIntl(<Composer disabled onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Your message' });
    expect(box).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'hi' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });
});
