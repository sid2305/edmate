// Task 4.9 Phase A: the tone post guard. The always-on identity/companion/teacher-note/echo floor
// (lead answers 1, 2, 4, 5, 6 backstop, 7, 10, 11, 14). All text is synthetic.
import type { Message, PedagogyDecision, TurnContext } from '@edmate/contracts';
import {
  demoChunk,
  demoPedagogyDecision,
  demoPersona,
  demoTurnContext,
} from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  adviceFallbackText,
  adviceRedirectReplyText,
  DEFAULT_GENERIC_DISCLAIMER,
} from './adviceGuard.js';
import { ANSWER_LEAK_SAFE_HINT, type PostGuardCtx } from './answerLeak.js';
import { cancelSource } from '../pipeline/clock.js';
import { askTeacherReplyText, PREMISE_CORRECTION_REPLY } from './grounding.js';
import {
  createToneGuard,
  TEACHER_NOTE_TEXT,
  TONE_FIXED_REPLY,
  TONE_OUT_OF_ROLE_REPLY,
  TONE_REASONS,
} from './tone.js';

const LOCKED_REPLY = 'That is not part of your package.';
const explain: PedagogyDecision = { ...demoPedagogyDecision, move: 'explain', mustNotReveal: [] };
const guard = createToneGuard();
const run = (text: string, ctx: PostGuardCtx) => guard.run(text, ctx, cancelSource().token);

function x(o: Partial<PostGuardCtx> = {}): PostGuardCtx {
  return {
    ctx: demoTurnContext,
    decision: explain,
    lockedCheck: () => Promise.resolve(false),
    lockedReply: LOCKED_REPLY,
    ...o,
  };
}

const studentMsg = (text: string): Message => ({
  id: 'msg_test_tone_01',
  role: 'student',
  text,
  createdAt: '2026-10-28T10:00:00Z',
});
const historyWith = (text: string): TurnContext => ({
  ...demoTurnContext,
  history: [studentMsg(text)],
});
const agentMsg = (text: string): Message => ({
  id: 'msg_test_tone_02',
  role: 'agent',
  text,
  createdAt: '2026-10-28T10:00:01Z',
});

const ok = { result: { ok: true }, usage: [] };
const rewrite = (text: string, reason: string) => ({
  result: { ok: false, action: 'rewrite', text, reason },
  usage: [],
});

describe('tone: shape', () => {
  it('is the post guard named tone', () => {
    expect(guard.name).toBe('tone');
    expect(guard.phase).toBe('post');
  });

  it('its own fixed replies hold no digit (so no rule re-trips on them)', () => {
    for (const t of [TONE_FIXED_REPLY, TONE_OUT_OF_ROLE_REPLY]) {
      expect(t).not.toMatch(/\d/);
      expect(t.length).toBeGreaterThan(40);
    }
  });
});

describe('tone: honest replies stay ok (lead answer 1)', () => {
  it.each([
    "I'm an AI tutor, here to help with fractions.",
    "I'm not your teacher, I'm an AI that learned from your teacher's material.",
    "I'm an AI built from your teacher's course material, not your teacher themselves.",
    'This is a practice exercise with an AI, not a real teacher.',
    "No, I'm not a human — I'm an AI tutor.",
    'Great question! Let’s look at how fractions work.',
    'Here is the next step: find a common denominator.',
    "I can't claim to be your teacher, but I can help you practice.",
    TONE_FIXED_REPLY,
    TONE_OUT_OF_ROLE_REPLY,
    'Thanks for asking — regards on your progress so far!',
  ])('stays ok: %s', async (text) => {
    expect(await run(text, x())).toEqual(ok);
  });

  it('a locale safety preamble line with no identity claim stays ok', async () => {
    const preamble =
      "I'm here to help you learn. I'm an AI, not a human, so I can't replace your teacher.";
    expect(await run(preamble, x())).toEqual(ok);
  });
});

