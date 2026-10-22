// The publish-gate worker (task 8.7 Phase C): the BullMQ Worker for `edmate-gate` and the live
// gate composition (`livePrepareGate`). One gate job at a time (a full-scope gate is up to 2 h of
// model calls); cases inside a run go `GATE_CONCURRENCY` at once.
//
// `livePrepareGate` fails closed, with a reason, before any model call: no usable model config
// (models.ts), a run pinned to a different judge than this worker's, a missing content dir or
// locale pack, or a missing/empty suites dir (input.ts). It loads the content per run, so a fixed
// content dir is picked up without a restart.
import { statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import {
  loadLocalePacks,
  pickLocalePack,
  readPersonaLibrary,
  readPromptPackLibrary,
} from '@edmate/content';
import { type Repositories, retrievalIndexFor } from '@edmate/db';
import { GATE_CONCURRENCY, judgeModelLabel, type ChangeKind } from '@edmate/evals';
import { GATE_QUEUE, type JobQueue } from '@edmate/queue';
import { type ConnectionOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { permanentToUnrecoverable } from '../commit/workers.js';
import { describeError, type Log } from '../log.js';
import { gateAgentFactory, type GateAgentDeps } from './agent.js';
import { buildGateInput, GateUnavailableError } from './input.js';
import {
  type Env,
  gateGatewayFor,
  gateJudgeGateway,
  gateModelsFromEnv,
  gatePriceUsage,
} from './models.js';
import { gateSideEffects, gateUsageMeter, systemClock, systemIds } from './ports.js';
import {
  gateProcessor,
  type GateJobLike,
  type GateOutcome,
  type GateProcessorDeps,
  type PrepareGate,
} from './processor.js';

/** `GATE_CONCURRENCY` from the environment: a positive integer up to 32, else the default (logged). */
export function gateConcurrencyFromEnv(env: Env, log: Log): number {
  const raw = env.GATE_CONCURRENCY?.trim();
  if (raw === undefined || raw === '') return GATE_CONCURRENCY;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 32) return n;
  log({ level: 'warn', event: 'gate.concurrency_invalid', fallback: GATE_CONCURRENCY });
  return GATE_CONCURRENCY;
}

/** `EDMATE_CONTENT_DIR`, else the repo's `content/` (the worker runs from apps/worker in dev). */
export function gateContentDir(env: Env): string {
  return env.EDMATE_CONTENT_DIR?.trim() || resolvePath(process.cwd(), '../../content');
}

/** `EDMATE_EVAL_SUITES_DIR`, else the repo's `evals/suites/`. */
export function gateSuitesDir(env: Env): string {
  return env.EDMATE_EVAL_SUITES_DIR?.trim() || resolvePath(process.cwd(), '../../evals/suites');
}

export interface LiveGateOptions {
  env: Env;
  repos: Repositories;
  log: Log;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The content a gate turn needs, or `content_missing` (never a partial or default content set). */
function loadContent(dir: string, marketSetting: string) {
  if (!isDir(dir)) throw new GateUnavailableError('content_missing');
  try {
    const { packs } = loadLocalePacks(join(dir, 'locales'));
    const market = marketSetting || 'global';
    if (!packs.has(market)) throw new GateUnavailableError('content_missing');
    return {
      market,
      packs,
      promptPacks: readPromptPackLibrary(join(dir, 'prompt-packs')),
      personas: readPersonaLibrary(join(dir, 'skills', 'mock_interview')),
    };
  } catch (error) {
    if (error instanceof GateUnavailableError) throw error;
    throw new GateUnavailableError('content_missing');
  }
}

/** The production gate: real models from the environment, the db's read ports, in-memory writes. */
export function livePrepareGate(o: LiveGateOptions): PrepareGate {
  return async (run, basis) => {
    const models = await gateModelsFromEnv(o.env);
    if (!models.ok) throw new GateUnavailableError(models.reason);
    const judge = models.models.judge;
    // The run records the judge it was started for; a worker pinned to another one fails closed.
    if (run.judgeModel !== judge.model && run.judgeModel !== judgeModelLabel(judge)) {
      throw new GateUnavailableError('judge_model');
    }
    const content = loadContent(gateContentDir(o.env), o.env.EDMATE_MARKET?.trim() ?? '');
    const meter = gateUsageMeter();
    const effects = gateSideEffects();
    const deps: GateAgentDeps = {
      repos: o.repos,
      retrieval: retrievalIndexFor(o.repos, {}),
      locales: (m) => pickLocalePack(m, content.packs),
      market: content.market,
      packMarket: (m) => (content.packs.has(m) ? m : 'global'),
      promptPacks: content.promptPacks,
      personas: content.personas,
      gatewayFor: gateGatewayFor(models.models, meter),
      priceUsage: gatePriceUsage(models.models),
      usage: meter,
      effects,
      clock: systemClock(),
      ids: systemIds(),
    };
    const firstPackage = basis.packageVersions[0];
    if (firstPackage === undefined) throw new GateUnavailableError('no_packages');
    const input = await buildGateInput({
      repos: o.repos,
      basis,
      changes: run.changes as readonly ChangeKind[],
      suitesDir: gateSuitesDir(o.env),
      agentFor: gateAgentFactory(deps, basis),
      judgeGateway: gateJudgeGateway(models.models, meter, {
        teacherId: basis.teacherId,
        packageId: firstPackage.packageId,
      }),
      judgeModel: judge,
      concurrency: gateConcurrencyFromEnv(o.env, o.log),
      styleSampleSeed: run.basis.styleCardId,
    });
    return { input, usage: () => meter.totals() };
  };
}

export interface GateWorkerOptions {
  readonly connection: ConnectionOptions;
  readonly deps: GateProcessorDeps;
  readonly deadLetter: JobQueue;
  readonly log: Log;
  readonly now?: () => Date;
  /** BullMQ key prefix (tests isolate themselves with one). */
  readonly prefix?: string;
  readonly autorun?: boolean;
}

/** The `edmate-gate` worker: one job at a time; a failed job is dead-lettered like the others. */
export function createGateWorker(o: GateWorkerOptions): Worker {
  const worker = new Worker<unknown, GateOutcome>(
    GATE_QUEUE,
    permanentToUnrecoverable<GateJobLike, GateOutcome>(gateProcessor(o.deps)),
    {
      connection: o.connection,
      autorun: o.autorun ?? false,
      concurrency: 1,
      ...(o.prefix === undefined ? {} : { prefix: o.prefix }),
    },
  );
  const failed = onJobFailed({
    deadLetter: o.deadLetter,
    log: o.log,
    now: o.now ?? (() => new Date()),
  });
  worker.on('failed', (job, error) => {
    void failed(job, error);
  });
  worker.on('error', (error) => {
    o.log({ level: 'error', event: 'worker.error', queue: worker.name, error: describeError(error) });
  });
  return worker;
}
