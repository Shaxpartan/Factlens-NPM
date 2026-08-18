import { randomUUID } from "node:crypto";
import { FactLensConfigurationError, FactLensError, isRetryableStatus } from "./errors.js";
import type { VerificationStage } from "./errors.js";
import { buildResponseMeta } from "./runtime/response-meta.js";
import type { DetailedResponse } from "./runtime/response-meta.js";
import type { RequestOptions, VerifyProgress } from "./types/index.js";

export const SDK_VERSION = "6.7.1";
export const FACTLENS_DASHBOARD_URL = "https://api.factlens.pro/dashboard";

const RUNTIME_VERIFY_RECONNECT_WINDOW_MS = 23_000;

type AuthKind = "runtime" | "management";
type TransportConfig = {
  apiKey?: string;
  developerToken?: string;
  baseUrl: string;
  runtimeBaseUrl?: string;
  managementBaseUrl?: string;
  fetch: typeof globalThis.fetch;
};

type TransportRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
  stage?: unknown;
  help_url?: unknown;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stages = new Set<VerificationStage>(["transcription", "search", "analysis", "moderation", "verification"]);

export class HttpTransport {
  private readonly apiKey: string | undefined;
  private readonly developerToken: string | undefined;
  private readonly runtimeBaseUrl: string;
  private readonly managementBaseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(config: TransportConfig) {
    this.apiKey = cleanCredential(config.apiKey);
    this.developerToken = cleanCredential(config.developerToken);
    const shared = normalizeBaseUrl(config.baseUrl);
    this.runtimeBaseUrl = normalizeBaseUrl(config.runtimeBaseUrl ?? shared);
    this.managementBaseUrl = normalizeBaseUrl(config.managementBaseUrl ?? shared);
    this.fetch = config.fetch;
  }

  request<T>(path: string, request: TransportRequest): Promise<T> {
    return this.requestDetailed<T>(path, request).then((response) => response.data);
  }

