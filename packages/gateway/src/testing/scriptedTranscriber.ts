// Scripted Transcriber (task 2.7): replays hand-written transcripts so ingestion tests (5.1/5.2)
// never call a real speech-to-text API (rule 4). One entry per call, in order. Every input is
// checked with TranscribeInputSchema and every scripted transcript with TranscriptSchema, exactly
// like the real adapter, so a fixture that the real adapter could never return fails loudly.
import {
  TranscribeInputSchema,
  TranscriptSchema,
  type TranscribeInput,
  type Transcriber,
  type Transcript,
} from '@edmate/contracts';

/** A transcript to return, or an error to throw (standing in for a provider failure). */
export type ScriptedTranscription = { readonly transcript: unknown } | { readonly error: Error };

/** The script has no usable entry for this call: a test bug, never a silent empty result. */
export class ScriptedTranscriberError extends Error {
  override readonly name = 'ScriptedTranscriberError';

  constructor(
    readonly callIndex: number,
    what: 'no entry left' | 'invalid input' | 'invalid transcript',
  ) {
    // Never the URL: even a scripted one is shaped like a signed URL.
    super(`ScriptedTranscriber: ${what} for call ${String(callIndex)}`);
  }
}

export interface ScriptedTranscriber extends Transcriber {
  readonly model: string;
  /** Every input received, in order. */
  readonly calls: readonly TranscribeInput[];
  /** Entries not used yet. */
  remaining(): number;
}

export function createScriptedTranscriber(
  script: readonly ScriptedTranscription[],
  opts: { readonly model?: string } = {},
): ScriptedTranscriber {
  const queue = [...script];
  const calls: TranscribeInput[] = [];
  return {
    model: opts.model ?? 'scripted-transcriber',
    calls,
    remaining: () => queue.length,
    transcribe(i: TranscribeInput): Promise<Transcript> {
      const index = calls.length;
      const input = TranscribeInputSchema.safeParse(i);
      if (!input.success) {
        return Promise.reject(new ScriptedTranscriberError(index, 'invalid input'));
      }
      calls.push(input.data);
      const next = queue.shift();
      if (next === undefined) {
        return Promise.reject(new ScriptedTranscriberError(index, 'no entry left'));
      }
      if ('error' in next) return Promise.reject(next.error);
      const out = TranscriptSchema.safeParse(next.transcript);
      if (!out.success) {
        return Promise.reject(new ScriptedTranscriberError(index, 'invalid transcript'));
      }
      return Promise.resolve(out.data);
    },
  };
}
