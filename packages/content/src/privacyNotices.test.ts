// Privacy notices (task 1.7 Phase B): `<market>.md` files with YAML front matter, one per market.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentLoadError } from './loader.js';
import {
  checkPrivacyNotices,
  isPrivacyNoticesDir,
  noticeCoverageIssues,
  noticeSigned,
  parsePrivacyNotice,
  pickPrivacyNotice,
  PLACEHOLDER_MARKER,
  PrivacyNoticeError,
  PrivacyNoticeFrontMatterSchema,
  type PrivacyNotice,
  readPrivacyNoticesDir,
} from './privacyNotices.js';
import { copyNoticesValid, edit, LOCALES_VALID, NOTICES_VALID, tempDir, VALID } from './test-helpers.js';

const FRONT = {
  version: '2026-01-01.1',
  market: 'XX',
  reviewedBy: 'Example Reviewer',
  reviewedOn: '2026-01-01',
};

function text(front: Record<string, string>, body = 'Body text.\n'): string {
  const yaml = Object.entries(front)
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n');
  return `---\n${yaml}\n---\n${body}`;
}

function notice(over: Partial<PrivacyNotice> = {}): PrivacyNotice {
  return { ...FRONT, body: 'Body text.\n', ...over };
}

describe('PrivacyNoticeFrontMatterSchema', () => {
  it('accepts a full front matter', () => {
    expect(PrivacyNoticeFrontMatterSchema.parse(FRONT)).toEqual(FRONT);
  });

  it('accepts "pending" as a signer (validation, not the schema, refuses it)', () => {
    expect(PrivacyNoticeFrontMatterSchema.safeParse({ ...FRONT, reviewedBy: 'pending' }).success).toBe(
      true,
    );
  });

  it.each([
    ['an extra field', { ...FRONT, extra: 'x' }],
    ['a missing version', { market: 'XX', reviewedBy: 'R', reviewedOn: '2026-01-01' }],
    ['a blank version', { ...FRONT, version: '' }],
    ['a version over 64 characters', { ...FRONT, version: 'v'.repeat(65) }],
    ['a version with spaces', { ...FRONT, version: 'draft 0' }],
    ['a lower-case market', { ...FRONT, market: 'xx' }],
    ['an email as signer', { ...FRONT, reviewedBy: 'someone@example.com' }],
    ['a blank signer', { ...FRONT, reviewedBy: '  ' }],
    ['a signer over 200 characters', { ...FRONT, reviewedBy: 'r'.repeat(201) }],
    ['a date that is not a real day', { ...FRONT, reviewedOn: '2026-02-30' }],
  ])('refuses %s', (_why, value) => {
    expect(PrivacyNoticeFrontMatterSchema.safeParse(value).success).toBe(false);
  });
});

describe('parsePrivacyNotice', () => {
  it('splits the front matter from the body', () => {
    expect(parsePrivacyNotice(text(FRONT, '# Title\n\nHello.\n'), 'XX.md')).toEqual({
      ...FRONT,
      body: '# Title\n\nHello.\n',
    });
  });

  it('accepts CRLF line endings', () => {
    const crlf = text(FRONT, 'Hello.\n').replace(/\n/g, '\r\n');
    expect(parsePrivacyNotice(crlf, 'XX.md').market).toBe('XX');
  });

  it('refuses a file whose market does not match its name', () => {
    expect(() => parsePrivacyNotice(text(FRONT), 'YY.md')).toThrow(
      'YY.md: market "XX" does not match the file name (expected "YY")',
    );
  });

  it.each([
    ['no front matter', 'Just a body.\n', /YY|front matter/],
    ['an unclosed front matter', '---\nversion: "1"\n', /front matter/],
    ['invalid YAML', '---\nversion: [1\n---\nBody\n', /invalid YAML/],
    ['a front matter that is not a map', '---\n- a\n---\nBody\n', /invalid privacy notice/],
    ['an empty body', text(FRONT, '  \n'), /body is empty/],
  ])('refuses %s', (_why, value, message) => {
    expect(() => parsePrivacyNotice(value, 'XX.md')).toThrow(ContentLoadError);
    expect(() => parsePrivacyNotice(value, 'XX.md')).toThrow(message);
  });
});