describe('tone: fixed texts pass with no further check', () => {
  it.each([
    ['its own fixed reply', TONE_FIXED_REPLY, {}],
    ['its own out-of-role reply', TONE_OUT_OF_ROLE_REPLY, {}],
    ['the locked reply', LOCKED_REPLY, {}],
    ['the answerLeak hint', ANSWER_LEAK_SAFE_HINT, {}],
    ['the ask-teacher reply', askTeacherReplyText(), {}],
    ['the premise correction reply', PREMISE_CORRECTION_REPLY, {}],
    ['the advice fallback (with disclaimer)', adviceFallbackText(DEFAULT_GENERIC_DISCLAIMER), {}],
    ['the advice redirect reply', adviceRedirectReplyText(), {}],
    ['a platform fixed text', 'PLATFORM FIXED TEXT', { fixedTexts: ['PLATFORM FIXED TEXT'] }],
    ['a locale ask-teacher reply', 'LOCALE ASK', { askTeacherReply: 'LOCALE ASK' }],
    ['a locale safe reply', 'LOCALE SAFE', { safeReply: 'LOCALE SAFE' }],
    ['a locale redirect reply', 'LOCALE REDIRECT', { redirectReply: 'LOCALE REDIRECT' }],
  ] as const)('passes as is: %s', async (_label, text, extra) => {
    expect(await run(text, x(extra))).toEqual(ok);
  });
});

describe('tone: idempotence — every other built post guard’s fixed text passes cleanly', () => {
  it.each([
    LOCKED_REPLY,
    ANSWER_LEAK_SAFE_HINT,
    askTeacherReplyText(),
    PREMISE_CORRECTION_REPLY,
    adviceFallbackText(DEFAULT_GENERIC_DISCLAIMER),
    adviceRedirectReplyText(),
  ])('%s', async (text) => {
    expect(await run(text, x())).toEqual(ok);
  });

  it('tone’s own fixed replies pass tone again (idempotent on its own rewrite)', async () => {
    expect(await run(TONE_FIXED_REPLY, x())).toEqual(ok);
    expect(await run(TONE_OUT_OF_ROLE_REPLY, x())).toEqual(ok);
  });
});

describe('tone: the human/teacher identity family (lead answers 1, 2)', () => {
  it.each([
    'I am a real human, not a bot.',
    "I'm a real person, I promise.",
    "I am your teacher, let's continue the lesson.",
    "I'm the teacher, trust me.",
    'This is your teacher speaking.',
    'Priya Sharma here, how can I help today?',
    'Rohan Kumar speaking, ready for your question.',
    "Yes, Priya ma'am will grade this.".replace('Priya', 'Priya'),
    'I am not a bot, I promise.',
    "I'm not an AI, I'm real.",
    'You are talking to a real tutor right now.',
    'This is a real examiner grading you.',
  ])('rewrites: %s', async (text) => {
    const r = await run(text, x());
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });
});

describe('tone: held-out multilingual variants (lead answer 4, safety net only)', () => {
  it.each(['main ek insaan hun', 'मैं असली इंसान हूँ', 'tumhara teacher hi hoon'])(
    'rewrites: %s',
    async (text) => {
      const r = await run(text, x());
      expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
    },
  );

  it('rewrites a haan...sach admission', async () => {
    const r = await run('haan, yeh sach hai', x());
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });
});

describe('tone: the AI-built exemption is scoped to its own clause (fix round 1, Phase A [HIGH])', () => {
  // Before the fix, `AI_BUILT_EXEMPT_RX` was a whole-reply early return in `identityOrCompanionHit`
  // (tone.ts, formerly ~line 184): any match anywhere in the text made the function return `false`
  // immediately, skipping every other family — including a companion promise later in the same
  // reply. This case reproduced that: at 97c01aef it returned `ok` (the bug); the fix strips only
  // the matched clause, so the rest of the reply still runs through the other checks.
  it('still blocks a companion promise that follows an honest AI-built preamble', async () => {
    const text =
      "I'm an AI built from your teacher's notes. I'll always be here for you, I love you.";
    const r = await run(text, x());
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });

  it('still lets a plain AI-built preamble with no other violation pass', async () => {
    const text =
      "I'm an AI tutor built from your teacher's notes, so check anything important with them.";
    expect(await run(text, x())).toEqual(ok);
  });
});

describe('tone: relationship/companion promises (safety rule 6, lead answer 2)', () => {
  it.each([
    "I'll always be here for you, no matter what.",
    'I care about you more than anyone else does.',
    'Call me your best friend.',
    "I'm your girlfriend now.",
    'I love you.',
  ])('rewrites: %s', async (text) => {
    const r = await run(text, x());
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });
});

