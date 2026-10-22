'use client';
// Task 11.4 Phase C: the "Add recording" form for one live class that has started. The teacher
// picks a caption/transcript/audio file, one module from the class's attached packages (Q4), a
// title (the citation students see), and ticks the 12.3c rights declaration and the recording
// consent line (Q2, pending the human as B-52). Then: client pre-check (`needsSmallerFile`),
// create (with `liveClassId` and `rightsDeclared: true`), PUT with progress, complete.
// Lessons ("UI state and server replies"): one busy flag, every call in try/catch/finally, every
// server payload through `safeParse` with a fallback, and the form resets after success and failure.
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { z } from 'zod';
import type { LiveClassRecording } from '@edmate/db';
import {
  completeDocument as defaultComplete,
  contentTypeFor,
  createDocument as defaultCreate,
  needsSmallerFile,
  putFile as defaultPutFile,
  RECORDING_ACCEPT,
  RECORDING_UPLOAD_EXTS,
  CLIENT_UPLOAD_TYPES,
} from '../../../src/studio/uploadClient';

export interface RecordingUploadProps {
  liveClass: { id: string; title: string; startsAt: string };
  /** The union of the class's attached packages' modules (Q4). */
  moduleIds: readonly string[];
  /** Called with the new row once created (`uploading`), then again after `complete`. */
  onRecording(recording: LiveClassRecording): void;
  /** Tests inject fakes (rule 4); default to the studio client. */
  createDocument?: typeof defaultCreate;
  putFile?: typeof defaultPutFile;
  completeDocument?: typeof defaultComplete;
}

const TITLE_MAX = 500;

const TicketSchema = z.object({
  documentId: z.string().min(1),
  uploadUrl: z.string().min(1),
  uploadHeaders: z.record(z.string(), z.string()),
});
const CompleteSchema = z.object({ status: z.enum(['processing', 'ready']) });

type ErrorKey = 'unsupported_type' | 'media_too_large' | 'title' | 'not_found' | 'upload_failed' | 'generic';
/** A server refusal shows the server's own fixed message (ADR-0014), else our words for its code. */
type Failure = { key: ErrorKey } | { message: string };

const RECORDING_TYPES = new Set(
  CLIENT_UPLOAD_TYPES.filter((t) => (RECORDING_UPLOAD_EXTS as readonly string[]).includes(t.ext)).map(
    (t) => t.contentType,
  ),
);

export function RecordingUpload({
  liveClass,
  moduleIds,
  onRecording,
  createDocument = defaultCreate,
  putFile = defaultPutFile,
  completeDocument = defaultComplete,
}: RecordingUploadProps) {
  const t = useTranslations('liveClassesStudio.recording');
  const id = useId();
  const defaultTitle = t('defaultTitle', {
    title: liveClass.title,
    date: liveClass.startsAt.slice(0, 10),
  });
  const [formKey, setFormKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [moduleId, setModuleId] = useState('');
  const [sourceTitle, setSourceTitle] = useState(defaultTitle);
  const [rights, setRights] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [added, setAdded] = useState(false);

  if (moduleIds.length === 0) return <p>{t('noModules')}</p>;

  const reset = () => {
    setFile(null);
    setModuleId('');
    setSourceTitle(defaultTitle);
    setRights(false);
    setConsent(false);
    setProgress(null);
    setFormKey((k) => k + 1);
  };

  const ready = file !== null && moduleId !== '' && rights && consent && !busy;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || file === null) return;
    setAdded(false);
    const contentType = contentTypeFor(file);
    if (contentType === null || !RECORDING_TYPES.has(contentType)) {
      setFailure({ key: 'unsupported_type' });
      return;
    }
    if (needsSmallerFile(file, contentType)) {
      setFailure({ key: 'media_too_large' });
      return;
    }
    const title = sourceTitle.trim();
    if (title.length === 0 || title.length > TITLE_MAX) {
      setFailure({ key: 'title' });
      return;
    }
    setFailure(null);
    setBusy(true);
    let stage: 'create' | 'put' | 'complete' = 'create';
    try {
      const created = await createDocument({
        moduleId,
        sourceTitle: title,
        contentType,
        byteSize: file.size,
        rightsDeclared: true,
        liveClassId: liveClass.id,
      });
      if (!created.ok) {
        setFailure(
          created.message !== undefined
            ? { message: created.message }
            : { key: created.code === 'not_found' ? 'not_found' : 'generic' },
        );
        return;
      }
      const ticket = TicketSchema.safeParse(created.value);
      if (!ticket.success) {
        setFailure({ key: 'generic' });
        return;
      }
      const row: LiveClassRecording = {
        liveClassId: liveClass.id,
        documentId: ticket.data.documentId,
        sourceTitle: title,
        status: 'uploading',
      };
      onRecording(row);
      stage = 'put';
      await putFile(ticket.data.uploadUrl, ticket.data.uploadHeaders, file, setProgress);
      stage = 'complete';
      const done = await completeDocument(ticket.data.documentId);
      if (!done.ok) {
        setFailure({ key: 'generic' });
        return;
      }
      const parsed = CompleteSchema.safeParse(done.value);
      onRecording({ ...row, status: parsed.success ? parsed.data.status : 'processing' });
      setAdded(true);
    } catch {
      setFailure({ key: stage === 'put' ? 'upload_failed' : 'generic' });
    } finally {
      setBusy(false);
      reset();
    }
  };

  const fileId = `${id}-file`;
  const moduleSelectId = `${id}-module`;
  const titleId = `${id}-title`;
  const rightsId = `${id}-rights`;
  const consentId = `${id}-consent`;
  const consentHintId = `${id}-consent-hint`;
  const fileHintId = `${id}-file-hint`;

  return (
    <form key={formKey} aria-label={t('formLabel')} onSubmit={(e) => void onSubmit(e)}>
      {failure ? (
        <p role="alert" className="live-classes-error">
          {'message' in failure ? failure.message : t(`errors.${failure.key}`)}
        </p>
      ) : null}
      {added ? (
        <p role="status" className="live-classes-notice">
          {t('added')}
        </p>
      ) : null}
      <fieldset disabled={busy}>
        <legend>{t('formLabel')}</legend>
        <p>
          <label htmlFor={fileId}>{t('fileLabel')}</label>
          <input
            id={fileId}
            type="file"
            accept={RECORDING_ACCEPT}
            aria-describedby={fileHintId}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span id={fileHintId}>{t('fileHint')}</span>
        </p>
        <p>
          <label htmlFor={moduleSelectId}>{t('moduleLabel')}</label>
          <select id={moduleSelectId} value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">{t('chooseModule')}</option>
            {moduleIds.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor={titleId}>{t('sourceTitleLabel')}</label>
          <input
            id={titleId}
            value={sourceTitle}
            maxLength={TITLE_MAX}
            onChange={(e) => setSourceTitle(e.target.value)}
          />
        </p>
        <p>
          <label htmlFor={rightsId}>
            <input
              id={rightsId}
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
            />
            {t('rightsLabel')}
          </label>
        </p>
        <p>
          <label htmlFor={consentId}>
            <input
              id={consentId}
              type="checkbox"
              checked={consent}
              aria-describedby={consentHintId}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t('consentLabel')}
          </label>
          <span id={consentHintId}>{t('consentHint')}</span>
        </p>
        {progress !== null ? <p>{t('progress', { percent: progress })}</p> : null}
        <button type="submit" disabled={!ready}>
          {busy ? t('uploading') : t('submit')}
        </button>
      </fieldset>
    </form>
  );
}
