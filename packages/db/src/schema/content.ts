// Data model rows: courses / modules / topics, documents / chunks, style_cards, corrections.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  chunkKind,
  documentStatus,
  EMBEDDING_DIMENSIONS,
  id,
  noteOrigin,
  timestamps,
  tsvector,
  tstz,
  vector,
} from './_shared.js';
import { liveClasses } from './operations.js';
import { teacherId } from './users.js';

/** From the teacher's outline. */
export const courses = pgTable(
  'courses',
  {
    id: id(),
    teacherId: teacherId(),
    title: text('title').notNull(),
    order: integer('order').notNull(),
    outlineVersion: integer('outline_version').notNull().default(1),
    ...timestamps(),
  },
  (t) => [index('courses_teacher_id_idx').on(t.teacherId)],
);

export const modules = pgTable(
  'modules',
  {
    id: id(),
    teacherId: teacherId(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id),
    title: text('title').notNull(),
    order: integer('order').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('modules_teacher_id_idx').on(t.teacherId),
    index('modules_course_id_idx').on(t.courseId),
  ],
);

export const topics = pgTable(
  'topics',
  {
    id: id(),
    teacherId: teacherId(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id),
    title: text('title').notNull(),
    order: integer('order').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('topics_teacher_id_idx').on(t.teacherId),
    index('topics_module_id_idx').on(t.moduleId),
  ],
);

/** An uploaded file, transcript or teacher note; split into chunks by ingest. */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    teacherId: teacherId(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id),
    kind: chunkKind('kind').notNull(),
    sourceTitle: text('source_title').notNull(),
    /** Object-store key of the original file; null for notes typed in the studio. */
    storageKey: text('storage_key'),
    rightsDeclaredAt: tstz('rights_declared_at'),
    /** Ingestion state (task 8.2). Rows from before migration 0017 were backfilled `ready`. */
    status: documentStatus('status').notNull().default('uploading'),
    /** A fixed failure code (an IngestErrorCode-like word), never raw error text; only when failed. */
    failureReason: text('failure_reason'),
    /**
     * The teacher's own live class this document records (task 11.4a); null for any other upload.
     * `ON DELETE SET NULL`: deleting a class unlinks its recordings, it never blocks or removes them.
     */
    liveClassId: text('live_class_id'),
    ...timestamps(),
  },
  (t) => [
    index('documents_teacher_id_idx').on(t.teacherId),
    index('documents_module_id_idx').on(t.moduleId),
    index('documents_live_class_id_idx')
      .on(t.liveClassId)
      .where(sql`${t.liveClassId} is not null`),
    // Task 8.2p, widened by task 8.2r at the 8.2q review's request: ingestSweep.staleProcessing's
    // `status IN ('processing', 'uploading') AND updated_at < $cutoff` range plus its
    // `ORDER BY updated_at, id` keyset, in one partial index. 0041 replaces the original
    // `status = 'processing'`-only predicate (`documents_processing_updated_at_id_idx`) with this
    // wider one: task 8.2q widens the sweep query itself to also catch stuck `uploading` rows, and
    // the old single-status predicate can no longer back that widened scan. The new predicate is
    // implied by both the original query (`status = 'processing'`) and the widened one, so this is
    // safe whichever of 8.2q/8.2r merges first. Schema-only (see migrate.ts's
    // POST_MIGRATE_STEPS), the same pattern as documents_live_class_id_idx above.
    index('documents_sweep_updated_at_id_idx')
      .on(t.updatedAt, t.id)
      .where(sql`${t.status} in ('processing', 'uploading')`),
    // Task 8.2r: backs listForTeacher's `WHERE teacher_id = $1 ORDER BY created_at DESC, id DESC
    // LIMIT 500` (chunks.ts). Full (non-partial) index -- all three columns are NOT NULL, so no
    // `.where()` and no `.nullsFirst()`/`.nullsLast()` annotation (Postgres's default NULLS
    // ordering never applies). Schema-only (see migrate.ts's POST_MIGRATE_STEPS), same pattern as
    // documents_sweep_updated_at_id_idx above.
    index('documents_teacher_id_created_at_id_idx').on(
      t.teacherId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check(
      'documents_failure_reason_only_when_failed',
      sql`${t.failureReason} is null or ${t.status} = 'failed'`,
    ),
    // A linked class must belong to the same teacher (task 11.4h): composite FK against
    // live_classes' (teacher_id, id) unique index, same shape as sessions_package_version_fk
    // (schema/learning.ts) referencing package_versions' unique (package_id, version) index.
    // The migration's hand-edited SQL uses the column-list form, `ON DELETE SET NULL
    // ("live_class_id")` (Postgres 15+), so only live_class_id is nulled on delete, not
    // teacher_id (which is NOT NULL) -- drizzle-orm's `.onDelete()` can't express a column
    // list, so `.onDelete('set null')` here is schema-only bookkeeping for `db:generate`'s
    // no-op check; the deployed clause is in the migration file, not generated from this.
    foreignKey({
      name: 'documents_teacher_id_live_class_id_live_classes_fk',
      columns: [t.teacherId, t.liveClassId],
      foreignColumns: [liveClasses.teacherId, liveClasses.id],
    }).onDelete('set null'),
  ],
);

