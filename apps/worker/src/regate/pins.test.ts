import { MODEL_MIX } from '@edmate/gateway';
import { describe, expect, it } from 'vitest';
import { regatePinsFromEnv } from './pins.js';

const KEY = { EDMATE_ANTHROPIC_API_KEY: 'test-only-not-a-key' };
const JUDGE = { EDMATE_JUDGE_MODEL: 'anthropic:claude-sonnet-5' };

const SIGNED_SET = { version: '1.0.0', reviewedBy: 'reviewer', packs: {} };
const library = (sets: (typeof SIGNED_SET)[]) => new Map(sets.map((s) => [s.version, s]));

describe('regatePinsFromEnv', () => {
  it('happy path: the newest signed set, MODEL_MIX.paid and the release judge', async () => {
    const r = await regatePinsFromEnv(
      { ...KEY, ...JUDGE },
      { readPromptPacks: () => library([SIGNED_SET]) as never },
    );
    expect(r).toEqual({
      ok: true,
      pins: {
        promptPackVersion: '1.0.0',
        modelPolicy: MODEL_MIX.paid,
        judgeModel: 'anthropic:claude-sonnet-5',
      },
    });
  });

  it('a missing prompt-pack dir: unavailable, content_missing', async () => {
    const r = await regatePinsFromEnv(
      { ...KEY, ...JUDGE },
      {
        readPromptPacks: () => {
          throw new Error('ENOENT: no such directory');
        },
      },
    );
    expect(r).toEqual({ ok: false, reason: 'content_missing' });
  });

  it('no signed set: unavailable, prompt_pack_unsigned', async () => {
    const r = await regatePinsFromEnv(
      { ...KEY, ...JUDGE },
      { readPromptPacks: () => library([{ ...SIGNED_SET, reviewedBy: 'pending' }]) as never },
    );
    expect(r).toEqual({ ok: false, reason: 'prompt_pack_unsigned' });
  });

  it('no judge key: unavailable, provider_key', async () => {
    const r = await regatePinsFromEnv(
      { ...JUDGE },
      { readPromptPacks: () => library([SIGNED_SET]) as never },
    );
    expect(r).toEqual({ ok: false, reason: 'provider_key' });
  });

  it('EDMATE_DEV_MODEL=scripted: unavailable, dev_model', async () => {
    const r = await regatePinsFromEnv(
      { ...KEY, ...JUDGE, EDMATE_DEV_MODEL: 'scripted' },
      { readPromptPacks: () => library([SIGNED_SET]) as never },
    );
    expect(r).toEqual({ ok: false, reason: 'dev_model' });
  });

  it('no readPromptPacks hook: defaults to the real reader (missing dir is still content_missing)', async () => {
    const r = await regatePinsFromEnv({
      ...KEY,
      ...JUDGE,
      EDMATE_CONTENT_DIR: '/nonexistent-regate-pins-test-dir',
    });
    expect(r).toEqual({ ok: false, reason: 'content_missing' });
  });
});
