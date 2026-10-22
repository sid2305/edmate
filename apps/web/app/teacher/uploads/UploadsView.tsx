'use client';
// Task 8.2 Phase 4: the teacher's upload centre. Upload (create → PUT to the bucket → complete),
// a status list that polls about every 4 s while any file is uploading or processing, replace and
// delete. Every string is from messages/en.json; titles render as text, never as markup.
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ACCEPT,
  addLink,
  completeDocument,
  contentTypeFor,
  createDocument,
  deleteDocument,
  listDocuments,
  putFile as realPutFile,
  replaceDocument,
  type ApiResult,
  type DocumentView,
  type PutFile,
  type UploadTicket,
} from '../../../src/studio/uploadClient';

/** How often the list refreshes while a file is uploading or processing. */
export const POLL_MS = 4000;

const ERROR_KEYS = [
  'unsupported_type',
  'input_too_large',
  'validation',
  'not_found',
  'unauthorized',
  'forbidden',
  'rate_limited',
  'provider_error',
] as const;
const REASON_KEYS = [
  'input_too_large',
  'unsupported_type',
  'unsupported',
  'forbidden',
  'enqueue_failed',
  'validation',
  'provider_error',
] as const;

type ErrorKey = (typeof ERROR_KEYS)[number] | 'not_uploaded' | 'upload_failed';
type Local = { progress?: number; error?: ErrorKey; retry?: boolean };

/** The words for a failed call: 409 is "not arrived yet"; unknown codes are generic. */
function errorKey(result: Extract<ApiResult<unknown>, { ok: false }>): ErrorKey {
  if (result.status === 409) return 'not_uploaded';
  return (ERROR_KEYS as readonly string[]).includes(result.code)
    ? (result.code as ErrorKey)
    : 'provider_error';
}

function reasonKey(reason: string | undefined): (typeof REASON_KEYS)[number] | 'other' {
  return (REASON_KEYS as readonly string[]).includes(reason ?? '')
    ? (reason as (typeof REASON_KEYS)[number])
    : 'other';
}

const isActive = (d: DocumentView) => d.status === 'uploading' || d.status === 'processing';

export interface UploadsViewProps {
  /** The teacher's module ids (from the server); uploads are filed under one of them. */
  moduleIds: readonly string[];
  /** The bucket PUT; tests inject one. */
  putFile?: PutFile;
}