/** Retrieval unit: pgvector embedding plus full text. */
export const chunks = pgTable(
  'chunks',
  {
    id: id(),
    teacherId: teacherId(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id),
    kind: chunkKind('kind').notNull(),
    text: text('text').notNull(),
    sourceTitle: text('source_title').notNull(),
    /** Page, slide, heading or timestamp. */
    locator: text('locator').notNull(),
    /** Null until embedded. Fixed at the platform embedding model's dimension (task 2.7). */
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    /** 'simple' config: no language-specific stemming, so it works for every locale. */
    search: tsvector('search')
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('simple', "text")`),
    ...timestamps(),
  },
  (t) => [
    index('chunks_teacher_id_module_id_idx').on(t.teacherId, t.moduleId),
    index('chunks_module_id_idx').on(t.moduleId),
    index('chunks_document_id_idx').on(t.documentId),
    index('chunks_search_idx').using('gin', t.search),
    // Cosine distance (`<=>`), the metric OpenAI embeddings are meant for (task 2.7; 5.3 ranks).
    index('chunks_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    // Task 13.4: retentionRepo.purgeOldTranscriptChunks' cutoff scan. Partial, since `kind =
    // 'transcript'` is the only kind that job ever purges (never `material`/`teacher_note`).
    index('chunks_transcript_created_at_idx')
      .on(t.kind, t.createdAt)
      .where(sql`${t.kind} = 'transcript'`),
  ],
);

/**
 * Task 5.3: one counter per teacher, bumped in the same transaction as every write to that
 * teacher's documents or chunks. leakCheck's cache key includes it (ADR-0007), so a material
 * change invalidates the cache across processes. Any future delete path (8.x, 13.4) must bump it.
 */
export const teacherMaterialRevisions = pgTable(
  'teacher_material_revisions',
  {
    id: id(),
    teacherId: teacherId(),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('teacher_material_revisions_teacher_id_key').on(t.teacherId)],
);

/**
 * Task 8.3: which chunks back each outline topic (the outline's source links). Both foreign keys
 * cascade: rewriting a topic drops its links, and deleting a document's chunks (8.2) drops any
 * topic's link to them. Display only, never a retrieval gate.
 */
export const topicChunks = pgTable(
  'topic_chunks',
  {
    id: id(),
    teacherId: teacherId(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('topic_chunks_teacher_id_topic_id_idx').on(t.teacherId, t.topicId),
    index('topic_chunks_chunk_id_idx').on(t.chunkId),
    uniqueIndex('topic_chunks_topic_id_chunk_id_key').on(t.topicId, t.chunkId),
  ],
);

/** The teacher's voice. Versions are immutable. */
export const styleCards = pgTable(
  'style_cards',
  {
    id: id(),
    teacherId: teacherId(),
    version: integer('version').notNull(),
    text: text('text').notNull(),
    mistakeTags: text('mistake_tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [uniqueIndex('style_cards_teacher_id_version_key').on(t.teacherId, t.version)],
);

/** A teacher's fix to an answer; also becomes a teacher-note chunk and an eval case. */
export const corrections = pgTable(
  'corrections',
  {
    id: id(),
    teacherId: teacherId(),
    moduleId: text('module_id').references(() => modules.id),
    question: text('question').notNull(),
    badAnswer: text('bad_answer').notNull(),
    correctedAnswer: text('corrected_answer').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('corrections_teacher_id_idx').on(t.teacherId),
    index('corrections_module_id_idx').on(t.moduleId),
  ],
);

/**
 * Task 5.10: a teacher answer or correction, turned into a per-agent accuracy row (7.3 converts
 * these into eval suite cases; teacher content never enters the public repo as YAML). Permanent:
 * `chunkId` and `teacherQuestionId` are plain text, not foreign keys, so a case survives a deleted
 * note or a cleaned-up question (its own retention is task 13.4).
 */
export const teacherEvalCases = pgTable(
  'teacher_eval_cases',
  {
    id: id(),
    teacherId: teacherId(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id),
    origin: noteOrigin('origin').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    /** The teacher_note chunk this case came from; no FK (see doc comment). */
    chunkId: text('chunk_id').notNull(),
    /** The teacher_questions row this answer closed, when there was one; no FK. */
    teacherQuestionId: text('teacher_question_id'),
    ...timestamps(),
  },
  (t) => [index('teacher_eval_cases_teacher_id_idx').on(t.teacherId)],
);
