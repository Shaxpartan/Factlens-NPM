#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import FactLens from "../client.js";
import { FactLensConfigurationError } from "../errors.js";
import { startAudioUpload } from "./audio.js";
import { killJobs, listJobs, registerJob, removeJob, updateJob, type CliJobState } from "./jobs.js";
import { colorize, createProgress, formatElapsed } from "./terminal.js";
import { SDK_VERSION } from "../http.js";
import type { LogListOptions, RequestOptions, VerifyInput, VerifyResponse } from "../types/index.js";
import { clearConfig, configPath, loadConfig, maskSecret, resolveCredentials, saveConfig, type CliConfig } from "./config.js";
import { exitCodeFor, humanError, serializeError, writeJson, type Writer } from "./output.js";

const MAX_TEXT_CHARS = 20_000;
const MAX_MEDIA_BASE64_CHARS = 8_000_000;
const DASHBOARD = "https://api.factlens.pro/dashboard";

export type CliDependencies = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  configFile?: string;
  writeOut?: Writer;
  writeErr?: Writer;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  jobsDir?: string;
  color?: boolean;
  progressIntervalMs?: number;
  pid?: number;
  audioUploadUrl?: string;
};

type Flags = Map<string, string | boolean>;

type CliContext = {
  env: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  configFile: string;
  writeOut: Writer;
  writeErr: Writer;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  json: boolean;
  jobsDir: string;
  color: boolean;
  progressIntervalMs: number;
  pid: number;
  audioUploadUrl?: string;
};

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const parsed = parseArgs(argv);
  const env = dependencies.env ?? process.env;
  const configFile = dependencies.configFile ?? configPath({ env });
  const stdout = dependencies.stdout ?? process.stdout;
  const context: CliContext = {
    env,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    configFile,
    writeOut: dependencies.writeOut ?? ((value) => process.stdout.write(value)),
    writeErr: dependencies.writeErr ?? ((value) => process.stderr.write(value)),
    stdin: dependencies.stdin ?? process.stdin,
    stdout,
    json: flagBoolean(parsed.flags, "json"),
    jobsDir: dependencies.jobsDir ?? join(dirname(configFile), "jobs"),
    color: dependencies.color ?? Boolean(stdout.isTTY && !("NO_COLOR" in env)),
    progressIntervalMs: dependencies.progressIntervalMs ?? 120,
    pid: dependencies.pid ?? process.pid,
    ...(dependencies.audioUploadUrl ? { audioUploadUrl: dependencies.audioUploadUrl } : {}),
  };

  try {
    const command = parsed.positionals[0];
    if (!command || command === "help" || flagBoolean(parsed.flags, "help")) {
      context.writeOut(helpText());
      return 0;
    }
    if (command === "--version" || command === "version" || flagBoolean(parsed.flags, "version")) {
      context.writeOut(`${SDK_VERSION}\n`);
      return 0;
    }

    if (command === "configure") return configureCommand(parsed.flags, context);
    if (command === "config") return configCommand(parsed.positionals.slice(1), context);
    if (command === "list") return listCommand(context);
    if (command === "kill") return killCommand(parsed.positionals.slice(1), context);

    const saved = await loadConfig(context.configFile);
    const resolvedConfig = resolveCredentials(saved, context.env);
    const client = makeClient(resolvedConfig, context.fetch);
    if (resolvedConfig.selectedProjectId) client.projects.select(resolvedConfig.selectedProjectId);

    let result: unknown;
    switch (command) {
      case "doctor":
        result = await doctor(client, resolvedConfig);
        break;
      case "verify":
        result = await verifyCommand(client, parsed.positionals.slice(1), parsed.flags, context, resolvedConfig);
        break;
      case "usage":
        result = flagBoolean(parsed.flags, "account")
          ? await client.usage.getAccount(projectInput(parsed.flags))
          : await client.usage.get(requestOptions(parsed.flags));
        break;
      case "account":
        result = await client.account.get();
        break;
      case "projects":
        result = await projectsCommand(client, parsed.positionals.slice(1), parsed.flags, saved, context);
        break;
      case "keys":
        result = await keysCommand(client, parsed.positionals.slice(1), parsed.flags);
        break;
      case "logs": {
        const projectId = flagString(parsed.flags, "project");
        const limit = flagNumber(parsed.flags, "limit");
        const before = flagString(parsed.flags, "before");
        const endpoint = flagString(parsed.flags, "endpoint");
        const status = logStatus(parsed.flags);
        const input: LogListOptions = {
          ...(projectId ? { projectId } : {}),
          ...(limit === undefined ? {} : { limit }),
          ...(before ? { before } : {}),
          ...(endpoint ? { endpoint } : {}),
          ...(status ? { status } : {}),
        };
        result = await client.logs.list(input, requestOptions(parsed.flags));
        break;
      }
      case "request": {
        const requestId = requiredText(parsed.positionals.slice(1).join(" "), "request ID");
        result = await client.logs.get(requestId, requestOptions(parsed.flags));
        break;
      }
      default:
        throw usageError(`Unknown command "${command}". Run factlens --help for available commands.`);
    }

    outputSuccess(command, result, context);
    return 0;
  } catch (error) {
    if (context.json) writeJson(context.writeErr, { ok: false, error: serializeError(error) });
    else context.writeErr(colorize(humanError(error), 31, context.color));
    return exitCodeFor(error);
  }
}