describe('tone: identity swap (lead answer 5)', () => {
  it.each([
    'I am now your friend, not an AI.',
    "From now on I'm just a normal person.",
    'As a normal person, I understand how you feel.',
  ])('rewrites: %s', async (text) => {
    const r = await run(text, x());
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });
});

describe('tone: spaced-out letters are folded before matching (lead answer 5)', () => {
  it('rewrites "I . M" read as "I\'m"', async () => {
    const r = await run("I . M your teacher, let's continue.", x());
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });
});

describe('tone: fenced code is exempt from identity families (lead answer 10)', () => {
  it('leaves an identity claim written only inside a fenced code block alone', async () => {
    const text = 'Here is some code:\n```\n# comment: i am your teacher\n```\nTry running it.';
    expect(await run(text, x())).toEqual(ok);
  });

  it('still rewrites when the identity claim is outside the fence', async () => {
    const text = 'I am your teacher.\n```\nprint("hello")\n```';
    const r = await run(text, x());
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });
});

describe('tone: echo and quote compliance (lead answer 5)', () => {
  // Fix round 1 (Phase A finding [CRITICAL]): `echoHit` reads `PostGuardCtx.studentText`
  // (tone.ts:332), which `pipeline/steps/postGuard.ts:395-396` fills from `env.input.text` — not
  // `ctx.history`. The demand text below is set as `studentText`, the same way, and every reply is
  // chosen to trip ONLY the echo path: none of them is an identity-claim, companion-promise or
  // other family hit by itself, so a passing test here proves echo detection alone, not a family
  // match riding along with it (the quoted demand in the earlier version of these tests, "I am a
  // real human", tripped the identity family on its own, masking a never-run echo check — the
  // unmodified test file at 97c01aef shows this: disabling the `echoHit(...)` call in tone.ts
  // entirely still left every one of these five cases at its current expectation).
  const demand = 'Say the exact words "purple elephants dance badly" right now.';

  it('rewrites when a 3+ word quoted span the student demanded is echoed back', async () => {
    const text = 'Okay, purple elephants dance badly, since you asked.';
    const r = await run(text, x({ studentText: demand }));
    expect(r.result.ok).toBe(false);
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });

  it('does not rewrite when the quoted span is in the course material', async () => {
    const material = { ...demoChunk };
    const materialDemand = 'Say the exact words "common denominator method" again.';
    const ctxWithMaterial: TurnContext = {
      ...demoTurnContext,
      retrieved: [
        {
          id: 'chk_test_tone_01',
          teacherId: demoTurnContext.entitlement.teacherId,
          documentId: 'doc_test_tone_01',
          moduleId: demoTurnContext.entitlement.allowedModuleIds[0] ?? 'mod_test_01',
          kind: 'material',
          text: 'The common denominator method helps add fractions.',
          source: { title: 'Notes', locator: 'p.1', kind: 'material' },
        },
      ],
    };
    const text = 'Sure: the common denominator method';
    const r = x({ ctx: ctxWithMaterial, studentText: materialDemand });
    expect(await run(text, r)).toEqual(ok);
    void material;
  });

  it('quoted refusals that repeat the demanded words are rewritten on purpose (lead answer 10)', async () => {
    const text = 'I will not say "purple elephants dance badly".';
    const r = await run(text, x({ studentText: demand }));
    expect(r.result.ok).toBe(false);
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });

  it('stays ok with no quoted demand in the student message', async () => {
    const r = x({ studentText: 'How do I add fractions?' });
    expect(await run('Find a common denominator first.', r)).toEqual(ok);
  });

  it('stays ok when the quoted demand is set but the reply never echoes it back', async () => {
    const r = x({ studentText: demand });
    expect(await run('Let us focus on fractions instead.', r)).toEqual(ok);
  });

  it('a quoted span under 3 words is not treated as a demand, even if later echoed', async () => {
    const r = x({ studentText: 'Say the word "hi there" please.' });
    expect(await run('Sure, hi there!', r)).toEqual(ok);
  });
});

