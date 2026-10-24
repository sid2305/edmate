// What sign-in code may log about an error (tasks 1.3, 1.4): its name and Auth.js `type`, never
// its message or cause. Auth.js, nodemailer and driver errors can all hold email addresses.

/**
 * The error's name and Auth.js `type`, never its message or cause (they can hold emails). Auth.js
 * sets `.type` to its own stable error class name (e.g. `Verification`); `.name` can be a
 * minified class name once the app is built, so `.type` is preferred whenever it is a string.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'non-error';
  const type = (error as { type?: unknown }).type;
  return typeof type === 'string' ? type : error.name;
}
