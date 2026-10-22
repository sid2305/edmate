// Test-only fakes for the gate (task 8.7 Phase B): a read-only `Repositories` stand-in over the
// contracts' demo fixtures. Any repository outside the read set the gate needs throws on first
// touch and is recorded, so a test can prove the gate never reaches a durable write (alerts,
// safety events, teacher questions, transcripts, usage ledger, ...).
import type { AgentConfig, PackageConfig, StyleCard } from '@edmate/contracts';
import type { Repositories, TeacherEvalCaseRow } from '@edmate/db';
import {
  demoAgentConfig,
  demoPackageFree,
  demoPackagePaid,
  demoStyleCard,
  FIXTURE_PROMPT_PACK_VERSION,
} from '@edmate/harness/testing';

/** The repositories the gate may read. Everything else is off limits. */
export const GATE_READ_REPOS = [
  'agents',
  'agentVersions',
  'packageVersions',
  'styleCards',
  'modules',
  'teacherEvalCases',
] as const;

export const TEACHER = demoAgentConfig.teacherId;
export const AGENT = demoAgentConfig.id;
export const AGENT_VERSION = 4;

export const candidateAgent: AgentConfig = {
  ...demoAgentConfig,
  version: AGENT_VERSION,
  promptPackVersion: FIXTURE_PROMPT_PACK_VERSION,
  // The pilot is English-only (PilotLanguageClamped otherwise fails the case in the background).
  languages: ['en'],
};
export const freePkg: PackageConfig = { ...demoPackageFree };
export const paidPkg: PackageConfig = { ...demoPackagePaid };
export const styleCard: StyleCard = { ...demoStyleCard };

export interface FakeWorld {
  agents: AgentConfig[];
  packages: PackageConfig[];
  styleCards: StyleCard[];
  modules: string[];
  evalCases: TeacherEvalCaseRow[];
  /** `teacherEvalCases.listForTeacher` throws this instead (e.g. the over-cap error). */
  evalCasesError?: Error;
}

export function fakeWorld(over: Partial<FakeWorld> = {}): FakeWorld {
  return {
    agents: [candidateAgent, { ...candidateAgent, version: AGENT_VERSION - 1, styleCardId: 'sty_old' }],
    packages: [freePkg, paidPkg, { ...paidPkg, version: paidPkg.version + 1, name: 'Newer, not pinned' }],
    styleCards: [styleCard],
    modules: ['mod_test_01', 'mod_test_02', 'mod_test_03', 'mod_test_04'],
    evalCases: [],
    ...over,
  };
}

export interface FakeRepos {
  repos: Repositories;
  /** Every repository name touched, in order (reads included). */
  touched: string[];
  /** Repositories touched that are not in `GATE_READ_REPOS`. */
  forbidden: string[];
}

/** A `Repositories` proxy: the gate's read set over `world`; any other repository throws. */
export function fakeRepos(world: FakeWorld = fakeWorld()): FakeRepos {
  const touched: string[] = [];
  const forbidden: string[] = [];
  const ownAgent = (scope: { teacherId: string }, agentId: string) =>
    world.agents.find((a) => a.teacherId === scope.teacherId && a.id === agentId) ?? null;
  const read: Record<(typeof GATE_READ_REPOS)[number], object> = {
    agents: {
      get: (scope: { teacherId: string }, agentId: string) => {
        const a = ownAgent(scope, agentId);
        return Promise.resolve(a === null ? null : { id: a.id, teacherId: a.teacherId, status: 'draft' });
      },
    },
    agentVersions: {
      get: (scope: { teacherId: string }, ref: { agentId: string; version: number }) =>
        Promise.resolve(
          world.agents.find(
            (a) => a.teacherId === scope.teacherId && a.id === ref.agentId && a.version === ref.version,
          ) ?? null,
        ),
    },
    packageVersions: {
      get: (scope: { teacherId: string }, ref: { packageId: string; version: number }) =>
        Promise.resolve(
          world.packages.find(
            (p) => p.teacherId === scope.teacherId && p.id === ref.packageId && p.version === ref.version,
          ) ?? null,
        ),
    },
    styleCards: {
      get: (scope: { teacherId: string }, id: string) =>
        Promise.resolve(
          world.styleCards.find((s) => s.teacherId === scope.teacherId && s.id === id) ?? null,
        ),
    },
    modules: {
      ids: (scope: { teacherId: string }) =>
        Promise.resolve(scope.teacherId === TEACHER ? [...world.modules] : []),
    },
    teacherEvalCases: {
      listForTeacher: (scope: { teacherId: string }) =>
        world.evalCasesError !== undefined
          ? Promise.reject(world.evalCasesError)
          : Promise.resolve(scope.teacherId === TEACHER ? [...world.evalCases] : []),
    },
  };
  const repos = new Proxy({} as Repositories, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      touched.push(prop);
      if ((GATE_READ_REPOS as readonly string[]).includes(prop)) {
        return read[prop as (typeof GATE_READ_REPOS)[number]];
      }
      forbidden.push(prop);
      throw new Error(`gate test: repository ${prop} is off limits`);
    },
  });
  return { repos, touched, forbidden };
}
