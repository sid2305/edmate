// The web's turn composition (task 9.4), mirroring apps/cli's chat deps.ts over the real
// database, queues and gateway. Process-wide parts (entitlements, config, retrieval, limits,
// queues, gateway factories) are built once; `turnDepsFor` binds one turn's student x teacher.
import { randomUUID } from 'node:crypto';
import type {
  EntitlementStore,
  LocalePack,
  RetrievalIndex,
  TurnConfigStore,
} from '@edmate/contracts';
import {
  entitlementStoreFor,
  profileStoreFor,
  retrievalIndexFor,
  teacherQuestionStoreFor,
  transcriptStoreFor,
  turnConfigStoreFor,
  type Repositories,
  type StudentScope,
} from '@edmate/db';
import {
  computeCostMicroUsd,
  createRouter,
  meterRouter,
  type PriceTable,
  type ProviderAdapterFactories,
} from '@edmate/gateway';
import {
  hasDistressKeyword,
  type Clock,
  type IdKind,
  type IdSource,
  type PersonaLibrary,
  type PipelineDeps,
  type PromptPackLibrary,
  type TurnLimits,
} from '@edmate/harness';
import { queuedTurnPorts, type TurnQueues } from '@edmate/queue';
import { webFallbackReplies } from './fallbackReplies';
import type { ServerLog } from './routes';

/** A real clock: `Date.now()` and a cancellable `setTimeout` sleep. */
export function systemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms, cancel) =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        cancel?.onCancel(() => {
          clearTimeout(t);
          resolve();
        });
      }),
  };
}

/** Real ids: `crypto.randomUUID()`, prefixed by kind (contracts ids allow `_`). */
export function systemIds(): IdSource {
  return { next: (kind: IdKind) => `${kind}_${randomUUID()}` };
}

export interface ProcessPortOptions {
  /**
   * The signed-in student's own market (9.4a: `users.market`), asked fresh at every subscription
   * resolve. It is the only market a student turn runs in; no deploy setting picks it.
   */
  studentMarket(studentId: string): Promise<string>;
  packMarket(market: string): string;
  locales(market: string): LocalePack | null;
  /** The age gate's standing, asked fresh at every resolve (second line behind the route guard). */
  learnerClear(studentId: string): Promise<boolean>;
}

/** The ports that are the same for every turn. Retrieval is full text (no embedder yet). */
export function processPorts(
  repos: Repositories,
  opts: ProcessPortOptions,
): { entitlements: EntitlementStore; turnConfig: TurnConfigStore; retrieval: RetrievalIndex } {
  return {
    entitlements: entitlementStoreFor(repos, {
      // Read only by a `teacher_preview` resolve, which a student turn never makes (9.4a).
      market: 'global',
      studentMarket: opts.studentMarket,
      packMarket: opts.packMarket,
      learnerClear: opts.learnerClear,
    }),
    turnConfig: turnConfigStoreFor(repos, { locales: opts.locales }),
    retrieval: retrievalIndexFor(repos, {}),
  };
}

/** What `turnDepsFor` needs, built once per process. */
export interface TurnProcess {
  repos: Repositories;
  queues: Pick<TurnQueues, 'meter' | 'commit' | 'alert' | 'safetyEvent'>;
  limits: TurnLimits;
  factories: ProviderAdapterFactories;
  prices: PriceTable;
  promptPacks: PromptPackLibrary;
  /** The signed role-play personas (`content/skills/mock_interview`, 5.8a). */
  personas: PersonaLibrary;
  entitlements: EntitlementStore;
  turnConfig: TurnConfigStore;
  retrieval: RetrievalIndex;
  clock: Clock;
  ids: IdSource;
  log: ServerLog;
}

/** One turn's `PipelineDeps` for the signed-in student and the agent's teacher. */
export function turnDepsFor(p: TurnProcess, scope: StudentScope): PipelineDeps {
  const ports = queuedTurnPorts(
    p.queues,
    scope,
    transcriptStoreFor(p.repos, scope),
    profileStoreFor(p.repos, scope),
  );
  return {
    clock: p.clock,
    ids: p.ids,
    // Metered here, into the turn's queued usage meter, so the meter step doesn't count twice.
    gatewayFor: (spec) => ({
      gateway: meterRouter(createRouter(spec.policy, p.factories), ports.usage, spec.billing, p.prices),
      metered: true,
    }),
    priceUsage: (u) => computeCostMicroUsd(p.prices, u.model, u.inputTokens, u.outputTokens),
    log: {
      // Ids and the error's name only; never the message, which may quote content.
      backgroundFailure: (e) =>
        p.log.error('turn.background_failed', {
          task: e.task,
          error: e.errorName,
          turnId: e.turnId ?? '',
        }),
    },
    entitlements: p.entitlements,
    turnConfig: p.turnConfig,
    entitlementSource: 'subscription',
    limits: p.limits,
    profiles: ports.profiles,
    transcripts: ports.transcripts,
    sessionState: ports.sessionState,
    usage: ports.usage,
    traces: ports.traces,
    alerts: ports.alerts,
    safetyEvents: ports.safetyEvents,
    retrieval: p.retrieval,
    teacherQuestions: teacherQuestionStoreFor(p.repos, scope),
    fallbackReplies: webFallbackReplies(),
    promptPacks: p.promptPacks,
    personas: p.personas,
    distressCheck: (text, lang) => hasDistressKeyword(text, lang),
  };
}
