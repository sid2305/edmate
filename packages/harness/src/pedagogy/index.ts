// Pedagogy: the teaching policy for `decide` (help ladder, skill rules, coverage, budgets), the
// prompt packs and the system-prompt composer.
export {
  MAX_OUTPUT_TOKENS,
  type Move,
  maxOutputTokensFor,
  SKILL_OUTPUT_TOKENS,
} from './budgets.js';
export {
  type ComposeInput,
  type ComposeMode,
  composeMode,
  type Composed,
  composeSystemPrompt,
  DATA_CLOSE,
  DATA_OPEN,
  LockedMaterialError,
  PILOT_LANGUAGES,
  PromptPackMismatchError,
  replyLanguage,
} from './compose.js';
export { disclaimerGap, type RegulatedSubject, resolveDisclaimer } from './disclaimer.js';
export { coverageGate, DEFAULT_COVERAGE_THRESHOLD, isCovered } from './coverage.js';
export {
  type HelpState,
  HelpStateSchema,
  INITIAL_HELP_STATE,
  parseSessionHelp,
  type SessionHelp,
  SessionHelpSchema,
  serializeSessionHelp,
  type StoredSessionHelp,
} from './helpState.js';
export {
  attemptLoggedAfter,
  effectiveCeiling,
  type LadderInput,
  type LadderPkg,
  type LadderReason,
  type LadderSkill,
  type LadderStep,
  nextRung,
  type Rung,
  RUNG_MOVE,
  SKILL_CAP,
} from './ladder.js';
export {
  decidePolicy,
  fallbackPolicy,
  type PolicyInput,
  type PolicyOptions,
  type PolicyReason,
  type PolicyResult,
  type PolicyTool,
} from './policy.js';
export { selectSkill, type SkillReason, type SkillStep } from './skills.js';
export { buildModelRequest, type ModelRequestInput, promptCacheKey } from './modelRequest.js';
export {
  createPromptPackLibrary,
  FRAME_SECTIONS,
  type FrameSection,
  MODE_PACKS,
  type ModePackName,
  PACK_KINDS,
  type PackKind,
  type PackName,
  packKindOf,
  parsePromptPackSet,
  placeholdersOf,
  OPTIONAL_FRAME_SECTIONS,
  type OptionalFrameSection,
  type RequiredFrameSection,
  type PromptPack,
  PromptPackError,
  type PromptPackIssue,
  type PromptPackLibrary,
  type PromptPackRef,
  type PromptPackSet,
  type RawPromptPackSet,
  renderTemplate,
  REQUIRED_PACKS,
  resolvePromptPackSet,
  SKILL_PACKS,
  type SkillPackName,
  type Slots,
  UnknownPromptPackVersionError,
} from './promptPacks.js';
