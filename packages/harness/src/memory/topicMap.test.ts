// Tests for buildTopicMap (task 6.1): unknown-id and cycle rejection, per plan docs/tasks/6.1/plan.md.
import { describe, expect, it } from 'vitest';
import { buildTopicMap, type CourseOutlineInput } from './topicMap.js';

const base = (): CourseOutlineInput => ({
  courseId: 'course-1',
  teacherId: 'teacher-1',
  modules: [
    { moduleId: 'mod-1', title: 'Module 1', order: 0 },
    { moduleId: 'mod-2', title: 'Module 2', order: 1 },
  ],
  topics: [
    { topicId: 'topic-1', moduleId: 'mod-1', title: 'Topic 1', order: 0 },
    { topicId: 'topic-2', moduleId: 'mod-1', title: 'Topic 2', order: 1, prerequisiteTopicIds: ['topic-1'] },
    { topicId: 'topic-3', moduleId: 'mod-2', title: 'Topic 3', order: 0 },
  ],
});

describe('buildTopicMap', () => {
  it('builds a valid outline with correct lookups and topological topicOrder', () => {
    const result = buildTopicMap(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const map = result.value;
    expect(map.courseId).toBe('course-1');
    expect(map.teacherId).toBe('teacher-1');
    expect(map.getModule('mod-1')?.title).toBe('Module 1');
    expect(map.getModule('missing')).toBeUndefined();
    expect(map.getTopic('topic-2')?.prerequisiteTopicIds).toEqual(['topic-1']);
    expect(map.getTopic('missing')).toBeUndefined();
    expect(map.topicsOf('mod-1').map((t) => t.topicId)).toEqual(['topic-1', 'topic-2']);
    expect(map.topicsOf('mod-2').map((t) => t.topicId)).toEqual(['topic-3']);
    // topic-1 must precede topic-2 (prerequisite); topic-3 has no edges, ties broken by
    // (module order, topic order, topicId) so it sorts after mod-1's topics.
    expect(map.topicOrder).toEqual(['topic-1', 'topic-2', 'topic-3']);
  });

  it('defaults skillsBuilt and prerequisiteTopicIds to [] when omitted', () => {
    const result = buildTopicMap(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t1 = result.value.getTopic('topic-1');
    expect(t1?.skillsBuilt).toEqual([]);
    expect(t1?.prerequisiteTopicIds).toEqual([]);
  });

  it('accepts an empty outline', () => {
    const result = buildTopicMap({ courseId: 'c', teacherId: 't', modules: [], topics: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.topicOrder).toEqual([]);
  });

  it('rejects an unknown moduleId', () => {
    const input = base();
    const bad: CourseOutlineInput = {
      ...input,
      topics: [...input.topics, { topicId: 'topic-4', moduleId: 'mod-missing', title: 'T4', order: 0 }],
    };
    const result = buildTopicMap(bad);
    expect(result).toEqual({ ok: false, reason: 'unknown_module', id: 'topic-4' });
  });

  it('rejects an unknown prerequisiteTopicIds entry', () => {
    const input = base();
    const bad: CourseOutlineInput = {
      ...input,
      topics: [
        ...input.topics,
        {
          topicId: 'topic-4',
          moduleId: 'mod-2',
          title: 'T4',
          order: 1,
          prerequisiteTopicIds: ['topic-missing'],
        },
      ],
    };
    const result = buildTopicMap(bad);
    expect(result).toEqual({ ok: false, reason: 'unknown_prerequisite', id: 'topic-4' });
  });

  it('rejects a self-reference (1-cycle)', () => {
    const input: CourseOutlineInput = {
      courseId: 'c',
      teacherId: 't',
      modules: [{ moduleId: 'mod-1', title: 'M1', order: 0 }],
      topics: [
        { topicId: 'topic-1', moduleId: 'mod-1', title: 'T1', order: 0, prerequisiteTopicIds: ['topic-1'] },
      ],
    };
    const result = buildTopicMap(input);
    expect(result).toEqual({ ok: false, reason: 'cycle', id: 'topic-1' });
  });

  it('rejects a 2-topic cycle', () => {
    const input: CourseOutlineInput = {
      courseId: 'c',
      teacherId: 't',
      modules: [{ moduleId: 'mod-1', title: 'M1', order: 0 }],
      topics: [
        { topicId: 'topic-1', moduleId: 'mod-1', title: 'T1', order: 0, prerequisiteTopicIds: ['topic-2'] },
        { topicId: 'topic-2', moduleId: 'mod-1', title: 'T2', order: 1, prerequisiteTopicIds: ['topic-1'] },
      ],
    };
    const result = buildTopicMap(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('cycle');
    expect(['topic-1', 'topic-2']).toContain(result.id);
  });

  it('rejects a longer cycle that crosses modules', () => {
    const input: CourseOutlineInput = {
      courseId: 'c',
      teacherId: 't',
      modules: [
        { moduleId: 'mod-1', title: 'M1', order: 0 },
        { moduleId: 'mod-2', title: 'M2', order: 1 },
      ],
      topics: [
        { topicId: 'topic-1', moduleId: 'mod-1', title: 'T1', order: 0, prerequisiteTopicIds: ['topic-3'] },
        { topicId: 'topic-2', moduleId: 'mod-1', title: 'T2', order: 1, prerequisiteTopicIds: ['topic-1'] },
        { topicId: 'topic-3', moduleId: 'mod-2', title: 'T3', order: 0, prerequisiteTopicIds: ['topic-2'] },
      ],
    };
    const result = buildTopicMap(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('cycle');
    expect(['topic-1', 'topic-2', 'topic-3']).toContain(result.id);
  });

  it('rejects a duplicate module id', () => {
    const input: CourseOutlineInput = {
      courseId: 'c',
      teacherId: 't',
      modules: [
        { moduleId: 'mod-1', title: 'M1', order: 0 },
        { moduleId: 'mod-1', title: 'M1 again', order: 1 },
      ],
      topics: [],
    };
    const result = buildTopicMap(input);
    expect(result).toEqual({ ok: false, reason: 'duplicate_module', id: 'mod-1' });
  });

  it('rejects a duplicate topic id', () => {
    const input: CourseOutlineInput = {
      courseId: 'c',
      teacherId: 't',
      modules: [{ moduleId: 'mod-1', title: 'M1', order: 0 }],
      topics: [
        { topicId: 'topic-1', moduleId: 'mod-1', title: 'T1', order: 0 },
        { topicId: 'topic-1', moduleId: 'mod-1', title: 'T1 again', order: 1 },
      ],
    };
    const result = buildTopicMap(input);
    expect(result).toEqual({ ok: false, reason: 'duplicate_topic', id: 'topic-1' });
  });

  it('rejects malformed input (fails schema parse) with reason invalid', () => {
    const result = buildTopicMap({ courseId: 'c', modules: [], topics: [] } as unknown as CourseOutlineInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
    expect(result.id).toBe('');
  });
});
