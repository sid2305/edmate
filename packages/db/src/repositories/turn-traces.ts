import { randomUUID } from 'node:crypto';
import { TurnTraceSchema, type TurnTrace } from '@edmate/contracts';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client.js';
import { sessions, turnTraces } from '../schema/index.js';
import { RepositoryError, translateWrite } from './errors.js';
import { insertSelect, written } from './insert.js';
import { checked, iso } from './map.js';
import {
  IdSchema,
  parseArg,
  studentScope,
  teacherScope,
  type StudentScope,
  type TeacherScope,
} from './scope.js';
import { ownSession } from './sessions.js';

/** Largest page of a teacher's traces read in one call (`listForTeacherSince`). */
export const TEACHER_TRACES_MAX_LIMIT = 200;
const Since = z.iso.datetime({ offset: true });
const Limit = z.int().min(1).max(TEACHER_TRACES_MAX_LIMIT);

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
const TurnRef = z.strictObject({ sessionId: IdSchema, turnId: IdSchema });

const COLUMNS = {
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
};

type Selected = { [K in keyof typeof COLUMNS]: (typeof COLUMNS)[K]['_']['data'] };

/** A selected row as a TurnTraceRow; jsonb that no longer parses is `integrity`. */
function toRow(r: Selected, method: string): TurnTraceRow {
  const { steps, intent, move, guards, usage, agentVersion, packageVersion } = r;
  const c = checked(
    Stored,
    { steps, intent, move, guards, usage, agentVersion, packageVersion },
    method,
  );
  return { ...r, ...c, createdAt: iso(r.createdAt) };
}

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
        .select(COLUMNS)
        .from(turnTraces)
        .innerJoin(sessions, eq(sessions.id, turnTraces.sessionId))
        .where(and(eq(turnTraces.sessionId, id), ownSession(id, sc)))
        .orderBy(asc(turnTraces.createdAt), asc(turnTraces.id));
      return rows.map((r) => toRow(r, method));
    },

    /**
     * One turn's trace on one of the scope's sessions, or null (missing, or another scope's).
     * A worker retry uses it to tell it already wrote the trace (task 3.8); the turn_id index
     * serves it.
     */
    async findForTurn(
      scope: StudentScope,
      ref: { sessionId: string; turnId: string },
    ): Promise<TurnTraceRow | null> {
      const method = 'turnTraces.findForTurn';
      const sc = studentScope(scope, method);
      const { sessionId, turnId } = parseArg(TurnRef, ref, method);
      const [row] = await db
        .select(COLUMNS)
        .from(turnTraces)
        .innerJoin(sessions, eq(sessions.id, turnTraces.sessionId))
        .where(
          and(
            eq(turnTraces.turnId, turnId),
            eq(turnTraces.sessionId, sessionId),
            ownSession(sessionId, sc),
          ),
        )
        .limit(1);
      return row ? toRow(row, method) : null;
    },

    /**
     * The newest `limit` traces (default `TEACHER_TRACES_MAX_LIMIT`) of the scope's teacher's
     * traces across every session, created at or after `since`, returned oldest first: the
     * health-metrics read (task 7.7), mirroring `usageLedger.sumForTeacherSince`'s
     * join-on-session-ownership shape. Another teacher's traces never appear.
     */
    async listForTeacherSince(
      scope: TeacherScope,
      since: string,
      limit = TEACHER_TRACES_MAX_LIMIT,
    ): Promise<TurnTraceRow[]> {
      const method = 'turnTraces.listForTeacherSince';
      const sc = teacherScope(scope, method);
      const from = new Date(parseArg(Since, since, method));
      const lim = parseArg(Limit, limit, method);
      const rows = await db
        .select(COLUMNS)
        .from(turnTraces)
        .innerJoin(sessions, eq(sessions.id, turnTraces.sessionId))
        .where(and(eq(sessions.teacherId, sc.teacherId), gte(turnTraces.createdAt, from)))
        .orderBy(desc(turnTraces.createdAt), desc(turnTraces.id))
        .limit(lim);
      return rows.map((r) => toRow(r, method)).reverse();
    },
  };
}
