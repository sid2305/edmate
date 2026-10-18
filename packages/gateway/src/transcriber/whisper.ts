// The Transcriber port over OpenAI Whisper (task 2.7, ADR-0005), through the AI SDK's OpenAI
// transcription model.
//
// One call: check the input and the storage host, download the recording through its signed
// URL, split it when it is over the upload limit, transcribe the pieces in order, shift each
// piece's segment times by where the piece starts, stitch, and check the result against
// TranscriptSchema. It throws a TranscriberError on any failure; it never returns an empty or
// partial transcript, and never names the signed URL (only scheme://host/path, in traces).
import {
  LangSchema,
  TranscribeInputSchema,
  TranscriptSchema,
  type TranscribeInput,
  type Transcriber,
  type Transcript,
  type TranscriptSegment,
} from '@edmate/contracts';
import {
  createOpenAITranscriptionModel,
  type OpenAITranscriptionModel,
} from '../adapters/openai.js';
import type { KeysFor } from '../keys/providers.js';
import { type AudioChunk, type AudioChunker, defaultChunker } from './chunking.js';
import { mapTranscriptionError, TranscriberError } from './errors.js';
import { allowedUrl, download, normaliseAllowedHosts, redactUrl } from './source.js';

type Fetch = typeof globalThis.fetch;

export const WHISPER_MODEL = 'whisper-1';
/** Whisper's upload limit is 25 MB; pieces stay under it with room for the multipart envelope. */
export const WHISPER_MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
/**
 * Five hours of 16 kHz mono WAV is about 576 MB; anything bigger is refused before it is read.
 * Peak memory is about twice this for WAV (the pieces carry their own headers) and once for MP3.
 */
export const DEFAULT_MAX_DOWNLOAD_BYTES = 600_000_000;
/** An empty last piece shorter than this is a quiet tail, not a gap in the class. */
const SHORT_TAIL_MS = 1_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CHUNK_TIMEOUT_MS = 10 * 60_000;
/** A piece the provider heard as this much shorter than it is was cut off on the way. */
const DURATION_SLACK_MS = 2_000;

/** A structured line about one call. Never the signed URL's query string, never transcript text. */
export type TranscriberTrace =
  | {
      readonly event: 'transcriber.downloaded';
      readonly source: string;
      readonly bytes: number;
      readonly chunks: number;
    }
  | {
      readonly event: 'transcriber.chunk';
      readonly index: number;
      readonly of: number;
      readonly offsetMs: number;
      readonly bytes: number;
      readonly segments: number;
      /** Set when a piece was skipped: an empty final piece under 1 s. */
      readonly anomaly?: 'empty_final_piece';
    };

export interface WhisperTranscriberOptions {
  /**
   * Storage hosts recordings may be fetched from, matched exactly against the URL's host (ADR-0005).
   * Supplied by the composition root from config; an empty list refuses every URL.
   */
  readonly allowedHosts: readonly string[];
  /** Defaults to `whisper-1`, which returns the segment timings the port needs. */
  readonly model?: string;
  /** OpenAI's endpoint unless set; never read from the environment. */
  readonly baseURL?: string;
  /** Splits recordings over `maxUploadBytes`; defaults to the WAV and MP3 splitter. */
  readonly chunker?: AudioChunker;
  readonly maxUploadBytes?: number;
  readonly maxDownloadBytes?: number;
  readonly downloadTimeoutMs?: number;
  /** Per piece. */
  readonly chunkTimeoutMs?: number;
  /** Transport for both the download and the provider (tests pass a fake). */
  readonly fetch?: Fetch;
  /** Where structured trace lines go; nothing is logged when unset. */
  readonly trace?: (t: TranscriberTrace) => void;
}

/** A Transcriber that also says which model it bills on (for metering). */
export interface ModelTranscriber extends Transcriber {
  readonly model: string;
}

const ms = (seconds: number): number => Math.round(seconds * 1000);

function checkChunks(chunks: readonly AudioChunk[], maxUploadBytes: number): void {
  let lastOffset = -1;
  for (const c of chunks) {
    if (
      c.bytes.byteLength === 0 ||
      c.bytes.byteLength > maxUploadBytes ||
      c.offsetMs < lastOffset
    ) {
      throw new TranscriberError(
        'validation',
        false,
        'the chunker returned pieces that cannot be uploaded in order',
      );
    }
    lastOffset = c.offsetMs;
  }
  if (chunks.length === 0) {
    throw new TranscriberError('validation', false, 'the chunker returned no pieces');
  }
}

