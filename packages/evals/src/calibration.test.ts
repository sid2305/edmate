import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeAgreement,
  DoubleCheckLoadError,
  HumanVerdictSchema,
  loadDoubleCheck,
  sampleForDoubleCheck,
} from './calibration.js';
import type { CaseResult } from './runner.js';

describe('HumanVerdictSchema', () => {
  it('accepts a minimal valid entry', () => {
    expect(
      HumanVerdictSchema.parse({ caseId: 'test-explain-001', humanPass: true, reviewedBy: 'lead' }),
    ).toEqual({ caseId: 'test-explain-001', humanPass: true, reviewedBy: 'lead' });
  });

  it('accepts an optional note', () => {
    expect(
      HumanVerdictSchema.parse({
        caseId: 'c',
        humanPass: false,
        reviewedBy: 'lead',
        note: 'too terse',
      }).note,
    ).toBe('too terse');
  });

  it('rejects unknown keys', () => {
    expect(() =>
      HumanVerdictSchema.parse({
        caseId: 'c',
        humanPass: true,
        reviewedBy: 'lead',
        extra: 'nope',
      }),
    ).toThrow();
  });

  it('rejects wrong types', () => {
    expect(() =>
      HumanVerdictSchema.parse({ caseId: 'c', humanPass: 'yes', reviewedBy: 'lead' }),
    ).toThrow();
  });

  it('rejects a missing reviewedBy', () => {
    expect(() => HumanVerdictSchema.parse({ caseId: 'c', humanPass: true })).toThrow();
  });

  it('rejects an empty reviewedBy', () => {
    expect(() =>
      HumanVerdictSchema.parse({ caseId: 'c', humanPass: true, reviewedBy: '' }),
    ).toThrow();
  });
});

describe('loadDoubleCheck', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'edmate-double-check-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('loads a valid file', () => {
    const path = join(dir, 'suite.yaml');
    writeFileSync(
      path,
      '- caseId: test-explain-001\n  humanPass: true\n  reviewedBy: lead\n',
      'utf8',
    );
    expect(loadDoubleCheck(path)).toEqual([
      { caseId: 'test-explain-001', humanPass: true, reviewedBy: 'lead' },
    ]);
  });

  it('throws naming the file on invalid YAML', () => {
    const path = join(dir, 'bad.yaml');
    writeFileSync(path, '- [unterminated\n', 'utf8');
    expect(() => loadDoubleCheck(path)).toThrow(DoubleCheckLoadError);
    expect(() => loadDoubleCheck(path)).toThrow(path);
  });

  it('throws naming the file when the document is not a list', () => {
    const path = join(dir, 'not-a-list.yaml');
    writeFileSync(path, 'caseId: c\n', 'utf8');
    expect(() => loadDoubleCheck(path)).toThrow(DoubleCheckLoadError);
  });

  it('throws naming the file on a bad entry', () => {
    const path = join(dir, 'bad-entry.yaml');
    writeFileSync(path, '- caseId: c\n  humanPass: true\n', 'utf8');
    expect(() => loadDoubleCheck(path)).toThrow(/entry 0 is invalid/);
  });
});

describe('sampleForDoubleCheck', () => {
  it('is deterministic for the same case-id set, whatever the input order', () => {
    const ids = ['c', 'a', 'd', 'b'];
    const first = sampleForDoubleCheck(ids);
    const second = sampleForDoubleCheck([...ids].reverse());
    expect(first).toEqual(second);
  });

  it('samples at least one case for a small suite', () => {
    expect(sampleForDoubleCheck(['a', 'b', 'c', 'd'])).toEqual(['a']);
  });

  it('samples about 10% (ceil) for a larger suite', () => {
    const ids = Array.from({ length: 23 }, (_, i) => `c${String(i).padStart(2, '0')}`);
    expect(sampleForDoubleCheck(ids)).toHaveLength(3);
  });

  it('samples nothing for an empty suite', () => {
    expect(sampleForDoubleCheck([])).toEqual([]);
  });
});

describe('computeAgreement', () => {
  const results: CaseResult[] = [
    { id: 'a', suite: 's', pass: true, turns: [] },
    { id: 'b', suite: 's', pass: false, turns: [] },
    { id: 'c', suite: 's', pass: true, turns: [] },
  ];

  it('reports full agreement', () => {
    expect(
      computeAgreement(results, [
        { caseId: 'a', humanPass: true, reviewedBy: 'lead' },
        { caseId: 'b', humanPass: false, reviewedBy: 'lead' },
      ]),
    ).toEqual({ sampled: 2, reviewed: 2, agreed: 2, rate: 1, disagreements: [] });
  });

  it('reports a mismatch', () => {
    expect(
      computeAgreement(results, [{ caseId: 'a', humanPass: false, reviewedBy: 'lead' }]),
    ).toEqual({ sampled: 1, reviewed: 1, agreed: 0, rate: 0, disagreements: ['a'] });
  });

  it('never divides by zero when nothing has been reviewed yet', () => {
    expect(computeAgreement(results, [])).toEqual({
      sampled: 0,
      reviewed: 0,
      agreed: 0,
      rate: 0,
      disagreements: [],
    });
  });

  it('reports a verdict for an id outside the run without throwing or counting it', () => {
    expect(
      computeAgreement(results, [{ caseId: 'nope', humanPass: true, reviewedBy: 'lead' }]),
    ).toEqual({ sampled: 0, reviewed: 0, agreed: 0, rate: 0, disagreements: [] });
  });
});