async function configureCommand(flags: Flags, context: CliContext) {
  const existing = await loadConfig(context.configFile);
  let apiKey = flagString(flags, "api-key");
  let developerToken = flagString(flags, "developer-token");

  if (!apiKey && !developerToken) {
    if (!context.stdin.isTTY || !context.stdout.isTTY) {
      throw usageError("Interactive configuration requires a terminal. Pass --api-key and/or --developer-token instead.");
    }
    apiKey = await readSecret("Project API key (leave blank to keep current): ", context.stdin, context.stdout) || existing.apiKey;
    developerToken = await readSecret("Developer token (leave blank to keep current): ", context.stdin, context.stdout) || existing.developerToken;
  }

  const next: CliConfig = {
    ...(existing.selectedProjectId ? { selectedProjectId: existing.selectedProjectId } : {}),
    ...(apiKey || existing.apiKey ? { apiKey: apiKey || existing.apiKey } : {}),
    ...(developerToken || existing.developerToken ? { developerToken: developerToken || existing.developerToken } : {}),
  };
  await saveConfig(next, context.configFile);
  if (context.json) writeJson(context.writeOut, { ok: true, configFile: context.configFile, apiKey: maskSecret(next.apiKey), developerToken: maskSecret(next.developerToken) });
  else context.writeOut(`FactLens configuration saved.\nFile: ${context.configFile}\nAPI key: ${maskSecret(next.apiKey)}\nDeveloper token: ${maskSecret(next.developerToken)}\n`);
  return 0;
}

async function configCommand(args: string[], context: CliContext) {
  const action = args[0] || "show";
  if (action === "clear") {
    await clearConfig(context.configFile);
    if (context.json) writeJson(context.writeOut, { ok: true, cleared: true });
    else context.writeOut("FactLens configuration cleared.\n");
    return 0;
  }
  if (action !== "show") throw usageError(`Unknown config action "${action}". Use "show" or "clear".`);
  const saved = await loadConfig(context.configFile);
  const display = {
    configFile: context.configFile,
    apiKey: maskSecret(saved.apiKey),
    developerToken: maskSecret(saved.developerToken),
    selectedProjectId: saved.selectedProjectId || "not selected",
    environmentOverrides: {
      apiKey: Boolean(context.env.FACTLENS_API_KEY),
      developerToken: Boolean(context.env.FACTLENS_DEVELOPER_TOKEN),
      runtimeBaseUrl: Boolean(context.env.FACTLENS_RUNTIME_BASE_URL),
      managementBaseUrl: Boolean(context.env.FACTLENS_MANAGEMENT_BASE_URL),
    },
  };
  if (context.json) writeJson(context.writeOut, display);
  else context.writeOut(`FactLens CLI configuration\nFile: ${display.configFile}\nAPI key: ${display.apiKey}\nDeveloper token: ${display.developerToken}\nSelected project: ${display.selectedProjectId}\n`);
  return 0;
}

function makeClient(config: ReturnType<typeof resolveCredentials>, fetchImplementation?: typeof globalThis.fetch) {
  return new FactLens({
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.developerToken ? { developerToken: config.developerToken } : {}),
    ...(config.runtimeBaseUrl ? { runtimeBaseUrl: config.runtimeBaseUrl } : {}),
    ...(config.managementBaseUrl ? { managementBaseUrl: config.managementBaseUrl } : {}),
    ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
  });
}

