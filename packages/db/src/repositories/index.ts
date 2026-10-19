import type { Db } from '../client.js';
import { guarded } from './errors.js';
import { agentVersionsRepo } from './agent-versions.js';
import { agentsRepo } from './agents.js';
import { auditRepo } from './audit.js';
import { evidenceEventsRepo, learnerProfilesRepo } from './learner.js';
import { messagesRepo } from './messages.js';
import { modulesRepo } from './modules.js';
import { packageVersionsRepo } from './package-versions.js';
import { safetyEventsRepo } from './safety-events.js';
import { sessionsRepo } from './sessions.js';
import { styleCardsRepo } from './style-cards.js';
import { subscriptionsRepo } from './subscriptions.js';
import { teacherQuestionsRepo } from './teacher-questions.js';
import { turnTracesRepo } from './turn-traces.js';
import { usageLedgerRepo } from './usage-ledger.js';

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
 * Every method takes a validated TeacherScope or StudentScope first (the one exception,
 * `agents.owner`, takes a public `{ agentId }` scope); see README.md.
 */
export function createRepositories(db: Db) {
  return {
    agents: guardAll('agents', agentsRepo(db)),
    agentVersions: guardAll('agentVersions', agentVersionsRepo(db)),
    modules: guardAll('modules', modulesRepo(db)),
    styleCards: guardAll('styleCards', styleCardsRepo(db)),
    packageVersions: guardAll('packageVersions', packageVersionsRepo(db)),
    teacherQuestions: guardAll('teacherQuestions', teacherQuestionsRepo(db)),
    sessions: guardAll('sessions', sessionsRepo(db)),
    messages: guardAll('messages', messagesRepo(db)),
    turnTraces: guardAll('turnTraces', turnTracesRepo(db)),
    learnerProfiles: guardAll('learnerProfiles', learnerProfilesRepo(db)),
    evidenceEvents: guardAll('evidenceEvents', evidenceEventsRepo(db)),
    subscriptions: guardAll('subscriptions', subscriptionsRepo(db)),
    audit: guardAll('audit', auditRepo(db)),
    usageLedger: guardAll('usageLedger', usageLedgerRepo(db)),
    safetyEvents: guardAll('safetyEvents', safetyEventsRepo(db)),
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
export type { AuditRow, TeacherQuestionForTeacher } from './map.js';
export {
  AUDIT_JSON_MAX_LENGTH,
  AUDIT_MAX_LIMIT,
  type AuditEntryInput,
  SYSTEM_ACTOR_PREFIX,
} from './audit.js';
export type { SessionRow } from './sessions.js';
export {
  type SafetyEventInput,
  type SafetyEventRow,
  safetyEventRowId,
} from './safety-events.js';
export type { TurnTraceRow } from './turn-traces.js';
export {
  COST_ALARM_ACTOR,
  COST_ALARM_PAUSE_ACTION,
  type LiveSubscription,
  type PausedSubscription,
  type PauseFreeOptions,
} from './subscriptions.js';
export type { AgentRow, PublicAgentScope } from './agents.js';
export type {
  UnmeteredEntry,
  UnmeteredReason,
  UsageEntry,
  UsageRow,
  UsageSource,
  UsageSinceScope,
  UsageStatus,
  UsageTotals,
  TeacherUsageTotals,
} from './usage-ledger.js';
export {
  type EntitlementStoreOptions,
  entitlementStoreFor,
  sessionStateStoreFor,
  traceSinkFor,
  transcriptStoreFor,
  turnConfigStoreFor,
  type TurnConfigStoreOptions,
  usageMeterFor,
  type ScopedUsageMeter,
  type UnmeteredUsageInput,
  type UsageMeterContext,
} from './ports.js';
export { REDACTED, REDACT_MAX_DEPTH, redactPersonalData } from './redact-json.js';
