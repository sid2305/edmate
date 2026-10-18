import { randomUUID } from 'node:crypto';
import { TurnTraceSchema, UsageSchema, type TurnTrace } from '@edmate/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { sessions, turnTraces } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { checked, iso } from './map.js';
import { IdSchema, parseArg, studentScope, type StudentScope } from './scope.js';
import { ownSession } from './sessions.js';

/**
 * The turn_traces table's columns. The full TurnTrace contract (turnId, versions, intent, move,
 * guards, usage[]) needs an additive migration; that belongs to the TraceSink owner (3.8 / 7.7).
 */
export interface TurnTraceInput {
  steps: TurnTrace['steps'];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}
export interface TurnTraceRow extends TurnTraceInput {
  id: string;
  sessionId: string;
  createdAt: string;
}

const Steps = TurnTraceSchema.shape.steps;
const Input = z.strictObject({
  steps: Steps,
  model: UsageSchema.shape.model.min(1),
  inputTokens: UsageSchema.shape.inputTokens,
  outputTokens: UsageSchema.shape.outputTokens,
  costMicroUsd: UsageSchema.shape.costMicroUsd,
});

export function turnTracesRepo(db: Db) {
  return {
    /** Records a trace on the scope's session; another scope's session is `not_found`. */
    async insert(scope: StudentScope, sessionId: string, row: TurnTraceInput): Promise<void> {
      const method = 'turnTraces.insert';
      const sc = studentScope(scope, method);
      const id = parseArg(IdSchema, sessionId, method);
      const t = parseArg(Input, row, method);
      const result = await translateWrite(method, () =>
        db.execute(
          insertSelect(
            turnTraces,
            [
              [turnTraces.id, sql`${randomUUID()}::text`],
              [turnTraces.sessionId, sql`${sessions.id}`],
              [turnTraces.steps, sql`${JSON.stringify(t.steps)}::jsonb`],
              [turnTraces.model, sql`${t.model}::text`],
              [turnTraces.inputTokens, sql`${t.inputTokens}::integer`],
              [turnTraces.outputTokens, sql`${t.outputTokens}::integer`],
              [turnTraces.costMicroUsd, sql`${t.costMicroUsd}::bigint`],
            ],
            sql`from ${sessions} where ${ownSession(id, sc)}`,
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
          steps: turnTraces.steps,
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
      return rows.map((r) => ({
        ...r,
        steps: checked(Steps, r.steps, method),
        createdAt: iso(r.createdAt),
      }));
    },
  };
}
