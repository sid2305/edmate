// Task 8.2 Phase 4: the browser side of the studio document API (see docs/tasks/8.2/handoff.md,
// "API for Phase 4"). Client-safe: no node imports. The type table mirrors studio/files.ts (which
// needs node:crypto, so the browser can't import it); a test keeps the two equal.

/** What the upload centre shows for one document (the list route's `view`). */
export interface DocumentView {
  id: string;
  moduleId: string;
  kind: string;
  sourceTitle: string;
  /** Task 8.2f: whether this row is an uploaded file or a web link. */
  source: 'file' | 'link';
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadTicket {
  documentId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
}

export type ApiResult<T> =
  | { ok: true; value: T }
  // `message` is one of the server's own fixed strings (ADR-0014, routes.ts): never user input,
  // so it is safe to show as-is. Most callers key off `code`; the add-link form (task 8.2f) shows
  // `message` directly, since a generic `validation` code hides several distinct fixed reasons
  // (bad shape, an internal address, YouTube).
  | { ok: false; status: number; code: string; message?: string };

/** The allowed upload types, in the server's order. */
export const CLIENT_UPLOAD_TYPES: readonly { contentType: string; ext: string }[] = [
  { contentType: 'application/pdf', ext: 'pdf' },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
  { contentType: 'text/markdown', ext: 'md' },
  { contentType: 'audio/mpeg', ext: 'mp3' },
  { contentType: 'audio/wav', ext: 'wav' },
  { contentType: 'audio/mp4', ext: 'm4a' },
  { contentType: 'video/mp4', ext: 'mp4' },
  { contentType: 'video/webm', ext: 'webm' },
  { contentType: 'text/vtt', ext: 'vtt' },
  { contentType: 'application/x-subrip', ext: 'srt' },
];

/** The file picker's `accept`: every extension, then every type. */
export const ACCEPT = [
  ...CLIENT_UPLOAD_TYPES.map((t) => `.${t.ext}`),
  ...CLIENT_UPLOAD_TYPES.map((t) => t.contentType),
].join(',');

/**
 * Task 11.4 Phase B: the extensions a class recording may be -- the transcript-kind types
 * (captions, audio, video). A subset of `CLIENT_UPLOAD_TYPES`; a test checks each one maps on the
 * server to `chunkKind: 'transcript'` (table check against `@edmate/web`'s `UPLOAD_TYPES`).
 */
export const RECORDING_UPLOAD_EXTS = ['vtt', 'srt', 'mp3', 'wav', 'm4a', 'mp4', 'webm'] as const;

const RECORDING_TYPES = CLIENT_UPLOAD_TYPES.filter((t) =>
  (RECORDING_UPLOAD_EXTS as readonly string[]).includes(t.ext),
);

/** The recording picker's `accept`: the same shape as `ACCEPT`, restricted to recording types. */
export const RECORDING_ACCEPT = [
  ...RECORDING_TYPES.map((t) => `.${t.ext}`),
  ...RECORDING_TYPES.map((t) => t.contentType),
].join(',');

/**
 * Task 11.4 Phase B (Q3): the Whisper-split cap for M4A, MP4 and WebM -- a client-side mirror of
 * `MAX_UNSPLIT_MEDIA_BYTES` in `studio/files.ts` (which needs node:crypto, so the browser can't
 * import it; a test keeps the two numbers equal). MP3 and WAV keep the ordinary 500 MB media cap.
 */
export const UNSPLIT_MEDIA_MAX_BYTES = 24 * 1024 * 1024;

const UNSPLIT_EXTS = new Set(['m4a', 'mp4', 'webm']);

/**
 * Whether a file needs a smaller alternative before it's worth uploading: an M4A, MP4 or WebM
 * over `UNSPLIT_MEDIA_MAX_BYTES`. Lets the recording form show the 24 MB message at once, instead
 * of after a slow upload the server would refuse anyway.
 */
export function needsSmallerFile(file: File, contentType: string | null): boolean {
  const ext = CLIENT_UPLOAD_TYPES.find((t) => t.contentType === contentType)?.ext;
  if (ext === undefined || !UNSPLIT_EXTS.has(ext)) return false;
  return file.size > UNSPLIT_MEDIA_MAX_BYTES;
}

/**
 * The content type to declare for a file: the browser's own when it is allowed, else the one its
 * extension names (browsers often report '' for Markdown or a vendor type for m4a), else null.
 */
export function contentTypeFor(file: File): string | null {
  if (CLIENT_UPLOAD_TYPES.some((t) => t.contentType === file.type)) return file.type;
  const dot = file.name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = file.name.slice(dot + 1).toLowerCase();
  return CLIENT_UPLOAD_TYPES.find((t) => t.ext === ext)?.contentType ?? null;
}

const BASE = '/api/studio/documents';
const JSON_HEADERS = { 'content-type': 'application/json' };

async function errorDetail(res: Response): Promise<{ code: string; message?: string }> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    const code = body.error?.code;
    const message = body.error?.message;
    return {
      code: typeof code === 'string' ? code : 'provider_error',
      ...(typeof message === 'string' ? { message } : {}),
    };
  } catch {
    return { code: 'provider_error' };
  }
}

