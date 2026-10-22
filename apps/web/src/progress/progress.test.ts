// Task 9.6 Phase B: `buildProgress` is a pure function (no I/O, rule 4 doesn't even apply).
import type { LearnerProfile } from '@edmate/contracts';
import type { Outline } from '@edmate/db';
import { describe, expect, it } from 'vitest';
import { buildProgress } from './progress';

function outline(modules: Outline['modules']): Outline {
  return { courseId: 'crs_1', outlineVersion: 1, modules };
}

const OUTLINE = outline([
  {
    id: 'mod_2',
    title: 'Module Two',
    order: 1,
    topics: [
      { id: 'top_b', title: 'Topic B', order: 0, chunkIds: [] },
      { id: 'top_a', title: 'Topic A', order: 1, chunkIds: [] },
    ],
  },
  {
    id: 'mod_1',
    title: 'Module One',
    order: 0,
    topics: [{ id: 'top_c', title: 'Topic C', order: 0, chunkIds: [] }],
  },
]);

function profile(mastery: LearnerProfile['mastery']): LearnerProfile {
  return { studentId: 'std_1', teacherId: 'tch_1', lang: 'en', mastery, mistakes: [] };
}

describe('buildProgress', () => {
  it('orders modules and topics by outline order, titles only', () => {
    const p = buildProgress({ outline: OUTLINE, profile: null, allowedModuleIds: [] });
    expect(p.modules.map((m) => m.id)).toEqual(['mod_1', 'mod_2']);
    expect(p.modules[1]!.topics.map((t) => t.id)).toEqual(['top_b', 'top_a']);
    for (const m of p.modules) {
      expect(Object.keys(m)).toEqual(['id', 'title', 'topics']);
      for (const t of m.topics) expect(Object.keys(t)).toEqual(['id', 'title', 'state']);
    }
  });

  it('states a topic mastered at p >= 0.95, practising at n >= 1, else not_started', () => {
    const ts = '2026-10-01T00:00:00.000Z';
    const p = buildProgress({
      outline: OUTLINE,
      profile: profile({
        top_c: { p: 0.95, n: 5, updatedAt: ts },
        top_b: { p: 0.5, n: 2, updatedAt: ts },
        top_a: { p: 0, n: 0, updatedAt: ts },
      }),
      allowedModuleIds: [],
    });
    const byId = Object.fromEntries(p.modules.flatMap((m) => m.topics).map((t) => [t.id, t.state]));
    expect(byId).toEqual({ top_c: 'mastered', top_b: 'practising', top_a: 'not_started' });
  });

  it('counts topics covered (n >= 1) and mastered', () => {
    const ts = '2026-10-01T00:00:00.000Z';
    const p = buildProgress({
      outline: OUTLINE,
      profile: profile({
        top_c: { p: 0.95, n: 5, updatedAt: ts },
        top_b: { p: 0.5, n: 2, updatedAt: ts },
      }),
      allowedModuleIds: [],
    });
    expect(p.counts).toEqual({ topicsCovered: 2, topicsMastered: 1 });
  });

  it('next steps: at most 3, allowed modules only, practising first then not-started, outline order', () => {
    const ts = '2026-10-01T00:00:00.000Z';
    const p = buildProgress({
      outline: OUTLINE,
      profile: profile({ top_b: { p: 0.5, n: 1, updatedAt: ts } }),
      allowedModuleIds: ['mod_1', 'mod_2'],
    });
    expect(p.nextSteps.map((s) => s.id)).toEqual(['top_b', 'top_c', 'top_a']);
    expect(p.nextSteps.length).toBeLessThanOrEqual(3);
  });

  it('next steps exclude topics of a module not in allowedModuleIds', () => {
    const p = buildProgress({ outline: OUTLINE, profile: null, allowedModuleIds: ['mod_2'] });
    expect(p.nextSteps.every((s) => s.moduleId === 'mod_2')).toBe(true);
    expect(p.nextSteps.map((s) => s.id)).toEqual(['top_b', 'top_a']);
  });

  it('caps next steps at 3 even with more candidates', () => {
    const big = outline([
      {
        id: 'mod_1',
        title: 'M1',
        order: 0,
        topics: Array.from({ length: 5 }, (_, i) => ({
          id: `top_${i}`,
          title: `T${i}`,
          order: i,
          chunkIds: [],
        })),
      },
    ]);
    const p = buildProgress({ outline: big, profile: null, allowedModuleIds: ['mod_1'] });
    expect(p.nextSteps).toHaveLength(3);
    expect(p.nextSteps.map((s) => s.id)).toEqual(['top_0', 'top_1', 'top_2']);
  });

  it('mastery for a topic no longer in the outline goes to `other` by id', () => {
    const ts = '2026-10-01T00:00:00.000Z';
    const p = buildProgress({
      outline: OUTLINE,
      profile: profile({ top_gone: { p: 0.99, n: 9, updatedAt: ts } }),
      allowedModuleIds: [],
    });
    expect(p.other).toEqual(['top_gone']);
  });

  it('a null profile is all not_started with no next steps limited by that', () => {
    const p = buildProgress({ outline: OUTLINE, profile: null, allowedModuleIds: ['mod_1', 'mod_2'] });
    expect(p.modules.flatMap((m) => m.topics).every((t) => t.state === 'not_started')).toBe(true);
    expect(p.counts).toEqual({ topicsCovered: 0, topicsMastered: 0 });
    expect(p.other).toEqual([]);
  });

  it('no outline gives the empty state', () => {
    const p = buildProgress({ outline: null, profile: profile({}), allowedModuleIds: ['mod_1'] });
    expect(p).toEqual({
      modules: [],
      counts: { topicsCovered: 0, topicsMastered: 0 },
      nextSteps: [],
      other: [],
    });
  });
});
