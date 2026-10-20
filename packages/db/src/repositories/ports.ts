import {
  type Entitlement,
  EntitlementSchema,
  type EntitlementStore,
  type EvidenceEvent,
  type LearnerProfile,
  type LocalePack,
  type PackageConfig,
  type ProfileStore,
  type SessionStateStore,
  type TeacherQuestion,
  type TeacherQuestionStore,
  type TraceSink,
  type TranscriptStore,
  type TurnConfigStore,
  type UsageMeter,
} from '@edmate/contracts';
import { RepositoryError } from './errors.js';
import type { Repositories } from './index.js';
import { studentScope, type StudentScope } from './scope.js';
import type { UnmeteredEntry, UsageSource } from './usage-ledger.js';

/**
 * The frozen TranscriptStore port has no scope parameter, so the scope is a required constructor
 * argument: the caller (web route or worker) builds one store per turn from the signed-in student
 * and the agent's teacher. Another pair's session reads as empty; appending to it, or to the
 * scope's own session once it has ended, is `not_found`.
 */
export function transcriptStoreFor(repos: Repositories, scope: StudentScope): TranscriptStore {
  const bound = studentScope(scope, 'transcriptStoreFor');
  return {
    history: (sessionId, limit) => repos.messages.history(bound, sessionId, limit),
    append: (sessionId, m) => repos.messages.append(bound, sessionId, m),
  };
}

/**
 * SessionStateStore (ADR-0005) for one student x teacher, built per turn like the transcript
 * store. Writes only that student's own open session; anything else is `not_found`. The
 * repository refuses a value over `LIMITS.helpStateMaxJsonLength` (or not serialisable) as
 * `invalid` before writing, whatever the caller checked.
 */
export function sessionStateStoreFor(repos: Repositories, scope: StudentScope): SessionStateStore {
  const bound = studentScope(scope, 'sessionStateStoreFor');
  return {
    saveHelpState: (sessionId, helpState) =>
      repos.sessions.saveHelpState(bound, sessionId, helpState),
  };
}

/**
 * TraceSink for one student x teacher: stores the whole TurnTrace on `trace.sessionId`, which
 * must be the scope's session (else `not_found`). One trace per turn (`invalid` on a second).
 */
export function traceSinkFor(repos: Repositories, scope: StudentScope): TraceSink {
  const bound = studentScope(scope, 'traceSinkFor');
  return { record: (t) => repos.turnTraces.insert(bound, t) };
}

/** A never-seen student's profile (task 3.17 decision): English, no mastery, no mistakes yet. */
function defaultProfile(scope: StudentScope): LearnerProfile {
  return { studentId: scope.studentId, teacherId: scope.teacherId, lang: 'en', mastery: {}, mistakes: [] };
}

/**
 * ProfileStore (task 3.17) for one student x teacher, built per turn like the other `*For`
 * adapters. `get`/`applyEvidence` take `(studentId, teacherId)` on the port itself (ADR-free,
 * contracts unchanged); here that pair must equal the bound scope, else `scope` — so a step can
 * never read or write another pair's profile even if it were handed the wrong ids.
 *
 * `applyEvidence` never calls `learnerProfiles.save()` (so `last_summary` is never touched here;
 * see `learnerProfilesRepo.applyMastery`'s doc comment): it appends the evidence (idempotent by
 * content-hash id — `evidenceEventsRepo.append`) and folds BKT only over the events that append
 * actually wrote (a replay then changes mastery zero times, not once more).
 *
 * The fold itself runs inside `learnerProfiles.applyEvidenceMastery`, under a row lock (review fix
 * round, 3.17): two concurrent calls here for the same pair each read the same `applied` list (if
 * their events truly are concurrent and distinct), but the lock means only one of them folds BKT
 * from a given prior mastery value at a time, so neither clobbers the other's update (no lost
 * update — see that method's doc comment).
 */