export function createWhisperTranscriber(
  keys: KeysFor<'openai'>,
  opts: WhisperTranscriberOptions,
): ModelTranscriber {
  const allowedHosts = normaliseAllowedHosts(opts.allowedHosts);
  const modelId = opts.model ?? WHISPER_MODEL;
  const fetch = opts.fetch ?? globalThis.fetch;
  const model: OpenAITranscriptionModel = createOpenAITranscriptionModel(keys, {
    model: modelId,
    ...(opts.baseURL === undefined ? {} : { baseURL: opts.baseURL }),
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
  });
  const chunker = opts.chunker ?? defaultChunker;
  const maxUploadBytes = opts.maxUploadBytes ?? WHISPER_MAX_UPLOAD_BYTES;
  const maxDownloadBytes = opts.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const downloadTimeoutMs = opts.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const chunkTimeoutMs = opts.chunkTimeoutMs ?? DEFAULT_CHUNK_TIMEOUT_MS;
  const trace = opts.trace ?? (() => {});

  async function transcribeChunk(chunk: AudioChunk, languageHint: string | undefined) {
    try {
      return await model.doGenerate({
        audio: chunk.bytes,
        mediaType: chunk.mimeType,
        providerOptions: {
          openai: {
            timestampGranularities: ['segment'],
            ...(languageHint === undefined ? {} : { language: languageHint }),
          },
        },
        abortSignal: AbortSignal.timeout(chunkTimeoutMs),
      });
    } catch (err) {
      throw mapTranscriptionError(err);
    }
  }

  async function transcribe(i: TranscribeInput): Promise<Transcript> {
    // Nothing about the input is echoed: the URL is a credential.
    const parsed = TranscribeInputSchema.safeParse(i);
    if (!parsed.success) {
      throw new TranscriberError(
        'validation',
        false,
        'the transcription request is not a valid https URL and audio/video type',
      );
    }
    const input = parsed.data;
    const url = allowedUrl(input.url, allowedHosts);
    const audio = await download(url, {
      allowedHosts,
      fetch,
      maxBytes: maxDownloadBytes,
      timeoutMs: downloadTimeoutMs,
    });

    let chunks: readonly AudioChunk[];
    if (audio.byteLength <= maxUploadBytes) {
      chunks = [{ bytes: audio, mimeType: input.mimeType, offsetMs: 0 }];
    } else {
      try {
        chunks = await chunker(audio, input.mimeType, maxUploadBytes);
      } catch (err) {
        if (err instanceof TranscriberError) throw err;
        throw new TranscriberError(
          'validation',
          false,
          'the recording could not be split for upload',
        );
      }
      checkChunks(chunks, maxUploadBytes);
    }
    trace({
      event: 'transcriber.downloaded',
      source: redactUrl(input.url),
      bytes: audio.byteLength,
      chunks: chunks.length,
    });

    const segments: TranscriptSegment[] = [];
    const texts: string[] = [];
    let language: string | undefined;
    let durationMs = 0;
    for (const [index, chunk] of chunks.entries()) {
      const result = await transcribeChunk(chunk, input.languageHint);
      const heardMs =
        result.durationInSeconds === undefined ? undefined : ms(result.durationInSeconds);
      if (
        heardMs !== undefined &&
        chunk.durationMs !== undefined &&
        heardMs + DURATION_SLACK_MS < chunk.durationMs
      ) {
        throw new TranscriberError(
          'provider_error',
          false,
          `the provider heard only part of piece ${String(index + 1)} of ${String(chunks.length)}`,
          'truncated',
        );
      }
      let kept = 0;
      const keptTexts: string[] = [];
      for (const s of result.segments) {
        const text = s.text.trim();
        if (text === '') continue;
        const startMs = chunk.offsetMs + ms(s.startSecond);
        const endMs = chunk.offsetMs + ms(s.endSecond);
        segments.push({ startMs, endMs, text });
        keptTexts.push(text);
        durationMs = Math.max(durationMs, endMs);
        kept += 1;
      }
      // Segments are the evidence of speech; the piece text falls back to them when it is blank.
      const text = result.text.trim() !== '' ? result.text.trim() : keptTexts.join(' ');
      if (text !== '' && kept === 0) {
        throw new TranscriberError(
          'provider_error',
          false,
          `piece ${String(index + 1)} of ${String(chunks.length)} came back without segment timings`,
        );
      }
      const pieceMs = heardMs ?? chunk.durationMs ?? 0;
      let anomaly: 'empty_final_piece' | undefined;
      if (text === '' && chunks.length > 1) {
        // A piece with no speech is a gap in the class, unless it is a short tail at the end.
        const lengthMs = heardMs ?? chunk.durationMs;
        const shortTail =
          index === chunks.length - 1 && lengthMs !== undefined && lengthMs < SHORT_TAIL_MS;
        if (!shortTail) {
          throw new TranscriberError(
            'provider_error',
            false,
            `piece ${String(index + 1)} of ${String(chunks.length)} came back empty`,
          );
        }
        anomaly = 'empty_final_piece';
      }
      if (text !== '') texts.push(text);
      durationMs = Math.max(durationMs, chunk.offsetMs + pieceMs);
      if (
        language === undefined &&
        result.language !== undefined &&
        LangSchema.safeParse(result.language).success
      ) {
        language = result.language;
      }
      trace({
        event: 'transcriber.chunk',
        index,
        of: chunks.length,
        offsetMs: chunk.offsetMs,
        bytes: chunk.bytes.byteLength,
        segments: kept,
        ...(anomaly === undefined ? {} : { anomaly }),
      });
    }

    if (texts.length === 0 || segments.length === 0) {
      throw new TranscriberError(
        'validation',
        false,
        'empty transcript: the provider returned no speech',
      );
    }
    const out = TranscriptSchema.safeParse({
      text: texts.join(' '),
      ...(language === undefined ? {} : { language }),
      durationMs,
      segments,
    });
    if (!out.success) {
      throw new TranscriberError('validation', false, 'the stitched transcript failed validation');
    }
    return out.data;
  }

  return Object.freeze({ model: modelId, transcribe });
}