export function UploadsView({ moduleIds, putFile = realPutFile }: UploadsViewProps) {
  const t = useTranslations('uploads');
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [banner, setBanner] = useState<ErrorKey | null>(null);
  const [local, setLocal] = useState<Record<string, Local>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [moduleId, setModuleId] = useState(moduleIds[0] ?? '');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkBannerError, setLinkBannerError] = useState<string | null>(null);
  // Task 12.3c: a teacher cannot upload, replace or add a link without checking this box; the
  // client never sends `rightsDeclared: false` -- the checkbox simply disables every control.
  const [rightsChecked, setRightsChecked] = useState(false);
  const replaceTarget = useRef<string | null>(null);
  const replacePicker = useRef<HTMLInputElement>(null);

  const patch = useCallback((id: string, next: Local) => {
    setLocal((all) => ({ ...all, [id]: next }));
  }, []);

  const refresh = useCallback(async () => {
    const result = await listDocuments();
    if (result.ok) setDocs(result.value);
    else setBanner(errorKey(result));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // One refresh POLL_MS after every list change while anything is still moving.
  useEffect(() => {
    if (!docs?.some(isActive)) return;
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [docs, refresh]);

  const finish = useCallback(
    async (id: string) => {
      const done = await completeDocument(id);
      if (done.ok) patch(id, {});
      else patch(id, { error: errorKey(done), retry: done.status === 409 || done.status >= 500 });
      await refresh();
    },
    [patch, refresh],
  );

  const send = useCallback(
    async (
      file: File,
      start: (contentType: string, byteSize: number) => Promise<ApiResult<UploadTicket>>,
    ) => {
      setBanner(null);
      const contentType = contentTypeFor(file);
      if (!contentType) return setBanner('unsupported_type');
      const ticket = await start(contentType, file.size);
      if (!ticket.ok) return setBanner(errorKey(ticket));
      const { documentId, uploadUrl, uploadHeaders } = ticket.value;
      patch(documentId, { progress: 0 });
      await refresh();
      try {
        await putFile(uploadUrl, uploadHeaders, file, (progress) =>
          patch(documentId, { progress }),
        );
      } catch {
        patch(documentId, { error: 'upload_failed' });
        return;
      }
      await finish(documentId);
    },
    [finish, patch, putFile, refresh],
  );

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void send(file, (contentType, byteSize) =>
      createDocument({
        moduleId,
        sourceTitle: file.name,
        contentType,
        byteSize,
        rightsDeclared: true,
      }),
    );
  };

  const onReplace = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = replaceTarget.current;
    e.target.value = '';
    if (!file || !id) return;
    void send(file, (contentType, byteSize) =>
      replaceDocument(id, { contentType, byteSize, rightsDeclared: true }),
    );
  };

  const onDelete = async (id: string) => {
    setConfirming(null);
    const result = await deleteDocument(id);
    if (!result.ok) setBanner(errorKey(result));
    await refresh();
  };

  const onAddLink = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!url || linkBusy || !rightsChecked) return;
    setLinkBusy(true);
    setLinkBannerError(null);
    try {
      const result = await addLink({
        moduleId,
        url,
        ...(linkTitle.trim() ? { sourceTitle: linkTitle.trim() } : {}),
        rightsDeclared: true,
      });
      if (!result.ok) {
        setLinkBannerError(result.message ?? t(`errors.${errorKey(result)}`));
        return;
      }
      setLinkUrl('');
      setLinkTitle('');
      await refresh();
    } catch {
      setLinkBannerError(t('errors.provider_error'));
    } finally {
      setLinkBusy(false);
    }
  };

  const statusText = (d: DocumentView): string => {
    const progress = local[d.id]?.progress;
    if (d.status === 'uploading' && progress !== undefined && !local[d.id]?.error) {
      return t('progress', { percent: progress });
    }
    return t(`status.${d.status}`);
  };

  return (
    <div className="uploads">
      <p>{t('intro')}</p>
      {moduleIds.length === 0 ? (
        <p>{t('noModules')}</p>
      ) : (
        <div className="uploads-controls">
          {moduleIds.length > 1 ? (
            <p className="uploads-field">
              <label htmlFor="uploads-module">{t('module')}</label>
              <select
                id="uploads-module"
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value)}
              >
                {moduleIds.map((id, i) => (
                  <option key={id} value={id}>
                    {t('moduleOption', { n: i + 1 })}
                  </option>
                ))}
              </select>
            </p>
          ) : null}
          <p className="uploads-field uploads-rights">
            <label htmlFor="uploads-rights">
              <input
                id="uploads-rights"
                type="checkbox"
                checked={rightsChecked}
                onChange={(e) => setRightsChecked(e.target.checked)}
                aria-describedby="uploads-rights-hint"
              />
              {t('rightsLabel')}
            </label>
            <span id="uploads-rights-hint" className="uploads-hint">
              {t('rightsHint')}
            </span>
          </p>
          <p className="uploads-field">
            <label htmlFor="uploads-file">{t('chooseFile')}</label>
            <input
              id="uploads-file"
              type="file"
              accept={ACCEPT}
              aria-describedby="uploads-hint"
              disabled={!rightsChecked}
              onChange={onUpload}
            />
            <span id="uploads-hint" className="uploads-hint">
              {t('acceptHint')}
            </span>
          </p>
          <p className="uploads-youtube-hint">{t('youtubeHint')}</p>
          <form className="uploads-link-form" onSubmit={(e) => void onAddLink(e)}>
            <p className="uploads-field">
              <label htmlFor="uploads-link-url">{t('linkUrl')}</label>
              <input
                id="uploads-link-url"
                type="url"
                inputMode="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder={t('linkUrlPlaceholder')}
              />
            </p>
            <p className="uploads-field">
              <label htmlFor="uploads-link-title">{t('linkTitle')}</label>
              <input
                id="uploads-link-title"
                type="text"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
              />
            </p>
            <button
              type="submit"
              disabled={linkBusy || linkUrl.trim() === '' || !rightsChecked}
            >
              {t('addLink')}
            </button>
            {linkBannerError ? (
              <p role="alert" className="uploads-error">
                {linkBannerError}
              </p>
            ) : null}
          </form>
        </div>
      )}
      <input
        ref={replacePicker}
        type="file"
        hidden
        data-replace-picker=""
        accept={ACCEPT}
        tabIndex={-1}
        disabled={!rightsChecked}
        onChange={onReplace}
      />
      {banner ? (
        <p role="alert" className="uploads-error">
          {t(`errors.${banner}`)}
        </p>
      ) : null}
      {docs === null ? (
        <p>{t('loading')}</p>
      ) : docs.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="uploads-list" aria-label={t('listLabel')}>
          {docs.map((d) => {
            const mine = local[d.id];
            const isLink = d.source === 'link';
            // A link has no bucket upload to retry or replace: it is deleted and added again.
            const canRetry =
              !isLink &&
              (mine?.retry === true || (d.status === 'failed' && d.failureReason === 'enqueue_failed'));
            return (
              <li key={d.id} className="uploads-row">
                <span className="uploads-title">{d.sourceTitle}</span>
                <span className="uploads-status" aria-live="polite">
                  {statusText(d)}
                </span>
                {d.status === 'failed' ? (
                  <span className="uploads-reason">
                    {t(`reasons.${reasonKey(d.failureReason)}`)}
                  </span>
                ) : null}
                {mine?.error ? (
                  <span className="uploads-error">{t(`errors.${mine.error}`)}</span>
                ) : null}
                {confirming === d.id ? (
                  <span className="uploads-actions">
                    <span>{t('confirmDelete', { title: d.sourceTitle })}</span>
                    <button type="button" onClick={() => void onDelete(d.id)}>
                      {t('confirm')}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      {t('cancel')}
                    </button>
                  </span>
                ) : (
                  <span className="uploads-actions">
                    {canRetry ? (
                      <button
                        type="button"
                        aria-label={t('retryLabel', { title: d.sourceTitle })}
                        onClick={() => void finish(d.id)}
                      >
                        {t('retry')}
                      </button>
                    ) : null}
                    {isLink ? null : (
                      <button
                        type="button"
                        aria-label={t('replaceLabel', { title: d.sourceTitle })}
                        disabled={!rightsChecked}
                        onClick={() => {
                          replaceTarget.current = d.id;
                          replacePicker.current?.click();
                        }}
                      >
                        {t('replace')}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t('deleteLabel', { title: d.sourceTitle })}
                      onClick={() => setConfirming(d.id)}
                    >
                      {t('delete')}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
