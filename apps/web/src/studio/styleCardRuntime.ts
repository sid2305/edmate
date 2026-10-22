// Task 8.4a: the style card API's backend, built lazily on the first draft so `next build` and the
// route-coverage test open nothing. Repositories come from the shared auth runtime's database; the
// drafter gateway is the Anthropic router over DEFAULT_MODEL_POLICY, or -- on a local stack with
// EDMATE_DEV_MODEL=scripted (task 9.0, D2) -- a fixed dev draft, so local runs need no key.
//
// Drafting is not metered yet: no usage-ledger row has a teacher-side, studio scope today (the
// same as ingest's drafting). See the 8.4a handoff decisions.
import type { ModelGateway, ModelRequest } from '@edmate/contracts';
import type { Repositories } from '@edmate/db';
import {
  createRouter,
  DEFAULT_MODEL_POLICY,
  type ProviderAdapterFactories,
} from '@edmate/gateway';
import type { ZodType } from 'zod';
import { DEV_MODEL_PREFIX, devModelEnabled } from '../turn/devModel';
import { errorName, TurnUnavailableError, type ServerLog } from '../turn/routes';
import { anthropicFactories, type Env } from '../turn/runtime';
import type { StyleCardBackend } from './styleCardRoutes';

type Drafter = Pick<ModelGateway, 'generateObject'>;

export interface StyleCardHooks {
  repos(): Pick<Repositories, 'styleCards'>;
  log: ServerLog;
  /** Provider factories from the environment; defaults to Anthropic (tests inject a fake). */
  factories?: (env: Env) => Promise<ProviderAdapterFactories>;
}

/** The dev model's draft: fixed text, no tags (always inside the teacher's candidate list). */
export function devStyleCardGateway(): Drafter {
  const draft = {
    text: `${DEV_MODEL_PREFIX} A draft style card from your interview. Edit it to sound like you.`,
    mistakeTags: [],
  };
  return {
    generateObject<T>(_req: ModelRequest, schema: ZodType<T>): Promise<T> {
      const parsed = schema.safeParse(draft);
      return parsed.success
        ? Promise.resolve(parsed.data)
        : Promise.reject(new Error('dev model: no fixed answer fits this schema'));
    },
  };
}

async function build(env: Env, hooks: StyleCardHooks): Promise<Drafter> {
  // Any setting of EDMATE_DEV_MODEL other than `scripted` on a local stack fails closed here.
  if (devModelEnabled(env)) {
    hooks.log.error('studio.style_card_dev_model_on', {});
    return devStyleCardGateway();
  }
  const factories = await (hooks.factories ?? anthropicFactories)(env).catch(() => {
    throw new TurnUnavailableError('provider_key');
  });
  return createRouter(DEFAULT_MODEL_POLICY, factories);
}

/**
 * The style card backend. The gateway is built on first use and memoised; a failure is logged
 * once (its reason code or error name, never a key) and every later call gets the same rejection.
 */
export function createStyleCardRuntime(env: () => Env, hooks: StyleCardHooks): StyleCardBackend {
  let gateway: Promise<Drafter> | undefined;
  return {
    repos: hooks.repos,
    gateway: () => {
      gateway ??= build(env(), hooks).catch((error: unknown) => {
        const reason = error instanceof TurnUnavailableError ? error.reason : errorName(error);
        hooks.log.error('studio.style_card_runtime_unavailable', { reason });
        throw error;
      });
      return gateway;
    },
  };
}
