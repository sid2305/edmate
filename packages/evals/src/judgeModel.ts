// The judge model is pinned per release by a human (decision log, 18 Oct 2026) and read from
// EDMATE_JUDGE_MODEL. There is no default: a guessed id could get baked into recorded fixtures.

export interface JudgeModelConfig {
  provider: string;
  model: string;
}

export const JUDGE_MODEL_VARIABLE = 'EDMATE_JUDGE_MODEL';

export class JudgeModelConfigError extends Error {
  override readonly name = 'JudgeModelConfigError';
}

export function resolveJudgeModel(
  env: Readonly<Record<string, string | undefined>> = process.env,
): JudgeModelConfig {
  const raw = (env[JUDGE_MODEL_VARIABLE] ?? '').trim();
  if (raw === '') {
    throw new JudgeModelConfigError(
      `${JUDGE_MODEL_VARIABLE} is not set; set it to "<provider>:<model>" (the judge model pinned for this release) to record`,
    );
  }
  const at = raw.indexOf(':');
  const provider = at < 0 ? '' : raw.slice(0, at).trim();
  const model = at < 0 ? '' : raw.slice(at + 1).trim();
  if (provider === '' || model === '') {
    throw new JudgeModelConfigError(`${JUDGE_MODEL_VARIABLE} must look like "<provider>:<model>"`);
  }
  return { provider, model };
}

export function judgeModelLabel(config: JudgeModelConfig): string {
  return `${config.provider}:${config.model}`;
}