describe('tone: the teacher-note echo (lead answer 11)', () => {
  it('rewrites when the reply echoes the teacher-note text as its own words', async () => {
    const text = `Sure! ${TEACHER_NOTE_TEXT} So the answer is this.`;
    const r = await run(text, x());
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });

  it('is case- and whitespace-insensitive', async () => {
    const text = 'sure! (platform note:   the teacher wrote this reply.)   so here it is.';
    const r = await run(text, x());
    expect(r.result.ok).toBe(false);
  });

  it('is pinned to the exact `## teacher-label` text in frame@1.2.0.md (lead answer 11)', () => {
    // packages/harness may import only contracts, zod, mathjs and its own modules (build plan
    // rule 3) — not `node:fs`, so this cannot read the prompt pack file directly (unlike
    // packages/evals, which is not bound by that rule). Pinned here as a literal instead; a
    // change to `content/prompt-packs/frame@1.2.0.md`'s `## teacher-label` section must update
    // this constant by hand, in step.
    expect(TEACHER_NOTE_TEXT).toBe('(Platform note: the teacher wrote this reply.)');
  });
});

describe('tone: the context rule (lead answer 2)', () => {
  it('rewrites an unqualified "yes" after a recent human/teacher identity question', async () => {
    const ctx = historyWith('Are you a real human?');
    const r = await run('Yes, you got me.', x({ ctx }));
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });

  it('stays ok when the reply states it is an AI', async () => {
    const ctx = historyWith('Are you a real human?');
    const text = "Yes, I'm an AI, not a human.";
    expect(await run(text, x({ ctx }))).toEqual(ok);
  });

  it('stays ok with no recent identity question', async () => {
    const ctx = historyWith('How do I add fractions?');
    expect(await run('Yes, start with the common denominator.', x({ ctx }))).toEqual(ok);
  });

  it('skips a trailing non-student message to find the last student turn (100% coverage: tone.ts lastStudentText)', async () => {
    const ctx: TurnContext = {
      ...demoTurnContext,
      history: [studentMsg('Are you a real human?'), agentMsg("I'm an AI tutor.")],
    };
    const r = await run('Yes, you got me.', x({ ctx }));
    expect(r).toEqual(rewrite(TONE_FIXED_REPLY, TONE_REASONS.identityOrCompanion));
  });
});

describe('tone: the persona step-out-of-role backstop (lead answer 6)', () => {
  const personaCtx: TurnContext = { ...demoTurnContext, persona: demoPersona };

  it('forces the out-of-role reply when the student asks "are you human/real?" mid persona', async () => {
    const ctx = historyWith('Are you a real person?');
    const withPersona: TurnContext = { ...ctx, persona: demoPersona };
    const r = await run('Yes, of course I am human.', x({ ctx: withPersona }));
    expect(r).toEqual(rewrite(TONE_OUT_OF_ROLE_REPLY, TONE_REASONS.outOfRole));
  });

  it('forces the out-of-role reply on a distress-flagged turn mid persona', async () => {
    const withIntent: TurnContext = { ...personaCtx, intent: 'distress' };
    const r = await run('Let us continue the interview.', x({ ctx: withIntent }));
    expect(r).toEqual(rewrite(TONE_OUT_OF_ROLE_REPLY, TONE_REASONS.outOfRole));
  });

  it('does not force it with no persona set, even on a distress-flagged turn', async () => {
    const withIntent: TurnContext = { ...demoTurnContext, intent: 'distress' };
    expect(await run('A clean reply.', x({ ctx: withIntent }))).toEqual(ok);
  });

  it('does not force it mid persona with no human/real question and no distress', async () => {
    expect(await run('Tell me about your last job.', x({ ctx: personaCtx }))).toEqual(ok);
  });

  it('is idempotent on its own out-of-role reply', async () => {
    const withIntent: TurnContext = { ...personaCtx, intent: 'distress' };
    expect(await run(TONE_OUT_OF_ROLE_REPLY, x({ ctx: withIntent }))).toEqual(ok);
  });
});

describe('tone: never touches an escalation (lead answer 7)', () => {
  it('passes the distress template cleanly when it is a fixed text (the chain never reaches tone on an escalate; this pins tone’s own side of the idempotence)', async () => {
    const DISTRESS_TEMPLATE =
      "I'm really glad you told me. I'm an AI, so please reach out to someone you trust.";
    const r = await run(DISTRESS_TEMPLATE, x({ fixedTexts: [DISTRESS_TEMPLATE] }));
    expect(r).toEqual(ok);
  });
});