async function doctor(client: FactLens, config: ReturnType<typeof resolveCredentials>) {
  const checks: Array<Record<string, unknown>> = [];
  if (config.apiKey) {
    try {
      await client.usage.get({ maxRetries: 0, timeout: 15_000 });
      checks.push({ name: "runtime API key", ok: true });
    } catch (error) {
      checks.push({ name: "runtime API key", ok: false, error: serializeError(error) });
    }
  } else checks.push({ name: "runtime API key", ok: false, message: `Not configured. Get one from ${DASHBOARD}.` });

  if (config.developerToken) {
    try {
      await client.projects.list({ maxRetries: 0, timeout: 15_000 });
      checks.push({ name: "developer token", ok: true });
    } catch (error) {
      checks.push({ name: "developer token", ok: false, error: serializeError(error) });
    }
  } else checks.push({ name: "developer token", ok: false, message: `Not configured. Create one at ${DASHBOARD}.` });

  return { ok: checks.some((check) => check.ok === true) && checks.every((check) => check.ok === true || check.message), checks };
}

async function verifyCommand(client: FactLens, positionals: string[], flags: Flags, context: CliContext, resolvedConfig: ReturnType<typeof resolveCredentials>): Promise<VerifyResponse> {
  const file = flagString(flags, "file");
  const image = flagString(flags, "image");
  const audio = flagString(flags, "audio");
  const explicitInputs = [file, image, audio].filter(Boolean);
  if (explicitInputs.length > 1) throw usageError("Use only one of --file, --image, or --audio for a verification request.");

  const trustedDomains = domainListFlag(flags, "trusted-domains");
  const blockedDomains = domainListFlag(flags, "blocked-domains");
  const speaker = clean(flagString(flags, "speaker"));
  const requestId = flagString(flags, "request-id") || randomUUID();
  const common = { ...(trustedDomains.length ? { trusted_domains: trustedDomains } : {}), ...(blockedDomains.length ? { blocked_domains: blockedDomains } : {}) };

  let input: VerifyInput;
  let mode: VerifyInput["mode"];
  if (file) {
    const text = (await readFile(file, "utf8")).trim();
    if (!text) throw usageError("The text file is empty.");
    if (text.length > MAX_TEXT_CHARS) throw usageError(`Text input exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    mode = "text";
    input = { mode, claim: text, ...common };
  } else if (image) {
    const claim = requiredText(flagString(flags, "claim") || positionals.join(" "), "claim");
    const media = await mediaFile(image, "image");
    mode = "image_post";
    input = { mode, claim, image_base64: media.base64, content_type: media.contentType, ...common };
  } else if (audio) {
    const contentType = audioContentType(audio);
    const claim = clean(flagString(flags, "claim") || positionals.join(" "));
    if (!resolvedConfig.apiKey) throw new FactLensConfigurationError(`A FactLens project API key is required. Get one from ${DASHBOARD}.`);
    mode = "audio_video";
    await registerJob(context.jobsDir, { id: requestId, requestId, pid: context.pid, mode, state: "uploading", startedAt: Date.now(), ...(speaker ? { speaker } : {}) });
    const progress = createProgress(context.writeErr, !context.json, context.color, context.progressIntervalMs);
    progress.start("Uploading audio");
    try {
      await startAudioUpload({ path: audio, contentType, apiKey: resolvedConfig.apiKey, requestId, language: flagString(flags, "language") || "auto", runtimeBaseUrl: resolvedConfig.runtimeBaseUrl, audioUploadUrl: context.audioUploadUrl || context.env.FACTLENS_AUDIO_UPLOAD_URL, fetch: context.fetch });
      await updateJob(context.jobsDir, requestId, { state: "transcribing" });
      progress.update("Transcribing audio");
      const pollInput = { mode, audio_job: true, ...(claim ? { claim } : {}), ...(speaker ? { speaker } : {}), ...common } as VerifyInput & { audio_job: true };
      return await client.verify(pollInput, { ...requestOptions(flags, 1_800_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); void updateJob(context.jobsDir, requestId, { state: mapped }); progress.update(progressLabel(event.state)); } });
    } finally {
      progress.stop();
      await removeJob(context.jobsDir, requestId);
    }
  } else {
    const claim = requiredText(flagString(flags, "claim") || positionals.join(" "), "claim");
    if (claim.length > MAX_TEXT_CHARS) throw usageError(`Claim exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    mode = "text";
    input = { mode, claim, ...common };
  }

  await registerJob(context.jobsDir, { id: requestId, requestId, pid: context.pid, mode, state: "verifying", startedAt: Date.now(), ...(speaker ? { speaker } : {}) });
  const progress = createProgress(context.writeErr, !context.json, context.color, context.progressIntervalMs);
  progress.start("Verifying");
  try {
    return await client.verify(input, { ...requestOptions(flags, 180_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); void updateJob(context.jobsDir, requestId, { state: mapped }); progress.update(progressLabel(event.state)); } });
  } finally {
    progress.stop();
    await removeJob(context.jobsDir, requestId);
  }
}

