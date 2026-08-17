export type ServerTimingPhases = {
  authMs?: number;
  customizationMs?: number;
  coreMs?: number;
  postprocessMs?: number;
  edgeMs?: number;
};

export type ResponseMeta = {
  status: number;
  requestId?: string;
  clientTotalMs: number;
  gatewayNetworkMs?: number;
  serverTiming: ServerTimingPhases;
  headers: Record<string, string>;
};

const PHASES: Record<string, keyof ServerTimingPhases> = {
  auth: "authMs",
  customization: "customizationMs",
  core: "coreMs",
  postprocess: "postprocessMs",
  edge: "edgeMs",
};

export function parseServerTiming(value: string | null | undefined): ServerTimingPhases {
  const output: ServerTimingPhases = {};
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

export function buildResponseMeta({
  headers,
  clientTotalMs,
  status,
}: {
  headers: Headers;
  clientTotalMs: number;
  status: number;
}): ResponseMeta {
  const serverTiming = parseServerTiming(headers.get("server-timing"));
  const edgeHeader = Number(headers.get("x-factlens-edge-time-ms"));
  if (serverTiming.edgeMs === undefined && Number.isFinite(edgeHeader) && edgeHeader >= 0) serverTiming.edgeMs = edgeHeader;
  const total = Math.max(0, Number(clientTotalMs) || 0);
  const edge = serverTiming.edgeMs;
  const selectedHeaders: Record<string, string> = {};
  for (const name of ["server-timing", "x-factlens-edge-time-ms", "x-factlens-request-id", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining"]) {
    const value = headers.get(name);
    if (value !== null) selectedHeaders[name] = value;
  }
  return {
    status,
    requestId: headers.get("x-factlens-request-id") || undefined,
    clientTotalMs: total,
    ...(edge === undefined ? {} : { gatewayNetworkMs: Math.max(0, total - edge) }),
    serverTiming,
    headers: selectedHeaders,
  };
}
