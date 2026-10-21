import { describe, expect, it } from 'vitest';
import {
  CommonMistakeSchema,
  CourseSchema,
  LicenceEntrySchema,
  LicenceManifestSchema,
  LicenceTypeSchema,
  PackageDraftSchema,
  QaRecallItemSchema,
  QuestionBankItemSchema,
  RubricAnswerSchema,
  StyleCardDraftSchema,
} from './schema.js';

const course = {
  id: 'python-basics',
  title: 'Python basics',
  description: 'Five short modules.',
  modules: [{ id: 'variables', title: 'Variables' }],
};

const pkg = {
  name: 'Free',
  moduleIds: ['variables'],
  skills: ['explain'],
  helpCeiling: 2,
  finalAnswers: 'never',
  dailyMessageLimit: 20,
  liveClassesPerMonth: 0,
  pricePerMonth: { amountMinor: 0, currency: 'USD' },
  lockedReply: 'name_package',
};

const rubric = {
  id: 'r1',
  moduleId: 'variables',
  questionId: 'q1',
  studentAnswer: 'x = 1',
  score: 7,
  maxScore: 10,
  rubricNotes: 'Correct, no explanation.',
};

describe('CourseSchema', () => {
  it('accepts a course with modules', () => {
    expect(CourseSchema.parse(course)).toEqual(course);
  });

  it.each(['id', 'title', 'description', 'modules'])('requires %s', (key) => {
    const copy: Record<string, unknown> = { ...course };
    delete copy[key];
    expect(CourseSchema.safeParse(copy).success).toBe(false);
  });

  it('rejects module ids outside the frozen id() format', () => {
    const bad = { ...course, modules: [{ id: 'has space', title: 'x' }] };
    expect(CourseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty module list and unknown keys', () => {
    expect(CourseSchema.safeParse({ ...course, modules: [] }).success).toBe(false);
    expect(CourseSchema.safeParse({ ...course, extra: 1 }).success).toBe(false);
  });
});

describe('licence schemas', () => {
  it.each(['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'public-domain'])('allows %s', (l) => {
    expect(LicenceTypeSchema.safeParse(l).success).toBe(true);
  });

  it.each(['CC-BY-NC-4.0', 'CC-BY-ND-4.0', 'CC-BY-NC-SA-4.0', 'MIT', '', 'cc-by-4.0'])(
    'rejects %j',
    (l) => {
      expect(LicenceEntrySchema.safeParse({ path: 'a.md', licence: l }).success).toBe(false);
    },
  );

  it('accepts an entry with optional source_url, attribution and reviewed_by', () => {
    const entry = {
      path: 'modules/a/notes.md',
      licence: 'CC-BY-SA-4.0',
      source_url: 'https://example.org/book',
      attribution: 'An Author',
      reviewed_by: 'sid2305',
    };
    expect(LicenceEntrySchema.parse(entry)).toEqual(entry);
  });

  it('rejects a source_url that is not a URL and an empty path', () => {
    expect(
      LicenceEntrySchema.safeParse({ path: 'a', licence: 'CC0-1.0', source_url: 'nope' }).success,
    ).toBe(false);
    expect(LicenceEntrySchema.safeParse({ path: '', licence: 'CC0-1.0' }).success).toBe(false);
  });

  it('rejects an email address as a reviewer (name or handle only)', () => {
    expect(
      LicenceEntrySchema.safeParse({
        path: 'a',
        licence: 'CC0-1.0',
        reviewed_by: 'reviewer@example.org',
      }).success,
    ).toBe(false);
    expect(
      LicenceManifestSchema.safeParse({ reviewed_by: 'someone@example.org', entries: [] }).success,
    ).toBe(false);
  });

  it('accepts a manifest with a top-level default reviewer', () => {
    const m = { reviewed_by: 'sid2305', entries: [{ path: 'a', licence: 'CC0-1.0' }] };
    expect(LicenceManifestSchema.parse(m)).toEqual(m);
  });
});

describe('item schemas', () => {
  it('QuestionBankItemSchema requires an answer field', () => {
    const q = { id: 'q1', moduleId: 'variables', question: 'What?', answer: 'This.' };
    expect(QuestionBankItemSchema.parse(q)).toEqual(q);
    const noAnswer: Record<string, unknown> = { ...q };
    delete noAnswer.answer;
    expect(QuestionBankItemSchema.safeParse(noAnswer).success).toBe(false);
  });

  it('RubricAnswerSchema accepts score within maxScore', () => {
    expect(RubricAnswerSchema.parse(rubric)).toEqual(rubric);
    expect(RubricAnswerSchema.safeParse({ ...rubric, score: 0 }).success).toBe(true);
    expect(RubricAnswerSchema.safeParse({ ...rubric, score: 10 }).success).toBe(true);
  });

  it.each([
    ['score above maxScore', { score: 11 }],
    ['negative score', { score: -1 }],
    ['fractional score', { score: 1.5 }],
    ['zero maxScore', { maxScore: 0, score: 0 }],
    ['empty rubric notes', { rubricNotes: '  ' }],
    ['empty student answer', { studentAnswer: '' }],
  ])('RubricAnswerSchema rejects %s', (_label, patch) => {
    expect(RubricAnswerSchema.safeParse({ ...rubric, ...patch }).success).toBe(false);
  });

  it('CommonMistakeSchema and QaRecallItemSchema require their fields', () => {
    expect(CommonMistakeSchema.safeParse({ tag: 'off-by-one', description: 'x' }).success).toBe(
      true,
    );
    expect(CommonMistakeSchema.safeParse({ tag: 'off-by-one' }).success).toBe(false);
    const r = {
      id: 'r1',
      moduleId: 'a',
      question: 'q?',
      expectedModuleId: 'a',
      expectedHeadings: ['1.1 Intro'],
      reviewed_by: 'pending',
    };
    expect(QaRecallItemSchema.safeParse(r).success).toBe(true);
    expect(QaRecallItemSchema.safeParse({ ...r, expectedModuleId: undefined }).success).toBe(false);
  });

  describe('QaRecallItemSchema (task 5.3: heading-level gold, out-of-course items)', () => {
    const inCourse = {
      id: 'r1',
      moduleId: 'a',
      question: 'q?',
      expectedModuleId: 'a',
      expectedHeadings: ['1.1 Intro', '1.2 More'],
      reviewed_by: 'lead',
    };
    const outOfCourse = { id: 'r2', moduleId: 'a', question: 'q?', outOfCourse: true, reviewed_by: 'pending' };

    it('accepts an in-course item with headings and an out-of-course item', () => {
      expect(QaRecallItemSchema.safeParse(inCourse).success).toBe(true);
      expect(QaRecallItemSchema.safeParse(outOfCourse).success).toBe(true);
    });

    it.each([
      ['no headings', { ...inCourse, expectedHeadings: undefined }],
      ['an empty heading list', { ...inCourse, expectedHeadings: [] }],
      ['a blank heading', { ...inCourse, expectedHeadings: [' '] }],
      ['no reviewed_by', { ...inCourse, reviewed_by: undefined }],
      ['an email as reviewer', { ...inCourse, reviewed_by: 'someone@example.org' }],
      ['an out-of-course item with gold', { ...outOfCourse, expectedModuleId: 'a' }],
      ['an out-of-course item with headings', { ...outOfCourse, expectedHeadings: ['x'] }],
      ['outOfCourse: false', { ...outOfCourse, outOfCourse: false }],
    ])('rejects %s', (_label, item) => {
      expect(QaRecallItemSchema.safeParse(item).success).toBe(false);
    });
  });
});

describe('drafts of the frozen contracts', () => {
  it('StyleCardDraftSchema accepts text and mistakeTags', () => {
    expect(StyleCardDraftSchema.parse({ text: 'Be kind.', mistakeTags: [] })).toEqual({
      text: 'Be kind.',
      mistakeTags: [],
    });
  });

  it('StyleCardDraftSchema reuses the frozen 300-word limit', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');
    expect(StyleCardDraftSchema.safeParse({ text: words(300), mistakeTags: [] }).success).toBe(
      true,
    );
    expect(StyleCardDraftSchema.safeParse({ text: words(301), mistakeTags: [] }).success).toBe(
      false,
    );
  });

  it.each(['id', 'teacherId', 'version'])('StyleCardDraftSchema rejects %s (still strict)', (k) => {
    const value = k === 'version' ? 1 : 'x';
    expect(StyleCardDraftSchema.safeParse({ text: 'a', mistakeTags: [], [k]: value }).success).toBe(
      false,
    );
  });

  it('PackageDraftSchema accepts a package without ids', () => {
    expect(PackageDraftSchema.parse(pkg)).toEqual(pkg);
  });

  it.each(['id', 'teacherId', 'version', 'agentId'])(
    'PackageDraftSchema rejects %s (still strict)',
    (k) => {
      const value = k === 'version' ? 1 : 'x';
      expect(PackageDraftSchema.safeParse({ ...pkg, [k]: value }).success).toBe(false);
    },
  );

  it('PackageDraftSchema keeps the frozen field rules', () => {
    expect(PackageDraftSchema.safeParse({ ...pkg, skills: ['fly'] }).success).toBe(false);
    expect(PackageDraftSchema.safeParse({ ...pkg, helpCeiling: 5 }).success).toBe(false);
  });
});
