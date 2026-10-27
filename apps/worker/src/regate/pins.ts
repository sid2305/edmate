// The regate sweep's pins (task 13.regate, Phase B): the same pins a teacher's manual publish
// uses (apps/web/src/studio/publishRuntime.ts), computed here because the worker reads its own
// prompt-pack library and judge model already (apps/worker/src/gate/{workers,models}.ts). Never
// throws past the caller: a missing piece returns `{ok: false, reason}` so the sweep job can fail
// closed before any candidate is touched (lessons.md: a silent skip looks like a pass).
import { join } from 'node:path';
import { newestSignedSet, readPromptPackLibrary } from '@edmate/content';
import type { ModelPolicy } from '@edmate/contracts';
import { MODEL_MIX } from '@edmate/gateway';
import { judgeModelLabel } from '@edmate/evals';
import { gateModelsFromEnv, type Env } from '../gate/models.js';
import type { GateUnavailableReason } from '../gate/input.js';

export type PinsUnavailableReason = GateUnavailableReason | 'prompt_pack_unsigned';

export interface RegatePins {
  promptPackVersion: string;
  modelPolicy: ModelPolicy;
  judgeModel: string;
}

export type PinsResult =
  { ok: true; pins: RegatePins } | { ok: false; reason: PinsUnavailableReason };

export interface PinsHooks {
  /** `readPromptPackLibrary`, injectable for tests. */
  readPromptPacks?: (dir: string) => ReturnType<typeof readPromptPackLibrary>;
}

/** `EDMATE_CONTENT_DIR`/prompt-packs, `MODEL_MIX.paid` and the release judge, from the environment. */
export async function regatePinsFromEnv(env: Env, hooks: PinsHooks = {}): Promise<PinsResult> {
  const read = hooks.readPromptPacks ?? readPromptPackLibrary;
  const contentDir = env.EDMATE_CONTENT_DIR?.trim() || join(process.cwd(), '../../content');
  let promptPackVersion: string;
  try {
    const library = read(join(contentDir, 'prompt-packs'));
    const set = newestSignedSet(library);
    if (set === undefined) return { ok: false, reason: 'prompt_pack_unsigned' };
    promptPackVersion = set.version;
  } catch {
    // The error is dropped: it may name the directory's problem, never a teacher's content, but
    // no need (same convention as gate/models.ts's provider-key catch).
    return { ok: false, reason: 'content_missing' };
  }
  const models = await gateModelsFromEnv(env);
  if (!models.ok) return { ok: false, reason: models.reason };
  return {
    ok: true,
    pins: {
      promptPackVersion,
      modelPolicy: MODEL_MIX.paid,
      judgeModel: judgeModelLabel(models.models.judge),
    },
  };
}
