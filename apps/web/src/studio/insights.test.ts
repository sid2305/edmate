import type { TeacherQuestionGroup, TeacherScope, TurnTraceRow } from '@edmate/db';
import { TEACHER_TRACES_MAX_LIMIT } from '@edmate/db';
import { computeHealthMetrics } from '@edmate/harness';
import { describe, expect, it, vi } from 'vitest';
import { INSIGHTS_TOP_GROUPS, INSIGHTS_WINDOW_DAYS, type InsightsBackend, loadInsights } from './insights.js';

const scope: TeacherScope = { teacherId: 'teacher_1' };

/** A schema-valid, minimal TurnTraceRow fixture (same shape as `health.test.ts`'s own `trace`,
 * plus the row columns `listForTeacherSince` adds). */
function traceRow(x: { steps?: TurnTraceRow['steps']; guards?: TurnTraceRow['guards']; turnId?: string }): TurnTraceRow {
  return {
    id: `row_${x.turnId ?? '1'}`,
    turnId: x.turnId ?? 'turn_1',
    sessionId: 'sess_1',
    agentVersion: 1,
    packageVersion: 1,
    steps: x.steps ?? [],
    intent: 'on_task',
    move: 'explain',
    guards: x.guards ?? [],
    usage: [],
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    costMicroUsd: 0,
    createdAt: '2026-10-20T00:00:00.000Z',
  };
}

function group(x: { groupId: string; count: number; oldestAt: string; questions?: TeacherQuestionGroup['questions'] }): TeacherQuestionGroup {
  return {
    groupId: x.groupId,
    count: x.count,
    oldestAt: x.oldestAt,
    questions: x.questions ?? [{ id: 'q_1', text: 'why is the sky blue', createdAt: x.oldestAt }],
  };
}

function backend(x: { traces?: TurnTraceRow[]; groups?: TeacherQuestionGroup[] } = {}): {
  backend: InsightsBackend;
  listForTeacherSince: ReturnType<typeof vi.fn>;
  listGroupsForTeacher: ReturnType<typeof vi.fn>;
} {
  const listForTeacherSince = vi.fn().mockResolvedValue(x.traces ?? []);
  const listGroupsForTeacher = vi.fn().mockResolvedValue(x.groups ?? []);
  return {
    backend: { turnTraces: { listForTeacherSince }, teacherQuestions: { listGroupsForTeacher } },
    listForTeacherSince,
    listGroupsForTeacher,
  };
}

describe('loadInsights', () => {
  it('computes `since` as 7 days before the injected `now`, not Date.now()', async () => {
    const { backend: b, listForTeacherSince } = backend();
    const now = new Date('2026-10-22T12:00:00.000Z');
    await loadInsights(b, scope, now);
    expect(INSIGHTS_WINDOW_DAYS).toBe(7);
    expect(listForTeacherSince).toHaveBeenCalledWith(scope, '2026-10-15T12:00:00.000Z');
  });

  it('health is exactly computeHealthMetrics(traces) for a fixed trace list', async () => {
    const traces = [
      traceRow({ turnId: 'a', steps: [{ name: 'generate', ms: 100, outcome: 'ok' }] }),
      traceRow({
        turnId: 'b',
        steps: [{ name: 'generate', ms: 200, outcome: 'failed' }],
        guards: [{ name: 'answerLeak', ok: false }],
      }),
    ];
    const { backend: b } = backend({ traces });
    const result = await loadInsights(b, scope, new Date('2026-10-22T00:00:00.000Z'));
    expect(result.health).toEqual(computeHealthMetrics(traces));
  });

  it('capped is true only at exactly TEACHER_TRACES_MAX_LIMIT rows', async () => {
    const full = Array.from({ length: TEACHER_TRACES_MAX_LIMIT }, (_, i) => traceRow({ turnId: `t${i}` }));
    const { backend: b1 } = backend({ traces: full });
    const r1 = await loadInsights(b1, scope);
    expect(r1.capped).toBe(true);

    const short = full.slice(0, TEACHER_TRACES_MAX_LIMIT - 1);
    const { backend: b2 } = backend({ traces: short });
    const r2 = await loadInsights(b2, scope);
    expect(r2.capped).toBe(false);
  });

  it('zero traces -> health.turns === 0, no throw', async () => {
    const { backend: b } = backend({ traces: [] });
    const result = await loadInsights(b, scope);
    expect(result.health.turns).toBe(0);
  });

  it('zero question groups -> topQuestionGroups === []', async () => {
    const { backend: b } = backend({ groups: [] });
    const result = await loadInsights(b, scope);
    expect(result.topQuestionGroups).toEqual([]);
  });

  it('passes INSIGHTS_TOP_GROUPS as the limit and maps each group, sample = first question text', async () => {
    const groups = [
      group({ groupId: 'g1', count: 3, oldestAt: '2026-10-18T00:00:00.000Z' }),
      group({ groupId: 'g2', count: 1, oldestAt: '2026-10-19T00:00:00.000Z', questions: [] }),
    ];
    const { backend: b, listGroupsForTeacher } = backend({ groups });
    const result = await loadInsights(b, scope);
    expect(listGroupsForTeacher).toHaveBeenCalledWith(scope, { limit: INSIGHTS_TOP_GROUPS });
    expect(result.topQuestionGroups).toEqual([
      { groupId: 'g1', count: 3, oldestAt: '2026-10-18T00:00:00.000Z', sample: 'why is the sky blue' },
      { groupId: 'g2', count: 1, oldestAt: '2026-10-19T00:00:00.000Z', sample: '' },
    ]);
  });

  it('never carries a studentId/student_id anywhere in the result (the accept line)', async () => {
    const traces = [traceRow({ turnId: 'a' })];
    const groups = [group({ groupId: 'g1', count: 2, oldestAt: '2026-10-18T00:00:00.000Z' })];
    const { backend: b } = backend({ traces, groups });
    const result = await loadInsights(b, scope);

    function sweep(value: unknown): void {
      if (Array.isArray(value)) {
        for (const v of value) sweep(v);
        return;
      }
      if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value);
        expect(keys).not.toContain('studentId');
        expect(keys).not.toContain('student_id');
        for (const k of keys) sweep((value as Record<string, unknown>)[k]);
      }
    }
    sweep(result);
  });
});
