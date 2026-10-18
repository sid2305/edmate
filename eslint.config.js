// Fallback ESLint config for workspaces without their own eslint.config.js (ESLint uses the
// nearest config file). It is the harness preset: the purity rule only fires for files under
// packages/harness/, so it is harmless elsewhere and still holds if harness is linted from here.
import harness from './packages/config/eslint/harness.js';

export default [...harness];
