import { randomBytes } from 'node:crypto';
import { JudgeModelConfigError } from '@edmate/evals';
import { KeyConfigError, type ModelAdapter } from '@edmate/gateway';
import { describe, expect, it } from 'vitest';
import { createJudgeGateway } from './judgeGateway.js';

// Generated at runtime so no key-shaped string is ever committed (same as packages/gateway).
const fakeKey = () => 'fake-' + randomBytes(24).toString('hex');

describe('createJudgeGateway (builds adapters only; no call is made)', () => {
  it('builds an Anthropic adapter bound to the pinned model', async () => {
    const gw = (await createJudgeGateway(
      { provider: 'anthropic', model: 'judge-model' },
      { EDMATE_ANTHROPIC_API_KEY: fakeKey() },
    )) as ModelAdapter;
    expect(gw.id).toBe('anthropic');
    expect(gw.model).toBe('judge-model');
  });

  it('builds an OpenAI-compatible adapter at EDMATE_JUDGE_BASE_URL', async () => {
    const gw = (await createJudgeGateway(
      { provider: 'openai-compatible', model: 'org/judge' },
      {
        EDMATE_OPENAI_COMPATIBLE_API_KEY: fakeKey(),
        EDMATE_JUDGE_BASE_URL: 'https://judge.example.invalid/v1',
      },
    )) as ModelAdapter;
    expect(gw.id).toBe('openai-compatible');
    expect(gw.model).toBe('org/judge');
  });

  it('requires EDMATE_JUDGE_BASE_URL for an OpenAI-compatible judge', async () => {
    await expect(
      createJudgeGateway(
        { provider: 'openai-compatible', model: 'm' },
        { EDMATE_OPENAI_COMPATIBLE_API_KEY: fakeKey(), EDMATE_JUDGE_BASE_URL: ' ' },
      ),
    ).rejects.toThrow(/EDMATE_JUDGE_BASE_URL/);
    await expect(
      createJudgeGateway({ provider: 'openai-compatible', model: 'm' }, {}),
    ).rejects.toBeInstanceOf(JudgeModelConfigError);
  });

  it('fails with the key loader error when the provider key is missing', async () => {
    await expect(
      createJudgeGateway({ provider: 'anthropic', model: 'm' }, {}),
    ).rejects.toBeInstanceOf(KeyConfigError);
  });

  it('rejects an unknown provider', async () => {
    await expect(createJudgeGateway({ provider: 'acme', model: 'm' }, {})).rejects.toThrow(
      /unknown judge provider "acme"/,
    );
  });
});
