// Task 8.2 Phase 3: what a teacher may upload. One fixed table maps each allowed content type to
// the worker's file kind, the document's retrieval kind, a size cap and a file extension. The
// storage key is always built here, on the server; its extension names the upload type, so the
// complete route learns the type from the key it stored, never from the client.
import { randomUUID } from 'node:crypto';
import type { ChunkKind } from '@edmate/contracts';
import type { IngestFileKind } from '@edmate/queue';

/** Ingest's own document limit (`MAX_DOCUMENT_BYTES` in @edmate/ingest): 20 MB. */
export const MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;
/**
 * Audio and video: 500 MB, below the Whisper transcriber's 600 MB download cap so a file that
 * uploads can always be fetched for transcription.
 */
export const MAX_MEDIA_UPLOAD_BYTES = 500 * 1024 * 1024;

export interface UploadType {
  contentType: string;
  ext: string;
  fileKind: IngestFileKind;
  chunkKind: ChunkKind;
  maxBytes: number;
}

const doc = (contentType: string, ext: string, fileKind: IngestFileKind): UploadType => ({
  contentType,
  ext,
  fileKind,
  chunkKind: 'material',
  maxBytes: MAX_DOCUMENT_UPLOAD_BYTES,
});
const media = (contentType: string, ext: string, fileKind: IngestFileKind): UploadType => ({
  contentType,
  ext,
  fileKind,
  chunkKind: 'transcript',
  maxBytes: MAX_MEDIA_UPLOAD_BYTES,
});

export const UPLOAD_TYPES: readonly UploadType[] = [
  doc('application/pdf', 'pdf', 'pdf'),
  doc('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', 'docx'),
  doc('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', 'pptx'),
  doc('text/markdown', 'md', 'markdown'),
  media('audio/mpeg', 'mp3', 'audio'),
  media('audio/wav', 'wav', 'audio'),
  media('audio/mp4', 'm4a', 'audio'),
  media('video/mp4', 'mp4', 'video'),
  media('video/webm', 'webm', 'video'),
];

/** The upload type for an exact content type, or null (anything not on the list). */
export function uploadTypeFor(contentType: string): UploadType | null {
  return UPLOAD_TYPES.find((t) => t.contentType === contentType) ?? null;
}

/** `teachers/<teacherId>/documents/<documentId>/<random>.<ext>`, built only on the server. */
export function newStorageKey(teacherId: string, documentId: string, type: UploadType): string {
  return `teachers/${teacherId}/documents/${documentId}/${randomUUID()}.${type.ext}`;
}

/** The upload type a key was built for (by its extension), or null. */
export function uploadTypeOfKey(key: string): UploadType | null {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = key.slice(dot + 1);
  return UPLOAD_TYPES.find((t) => t.ext === ext) ?? null;
}
