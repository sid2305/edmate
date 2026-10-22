'use client';
// Task 11.2b: a student feeds the teacher's pre-class question queue, one small form per
// listed, entitled upcoming class (`/home`'s own live-classes block, 11.1c). Every call settles
// to a result: a bad reply never leaves the button stuck disabled (lessons: "a studio page that
// trusts a 200 response gets stuck" -- the body read is wrapped in try/catch inside
// `submitClassQuestion`, and the busy flag always clears in `finally`).
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { submitClassQuestion } from '../../src/liveClasses/submitClassQuestionAction';

export interface AskQuestionFormProps {
  liveClassId: string;
  /** Tests inject a fake; defaults to Phase B's route. */
  submitClassQuestion?: typeof submitClassQuestion;
}

export function AskQuestionForm({
  liveClassId,
  submitClassQuestion: doSubmit = submitClassQuestion,
}: AskQuestionFormProps) {
  const t = useTranslations('home');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);
  const inputId = `ask-question-${liveClassId}`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      setError(true);
      return;
    }
    setError(false);
    setSent(false);
    setBusy(true);
    try {
      const result = await doSubmit(liveClassId, trimmed);
      if (!result.ok) {
        setError(true);
        return;
      }
      setText('');
      setSent(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="home-ask-question">
      <label htmlFor={inputId}>{t('liveClasses.askLabel')}</label>
      <input id={inputId} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" disabled={busy}>
        {busy ? t('liveClasses.asking') : t('liveClasses.askButton')}
      </button>
      {error && (
        <p role="alert" className="home-ask-question-error">
          {t('liveClasses.askError')}
        </p>
      )}
      {sent && (
        <p role="status" className="home-ask-question-sent">
          {t('liveClasses.askSent')}
        </p>
      )}
    </form>
  );
}
