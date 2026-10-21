// Harness preset = base preset + the rule-3 purity rule (allow-list of imports).
import harness from '@edmate/config/eslint/harness';

export default [
  ...harness,
  {
    // Task 5.5: no code-from-text anywhere in the harness (the calculator's sandbox relies on it).
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
];
