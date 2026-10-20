// route's classifier (task 3.3): rules first, the small model only for an inconclusive intent.
import type { Entitled, RouteResult, StepEnv } from '../pipeline/types.js';
import { classifyAttempt, classifyIntentByRules } from './classify.js';
import { askIntentModel } from './modelFallback.js';

export {
  answerKeyOf,
  classifyAttempt,
  classifyIntentByRules,
  isAnswerShaped,
  normaliseText,
  type RuleIntent,
} from './classify.js';
export {
  askIntentModel,
  buildRouteIntentRequest,
  ROUTE_MODEL_TIMEOUT_MS,
  RouteCancelledError,
  RouteIntentVerdictSchema,
  RouteModelInvalidError,
  RouteModelTimeoutError,
} from './modelFallback.js';

/**
 * Intent and attempt for the turn's scrubbed input. Rejects only when the model fallback fails
 * (the runner's route fallback then applies). `usage` is always empty: see modelFallback.ts.
 */
export async function classifyTurn(env: StepEnv, s: Entitled): Promise<RouteResult> {
  const { text, kind } = env.input;
  const attempt = classifyAttempt({ text, kind }, s.helpState);
  const rule = classifyIntentByRules(text, kind);
  const intent =
    rule.confident || text === undefined
      ? rule.intent
      : await askIntentModel(env, s.pkg.name, text);
  return { intent, attempt, usage: [] };
}
