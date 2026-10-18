// Teacher content: schemas, loader, content rules and `validateContentDir` (task 1.8).
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
export * from './rules.js';
export { validateContentDir, type ValidationResult } from './validate.js';
