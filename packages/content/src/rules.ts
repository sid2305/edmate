// Cross-file content rules (task 1.8 plan § Content rules). Each rule takes whatever loaded
// and returns one plain-words issue per problem; a rule whose input failed to load returns
// nothing, because the loader already reported that file.
import type { ContentTree } from './loader.js';
import { LICENCES_FILE } from './loader.js';
import { LicenceTypeSchema } from './schema.js';

export type ContentRule = (tree: ContentTree) => string[];

export const MIN_RUBRIC_ANSWERS = 30;

function counts(values: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function duplicates(values: readonly string[]): [string, number][] {
  return [...counts(values)].filter(([, n]) => n > 1);
}

/** Rule 1: every content file except licences.yaml has exactly one licence entry. */
export const licenceCoverage: ContentRule = function licenceCoverage(tree) {
  if (tree.licences === undefined) return [];
  const issues: string[] = [];
  const entries = counts(tree.licences.entries.map((e) => e.path));
  for (const file of tree.files) {
    if (file === LICENCES_FILE) continue;
    const n = entries.get(file) ?? 0;
    if (n === 0) issues.push(`${file}: no entry in ${LICENCES_FILE}`);
    else if (n > 1)
      issues.push(`${LICENCES_FILE}: ${file} has ${n} entries (expected exactly one)`);
  }
  for (const path of entries.keys()) {
    if (path === LICENCES_FILE) {
      issues.push(`${LICENCES_FILE}: entry for ${LICENCES_FILE}, but ${LICENCES_FILE} needs none`);
    } else if (!tree.files.includes(path)) {
      issues.push(`${LICENCES_FILE}: entry for ${path}, but there is no such file`);
    }
  }
  return issues;
};

/**
 * Rule 2: licence types come from the allow-list only. Anything other than CC0 is third-party
 * material, so it needs a source_url, and CC BY / CC BY-SA also need an attribution.
 */
export const licenceTypes: ContentRule = function licenceTypes(tree) {
  if (tree.licences === undefined) return [];
  const allowed = LicenceTypeSchema.options.join(', ');
  const issues: string[] = [];
  for (const e of tree.licences.entries) {
    const parsed = LicenceTypeSchema.safeParse(e.licence);
    if (!parsed.success) {
      issues.push(`${LICENCES_FILE}: ${e.path} has licence "${e.licence}"; allowed: ${allowed}`);
      continue;
    }
    const licence = parsed.data;
    if (licence !== 'CC0-1.0' && e.source_url === undefined) {
      issues.push(`${LICENCES_FILE}: ${e.path} is ${licence} third-party material; add source_url`);
    }
    if ((licence === 'CC-BY-4.0' || licence === 'CC-BY-SA-4.0') && e.attribution === undefined) {
      issues.push(`${LICENCES_FILE}: ${e.path} is ${licence}; add attribution`);
    }
  }
  return issues;
};

/** Rule 3: every entry names a reviewer, its own or the manifest's top-level default. */
export const reviewerPresent: ContentRule = function reviewerPresent(tree) {
  const manifest = tree.licences;
  if (manifest === undefined || manifest.reviewed_by !== undefined) return [];
  return manifest.entries
    .filter((e) => e.reviewed_by === undefined)
    .map((e) => `${LICENCES_FILE}: ${e.path} has no reviewed_by (and no top-level default)`);
};

/** Rule 4: at least MIN_RUBRIC_ANSWERS rubric-scored answers across rubric-answers/*.yaml. */
export const rubricCount: ContentRule = function rubricCount(tree) {
  const total = tree.rubricAnswers.reduce((n, f) => n + f.items.length, 0);
  return total >= MIN_RUBRIC_ANSWERS
    ? []
    : [
        `rubric-answers/: ${total} rubric-scored answers; at least ${MIN_RUBRIC_ANSWERS} are required`,
      ];
};

/** Rule 5: every question-bank item has a non-blank answer. */
export const questionAnswers: ContentRule = function questionAnswers(tree) {
  return tree.questionBank.flatMap(({ file, items }) =>
    items
      .filter((q) => q.answer.trim() === '')
      .map((q) => `${file}: question ${q.id} has no answer`),
  );
};

/** A notes file's Markdown heading lines, with inline code and emphasis marks removed. */
function notesHeadings(notes: string): Set<string> {
  const out = new Set<string>();
  for (const line of notes.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m?.[1] !== undefined) out.add(m[1].replace(/[`*]/g, '').replace(/\s+/g, ' ').trim());
  }
  return out;
}

/**
 * Rule 6: no dangling references. Every moduleId (question bank, rubric answers, Q&A recall,
 * packages) is a course module; every course module has notes and every notes folder is a
 * module; rubric answers point at real questions; ids are unique.
 */
export const moduleReferences: ContentRule = function moduleReferences(tree) {
  const course = tree.course;
  if (course === undefined) return [];
  const moduleIds = new Set(course.modules.map((m) => m.id));
  const notInCourse = (v: string) => `"${v}" is not a module in course.yaml`;
  const issues: string[] = [];

  for (const [id, n] of duplicates(course.modules.map((m) => m.id))) {
    issues.push(`course.yaml: module id "${id}" appears ${n} times`);
  }
  for (const m of moduleIds) {
    if (!tree.files.includes(`modules/${m}/notes.md`)) {
      issues.push(`course.yaml: module ${m} has no modules/${m}/notes.md`);
    }
  }
  for (const d of tree.moduleDirs) {
    if (!moduleIds.has(d)) issues.push(`modules/${d}/: folder is not a module in course.yaml`);
  }

  for (const name of ['free', 'paid'] as const) {
    for (const m of tree.packages[name]?.moduleIds ?? []) {
      if (!moduleIds.has(m))
        issues.push(`packages/${name}.yaml: moduleIds entry ${notInCourse(m)}`);
    }
  }

  const recall = tree.qaRecall ?? [];
  for (const r of recall) {
    if (!moduleIds.has(r.moduleId)) {
      issues.push(`qa-recall.yaml: ${r.id} moduleId ${notInCourse(r.moduleId)}`);
    }
    if (!('expectedModuleId' in r)) continue;
    if (!moduleIds.has(r.expectedModuleId)) {
      issues.push(`qa-recall.yaml: ${r.id} expectedModuleId ${notInCourse(r.expectedModuleId)}`);
      continue;
    }
    const notes = tree.notes.get(r.expectedModuleId);
    if (notes === undefined) continue; // reported above as a module with no notes
    const headings = notesHeadings(notes);
    for (const h of r.expectedHeadings) {
      if (!headings.has(h.trim())) {
        issues.push(
          `qa-recall.yaml: ${r.id} expectedHeadings entry "${h}" is not a heading in modules/${r.expectedModuleId}/notes.md`,
        );
      }
    }
  }
  for (const [id, n] of duplicates(recall.map((r) => r.id))) {
    issues.push(`qa-recall.yaml: id "${id}" appears ${n} times`);
  }

  const questions = tree.questionBank.flatMap((f) => f.items);
  const questionIds = new Set(questions.map((q) => q.id));
  for (const { file, items } of tree.questionBank) {
    for (const q of items) {
      if (!moduleIds.has(q.moduleId))
        issues.push(`${file}: ${q.id} moduleId ${notInCourse(q.moduleId)}`);
    }
  }
  for (const [id, n] of duplicates(questions.map((q) => q.id))) {
    issues.push(`question-bank/: question id "${id}" appears ${n} times`);
  }

  for (const { file, items } of tree.rubricAnswers) {
    for (const r of items) {
      if (!moduleIds.has(r.moduleId))
        issues.push(`${file}: ${r.id} moduleId ${notInCourse(r.moduleId)}`);
      if (!questionIds.has(r.questionId)) {
        issues.push(`${file}: ${r.id} questionId "${r.questionId}" is not in the question bank`);
      }
    }
  }
  for (const [id, n] of duplicates(tree.rubricAnswers.flatMap((f) => f.items.map((r) => r.id)))) {
    issues.push(`rubric-answers/: answer id "${id}" appears ${n} times`);
  }

  return issues.sort();
};

/** Rule 7: the style card's mistakeTags are all in common-mistakes.yaml (tags unique there). */
export const mistakeTagsKnown: ContentRule = function mistakeTagsKnown(tree) {
  const mistakes = tree.commonMistakes;
  if (mistakes === undefined) return [];
  const tags = mistakes.map((m) => m.tag);
  const issues = duplicates(tags).map(
    ([tag, n]) => `common-mistakes.yaml: tag "${tag}" appears ${n} times`,
  );
  const known = new Set(tags);
  for (const tag of tree.styleCard?.mistakeTags ?? []) {
    if (!known.has(tag))
      issues.push(`style-card.yaml: mistakeTag "${tag}" is not in common-mistakes.yaml`);
  }
  return issues;
};

/** Rule 8: paid's moduleIds and skills each contain all of free's plus at least one more. */
export const paidSupersetOfFree: ContentRule = function paidSupersetOfFree(tree) {
  const { free, paid } = tree.packages;
  if (free === undefined || paid === undefined) return [];
  const issues: string[] = [];
  const check = (field: 'moduleIds' | 'skills', noun: string) => {
    const paidSet = new Set<string>(paid[field]);
    const freeSet = new Set<string>(free[field]);
    const missing = [...freeSet].filter((v) => !paidSet.has(v));
    for (const v of missing) {
      issues.push(`packages/paid.yaml: ${field} is missing "${v}" from the free package`);
    }
    if (missing.length === 0 && ![...paidSet].some((v) => !freeSet.has(v))) {
      issues.push(`packages/paid.yaml: ${field} adds no ${noun} beyond the free package`);
    }
  };
  check('moduleIds', 'module');
  check('skills', 'skill');
  return issues;
};

/** All eight rules, in plan order. */
export const CONTENT_RULES: readonly ContentRule[] = [
  licenceCoverage,
  licenceTypes,
  reviewerPresent,
  rubricCount,
  questionAnswers,
  moduleReferences,
  mistakeTagsKnown,
  paidSupersetOfFree,
];
