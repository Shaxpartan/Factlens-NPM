import { FactLensError } from "../errors.js";

export type Writer = (value: string) => void;

export function writeJson(write: Writer, value: unknown) {
  write(`${JSON.stringify(value, null, 2)}\n`);
}

export function serializeError(error: unknown) {
  if (error instanceof FactLensError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...(error.requestId ? { requestId: error.requestId } : {}),
      retryable: error.retryable,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      ...(error.meta === undefined ? {} : { meta: error.meta }),
      ...(error.stage ? { stage: error.stage } : {}),
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.helpUrl ? { helpUrl: error.helpUrl } : {}),
    };
  }
  return {
    code: "CLI_ERROR",
    message: error instanceof Error ? error.message : String(error),
    status: 0,
    retryable: false,
  };
}

export function humanError(error: unknown) {
  const value = serializeError(error);
  const lines = [`Error: ${value.message}`];
  const meta = [value.code && `Code: ${value.code}`, value.status ? `HTTP: ${value.status}` : "", value.stage ? `Stage: ${value.stage}` : "", value.requestId ? `Request ID: ${value.requestId}` : ""].filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "));
  if (value.retryAfterMs !== undefined) lines.push(`Retry after: ${value.retryAfterMs} ms`);
  if (value.helpUrl) lines.push(`Help: ${value.helpUrl}`);
  return `${lines.join("\n")}\n`;
}

export function exitCodeFor(error: unknown) {
  if (!(error instanceof FactLensError)) return 1;
  if (error.code === "CONFIGURATION_ERROR") return 2;
  if (error.status === 401 || error.status === 403) return 3;
  if (error.status === 402 || error.status === 429) return 4;
  if (error.status >= 500 || ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error.code)) return 5;
  if (error.status >= 400) return 2;
  return 1;
}
