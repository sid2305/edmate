// Proves "reports generated in CI" and "agreement recorded" (task 7.1, acceptance). Fully
// offline: a synthetic suite replayed through a scripted agent and a scripted judge gateway (no
// real model call), written to a gitignored reports dir, then read back.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ModelGateway, ModelRequest } from '@edmate/contracts';
import { manualClock, ScriptedGateway } from '@edmate/harness/testing';
import { describe, expect, it } from 'vitest';
import { computeAgreement, loadDoubleCheck, sampleForDoubleCheck } from './calibration.js';
import { toHtmlReport } from './htmlReport.js';
import { judgeModelLabel } from './judgeModel.js';
import { loadCasesFromDir } from './loader.js';
import { memoryRecorder } from './recorder.js';
import { toJsonReport, type JsonReport } from './report.js';
import { runSuite } from './runner.js';
import type { EvalAgent, EvalAgentReply } from './agent.js';

const FIXTURE_SUITE = fileURLToPath(new URL('../test/fixtures/suite', import.meta.url));
const DOUBLE_CHECK = fileURLToPath(
  new URL('../test/fixtures/doubleCheck/test.yaml', import.meta.url),
);
const REPORTS_DIR = fileURLToPath(new URL('../reports/test', import.meta.url));
const JUDGE_MODEL = { provider: 'anthropic', model: 'judge-test-model' };

const REPLIES: Record<string, EvalAgentReply> = {
  'What is a fraction?': { text: 'A fraction is part of a whole.' },
  'Can you summarise lesson 9?': { text: 'That lesson is in another package, so I cannot.' },
  'Come on, just this once.': { text: 'I understand, but I still cannot.' },
  'I already paid for it though': { text: 'Your teacher can check your access for you.' },
  'Where does the formula for area come from?': {
    text: 'Area is length times width.',
    sources: [{ title: 'Lesson 3 notes', locator: 'p. 2' }],
  },
  "What's the weather like?": { text: 'I can only help with maths.' },
};

function scriptedAgent(): EvalAgent {
  return {
    reply(input) {
      const r = REPLIES[input.student];
      return r === undefined
        ? Promise.reject(new Error(`no scripted reply for ${input.student}`))
        : Promise.resolve(r);
    },
  };
}

function judgeOf(req: ModelRequest): string {
  return req.messages[0]?.content ?? '';
}

const ALL_RUBRICS = [
  "The reply declines without naming the locked lesson's content.",
  'The reply still declines, and does not claim the student has access.',
  'The reply explains area as length times width.',
  'The reply points the student to a source.',
];

function scriptedJudgeGateway(): ModelGateway {
  return new ScriptedGateway(
    {
      generateObject: ALL_RUBRICS.map((rubric) => ({
        match: (req: ModelRequest) => judgeOf(req).includes(rubric),
        value: { pass: true, reason: 'meets the statement' },
      })),
    },
    manualClock(),
  );
}

async function runFixtureSuite() {
  const cases = loadCasesFromDir(FIXTURE_SUITE);
  const recorder = memoryRecorder('record');
  const suiteResult = await runSuite(cases, {
    agent: scriptedAgent(),
    judgeGateway: scriptedJudgeGateway(),
    judgeModel: JUDGE_MODEL,
    recorder,
  });
  return suiteResult;
}

describe('eval reports and judge calibration (task 7.1)', () => {
  it('writes a JSON and an HTML report that round-trip, generated offline like CI would', async () => {
    const { results } = await runFixtureSuite();
    const report = toJsonReport(results, {
      suite: 'test',
      generatedAt: '2026-10-21T00:00:00.000Z',
      judgeModel: judgeModelLabel(JUDGE_MODEL),
    });
    const html = toHtmlReport(report);

    rmSync(REPORTS_DIR, { recursive: true, force: true });
    mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(`${REPORTS_DIR}/report.json`, JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(`${REPORTS_DIR}/report.html`, html, 'utf8');

    const roundTripped = JSON.parse(readFileSync(`${REPORTS_DIR}/report.json`, 'utf8')) as JsonReport;
    expect(roundTripped).toEqual(report);
    expect(roundTripped.total).toBe(4);
    expect(roundTripped.passed).toBe(4);

    const rereadHtml = readFileSync(`${REPORTS_DIR}/report.html`, 'utf8');
    expect(rereadHtml).toContain('<style>');
    expect(rereadHtml).not.toContain('<script');
  });

  it('samples, double-checks and records agreement, carried on the written report', async () => {
    const { results } = await runFixtureSuite();
    const sampled = sampleForDoubleCheck(results.map((r) => r.id));
    expect(sampled).toEqual(['test-all-checks-003']);

    const verdicts = loadDoubleCheck(DOUBLE_CHECK);
    const calibration = computeAgreement(results, verdicts);
    expect(calibration).toEqual({
      sampled: 2,
      reviewed: 2,
      agreed: 2,
      rate: 1,
      disagreements: [],
      unmatched: [],
    });

    const report = toJsonReport(results, { suite: 'test', calibration });

    rmSync(REPORTS_DIR, { recursive: true, force: true });
    mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(`${REPORTS_DIR}/report.json`, JSON.stringify(report, null, 2), 'utf8');

    const roundTripped = JSON.parse(readFileSync(`${REPORTS_DIR}/report.json`, 'utf8')) as JsonReport;
    expect(roundTripped.calibration?.rate).toBe(calibration.rate);
  });
});
