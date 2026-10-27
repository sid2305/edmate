// Task 8.2 Phase 3: the studio document API. The route files wrap these handlers in
// `withRole(['teacher'], …)` (ROUTE_POLICY: `/api/studio/**`). The teacher is always the session's
// principal: no handler reads a teacher id from the body, query or URL, and the repository
// re-checks ownership, so another teacher's document id is `not_found` (never "forbidden", which
// would say it exists).
//
//   GET    /api/studio/documents[?moduleId=]   list the teacher's documents
//   POST   /api/studio/documents               create a row; returns a presigned upload URL
//   POST   /api/studio/documents/:id/complete  confirm the upload, mark processing, enqueue ingest
//   POST   /api/studio/documents/:id/replace   start a replace; returns a new upload URL
//   DELETE /api/studio/documents/:id           delete the row and chunks, then the stored file
import type { DocumentRow, Repositories, TeacherScope } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import { checkWebLinkUrl, type WebLinkRefusal } from '@edmate/ingest';
import type { IngestJob } from '@edmate/queue';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import type { StudioStorage } from '../storage/presign';
import {
  isLinkKey,
  isRecordingType,
  newLinkKey,
  newStorageKey,
  uploadTypeFor,
  uploadTypeOfKey,
  type UploadType,
} from './files';
import type { LinkRateLimiter } from './linkRateLimit';

/** The server log: an event name and fixed codes or error names, never ids or message text. */
export interface ServerLog {
  error(event: string, fields?: Readonly<Record<string, string>>): void;
}

/** Everything the routes need, built once per process (runtime.ts) or per test. */
export interface StudioBackend {
  documents: Pick<
    Repositories['documents'],
    'get' | 'listForTeacher' | 'create' | 'updateStatus' | 'delete' | 'startReplace'
  >;
  storage: StudioStorage;
  /** `enqueueIngest` on the ingest queue, keyed by the storage key being processed. */
  enqueue(job: IngestJob, storageKey: string): Promise<void>;
  newDocumentId(): string;
  log: ServerLog;
  /** Task 8.2f: a per-teacher cap on adding web links (ADR-0014 egress policy, review follow-up). */
  linkRateLimit: LinkRateLimiter;
  /** Task 8.2q: a per-teacher cap on creating a new upload row, same shape as `linkRateLimit`. */
  createRateLimit: LinkRateLimiter;
}

/** Thrown by the backend factory when it can't serve (no Redis); `reason` is safe to log. */
export class StudioUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`studio backend unavailable: ${reason}`);
    this.reason = reason;
    this.name = 'StudioUnavailableError';
  }
}

/** The largest request body any studio route reads (bytes); the JSON bodies are tiny. */
export const MAX_BODY_BYTES = 16 * 1024;

/** Too large to read fully; shared with other studio routes (profile.ts) via `readJson`. */
export const TOO_LARGE = Symbol('too large');

/** The body's bytes, or TOO_LARGE as soon as more than the cap has been read. */
async function readCapped(
  body: ReadableStream<Uint8Array>,
): Promise<Uint8Array | typeof TOO_LARGE> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/**
 * The body as JSON, `undefined` when it is not JSON, or TOO_LARGE. A declared content-length over
 * the cap is refused before reading; the bytes read are capped too (same as task 9.4's routes).
 */
