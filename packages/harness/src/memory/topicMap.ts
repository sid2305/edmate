// Topic map from the teacher's course outline (build plan line 442): modules -> topics -> skills,
// validated for unknown ids and cycles (task 6.1; see docs/tasks/6.1/plan.md).
//
// Pure, synchronous, dependency-free (no ModelGateway, no I/O) -- same "no real model calls" shape
// as the rest of packages/harness's memory/tools modules.
import { LIMITS } from '@edmate/contracts';
import { z } from 'zod';

/** A local, defensive bound so cycle detection never runs unbounded on a huge outline. */
const MAX_TOPICS = 2000;

/**
 * Same pseudonymous-id shape used everywhere else (`@edmate/contracts`'s internal `formats.ts`
 * `id()`, not itself part of the public package export): 1 to `LIMITS.idMaxLength` letters,
 * digits, `_` or `-`.
 */
const idFormat = () =>
  z
    .string()
    .min(1)
    .max(LIMITS.idMaxLength)
    .regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, _ or -');

const CourseOutlineModuleInputSchema = z.object({
  moduleId: idFormat(),
  title: z.string().min(1),
  order: z.number(),
});

const CourseOutlineTopicInputSchema = z.object({
  topicId: idFormat(),
  moduleId: idFormat(),
  title: z.string().min(1),
  order: z.number(),
  skillsBuilt: z.array(z.string()).optional(),
  prerequisiteTopicIds: z.array(idFormat()).optional(),
});

const CourseOutlineInputSchema = z.object({
  courseId: idFormat(),
  teacherId: idFormat(),
  modules: z.array(CourseOutlineModuleInputSchema).max(MAX_TOPICS),
  topics: z.array(CourseOutlineTopicInputSchema).max(MAX_TOPICS),
});

export type CourseOutlineModuleInput = z.infer<typeof CourseOutlineModuleInputSchema>;
export type CourseOutlineTopicInput = z.infer<typeof CourseOutlineTopicInputSchema>;
export type CourseOutlineInput = z.infer<typeof CourseOutlineInputSchema>;

export interface TopicMapTopic {
  topicId: string;
  moduleId: string;
  title: string;
  order: number;
  skillsBuilt: readonly string[];
  prerequisiteTopicIds: readonly string[];
}

export interface TopicMap {
  courseId: string;
  teacherId: string;
  getModule(moduleId: string): CourseOutlineModuleInput | undefined;
  getTopic(topicId: string): TopicMapTopic | undefined;
  topicsOf(moduleId: string): readonly TopicMapTopic[];
  /** Topological order (prerequisites first), ties broken by (module order, topic order, topicId). */
  topicOrder: readonly string[];
}

export type TopicMapReason =
  | 'invalid'
  | 'duplicate_module'
  | 'duplicate_topic'
  | 'unknown_module'
  | 'unknown_prerequisite'
  | 'cycle';

export type TopicMapResult =
  | { ok: true; value: TopicMap }
  | { ok: false; reason: TopicMapReason; id: string };

export function buildTopicMap(input: unknown): TopicMapResult {
  const parsed = CourseOutlineInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid', id: '' };
  const { courseId, teacherId, modules, topics } = parsed.data;

  const moduleById = new Map<string, CourseOutlineModuleInput>();
  for (const mod of modules) {
    if (moduleById.has(mod.moduleId)) {
      return { ok: false, reason: 'duplicate_module', id: mod.moduleId };
    }
    moduleById.set(mod.moduleId, mod);
  }

  const topicById = new Map<string, TopicMapTopic>();
  for (const topic of topics) {
    if (topicById.has(topic.topicId)) {
      return { ok: false, reason: 'duplicate_topic', id: topic.topicId };
    }
    topicById.set(topic.topicId, {
      topicId: topic.topicId,
      moduleId: topic.moduleId,
      title: topic.title,
      order: topic.order,
      skillsBuilt: topic.skillsBuilt ?? [],
      prerequisiteTopicIds: topic.prerequisiteTopicIds ?? [],
    });
  }

  for (const topic of topicById.values()) {
    if (!moduleById.has(topic.moduleId)) {
      return { ok: false, reason: 'unknown_module', id: topic.topicId };
    }
    for (const prereq of topic.prerequisiteTopicIds) {
      if (!topicById.has(prereq)) {
        return { ok: false, reason: 'unknown_prerequisite', id: topic.topicId };
      }
    }
  }

  const orderResult = topologicalOrder(topicById, moduleById);
  if (!orderResult.ok) return orderResult;

  const topicsOfModule = new Map<string, TopicMapTopic[]>();
  for (const topic of topicById.values()) {
    const list = topicsOfModule.get(topic.moduleId) ?? [];
    list.push(topic);
    topicsOfModule.set(topic.moduleId, list);
  }
  for (const list of topicsOfModule.values()) {
    list.sort((a, b) => a.order - b.order || a.topicId.localeCompare(b.topicId));
  }

  const map: TopicMap = {
    courseId,
    teacherId,
    getModule: (moduleId: string) => moduleById.get(moduleId),
    getTopic: (topicId: string) => topicById.get(topicId),
    topicsOf: (moduleId: string) => topicsOfModule.get(moduleId) ?? [],
    topicOrder: orderResult.value,
  };
  return { ok: true, value: map };
}

/**
 * Kahn's algorithm: topics with no remaining in-edges (prerequisites) are peeled off in tie-broken
 * order; anything left over at the end is on a cycle. `id` names one topic on the cycle, never the
 * whole path.
 */
function topologicalOrder(
  topicById: Map<string, TopicMapTopic>,
  moduleById: Map<string, CourseOutlineModuleInput>,
): { ok: true; value: readonly string[] } | { ok: false; reason: 'cycle'; id: string } {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const topic of topicById.values()) {
    inDegree.set(topic.topicId, topic.prerequisiteTopicIds.length);
    for (const prereq of topic.prerequisiteTopicIds) {
      const list = dependents.get(prereq) ?? [];
      list.push(topic.topicId);
      dependents.set(prereq, list);
    }
  }

  const tieBreak = (topicId: string): [number, number, string] => {
    const topic = topicById.get(topicId);
    if (!topic) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, topicId];
    const mod = moduleById.get(topic.moduleId);
    return [mod?.order ?? Number.MAX_SAFE_INTEGER, topic.order, topicId];
  };
  const compareTieBreak = (a: string, b: string): number => {
    const [am, ao, aid] = tieBreak(a);
    const [bm, bo, bid] = tieBreak(b);
    return am - bm || ao - bo || aid.localeCompare(bid);
  };

  const ready: string[] = [];
  for (const [topicId, degree] of inDegree) {
    if (degree === 0) ready.push(topicId);
  }
  ready.sort(compareTieBreak);

  const order: string[] = [];
  while (ready.length > 0) {
    const topicId = ready.shift() as string;
    order.push(topicId);
    const nextReady: string[] = [];
    for (const dependent of dependents.get(topicId) ?? []) {
      const degree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, degree);
      if (degree === 0) nextReady.push(dependent);
    }
    if (nextReady.length > 0) {
      ready.push(...nextReady);
      ready.sort(compareTieBreak);
    }
  }

  if (order.length < topicById.size) {
    const remaining = [...topicById.keys()]
      .filter((topicId) => !order.includes(topicId))
      .sort(compareTieBreak);
    return { ok: false, reason: 'cycle', id: remaining[0] as string };
  }

  return { ok: true, value: order };
}
