// Task 9.4 Phase C: the message box. Enter sends, Shift+Enter is a new line; blank text is never
// sent; disabled while a reply streams.
import { LIMITS } from '@edmate/contracts';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';

export interface ComposerProps {
  disabled: boolean;
  onSend: (text: string) => void;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const t = useTranslations('chat');
  const id = useId();
  const [text, setText] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (disabled || trimmed === '') return;
    onSend(trimmed);
    setText('');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      <label htmlFor={id}>{t('composerLabel')}</label>
      <textarea
        id={id}
        rows={3}
        value={text}
        maxLength={LIMITS.turnTextMaxLength}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" disabled={disabled}>
        {t('send')}
      </button>
    </form>
  );
}
