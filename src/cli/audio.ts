import { open, stat } from "node:fs/promises";
import { FactLensConfigurationError, FactLensError } from "../errors.js";
import { SDK_VERSION } from "../http.js";

const DEFAULT_AUDIO_UPLOAD_BROKER_URL = "https://xqrtidxikzgwwhtynuul.supabase.co/functions/v1/factlens-audio-upload";
const DEFAULT_RUNTIME_BASE_URL = "https://api.factlens.pro";
const MAX_STREAMED_AUDIO_BYTES = 512 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const TUS_RETRY_DELAYS = [0, 1000, 3000, 5000] as const;

export type AudioUploadProgress = {
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
};

export type AudioUploadOptions = {
  path: string;
  contentType: string;
  apiKey: string;
  requestId: string;
  language?: string | undefined;
  runtimeBaseUrl?: string | undefined;
  audioUploadUrl?: string | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  onProgress?: ((progress: AudioUploadProgress) => void) | undefined;
};

type BrokerUpload = {
  endpoint: string;
  token: string;
  bucket: string;
  object_path: string;
  chunk_size: number;
  max_bytes?: number;
};

type BrokerResponse = {
  request_id?: string;
  upload?: BrokerUpload;
  audio_url?: string;
  error?: string;
  message?: string;
};

