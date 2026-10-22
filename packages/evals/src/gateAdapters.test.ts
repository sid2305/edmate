// Task 7.4: adapters from package configs and `teacher_eval_cases`-shaped rows into 7.3's input.
import type { PackageConfig } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { agentPackagesFromConfigs, answerableFromTeacherEvalCases } from './gateAdapters.js';
import { generatePerAgentSuite } from './perAgentSuite.js';

function config(over: Partial<PackageConfig>): PackageConfig {
  return {
    id: 'pkg-free',
    version: 1,
    teacherId: 'teacher-1',
    agentId: 'agent-1',
    name: 'Starter',
    moduleIds: ['m1'],
    skills: ['explain'],
    helpCeiling: 2,
    finalAnswers: 'never',
    dailyMessageLimit: 20,
    liveClassesPerMonth: 0,
    pricePerMonth: { amountMinor: 0, currency: 'USD' },
    lockedReply: 'name_package',
    ...over,
  };
}

describe('agentPackagesFromConfigs', () => {
  it('keeps id, name, modules and locked reply, and labels each source', () => {
    const configs = [
      config({}),
      config({ id: 'pkg-paid', name: 'Full', moduleIds: ['m1', 'm2'], lockedReply: 'generic' }),
    ];
    expect(
      agentPackagesFromConfigs(configs, (c) => `package_configs#${c.id}@${c.version}`),
    ).toEqual([
      {
        id: 'pkg-free',
        name: 'Starter',
        moduleIds: ['m1'],
        lockedReply: 'name_package',
        sourceLabel: 'package_configs#pkg-free@1',
      },
      {
        id: 'pkg-paid',
        name: 'Full',
        moduleIds: ['m1', 'm2'],
        lockedReply: 'generic',
        sourceLabel: 'package_configs#pkg-paid@1',
      },
    ]);
  });

  it('copies the module list, so a later edit to the config cannot change the input', () => {
    const c = config({});
    const [pkg] = agentPackagesFromConfigs([c], () => 'x');
    c.moduleIds.push('m9');
    expect(pkg?.moduleIds).toEqual(['m1']);
    expect(agentPackagesFromConfigs([], () => 'x')).toEqual([]);
  });
});

describe('answerableFromTeacherEvalCases', () => {
  const rows = [
    { id: 'row-1', moduleId: 'm1', question: 'Q one?', answer: 'A one.' },
    { id: 'row-2', moduleId: 'm2', question: 'Q two?', answer: 'A two.', origin: 'approved_draft' },
  ];

  it('labels each item by row id, never by teacher text', () => {
    expect(answerableFromTeacherEvalCases(rows)).toEqual([
      {
        id: 'row-1',
        moduleId: 'm1',
        question: 'Q one?',
        answer: 'A one.',
        provenance: 'teacher-answer',
        sourceLabel: 'teacher_eval_cases#row-1',
      },
      {
        id: 'row-2',
        moduleId: 'm2',
        question: 'Q two?',
        answer: 'A two.',
        provenance: 'teacher-answer',
        sourceLabel: 'teacher_eval_cases#row-2',
      },
    ]);
  });

  it('feeds the generator end to end', () => {
    const cases = generatePerAgentSuite({
      teacherId: 'teacher-1',
      agentId: 'agent-1',
      packages: agentPackagesFromConfigs([config({})], (c) => c.id),
      answerable: answerableFromTeacherEvalCases(rows),
      outOfCourse: [],
    });
    expect(cases.map((c) => `${c.suite}:${c.id}`)).toEqual([
      'accuracy:gen-acc-pkg-free-row-1',
      'locked:gen-lock-pkg-free-direct-row-2',
      'locked:gen-lock-pkg-free-summary-m2',
      'locked:gen-lock-pkg-free-already-paid-m2',
      'locked:gen-lock-pkg-free-outline-m2',
    ]);
  });
});
