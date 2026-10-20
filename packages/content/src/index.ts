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
  piiPatternsCompileWithGu,
  piiPatternsSafeRegex,
  unverifiedHelplines,
} from './localeRules.js';
export {
  DEFAULT_LOCALE_MARKET,
  type LoadedLocalePacks,
  loadLocalePacks,
  LocalePackError,
  pickLocalePack,
} from './localePacks.js';
export {
  checkSafeRegex,
  probeTiming,
  SAFE_REGEX_ISSUES,
  structuralIssues,
  type TimingOptions,
} from './safeRegex.js';
export { validateContentDir, type ValidationResult } from './validate.js';