export function profileStoreFor(repos: Repositories, scope: StudentScope): ProfileStore {
  const bound = studentScope(scope, 'profileStoreFor');
  const checkPair = (studentId: string, teacherId: string, method: string) => {
    if (studentId !== bound.studentId || teacherId !== bound.teacherId) {
      throw new RepositoryError('scope', method);
    }
  };
  return {
    async get(studentId, teacherId) {
      checkPair(studentId, teacherId, 'profileStoreFor.get');
      const existing = await repos.learnerProfiles.get(bound);
      return existing ?? defaultProfile(bound);
    },
    async applyEvidence(events: EvidenceEvent[]) {
      const method = 'profileStoreFor.applyEvidence';
      if (!events.every((e) => e.studentId === bound.studentId && e.teacherId === bound.teacherId)) {
        throw new RepositoryError('scope', method);
      }
      if (events.length > 0) {
        const applied = await repos.evidenceEvents.append(bound, events);
        if (applied.length > 0) {
          await repos.learnerProfiles.applyEvidenceMastery(bound, applied);
        }
      }
      const profile = await repos.learnerProfiles.get(bound);
      return profile ?? defaultProfile(bound);
    },
  };
}

/**
 * TeacherQuestionStore (task 3.17) for one student x teacher's agent. `open` is scoped by the
 * port's own payload (it already carries `teacherId`/`agentId`/`studentId`): a payload naming
 * another pair is `scope`, never written.
 *
 * `findSimilar` always returns `[]`: no embeddings-backed similarity search exists yet (that is a
 * later RAG task); this ships the plumbing (the live 3.7 attempt and the 3.17 fallback both call
 * one `openTeacherQuestion` path) without inventing one. `similarIds` on a question opened through
 * this adapter is therefore always `[]` until that task lands — a decision logged in the task
 * handoff, not a contracts change (`TeacherQuestionStore.findSimilar` is unchanged).
 */
export function teacherQuestionStoreFor(
  repos: Repositories,
  scope: StudentScope,
): TeacherQuestionStore {
  const bound = studentScope(scope, 'teacherQuestionStoreFor');
  return {
    async findSimilar(teacherId: string) {
      if (teacherId !== bound.teacherId) throw new RepositoryError('scope', 'teacherQuestionStoreFor.findSimilar');
      const noSimilarity: TeacherQuestion[] = [];
      return noSimilarity;
    },
    async open(q) {
      const method = 'teacherQuestionStoreFor.open';
      if (q.teacherId !== bound.teacherId || q.studentId !== bound.studentId) {
        throw new RepositoryError('scope', method);
      }
      return repos.teacherQuestions.open(bound, {
        agentId: q.agentId,
        text: q.text,
        ...(q.moduleHint === undefined ? {} : { moduleHint: q.moduleHint }),
        similarIds: q.similarIds,
      });
    },
  };
}

/**
 * Trusted server state, bound when the composition root builds the store (task 3.2, plan Q2);
 * never taken from TurnInput.
 */
export interface EntitlementStoreOptions {
  /** The signed-in user's market. */
  market: string;
  /** The locale pack market for a user market: itself when a pack exists, else `global`. */
  packMarket(market: string): string;
  /** Studio preview: the package the teacher is previewing (its newest version is used). */
  preview?: { packageId: string };
  /** Eval runner: the teacher, package and version under test, and the market to run in. */
  eval?: { teacherId: string; packageId: string; version: number; market: string };
}

/**
 * EntitlementStore over the repositories (build plan § Access filter 1 and 7; ADR-0003 point 1).
 * - `subscription`: the live agent's teacher, the student's live (not ended) subscription with
 *   that teacher, and the package version it points at, which must be this agent's. Paused is
 *   returned as is; `entitle` refuses it.
 * - `teacher_preview`: only the agent's own teacher (the student id is the teacher's user id);
 *   drafts allowed; `opts.preview`'s package at its newest version. No subscription.
 * - `eval`: `opts.eval`'s package at its pinned version, of the agent's teacher. No subscription.
 * Allowed modules and skills are the package's; locked = the teacher's other modules.
 */
