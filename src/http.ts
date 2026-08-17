import { FactLensError } from "./errors.js";
import { buildResponseMeta } from "./runtime/response-meta.js";
import type { DetailedResponse, FactLensResponseMeta } from "./runtime/response-meta.js";
import type { RequestOptions, VerifyProgress } from "./types/index.js";

export type HttpAuth = "runtime" | "management" | "none";

export type HttpRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  auth: HttpAuth;
  body?: unknown;
  headers?: HeadersInit;
  timeout?: number;
  options?: RequestOptions;
};

export type HttpTransportOptions = {
  baseUrl: string;
  apiKey?: string;
  developerToken?: string;
  fetch: typeof globalThis.fetch;
  sdkVersion: string;
  sdkName: string;
  userAgent?: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly developerToken: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sdkVersion: string;
  private readonly sdkName: string;
  private readonly userAgent: string | undefined;

  constructor(options: HttpTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = cleanCredential(options.apiKey);
    this.developerToken = cleanCredential(options.developerToken);
    this.fetchImpl = options.fetch;
    this.sdkVersion = options.sdkVersion;
    this.sdkName = options.sdkName;
    this.userAgent = options.userAgent;
  }

  request<T>(path: string, request: HttpRequest): Promise<T> {
    return this.requestDetailed<T>(path, request).then((response) => response.data);
  }

  async requestDetailed<T>(path: string, request: HttpRequest): Promise<DetailedResponse<T>> {
    const options = request.options ?? {};
    const timeoutMs = options.timeout ?? request.timeout ?? DEFAULT_TIMEOUT_MS;
    const runtimeVerify = request.auth === "runtime" && request.method === "POST" && path === "/v1/verify";
    const readOnly = request.method === "GET";
    const maxRetries = runtimeVerify || !readOnly ? 0 : Math.max(0, Math.floor(options.maxRetries ?? 1));
    const requestId = runtimeVerify ? cleanRequestId(options.requestId) ?? crypto.randomUUID() : cleanRequestId(options.requestId);
    const startedAt = monotonicNow();
    let attempt = 0;
    let pollCount = 0;
    let progressState: string | undefined;
    let phaseStartedAt = startedAt;
    const progress = (state: "sending" | "waiting" | "transcribing" | "retrying" | "complete", extras: Record<string, unknown> = {}) => {
      try {
        const now = monotonicNow();
        if (progressState !== state) { progressState = state; phaseStartedAt = now; }
        const elapsedMs = Math.max(0, now - startedAt);
        const phase = state === "transcribing" ? "transcription" : state === "sending" || state === "retrying" ? "verifying" : state;
        options.onProgress?.({ state, phase, elapsedMs, elapsedSeconds: elapsedMs / 1000, phaseElapsedMs: Math.max(0, now - phaseStartedAt), pollCount, ...(requestId ? { requestId } : {}), attempt, ...extras } as VerifyProgress);
      } catch {}
    };

    while (true) {
      const headers = new Headers(request.headers);
      headers.set("accept", "application/json");
      headers.set("x-factlens-sdk", this.sdkName);
      headers.set("x-factlens-sdk-version", this.sdkVersion);
      if (this.userAgent) headers.set("user-agent", this.userAgent);
      if (request.body !== undefined) headers.set("content-type", "application/json");
      if (requestId) headers.set("x-request-id", requestId);
      if (request.auth === "runtime") {
        if (!this.apiKey) throw configurationError("apiKey");
        headers.set("authorization", `Bearer ${this.apiKey}`);
      } else if (request.auth === "management") {
        if (!this.developerToken) throw configurationError("developerToken");
        headers.set("authorization", `Bearer ${this.developerToken}`);
      }

      progress(attempt > 0 ? "retrying" : "sending");
      const composed = composeAbort(options.signal, timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: composed.signal,
        });
      } catch (error) {
        composed.cleanup();
        if (options.signal?.aborted) {
          throw new FactLensError("The request was cancelled.", {
            status: 0,
            code: "REQUEST_ABORTED",
            retryable: false,
            cause: error,
          });
        }
        if (composed.timedOut()) {
          throw new FactLensError(`The request timed out after ${timeoutMs} ms.`, {
            status: 0,
            code: "REQUEST_TIMEOUT",
            retryable: true,
            cause: error,
          });
        }
        if (readOnly && attempt < maxRetries) {
          progress("retrying");
          await delay(retryDelay(null, attempt));
          attempt += 1;
          continue;
        }
        throw new FactLensError("The request could not reach FactLens.", {
          status: 0,
          code: "NETWORK_ERROR",
          retryable: readOnly,
          cause: error,
        });
      } finally {
        composed.cleanup();
      }

      const responseBody = await responseJson(response);
      const effectiveRequestId = cleanRequestId(response.headers.get("x-factlens-request-id")) ?? cleanRequestId(recordValue(responseBody, "request_id")) ?? requestId;
      if (response.ok) {
        const data = responseBody as T;
        const meta = buildResponseMeta({
          headers: response.headers,
          clientTotalMs: Math.max(0, monotonicNow() - startedAt),
          status: response.status,
          retryCount: attempt,
        });
        progress("complete");
        return { data, meta };
      }

      const errorBody = recordValue(responseBody);
      const code = textValue(errorBody.error) || textValue(errorBody.code) || `HTTP_${response.status}`;
      if (response.status === 409 && code === "REQUEST_IN_PROGRESS" && requestId) {
        const wait = retryDelay(response.headers.get("retry-after"), 0);
        pollCount += 1;
        progress(textValue(errorBody.stage) === "transcription" ? "transcribing" : "waiting", { nextPollInMs: wait });
        await delay(wait);
        attempt += 1;
        continue;
      }

      const retryableStatus = isRetryableStatus(response.status);
      if (readOnly && retryableStatus && attempt < maxRetries) {
        progress("retrying");
        await delay(retryDelay(response.headers.get("retry-after"), attempt));
        attempt += 1;
        continue;
      }

      const helpUrl = credentialHelpUrl(code) || textValue(errorBody.help_url);
      const message = actionableMessage(code, textValue(errorBody.message), helpUrl, response.status);
      const stage = verificationStage(errorBody.stage);
      const responseMeta = buildResponseMeta({
        headers: response.headers,
        clientTotalMs: Math.max(0, monotonicNow() - startedAt),
        status: response.status,
        retryCount: attempt,
      });

      throw new FactLensError(message, {
        status: response.status,
        code,
        requestId: effectiveRequestId,
        retryable: retryableStatus && (readOnly || runtimeVerify),
        ...(responseMeta.retryAfterMs === undefined ? {} : { retryAfterMs: responseMeta.retryAfterMs }),
        meta: responseMeta,
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

function cleanRequestId(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function configurationError(field: "apiKey" | "developerToken") {
  return new FactLensError(
    field === "apiKey"
      ? "A FactLens API key is required for this operation."
      : "A FactLens developer token is required for this operation.",
    {
      status: 0,
      code: "CONFIGURATION_ERROR",
      retryable: false,
      helpUrl: "https://api.factlens.pro/dashboard",
    },
  );
}

async function responseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { message: text }; }
}

function recordValue(value: unknown, key?: string): any {
  if (!value || typeof value !== "object") return key ? undefined : {};
  return key ? (value as Record<string, unknown>)[key] : value as Record<string, unknown>;
}

function textValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function verificationStage(value: unknown) {
  const stage = textValue(value);
  return stage === "transcription" || stage === "search" || stage === "analysis" || stage === "moderation" || stage === "verification"
    ? stage
    : undefined;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(value: string | null, attempt: number) {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.round(seconds * 1000));
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.min(60_000, Math.max(0, date - Date.now()));
  }
  return Math.min(5_000, 250 * (2 ** Math.max(0, attempt)));
}

function credentialHelpUrl(code: string) {
  return code === "API_KEY_INVALID" || code === "API_KEY_REQUIRED" || code === "DEVELOPER_TOKEN_INVALID" || code === "DEVELOPER_TOKEN_REQUIRED"
    ? "https://api.factlens.pro/dashboard"
    : undefined;
}

function actionableMessage(code: string, message: string | undefined, helpUrl: string | undefined, status: number) {
  const base = message || `FactLens returned HTTP ${status}.`;
  return helpUrl ? `${base} See ${helpUrl}.` : base;
}

function monotonicNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function delay(ms: number) {
  return ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function composeAbort(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timeoutHit = false;
  const abortFromUser = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", abortFromUser, { once: true });
  const timeout = setTimeout(() => {
    timeoutHit = true;
    controller.abort(new Error("FactLens request timeout"));
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    timedOut: () => timeoutHit,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromUser);
    },
  };
}
