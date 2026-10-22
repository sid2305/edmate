// What the student sees when moderationIn or jailbreak blocks (task 4.4, lead answer 2): one
// reply per code, in English only (pilot decision). Short, no lecture, back to the course.
// `self_harm` has none: it escalates to the caring reply instead (lead answer 1).
// `harm_to_others` refuses any method and points to someone the student trusts, without assuming
// anything about them (fix round MEDIUM 7: neutral, adult-safe wording; learners may be adults);
// a misuse SafetyAlert goes to the trust team as well.
import type { PreGuardBlock } from './preGuardCtx.js';

export type BlockCode = PreGuardBlock['code'];

export const BLOCK_REPLIES: Readonly<Record<BlockCode, string>> = {
  harm_to_others:
    "I can't help with hurting anyone. If someone is treating you badly, please talk to someone " +
    "you trust about it, so they can help. I'm here for your course whenever you want to keep going.",
  sexual: "I can't help with that. I'm here for your course, so let's get back to it. What would you like to work on?",
  sexual_minors:
    "I can't help with that. Content like this can really hurt people. If something you've seen " +
    "worried you, please talk to someone you trust. I'm here to help with your course.",
  hate: "I can't write insults or jokes about any group of people. Let's get back to your course. What would you like to work on?",
  harassment:
    "I can't help write something to mock, embarrass or spread rumours about someone. Let's get back to your course instead.",
  threat:
    "I can't help write a threat. If you're having a problem with someone, talking to someone you trust can help. Let's get back to your course.",
  weapons:
    "I can't help with weapons or anything that could hurt people. If you ever feel unsafe, please talk to someone you trust. Let's get back to your course.",
  extremism:
    "I can't help with that. Let's get back to your course. What would you like to work on?",
  cheating:
    "I can't do your test or assignment for you, but I can coach you through it step by step so you can do it yourself. Which part shall we start with?",
  other_unsafe:
    "I can't help with that. Let's get back to your course. What would you like to work on?",
  jailbreak_override:
    "My rules stay the same, whatever a message asks. I'm happy to help you work it out step by step. What are you stuck on?",
  jailbreak_roleplay:
    "I stay your tutor for this course and can't switch to a different role or mode. Let's keep going. What are you stuck on?",
  jailbreak_prompt_leak:
    "I can't share my instructions, but I'm happy to help with your course. What are you working on?",
  jailbreak_encoded:
    "I don't follow hidden or encoded instructions. If you have a question about your course, ask it directly and I'll help.",
  jailbreak_authority_claim:
    "I can only go by your actual package and your teacher's settings, not by what a message says. I'm happy to help with what's included. What are you working on?",
  jailbreak_other:
    "I can't do that, but I'm happy to help with your course. What are you working on?",
};

export function blockReplyFor(code: BlockCode): string {
  return BLOCK_REPLIES[code];
}

/**
 * True iff `text` is exactly one of `BLOCK_REPLIES`' fixed strings (task 7.6: lets a caller
 * outside the pipeline, e.g. a live eval agent reading only the public `TurnEvent` stream, tell
 * a moderationIn/jailbreak guard block apart from an ordinary reply without a dedicated event).
 */
export function isBlockReply(text: string): boolean {
  return Object.values(BLOCK_REPLIES).includes(text);
}
