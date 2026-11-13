export type ErrorKind =
  | 'invalid_input'
  | 'not_found'
  | 'payload_too_large'
  | 'internal'
  | 'unauthenticated'
  | 'unsupported_media_type'
  | 'upstream_unavailable';

export interface AppErrorOptions {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

export const RETRYABLE_BY_KIND = {
  invalid_input: false,
  not_found: false,
  payload_too_large: false,
  internal: false,
  unauthenticated: false,
  unsupported_media_type: false,
  upstream_unavailable: true,
} as const satisfies Record<ErrorKind, boolean>;

export class AppError extends Error {
  readonly code: string;
  readonly kind: ErrorKind;

  constructor({ kind, code, message, cause }: AppErrorOptions) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
    this.kind = kind;
    this.name = 'AppError';
  }

  get retryable(): boolean {
    return RETRYABLE_BY_KIND[this.kind];
  }
}