async function call<T>(
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    return { ok: false, status: 0, code: 'provider_error' };
  }
  if (!res.ok) return { ok: false, status: res.status, ...(await errorDetail(res)) };
  return { ok: true, value: await read(res) };
}

const asJson = <T>(res: Response) => res.json() as Promise<T>;
const docUrl = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export function listDocuments(): Promise<ApiResult<DocumentView[]>> {
  return call(BASE, { method: 'GET' }, async (res) => {
    return (await asJson<{ documents: DocumentView[] }>(res)).documents;
  });
}

export function createDocument(input: {
  moduleId: string;
  sourceTitle: string;
  contentType: string;
  byteSize: number;
  /** Task 12.3c: sent only once the upload centre's rights checkbox is checked; never `false`. */
  rightsDeclared: true;
  /** Task 11.4 Phase B: a live-class recording, linked to one of the teacher's own classes. */
  liveClassId?: string;
}): Promise<ApiResult<UploadTicket>> {
  return call(
    BASE,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
    asJson<UploadTicket>,
  );
}

const LINKS_URL = '/api/studio/links';

/** Task 8.2f: adds a web link. The server checks and normalises the URL; the title is optional. */
export function addLink(input: {
  moduleId: string;
  url: string;
  sourceTitle?: string;
  /** Task 12.3c: sent only once the upload centre's rights checkbox is checked; never `false`. */
  rightsDeclared: true;
}): Promise<ApiResult<{ documentId: string; status: string }>> {
  return call(
    LINKS_URL,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
    asJson<{ documentId: string; status: string }>,
  );
}

export function replaceDocument(
  id: string,
  /** Task 12.3c: `rightsDeclared` sent only once the replace picker's checkbox is checked. */
  input: { contentType: string; byteSize: number; rightsDeclared: true },
): Promise<ApiResult<UploadTicket>> {
  return call(
    `${docUrl(id)}/replace`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
    asJson<UploadTicket>,
  );
}

/** 202 processing, 200 already ready; 409 means the PUT hasn't landed yet. */
export function completeDocument(
  id: string,
): Promise<ApiResult<{ documentId: string; status: string }>> {
  return call(
    `${docUrl(id)}/complete`,
    { method: 'POST' },
    asJson<{ documentId: string; status: string }>,
  );
}

export function deleteDocument(id: string): Promise<ApiResult<undefined>> {
  return call(docUrl(id), { method: 'DELETE' }, async () => undefined);
}

export type PutFile = (
  url: string,
  headers: Readonly<Record<string, string>>,
  file: File,
  onProgress: (percent: number) => void,
) => Promise<void>;

/**
 * PUTs the file straight to the bucket with exactly the signed headers. The browser sets
 * content-length from the file itself, which is the signed `byteSize`. XHR, not fetch, for the
 * upload progress events. No credentials: a presigned URL carries its own signature.
 */
export const putFile: PutFile = (url, headers, file, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.floor((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload refused (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.onabort = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
