// Task 9.6 Phase B, plan Q3: the complete export -- one JSON document per student x teacher pair
// (the scope Edmate's repositories are already shaped around). It holds the subscription and
// package, progress, the learner profile, all evidence, every session with its messages, and
// every question to the teacher. It never holds `help_state` (the only place an answer key lives),
// turn traces, usage and cost, safety events, audit rows or account fields -- those stay out by
// never being read here at all, not by filtering a bigger read after the fact.
import type { EvidenceEvent, LearnerProfile, Message, TeacherQuestion } from '@edmate/contracts';
import { EVIDENCE_LIST_MAX, QUESTIONS_MAX_LIMIT, type Outline, type StudentScope } from '@edmate/db';
import type { AgentOwners } from '../turn/scope';
import { buildProgress, type Progress } from '../progress/progress';

/**
 * The keyset page cursor `sessions.listForStudent`/`messages.listForStudent` use (9.6a's own
 * `ExportCursor`, a module-local export of `packages/db/src/repositories/sessions.ts`, not
 * re-exported through the package barrel). Restated field-for-field here so this port has a real
 * type instead of `unknown` -- the repositories' own `ExportCursor` is structurally this same
 * shape, so wiring them up needs no cast (9.6g; re-exporting the db package's own type would need
 * a `packages/db` change, out of scope here).
 */
export interface ExportCursor {
  createdAt: string;
  id: string;
}

type ListFn<Row> = (
  scope: StudentScope,
  options: { after?: ExportCursor; limit: number },
) => Promise<{ items: Row[]; next: ExportCursor | null }>;

export interface ExportBackend {
  agents: AgentOwners;
  sessions: { listForStudent: ListFn<SessionExportRow> };
  messages: { listForStudent: ListFn<MessageExportRow> };
  learnerProfiles: { get(scope: StudentScope): Promise<LearnerProfile | null> };
  evidenceEvents: {
    list(
      scope: StudentScope,
      options: { limit: number },
    ): Promise<{ events: EvidenceEvent[]; truncated: boolean }>;
  };
  teacherQuestions: { listForStudent(scope: StudentScope): Promise<TeacherQuestion[]> };
  subscriptions: { findLive(scope: StudentScope): Promise<LiveSubscriptionLike | null> };
  packageVersions: {
    getById(scope: { teacherId: string }, packageVersionId: string): Promise<PackageConfigLike | null>;
  };
  outline: { getOutline(scope: { teacherId: string }): Promise<Outline | null> };
}

export interface SessionExportRow {
  id: string;
  agentId: string;
  agentVersion: number;
  packageId: string | null;
  packageVersion: number | null;
  summary: string | null;
  createdAt: string;
  endedAt: string | null;
}

export type MessageExportRow = Message & { sessionId: string };

interface LiveSubscriptionLike {
  id: string;
  packageVersionId: string;
  status: string;
  periodEnd: string;
}

interface PackageConfigLike {
  id: string;
  name: string;
  version: number;
  moduleIds: string[];
}

export interface ExportScope extends StudentScope {
  agentId: string;
}

export interface ExportJson {
  format: 'edmate-export';
  version: 1;
  exportedAt: string;
  agentId: string;
  complete: boolean;
  /** Named sections that hit a read cap and so may be missing rows; never silently complete. */
  truncated: string[];
  counts: { sessions: number; messages: number; evidence: number; teacherQuestions: number };
  subscription: {
    status: string;
    periodEnd: string;
    package: { id: string; name: string; version: number } | null;
  } | null;
  progress: Progress;
  learnerProfile: LearnerProfile | null;
  evidence: EvidenceEvent[];
  sessions: Array<SessionExportRow & { messages: Message[] }>;
  teacherQuestions: TeacherQuestion[];
}

/** The largest page a reader is asked for; must not exceed `sessions.ts`'s `EXPORT_PAGE_MAX`. */
const PAGE_SIZE = 500;
/** A hard ceiling on pages per reader: a runaway loop throws, it never silently truncates. */
const PAGE_CEILING = 200;

async function pageAll<Row>(list: ListFn<Row>, scope: StudentScope): Promise<Row[]> {
  const items: Row[] = [];
  let after: ExportCursor | undefined;
  for (let page = 0; page < PAGE_CEILING; page++) {
    const options = after === undefined ? { limit: PAGE_SIZE } : { after, limit: PAGE_SIZE };
    const res = await list(scope, options);
    items.push(...res.items);
    if (res.next === null) return items;
    after = res.next;
  }
  throw new Error(`export: paging did not terminate within ${String(PAGE_CEILING)} pages`);
}

function stripSessionId(m: MessageExportRow): Message {
  const { id, role, text, createdAt, sources } = m;
  return sources === undefined ? { id, role, text, createdAt } : { id, role, text, createdAt, sources };
}

/** Builds the complete export for one pair. `now` is the caller's clock (testable, no `Date.now`
 * inside). The agentId comes from the caller (the route's own URL param), never derived here. */
export async function buildExport(
  backend: ExportBackend,
  scope: ExportScope,
  now: string,
): Promise<ExportJson> {
  const studentScope: StudentScope = { studentId: scope.studentId, teacherId: scope.teacherId };
  const [sessionRows, messageRows, profile, evidenceRes, questions, subscription, outline] =
    await Promise.all([
      pageAll(backend.sessions.listForStudent, studentScope),
      pageAll(backend.messages.listForStudent, studentScope),
      backend.learnerProfiles.get(studentScope),
      backend.evidenceEvents.list(studentScope, { limit: EVIDENCE_LIST_MAX }),
      backend.teacherQuestions.listForStudent(studentScope),
      backend.subscriptions.findLive(studentScope),
      backend.outline.getOutline({ teacherId: scope.teacherId }),
    ]);

  let pkg: PackageConfigLike | null = null;
  if (subscription) {
    pkg = await backend.packageVersions.getById(
      { teacherId: scope.teacherId },
      subscription.packageVersionId,
    );
  }

  const messagesBySession = new Map<string, Message[]>();
  for (const row of messageRows) {
    const list = messagesBySession.get(row.sessionId) ?? [];
    list.push(stripSessionId(row));
    messagesBySession.set(row.sessionId, list);
  }
  const sessions = sessionRows.map((s) => ({ ...s, messages: messagesBySession.get(s.id) ?? [] }));

  const progress = buildProgress({
    outline,
    profile,
    allowedModuleIds: pkg?.moduleIds ?? [],
  });

  const truncated: string[] = [];
  if (evidenceRes.truncated) truncated.push('evidence');
  if (questions.length === QUESTIONS_MAX_LIMIT) truncated.push('teacherQuestions');

  return {
    format: 'edmate-export',
    version: 1,
    exportedAt: now,
    agentId: scope.agentId,
    complete: truncated.length === 0,
    truncated,
    counts: {
      sessions: sessions.length,
      messages: messageRows.length,
      evidence: evidenceRes.events.length,
      teacherQuestions: questions.length,
    },
    subscription: subscription
      ? {
          status: subscription.status,
          periodEnd: subscription.periodEnd,
          package: pkg ? { id: pkg.id, name: pkg.name, version: pkg.version } : null,
        }
      : null,
    progress,
    learnerProfile: profile,
    evidence: evidenceRes.events,
    sessions,
    teacherQuestions: questions,
  };
}
