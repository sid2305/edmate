// Reads a teacher content tree (task 1.8). Every bad file becomes a ContentLoadError naming
// it; `readContentTree` collects them all and keeps whatever loaded, so the validator can
// report every problem at once. File order comes from sorting paths, never from readdir.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import {
  CommonMistakeSchema,
  CourseSchema,
  PackageDraftSchema,
  QaRecallItemSchema,
  QuestionBankItemSchema,
  RawLicenceManifestSchema,
  RubricAnswerSchema,
  StyleCardDraftSchema,
  type CommonMistake,
  type Course,
  type PackageDraft,
  type QaRecallItem,
  type QuestionBankItem,
  type RawLicenceManifest,
  type RubricAnswer,
  type StyleCardDraft,
} from './schema.js';

export class ContentLoadError extends Error {
  override readonly name = 'ContentLoadError';

  constructor(
    /** Path relative to the content directory, with `/` separators. */
    readonly filePath: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`${filePath}: ${detail}`, options);
  }
}

export const LICENCES_FILE = 'licences.yaml';

export interface FileItems<T> {
  file: string;
  items: T[];
}

/** A fully loaded content tree. */
export interface DemoTeacherContent {
  dir: string;
  /** Every non-hidden file under `dir`, relative, sorted. */
  files: string[];
  /** Folder names under `modules/`, sorted. */
  moduleDirs: string[];
  course: Course;
  /** Module folder name → notes.md text. */
  notes: Map<string, string>;
  questionBank: FileItems<QuestionBankItem>[];
  rubricAnswers: FileItems<RubricAnswer>[];
  styleCard: StyleCardDraft;
  commonMistakes: CommonMistake[];
  qaRecall: QaRecallItem[];
  packages: { free: PackageDraft; paid: PackageDraft };
  licences: RawLicenceManifest;
}

/** What loaded; a part is missing when its file failed (and an error says why). */
export type ContentTree = Omit<
  DemoTeacherContent,
  'course' | 'styleCard' | 'commonMistakes' | 'qaRecall' | 'packages' | 'licences'
> &
  Partial<Pick<DemoTeacherContent, 'course' | 'styleCard' | 'commonMistakes' | 'qaRecall'>> & {
    packages: Partial<DemoTeacherContent['packages']>;
    licences?: RawLicenceManifest;
  };

const SINGLE_FILES = [
  'course.yaml',
  'style-card.yaml',
  'common-mistakes.yaml',
  'qa-recall.yaml',
  'packages/free.yaml',
  'packages/paid.yaml',
  LICENCES_FILE,
] as const;

function isHidden(rel: string): boolean {
  return rel.split('/').some((part) => part.startsWith('.'));
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .filter((rel) => !isHidden(rel))
    .sort();
}

function inLayout(rel: string): boolean {
  if ((SINGLE_FILES as readonly string[]).includes(rel)) return true;
  if (/^(?:question-bank|rubric-answers)\/[^/]+\.ya?ml$/.test(rel)) return true;
  // Notes plus any supporting files (each still needs a licence entry).
  return /^modules\/[^/]+\/.+/.test(rel);
}

export function readContentTree(dir: string): { tree: ContentTree; errors: ContentLoadError[] } {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`${dir}: no such content directory`);
  }
  const files = listFiles(dir);
  const errors: ContentLoadError[] = [];

  function parse<T>(rel: string, schema: z.ZodType<T>): T | undefined {
    let doc: unknown;
    try {
      doc = load(readFileSync(join(dir, rel), 'utf8'), { filename: rel });
    } catch (cause) {
      errors.push(
        new ContentLoadError(rel, `invalid YAML: ${(cause as Error).message}`, { cause }),
      );
      return undefined;
    }
    const parsed = schema.safeParse(doc);
    if (!parsed.success) {
      errors.push(
        new ContentLoadError(rel, `invalid content:\n${z.prettifyError(parsed.error)}`, {
          cause: parsed.error,
        }),
      );
      return undefined;
    }
    return parsed.data;
  }

  function single<T>(rel: (typeof SINGLE_FILES)[number], schema: z.ZodType<T>): T | undefined {
    if (!files.includes(rel)) {
      errors.push(new ContentLoadError(rel, 'missing required file'));
      return undefined;
    }
    return parse(rel, schema);
  }

  const course = single('course.yaml', CourseSchema);
  const styleCard = single('style-card.yaml', StyleCardDraftSchema);
  const commonMistakes = single('common-mistakes.yaml', z.array(CommonMistakeSchema));
  const qaRecall = single('qa-recall.yaml', z.array(QaRecallItemSchema));
  const free = single('packages/free.yaml', PackageDraftSchema);
  const paid = single('packages/paid.yaml', PackageDraftSchema);
  const licences = single(LICENCES_FILE, RawLicenceManifestSchema);

  function list<T>(
    folder: 'question-bank' | 'rubric-answers',
    schema: z.ZodType<T>,
  ): FileItems<T>[] {
    const yamls = files.filter((f) => new RegExp(`^${folder}/[^/]+\\.ya?ml$`).test(f));
    if (yamls.length === 0) errors.push(new ContentLoadError(`${folder}/`, 'no .yaml files'));
    const out: FileItems<T>[] = [];
    for (const file of yamls) {
      const items = parse(file, z.array(schema));
      if (items !== undefined) out.push({ file, items });
    }
    return out;
  }
  const questionBank = list('question-bank', QuestionBankItemSchema);
  const rubricAnswers = list('rubric-answers', RubricAnswerSchema);

  const moduleDirs = [
    ...new Set(files.flatMap((f) => /^modules\/([^/]+)\//.exec(f)?.[1] ?? [])),
  ].sort();
  const notes = new Map<string, string>();
  for (const m of moduleDirs) {
    const rel = `modules/${m}/notes.md`;
    if (!files.includes(rel)) continue; // reported by the module-reference rule
    const md = readFileSync(join(dir, rel), 'utf8');
    if (md.trim() === '') errors.push(new ContentLoadError(rel, 'notes are empty'));
    else notes.set(m, md);
  }

  for (const rel of files) {
    if (!inLayout(rel)) {
      errors.push(new ContentLoadError(rel, 'unexpected file (not part of the content layout)'));
    }
  }
  errors.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0));

  const tree: ContentTree = {
    dir,
    files,
    moduleDirs,
    notes,
    questionBank,
    rubricAnswers,
    packages: {
      ...(free === undefined ? {} : { free }),
      ...(paid === undefined ? {} : { paid }),
    },
    ...(course === undefined ? {} : { course }),
    ...(styleCard === undefined ? {} : { styleCard }),
    ...(commonMistakes === undefined ? {} : { commonMistakes }),
    ...(qaRecall === undefined ? {} : { qaRecall }),
    ...(licences === undefined ? {} : { licences }),
  };
  return { tree, errors };
}

/** Loads a complete content tree, throwing a ContentLoadError for the first bad file. */
export function loadDemoTeacherContent(dir: string): DemoTeacherContent {
  const { tree, errors } = readContentTree(dir);
  if (errors[0] !== undefined) throw errors[0];
  return tree as DemoTeacherContent;
}
