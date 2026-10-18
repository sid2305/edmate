// ESLint preset for apps/* (task 1.3): the base preset plus two import bans.
// - `@edmate/db/internal` (the raw database handle and schema) is for migrations, the seed and
//   tests only; app code uses the scoped repositories and the identity store.
// - `next-auth` and `@auth/*` are imported only inside `src/auth/`, the one door for sign-in.
import base from './base.js';

const DB_INTERNAL = {
  name: '@edmate/db/internal',
  message: 'Apps use @edmate/db (scoped repositories, identity store), never the raw handle.',
};
const DB_INTERNAL_DEEP = {
  group: ['@edmate/db/internal/*', '@edmate/db/src/*', '@edmate/db/dist/*'],
  message: 'Apps use @edmate/db (scoped repositories, identity store), never its internals.',
};
const AUTH_LIBS = {
  group: ['next-auth', 'next-auth/*', '@auth/*'],
  message: 'Import sign-in only through src/auth (withRole, publicRoute, requireRole).',
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...base,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [DB_INTERNAL], patterns: [DB_INTERNAL_DEEP, AUTH_LIBS] },
      ],
    },
  },
  {
    // The auth folder may import Auth.js; the db ban still applies there.
    files: ['**/src/auth/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: [DB_INTERNAL], patterns: [DB_INTERNAL_DEEP] }],
    },
  },
];