export function entitlementStoreFor(
  repos: Repositories,
  opts: EntitlementStoreOptions,
): EntitlementStore {
  const method = 'entitlementStore.resolve';

  async function build(x: {
    source: Entitlement['source'];
    studentId: string;
    teacherId: string;
    pkg: PackageConfig;
    market: string;
    status: Entitlement['status'];
    periodEnd: string;
    subscriptionId?: string;
  }): Promise<Entitlement> {
    const allowed = new Set(x.pkg.moduleIds);
    const all = await repos.modules.ids({ teacherId: x.teacherId });
    const parsed = EntitlementSchema.safeParse({
      source: x.source,
      ...(x.subscriptionId === undefined ? {} : { subscriptionId: x.subscriptionId }),
      studentId: x.studentId,
      teacherId: x.teacherId,
      agentId: x.pkg.agentId,
      market: opts.packMarket(x.market),
      packageId: x.pkg.id,
      packageVersion: x.pkg.version,
      status: x.status,
      periodEnd: x.periodEnd,
      allowedModuleIds: [...x.pkg.moduleIds],
      lockedModuleIds: all.filter((m) => !allowed.has(m)),
      skills: [...x.pkg.skills],
    });
    if (!parsed.success) throw new RepositoryError('integrity', method);
    return parsed.data;
  }

  return {
    async resolve({ studentId, agentId, source }, at) {
      if (source === 'subscription') {
        const owner = await repos.agents.owner({ agentId });
        if (owner === null) return null;
        const { teacherId } = owner;
        const sub = await repos.subscriptions.findLive({ studentId, teacherId });
        if (sub === null) return null;
        const pkg = await repos.packageVersions.getById({ teacherId }, sub.packageVersionId);
        if (pkg === null || pkg.agentId !== agentId) return null;
        return build({
          source,
          studentId,
          teacherId,
          pkg,
          market: opts.market,
          status: sub.status,
          periodEnd: sub.periodEnd,
          subscriptionId: sub.id,
        });
      }
      if (source === 'teacher_preview') {
        if (opts.preview === undefined) return null;
        // Scoped to the previewing user as a teacher: another teacher's agent reads as null.
        const agent = await repos.agents.get({ teacherId: studentId }, agentId);
        if (agent === null) return null;
        const pkg = await repos.packageVersions.latest(
          { teacherId: agent.teacherId },
          opts.preview.packageId,
        );
        if (pkg === null || pkg.agentId !== agentId) return null;
        return build({
          source,
          studentId,
          teacherId: agent.teacherId,
          pkg,
          market: opts.market,
          status: 'active',
          periodEnd: at,
        });
      }
      const ev = opts.eval;
      if (ev === undefined) return null;
      const agent = await repos.agents.get({ teacherId: ev.teacherId }, agentId);
      if (agent === null) return null;
      const pkg = await repos.packageVersions.get(
        { teacherId: agent.teacherId },
        { packageId: ev.packageId, version: ev.version },
      );
      if (pkg === null || pkg.agentId !== agentId) return null;
      return build({
        source,
        studentId,
        teacherId: agent.teacherId,
        pkg,
        market: ev.market,
        status: 'active',
        periodEnd: at,
      });
    },
  };
}

export interface TurnConfigStoreOptions {
  /** The locale pack for a market, or null. Until task 3.10 the composition root passes fixtures. */
  locales(market: string): LocalePack | null;
}

/**
 * TurnConfigStore over the repositories (ADR-0004). The session is read in the entitlement's
 * student x teacher scope and must be this agent's and open; the agent is loaded at exactly the
 * session row's server-set `agent_version`, the package at the entitlement's version, and the
 * style card row `agent.styleCardId` names (each version is its own immutable row).
 * The session must also be pinned to the entitlement's package and version (task 3.16); if not,
 * it is ended (see `sessions.endOnPackageChange`) and the load is null.
 */
