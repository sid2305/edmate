/** Removes any connection string from an error message, so a password can't reach the logs. */
export function redact(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://<redacted>');
}
