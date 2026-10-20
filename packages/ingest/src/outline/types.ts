// Task 5.11: the outline drafter's in-memory candidate tree. Local to this package, not a
// contract: 6.1's "topic map from the course outline" persists a validated topic map later; this
// is only a draft the teacher edits before anything reaches a student (PRD steps 3 and 5).

/** One already-chunked piece the drafter may cite, same shape as `index/types.ts#ChunkDraft` plus
 * the id the store assigned it. */
export interface OutlineChunkInput {
  readonly id: string;
  readonly text: string;
  readonly locator: string;
}

export interface OutlineModuleInput {
  readonly moduleId: string;
  readonly title: string;
  /** Never empty: a module with no chunks has nothing to outline. */
  readonly chunks: readonly OutlineChunkInput[];
}

export interface TopicDraft {
  readonly topic: string;
  /** Every id here is one of this module's `chunks[].id`. */
  readonly chunkIds: readonly string[];
}

export interface ModuleOutlineDraft {
  readonly moduleId: string;
  readonly title: string;
  readonly topics: readonly TopicDraft[];
}

export interface OutlineDraft {
  readonly modules: readonly ModuleOutlineDraft[];
}