  async requestDetailed<T>(path: string, request: TransportRequest): Promise<DetailedResponse<T>> {
    const token = request.auth === "runtime" ? this.apiKey : this.developerToken;
    if (!token) {
      const runtime = request.auth === "runtime";
      throw new FactLensConfigurationError(
        runtime
          ? `A FactLens project API key is required. Create or copy one at ${FACTLENS_DASHBOARD_URL}, then set FACTLENS_API_KEY or run factlens configure.`
          : `A FactLens developer token is required. Create one at ${FACTLENS_DASHBOARD_URL}, then set FACTLENS_DEVELOPER_TOKEN or run factlens configure.`,
        { helpUrl: FACTLENS_DASHBOARD_URL },
      );
    }

    const options = request.options ?? {};
    const readOnly = request.method === "GET";
    const maxRetries = readOnly ? boundedInteger(options.maxRetries, 1, 0, 5) : 0;
    const timeout = resolveTimeout(options, request.timeout);
    const startedAt = monotonicNow();
    const deadline = startedAt + timeout;
    const requestId = resolveRequestId(options.requestId, Boolean(request.automaticRequestId));
    const baseUrl = request.auth === "runtime" ? this.runtimeBaseUrl : this.managementBaseUrl;
    const reconnectVerify = request.auth === "runtime"
      && request.method === "POST"
      && path === "/v1/verify"
      && Boolean(requestId)
      && isFactLensProxyRuntime(baseUrl);
    const reconnectRetries = reconnectVerify ? boundedInteger(options.maxRetries, 1, 0, 5) : 0;
    let attempt = 0;
    let pollCount = 0;
    let progressState: VerifyProgress["state"] | undefined;
    let phaseStartedAt = startedAt;

    const progress = (state: VerifyProgress["state"], extras: Partial<VerifyProgress> = {}) => {
      try {
        const now = monotonicNow();
        if (progressState !== state) {
          progressState = state;
          phaseStartedAt = now;
        }
        const elapsedMs = Math.max(0, now - startedAt);
        const phase = state === "transcribing"
          ? "transcription"
          : state === "sending" || state === "retrying"
            ? "verifying"
            : state;
        options.onProgress?.({
          state,
          phase,
          elapsedMs,
          elapsedSeconds: elapsedMs / 1000,
          phaseElapsedMs: Math.max(0, now - phaseStartedAt),
          pollCount,
          ...(requestId ? { requestId } : {}),
          attempt,
          ...extras,
        });
      } catch {}
    };

    while (true) {
      const remaining = deadline - monotonicNow();
      if (remaining <= 0) throw timeoutError(requestId);

      const transportWindow = reconnectVerify
        ? Math.min(remaining, RUNTIME_VERIFY_RECONNECT_WINDOW_MS)
        : remaining;
      const reconnectOnWindowExpiry = reconnectVerify && remaining > RUNTIME_VERIFY_RECONNECT_WINDOW_MS;
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) forwardAbort();
      else options.signal?.addEventListener("abort", forwardAbort, { once: true });
      const timeoutReason = new DOMException(
        reconnectOnWindowExpiry
          ? "The FactLens transport reconnect window elapsed."
          : "The FactLens request timed out.",
        "TimeoutError",
      );
      const timer = setTimeout(() => controller.abort(timeoutReason), transportWindow);

      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "X-FactLens-SDK": "node",
        "X-FactLens-SDK-Version": SDK_VERSION,
      });
      if (request.body !== undefined) headers.set("Content-Type", "application/json");
      if (requestId) headers.set("X-Request-ID", requestId);

      let response: Response;
      progress(attempt > 0 ? "retrying" : "sending");
      try {
        response = await this.fetch(`${baseUrl}${path}`, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (options.signal?.aborted) {
          throw new FactLensError("The FactLens request was aborted.", {
            status: 0,
            code: "REQUEST_ABORTED",
            requestId,
            retryable: false,
            cause: options.signal.reason ?? cause,
          });
        }
        if (controller.signal.aborted) {
          if (reconnectOnWindowExpiry && monotonicNow() < deadline) {
            progress("waiting");
            continue;
          }
          throw timeoutError(requestId, controller.signal.reason ?? cause);
        }
        if (reconnectVerify && attempt < reconnectRetries) {
          progress("waiting");
          await delay(backoff(attempt));
          attempt += 1;
          continue;
        }
        if (readOnly && attempt < maxRetries) {
          progress("retrying");
          await delay(backoff(attempt));
          attempt += 1;
          continue;
        }
        throw new FactLensError("FactLens API could not be reached. Check your network connection and the configured API URL.", {
          status: 0,
          code: "NETWORK_ERROR",
          requestId,
          retryable: readOnly || reconnectVerify,
          cause,
        });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", forwardAbort);
      }

      const body = await responseBody(response);
      const bodyRequestId = isRecord(body) ? textValue((body as ErrorBody).request_id) : undefined;
      const effectiveRequestId = bodyRequestId
        || response.headers.get("x-factlens-request-id")
        || requestId;

      if (response.ok) {
        const meta = buildResponseMeta({
          headers: response.headers,
          clientTotalMs: Math.max(0, monotonicNow() - startedAt),
          status: response.status,
          retryCount: attempt,
        });
        if (!meta.requestId && effectiveRequestId) meta.requestId = effectiveRequestId;
        progress("complete");
        return { data: body as T, meta };
      }

      const errorBody = isRecord(body) ? body as ErrorBody : {};
      const code = textValue(errorBody.error) || `HTTP_${response.status}`;

      if (response.status === 409 && code === "REQUEST_IN_PROGRESS" && requestId) {
        const wait = retryDelay(response.headers.get("retry-after"), 0);
        pollCount += 1;
        progress(textValue(errorBody.stage) === "transcription" ? "transcribing" : "waiting", { nextPollInMs: wait });
        const left = deadline - monotonicNow();
        if (left <= 0) throw timeoutError(requestId);
        await delay(Math.min(wait, left));
        continue;
      }

      const retryable = response.status === 409 ? false : isRetryableStatus(response.status);
      if (readOnly && retryable && attempt < maxRetries) {
        progress("retrying");
        await delay(retryDelay(response.headers.get("retry-after"), attempt));
        attempt += 1;
        continue;
      }

      const helpUrl = credentialHelpUrl(code) || textValue(errorBody.help_url);
      const message = actionableMessage(code, textValue(errorBody.message), helpUrl, response.status);
      const stage = verificationStage(errorBody.stage);
      const meta = buildResponseMeta({
        headers: response.headers,
        clientTotalMs: Math.max(0, monotonicNow() - startedAt),
        status: response.status,
        retryCount: attempt,
      });
      if (!meta.requestId && effectiveRequestId) meta.requestId = effectiveRequestId;

      throw new FactLensError(message, {
        status: response.status,
        code,
        requestId: effectiveRequestId,
        retryable,
        ...(meta.retryAfterMs === undefined ? {} : { retryAfterMs: meta.retryAfterMs }),
        meta,
        headers: new Headers(response.headers),
        ...(errorBody.details === undefined ? {} : { details: errorBody.details }),
        ...(stage === undefined ? {} : { stage }),
        ...(helpUrl === undefined ? {} : { helpUrl }),
      });
    }
  }
}

