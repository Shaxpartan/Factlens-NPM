export type VerificationStage = "transcription" | "search" | "analysis" | "moderation" | "verification";

export type FactLensErrorOptions = {
  status: number;
  code: string;
  requestId?: string | undefined;
  retryable?: boolean;
  headers?: Headers;
  details?: unknown;
  stage?: VerificationStage;
  helpUrl?: string;
  cause?: unknown;
};

export class FactLensError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly retryable: boolean;
  readonly headers: Headers;
  readonly details?: unknown;
  readonly stage?: VerificationStage;
  readonly helpUrl?: string;

  constructor(message: string, options: FactLensErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FactLensError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? isRetryableStatus(options.status);
    this.headers = options.headers ?? new Headers();
    this.details = options.details;
    this.stage = options.stage;
    this.helpUrl = options.helpUrl;
  }
}

export class FactLensConfigurationError extends FactLensError {
  constructor(message: string, options: { cause?: unknown; helpUrl?: string } = {}) {
    super(message, {
      status: 0,
      code: "CONFIGURATION_ERROR",
      retryable: false,
      ...(options.helpUrl === undefined ? {} : { helpUrl: options.helpUrl }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "FactLensConfigurationError";
  }
}

export function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}