function progressJobState(state: string): CliJobState {
  if (state === "transcribing") return "transcribing";
  if (state === "waiting") return "waiting";
  if (state === "retrying") return "retrying";
  return "verifying";
}

function progressLabel(state: string) {
  if (state === "transcribing") return "Transcribing audio";
  if (state === "waiting") return "Waiting for FactLens";
  if (state === "retrying") return "Reconnecting";
  if (state === "complete") return "Complete";
  return "Verifying";
}

async function listCommand(context: CliContext) {
  const jobs = await listJobs(context.jobsDir);
  const now = Date.now();
  const view = jobs.map((job) => ({ ...job, elapsed_ms: Math.max(0, now - job.startedAt) }));
  if (context.json) { writeJson(context.writeOut, { concurrency: jobs.length, jobs: view }); return 0; }
  if (!jobs.length) { context.writeOut(`${colorize("FactLens", 36, context.color)} has no active local jobs.\n`); return 0; }
  const lines = [`${colorize("FactLens active jobs", 1, context.color)}  ${colorize(`Concurrency ${jobs.length}`, 36, context.color)}`];
  for (const job of jobs) {
    const state = colorize(job.state.toUpperCase(), stateColor(job.state), context.color);
    lines.push(`${job.id.slice(0, 8)}  PID ${job.pid}  ${job.mode}  ${state}  ${formatElapsed(now - job.startedAt)}${job.speaker ? `  speaker: ${job.speaker}` : ""}`);
  }
  context.writeOut(`${lines.join("\n")}\n`);
  return 0;
}

async function killCommand(args: string[], context: CliContext) {
  const target = requiredText(args[0], "job ID or all");
  const killed = await killJobs(context.jobsDir, target);
  if (!killed.length) throw usageError(`No active FactLens job matches "${target}".`);
  if (context.json) { writeJson(context.writeOut, { killed: killed.map((job) => ({ id: job.id, pid: job.pid })) }); return 0; }
  context.writeOut(colorize(`Stopped ${killed.length} FactLens job${killed.length === 1 ? "" : "s"}.\n`, 33, context.color));
  return 0;
}

function stateColor(state: CliJobState) {
  if (state === "retrying") return 33;
  if (state === "transcribing" || state === "uploading") return 36;
  if (state === "waiting") return 35;
  return 32;
}

function audioContentType(path: string) {
  const extension = extname(path).toLowerCase();
  const contentType = audioTypes[extension];
  if (!contentType) throw usageError(`Unsupported audio file type "${extension || "unknown"}.`);
  return contentType;
}

async function projectsCommand(client: FactLens, args: string[], flags: Flags, saved: CliConfig, context: CliContext) {
  const action = args[0] || "list";
  if (action === "list") return client.projects.list(requestOptions(flags));
  if (action === "create") return client.projects.create({ name: requiredText(args.slice(1).join(" "), "project name") }, requestOptions(flags));
  if (action === "update") {
    const id = requiredText(args[1], "project ID");
    const name = requiredText(args.slice(2).join(" "), "project name");
    return client.projects.update(id, { name }, requestOptions(flags));
  }
  if (action === "delete") {
    const id = requiredText(args[1], "project ID");
    requireConfirmation(flags, "project deletion");
    return client.projects.delete(id, requestOptions(flags));
  }
  if (action === "select") {
    const id = requiredText(args[1], "project ID");
    const projects = await client.projects.list(requestOptions(flags));
    if (!projects.some((project) => project.id === id)) throw usageError(`Project "${id}" was not found in this developer account.`);
    await saveConfig({ ...saved, selectedProjectId: id }, context.configFile);
    return { ok: true, selectedProjectId: id };
  }
  throw usageError(`Unknown projects action "${action}".`);
}

async function keysCommand(client: FactLens, args: string[], flags: Flags) {
  const action = args[0] || "list";
  const project = projectInput(flags);
  if (action === "list") return client.keys.list(project, requestOptions(flags));
  if (action === "create") return client.keys.create({ ...project, label: requiredText(args.slice(1).join(" "), "key label") }, requestOptions(flags));
  if (action === "revoke") {
    requireConfirmation(flags, "API key revocation");
    return client.keys.revoke({ ...project, keyId: requiredText(args[1], "key ID") }, requestOptions(flags));
  }
  throw usageError(`Unknown keys action "${action}".`);
}

