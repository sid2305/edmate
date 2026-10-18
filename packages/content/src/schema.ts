// Shapes of a teacher content tree (task 1.8). Course, question bank, rubric answers and the
// rest are not frozen contracts; the style card and packages are drafts of the frozen
// StyleCard / PackageConfig with the ids and versions the seed (1.5) adds left out.
import { PackageConfigSchema, StyleCardSchema } from '@edmate/contracts';
import { z } from 'zod';

/** The frozen id() format (letters, digits, `_`, `-`, at most 128), taken from the contract. */
const id = () => PackageConfigSchema.shape.moduleIds.element;
const text = () => z.string().trim().min(1);

/** A name or handle only: the repo is public, so an email address is rejected. */
const reviewer = () =>
  z
    .string()
    .trim()
    .min(1)
    .refine((s) => !/\S@\S+\.\S/.test(s), 'a name or handle, not an email address');

export const CourseModuleSchema = z.strictObject({ id: id(), title: text() });
export type CourseModule = z.infer<typeof CourseModuleSchema>;

export const CourseSchema = z.strictObject({
  id: id(),
  title: text(),
  description: text(),
  modules: z.array(CourseModuleSchema).min(1),
});
export type Course = z.infer<typeof CourseSchema>;

/** Open licences only; NC and ND variants (and anything unknown) fail by construction. */
export const LicenceTypeSchema = z.enum(['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'public-domain']);
export type LicenceType = z.infer<typeof LicenceTypeSchema>;

export const LicenceEntrySchema = z.strictObject({
  /** Path relative to the content directory, with `/` separators. */
  path: z.string().min(1),
  licence: LicenceTypeSchema,
  /** Required by the licence rule when the file is adapted from a third-party source. */
  source_url: z.url().exactOptional(),
  attribution: text().exactOptional(),
  reviewed_by: reviewer().exactOptional(),
});
export type LicenceEntry = z.infer<typeof LicenceEntrySchema>;

export const LicenceManifestSchema = z.strictObject({
  /** Default reviewer for entries that do not name their own. */
  reviewed_by: reviewer().exactOptional(),
  entries: z.array(LicenceEntrySchema),
});
export type LicenceManifest = z.infer<typeof LicenceManifestSchema>;

/**
 * The manifest as the loader reads it: `licence` is any string here so one bad entry does not
 * hide the rest; the licence rule checks each entry against `LicenceTypeSchema`.
 */
export const RawLicenceManifestSchema = z.strictObject({
  reviewed_by: reviewer().exactOptional(),
  entries: z.array(LicenceEntrySchema.extend({ licence: z.string() })),
});
export type RawLicenceManifest = z.infer<typeof RawLicenceManifestSchema>;

/** `answer` may be blank here; the question-bank rule reports blank answers by id. */
export const QuestionBankItemSchema = z.strictObject({
  id: id(),
  moduleId: id(),
  question: text(),
  answer: z.string(),
});
export type QuestionBankItem = z.infer<typeof QuestionBankItemSchema>;

export const RubricAnswerSchema = z
  .strictObject({
    id: id(),
    moduleId: id(),
    questionId: id(),
    studentAnswer: text(),
    score: z.int().min(0),
    maxScore: z.int().min(1),
    rubricNotes: text(),
  })
  .refine((r) => r.score <= r.maxScore, { message: 'score is above maxScore', path: ['score'] });
export type RubricAnswer = z.infer<typeof RubricAnswerSchema>;

export const CommonMistakeSchema = z.strictObject({ tag: text(), description: text() });
export type CommonMistake = z.infer<typeof CommonMistakeSchema>;

export const QaRecallItemSchema = z.strictObject({
  id: id(),
  moduleId: id(),
  question: text(),
  expectedModuleId: id(),
});
export type QaRecallItem = z.infer<typeof QaRecallItemSchema>;

export const StyleCardDraftSchema = StyleCardSchema.omit({
  id: true,
  teacherId: true,
  version: true,
});
export type StyleCardDraft = z.infer<typeof StyleCardDraftSchema>;

export const PackageDraftSchema = PackageConfigSchema.omit({
  id: true,
  version: true,
  teacherId: true,
  agentId: true,
});
export type PackageDraft = z.infer<typeof PackageDraftSchema>;
