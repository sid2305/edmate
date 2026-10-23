// The test chat's turn composition (task 8.5 Phase B): a sibling of `../../turn/deps.ts`'s
// `turnDepsFor`, reused as is (same queued ports, metered gateway, pricing, logging and fallback
// replies) with two differences: the entitlement store is built fresh per turn for one preview
// package, and `entitlementSource` is `teacher_preview` (the teacher is the student; drafts are
// allowed; no subscription and no age gate).
import { randomUUID } from 'node:crypto';
import type {
  EntitlementStore,
  EvidenceEvent,
  LearnerProfile,
  LocalePack,
  ProfileStore,
  RetrievalIndex,
  TeacherQuestion,
  TeacherQuestionStore,
  TurnConfigStore,
} from '@edmate/contracts';
import {
  entitlementStoreFor,
  retrievalIndexFor,
  turnConfigStoreFor,
  type Repositories,
  type StudentScope,
} from '@edmate/db';
import type { PipelineDeps } from '@edmate/harness';
import { turnDepsFor, type TurnProcess } from '../../turn/deps';

/** A fresh, unmoved profile for `(studentId, teacherId)` (same shape as `learnerProfileNew`). */
function freshProfile(studentId: string, teacherId: string): LearnerProfile {
  return { studentId, teacherId, lang: 'en', mastery: {}, mistakes: [] };
}

/**
 * The preview's own `ProfileStore` (8.5d, the 8.5b review's MEDIUM): a preview turn never has a
 * real learner to track, so `get` always answers a fresh profile and `applyEvidence` is a no-op
 * that neither enqueues a commit job nor touches `evidenceEvents`/`learnerProfiles` — unlike the
 * student turn's queued store, nothing here is ever written. Still returns the pair's (unmoved)
 * profile, so a step that reads the result back (as `commit` does) sees a valid shape.
 */
function previewProfileStore(): ProfileStore {
  return {
    get: (studentId, teacherId) => Promise.resolve(freshProfile(studentId, teacherId)),
    applyEvidence: (events: EvidenceEvent[]) => {
      const [first] = events;
      return Promise.resolve(freshProfile(first?.studentId ?? '', first?.teacherId ?? ''));
    },
  };
}

/**
 * The preview's own `TeacherQuestionStore` (8.5d, the 8.5b review's MEDIUM): an `ask_teacher` or
 * grounding escalation in a preview must not land in the teacher's own Ask-the-teacher inbox, so
 * `open` writes no `teacher_questions` row (no call to `repos.teacherQuestions`); it only shapes a
 * reply matching the caller's own scope, so the turn still completes as it would for a student.
 * `findSimilar` always answers `[]`: a question that is never stored has nothing to be similar to.
 */
function previewTeacherQuestionStore(): TeacherQuestionStore {
  return {
    findSimilar: () => Promise.resolve([]),
    open: (q) => {
      const question: TeacherQuestion = {
        ...q,
        id: `tq_preview_${randomUUID()}`,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      return Promise.resolve(question);
    },
  };
}

/** What `testChatDepsFor` needs, built once per process. */
export interface TestChatProcess extends Omit<TurnProcess, 'entitlements'> {
  /** The market preview turns run in (as the student turn's `EDMATE_MARKET`). */
  market: string;
  packMarket(market: string): string;
}

/** The ports that are the same for every preview turn. Retrieval is full text (no embedder yet). */
export function testChatPorts(
  repos: Repositories,
  opts: { locales(market: string): LocalePack | null },
): { turnConfig: TurnConfigStore; retrieval: RetrievalIndex } {
  return {
    turnConfig: turnConfigStoreFor(repos, { locales: opts.locales }),
    retrieval: retrievalIndexFor(repos, {}),
  };
}

/**
 * A `teacher_preview` entitlement store for one package. `learnerClear` is only asked for a
 * `subscription` resolve, which a preview never makes; it answers false so that, if one ever
 * were made here, it fails closed rather than skipping the age gate.
 */
export function previewEntitlementsFor(p: TestChatProcess, packageId: string): EntitlementStore {
  return entitlementStoreFor(p.repos, {
    market: p.market,
    packMarket: p.packMarket,
    learnerClear: async () => false,
    preview: { packageId },
  });
}

/** One preview turn's `PipelineDeps` for the teacher (as the student) and one package. */
export function testChatDepsFor(
  p: TestChatProcess,
  scope: StudentScope,
  packageId: string,
): PipelineDeps {
  const entitlements = previewEntitlementsFor(p, packageId);
  return {
    ...turnDepsFor({ ...p, entitlements }, scope),
    entitlementSource: 'teacher_preview',
    // 8.5d: the teacher is the student in a preview; neither port may write under their own
    // (teacher, teacher) pair (see `previewProfileStore`/`previewTeacherQuestionStore` above).
    profiles: previewProfileStore(),
    teacherQuestions: previewTeacherQuestionStore(),
  };
}
