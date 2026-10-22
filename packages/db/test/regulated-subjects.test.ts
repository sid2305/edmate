// Unit (no database, task 12.4a): regulatedSubjects rejects bad input as `invalid` before any SQL,
// and its subject list mirrors the contracts enum. The pool points at an unreachable host, so a
// call that reached the database would fail as `failed` instead.
import { AgentConfigSchema } from '@edmate/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import {
  createRepositories,
  REGULATED_APPROVAL_ACTION,
  REGULATED_FLAG_ACTION,
  REGULATED_LIST_MAX,
  REGULATED_NOTE_MAX,
  REGULATED_SUBJECTS,
  RepositoryError,
} from '../src/index.js';

const handle = createDb({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
const repos = createRepositories(handle.db);
afterAll(() => handle.close());

async function kind(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RepositoryError);
  return (e as RepositoryError).kind;
}

const BAD_BY = ['', 'a b', 'x'.repeat(129), null, undefined, 7, { id: 'stf_1' }];

describe('regulatedSubjects constants', () => {
  it('exports the caps and audit actions', () => {
    expect(REGULATED_LIST_MAX).toBe(200);
    expect(REGULATED_NOTE_MAX).toBe(500);
    expect(REGULATED_FLAG_ACTION).toBe('agent.regulated_flag');
    expect(REGULATED_APPROVAL_ACTION).toBe('agent.regulated_approval');
  });

  it('REGULATED_SUBJECTS mirrors the contracts AgentConfig.regulatedSubject enum', () => {
    const contract = AgentConfigSchema.shape.regulatedSubject.unwrap().options;
    expect([...REGULATED_SUBJECTS].sort()).toEqual([...contract].sort());
  });
});

describe('regulatedSubjects input validation', () => {
  it('listForStaff: a malformed by is invalid', async () => {
    for (const by of BAD_BY) {
      expect(await kind(repos.regulatedSubjects.listForStaff(by as never))).toBe('invalid');
    }
  });

  it('setSubject: a bad by, agent id, subject, note or an extra key is invalid', async () => {
    const bad: [unknown, unknown][] = [
      ...BAD_BY.map((by): [unknown, unknown] => [by, { agentId: 'agt_1', subject: 'health' }]),
      ['stf_1', { agentId: 'has space', subject: 'health' }],
      ['stf_1', { subject: 'health' }],
      ['stf_1', { agentId: 'agt_1' }],
      ['stf_1', { agentId: 'agt_1', subject: 'medicine' }],
      ['stf_1', { agentId: 'agt_1', subject: 'HEALTH' }],
      ['stf_1', { agentId: 'agt_1', subject: '' }],
      ['stf_1', { agentId: 'agt_1', subject: 'health', note: '   ' }],
      ['stf_1', { agentId: 'agt_1', subject: 'health', note: 5 }],
      ['stf_1', { agentId: 'agt_1', subject: 'health', note: 'x'.repeat(REGULATED_NOTE_MAX + 1) }],
      ['stf_1', { agentId: 'agt_1', subject: 'health', by: 'stf_2' }],
      ['stf_1', { agentId: 'agt_1', subject: 'health', approved: true }],
      ['stf_1', null],
      ['stf_1', 'health'],
    ];
    for (const [by, input] of bad) {
      expect(await kind(repos.regulatedSubjects.setSubject(by as never, input as never))).toBe(
        'invalid',
      );
    }
  });

  it('setApproval: a bad by, agent id, approved flag, note or an extra key is invalid', async () => {
    const bad: [unknown, unknown][] = [
      ...BAD_BY.map((by): [unknown, unknown] => [by, { agentId: 'agt_1', approved: true }]),
      ['stf_1', { agentId: '', approved: true }],
      ['stf_1', { agentId: 'agt_1' }],
      ['stf_1', { agentId: 'agt_1', approved: 'yes' }],
      ['stf_1', { agentId: 'agt_1', approved: 1 }],
      ['stf_1', { agentId: 'agt_1', approved: null }],
      ['stf_1', { agentId: 'agt_1', approved: true, note: '' }],
      ['stf_1', { agentId: 'agt_1', approved: true, note: 'x'.repeat(REGULATED_NOTE_MAX + 1) }],
      ['stf_1', { agentId: 'agt_1', approved: true, subject: 'law' }],
      ['stf_1', null],
    ];
    for (const [by, input] of bad) {
      expect(await kind(repos.regulatedSubjects.setApproval(by as never, input as never))).toBe(
        'invalid',
      );
    }
  });

  it('a null subject, and a note at the cap, are accepted (they reach the database)', async () => {
    const calls = [
      repos.regulatedSubjects.setSubject('stf_1', { agentId: 'agt_1', subject: null }),
      repos.regulatedSubjects.setSubject('stf_1', {
        agentId: 'agt_1',
        subject: 'law',
        note: 'x'.repeat(REGULATED_NOTE_MAX),
      }),
      repos.regulatedSubjects.setApproval('stf_1', { agentId: 'agt_1', approved: false }),
      repos.regulatedSubjects.listForStaff('stf_1'),
    ];
    for (const c of calls) expect(await kind(c)).toBe('failed');
  });
});
