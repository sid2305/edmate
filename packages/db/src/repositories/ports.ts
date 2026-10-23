import {
  type CorrectionStore,
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
import { studentScope, teacherScope, type StudentScope, type TeacherScope } from './scope.js';
import type { UnmeteredEntry, UsageSource } from './usage-ledger.js';

/** RetrievalIndex (task 5.3): built once per process over the repositories; see retrieval.ts. */
export { retrievalIndexFor } from './retrieval.js';

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
  return {
    studentId: scope.studentId,
    teacherId: scope.teacherId,
    lang: 'en',
    mastery: {},
    mistakes: [],
  };
}

/**
 * ProfileStore (task 3.17) for one student x teacher, built per turn like the other `*For`
 * adapters. `get`/`applyEvidence` take `(studentId, teacherId)` on the port itself (ADR-free,
 * contracts unchanged); here that pair must equal the bound scope, else `scope` — so a step can
 * never read or write another pair's profile even if it were handed the wrong ids.
 *
 * `applyEvidence` never calls `learnerProfiles.save()` (so `last_summary` is never touched here;
 * see `learnerProfilesRepo.applyMastery`'s doc comment): it appends the evidence (idempotent by
 * content-hash id) and folds BKT only over the events actually written (a replay then changes
 * mastery zero times, not once more).
 *
 * Fix round 1 (6.2): the append and the fold run inside **one** transaction
 * (`evidenceEventsRepo.appendAndFold`), not two — the previous shape (`evidenceEvents.append` then
 * a separate `learnerProfiles.applyEvidenceMastery` call, each its own transaction) left a gap
 * where a concurrent `rebuildMastery` could read the newly-committed event before the fold had run,
 * double-counting it between the rebuild's full replay and the incremental fold. See
 * `appendAndFold`'s doc comment (`learner.ts`) for the lock order that makes this safe.
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
      if (
        !events.every((e) => e.studentId === bound.studentId && e.teacherId === bound.teacherId)
      ) {
        throw new RepositoryError('scope', method);
      }
      if (events.length > 0) {
        await repos.evidenceEvents.appendAndFold(bound, events);
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
 *
 * Task 5.10 (§ Ask the teacher 2, Q1) added a *separate*, lexical grouping of a teacher's own open
 * questions, entirely inside `teacherQuestions.open`'s own transaction
 * (`question-similarity.ts`'s `bestGroup`) — never a real similarity search, and never through this
 * port. `findSimilar` stays `[]` here on purpose: it is not where grouping happens, and nothing
 * about grouping changes this adapter.
 */
export function teacherQuestionStoreFor(
  repos: Repositories,
  scope: StudentScope,
): TeacherQuestionStore {
  const bound = studentScope(scope, 'teacherQuestionStoreFor');
  return {
    async findSimilar(teacherId: string) {
      if (teacherId !== bound.teacherId)
        throw new RepositoryError('scope', 'teacherQuestionStoreFor.findSimilar');
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
 * CorrectionStore (task 5.10) for one bound teacher: `addTeacherNote` writes through
 * `repos.chunks.addTeacherNote` (the one transaction that creates the note, its chunk, the eval
 * case and bumps the material revision). A payload `teacherId` other than the bound one is
 * `scope`, so a step handed the wrong teacher can never file a note under someone else's modules.
 */
export function correctionStoreFor(repos: Repositories, scope: TeacherScope): CorrectionStore {
  const bound = teacherScope(scope, 'correctionStoreFor');
  return {
    addTeacherNote(n) {
      if (n.teacherId !== bound.teacherId) {
        return Promise.reject(new RepositoryError('scope', 'correctionStoreFor.addTeacherNote'));
      }
      return repos.chunks.addTeacherNote(bound, {
        moduleId: n.moduleId,
        question: n.question,
        answer: n.answer,
        origin: n.origin,
      });
    },
  };
}

/**
 * Trusted server state, bound when the composition root builds the store (task 3.2, plan Q2);
 * never taken from TurnInput.
 */
export interface EntitlementStoreOptions {
  /**
   * The market of a `teacher_preview` entitlement (there is no student there). Never read by a
   * `subscription` resolve since 9.4a; that reads `studentMarket`.
   */
  market: string;
  /**
   * Task 9.4a: the resolving student's own market (the identity store's `getMarket`), asked
   * fresh once a `subscription` entitlement is found; the only market source of that branch.
   * Optional only because preview and eval roots never make a subscription resolve; left out, a
   * `subscription` resolve throws `RepositoryError('integrity')` (9.4d: a wiring mistake fails
   * loudly, never a silent `no_access` and never the fixed `market`).
   */
  studentMarket?(studentId: string): Promise<string>;
  /** The locale pack market for a user market: itself when a pack exists, else `global`. */
  packMarket(market: string): string;
  /**
   * Task 1.7: is this learner past the age gate (`learnerStatus` is `clear`)? Asked fresh on every
   * `subscription` resolve; false gives `null`, so `entitle` answers `no_access`. Required, so a
   * composition root can't leave it out. Preview and eval don't ask.
   */
  learnerClear(studentId: string): Promise<boolean>;
  /** Studio preview: the package the teacher is previewing (its newest version is used). */
  preview?: { packageId: string };
  /** Eval runner: the teacher, package and version under test, and the market to run in. */
  eval?: { teacherId: string; packageId: string; version: number; market: string };
}

/**
 * EntitlementStore over the repositories (build plan § Access filter 1 and 7; ADR-0003 point 1).
 * - `subscription`: the live agent's teacher, the student's live (not ended) subscription with
 *   that teacher, and the package version it points at, which must be this agent's. Paused is
 *   returned as is; `entitle` refuses it. A learner held at the age gate (`opts.learnerClear`
 *   false, task 1.7) gets `null`. Its market is `opts.studentMarket(studentId)` (9.4a); with
 *   no `studentMarket` the resolve throws `RepositoryError('integrity')` (9.4d).
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
        // Second line behind apps/web's guard (1.7): asked first and fresh, never cached.
        if (!(await opts.learnerClear(studentId))) return null;
        // 9.4d: a root that makes subscription resolves must pass `studentMarket`; leaving it out
        // is a wiring mistake, so it fails loudly for every clear learner instead of a silent
        // `no_access`. (A root whose `learnerClear` is always false, like the studio preview,
        // never gets here.)
        if (opts.studentMarket === undefined) throw new RepositoryError('integrity', method);
        const owner = await repos.agents.owner({ agentId });
        if (owner === null) return null;
        const { teacherId } = owner;
        const sub = await repos.subscriptions.findLive({ studentId, teacherId });
        if (sub === null) return null;
        const pkg = await repos.packageVersions.getById({ teacherId }, sub.packageVersionId);
        if (pkg === null || pkg.agentId !== agentId) return null;
        // 9.4a: the student's own market, read fresh.
        const market = await opts.studentMarket(studentId);
        return build({
          source,
          studentId,
          teacherId,
          pkg,
          market,
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
