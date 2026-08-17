export type FactLensServerTiming = {
  authMs?: number;
  customizationMs?: number;
  coreMs?: number;
  postprocessMs?: number;
  edgeMs?: number;
};

export type ServerTimingPhases = FactLensServerTiming;

export type FactLensResponseMeta = {
  status: number;
  httpStatus: number;
  requestId?: string;
  clientTotalMs: number;
  clientTotalSeconds: number;
  gatewayNetworkMs?: number;
  retryAfterMs?: number;
  retryCount: number;
  serverTiming: FactLensServerTiming;
  headers: Record<string, string>;
};

export type ResponseMeta = FactLensResponseMeta;
export type DetailedResponse<T> = { data: T; meta: FactLensResponseMeta };

const PHASES: Record<string, keyof FactLensServerTiming> = {
  auth: "authMs",
  customization: "customizationMs",
  core: "coreMs",
  postprocess: "postprocessMs",
  edge: "edgeMs",
};

export function parseServerTiming(value: string | null | undefined): FactLensServerTiming {
  const output: FactLensServerTiming = {};
  for (const metric of String(value || "").split(",")) {
    const [rawName, ...params] = metric.trim().split(";");
    const key = PHASES[String(rawName || "").trim().toLowerCase()];
    if (!key) continue;
    const duration = params.map((part) => part.trim()).find((part) => /^dur=/i.test(part));
    if (!duration) continue;
    const number = Number(duration.slice(duration.indexOf("=") + 1));
    if (Number.isFinite(number) && number >= 0) output[key] = number;
  }
  return output;
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.round(seconds * 1000));
  const date = Date.parse(text);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(60_000, Math.max(0, date - now));
}

export function buildResponseMeta({
  headers,
  clientTotalMs,
  status,
  retryCount = 0,
}: {
  headers: Headers;
  clientTotalMs: number;
  status: number;
  retryCount?: number;
}): FactLensResponseMeta {
  const serverTiming = parseServerTiming(headers.get("server-timing"));
  const edgeHeader = Number(headers.get("x-factlens-edge-time-ms"));
  if (serverTiming.edgeMs === undefined && Number.isFinite(edgeHeader) && edgeHeader >= 0) serverTiming.edgeMs = edgeHeader;
  const total = Math.max(0, Number(clientTotalMs) || 0);
  const edge = serverTiming.edgeMs;
  const requestId = headers.get("x-factlens-request-id") || undefined;
  const retryAfterMs = parseRetryAfter(headers.get("retry-after"));
  const selectedHeaders: Record<string, string> = {};
  for (const name of ["server-timing", "x-factlens-edge-time-ms", "x-factlens-request-id", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining"]) {
    const value = headers.get(name);
    if (value !== null) selectedHeaders[name] = value;
  }
  return {
    status,
    httpStatus: status,
    ...(requestId === undefined ? {} : { requestId }),
    clientTotalMs: total,
    clientTotalSeconds: total / 1000,
    ...(edge === undefined ? {} : { gatewayNetworkMs: Math.max(0, total - edge) }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    retryCount: Math.max(0, Math.floor(Number(retryCount) || 0)),
    serverTiming,
    headers: selectedHeaders,
  };
}