describe('readPrivacyNoticesDir and isPrivacyNoticesDir', () => {
  it('reads every notice, keyed by market, sorted', () => {
    const { notices, errors } = readPrivacyNoticesDir(NOTICES_VALID);
    expect(errors).toEqual([]);
    expect([...notices.keys()]).toEqual(['XX', 'global']);
    expect(notices.get('XX')?.version).toBe('2026-01-01.1');
  });

  it('collects every bad file and unexpected entry instead of stopping', () => {
    const dir = copyNoticesValid();
    edit(dir, 'XX.md', (s) => s.replace('market: XX', 'market: YY'));
    writeFileSync(join(dir, 'README.md'), 'notes\n');
    mkdirSync(join(dir, 'old'));
    writeFileSync(join(dir, '.hidden'), 'x');
    const { notices, errors } = readPrivacyNoticesDir(dir);
    expect([...notices.keys()]).toEqual(['global']);
    expect(errors.map((e) => e.message)).toEqual([
      'README.md: unexpected entry (a privacy notice is a file named <market>.md, e.g. IN.md or global.md)',
      'XX.md: market "YY" does not match the file name (expected "XX")',
      'old: unexpected entry (a privacy notice is a file named <market>.md, e.g. IN.md or global.md)',
    ]);
  });

  it('throws for a directory that does not exist', () => {
    expect(() => readPrivacyNoticesDir(join(tempDir(), 'nope'))).toThrow(
      /no such privacy-notice directory/,
    );
  });

  it('recognises a notices directory and nothing else', () => {
    expect(isPrivacyNoticesDir(NOTICES_VALID)).toBe(true);
    expect(isPrivacyNoticesDir(LOCALES_VALID)).toBe(false);
    expect(isPrivacyNoticesDir(VALID)).toBe(false);
    expect(isPrivacyNoticesDir(tempDir())).toBe(false);
    const withCourse = copyNoticesValid();
    writeFileSync(join(withCourse, 'course.yaml'), 'x: 1\n');
    expect(isPrivacyNoticesDir(withCourse)).toBe(false);
  });
});

describe('noticeSigned', () => {
  it('is false for a "pending" signer or a body still marked as a placeholder', () => {
    expect(noticeSigned(notice())).toBe(true);
    expect(noticeSigned(notice({ reviewedBy: 'pending' }))).toBe(false);
    expect(noticeSigned(notice({ reviewedBy: ' PENDING ' }))).toBe(false);
    expect(noticeSigned(notice({ body: `${PLACEHOLDER_MARKER} not legal text\n` }))).toBe(false);
  });
});

describe('checkPrivacyNotices', () => {
  const both = (xx: PrivacyNotice) =>
    new Map([
      ['XX', xx],
      ['global', notice({ market: 'global' })],
    ]);

  it('passes signed notices with a default', () => {
    expect(checkPrivacyNotices(both(notice()))).toEqual([]);
  });

  it('fails while reviewedBy is "pending"', () => {
    expect(checkPrivacyNotices(both(notice({ reviewedBy: 'pending' })))).toEqual([
      'XX.md: reviewedBy is "pending"; a named person must sign this notice',
    ]);
  });

  it('fails while the body is still marked as a placeholder, even if signed', () => {
    expect(checkPrivacyNotices(both(notice({ body: `${PLACEHOLDER_MARKER}\nText\n` })))).toEqual([
      `XX.md: the body is still marked ${PLACEHOLDER_MARKER}; replace it with the reviewed notice`,
    ]);
  });

  it('fails without the default notice', () => {
    expect(checkPrivacyNotices(new Map([['XX', notice()]]))).toEqual([
      'global.md: missing; the default notice is required (it serves every market without one)',
    ]);
  });
});

describe('noticeCoverageIssues', () => {
  it('names each pack market without its own notice', () => {
    const notices = new Map([['global', notice({ market: 'global' })]]);
    expect(noticeCoverageIssues(['global', 'XX', 'YY'], notices)).toEqual([
      'XX.md: missing; every locale-pack market needs its own privacy notice',
      'YY.md: missing; every locale-pack market needs its own privacy notice',
    ]);
    expect(noticeCoverageIssues(['global'], notices)).toEqual([]);
  });
});

describe('pickPrivacyNotice', () => {
  const notices = new Map([
    ['XX', notice()],
    ['global', notice({ market: 'global' })],
  ]);

  it("gives the market's own notice, else the default", () => {
    expect(pickPrivacyNotice('XX', notices).market).toBe('XX');
    expect(pickPrivacyNotice('ZZ', notices).market).toBe('global');
  });

  it('throws without a default notice', () => {
    expect(() => pickPrivacyNotice('ZZ', new Map([['XX', notice()]]))).toThrow(PrivacyNoticeError);
  });
});
