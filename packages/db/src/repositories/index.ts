import type { Db } from '../client.js';
import { guarded } from './errors.js';
import { agentVersionsRepo } from './agent-versions.js';
import { agentsRepo } from './agents.js';
import { auditRepo } from './audit.js';
import { chunksRepo, documentsRepo } from './chunks.js';
import { correctionsRepo } from './corrections.js';
import { discoveryRepo } from './discovery.js';
import { evidenceEventsRepo, learnerProfilesRepo } from './learner.js';
import { messagesRepo } from './messages.js';
import { modulesRepo } from './modules.js';
import { notificationsRepo } from './notifications.js';
import { coursesRepo, outlineRepo } from './outline.js';
import { packageVersionsRepo } from './package-versions.js';
import { packagesRepo } from './packages.js';
import { publishRepo } from './publish.js';
import { retrievalRepo } from './retrieval.js';
import { safetyEventsRepo } from './safety-events.js';
import { sessionsRepo } from './sessions.js';
import { styleCardsRepo } from './style-cards.js';
import { subscriptionsRepo } from './subscriptions.js';
import { teacherEvalCasesRepo } from './teacher-eval-cases.js';
import { teacherProfilesRepo } from './teacher-profiles.js';
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
 * Every method takes a validated TeacherScope or StudentScope first (the public exceptions are
 * `agents.owner`, `packageVersions.liveForAgent`, `publish.publicScorecard` and all of
 * `discovery`, the public reads: see
 * README.md).
 */
