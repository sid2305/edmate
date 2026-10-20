// Every ingestion failure is an IngestError: a fixed code, a retry hint and a message written here.
// Nothing from the failing input or request is kept (no URL, body or cause): a web link can carry a
// token in its query string, and document text is teacher material that must not reach a log line.

export type IngestErrorCode =
  | 'validation'
  | 'unsupported'
  | 'forbidden'
  | 'not_found'
  | 'input_too_large'
  | 'rate_limited'
  | 'provider_error';

export class IngestError extends Error {
  override readonly name = 'IngestError';

  constructor(
    readonly code: IngestErrorCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(`ingest: ${message}`);
  }

  toJSON(): { name: string; code: IngestErrorCode; retryable: boolean; message: string } {
    return { name: this.name, code: this.code, retryable: this.retryable, message: this.message };
  }
}
