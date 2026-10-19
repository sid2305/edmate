// The app preset (task 3.8: the worker now imports @edmate/db, so the ban on its internals
// applies). Integration tests seed their throwaway database through @edmate/db/internal.
import app from '@edmate/config/eslint/app';

export default [
  ...app,
  {
    files: ['test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
