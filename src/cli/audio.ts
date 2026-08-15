import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { FactLensConfigurationError, FactLensError } from "../errors.js";
import { SDK_VERSION } from "../http.js";

const DEFAULT_DIRECT_AUDIO_VERIFY_URL = "https://xqrtidxikzgwwhtynuul.supabase.co/functions/v1/factlens-api?endpoint=verify";
const MAX_STREAMED_AUDIO_BYTES = 512 * 1024 * 1024;

export type AudioUploadOptions = {
  path: string;
  contentType: string;
  apiKey: string;
  requestId: string;
  language?: string | undefined;
  runtimeBaseUrl?: string | undefined;
  audioUploadUrl?: string | undefined;
  fetch?: typeof globalThis.fetch | undefined;
};

export async function startAudioUpload(options: AudioUploadOptions) {
  const file = await stat(options.path);
  if (!file.isFile() || file.size <= 0) throw new FactLensConfigurationError("The audio file is empty or is not a regular file.");
  if (file.size > MAX_STREAMED_AUDIO_BYTES) throw new FactLensConfigurationError("The audio file is too large for one FactLens verification request.");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new FactLensConfigurationError("A Fetch API implementation is required.");
  const url = resolveAudioUploadUrl(options.runtimeBaseUrl, options.audioUploadUrl);
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": options.contentType,
    "X-Request-ID": options.requestId,
    "X-FactLens-SDK": "node-cli",
    "X-FactLens-SDK-Version": SDK_VERSION,
    "X-FactLens-Audio-Language": options.language || "auto",
  });
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers,
      body: createReadStream(options.path) as any,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch (cause) {
    throw new FactLensError("FactLens could not upload the audio file. Check your network connection and try again.", {
      status: 0,
      code: "AUDIO_UPLOAD_NETWORK_ERROR",
      requestId: options.requestId,
      retryable: true,
      cause,
    });
  }
  const body = await responseBody(response);
  const code = text(body?.error);
  if (response.status === 409 && code === "REQUEST_IN_PROGRESS") return { requestId: options.requestId };
  if (response.ok && (body?.ok === true || body?.request_id)) return { requestId: text(body?.request_id) || options.requestId };
  throw new FactLensError(text(body?.message) || `FactLens audio upload returned HTTP ${response.status}.`, {
    status: response.status,
    code: code || `HTTP_${response.status}`,
    requestId: text(body?.request_id) || options.requestId,
    retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
    headers: new Headers(response.headers),
    ...(text(body?.stage) === "transcription" ? { stage: "transcription" as const } : {}),
    ...(body?.details === undefined ? {} : { details: body.details }),
  });
}

function resolveAudioUploadUrl(runtimeBaseUrl?: string, override?: string) {
  const explicit = String(override || "").trim();
  if (explicit) return explicit;
  const runtime = String(runtimeBaseUrl || "").trim().replace(/\/+$/, "");
  if (!runtime || runtime === "https://api.factlens.pro") return DEFAULT_DIRECT_AUDIO_VERIFY_URL;
  return `${runtime}/v1/verify`;
}

async function responseBody(response: Response): Promise<Record<string, any>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return { message: raw };
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
