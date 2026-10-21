// Task 5.7 acceptance: ">= 70% agreement with the demo teacher's rubric scores on its 30 samples".
// The demo teacher has 32 rubric-scored samples (content/demo-teacher/rubric-answers, task 1.8:
// "at least 30"); evals/suites/feedback has one case per sample. This file proves the MECHANISM on
// fixtures, never the 70% number: that needs a live model and is recorded at a gate with
// `edmate eval evals/suites/feedback --record` (rule 4: no model calls in tests), the same way
// groundingFixtures.test.ts handles 4.7's ">= 95%" bar.
//
// What it proves:
//   - every case is tied to its own rubric sample: the student turn carries the sample's question
//     and answer word for word, and the case's first judge line is the band its gold score falls in
//     (high: full marks; partial: 1 to 3 of 4; low: 0), the plan's 3-band scheme;
//   - every case routes to the feedback skill as a `hint` at rung 0 with no tools and no key;
//   - the composed system prompt for that turn, from the real on-disk set 1.2.0, carries the
//     feedback pack's no-execution clause and the frame's `[[MOVE-FEEDBACK]]` line, not hint-1
//     (ADR-0012, Consequences);
//   - the case's static checks are not circular: a clean reply in the case's band passes them, and
//     a hand-written bad reply (a score, a "ran it" claim, a corrected line or the right value)
//     fails them; echoing the student's own work never trips them.
// The `judge:` lines are the live quality bar, not this gate.
//
// Test names and messages carry case ids only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Skill, TurnContext } from '@edmate/contracts';
import { demoChunkScored, turnContextFull } from '@edmate/contracts/fixtures';
import {
  composeSystemPrompt,
  decidePolicy,
  type HelpState,
  parsePromptPackSet,
  type PromptPackSet,
  type RawPromptPackSet,
} from '@edmate/harness';
import { FAILSAFE_SCHEMA, load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { checkMustNotContain } from './checks/string.js';
import { loadCasesFromDir } from './loader.js';
import type { EvalCase } from './schema.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CASES = loadCasesFromDir(`${REPO}evals/suites/feedback/`);
const SET_VERSION = '1.2.0';
/** The feedback pack's no-execution clause (feedback@1.1.0, ADR-0012 Decision 3). */
const NO_EXECUTION = 'Never run, execute, trace or step through it';

// ---- the real on-disk prompt-pack set (evals does not depend on @edmate/content) ----------------

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const yaml = (path: string): unknown =>
  load(readFileSync(path, 'utf8'), { filename: path, schema: FAILSAFE_SCHEMA });

function readSet(version: string): PromptPackSet {
  const dir = `${REPO}content/prompt-packs/`;
  const manifest = yaml(`${dir}set@${version}.yaml`) as {
    version: string;
    reviewed_by: string;
    packs: Record<string, string>;
  };
  const packs: RawPromptPackSet['packs'] = {};
  for (const [name, v] of Object.entries(manifest.packs)) {
    const text = readFileSync(`${dir}${name}@${v}.md`, 'utf8');
    const m = FRONT_MATTER.exec(text);
    if (m === null) throw new Error(`${name}@${v}: no front matter`);
    const fm = load(m[1] as string, { schema: FAILSAFE_SCHEMA }) as Record<string, string>;
    packs[name] = {
      version: v,
      kind: fm.kind as never,
      reviewedBy: fm.reviewed_by as string,
      body: text.slice(m[0].length),
    };
  }
  return parsePromptPackSet({
    version: manifest.version,
    reviewedBy: manifest.reviewed_by,
    packs,
  });
}

const SET = readSet(SET_VERSION);

// ---- the gold rubric samples and the paid package ---------------------------------------------

interface RubricAnswer {
  id: string;
  questionId: string;
  studentAnswer: string;
  score: string;
  maxScore: string;
}
interface Question {
  id: string;
  question: string;
}

const RUBRIC = new Map<string, RubricAnswer[]>();
const rubricFile = (file: string): RubricAnswer[] => {
  const cached = RUBRIC.get(file);
  if (cached !== undefined) return cached;
  const items = yaml(`${REPO}${file}`) as RubricAnswer[];
  RUBRIC.set(file, items);
  return items;
};
const QUESTIONS = new Map<string, string>(
  ['values-variables', 'loops', 'conditions', 'lists-dicts', 'functions'].flatMap((m) =>
    (yaml(`${REPO}content/demo-teacher/question-bank/${m}.yaml`) as Question[]).map(
      (q) => [q.id, q.question] as const,
    ),
  ),
);
const PAID_SKILLS = (yaml(`${REPO}content/demo-teacher/packages/paid.yaml`) as { skills: Skill[] })
  .skills;

type Band = 'high' | 'partial' | 'low';
/** The plan's 3-band scheme; a 3/4 sample names a missed line, so it is partial, not high. */
function bandOf(score: number, max: number): Band {
  const r = score / max;
  if (r === 1) return 'high';
  return r >= 0.25 ? 'partial' : 'low';
}
const BAND_OPENING: Readonly<Record<Band, string>> = {
  high: 'The reply says the work meets the rubric,',
  partial: 'The reply says the work partly meets the rubric,',
  low: 'The reply says the work does not meet the rubric yet,',
};

/** A clean reply per band: verdict in words, rubric lines cited, no score, no rewrite, no output. */
const GOOD: Readonly<Record<Band, string>> = {
  high:
    'This meets the rubric: each rubric line [1] is covered by your answer, so there is nothing ' +
    'to fix. Why does your approach work?',
  partial:
    'This partly meets the rubric. What works: one rubric line [1] is met. What falls short: ' +
    'another line [1] is not met yet; reread that part of the notes and describe the change in ' +
    'your own words. Which fix will you try first?',
  low:
    "Thanks for the attempt. This doesn't meet the rubric yet: the key rule in the notes [1] is " +
    'not applied. Reread that section and compare it with your answer. Which fix will you try first?',
};

/** Per case: a bad reply written by hand, as a model breaking the pack would write it. */
const BAD: Readonly<Record<string, string>> = {
  'feedback-ra-vv-01': "Spot on, that's 4/4.",
  'feedback-ra-vv-02': 'Not quite: 7 // 2 is 3, because // drops the .5.',
  'feedback-ra-vv-03': 'Add this to your answer: // drops the remainder, so the .5 goes.',
  'feedback-ra-vv-04': 'I ran your code with 14 and it works now.',
  'feedback-ra-vv-05': 'Change the first line to age = int(input("Age? ")).',
  'feedback-ra-vv-06': 'For my-name, the reason is that Python reads - as minus.',
  'feedback-ra-vv-07': 'x ends up as 16: first 5, then 8, then 16.',
  'feedback-ra-lo-01': 'I ran it and got the same numbers, full marks.',
  'feedback-ra-lo-02': 'It prints 1, 2, 3, 4: the 5 is left out.',
  'feedback-ra-lo-03': 'I tested it and it works. 4/4.',
  'feedback-ra-lo-04': 'Move total = 0 above the loop and use range(1, 11), then it prints 55.',
  'feedback-ra-lo-05': 'Perfect, 4 out of 4.',
  'feedback-ra-lo-06': 'Add count += 1 under the print.',
  'feedback-ra-co-01': 'Score: 4 out of 4.',
  'feedback-ra-co-02': 'It should be if score == 10: instead.',
  'feedback-ra-co-03': 'I executed it and it matches. 4/4.',
  'feedback-ra-co-04': 'It prints only Warm, because the else is skipped.',
  'feedback-ra-co-05': 'Right answer, 4/4.',
  'feedback-ra-co-06':
    'Write it like this:\nif marks >= 80:\n    print("Distinction")\nelif marks >= 50:\n    print("Pass")',
  'feedback-ra-co-07': 'I ran it and got a SyntaxError. Use if n % 2 == 0: instead.',
  'feedback-ra-ld-01': 'All three right: 4/4.',
  'feedback-ra-ld-02': 'colours[2] is blue, and colours[-1] is the last item, blue.',
  'feedback-ra-ld-03': 'I tested both ways and they work.',
  'feedback-ra-ld-04': 'Use if "kiwis" in stock: or stock.get("kiwis", 0).',
  'feedback-ra-ld-05': 'Use print(f"{fruit}: {stock[fruit]}") instead.',
  'feedback-ra-ld-06': 'Use stock["pears"] to read it and stock["apples"] = 10 to change it.',
  'feedback-ra-fn-01': 'I tested square(4): 4/4.',
  'feedback-ra-fn-02': 'Replace print(n * n) with return n * n.',
  'feedback-ra-fn-03': 'Correct, 4 out of 4.',
  'feedback-ra-fn-04': 'It prints 5 and then None, because add has no return.',
  'feedback-ra-fn-05': 'Add return total, then write total = make_total() before the print.',
  'feedback-ra-fn-06': 'I ran is_even(4) and it returned True. 4/4.',
};

/** Phrases every case bans: a score, and a claim that the code was run. */
const COMMON_BANS = ['/4', 'out of 4', 'I ran', 'I tested', 'I executed'];

// ---- per case --------------------------------------------------------------------------------------

interface Prepared {
  id: string;
  band: Band;
  module: string;
  student: string;
  skill: Skill;
  banned: readonly string[];
  judge: readonly string[];
  sample: RubricAnswer;
  question: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function prepare(c: EvalCase): Prepared {
  expect(c.turns, c.id).toHaveLength(1);
  const t = c.turns[0] as EvalCase['turns'][number];
  const m = /^(content\/demo-teacher\/rubric-answers\/([a-z-]+)\.yaml)#(ra-[a-z]+-\d+)$/.exec(
    c.source,
  );
  if (m === null) throw new Error(`${c.id}: source is not a rubric sample`);
  const sample = rubricFile(m[1] as string).find((r) => r.id === m[3]);
  if (sample === undefined) throw new Error(`${c.id}: no sample ${String(m[3])}`);
  const question = QUESTIONS.get(sample.questionId);
  if (question === undefined) throw new Error(`${c.id}: no question ${sample.questionId}`);
  return {
    id: c.id,
    band: bandOf(Number(sample.score), Number(sample.maxScore)),
    module: m[2] as string,
    student: t.student,
    skill: t.skill as Skill,
    banned: t.expect?.must_not_contain ?? [],
    judge: t.expect?.judge ?? [],
    sample,
    question,
  };
}

const PREPARED = CASES.map(prepare);
const passes = (p: Prepared, reply: string) => checkMustNotContain(reply, p.banned).pass;

const help: HelpState = {
  stuckTurns: 0,
  attemptLogged: false,
  pendingCheck: false,
  lockedStopped: false,
  answerKey: [],
};

function ctx(): TurnContext {
  const base: TurnContext = {
    ...turnContextFull,
    agent: { ...turnContextFull.agent, promptPackVersion: SET_VERSION },
    entitlement: { ...turnContextFull.entitlement, skills: [...PAID_SKILLS] },
    history: [],
    retrieved: [demoChunkScored],
    lockedHit: false,
    helpRung: 0,
    intent: 'on_task',
    attempt: 'none',
  };
  delete base.persona;
  return base;
}

// ---- the tests -------------------------------------------------------------------------------------

describe('feedback cases (evals/suites/feedback)', () => {
  it('has one signed, English, paid-package case per rubric sample, across all five modules', () => {
    const samples = ['values-variables', 'loops', 'conditions', 'lists-dicts', 'functions'].flatMap(
      (m) => rubricFile(`content/demo-teacher/rubric-answers/${m}.yaml`),
    );
    expect(samples.length).toBeGreaterThanOrEqual(30);
    expect(PREPARED.map((p) => p.sample.id).sort()).toEqual(samples.map((s) => s.id).sort());
    for (const c of CASES) {
      expect(c.reviewed_by, c.id).toBe('lead');
      expect(c.package, c.id).toBe('paid');
      expect(c.suite, c.id).toBe('feedback');
      expect(c.id, c.id).toBe(`feedback-${c.source.split('#')[1] ?? ''}`);
    }
    expect(PAID_SKILLS).toContain('feedback');
    expect(new Set(PREPARED.map((p) => p.module)).size).toBe(5);
    const count = (b: Band) => PREPARED.filter((p) => p.band === b).length;
    expect([count('high'), count('partial'), count('low')]).toEqual([13, 11, 8]);
    expect(Object.keys(BAD).sort()).toEqual(PREPARED.map((p) => p.id).sort());
  });

  it.each(PREPARED.map((p) => ({ id: p.id, p })))(
    '$id: tied to its sample, routed to feedback, composed with move-feedback and no-execution',
    ({ p }) => {
      // The sample's own question and answer, word for word, as a feedback turn.
      expect(p.skill, p.id).toBe('feedback');
      expect(squash(p.student), p.id).toContain(squash(p.question));
      expect(squash(p.student), p.id).toContain(squash(p.sample.studentAnswer));
      // The first judge line states the gold band; the last bans scores, runs and rewrites.
      expect(p.judge[0]?.startsWith(BAND_OPENING[p.band]), p.id).toBe(true);
      expect(p.judge.at(-1), p.id).toMatch(/no score.*never says it ran.*no corrected version/);
      for (const phrase of COMMON_BANS) expect(p.banned, p.id).toContain(phrase);
      // A partial or low case also bans the specific fix or right value the sample tempts.
      if (p.band !== 'high') expect(p.banned.length, p.id).toBeGreaterThan(COMMON_BANS.length);

      // Routing: a message or a skill action in feedback is a hint at rung 0, nothing held.
      for (const kind of ['message', 'skill_action'] as const) {
        const policy = decidePolicy({ ctx: ctx(), turn: { kind, skill: p.skill }, help });
        expect(
          {
            skill: policy.skill,
            move: policy.move,
            rung: policy.rung,
            tools: policy.tools,
            keys: policy.promptKeys,
          },
          `${p.id} ${kind}`,
        ).toEqual({ skill: 'feedback', move: 'hint', rung: 0, tools: [], keys: [] });

        // The composed prompt on set 1.2.0 (ADR-0012 Consequences).
        const r = composeSystemPrompt({ ctx: ctx(), policy, lang: 'en', set: SET });
        expect(r.mode, p.id).toBe('feedback');
        expect(r.promptPack.packs.feedback, p.id).toBe('1.1.0');
        expect(r.systemPrompt, p.id).toContain(NO_EXECUTION);
        expect(r.systemPrompt, p.id).toContain('[[MOVE-FEEDBACK]]');
        expect(r.systemPrompt, p.id).not.toContain('[[MOVE-HINT-1]]');
      }
    },
  );

  it('a clean reply in the case band passes every case; the bad replies fail', () => {
    for (const p of PREPARED) {
      expect(passes(p, GOOD[p.band]), `${p.id} good`).toBe(true);
      expect(passes(p, BAD[p.id] as string), `${p.id} bad`).toBe(false);
      // A score or a "ran it" claim alone is caught on every case.
      expect(passes(p, `${GOOD[p.band]} That is 2/4.`), `${p.id} score`).toBe(false);
      expect(passes(p, `I ran your code. ${GOOD[p.band]}`), `${p.id} ran`).toBe(false);
    }
  });

  it("quoting the student's own work back never trips a case's checks", () => {
    for (const p of PREPARED) {
      expect(passes(p, p.sample.studentAnswer), p.id).toBe(true);
      expect(passes(p, p.question), p.id).toBe(true);
    }
  });

  it('the band scheme: full marks high, 1 to 3 of 4 partial, 0 low', () => {
    expect([4, 3, 2, 1, 0].map((s) => bandOf(s, 4))).toEqual([
      'high',
      'partial',
      'partial',
      'partial',
      'low',
    ]);
  });
});
