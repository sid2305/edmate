import type { Db } from '../client.js';
import { guarded } from './errors.js';
import { agentVersionsRepo } from './agent-versions.js';
import { evidenceEventsRepo, learnerProfilesRepo } from './learner.js';
import { messagesRepo } from './messages.js';
import { packageVersionsRepo } from './package-versions.js';
import { sessionsRepo } from './sessions.js';
import { subscriptionsRepo } from './subscriptions.js';
import { teacherQuestionsRepo } from './teacher-questions.js';
import { turnTracesRepo } from './turn-traces.js';

type Methods = Record<string, (...args: never[]) => Promise<unknown>>;

/** Wraps every method of a repository in `guarded`, so no driver error leaves unscrubbed. */
function guardAll<T extends Methods>(repo: string, methods: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(methods)) {
    const call = fn as (...args: unknown[]) => Promise<unknown>;
    out[name] = (...args: unknown[]) => guarded(`${repo}.${name}`, () => call(...args));
  }
  return out as T;
}

/**
 * Every repository, as plain objects of plain functions (the isolation test enumerates them).
 * Every method takes a validated TeacherScope or StudentScope first; see README.md.
 */
export function createRepositories(db: Db) {
  return {
    agentVersions: guardAll('agentVersions', agentVersionsRepo(db)),
    packageVersions: guardAll('packageVersions', packageVersionsRepo(db)),
    teacherQuestions: guardAll('teacherQuestions', teacherQuestionsRepo(db)),
    sessions: guardAll('sessions', sessionsRepo(db)),
    messages: guardAll('messages', messagesRepo(db)),
    turnTraces: guardAll('turnTraces', turnTracesRepo(db)),
    learnerProfiles: guardAll('learnerProfiles', learnerProfilesRepo(db)),
    evidenceEvents: guardAll('evidenceEvents', evidenceEventsRepo(db)),
    subscriptions: guardAll('subscriptions', subscriptionsRepo(db)),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

/**
 * `repo.method` for every repository method, for example `messages.history`. The isolation test's
 * case table is a Record over this union, so a new method without an isolation case fails `tsc`.
 */
export type RepositoryMethod = {
  [R in keyof Repositories]: `${R & string}.${keyof Repositories[R] & string}`;
}[keyof Repositories];

export { RepositoryError, ScrubbedDbError, type RepositoryErrorKind } from './errors.js';
export { studentScope, teacherScope, type StudentScope, type TeacherScope } from './scope.js';
export type { TeacherQuestionForTeacher } from './map.js';
export type { SessionRow } from './sessions.js';
export type { TurnTraceInput, TurnTraceRow } from './turn-traces.js';
export type { LiveSubscription } from './subscriptions.js';
export { transcriptStoreFor } from './ports.js';
