// Task 9.6 Phase B, plan Q4: `notesDocument` holds no raw chat transcript, and gives its sections
// in a fixed order: title, progress per module, next steps, session summaries (newest first),
// answered teacher questions, mistakes to watch.
import type { ExportJson } from './buildExport';
import type { Progress } from '../progress/progress';
import { describe, expect, it } from 'vitest';
import { notesDocument } from './notes';

function baseExport(overrides: Partial<ExportJson> = {}): ExportJson {
  return {
    format: 'edmate-export',
    version: 1,
    exportedAt: '2026-10-22T12:00:00.000Z',
    agentId: 'agt_1',
    complete: true,
    truncated: [],
    counts: { sessions: 0, messages: 0, evidence: 0, teacherQuestions: 0 },
    subscription: { status: 'active', periodEnd: '2026-11-22T00:00:00.000Z', package: { id: 'pkg_1', name: 'Fractions', version: 1 } },
    progress: { modules: [], counts: { topicsCovered: 0, topicsMastered: 0 }, nextSteps: [], other: [] },
    learnerProfile: null,
    evidence: [],
    sessions: [],
    teacherQuestions: [],
    ...overrides,
  };
}

const PROGRESS: Progress = {
  modules: [
    {
      id: 'mod_1',
      title: 'Fractions',
      topics: [
        { id: 'top_1', title: 'Adding fractions', state: 'mastered' },
        { id: 'top_2', title: 'Subtracting fractions', state: 'practising' },
      ],
    },
  ],
  counts: { topicsCovered: 2, topicsMastered: 1 },
  nextSteps: [{ id: 'top_2', title: 'Try subtracting fractions', moduleId: 'mod_1' }],
  other: [],
};

