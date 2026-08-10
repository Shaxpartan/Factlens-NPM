import { FactLensConfigurationError, FactLensError, isRetryableStatus } from "./errors.js";
import type { RequestOptions } from "./types/index.js";

export const SDK_VERSION = "1.0.0";

type AuthKind = "runtime" | "management";

type TransportConfig = {
  apiKey?: string;
  developerToken?: string;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
};

type TransportRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  auth: AuthKind;
  body?: unknown;
  options?: RequestOptions;
  timeout: number;
  automaticRequestId?: boolean;
};

type ErrorBody = {
  error?: unknown;
  message?: unknown;
  request_id?: unknown;
  details?: unknown;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HttpTransport {
  private readonly apiKey: string | undefined;
  private readonly developerToken: string | undefined;
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(config: TransportConfig) {
    this.apiKey = cleanCredential(config.apiKey);
    this.developerToken = cleanCredential(config.developerToken);
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetch = config.fetch;
  }

  async request<T>(path: string, request: TransportRequest): Promise<T> {
    const token = request.auth === "runtime" ? this.apiKey : this.developerToken;
    if (!token) {
      throw new FactLensConfigurationError(
        request.auth === "runtime"
          ? "A FactLens project API key is required for this method."
          : "A FactLens developer token is required for this method.",
      );
    }

    const options = request.options ?? {};
    const maxRetries = boundedInteger(options.maxRetries, 2, 0, 5);
    const timeout = boundedInteger(options.timeout, request.timeout, 1, 600_000);
    const deadline = Date.now() + timeout;
    const requestId = resolveRequestId(options.requestId, Boolean(request.automaticRequestId));
    let attempt = 0;

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timeoutError(requestId);

      const controller = new AbortController();
      const forwardAbort = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) forwardAbort();
      else options.signal?.addEventListener("abort", forwardAbort, { once: true });
      const timeoutReason = new DOMException("The FactLens request timed out.", "TimeoutError");
      const timer = setTimeout(() => controller.abort(timeoutReason), remaining);

      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "X-FactLens-SDK": "node",
        "X-FactLens-SDK-Version": SDK_VERSION,
      });
      if (request.body !== undefined) headers.set("Content-Type", "application/json");
      if (requestId) headers.set("X-Request-ID", requestId);

      let response: Response;
      try {
        response = await this.fetch(`${this.baseUrl}${path}`, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: controller.signal,
        });
      } catch (cause) {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", forwardAbort);
        if (options.signal?.aborted) {
          throw new FactLensError("The FactLens request was aborted.", {
            status: 0,
            code: "REQUEST_ABORTED",
            requestId,
            retryable: false,
            cause: options.signal.reason ?? cause,
          });
        }
        if (controller.signal.aborted) throw timeoutError(requestId, controller.signal.reason ?? cause);
        if (attempt < maxRetries) {
          await delay(backoff(attempt));
          attempt += 1;
          continue;
        }
        throw new FactLensError("FactLens API could not be reached.", {
          status: 0,
          code: "NETWORK_ERROR",
          requestId,
          retryable: true,
          cause,
        });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", forwardAbort);
      }

      const body = await responseBody(response);
      if (response.ok) return body as T;

      const errorBody = isRecord(body) ? body as ErrorBody : {};
      const code = textValue(errorBody.error) || `HTTP_${response.status}`;
      const effectiveRequestId = textValue(errorBody.request_id)
        || response.headers.get("x-factlens-request-id")
        || requestId;
      const retryable = response.status === 409
        ? code === "REQUEST_IN_PROGRESS"
        : isRetryableStatus(response.status);

      if (retryable && attempt < maxRetries) {
        await delay(retryDelay(response.headers.get("retry-after"), attempt));
        attempt += 1;
        continue;
      }

      throw new FactLensError(
        textValue(errorBody.message) || `FactLens API returned HTTP ${response.status}.`,
        {
          status: response.status,
          code,
          requestId: effectiveRequestId,
          retryable,
          headers: new Headers(response.headers),
          ...(errorBody.details === undefined ? {} : { details: errorBody.details }),
        },
      );
    }
  }
}

function cleanCredential(value: string | undefined) {
  const result = String(value ?? "").trim();
  return result || undefined;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function resolveRequestId(value: string | undefined, automatic: boolean) {
  if (value !== undefined) {
    if (!uuidPattern.test(value)) {
      throw new FactLensConfigurationError("requestId must be a UUID.");
    }
    return value;
  }
  return automatic ? crypto.randomUUID() : undefined;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function retryDelay(header: string | null, attempt: number) {
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(60_000, Math.max(0, date - Date.now()));
  }
  return backoff(attempt);
}

function backoff(attempt: number) {
  return Math.min(5_000, 250 * (2 ** attempt)) + Math.floor(Math.random() * 101);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function timeoutError(requestId?: string, cause?: unknown) {
  return new FactLensError("The FactLens request timed out.", {
    status: 0,
    code: "REQUEST_TIMEOUT",
    requestId,
    retryable: true,
    ...(cause === undefined ? {} : { cause }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
