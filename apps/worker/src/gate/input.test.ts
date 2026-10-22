import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelGateway, PackageConfig } from '@edmate/contracts';
import { RepositoryError } from '@edmate/db';
import { defaultGateDeadlineMs, type EvalAgent } from '@edmate/evals';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildGateInput,
  GateUnavailableError,
  packageForLabel,
  type BuildGateInputOptions,
  type GateBasis,
} from './input.js';
import { AGENT, AGENT_VERSION, fakeRepos, fakeWorld, freePkg, paidPkg, TEACHER } from '../../test/gate/testkit.js';

const basis: GateBasis = {
  teacherId: TEACHER,
  agentId: AGENT,
  agentVersion: AGENT_VERSION,
  packageVersions: [
    { packageId: freePkg.id, version: freePkg.version },
    { packageId: paidPkg.id, version: paidPkg.version },
  ],
};

const caseYaml = (id: string, pkg: string) => `id: ${id}
suite: locked
package: ${pkg}
reviewed_by: lead
source: test
turns:
  - student: Tell me about module 3.
    expect:
      must_not_contain: [secret]
`;

const judgeGateway = {} as ModelGateway;
const judgeModel = { provider: 'anthropic', model: 'judge-test' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gate-input-'));
  mkdirSync(join(dir, 'locked'));
  writeFileSync(join(dir, 'locked', 'a.yaml'), caseYaml('locked-a', 'free'));
  writeFileSync(join(dir, 'locked', 'b.yaml'), caseYaml('locked-b', 'paid'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function opts(over: Partial<BuildGateInputOptions> = {}): BuildGateInputOptions & {
  built: PackageConfig[];
} {
  const built: PackageConfig[] = [];
  return {
    built,
    repos: fakeRepos(
      fakeWorld({
        evalCases: [
          { id: 'tec_1', moduleId: 'mod_test_01', question: 'What is x?', answer: 'x is 1', origin: 'teacher_answer' },
        ],
      }),
    ).repos,
    basis,
    changes: ['material'],
    suitesDir: dir,
    agentFor: (pkg) => {
      built.push(pkg);
      return { reply: () => Promise.resolve({ text: pkg.id }) };
    },
    judgeGateway,
    judgeModel,
    ...over,
  };
}

const reply = (agent: EvalAgent) =>
  agent.reply({ caseId: 'c', turnIndex: 0, student: 's', priorTurns: [] });

describe('buildGateInput', () => {
  it('maps the basis to a GateInput', async () => {
    const o = opts({ concurrency: 2, styleSampleSeed: 'seed' });
    const input = await buildGateInput(o);
    expect(input.changes).toEqual(['material']);
    expect(input.platformCases.map((c) => c.id)).toEqual(['locked-a', 'locked-b']);
    expect(input.perAgent).toEqual({
      teacherId: TEACHER,
      agentId: AGENT,
      packages: [
        {
          id: freePkg.id,
          name: freePkg.name,
          moduleIds: freePkg.moduleIds,
          lockedReply: freePkg.lockedReply,
          sourceLabel: `package_versions#${freePkg.id}@${freePkg.version}`,
        },
        {
          id: paidPkg.id,
          name: paidPkg.name,
          moduleIds: paidPkg.moduleIds,
          lockedReply: paidPkg.lockedReply,
          sourceLabel: `package_versions#${paidPkg.id}@${paidPkg.version}`,
        },
      ],
      answerable: [
        {
          id: 'tec_1',
          moduleId: 'mod_test_01',
          question: 'What is x?',
          answer: 'x is 1',
          provenance: 'teacher-answer',
          sourceLabel: 'teacher_eval_cases#tec_1',
        },
      ],
      outOfCourse: [],
    });
    expect(input.deadlineMs).toBe(defaultGateDeadlineMs(['material']));
    expect(input.judgeGateway).toBe(judgeGateway);
    expect(input.judgeModel).toEqual(judgeModel);
    expect(input.recorder.mode).toBe('record');
    expect(input.concurrency).toBe(2);
    expect(input.styleSampleSeed).toBe('seed');
  });

  it('a full-scope change gets the full-scope deadline', async () => {
    const input = await buildGateInput(opts({ changes: ['first_publish'] }));
    expect(input.deadlineMs).toBe(defaultGateDeadlineMs(['first_publish']));
  });

  it('agentFor routes a package id or a free/paid label to the pinned candidate package', async () => {
    const o = opts();
    const input = await buildGateInput(o);
    expect((await reply(input.agentFor(paidPkg.id))).text).toBe(paidPkg.id);
    expect((await reply(input.agentFor('free'))).text).toBe(freePkg.id);
    expect((await reply(input.agentFor('paid'))).text).toBe(paidPkg.id);
    expect(o.built.map((p) => p.version)).toEqual([paidPkg.version, freePkg.version, paidPkg.version]);
  });

  it('a label with no candidate package gets an agent that fails its cases (closed, named)', async () => {
    const input = await buildGateInput(
      opts({ basis: { ...basis, packageVersions: [basis.packageVersions[1]!] } }),
    );
    await expect(reply(input.agentFor('free'))).rejects.toThrow(/no candidate package for "free"/);
    await expect(reply(input.agentFor('pkg_nope'))).rejects.toThrow(/pkg_nope/);
  });

  it('no packages in the basis fails closed', async () => {
    await expect(buildGateInput(opts({ basis: { ...basis, packageVersions: [] } }))).rejects.toEqual(
      new GateUnavailableError('no_packages'),
    );
  });

  it('a pinned package version that is missing, or another agent’s, fails closed', async () => {
    const missing = { ...basis, packageVersions: [{ packageId: paidPkg.id, version: 99 }] };
    await expect(buildGateInput(opts({ basis: missing }))).rejects.toMatchObject({
      code: 'gate_unavailable',
      reason: 'package_missing',
    });
    const other = fakeRepos(fakeWorld({ packages: [{ ...paidPkg, agentId: 'agt_other' }] })).repos;
    const only = { ...basis, packageVersions: [basis.packageVersions[1]!] };
    await expect(buildGateInput(opts({ repos: other, basis: only }))).rejects.toMatchObject({
      reason: 'package_missing',
    });
  });

  it('a missing suites dir fails closed (never a silent skip)', async () => {
    await expect(buildGateInput(opts({ suitesDir: join(dir, 'nope') }))).rejects.toMatchObject({
      code: 'gate_unavailable',
      reason: 'suites_missing',
    });
    writeFileSync(join(dir, 'file'), '');
    await expect(buildGateInput(opts({ suitesDir: join(dir, 'file') }))).rejects.toMatchObject({
      reason: 'suites_missing',
    });
  });

  it('a suites dir with zero cases fails closed', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gate-empty-'));
    try {
      await expect(buildGateInput(opts({ suitesDir: empty }))).rejects.toMatchObject({
        reason: 'no_platform_cases',
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('a broken case file is an error, not a skip', async () => {
    writeFileSync(join(dir, 'locked', 'c.yaml'), 'id: BAD\n');
    await expect(buildGateInput(opts())).rejects.toThrow(/c\.yaml/);
  });

  it('teacher eval cases over the repository cap is an error', async () => {
    const repos = fakeRepos(
      fakeWorld({ evalCasesError: new RepositoryError('invalid', 'teacherEvalCases.listForTeacher') }),
    ).repos;
    await expect(buildGateInput(opts({ repos }))).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe('packageForLabel', () => {
  const extraFree: PackageConfig = { ...freePkg, id: 'pkg_free_wide', moduleIds: ['m1', 'm2'] };
  it('exact id first, then the widest package of the tier, ties by id', () => {
    expect(packageForLabel([freePkg, paidPkg], freePkg.id)).toBe(freePkg);
    expect(packageForLabel([freePkg, extraFree, paidPkg], 'free')).toBe(extraFree);
    const sameWidth = { ...extraFree, id: 'pkg_a', moduleIds: ['m9', 'm8'] };
    expect(packageForLabel([extraFree, sameWidth], 'free')).toBe(sameWidth);
    expect(packageForLabel([freePkg], 'paid')).toBeUndefined();
    expect(packageForLabel([freePkg, paidPkg], 'other')).toBeUndefined();
  });
});
