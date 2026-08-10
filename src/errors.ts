export type FactLensErrorOptions = {
  status: number;
  code: string;
  requestId?: string | undefined;
  retryable?: boolean;
  headers?: Headers;
  details?: unknown;
  cause?: unknown;
};

export class FactLensError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly retryable: boolean;
  readonly headers: Headers;
  readonly details?: unknown;

  constructor(message: string, options: FactLensErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FactLensError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? isRetryableStatus(options.status);
    this.headers = options.headers ?? new Headers();
    this.details = options.details;
  }
}

export class FactLensConfigurationError extends FactLensError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, {
      status: 0,
      code: "CONFIGURATION_ERROR",
      retryable: false,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "FactLensConfigurationError";
  }
}

export function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}
