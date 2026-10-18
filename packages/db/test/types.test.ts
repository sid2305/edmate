// Compile-time shape checks (1.1 review deferral (a)): typed jsonb columns and repository return
// types equal the contract types. `tsc` (typecheck) fails on drift; at runtime these are no-ops.
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AgentConfig,
  EntitlementStore,
  LearnerProfile,
  Message,
  PackageConfig,
  SourceRef,
  StyleCard,
  TeacherQuestion,
  TranscriptStore,
  TurnConfigStore,
  TurnTrace,
} from '@edmate/contracts';
import type { Db } from '../src/internal.js';
import type {
  agentVersions,
  learnerProfiles,
  messages,
  packageVersions,
  turnTraces,
} from '../src/internal.js';
import type {
  AgentRow,
  createRepositories,
  entitlementStoreFor,
  PublicAgentScope,
  RepositoryMethod,
  StudentScope,
  TeacherQuestionForTeacher,
  TeacherScope,
  transcriptStoreFor,
  turnConfigStoreFor,
} from '../src/index.js';

type Repos = ReturnType<typeof createRepositories>;
type Ret<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;

describe('typed jsonb columns', () => {
  it('match the contract types', () => {
    expectTypeOf<(typeof agentVersions.$inferSelect)['config']>().toEqualTypeOf<AgentConfig>();
    expectTypeOf<(typeof packageVersions.$inferSelect)['config']>().toEqualTypeOf<PackageConfig>();
    expectTypeOf<(typeof messages.$inferSelect)['sources']>().toEqualTypeOf<SourceRef[] | null>();
    expectTypeOf<(typeof turnTraces.$inferSelect)['steps']>().toEqualTypeOf<TurnTrace['steps']>();
    expectTypeOf<(typeof learnerProfiles.$inferSelect)['mastery']>().toEqualTypeOf<
      LearnerProfile['mastery']
    >();
    expectTypeOf<(typeof learnerProfiles.$inferSelect)['mistakes']>().toEqualTypeOf<
      LearnerProfile['mistakes']
    >();
  });
});

describe('repository return types', () => {
  it('are the contract types', () => {
    expectTypeOf<Ret<Repos['agentVersions']['get']>>().toEqualTypeOf<AgentConfig | null>();
    expectTypeOf<Ret<Repos['packageVersions']['get']>>().toEqualTypeOf<PackageConfig | null>();
    expectTypeOf<Ret<Repos['messages']['history']>>().toEqualTypeOf<Message[]>();
    expectTypeOf<Ret<Repos['learnerProfiles']['get']>>().toEqualTypeOf<LearnerProfile | null>();
    expectTypeOf<Ret<Repos['teacherQuestions']['open']>>().toEqualTypeOf<TeacherQuestion>();
    expectTypeOf<Ret<Repos['teacherQuestions']['listForStudent']>>().toEqualTypeOf<
      TeacherQuestion[]
    >();
    expectTypeOf<Ret<Repos['teacherQuestions']['listForTeacher']>>().toEqualTypeOf<
      TeacherQuestionForTeacher[]
    >();
    expectTypeOf<TeacherQuestionForTeacher>().toEqualTypeOf<Omit<TeacherQuestion, 'studentId'>>();
    expectTypeOf<Ret<Repos['styleCards']['get']>>().toEqualTypeOf<StyleCard | null>();
    expectTypeOf<Ret<Repos['packageVersions']['getById']>>().toEqualTypeOf<PackageConfig | null>();
    expectTypeOf<Ret<Repos['packageVersions']['latest']>>().toEqualTypeOf<PackageConfig | null>();
    expectTypeOf<Ret<Repos['agents']['get']>>().toEqualTypeOf<AgentRow | null>();
    expectTypeOf<Ret<Repos['agents']['owner']>>().toEqualTypeOf<{ teacherId: string } | null>();
    expectTypeOf<Ret<Repos['modules']['ids']>>().toEqualTypeOf<string[]>();
  });

  it('take the scope first', () => {
    expectTypeOf<Parameters<Repos['agentVersions']['get']>[0]>().toEqualTypeOf<TeacherScope>();
    expectTypeOf<Parameters<Repos['messages']['append']>[0]>().toEqualTypeOf<StudentScope>();
    expectTypeOf<Parameters<Repos['learnerProfiles']['get']>[0]>().toEqualTypeOf<StudentScope>();
    expectTypeOf<Parameters<Repos['styleCards']['get']>[0]>().toEqualTypeOf<TeacherScope>();
    expectTypeOf<Parameters<Repos['modules']['ids']>[0]>().toEqualTypeOf<TeacherScope>();
    expectTypeOf<Parameters<Repos['agents']['owner']>[0]>().toEqualTypeOf<PublicAgentScope>();
  });

  it('name every method as repo.method', () => {
    expectTypeOf<'messages.history'>().toExtend<RepositoryMethod>();
    expectTypeOf<'learnerProfiles.save'>().toExtend<RepositoryMethod>();
    expectTypeOf<'users.get'>().not.toExtend<RepositoryMethod>();
  });

  it('transcriptStoreFor returns the frozen TranscriptStore port', () => {
    expectTypeOf<ReturnType<typeof transcriptStoreFor>>().toEqualTypeOf<TranscriptStore>();
    expectTypeOf<ReturnType<typeof entitlementStoreFor>>().toEqualTypeOf<EntitlementStore>();
    expectTypeOf<ReturnType<typeof turnConfigStoreFor>>().toEqualTypeOf<TurnConfigStore>();
    expectTypeOf<Parameters<typeof createRepositories>[0]>().toEqualTypeOf<Db>();
  });
});
