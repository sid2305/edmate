// Data model rows: courses / modules / topics, documents / chunks, style_cards, corrections.
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { chunkKind, id, timestamps, tsvector, tstz, vector } from './_shared.js';
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
    ...timestamps(),
  },
  (t) => [
    index('documents_teacher_id_idx').on(t.teacherId),
    index('documents_module_id_idx').on(t.moduleId),
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
    /** Null until embedded; dimension and HNSW index come with the embedding model (2.7/5.3). */
    embedding: vector('embedding'),
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
