// Shared by loader.ts and calibration.ts (task 7.1a): error messages never carry the caller's
// absolute path, only a path relative to the current working directory, or (when the file lies
// outside it) just its basename.
import { basename, isAbsolute, relative } from 'node:path';

/** The path to show in an error message for `filePath`. */
export function displayPath(filePath: string): string {
  const rel = relative(process.cwd(), filePath);
  const insideCwd = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  return insideCwd ? rel : basename(filePath);
}
