// The regate sweep's job (task 13.regate, Phase B): for every live agent whose material changed
// since its last passed, published gate run and has no run already started at the current
// revision (packages/db's `liveAgentsWithMaterialChange`), compute the same pins a manual publish
// uses and call the same `publish.startRun` + `enqueueGate` contract 8.7 Phase D uses.
//
// Sequential, never `Promise.all` (design note, lessons.md): two writers that lock the same rows
// in a different order deadlock; looping across different teachers adds no new lock-order risk,
// same as the cost-alarm worker's per-teacher loop.
import { PublishRefusedError, RepositoryError, type Repositories } from '@edmate/db';
import type { GateJob } from '@edmate/queue';
import { describeError, type Log } from '../log.js';
import type { PinsResult } from './pins.js';

export interface RegateCandidate {
  teacherId: string;
  agentId: string;
}

/** What the sweep job needs; a narrow, fake-able interface (rule 4: no real db or queue in tests). */
export interface RegateSweepDeps {
  /** `regateRepo(db).liveAgentsWithMaterialChange()`. */
  candidates(): Promise<RegateCandidate[]>;
  repos: {
    styleCards: Pick<Repositories['styleCards'], 'latest'>;
    courses: Pick<Repositories['courses'], 'ensureDefault'>;
    publish: Pick<Repositories['publish'], 'startRun' | 'finishRun'>;
  };
  pins(): Promise<PinsResult>;
  enqueue(job: GateJob): Promise<void>;
  log: Log;
}

export interface RegateSweepSummary {
  candidates: number;
  started: number;
  skipped: number;
  failed: number;
}

function errorReason(error: unknown): string {
  if (error instanceof PublishRefusedError) return error.reason;
  if (error instanceof RepositoryError) return error.kind;
  return describeError(error).name;
}

/** The sweep's processor: one run over the current candidate list. */
export function regateSweepJob(deps: RegateSweepDeps): () => Promise<RegateSweepSummary> {
  return async () => {
    const candidates = await deps.candidates();
    if (candidates.length === 0) {
      const summary = { candidates: 0, started: 0, skipped: 0, failed: 0 };
      deps.log({ level: 'info', event: 'regate_sweep.run', ...summary });
      return summary;
    }

    const pins = await deps.pins();
    if (!pins.ok) {
      deps.log({ level: 'error', event: 'regate_sweep.pins_unavailable', reason: pins.reason });
      const summary = { candidates: candidates.length, started: 0, skipped: 0, failed: 0 };
      deps.log({ level: 'warn', event: 'regate_sweep.run', ...summary });
      return summary;
    }

    let started = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const scope = { teacherId: candidate.teacherId };
      try {
        // Sequential, like 8.7n's own chain: `ensureDefault` writes, so it stays gated behind
        // the style-card check (no default course created for a candidate about to be skipped).
        const card = await deps.repos.styleCards.latest(scope);
        if (card === null) {
          skipped += 1;
          deps.log({
            level: 'warn',
            event: 'regate_sweep.candidate_skipped',
            teacherId: candidate.teacherId,
            agentId: candidate.agentId,
            reason: 'style_card_required',
          });
          continue;
        }
        const course = await deps.repos.courses.ensureDefault(scope);
        const run = await deps.repos.publish.startRun(scope, {
          agentId: candidate.agentId,
          courseId: course.id,
          styleCardId: card.id,
          promptPackVersion: pins.pins.promptPackVersion,
          modelPolicy: pins.pins.modelPolicy,
          judgeModel: pins.pins.judgeModel,
        });
        try {
          await deps.enqueue({ runId: run.id, teacherId: candidate.teacherId });
          started += 1;
        } catch (error) {
          failed += 1;
          deps.log({
            level: 'error',
            event: 'regate_sweep.enqueue_failed',
            teacherId: candidate.teacherId,
            agentId: candidate.agentId,
            runId: run.id,
            error: describeError(error),
          });
          try {
            await deps.repos.publish.finishRun(scope, {
              runId: run.id,
              status: 'error',
              summary: { groups: [], errorCode: 'enqueue_failed' },
            });
          } catch (finishError) {
            deps.log({
              level: 'error',
              event: 'regate_sweep.finish_failed',
              teacherId: candidate.teacherId,
              runId: run.id,
              error: describeError(finishError),
            });
          }
        }
      } catch (error) {
        skipped += 1;
        deps.log({
          level: 'warn',
          event: 'regate_sweep.candidate_refused',
          teacherId: candidate.teacherId,
          agentId: candidate.agentId,
          reason: errorReason(error),
        });
      }
    }

    const summary = { candidates: candidates.length, started, skipped, failed };
    deps.log({
      level: failed > 0 || skipped > 0 ? 'warn' : 'info',
      event: 'regate_sweep.run',
      ...summary,
    });
    return summary;
  };
}
