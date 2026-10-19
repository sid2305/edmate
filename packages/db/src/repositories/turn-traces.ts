import { randomUUID } from 'node:crypto';
import { TurnTraceSchema, type TurnTrace } from '@edmate/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { sessions, turnTraces } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { checked, iso } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';
import { ownSession } from './sessions.js';

/** A stored trace: the whole TurnTrace contract plus its row id, time and usage summary. */
export interface TurnTraceRow extends TurnTrace {
  id: string;
  /** The distinct models in `usage`, comma-separated; '' when the turn made no model call. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  createdAt: string;
}

/** The summary columns kept from 1.1's table, derived from `usage` (never taken from a caller). */
function summary(t: TurnTrace) {
  let inputTokens = 0;
  let outputTokens = 0;
  let costMicroUsd = 0;
  for (const u of t.usage) {
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    costMicroUsd += u.costMicroUsd;
  }
  const model = [...new Set(t.usage.map((u) => u.model))].join(',');
  return { model, inputTokens, outputTokens, costMicroUsd };
}

const Stored = TurnTraceSchema.omit({ sessionId: true, turnId: true });

export function turnTracesRepo(db: Db) {
  return {
    /**
     * Records a turn's trace on the scope's session (`trace.sessionId`); another scope's session
     * is `not_found`. One trace per turn: a second trace for the same `turnId` is `invalid`.
     */
    async insert(scope: StudentScope, trace: TurnTrace): Promise<void> {
      const method = 'turnTraces.insert';
      const sc = studentScope(scope, method);
      const t = parseArg(TurnTraceSchema, trace, method);
      const s = parseArg(
        z.strictObject({
          model: z.string(),
          inputTokens: z.int().min(0).max(2_147_483_647),
          outputTokens: z.int().min(0).max(2_147_483_647),
          costMicroUsd: z.int().min(0),
        }),
        summary(t),
        method,
      );
      const result = await translateWrite(method, () =>
        db.execute(
          insertSelect(
            turnTraces,
            [
              [turnTraces.id, sql`${randomUUID()}::text`],
              [turnTraces.sessionId, sql`${sessions.id}`],
              [turnTraces.turnId, sql`${t.turnId}::text`],
              [turnTraces.agentVersion, sql`${t.agentVersion}::integer`],
              [turnTraces.packageVersion, sql`${t.packageVersion}::integer`],
              [turnTraces.steps, sql`${JSON.stringify(t.steps)}::jsonb`],
              [turnTraces.intent, sql`${t.intent}::text`],
              [turnTraces.move, sql`${t.move}::text`],
              [turnTraces.guards, sql`${JSON.stringify(t.guards)}::jsonb`],
              [turnTraces.usage, sql`${JSON.stringify(t.usage)}::jsonb`],
              [turnTraces.model, sql`${s.model}::text`],
              [turnTraces.inputTokens, sql`${s.inputTokens}::integer`],
              [turnTraces.outputTokens, sql`${s.outputTokens}::integer`],
              [turnTraces.costMicroUsd, sql`${s.costMicroUsd}::bigint`],
            ],
            sql`from ${sessions} where ${ownSession(t.sessionId, sc)}`,
          ),
        ),
      );
      if (written(result) !== 1) throw new RepositoryError('not_found', method);
    },

    /** The scope's session's traces, oldest first; another scope's session reads as empty. */
    async listForSession(scope: StudentScope, sessionId: string): Promise<TurnTraceRow[]> {
      const method = 'turnTraces.listForSession';
      const sc = studentScope(scope, method);
      const id = parseArg(IdSchema, sessionId, method);
      const rows = await db
        .select({
          id: turnTraces.id,
          sessionId: turnTraces.sessionId,
          turnId: turnTraces.turnId,
          agentVersion: turnTraces.agentVersion,
          packageVersion: turnTraces.packageVersion,
          steps: turnTraces.steps,
          intent: turnTraces.intent,
          move: turnTraces.move,
          guards: turnTraces.guards,
          usage: turnTraces.usage,
          model: turnTraces.model,
          inputTokens: turnTraces.inputTokens,
          outputTokens: turnTraces.outputTokens,
          costMicroUsd: turnTraces.costMicroUsd,
          createdAt: turnTraces.createdAt,
        })
        .from(turnTraces)
        .innerJoin(sessions, eq(sessions.id, turnTraces.sessionId))
        .where(and(eq(turnTraces.sessionId, id), ownSession(id, sc)))
        .orderBy(asc(turnTraces.createdAt), asc(turnTraces.id));
      return rows.map((r) => {
        const { steps, intent, move, guards, usage, agentVersion, packageVersion } = r;
        const c = checked(
          Stored,
          { steps, intent, move, guards, usage, agentVersion, packageVersion },
          method,
        );
        return { ...r, ...c, createdAt: iso(r.createdAt) };
      });
    },
  };
}
