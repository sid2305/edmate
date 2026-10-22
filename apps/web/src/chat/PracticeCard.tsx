// Task 9.5a: the practice skill's card. The payload shape mirrors `practice.next_item`'s output
// (`packages/harness/src/tools/practice.ts`) -- `{ id, kind, level, prompt, options? }` -- as a
// local type: `apps/web` never imports `packages/harness`'s internal tool types. The answer key
// never reaches this component (ADR-0010); it only collects the student's typed text and hands it
// to `onAnswer`.
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';

export interface PracticeCardData {
  id: string;
  kind: 'numeric' | 'mcq' | 'short' | 'code_output';
  level: 1 | 2 | 3;
  prompt: string;
  options?: readonly string[];
}

export interface PracticeCardProps {
  item: PracticeCardData;
  /** Called with the trimmed answer text when the student submits. */
  onAnswer: (text: string) => void;
  /** Disables the answer form while a reply streams. */
  disabled: boolean;
}

/** Only these kinds have a typed-answer form today; the demo bank never serves the others. */
const ANSWERABLE = new Set(['numeric', 'short']);

export function PracticeCard({ item, onAnswer, disabled }: PracticeCardProps) {
  const t = useTranslations('chat');
  const id = useId();
  const [text, setText] = useState('');
  const answerable = ANSWERABLE.has(item.kind);

  function submit() {
    const trimmed = text.trim();
    if (disabled || trimmed === '') return;
    onAnswer(trimmed);
    setText('');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  return (
    <div className="skill-card practice-card">
      <strong>{t('skills.practice')}</strong>
      <p>{item.prompt}</p>
      {item.options === undefined ? null : (
        <ul className="practice-options">
          {item.options.map((opt, i) => (
            <li key={i}>{opt}</li>
          ))}
        </ul>
      )}
      {answerable ? (
        <form className="practice-answer" onSubmit={onSubmit}>
          <label htmlFor={id}>{t('practice.answerLabel')}</label>
          <input
            id={id}
            type="text"
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" disabled={disabled || text.trim() === ''}>
            {t('practice.submit')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
