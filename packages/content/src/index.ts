// Teacher content: schemas, loader, content rules and `validateContentDir` (task 1.8); the
// prompt-pack loader (task 3.6); locale packs (task 3.10).
export * from './schema.js';
export {
  ContentLoadError,
  LICENCES_FILE,
  loadDemoTeacherContent,
  readContentTree,
  type ContentTree,
  type DemoTeacherContent,
  type FileItems,
} from './loader.js';
export {
  type PersonaTemplate,
  PersonaTemplateSchema,
  readPersonaTemplateDir,
  validatePersonaTemplateDir,
} from './personaTemplates.js';
export { checkPilotLanguages, PILOT_LANGUAGES } from './pilotLanguages.js';
export { readPromptPackDir, readPromptPackLibrary, validatePromptPackDir } from './promptPacks.js';
export * from './rules.js';
// Locale packs (task 3.10): loader, rules, safe-regex check and the runtime pick.
export { isLocalePacksDir, readLocalePack, readLocalePacksDir } from './localeLoader.js';
export {
  checkLocalePacks,
  complianceReviewed,
  defaultPackPresent,
  helplinesVerified,
  LOCALE_RULES,
  localeLanguages,
  type LocalePacks,
  type LocaleRule,
  piiPatternIssues,
  piiPatternsCompileWithGu,
  piiPatternsSafeRegex,
  unverifiedHelplines,
} from './localeRules.js';
export {
  DEFAULT_LOCALE_MARKET,
  type DroppedHelpline,
  type HelplineDropReason,
  type LoadedLocalePacks,
  loadLocalePacks,
  LocalePackError,
  pickLocalePack,
  withVerifiedHelplines,
} from './localePacks.js';
export {
  checkSafeRegex,
  probeTiming,
  SAFE_REGEX_ISSUES,
  structuralIssues,
  type TimingOptions,
} from './safeRegex.js';
// Age and consent (task 1.7): the per-market age rule and the privacy notices.
export {
  agePolicyFor,
  agePolicyResolver,
  complianceSigned,
  DEFAULT_AGE_POLICY,
  type PackAgePolicy,
  PLATFORM_MIN_AGE,
} from './agePolicy.js';
export {
  checkPrivacyNotices,
  isPrivacyNoticesDir,
  noticeCoverageIssues,
  noticeSigned,
  parsePrivacyNotice,
  pickPrivacyNotice,
  PLACEHOLDER_MARKER,
  type PrivacyNotice,
  PrivacyNoticeError,
  type PrivacyNoticeFrontMatter,
  PrivacyNoticeFrontMatterSchema,
  type PrivacyNotices,
  readPrivacyNoticesDir,
} from './privacyNotices.js';
export { validateContentDir, type ValidationResult } from './validate.js';
