// The app preset (task 3.9f: the CLI now imports @edmate/db, so the ban on its internals
// applies). The new integration test seeds its throwaway database through @edmate/db/internal.
import app from '@edmate/config/eslint/app';

export default [
  ...app,
  {
    files: ['test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
