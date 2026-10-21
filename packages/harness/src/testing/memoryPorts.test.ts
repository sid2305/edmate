import type { Message, ModelGateway } from '@edmate/contracts';
import { demoSafetyAlert, demoTurnTrace, usageMain } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { HarnessError } from '../pipeline/errors.js';
import { EventQueue } from '../pipeline/events.js';
import { teacherNoteText } from '../pipeline/teacherNote.js';
import {
  memoryAlertSink,
  memoryCorrectionStore,
  memorySessionStateStore,
  memoryTraceSink,
  memoryTranscriptStore,
  memoryUsageMeter,
  UnusedPortError,
  unusedPort,
} from './memoryPorts.js';
import { memoryRetrieval, retrievalWorld } from './memoryRetrieval.js';

const demoMessageAgent: Message = {
  id: 'msg_agent',
  role: 'agent',
  text: 'What do you notice?',
  createdAt: '2026-10-18T10:00:00.000Z',
};

describe('memory ports', () => {
  it('unusedPort throws and records each call; it is not a thenable', async () => {
    const calls: string[] = [];
    const port = unusedPort<ModelGateway>('gateway', calls);
    expect(() => port.embed(['x'])).toThrow(UnusedPortError);
    expect(calls).toEqual(['gateway.embed']);
    expect(await Promise.resolve(port)).toBe(port);
  });

  it('memoryTraceSink records and can fail', async () => {
    const ok = memoryTraceSink();
    await ok.record(demoTurnTrace);
    expect(ok.records).toEqual([demoTurnTrace]);
    await expect(memoryTraceSink({ fail: true }).record(demoTurnTrace)).rejects.toThrow('down');
  });

  it('memoryUsageMeter keeps rows; memoryAlertSink fails failTimes then delivers', async () => {
    const m = memoryUsageMeter();
    const ctx = {
      teacherId: 't',
      packageId: 'p',
      studentId: 's',
      turnId: 'u',
      source: 'eval' as const,
    };
    await m.record(usageMain, ctx);
    expect(m.rows).toEqual([{ usage: usageMain, ctx }]);
    const a = memoryAlertSink({ failTimes: 1 });
    await expect(a.raise(demoSafetyAlert)).rejects.toThrow('attempt 1');
    await a.raise(demoSafetyAlert);
    expect(a.attempts).toBe(2);
    expect(a.raised).toEqual([demoSafetyAlert]);
  });
});

describe('EventQueue', () => {
  it('ends a waiting consumer on close and drops pushes after close', async () => {
    const q = new EventQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.close();
    q.push(1);
    q.close();
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(q.isClosed).toBe(true);
  });

  it('hands a push straight to a waiting consumer', async () => {
    const q = new EventQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.push(7);
    expect(await pending).toEqual({ value: 7, done: false });
  });

  it('memoryTranscriptStore appends per session and returns the newest `limit`, oldest first', async () => {
    const t = memoryTranscriptStore();
    const a = { ...demoMessageAgent, id: 'msg_a' };
    const b = { ...demoMessageAgent, id: 'msg_b' };
    await t.append('ses_1', a);
    await t.append('ses_2', { ...demoMessageAgent, id: 'msg_other' });
    await t.append('ses_1', b);
    expect(await t.history('ses_1', 1)).toEqual([b]);
    expect(await t.history('ses_1', 10)).toEqual([a, b]);
    expect(t.appended).toHaveLength(3);
    await expect(memoryTranscriptStore({ fail: true }).append('ses_1', a)).rejects.toThrow('down');
  });

  it('memorySessionStateStore records every save and can fail', async () => {
    const s = memorySessionStateStore();
    await s.saveHelpState('ses_1', { v: 1 });
    expect(s.saved).toEqual([{ sessionId: 'ses_1', helpState: { v: 1 } }]);
    await expect(
      memorySessionStateStore({ fail: true }).saveHelpState('ses_1', {}),
    ).rejects.toThrow('down');
  });
});

