// ESLint preset for packages/harness: the base preset plus build plan rule 3 (harness purity).
// The rule itself only fires for files under packages/harness/, so linting another path with
// this preset is harmless.
import base from './base.js';
import harnessPurity from './rules/harness-purity.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...base,
  {
    plugins: {
      'harness-purity': { rules: { 'no-external-import': harnessPurity } },
    },
    rules: {
      'harness-purity/no-external-import': 'error',
    },
  },
];
