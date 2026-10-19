// Task 2.7: every transcription attempt writes exactly one usage row through 2.4's meter, on
// success and on failure. The port reports no usage, so each row is unknown (no_usage_reported),
// never a free call. A failing sink is logged, never thrown at the caller.
import { describe, expect, it } from 'vitest';
import {
  createMeter,
  meterTranscriber,
  type MeterContext,
  type MeteringWarning,
  type MeterSink,
  type UnmeteredUsage,
} from '../../src/metering/index.js';
import { parsePriceTable } from '../../src/pricing/index.js';
import { createScriptedTranscriber } from '../../src/testing/scriptedTranscriber.js';
import { TranscriberError } from '../../src/transcriber/errors.js';
import { sixtyMinuteInput, sixtyMinuteTranscript } from '../fixtures/transcriber/sixty-minutes.js';

const PRICES = parsePriceTable(`
whisper-1:
  inputUsdPerMillion: 1
  outputUsdPerMillion: 1
`);

const CTX: MeterContext = {
  teacherId: 'tch_a',
  packageId: 'pkg_a',
  studentId: 'stu_a',
  turnId: 'job_1',
  source: 'teacher_preview',
};

function sink(fail = false) {
  const flagged: UnmeteredUsage[] = [];
  let recorded = 0;
  const s: MeterSink = {
    record() {
      recorded += 1;
      return Promise.resolve();
    },
    recordUnmetered(u) {
      flagged.push(u);
      return fail
        ? Promise.reject(new Error(`db down ${sixtyMinuteInput.url}`))
        : Promise.resolve();
    },
  };
  return { s, flagged, recorded: () => recorded };
}

describe('meterTranscriber', () => {
  it('a successful call writes one unknown row on the transcriber model and returns the transcript unchanged', async () => {
    const { s, flagged, recorded } = sink();
    const meter = createMeter(s, CTX, PRICES);
    const inner = createScriptedTranscriber([{ transcript: sixtyMinuteTranscript() }], {
      model: 'whisper-1',
    });
    const t = meterTranscriber(inner, meter);
    expect(t.model).toBe('whisper-1');

    const out = await t.transcribe(sixtyMinuteInput);
    await meter.settled();

    expect(out).toEqual(sixtyMinuteTranscript());
    expect(recorded()).toBe(0);
    expect(flagged).toEqual([
      { ...CTX, reason: 'no_usage_reported', tier: 'main', model: 'whisper-1' },
    ]);
    // Ids, the model and a reason only: never the URL or transcript text.
    expect(JSON.stringify(flagged).includes('storage.edmate.invalid')).toBe(false);
    expect(JSON.stringify(flagged).includes('Minute')).toBe(false);
  });

  it('a failed call still writes exactly one row, and the caller sees the same error', async () => {
    const { s, flagged } = sink();
    const meter = createMeter(s, CTX, PRICES);
    const failure = new TranscriberError('rate_limited', true, 'rate limited');
    const t = meterTranscriber(
      createScriptedTranscriber([{ error: failure }], { model: 'whisper-1' }),
      meter,
    );
    await expect(t.transcribe(sixtyMinuteInput)).rejects.toBe(failure);
    await meter.settled();
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.reason).toBe('no_usage_reported');
  });

  it('one row per attempt across several calls', async () => {
    const { s, flagged } = sink();
    const meter = createMeter(s, CTX, PRICES);
    const t = meterTranscriber(
      createScriptedTranscriber([
        { transcript: sixtyMinuteTranscript() },
        { error: new Error('x') },
      ]),
      meter,
    );
    await t.transcribe(sixtyMinuteInput);
    await t.transcribe(sixtyMinuteInput).catch(() => undefined);
    await t.transcribe(sixtyMinuteInput).catch(() => undefined); // script ran out: still an attempt
    await meter.settled();
    expect(flagged.map((f) => f.model)).toEqual([
      'scripted-transcriber',
      'scripted-transcriber',
      'scripted-transcriber',
    ]);
  });

  it('a failing sink is one warning naming the method, and never reaches the caller', async () => {
    const { s } = sink(true);
    const warnings: MeteringWarning[] = [];
    const meter = createMeter(s, CTX, PRICES, { warn: (w) => warnings.push(w) });
    const t = meterTranscriber(
      createScriptedTranscriber([{ transcript: sixtyMinuteTranscript() }]),
      meter,
    );
    await expect(t.transcribe(sixtyMinuteInput)).resolves.toBeDefined();
    await meter.settled();
    expect(warnings).toEqual([{ event: 'metering.failed', method: 'transcribe', error: 'Error' }]);
  });
});