export function createRepositories(db: Db) {
  return {
    agents: guardAll('agents', agentsRepo(db)),
    discovery: guardAll('discovery', discoveryRepo(db)),
    agentVersions: guardAll('agentVersions', agentVersionsRepo(db)),
    modules: guardAll('modules', modulesRepo(db)),
    styleCards: guardAll('styleCards', styleCardsRepo(db)),
    packageVersions: guardAll('packageVersions', packageVersionsRepo(db)),
    packages: guardAll('packages', packagesRepo(db)),
    teacherQuestions: guardAll('teacherQuestions', teacherQuestionsRepo(db)),
    teacherEvalCases: guardAll('teacherEvalCases', teacherEvalCasesRepo(db)),
    sessions: guardAll('sessions', sessionsRepo(db)),
    messages: guardAll('messages', messagesRepo(db)),
    turnTraces: guardAll('turnTraces', turnTracesRepo(db)),
    learnerProfiles: guardAll('learnerProfiles', learnerProfilesRepo(db)),
    evidenceEvents: guardAll('evidenceEvents', evidenceEventsRepo(db)),
    subscriptions: guardAll('subscriptions', subscriptionsRepo(db)),
    audit: guardAll('audit', auditRepo(db)),
    usageLedger: guardAll('usageLedger', usageLedgerRepo(db)),
    documents: guardAll('documents', documentsRepo(db)),
    chunks: guardAll('chunks', chunksRepo(db)),
    corrections: guardAll('corrections', correctionsRepo(db)),
    retrieval: guardAll('retrieval', retrievalRepo(db)),
    safetyEvents: guardAll('safetyEvents', safetyEventsRepo(db)),
    teacherProfiles: guardAll('teacherProfiles', teacherProfilesRepo(db)),
    notifications: guardAll('notifications', notificationsRepo(db)),
    courses: guardAll('courses', coursesRepo(db)),
    outline: guardAll('outline', outlineRepo(db)),
    publish: guardAll('publish', publishRepo(db)),
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
export type { AuditRow, TeacherProfileRow, TeacherQuestionForTeacher } from './map.js';
export { STYLE_CARD_LIMITS, type StyleCardDraftInput } from './style-cards.js';
export {
  GROUPS_MAX_LIMIT,
  GROUP_QUESTIONS_MAX,
  QUESTIONS_MAX_LIMIT,
  type AnswerResult,
  type TeacherQuestionGroup,
} from './teacher-questions.js';
export { TEACHER_EVAL_CASES_MAX, type TeacherEvalCaseRow } from './teacher-eval-cases.js';
export {
  NOTIFICATIONS_MAX_LIMIT,
  type NotificationRow,
} from './notifications.js';
export type {
  TeacherProfileCreate,
  TeacherProfileUpdate,
  TeacherVerificationInput,
} from './teacher-profiles.js';
export {
  AUDIT_JSON_MAX_LENGTH,
  AUDIT_MAX_LIMIT,
  type AuditEntryInput,
  SYSTEM_ACTOR_PREFIX,
} from './audit.js';
export type { SessionRow } from './sessions.js';
export { type SafetyEventInput, type SafetyEventRow, safetyEventRowId } from './safety-events.js';
export { TEACHER_TRACES_MAX_LIMIT, type TurnTraceRow } from './turn-traces.js';
export {
  COST_ALARM_ACTOR,
  COST_ALARM_PAUSE_ACTION,
  type LiveSubscription,
  type PausedSubscription,
  type PauseFreeOptions,
  type StartInput,
} from './subscriptions.js';
export type { AgentRow, DraftAgentInput, PublicAgentScope } from './agents.js';
export {
  DISCOVERY_MAX_PAGE,
  DISCOVERY_PAGE_SIZE,
  DISCOVERY_QUERY_MAX_LENGTH,
  type PublicTeacherCard,
  type PublicTeacherPage,
} from './discovery.js';
export {
  FAILED_CASES_MAX,
  type FailedCase,
  type FinishRunInput,
  FULL_SCOPE_GATE_DEADLINE_MS,
  GATE_DEADLINE_MS,
  GATE_GROUP_NAMES,
  GATE_RESULTS_MAX,
  GATE_RUN_STATUSES,
  GATE_SUITE,
  type GateCaseDetails,
  type GateCaseResult,
  type GateGroupName,
  type GateRunRow,
  type GateRunStatus,
  type GateRunSummary,
  type GoLiveInput,
  PUBLISH_CHANGE_KINDS,
  type PublicScorecard,
  type PublicScorecardCategory,
  type PublishBasis,
  type PublishChangeKind,
  type PublishPins,
  PublishRefusedError,
  type PublishRefusal,
  STALE_RUN_GRACE_MS,
  type StoredScorecard,
  type StoredScorecardCategory,
} from './publish.js';
export { PACKAGES_MAX, type PackageDraft, type TeacherPackageRow } from './packages.js';
export {
  AGENT_PACKAGES_MAX,
  type LivePackage,
  type PackageOffer,
  type TeacherPackageSummary,
} from './package-versions.js';
export type { CorrectionRecordInput, CorrectionRecordResult } from './corrections.js';
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
  correctionStoreFor,
  type EntitlementStoreOptions,
  entitlementStoreFor,
  profileStoreFor,
  retrievalIndexFor,
  sessionStateStoreFor,
  teacherQuestionStoreFor,
  traceSinkFor,
  transcriptStoreFor,
  turnConfigStoreFor,
  type TurnConfigStoreOptions,
  usageMeterFor,
  type ScopedUsageMeter,
  type UnmeteredUsageInput,
  type UsageMeterContext,
} from './ports.js';
export { EVIDENCE_LIST_MAX, type EvidenceEventEntry } from './learner.js';
export {
  CHUNK_TEXT_MAX_LENGTH,
  CHUNK_WRITE_MAX,
  chunkId,
  type ChunkDraft,
  DOCUMENT_LIST_MAX,
  type DocumentInput,
  type DocumentListOptions,
  insertTeacherNote,
  MODULE_CHUNKS_MAX,
  type ModuleChunk,
  type TeacherNoteWriteInput,
} from './chunks.js';
export {
  DEFAULT_COURSE_TITLE,
  DEFAULT_MODULE_TITLE,
  OUTLINE_MODULES_MAX,
  OUTLINE_TITLE_MAX_LENGTH,
  OUTLINE_TOPICS_MAX,
  type OutlineInput,
  TOPIC_CHUNKS_MAX,
} from './outline.js';
export type {
  CourseRow,
  Outline,
  OutlineModuleRow,
  OutlineSource,
  OutlineTopicRow,
} from './map.js';
export { DOCUMENT_STATUSES, type DocumentRow, type DocumentStatus } from './map.js';
export {
  type EmbedFallback,
  LEAK_CANDIDATE_MAX_LENGTH,
  LEAK_CANDIDATES_MAX,
  type LeakFallback,
  NOTE_MATCH_FLOOR,
  PROBE_FLOOR,
  RETRIEVAL_MAX_MODULES,
  type RetrievalIndexOptions,
  SEARCH_MAX_K,
  type ProbeInput,
  type SearchInput,
} from './retrieval.js';
export { REDACTED, REDACT_MAX_DEPTH, redactPersonalData } from './redact-json.js';
