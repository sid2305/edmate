// What the student sees when moderationIn or jailbreak blocks (task 4.4, lead answer 2): one
// reply per code, in English only (pilot decision). Short, no lecture, back to the course.
// `self_harm` has none: it escalates to the caring reply instead (lead answer 1).
// `harm_to_others` (the bullying cases) acknowledges the bullying, suggests a trusted adult and
// refuses any method; a misuse SafetyAlert goes to the trust team as well.
import type { PreGuardBlock } from './preGuardCtx.js';

export type BlockCode = PreGuardBlock['code'];

export const BLOCK_REPLIES: Readonly<Record<BlockCode, string>> = {
  harm_to_others:
    "I can't help with hurting anyone. Being bullied is really hard, and it isn't your fault. " +
    'Please tell a trusted adult, like a parent, a teacher or a school counsellor, so they can ' +
    "help make it stop. I'm here for your course whenever you want to keep going.",
  sexual: "I can't help with that. I'm here for your course, so let's get back to it. What would you like to work on?",
  sexual_minors:
    "I can't help with that. Content like this can really hurt people. If someone is pressuring " +
    "you, or you've seen something that worried you, please tell a trusted adult. I'm here to help with your course.",
  hate: "I can't write insults or jokes about any group of people. Let's get back to your course. What would you like to work on?",
  harassment:
    "I can't help write something to mock, embarrass or spread rumours about someone. Let's get back to your course instead.",
  threat:
    "I can't help write a threat. If you're having a problem with someone, talking to a trusted adult can help. Let's get back to your course.",
  weapons:
    "I can't help with weapons or anything that could hurt people. If you ever feel unsafe at school, please talk to a trusted adult. Let's get back to your course.",
  extremism: "I can't help with that. Let's get back to your course. What would you like to work on?",
  cheating:
    "I can't do your test or assignment for you, but I can coach you through it step by step so you can do it yourself. Which part shall we start with?",
  other_unsafe: "I can't help with that. Let's get back to your course. What would you like to work on?",
  jailbreak_override:
    "My rules stay the same, whatever a message asks. I'm happy to help you work it out step by step. What are you stuck on?",
  jailbreak_roleplay:
    "I stay your tutor for this course and can't switch to a different role or mode. Let's keep going. What are you stuck on?",
  jailbreak_prompt_leak: "I can't share my instructions, but I'm happy to help with your course. What are you working on?",
  jailbreak_encoded:
    "I don't follow hidden or encoded instructions. If you have a question about your course, ask it directly and I'll help.",
  jailbreak_authority_claim:
    "I can only go by your actual package and your teacher's settings, not by what a message says. I'm happy to help with what's included. What are you working on?",
  jailbreak_other: "I can't do that, but I'm happy to help with your course. What are you working on?",
};

export function blockReplyFor(code: BlockCode): string {
  return BLOCK_REPLIES[code];
}
