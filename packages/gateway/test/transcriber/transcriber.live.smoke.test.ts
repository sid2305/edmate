// Live smoke test (`pnpm test:live` only, never `test` or CI): one real Whisper call.
// Needs EDMATE_OPENAI_API_KEY and EDMATE_LIVE_TRANSCRIBE_URL (a signed URL to a short clip of
// synthetic speech in your own storage; never a real class), and optionally
// EDMATE_LIVE_TRANSCRIBE_MIME (default audio/mpeg).
import { TranscriptSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { loadProviderKeys } from '../../src/keys/load.js';
import { envKeySource } from '../../src/keys/source.js';
import { createWhisperTranscriber } from '../../src/transcriber/whisper.js';

const env = process.env;
const live = env['EDMATE_LIVE_TESTS'] === '1' && env['EDMATE_LIVE_TRANSCRIBE_URL'] !== undefined;

describe.skipIf(!live)('live: Whisper transcription', () => {
  it('transcribes a short clip into a non-empty, valid transcript', async () => {
    const url = env['EDMATE_LIVE_TRANSCRIBE_URL']!;
    const keys = await loadProviderKeys({ source: envKeySource(env), required: ['openai'] });
    const t = createWhisperTranscriber(keys.get('openai'), {
      allowedHosts: [new URL(url).host],
    });
    const out = await t.transcribe({
      url,
      mimeType: env['EDMATE_LIVE_TRANSCRIBE_MIME'] ?? 'audio/mpeg',
    });
    expect(TranscriptSchema.parse(out)).toEqual(out);
    expect(out.text.trim().length > 0).toBe(true);
    expect(out.segments.length > 0).toBe(true);
    expect(out.durationMs > 0).toBe(true);
  });
});