export async function startAudioUpload(options: AudioUploadOptions) {
  const file = await stat(options.path);
  if (!file.isFile() || file.size <= 0) throw new FactLensConfigurationError("The audio file is empty or is not a regular file.");
  if (file.size > MAX_STREAMED_AUDIO_BYTES) throw new FactLensConfigurationError("The audio file is too large for one FactLens verification request.");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new FactLensConfigurationError("A Fetch API implementation is required.");

  const brokerUrl = resolveAudioUploadUrl(options.audioUploadUrl);
  const verifyUrl = resolveVerifyUrl(options.runtimeBaseUrl);
  const commonHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${options.apiKey}`,
    "X-Request-ID": options.requestId,
    "X-FactLens-SDK": "node-cli",
    "X-FactLens-SDK-Version": SDK_VERSION,
  };

  const prepared = await brokerRequest(fetchImplementation, brokerUrl, commonHeaders, {
    action: "prepare",
    request_id: options.requestId,
    size_bytes: file.size,
    content_type: options.contentType,
  });
  const upload = prepared.upload;
  if (!upload?.endpoint || !upload.token || !upload.bucket || !upload.object_path) {
    throw new FactLensError("FactLens returned an invalid audio upload reservation.", { status: 503, code: "AUDIO_UPLOAD_PREPARE_FAILED", requestId: options.requestId, retryable: true });
  }
  if (Number(upload.chunk_size) !== TUS_CHUNK_BYTES) {
    throw new FactLensError("FactLens returned an unsupported resumable upload chunk size.", { status: 503, code: "AUDIO_UPLOAD_PROTOCOL_MISMATCH", requestId: options.requestId, retryable: true });
  }

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await brokerRequest(fetchImplementation, brokerUrl, commonHeaders, { action: "cleanup", request_id: options.requestId, object_path: upload.object_path });
    } catch {}
  };
  process.once("beforeExit", () => { void cleanup(); });

  try {
    emitProgress(options.onProgress, 0, file.size);
    await tusUpload({
      fetchImplementation,
      path: options.path,
      size: file.size,
      contentType: options.contentType,
      upload,
      requestId: options.requestId,
      onProgress: options.onProgress,
    });

    const resolved = await brokerRequest(fetchImplementation, brokerUrl, commonHeaders, { action: "resolve", request_id: options.requestId, object_path: upload.object_path });
    if (!resolved.audio_url) {
      throw new FactLensError("FactLens could not resolve the temporary audio upload.", { status: 503, code: "AUDIO_UPLOAD_RESOLVE_FAILED", requestId: options.requestId, retryable: true });
    }

    const response = await safeFetch(fetchImplementation, verifyUrl, {
      method: "POST",
      headers: { ...commonHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "audio_video", audio_url: resolved.audio_url, language: options.language || "auto" }),
    }, options.requestId, "FactLens could not start audio verification after upload.");
    const body = await responseBody(response);
    const code = text(body?.error);
    if (response.status === 409 && code === "REQUEST_IN_PROGRESS") {
      await releaseAcceptedLease(fetchImplementation, brokerUrl, commonHeaders, options.requestId, upload.object_path);
      return { requestId: options.requestId };
    }
    if (response.ok && (body?.ok === true || body?.request_id)) {
      await releaseAcceptedLease(fetchImplementation, brokerUrl, commonHeaders, options.requestId, upload.object_path);
      return { requestId: text(body?.request_id) || options.requestId };
    }
    await cleanup();
    throw responseError(response, body, options.requestId, "FactLens could not start verification for the uploaded audio.");
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function releaseAcceptedLease(fetchImplementation: typeof globalThis.fetch, brokerUrl: string, headers: Record<string, string>, requestId: string, objectPath: string) {
  for (const wait of [0, 250, 750]) {
    if (wait) await delay(wait);
    try {
      await brokerRequest(fetchImplementation, brokerUrl, headers, { action: "release", request_id: requestId, object_path: objectPath });
      return;
    } catch {}
  }
}

async function tusUpload(options: {
  fetchImplementation: typeof globalThis.fetch;
  path: string;
  size: number;
  contentType: string;
  upload: BrokerUpload;
  requestId: string;
  onProgress?: ((progress: AudioUploadProgress) => void) | undefined;
}) {
  const endpoint = String(options.upload.endpoint).trim();
  const metadata = uploadMetadata({ bucketName: options.upload.bucket, objectName: options.upload.object_path, contentType: options.contentType, cacheControl: "0" });
  const creation = await safeFetch(options.fetchImplementation, endpoint, {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(options.size),
      "Upload-Metadata": metadata,
      "x-signature": options.upload.token,
    },
  }, options.requestId, "FactLens could not create the resumable audio upload.");
  if (creation.status !== 201) {
    const body = await responseBody(creation);
    throw responseError(creation, body, options.requestId, "FactLens could not create the resumable audio upload.", "AUDIO_UPLOAD_TUS_FAILED");
  }
  const location = creation.headers.get("location");
  if (!location) {
    throw new FactLensError("FactLens storage did not return a resumable upload location.", { status: 503, code: "AUDIO_UPLOAD_TUS_FAILED", requestId: options.requestId, retryable: true });
  }
  const uploadUrl = new URL(location, endpoint).toString();
  const handle = await open(options.path, "r");
  try {
    let offset = 0;
    while (offset < options.size) {
      const length = Math.min(TUS_CHUNK_BYTES, options.size - offset);
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(chunk, 0, length, offset);
      if (bytesRead <= 0) throw new FactLensConfigurationError("The audio file changed while it was being uploaded.");
      offset = await patchChunk(options.fetchImplementation, uploadUrl, options.upload.token, chunk.subarray(0, bytesRead), offset, options.size, options.requestId);
      emitProgress(options.onProgress, offset, options.size);
    }
  } finally {
    await handle.close();
  }
}

async function patchChunk(fetchImplementation: typeof globalThis.fetch, uploadUrl: string, token: string, chunk: Uint8Array, requestedOffset: number, total: number, requestId: string) {
  let offset = requestedOffset;
  for (let attempt = 0; attempt < TUS_RETRY_DELAYS.length; attempt += 1) {
    const retryDelay = TUS_RETRY_DELAYS[attempt] ?? 0;
    if (retryDelay > 0) await delay(retryDelay);
    let response: Response;
    try {
      const payload = Uint8Array.from(chunk).buffer;
      response = await fetchImplementation(uploadUrl, {
        method: "PATCH",
        headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream", "x-signature": token },
        body: payload,
      });
    } catch (cause) {
      if (attempt === TUS_RETRY_DELAYS.length - 1) {
        throw new FactLensError("FactLens lost the connection while uploading audio. The resumable upload could not continue.", { status: 0, code: "AUDIO_UPLOAD_NETWORK_ERROR", requestId, retryable: true, cause });
      }
      const recovered = await tusOffset(fetchImplementation, uploadUrl, token, offset);
      if (recovered > requestedOffset) return recovered;
      if (recovered < requestedOffset) throw protocolOffsetError(requestId);
      offset = recovered;
      continue;
    }
    if (response.ok) {
      const next = Number(response.headers.get("upload-offset"));
      if (!Number.isSafeInteger(next) || next <= offset || next > total) throw protocolOffsetError(requestId);
      return next;
    }
    if (![408, 409, 423, 429].includes(response.status) && response.status < 500) {
      const body = await responseBody(response);
      throw responseError(response, body, requestId, "FactLens storage rejected the audio upload.", "AUDIO_UPLOAD_TUS_FAILED");
    }
    if (attempt === TUS_RETRY_DELAYS.length - 1) {
      const body = await responseBody(response);
      throw responseError(response, body, requestId, "FactLens storage could not complete the resumable upload.", "AUDIO_UPLOAD_TUS_FAILED");
    }
    const recovered = await tusOffset(fetchImplementation, uploadUrl, token, offset);
    if (recovered > requestedOffset) return recovered;
    if (recovered < requestedOffset) throw protocolOffsetError(requestId);
    offset = recovered;
  }
  return offset;
}

function emitProgress(callback: AudioUploadOptions["onProgress"], uploadedBytes: number, totalBytes: number) {
  if (!callback || totalBytes <= 0) return;
  try {
    callback({ uploadedBytes, totalBytes, percent: Math.min(100, Math.max(0, (uploadedBytes / totalBytes) * 100)) });
  } catch {}
}

function protocolOffsetError(requestId: string) {
  return new FactLensError("FactLens storage returned an invalid resumable upload offset.", { status: 502, code: "AUDIO_UPLOAD_PROTOCOL_MISMATCH", requestId, retryable: true });
}

async function tusOffset(fetchImplementation: typeof globalThis.fetch, uploadUrl: string, token: string, fallback: number) {
  try {
    const response = await fetchImplementation(uploadUrl, { method: "HEAD", headers: { "Tus-Resumable": "1.0.0", "x-signature": token } });
    const offset = Number(response.headers.get("upload-offset"));
    return response.ok && Number.isSafeInteger(offset) && offset >= 0 ? offset : fallback;
  } catch {
    return fallback;
  }
}

async function brokerRequest(fetchImplementation: typeof globalThis.fetch, url: string, headers: Record<string, string>, payload: Record<string, unknown>): Promise<BrokerResponse> {
  const response = await safeFetch(fetchImplementation, url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, String(payload.request_id || ""), "FactLens could not prepare the temporary audio upload.");
  const body = await responseBody(response) as BrokerResponse;
  if (response.ok) return body;
  throw responseError(response, body, String(payload.request_id || ""), body.message || "FactLens could not prepare the temporary audio upload.");
}

async function safeFetch(fetchImplementation: typeof globalThis.fetch, url: string, init: RequestInit, requestId: string, message: string) {
  try {
    return await fetchImplementation(url, init);
  } catch (cause) {
    throw new FactLensError(message, { status: 0, code: "AUDIO_UPLOAD_NETWORK_ERROR", requestId, retryable: true, cause });
  }
}

function responseError(response: Response, body: Record<string, any>, requestId: string, fallback: string, fallbackCode?: string) {
  const code = text(body?.error) || fallbackCode || `HTTP_${response.status}`;
  return new FactLensError(text(body?.message) || fallback || `FactLens audio upload returned HTTP ${response.status}.`, {
    status: response.status,
    code,
    requestId: text(body?.request_id) || requestId,
    retryable: response.status === 408 || response.status === 409 || response.status === 423 || response.status === 429 || response.status >= 500,
    headers: new Headers(response.headers),
    ...(text(body?.stage) === "transcription" ? { stage: "transcription" as const } : {}),
    ...(body?.details === undefined ? {} : { details: body.details }),
  });
}

function uploadMetadata(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => `${key} ${Buffer.from(value, "utf8").toString("base64")}`).join(",");
}

function resolveAudioUploadUrl(override?: string) {
  return String(override || "").trim() || DEFAULT_AUDIO_UPLOAD_BROKER_URL;
}

function resolveVerifyUrl(runtimeBaseUrl?: string) {
  const runtime = String(runtimeBaseUrl || DEFAULT_RUNTIME_BASE_URL).trim().replace(/\/+$/, "");
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