function cleanCredential(value: string | undefined) {
  const result = String(value ?? "").trim();
  return result || undefined;
}

function normalizeBaseUrl(value: string) {
  const result = String(value ?? "").trim().replace(/\/+$/, "");
  if (!result) throw new FactLensConfigurationError("A FactLens API base URL is required.");
  try {
    const url = new URL(result);
    if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
  } catch (cause) {
    throw new FactLensConfigurationError("FactLens API base URLs must be valid HTTP or HTTPS URLs.", { cause });
  }
  return result;
}

function isFactLensProxyRuntime(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.factlens.pro";
  } catch {
    return false;
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function resolveTimeout(options: RequestOptions, fallback: number) {
  if (options.timeout !== undefined && options.timeoutSeconds !== undefined) {
    throw new FactLensConfigurationError("Pass either timeout (milliseconds) or timeoutSeconds, not both.");
  }
  if (options.timeoutSeconds !== undefined) {
    const seconds = Number(options.timeoutSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new FactLensConfigurationError("timeoutSeconds must be a positive number.");
    }
    return Math.min(1_800_000, Math.max(1, Math.round(seconds * 1000)));
  }
  return boundedInteger(options.timeout, fallback, 1, 1_800_000);
}

function monotonicNow() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function resolveRequestId(value: string | undefined, automatic: boolean) {
  if (value !== undefined) {
    if (!uuidPattern.test(value)) throw new FactLensConfigurationError("requestId must be a UUID.");
    return value;
  }
  return automatic ? randomUUID() : undefined;
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
  return new FactLensError("The FactLens request timed out. Retry with the same request ID to retrieve its result if it completed upstream.", {
    status: 0,
    code: "REQUEST_TIMEOUT",
    requestId,
    retryable: true,
    ...(cause === undefined ? {} : { cause }),
  });
}

function credentialHelpUrl(code: string) {
  return ["API_KEY_INVALID", "DEVELOPER_TOKEN_INVALID", "API_PROJECT_KEY_NOT_ALLOWED"].includes(code)
    ? FACTLENS_DASHBOARD_URL
    : undefined;
}

function actionableMessage(code: string, message: string | undefined, helpUrl: string | undefined, status: number) {
  const base = message || `FactLens API returned HTTP ${status}.`;
  if (!helpUrl) return base;
  if (code === "API_PROJECT_KEY_NOT_ALLOWED") {
    return `${base} This operation requires a developer token. Create or copy the correct credential at ${helpUrl}.`;
  }
  return `${base} Create or copy a valid credential at ${helpUrl}.`;
}

function verificationStage(value: unknown): VerificationStage | undefined {
  const text = textValue(value) as VerificationStage | undefined;
  return text && stages.has(text) ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}