function outputSuccess(command: string, result: any, context: CliContext) {
  if (context.json) {
    writeJson(context.writeOut, result);
    return;
  }
  if (command === "verify") {
    context.writeOut(humanVerify(result, context.color));
    return;
  }
  if (command === "doctor") {
    context.writeOut(`FactLens doctor\n${(result.checks || []).map((check: any) => `${check.ok ? "OK" : "WARN"}  ${check.name}${check.message ? ` — ${check.message}` : ""}`).join("\n")}\n`);
    return;
  }
  if (command === "projects" && result?.selectedProjectId) {
    context.writeOut(`Selected project: ${result.selectedProjectId}\n`);
    return;
  }
  if (command === "keys" && result?.api_key) {
    context.writeOut(`API key created. This secret is shown once.\n${result.api_key}\nStore it securely; FactLens cannot show it again.\n`);
    return;
  }
  context.writeOut(`${JSON.stringify(result, null, 2)}\n`);
}

function appendHumanVerifyResult(lines: string[], result: any, index?: number, color = false) {
  if (result?.claim) lines.push(index === undefined ? `Claim: ${result.claim}` : `Claim ${index + 1}: ${result.claim}`);
  if (result?.verdictId) lines.push(`Verdict: ${colorize(String(result.verdictId), verdictColor(String(result.verdictId)), color)}`);
  if (result?.confidence) lines.push(`Confidence: ${result.confidence}`);
  if (result?.evidenceStrength) lines.push(`Evidence: ${result.evidenceStrength}`);
  if (result?.explanation) lines.push(`\n${result.explanation}`);
  if (Array.isArray(result?.sources) && result.sources.length) {
    lines.push("\nSources:");
    result.sources.forEach((source: any, sourceIndex: number) => lines.push(`${sourceIndex + 1}. ${source.title ? `${source.title} — ` : ""}${source.url}`));
  }
}

function humanVerify(result: VerifyResponse, color = false) {
  const lines = [colorize("FactLens verification complete", 1, color)];
  const results = Array.isArray(result.results) && result.results.length ? result.results : null;
  if (results) {
    results.forEach((item, index) => {
      if (index > 0) lines.push("");
      appendHumanVerifyResult(lines, item, index, color);
    });
  } else {
    appendHumanVerifyResult(lines, result, undefined, color);
  }
  if (result.request_id) lines.push(`\nRequest ID: ${result.request_id}`);
  if (result.response_time_ms !== undefined) lines.push(`Response time: ${result.response_time_ms} ms`);
  if (result.usage) lines.push(`Usage: ${JSON.stringify(result.usage)}`);
  return `${lines.join("\n")}\n`;
}

function verdictColor(verdict: string) { const value = verdict.toUpperCase(); if (value === "TRUE") return 32; if (value === "MOSTLY_TRUE") return 36; if (value === "MISLEADING") return 33; if (value === "FALSE") return 31; return 35; }

async function mediaFile(path: string, kind: "image" | "audio") {
  const extension = extname(path).toLowerCase();
  const contentType = kind === "image" ? imageTypes[extension] : audioTypes[extension];
  if (!contentType) throw usageError(`Unsupported ${kind} file type "${extension || "unknown"}.`);
  const data = await readFile(path);
  const base64 = data.toString("base64");
  if (!data.length) throw usageError(`The ${kind} file is empty.`);
  if (base64.length > MAX_MEDIA_BASE64_CHARS) throw usageError(`${kind === "image" ? "Image" : "Audio"} input is too large for one FactLens request.`);
  return { base64, contentType };
}

const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const audioTypes: Record<string, string> = {
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".m4a": "audio/mp4",
};

function requestOptions(flags: Flags, defaultTimeout?: number): RequestOptions {
  const timeout = flagNumber(flags, "timeout") ?? defaultTimeout;
  const maxRetries = flagNumber(flags, "retries");
  const requestId = flagString(flags, "request-id");
  return {
    ...(timeout === undefined ? {} : { timeout }),
    ...(maxRetries === undefined ? {} : { maxRetries }),
    ...(requestId ? { requestId } : {}),
  };
}

