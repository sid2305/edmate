// The CLI's `RetrievalIndex` (task 3.9 Phase A; lead answer Q3): a tiny in-process lexical index
// over the demo teacher's module notes, in place of the production `RetrievalIndex` (5.3), which
// needs Postgres+pgvector and an embedding pipeline this CLI does not have.
//
// Q3 rule, followed exactly: this file implements the harness's existing `RetrievalIndex` port and
// contains no access logic of its own. `search`/`probe`/`leakCheck` only ever look at the
// `teacherId`/`allowedModuleIds` (or `moduleIds`) scope the *caller* passes in; which modules a
// student may see is decided once, in the harness (`buildContext`, and 5.4's scoped search once it
// merges), never here. So there is never a second, unfiltered search path.
//
// The matching itself (word-overlap scoring, and the shared `lockedMatch` span check for
// `leakCheck`) is the harness's own tested `memoryRetrieval` helper (`@edmate/harness/testing`):
// reusing it keeps this file a thin content-to-`Chunk[]` adapter instead of a second
// implementation of the same lexical algorithm (handoff decision).
import type { DemoTeacherContent } from '@edmate/content';
import type { Chunk, RetrievalIndex } from '@edmate/contracts';
import { memoryRetrieval } from '@edmate/harness/testing';

/** One chunk per non-empty paragraph of a module's notes.md. */
function moduleChunks(content: DemoTeacherContent, teacherId: string, moduleId: string): Chunk[] {
  const text = content.notes.get(moduleId);
  if (text === undefined) return [];
  const title = content.course.modules.find((m) => m.id === moduleId)?.title ?? moduleId;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  return paragraphs.map((p, i) => ({
    id: `chunk_${moduleId}_${i}`,
    teacherId,
    documentId: `${moduleId}-notes`,
    moduleId,
    kind: 'material' as const,
    text: p,
    source: { title, locator: `¶${i + 1}`, kind: 'material' as const },
  }));
}

/** Builds the retrieval index over every module in the demo teacher's course. */
export function buildChatRetrieval(content: DemoTeacherContent, teacherId: string): RetrievalIndex {
  const chunks = content.course.modules.flatMap((m) => moduleChunks(content, teacherId, m.id));
  return memoryRetrieval({ chunks });
}
