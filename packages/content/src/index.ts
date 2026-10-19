// Teacher content: schemas, loader, content rules and `validateContentDir` (task 1.8); the
// prompt-pack loader (task 3.6).
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
export { validateContentDir, type ValidationResult } from './validate.js';