describe('notesDocument', () => {
  it('orders sections: title, progress, next steps, session summaries, answers, mistakes', () => {
    const exportJson = baseExport({
      sessions: [
        {
          id: 'ses_1',
          agentId: 'agt_1',
          agentVersion: 1,
          packageId: 'pkg_1',
          packageVersion: 1,
          summary: 'Worked through word problems about pizza slices.',
          createdAt: '2026-10-01T00:00:00.000Z',
          endedAt: '2026-10-01T01:00:00.000Z',
          messages: [
            { id: 'm1', role: 'student', text: 'Why does the denominator matter?', createdAt: '2026-10-01T00:30:00.000Z' },
            { id: 'm2', role: 'teacher', text: 'It tells you the size of each piece.', createdAt: '2026-10-01T02:00:00.000Z' },
          ],
        },
      ],
      teacherQuestions: [
        {
          id: 'tq_1',
          teacherId: 'tch_asha',
          agentId: 'agt_1',
          studentId: 'std_amy',
          text: 'Why does the denominator matter?',
          similarIds: [],
          status: 'answered',
          createdAt: '2026-10-01T00:30:00.000Z',
          answeredAt: '2026-10-01T01:30:00.000Z',
        },
      ],
      learnerProfile: {
        studentId: 'std_amy',
        teacherId: 'tch_asha',
        lang: 'en',
        mastery: {},
        mistakes: [{ tag: 'sign_error', count: 3, lastSeen: '2026-10-01T00:00:00.000Z' }],
      },
    });
    const blocks = notesDocument(exportJson, PROGRESS);
    const kinds = blocks.map((b) => `${b.kind}:${b.text}`);
    const idx = (needle: string) => kinds.findIndex((k) => k.includes(needle));

    expect(idx('Fractions – export 2026-10-22')).toBe(0);
    const progressIdx = idx('Progress');
    const nextIdx = idx('Next steps');
    const sessionsIdx = idx('Session summaries');
    const answersIdx = idx('Answers from your teacher');
    const mistakesIdx = idx('Mistakes to watch');
    expect(progressIdx).toBeGreaterThan(0);
    expect(nextIdx).toBeGreaterThan(progressIdx);
    expect(sessionsIdx).toBeGreaterThan(nextIdx);
    expect(answersIdx).toBeGreaterThan(sessionsIdx);
    expect(mistakesIdx).toBeGreaterThan(answersIdx);

    expect(blocks.some((b) => b.text.includes('Worked through word problems about pizza slices.'))).toBe(true);
    expect(blocks.some((b) => b.text === 'Why does the denominator matter?')).toBe(true);
    expect(blocks.some((b) => b.text === 'It tells you the size of each piece.')).toBe(true);
    expect(blocks.some((b) => b.text.includes('sign_error'))).toBe(true);
    expect(blocks.some((b) => b.text.includes('Try subtracting fractions'))).toBe(true);
  });

  it('shows session summaries newest first', () => {
    const exportJson = baseExport({
      sessions: [
        {
          id: 'ses_old',
          agentId: 'agt_1',
          agentVersion: 1,
          packageId: null,
          packageVersion: null,
          summary: 'Old summary',
          createdAt: '2026-09-01T00:00:00.000Z',
          endedAt: '2026-09-01T01:00:00.000Z',
          messages: [],
        },
        {
          id: 'ses_new',
          agentId: 'agt_1',
          agentVersion: 1,
          packageId: null,
          packageVersion: null,
          summary: 'New summary',
          createdAt: '2026-10-01T00:00:00.000Z',
          endedAt: '2026-10-01T01:00:00.000Z',
          messages: [],
        },
      ],
    });
    const blocks = notesDocument(exportJson, PROGRESS);
    const texts = blocks.map((b) => b.text);
    expect(texts.indexOf('New summary')).toBeLessThan(texts.indexOf('Old summary'));
  });

  it('pairs two questions answered close together with their own answer, not a swap', () => {
    const exportJson = baseExport({
      sessions: [
        {
          id: 'ses_1',
          agentId: 'agt_1',
          agentVersion: 1,
          packageId: null,
          packageVersion: null,
          summary: null,
          createdAt: '2026-10-01T00:00:00.000Z',
          endedAt: null,
          messages: [
            // One grouped-answer transaction closes tq_1 and tq_2 together but writes only one
            // teacher message for this student (task 5.10's `answer`): both questions share its
            // exact timestamp.
            { id: 'm1', role: 'teacher', text: 'Shared answer for both', createdAt: '2026-10-01T00:00:10.000Z' },
            // A later, separate answer closes tq_3 alone, with its own message.
            { id: 'm2', role: 'teacher', text: 'A different, later answer', createdAt: '2026-10-01T00:00:11.000Z' },
          ],
        },
      ],
      teacherQuestions: [
        {
          id: 'tq_1',
          teacherId: 'tch_asha',
          agentId: 'agt_1',
          studentId: 'std_amy',
          text: 'Question one',
          similarIds: [],
          status: 'answered',
          createdAt: '2026-10-01T00:00:00.000Z',
          answeredAt: '2026-10-01T00:00:10.000Z',
        },
        {
          id: 'tq_2',
          teacherId: 'tch_asha',
          agentId: 'agt_1',
          studentId: 'std_amy',
          text: 'Question two',
          similarIds: [],
          status: 'answered',
          createdAt: '2026-10-01T00:00:01.000Z',
          answeredAt: '2026-10-01T00:00:10.000Z',
        },
        {
          id: 'tq_3',
          teacherId: 'tch_asha',
          agentId: 'agt_1',
          studentId: 'std_amy',
          text: 'Question three',
          similarIds: [],
          status: 'answered',
          createdAt: '2026-10-01T00:00:02.000Z',
          answeredAt: '2026-10-01T00:00:11.000Z',
        },
      ],
    });
    const blocks = notesDocument(exportJson, PROGRESS);
    const texts = blocks.map((b) => b.text);
    const idxOf = (t: string) => texts.indexOf(t);
    expect(idxOf('Question one')).toBeGreaterThan(-1);
    expect(texts[idxOf('Question one') + 1]).toBe('Shared answer for both');
    expect(idxOf('Question two')).toBeGreaterThan(-1);
    expect(texts[idxOf('Question two') + 1]).toBe('Shared answer for both');
    expect(idxOf('Question three')).toBeGreaterThan(-1);
    expect(texts[idxOf('Question three') + 1]).toBe('A different, later answer');
  });

  it('never includes a raw chat transcript line that is not a summary or an answered Q&A', () => {
    const exportJson = baseExport({
      sessions: [
        {
          id: 'ses_1',
          agentId: 'agt_1',
          agentVersion: 1,
          packageId: null,
          packageVersion: null,
          summary: null,
          createdAt: '2026-10-01T00:00:00.000Z',
          endedAt: null,
          messages: [
            { id: 'm1', role: 'student', text: 'raw transcript line that should not appear', createdAt: '2026-10-01T00:00:00.000Z' },
          ],
        },
      ],
    });
    const blocks = notesDocument(exportJson, PROGRESS);
    expect(blocks.some((b) => b.text.includes('raw transcript line'))).toBe(false);
  });
});
