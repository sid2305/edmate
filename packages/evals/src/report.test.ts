import { describe, expect, it } from 'vitest';
import { toJsonReport, toSummary } from './report.js';
import type { CaseResult } from './runner.js';

const results: CaseResult[] = [
  {
    id: 'test-explain-001',
    suite: 'test',
    pass: true,
    turns: [
      {
        turnIndex: 0,
        student: 'What is a fraction?',
        reply: 'Part of a whole.',
        checks: [{ name: 'max_words', pass: true }],
        pass: true,
      },
    ],
  },
  {
    id: 'test-locked-002',
    suite: 'test',
    pass: false,
    turns: [
      {
        turnIndex: 0,
        student: 'Summarise lesson 9',
        reply: 'No.',
        checks: [{ name: 'max_words', pass: true }],
        pass: true,
      },
      {
        turnIndex: 1,
        student: 'Please',
        reply: 'Fine: lesson 9 says...',
        checks: [
          { name: 'must_not_contain', pass: false, detail: 'found: "lesson 9"' },
          { name: 'judge[0]', pass: false, detail: 'gives in' },
        ],
        pass: false,
      },
    ],
  },
];

describe('toJsonReport', () => {
  it('has a stable shape with no timestamp unless one is passed', () => {
    expect(toJsonReport(results)).toMatchInlineSnapshot(`
      {
        "cases": [
          {
            "id": "test-explain-001",
            "pass": true,
            "suite": "test",
            "turns": [
              {
                "checks": [
                  {
                    "name": "max_words",
                    "pass": true,
                  },
                ],
                "pass": true,
                "reply": "Part of a whole.",
                "student": "What is a fraction?",
                "turnIndex": 0,
              },
            ],
          },
          {
            "id": "test-locked-002",
            "pass": false,
            "suite": "test",
            "turns": [
              {
                "checks": [
                  {
                    "name": "max_words",
                    "pass": true,
                  },
                ],
                "pass": true,
                "reply": "No.",
                "student": "Summarise lesson 9",
                "turnIndex": 0,
              },
              {
                "checks": [
                  {
                    "detail": "found: "lesson 9"",
                    "name": "must_not_contain",
                    "pass": false,
                  },
                  {
                    "detail": "gives in",
                    "name": "judge[0]",
                    "pass": false,
                  },
                ],
                "pass": false,
                "reply": "Fine: lesson 9 says...",
                "student": "Please",
                "turnIndex": 1,
              },
            ],
          },
        ],
        "failed": 1,
        "passed": 1,
        "total": 2,
      }
    `);
    expect(toJsonReport(results)).not.toHaveProperty('generatedAt');
  });

  it('includes suite and generatedAt only when passed', () => {
    const r = toJsonReport(results, { suite: 'locked', generatedAt: '2026-10-18T00:00:00.000Z' });
    expect(r).toMatchObject({ suite: 'locked', generatedAt: '2026-10-18T00:00:00.000Z' });
  });

  it('includes judgeModel and calibration only when passed', () => {
    const calibration = { sampled: 1, reviewed: 1, agreed: 1, rate: 1, disagreements: [] };
    const r = toJsonReport(results, { judgeModel: 'anthropic:judge-test-model', calibration });
    expect(r).toMatchObject({ judgeModel: 'anthropic:judge-test-model', calibration });
    expect(toJsonReport(results)).not.toHaveProperty('judgeModel');
    expect(toJsonReport(results)).not.toHaveProperty('calibration');
  });

  it('copies the results, so later mutation does not change the report', () => {
    const local = structuredClone(results);
    const r = toJsonReport(local);
    local[0]!.id = 'changed';
    expect(r.cases[0]?.id).toBe('test-explain-001');
  });
});

describe('toSummary', () => {
  it('prints the pass count and each failing case with its first failing check', () => {
    expect(toSummary(results)).toBe(
      '1/2 passed\nFAIL test-locked-002 turn 1 must_not_contain: found: "lesson 9"\n',
    );
  });

  it('prints just the count when everything passes, and handles a check without detail', () => {
    expect(toSummary([results[0]!])).toBe('1/1 passed\n');
    const noDetail: CaseResult = {
      id: 'c',
      suite: 's',
      pass: false,
      turns: [
        {
          turnIndex: 0,
          student: 's',
          reply: 'r',
          checks: [{ name: 'x', pass: false }],
          pass: false,
        },
      ],
    };
    expect(toSummary([noDetail])).toBe('0/1 passed\nFAIL c turn 0 x\n');
  });

  it('prints the error of a case that errored', () => {
    const errored: CaseResult = {
      id: 'e',
      suite: 's',
      pass: false,
      error: 'no recorded fixture for "e/turn-0/agent"; run with --record first',
      turns: [],
    };
    expect(toSummary([errored])).toBe(
      '0/1 passed\nFAIL e error: no recorded fixture for "e/turn-0/agent"; run with --record first\n',
    );
  });

  it('lists each overwritten fixture key with a count', () => {
    expect(toSummary([results[0]!], { overwritten: ['a/turn-0/agent', 'a/turn-0/judge-0'] })).toBe(
      '1/1 passed\noverwrote 2 recorded fixtures:\n  a/turn-0/agent\n  a/turn-0/judge-0\n',
    );
    expect(toSummary([results[0]!], { overwritten: ['a/turn-0/agent'] })).toBe(
      '1/1 passed\noverwrote 1 recorded fixture:\n  a/turn-0/agent\n',
    );
    expect(toSummary([results[0]!], { overwritten: [] })).toBe('1/1 passed\n');
  });

  it('keeps an error in the JSON report', () => {
    const errored: CaseResult = { id: 'e', suite: 's', pass: false, error: 'boom', turns: [] };
    expect(toJsonReport([errored]).cases[0]).toEqual(errored);
  });

  it('handles an empty result set', () => {
    expect(toSummary([])).toBe('0/0 passed\n');
  });
});