describe('memoryCorrectionStore (task 5.10)', () => {
  const note = {
    teacherId: 'tch_test_01',
    moduleId: 'mod_test_02',
    question: ' Why does the sky look blue at noon? ',
    answer: 'Air scatters short blue wavelengths the most.',
    origin: 'teacher_answer' as const,
  };
  const allowed = { teacherId: 'tch_test_01', allowedModuleIds: ['mod_test_02'] };
  const at = Date.UTC(2026, 9, 21, 9);

  it('adds one teacher_note chunk to retrieval and records the note and the eval case', async () => {
    const retrieval = memoryRetrieval({ chunks: retrievalWorld() });
    const store = memoryCorrectionStore({ retrieval, clock: { now: () => at } });
    const out = await store.addTeacherNote(note);
    expect(out).toEqual({ chunkId: 'chk_note_1', evalCaseId: 'evc_mem_1' });

    const hits = await retrieval.search('Why does the sky look blue at noon', allowed, 5);
    expect(hits[0]).toMatchObject({
      id: 'chk_note_1',
      teacherId: 'tch_test_01',
      moduleId: 'mod_test_02',
      kind: 'teacher_note',
      text: teacherNoteText(note),
      source: { title: "Teacher's answer", locator: '2026-10-21', kind: 'teacher_note' },
    });
    expect(store.notes).toEqual([{ ...note, chunkId: 'chk_note_1' }]);
    expect(store.cases).toEqual([
      {
        id: 'evc_mem_1',
        teacherId: 'tch_test_01',
        moduleId: 'mod_test_02',
        origin: 'teacher_answer',
        question: 'Why does the sky look blue at noon?',
        answer: note.answer,
        chunkId: 'chk_note_1',
      },
    ]);
    // A second note gets the next ids; a correction is cited as one.
    const second = await store.addTeacherNote({ ...note, origin: 'correction', answer: 'Fixed.' });
    expect(second).toEqual({ chunkId: 'chk_note_2', evalCaseId: 'evc_mem_2' });
    const [c] = await retrieval.search('Fixed', allowed, 1);
    expect(c?.source.title).toBe("Teacher's correction");
  });

  it('the note is found only under a scope that allows its module and teacher', async () => {
    const retrieval = memoryRetrieval({ chunks: [] });
    await memoryCorrectionStore({ retrieval }).addTeacherNote(note);
    const q = 'sky blue noon';
    expect(await retrieval.search(q, allowed, 5)).toHaveLength(1);
    expect(
      await retrieval.search(q, { teacherId: 'tch_test_01', allowedModuleIds: ['mod_test_01'] }, 5),
    ).toEqual([]);
    expect(await retrieval.search(q, { ...allowed, teacherId: 'tch_test_02' }, 5)).toEqual([]);
  });

  it("refuses another teacher's module when module owners are given, writing nothing", async () => {
    const retrieval = memoryRetrieval({ chunks: [] });
    const store = memoryCorrectionStore({
      retrieval,
      moduleOwners: { mod_test_02: 'tch_test_02' },
    });
    await expect(store.addTeacherNote(note)).rejects.toThrow('not_found');
    await expect(store.addTeacherNote({ ...note, moduleId: 'mod_unknown' })).rejects.toThrow(
      'not_found',
    );
    expect(store.notes).toEqual([]);
    expect(store.cases).toEqual([]);
    expect(await retrieval.search('sky blue noon', allowed, 5)).toEqual([]);
  });

  it('rejects an empty answer or question with a fixed message, writing nothing', async () => {
    const retrieval = memoryRetrieval({ chunks: [] });
    const store = memoryCorrectionStore({ retrieval });
    await expect(store.addTeacherNote({ ...note, answer: '  ' })).rejects.toBeInstanceOf(
      HarnessError,
    );
    await expect(store.addTeacherNote({ ...note, question: '' })).rejects.toBeInstanceOf(
      HarnessError,
    );
    expect(store.notes).toEqual([]);
    expect(store.cases).toEqual([]);
  });

  it('fail: true rejects without writing', async () => {
    const retrieval = memoryRetrieval({ chunks: [] });
    const store = memoryCorrectionStore({ retrieval, fail: true });
    await expect(store.addTeacherNote(note)).rejects.toThrow('correction store down');
    expect(store.notes).toEqual([]);
  });
});