export async function readJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return TOO_LARGE;
  if (req.body === null) return undefined;
  try {
    const bytes = await readCapped(req.body);
    if (bytes === TOO_LARGE) return TOO_LARGE;
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** Document and module ids: the repository's id format, short enough for chunk ids. */
const Id = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(122);
const ParamsSchema = z.object({ id: Id });
const ListQuerySchema = z.strictObject({ moduleId: Id.optional() });
const NewFileSchema = z.strictObject({
  contentType: z.string().max(200),
  byteSize: z.int().min(1),
  rightsDeclared: z.literal(true),
});
const CreateSchema = NewFileSchema.extend({
  moduleId: Id,
  sourceTitle: z.string().trim().min(1).max(500),
  /** Task 11.4 Phase B: a live-class recording, linked to one of the teacher's own classes. */
  liveClassId: Id.optional(),
});
// A coarse body cap; the exact 2048-character rule lives in `checkWebLinkUrl` (shared with the
// worker, ADR-0014), which also returns the fixed per-code refusal.
const AddLinkSchema = z.strictObject({
  moduleId: Id,
  url: z.string().trim().min(1).max(4096),
  sourceTitle: z.string().trim().min(1).max(500).optional(),
  rightsDeclared: z.literal(true),
});

const MSG = {
  validation: 'Check the request and try again.',
  type: 'That file type is not supported.',
  tooLarge: 'The file is too large.',
  bodyTooLarge: 'The request is too large.',
  notFound: 'That document was not found.',
  notUploaded: 'The file has not finished uploading.',
  mediaTooLarge:
    "Videos and M4A audio over 24 MB can't be transcribed yet. Upload the audio as MP3, or the class transcript (.vtt or .srt).",
  unavailable: 'Uploads are not available right now. Try again soon.',
  failed: 'Something went wrong. Try again.',
  linkReplace: "A link can't be replaced. Delete it and add the link again.",
  linkRateLimited: 'Too many links added. Wait a while, then try again.',
  createRateLimited: 'Too many uploads started. Wait a while, then try again.',
} as const;

/**
 * Task 8.2o: the fixed 409 messages when `replace` refuses the existing row itself. A note has no
 * file; a class recording stays a recording (another caption, audio or video file is fine).
 */
export const REPLACE_REFUSAL_MESSAGE = {
  note: "A note has no file to replace. Edit the note's text instead.",
  recording:
    'A class recording can only be replaced by another recording: a caption file (.vtt or .srt), audio or video.',
} as const;

/** The fixed 400 message for each way `checkWebLinkUrl` refuses a link (task 8.2f). */
export const LINK_REFUSAL_MESSAGE: Record<WebLinkRefusal, string> = {
  invalid_url: 'Enter a valid web address.',
  not_https: 'Links must start with https://.',
  has_credentials: "A link can't include a user name or password.",
  too_long: 'That web address is too long.',
  bad_port: "Links must use the site's standard web address (no port number).",
  internal_name: "That link can't be read: it isn't a public site.",
  private_address: "That link can't be read: it isn't a public site.",
  youtube_unsupported:
    "YouTube links can't be added. Upload your video's caption file (.vtt or .srt) from YouTube Studio, or the video file.",
};

const validation = (message: string = MSG.validation) => apiError('validation', message, 400);
const notFound = () => apiError('not_found', MSG.notFound, 404);
const tooLarge = (message: string) => apiError('input_too_large', message, 413);
const rateLimited = (message: string = MSG.linkRateLimited) =>
  apiError('rate_limited', message, 429);
const ok = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** An error's name only (never its message, which may quote keys, hosts or ids). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** What the upload centre shows: no teacher id and no storage key, only whether it's a link. */
function view(row: DocumentRow) {
  return {
    id: row.id,
    moduleId: row.moduleId,
    kind: row.kind,
    sourceTitle: row.sourceTitle,
    source: row.storageKey !== undefined && isLinkKey(row.storageKey) ? 'link' : 'file',
    status: row.status,
    ...(row.failureReason === undefined ? {} : { failureReason: row.failureReason }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Task 12.2f Phase C: whether Edmate staff have taken this document down (a separate axis
    // from `status`, the upload lifecycle -- a document can be `ready` and taken down at once).
    takenDown: row.takenDown,
  };
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;
type Work = (
  b: StudioBackend,
  scope: TeacherScope,
  req: NextRequest,
  ctx: RoleContext,
) => Promise<Response>;

/** A validated new file (type on the list, size within its cap), or the error response. */
function newFile(input: z.infer<typeof NewFileSchema>): UploadType | Response {
  const type = uploadTypeFor(input.contentType);
  if (!type) return validation(MSG.type);
  if (input.byteSize > type.maxBytes) {
    // Task 11.4 Phase B (Q3): an M4A, MP4 or WebM over the Whisper-split cap is refused here,
    // before any upload URL is signed, with words that point to a splittable or transcript
    // alternative. Today such a file uploads (the 500 MB media cap) and fails minutes later.
    return tooLarge(type.transcribe && !type.splittable ? MSG.mediaTooLarge : MSG.tooLarge);
  }
  return type;
}

async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.infer<S> | Response> {
  const raw = await readJson(req);
  if (raw === TOO_LARGE) return tooLarge(MSG.bodyTooLarge);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : validation();
}

async function docId(ctx: RoleContext): Promise<string | null> {
  const parsed = ParamsSchema.safeParse(await ctx.params);
  return parsed.success ? parsed.data.id : null;
}

/** Task 8.2q: a transient S3 error gets a couple of retries before anything is logged. */
const DROP_OBJECT_ATTEMPTS = 3;

/**
 * Best effort: a stored file left behind is logged, never fails the request. A failed delete is
 * retried up to `DROP_OBJECT_ATTEMPTS` times (no backoff -- a bucket error is usually not timing
 * related at this volume) before it is logged and given up on.
 */
async function dropObject(b: StudioBackend, key: string | null | undefined): Promise<void> {
  if (!key) return;
  for (let attempt = 1; attempt <= DROP_OBJECT_ATTEMPTS; attempt += 1) {
    try {
      await b.storage.deleteObject(key);
      return;
    } catch (error) {
      if (attempt === DROP_OBJECT_ATTEMPTS) {
        b.log.error('studio.object_delete_failed', { error: errorName(error) });
      }
    }
  }
}

/** Marks the document failed with a fixed code; a lost race (not_found) is fine. */
async function markFailed(b: StudioBackend, scope: TeacherScope, id: string, code: string) {
  try {
    await b.documents.updateStatus(scope, id, 'failed', code);
  } catch (error) {
    if (!(error instanceof RepositoryError && error.kind === 'not_found')) throw error;
  }
}

const list: Work = async (b, scope, req) => {
  const query = ListQuerySchema.safeParse(
    Object.fromEntries([...new URL(req.url).searchParams].filter(([k]) => k === 'moduleId')),
  );
  if (!query.success) return validation();
  const rows = await b.documents.listForTeacher(scope, query.data);
  return ok({ documents: rows.map(view) });
};

const create: Work = async (b, scope, req) => {
  const body = await parseBody(req, CreateSchema);
  if (body instanceof Response) return body;
  const type = newFile(body);
  if (type instanceof Response) return type;
  // Task 11.4 Phase B: only a transcript-kind type (caption, audio or video) may carry
  // `liveClassId`. Checked before anything is signed or written.
  if (body.liveClassId !== undefined && !isRecordingType(type)) return validation(MSG.type);
  // Task 8.2q: the teacher's own create quota, same placement as addLink's linkRateLimit.take --
  // before any write, so a limited teacher gets nothing written.
  let allowed: boolean;
  try {
    allowed = await b.createRateLimit.take(scope.teacherId);
  } catch (error) {
    b.log.error('studio.create_rate_limit_unavailable', { error: errorName(error) });
    return apiError('provider_error', MSG.unavailable, 503);
  }
  if (!allowed) return rateLimited(MSG.createRateLimited);
  const id = b.newDocumentId();
  const key = newStorageKey(scope.teacherId, id, type);
  // Unlike `replace` (whose ownership check is a plain read, so it can sign before writing),
  // `create`'s moduleId/liveClassId ownership check happens inside `documents.create` itself (a
  // foreign-key-shaped check, not a separate read) -- that write must stay first so a foreign id
  // is `not_found` with nothing signed. A signing failure *after* that write is then cleaned up:
  // the row is deleted so no orphan `uploading` row survives the request.
  await b.documents.create(scope, {
    id,
    moduleId: body.moduleId,
    kind: type.chunkKind,
    sourceTitle: body.sourceTitle,
    storageKey: key,
    rightsDeclared: body.rightsDeclared,
    ...(body.liveClassId === undefined ? {} : { liveClassId: body.liveClassId }),
  });
  let uploadUrl: string;
  try {
    uploadUrl = await b.storage.createUploadUrl({
      key,
      contentType: type.contentType,
      contentLength: body.byteSize,
    });
  } catch (error) {
    try {
      await b.documents.delete(scope, id);
    } catch (cleanupError) {
      b.log.error('studio.create_cleanup_failed', { error: errorName(cleanupError) });
    }
    throw error;
  }
  return ok(
    { documentId: id, uploadUrl, uploadHeaders: { 'content-type': type.contentType } },
    201,
  );
};

const complete: Work = async (b, scope, _req, ctx) => {
  const id = await docId(ctx);
  if (!id) return validation();
  const row = await b.documents.get(scope, id);
  if (!row) return notFound();
  if (row.status === 'ready') return ok({ documentId: id, status: 'ready' });
  const key = row.storageKey;
  const type = key === undefined ? null : uploadTypeOfKey(key);
  if (key === undefined || !type) return validation();
  const stored = await b.storage.head(key);
  if (!stored) return apiError('validation', MSG.notUploaded, 409);
  const size = stored.contentLength;
  if (size === undefined || size < 1 || size > type.maxBytes) {
    await markFailed(b, scope, id, 'input_too_large');
    await dropObject(b, key);
    return tooLarge(MSG.tooLarge);
  }
  if (stored.contentType !== type.contentType) {
    await markFailed(b, scope, id, 'unsupported_type');
    await dropObject(b, key);
    return validation(MSG.type);
  }
  // `processing` first: the worker's own `ready` write is refused from `uploading`.
  await b.documents.updateStatus(scope, id, 'processing');
  // Task 8.2n: the needs-transcription rule lives on the upload type, not here.
  try {
    await b.enqueue(
      {
        teacherId: scope.teacherId,
        documentId: id,
        fileKind: type.fileKind,
        ...(type.transcribe ? { mimeType: type.contentType } : {}),
      },
      key,
    );
  } catch (error) {
    b.log.error('studio.enqueue_failed', { error: errorName(error) });
    await markFailed(b, scope, id, 'enqueue_failed');
    return apiError('provider_error', MSG.unavailable, 503);
  }
  return ok({ documentId: id, status: 'processing' }, 202);
};

/**
 * Adds a web link (task 8.2f, Phase C of 8.2b). The URL is checked by the pure, shared
 * `checkWebLinkUrl` (ADR-0014) before anything is written or rate-limited; it never reaches
 * Postgres or a log line (ADR-0014 Decision 9) -- it travels only in the job enqueued below. The
 * teacher's own rate limit is taken after the URL shape passes (so a malformed URL costs no
 * quota) and before the row is created (so a limited teacher gets nothing written).
 */
const addLink: Work = async (b, scope, req) => {
  const body = await parseBody(req, AddLinkSchema);
  if (body instanceof Response) return body;
  const checked = checkWebLinkUrl(body.url);
  if (!checked.ok) return validation(LINK_REFUSAL_MESSAGE[checked.code]);
  let allowed: boolean;
  try {
    allowed = await b.linkRateLimit.take(scope.teacherId);
  } catch (error) {
    b.log.error('studio.link_rate_limit_unavailable', { error: errorName(error) });
    return apiError('provider_error', MSG.unavailable, 503);
  }
  if (!allowed) return rateLimited();
  const id = b.newDocumentId();
  const key = newLinkKey(scope.teacherId, id);
  await b.documents.create(scope, {
    id,
    moduleId: body.moduleId,
    kind: 'material',
    sourceTitle: body.sourceTitle ?? checked.displayTitle,
    storageKey: key,
    rightsDeclared: body.rightsDeclared,
  });
  // `processing` first, same as `complete`: the worker's own `ready` write is refused from
  // `uploading`.
  await b.documents.updateStatus(scope, id, 'processing');
  try {
    await b.enqueue(
      { teacherId: scope.teacherId, documentId: id, fileKind: 'web', url: checked.url },
      key,
    );
  } catch (error) {
    b.log.error('studio.enqueue_failed', { error: errorName(error) });
    await markFailed(b, scope, id, 'enqueue_failed');
    return apiError('provider_error', MSG.unavailable, 503);
  }
  return ok({ documentId: id, status: 'processing' }, 202);
};

const replace: Work = async (b, scope, req, ctx) => {
  const id = await docId(ctx);
  if (!id) return validation();
  const body = await parseBody(req, NewFileSchema);
  if (body instanceof Response) return body;
  const type = newFile(body);
  if (type instanceof Response) return type;
  // Ownership first, then sign, then commit: a signing failure leaves the row and its file as
  // they were, and another teacher's id gets nothing signed.
  const existing = await b.documents.get(scope, id);
  if (!existing) return notFound();
  if (existing.storageKey !== undefined && isLinkKey(existing.storageKey)) {
    return validation(MSG.linkReplace);
  }
  // Task 8.2o: a note has no file to replace. Refused before anything is signed.
  if (existing.kind === 'teacher_note') {
    return apiError('validation', REPLACE_REFUSAL_MESSAGE.note, 409);
  }
  const key = newStorageKey(scope.teacherId, id, type);
  const uploadUrl = await b.storage.createUploadUrl({
    key,
    contentType: type.contentType,
    contentLength: body.byteSize,
  });
  // Task 8.2n: the new file's retrieval kind replaces the old one (a PDF swapped for a caption
  // file becomes `transcript`, and the reverse), so citations read the right way. Task 8.2o: the
  // repository refuses (`invalid`, nothing written) a class-linked recording turning `material`,
  // the same rule as create's task-11.4 guard; `DocumentRow` carries no `liveClassId`, so the
  // route learns it here. The signed URL is never returned, so nothing is uploaded under `key`.
  let previousStorageKey: string | null;
  try {
    ({ previousStorageKey } = await b.documents.startReplace(scope, id, {
      storageKey: key,
      rightsDeclared: body.rightsDeclared,
      kind: type.chunkKind,
    }));
  } catch (error) {
    if (error instanceof RepositoryError && error.kind === 'invalid') {
      return apiError('validation', REPLACE_REFUSAL_MESSAGE.recording, 409);
    }
    throw error;
  }
  await dropObject(b, previousStorageKey);
  return ok({ documentId: id, uploadUrl, uploadHeaders: { 'content-type': type.contentType } });
};

const remove: Work = async (b, scope, _req, ctx) => {
  const id = await docId(ctx);
  if (!id) return validation();
  const { storageKey } = await b.documents.delete(scope, id);
  // A link never had an S3 object; only a file's key is dropped from the bucket.
  if (storageKey !== null && !isLinkKey(storageKey)) await dropObject(b, storageKey);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};

/**
 * The five handlers over a lazily built backend. A backend that can't be built is 503; a
 * repository `not_found` is 404 and `invalid` is 400; anything else is a logged 500.
 */
export function createStudioHandlers(
  backend: () => Promise<StudioBackend>,
  fallbackLog: ServerLog,
) {
  const run =
    (work: Work): Handler =>
    async (req, ctx) => {
      let b: StudioBackend;
      try {
        b = await backend();
      } catch (error) {
        const reason = error instanceof StudioUnavailableError ? error.reason : errorName(error);
        fallbackLog.error('studio.unavailable', { reason });
        return apiError('provider_error', MSG.unavailable, 503);
      }
      const scope: TeacherScope = { teacherId: ctx.principal.userId };
      try {
        return await work(b, scope, req, ctx);
      } catch (error) {
        if (error instanceof RepositoryError && error.kind === 'not_found') return notFound();
        if (error instanceof RepositoryError && error.kind === 'invalid') return validation();
        b.log.error('studio.failed', { error: errorName(error) });
        return apiError('provider_error', MSG.failed, 500);
      }
    };
  return {
    list: run(list),
    create: run(create),
    addLink: run(addLink),
    complete: run(complete),
    replace: run(replace),
    remove: run(remove),
  };
}
