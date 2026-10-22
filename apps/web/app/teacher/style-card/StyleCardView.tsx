'use client';
// Task 8.4b: the style interview and the style card editor. "Generate draft" fills the editable
// text and tags from the interview; "Save" stores whatever is currently in the editable fields,
// so a teacher can also fix the current card directly with no interview at all. Every string is
// from messages/en.json.
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  draftStyleCardApi,
  saveStyleCard,
  type ApiResult,
  type StyleCardView as StyleCardRow,
} from '../../../src/studio/styleCardClient';
import { STYLE_CARD_QUESTIONS, type StyleCardQuestionKey } from '../../../src/studio/styleCardQuestions';

const ERROR_KEYS = [
  'validation',
  'input_too_large',
  'forbidden',
  'not_found',
  'unauthorized',
  'provider_error',
] as const;
type ErrorKey = (typeof ERROR_KEYS)[number];

function errorKey(result: Extract<ApiResult<unknown>, { ok: false }>): ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(result.code)
    ? (result.code as ErrorKey)
    : 'provider_error';
}

/** Splits a comma-separated field into a trimmed, non-empty, de-duplicated list. */
function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((s) => s.trim()).filter((s) => s.length > 0))];
}

/** Splits a newline-separated field into a trimmed, non-empty list. */
function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const emptyAnswers = (): Record<StyleCardQuestionKey, string> =>
  Object.fromEntries(STYLE_CARD_QUESTIONS.map((k) => [k, ''])) as Record<
    StyleCardQuestionKey,
    string
  >;

export interface StyleCardViewProps {
  /** The teacher's current saved card, or `null` before a first save. */
  initialCard: StyleCardRow | null;
}

export function StyleCardView({ initialCard }: StyleCardViewProps) {
  const t = useTranslations('styleCard');
  const [card, setCard] = useState(initialCard);
  const [answers, setAnswers] = useState(emptyAnswers);
  const [mistakesText, setMistakesText] = useState('');
  const [samples, setSamples] = useState(['', '', '']);
  const [text, setText] = useState(initialCard?.text ?? '');
  const [tagsText, setTagsText] = useState((initialCard?.mistakeTags ?? []).join(', '));
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const setAnswer = (key: StyleCardQuestionKey, value: string) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));
  const setSample = (i: number, value: string) =>
    setSamples((prev) => prev.map((s, j) => (j === i ? value : s)));

  async function onDraft(e: FormEvent) {
    e.preventDefault();
    setDrafting(true);
    setError(null);
    try {
      const result = await draftStyleCardApi({
        answers,
        sampleExplanations: samples,
        mistakeCandidates: parseLines(mistakesText),
      });
      if (!result.ok) return setError(errorKey(result));
      setText(result.value.text);
      setTagsText(result.value.mistakeTags.join(', '));
    } catch {
      setError('provider_error');
    } finally {
      setDrafting(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await saveStyleCard({ text, mistakeTags: parseTags(tagsText) });
      if (!result.ok) return setError(errorKey(result));
      setCard(result.value);
    } catch {
      setError('provider_error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="style-card">
      <p>{t('intro')}</p>
      <section>
        <h2>{t('interviewTitle')}</h2>
        <p>{t('interviewHint')}</p>
        <form onSubmit={(e) => void onDraft(e)}>
          {STYLE_CARD_QUESTIONS.map((key) => (
            <p key={key} className="style-card-field">
              <label htmlFor={`style-card-${key}`}>{t(`questions.${key}`)}</label>
              <textarea
                id={`style-card-${key}`}
                value={answers[key]}
                onChange={(e) => setAnswer(key, e.target.value)}
              />
            </p>
          ))}
          <p className="style-card-field">
            <label htmlFor="style-card-mistakes">{t('mistakesLabel')}</label>
            <textarea
              id="style-card-mistakes"
              aria-describedby="style-card-mistakes-hint"
              value={mistakesText}
              onChange={(e) => setMistakesText(e.target.value)}
            />
            <span id="style-card-mistakes-hint">{t('mistakesHint')}</span>
          </p>
          {samples.map((sample, i) => (
            <p key={i} className="style-card-field">
              <label htmlFor={`style-card-sample-${i}`}>{t('sampleLabel', { n: i + 1 })}</label>
              <textarea
                id={`style-card-sample-${i}`}
                value={sample}
                onChange={(e) => setSample(i, e.target.value)}
              />
            </p>
          ))}
          <button type="submit" disabled={drafting}>
            {drafting ? t('drafting') : t('draftButton')}
          </button>
        </form>
      </section>
      {error ? (
        <p role="alert" className="style-card-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <section>
        <h2>{t('editTitle')}</h2>
        <p>{card ? t('currentVersion', { version: card.version }) : t('noCard')}</p>
        <form onSubmit={(e) => void onSave(e)}>
          <p className="style-card-field">
            <label htmlFor="style-card-text">{t('textLabel')}</label>
            <textarea id="style-card-text" value={text} onChange={(e) => setText(e.target.value)} />
          </p>
          <p className="style-card-field">
            <label htmlFor="style-card-tags">{t('tagsLabel')}</label>
            <input
              id="style-card-tags"
              aria-describedby="style-card-tags-hint"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
            <span id="style-card-tags-hint">{t('tagsHint')}</span>
          </p>
          <button type="submit" disabled={saving || text.trim() === ''}>
            {saving ? t('saving') : t('saveButton')}
          </button>
        </form>
      </section>
    </div>
  );
}