export function turnConfigStoreFor(
  repos: Repositories,
  opts: TurnConfigStoreOptions,
): TurnConfigStore {
  return {
    async load(e, sessionId) {
      const session = await repos.sessions.get(
        { studentId: e.studentId, teacherId: e.teacherId },
        sessionId,
      );
      if (session === null || session.agentId !== e.agentId || session.endedAt !== null) {
        return null;
      }
      // Task 3.16: sessions follow the package. Any change of package or version since the
      // session was created ends it and clears the pair's last summary, so earlier history,
      // sources and summary never reach the model; the caller starts a fresh session. The scope
      // is the entitlement's, never the client's.
      if (session.packageId !== e.packageId || session.packageVersion !== e.packageVersion) {
        await repos.sessions.endOnPackageChange(
          { studentId: e.studentId, teacherId: e.teacherId },
          sessionId,
        );
        return null;
      }
      const scope = { teacherId: e.teacherId };
      const agent = await repos.agentVersions.get(scope, {
        agentId: e.agentId,
        version: session.agentVersion,
      });
      if (agent === null) return null;
      const [pkg, styleCard] = await Promise.all([
        repos.packageVersions.get(scope, { packageId: e.packageId, version: e.packageVersion }),
        repos.styleCards.get(scope, agent.styleCardId),
      ]);
      const locale = opts.locales(e.market);
      if (pkg === null || styleCard === null || locale === null) return null;
      // ADR-0005: the raw help_state, unvalidated; the harness parses it (task 3.4).
      return { agent, pkg, styleCard, locale, helpState: session.helpState };
    },
  };
}

/** The metering context: the same fields as the frozen UsageMeter.record's ctx. */
export interface UsageMeterContext {
  teacherId: string;
  packageId: string;
  studentId: string;
  turnId: string;
  source: UsageSource;
}

/** What `recordUnmetered` takes: the context plus the unmetered call's tier, reason and figures. */
export type UnmeteredUsageInput = UsageMeterContext & Omit<UnmeteredEntry, 'turnId' | 'source'>;

/**
 * A UsageMeter for one student x teacher, plus `recordUnmetered`. Together they are the sink that
 * `@edmate/gateway`'s metering wrapper (task 2.4) writes to; the composition root (3.7) builds one
 * per turn and passes it to `createMeteredGateway`. A context naming another teacher or student
 * is a `scope` error, so a wrong context can never bill another pair.
 */
export interface ScopedUsageMeter extends UsageMeter {
  recordUnmetered(u: UnmeteredUsageInput): Promise<void>;
}

export function usageMeterFor(repos: Repositories, scope: StudentScope): ScopedUsageMeter {
  const bound = studentScope(scope, 'usageMeterFor');
  const check = (ctx: { teacherId: string; studentId: string }, method: string) => {
    if (ctx.teacherId !== bound.teacherId || ctx.studentId !== bound.studentId) {
      throw new RepositoryError('scope', method);
    }
  };
  return {
    async record(u, ctx) {
      check(ctx, 'usageMeterFor.record');
      await repos.usageLedger.record(bound, ctx.packageId, {
        turnId: ctx.turnId,
        source: ctx.source,
        usage: u,
      });
    },
    async recordUnmetered(u) {
      check(u, 'usageMeterFor.recordUnmetered');
      const entry: UnmeteredEntry = {
        turnId: u.turnId,
        source: u.source,
        tier: u.tier,
        reason: u.reason,
        ...(u.model === undefined ? {} : { model: u.model }),
        ...(u.tokens === undefined ? {} : { tokens: u.tokens }),
      };
      await repos.usageLedger.recordUnmetered(bound, u.packageId, entry);
    },
  };
}
