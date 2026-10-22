// Task 9.6 Phase B: a pure projection of the outline and a learner profile into what a student's
// progress page (and the complete export) shows. No chunk ids, source titles or locators reach the
// result -- titles only. `allowedModuleIds` (the live package's `moduleIds`) limits next steps to
// knowledge the student's current package actually covers; the rest of the outline still shows so
// progress made on a since-downgraded module isn't erased from view.
import type { LearnerProfile } from '@edmate/contracts';
import type { Outline } from '@edmate/db';

/** BKT convention (decision, 22 Oct 2026): mastered at p >= 0.95; covered means at least one check. */
const MASTERY_THRESHOLD = 0.95;
/** Next steps shown on the progress page and in the export. */
const NEXT_STEPS_MAX = 3;

export type TopicState = 'mastered' | 'practising' | 'not_started';

export interface ProgressTopic {
  id: string;
  title: string;
  state: TopicState;
}

export interface ProgressModule {
  id: string;
  title: string;
  topics: ProgressTopic[];
}

export interface ProgressStep {
  id: string;
  title: string;
  moduleId: string;
}

export interface Progress {
  modules: ProgressModule[];
  counts: { topicsCovered: number; topicsMastered: number };
  nextSteps: ProgressStep[];
  /** Mastery for a topic no longer in the outline: its id only. */
  other: string[];
}

export interface BuildProgressInput {
  outline: Outline | null;
  profile: LearnerProfile | null;
  allowedModuleIds: readonly string[];
}

const EMPTY_PROGRESS: Progress = {
  modules: [],
  counts: { topicsCovered: 0, topicsMastered: 0 },
  nextSteps: [],
  other: [],
};

function topicState(mastery: LearnerProfile['mastery'] | undefined, topicId: string): TopicState {
  const m = mastery?.[topicId];
  if (!m) return 'not_started';
  if (m.p >= MASTERY_THRESHOLD) return 'mastered';
  if (m.n >= 1) return 'practising';
  return 'not_started';
}

/** A pure projection; no I/O. The outline, the profile and the live package's moduleIds come from
 * the caller (the progress page and `buildExport` each read them server-side). */
export function buildProgress({ outline, profile, allowedModuleIds }: BuildProgressInput): Progress {
  if (outline === null) return EMPTY_PROGRESS;

  const allowed = new Set(allowedModuleIds);
  const mastery = profile?.mastery;
  const seenTopicIds = new Set<string>();
  const modules: ProgressModule[] = [];
  const practising: ProgressStep[] = [];
  const notStarted: ProgressStep[] = [];
  let topicsCovered = 0;
  let topicsMastered = 0;

  const sortedModules = [...outline.modules].sort((a, b) => a.order - b.order);
  for (const m of sortedModules) {
    const sortedTopics = [...m.topics].sort((a, b) => a.order - b.order);
    const topics: ProgressTopic[] = [];
    for (const t of sortedTopics) {
      seenTopicIds.add(t.id);
      const state = topicState(mastery, t.id);
      if (state === 'mastered' || state === 'practising') topicsCovered++;
      if (state === 'mastered') topicsMastered++;
      topics.push({ id: t.id, title: t.title, state });
      if (allowed.has(m.id)) {
        const step: ProgressStep = { id: t.id, title: t.title, moduleId: m.id };
        if (state === 'practising') practising.push(step);
        else if (state === 'not_started') notStarted.push(step);
      }
    }
    modules.push({ id: m.id, title: m.title, topics });
  }

  const other = mastery
    ? Object.keys(mastery).filter((topicId) => !seenTopicIds.has(topicId))
    : [];

  return {
    modules,
    counts: { topicsCovered, topicsMastered },
    nextSteps: [...practising, ...notStarted].slice(0, NEXT_STEPS_MAX),
    other,
  };
}