function projectInput(flags: Flags) {
  const projectId = flagString(flags, "project");
  return projectId ? { projectId } : {};
}

function logStatus(flags: Flags): "success" | "failed" | undefined {
  const value = flagString(flags, "status");
  if (!value) return undefined;
  if (value !== "success" && value !== "failed") throw usageError("--status must be success or failed.");
  return value;
}

function requireConfirmation(flags: Flags, action: string) {
  if (!flagBoolean(flags, "yes")) throw usageError(`Refusing ${action} without --yes.`);
}

function parseArgs(argv: string[]) {
  const positionals: string[] = [];
  const flags: Flags = new Map();
  const booleanFlags = new Set(["json", "account", "yes", "help", "version"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    const name = token.slice(2, equal > -1 ? equal : undefined);
    if (!name) throw usageError("Invalid empty option.");
    if (equal > -1) {
      flags.set(name, token.slice(equal + 1));
      continue;
    }
    if (booleanFlags.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw usageError(`--${name} requires a value.`);
    flags.set(name, value);
    index += 1;
  }
  return { positionals, flags };
}

function flagString(flags: Flags, name: string) {
  const value = flags.get(name);
  return typeof value === "string" ? clean(value) : undefined;
}

function domainListFlag(flags: Flags, name: string) {
  const value = flagString(flags, name);
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function flagBoolean(flags: Flags, name: string) {
  return flags.get(name) === true || flags.get(name) === "true";
}

function flagNumber(flags: Flags, name: string) {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw usageError(`--${name} must be a non-negative number.`);
  return Math.floor(number);
}

function requiredText(value: unknown, label: string) {
  const text = clean(value);
  if (!text) throw usageError(`${label[0]?.toUpperCase()}${label.slice(1)} is required.`);
  return text;
}

function clean(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function usageError(message: string) {
  return new FactLensConfigurationError(message);
}

async function readSecret(prompt: string, input: NodeJS.ReadStream, output: NodeJS.WriteStream) {
  output.write(prompt);
  const wasRaw = input.isRaw;
  input.setRawMode?.(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise<string>((resolvePromise, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(Boolean(wasRaw));
      input.pause();
    };
    const onData = (chunk: string | Buffer) => {
      const text = String(chunk);
      for (const character of text) {
        if (character === "\u0003") {
          cleanup();
          output.write("\n");
          reject(new FactLensConfigurationError("Configuration cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          output.write("\n");
          resolvePromise(value.trim());
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          output.write("*");
        }
      }
    };
    input.on("data", onData);
  });
}

function helpText() {
  return `FactLens CLI ${SDK_VERSION}\n\nUsage:\n  factlens configure [--api-key KEY] [--developer-token TOKEN]\n  factlens config show|clear\n  factlens doctor\n  factlens verify <claim> [--trusted-domains a.com,b.com] [--blocked-domains c.com] [--json]\n  factlens verify --file claim.txt\n  factlens verify --image image.png --claim "Claim about the image"\n  factlens verify --audio recording.mp3 [--claim "Optional claim"]\n  factlens usage [--account] [--project ID]\n  factlens account\n  factlens projects list\n  factlens projects create <name>\n  factlens projects update <project-id> <name>\n  factlens projects delete <project-id> --yes\n  factlens projects select <project-id>\n  factlens keys list [--project ID]\n  factlens keys create <label> [--project ID]\n  factlens keys revoke <key-id> [--project ID] --yes\n  factlens logs [--project ID] [--limit N] [--endpoint verify] [--status success|failed]\n  factlens request <request-id>\n\nSource preferences:\n  --trusted-domains LIST  Prioritize matching domains for this verification\n  --blocked-domains LIST  Exclude matching domains for this verification\n\nRequest options:\n  --timeout MS       Total client timeout\n  --retries N        Automatic retries (0-5)\n  --request-id UUID  Explicit idempotency/request ID\n  --json             Machine-readable output\n\nCredentials:\n  FACTLENS_API_KEY             Project key for Verify and runtime Usage\n  FACTLENS_DEVELOPER_TOKEN     Developer token for account management\n\nGet credentials: ${DASHBOARD}\n`;
}

const invokedPath = process.argv[1] || "";
const invokedName = basename(invokedPath).toLowerCase();
const invokedDirectly = invokedName === "factlens" || invokedName === "factlens.cmd" || (invokedName === "index.js" && /[\\/]cli[\\/]index\.js$/i.test(invokedPath));
if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(humanError(error));
    process.exitCode = exitCodeFor(error);
  });
}
