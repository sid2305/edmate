// Speech to text behind the Transcriber port (task 2.7, ADR-0005).
export {
  createWhisperTranscriber,
  DEFAULT_MAX_DOWNLOAD_BYTES,
  WHISPER_MAX_UPLOAD_BYTES,
  WHISPER_MODEL,
  type ModelTranscriber,
  type TranscriberTrace,
  type WhisperTranscriberOptions,
} from './whisper.js';
export { defaultChunker, type AudioChunk, type AudioChunker } from './chunking.js';
export {
  TranscriberError,
  type TranscriberErrorCode,
  type TranscriberErrorReason,
} from './errors.js';
export { redactUrl } from './source.js';
