#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import FactLens from "../client.js";
import { FactLensConfigurationError } from "../errors.js";
import { startAudioUpload } from "./audio.js";
import { killJobs, listJobs, registerJob, removeJob, updateJob, type CliJobState } from "./jobs.js";
import { colorize, colorizeHex, createProgress, formatDuration, formatElapsed, type TimeUnit } from "./terminal.js";
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
  quiet: boolean;
  verbose: boolean;
  timeUnit: TimeUnit;
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
    quiet: flagBoolean(parsed.flags, "quiet"),
    verbose: flagBoolean(parsed.flags, "verbose"),
    timeUnit: timeUnitFlag(parsed.flags),
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
  const startedAt = monotonicNow();
  const file = flagString(flags, "file");
  const image = flagString(flags, "image");
  const audio = flagString(flags, "audio");
  const transcriptFile = flagString(flags, "transcript-file");
  const transcriptFlag = flagString(flags, "transcript");
  const audioUrl = flagString(flags, "audio-url");
  const explicitInputs = [file, image, audio, transcriptFile, transcriptFlag, audioUrl].filter(Boolean);
  if (explicitInputs.length > 1) throw usageError("Use only one explicit input source: --file, --image, --audio, --transcript, --transcript-file, or --audio-url.");

  const trustedDomains = domainListFlag(flags, "trusted-domains");
  const blockedDomains = domainListFlag(flags, "blocked-domains");
  const trustedOverride = flagBoolean(flags, "no-trusted-domains") ? [] : flags.has("trusted-domains") ? trustedDomains : undefined;
  const blockedOverride = flagBoolean(flags, "no-blocked-domains") ? [] : flags.has("blocked-domains") ? blockedDomains : undefined;
  if (flagBoolean(flags, "no-trusted-domains") && flags.has("trusted-domains")) throw usageError("Use either --trusted-domains or --no-trusted-domains, not both.");
  if (flagBoolean(flags, "no-blocked-domains") && flags.has("blocked-domains")) throw usageError("Use either --blocked-domains or --no-blocked-domains, not both.");
  const instructions = flagString(flags, "instructions");
  const searchQuery = flagString(flags, "search-query");
  const resultsPerSearch = flagNumber(flags, "results-per-search");
  if (resultsPerSearch !== undefined && (resultsPerSearch < 1 || resultsPerSearch > 50)) throw usageError("--results-per-search must be between 1 and 50.");
  const verdicts = await verdictsFromFile(flagString(flags, "verdicts-file"));
  const speaker = clean(flagString(flags, "speaker"));
  const language = flagString(flags, "language") || "auto";
  const requestId = flagString(flags, "request-id") || randomUUID();
  const common = {
    ...(trustedOverride === undefined ? {} : { trusted_domains: trustedOverride }),
    ...(blockedOverride === undefined ? {} : { blocked_domains: blockedOverride }),
    ...(instructions ? { instructions } : {}),
    ...(searchQuery ? { search_query: searchQuery } : {}),
    ...(resultsPerSearch === undefined ? {} : { results_per_search: resultsPerSearch }),
    ...(verdicts ? { verdicts } : {}),
  };

  let input: VerifyInput;
  let mode: VerifyInput["mode"];
  if (file) {
    const text = (await readFile(file, "utf8")).trim();
    if (!text) throw usageError("The text file is empty.");
    if (text.length > MAX_TEXT_CHARS) throw usageError(`Text input exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    mode = "text";
    input = { mode, claim: text, ...common };
  } else if (image) {
    const claim = clean(flagString(flags, "claim") || positionals.join(" "));
    const media = await mediaFile(image, "image");
    mode = "image_post";
    input = { mode, ...(claim ? { claim } : {}), image_base64: media.base64, content_type: media.contentType, ...common };
  } else if (audio) {
    const contentType = audioContentType(audio);
    const claim = clean(flagString(flags, "claim") || positionals.join(" "));
    if (!resolvedConfig.apiKey) throw new FactLensConfigurationError(`A FactLens project API key is required. Get one from ${DASHBOARD}.`);
    mode = "audio_video";
    await registerJob(context.jobsDir, { id: requestId, requestId, pid: context.pid, mode, state: "uploading", startedAt: Date.now(), ...(speaker ? { speaker } : {}) });
    const interactive = !context.json && Boolean(context.stdout.isTTY);
    const progress = createProgress(context.writeErr, interactive, context.color, context.progressIntervalMs, "audio");
    let pendingJobUpdate = Promise.resolve();
    const queueJobUpdate = (state: CliJobState) => {
      pendingJobUpdate = pendingJobUpdate.then(() => updateJob(context.jobsDir, requestId, { state })).catch(() => {});
    };
    progress.start("Uploading audio");
    try {
      await startAudioUpload({
        path: audio,
        contentType,
        apiKey: resolvedConfig.apiKey,
        requestId,
        language,
        runtimeBaseUrl: resolvedConfig.runtimeBaseUrl,
        audioUploadUrl: context.audioUploadUrl || context.env.FACTLENS_AUDIO_UPLOAD_URL,
        fetch: context.fetch,
        onProgress: (event) => progress.upload(event),
      });
      await updateJob(context.jobsDir, requestId, { state: "transcribing" });
      progress.update("Transcribing audio");
      const pollInput = { mode, audio_job: true, ...(claim ? { claim } : {}), ...(speaker ? { speaker } : {}), ...common } as VerifyInput & { audio_job: true };
      const result = await client.verify(pollInput, { ...requestOptions(flags, 1_800_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); queueJobUpdate(mapped); progress.update(progressLabel(event.state)); } });
      return attachClientElapsed(result, startedAt);
    } finally {
      progress.stop();
      await pendingJobUpdate;
      await removeJob(context.jobsDir, requestId);
    }
  } else if (audioUrl) {
    mode = "audio_video";
    input = { mode, audio_url: audioUrl, language, ...(speaker ? { speaker } : {}), ...common };
  } else if (transcriptFile || transcriptFlag) {
    const transcript = transcriptFile ? (await readFile(transcriptFile, "utf8")).trim() : String(transcriptFlag || "").trim();
    if (!transcript) throw usageError("Transcript input is empty.");
    mode = "audio_video";
    input = { mode, transcript, ...(speaker ? { speaker } : {}), ...common };
  } else {
    const claim = requiredText(flagString(flags, "claim") || positionals.join(" "), "claim");
    if (claim.length > MAX_TEXT_CHARS) throw usageError(`Claim exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    mode = "text";
    input = { mode, claim, ...common };
  }

  await registerJob(context.jobsDir, { id: requestId, requestId, pid: context.pid, mode, state: "verifying", startedAt: Date.now(), ...(speaker ? { speaker } : {}) });
  const progressMode = mode === "image_post" ? "image" : mode === "audio_video" ? "audio" : "text";
  const interactive = !context.json && Boolean(context.stdout.isTTY);
  const progress = createProgress(context.writeErr, interactive, context.color, context.progressIntervalMs, progressMode);
  let pendingJobUpdate = Promise.resolve();
  const queueJobUpdate = (state: CliJobState) => {
    pendingJobUpdate = pendingJobUpdate.then(() => updateJob(context.jobsDir, requestId, { state })).catch(() => {});
  };
  progress.start(mode === "image_post" ? "Verifying image" : "Verifying");
  try {
    const result = await client.verify(input, { ...requestOptions(flags, mode === "audio_video" ? 1_800_000 : 180_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); queueJobUpdate(mapped); progress.update(progressLabel(event.state)); } });
    return attachClientElapsed(result, startedAt);
  } finally {
    progress.stop();
    await pendingJobUpdate;
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
  if (action === "customization") return keysCustomizationCommand(client, args.slice(1), flags);
  throw usageError(`Unknown keys action "${action}".`);
}

async function keysCustomizationCommand(client: FactLens, args: string[], flags: Flags) {
  const action = args[0] || "get";
  const projectId = flagString(flags, "project");
  const keyId = requiredText(args[1], "key ID");
  const reference = { ...(projectId ? { projectId } : {}), keyId };
  if (action === "get") return client.keys.customization.get(reference, requestOptions(flags));
  if (action === "preferences") {
    const trustedDomains = flagBoolean(flags, "no-trusted-domains") ? [] : flags.has("trusted-domains") ? domainListFlag(flags, "trusted-domains") : undefined;
    const blockedDomains = flagBoolean(flags, "no-blocked-domains") ? [] : flags.has("blocked-domains") ? domainListFlag(flags, "blocked-domains") : undefined;
    if (trustedDomains === undefined && blockedDomains === undefined) throw usageError("Pass a trusted or blocked domain preference to update.");
    return client.keys.customization.updatePreferences({ ...reference, ...(trustedDomains === undefined ? {} : { trustedDomains }), ...(blockedDomains === undefined ? {} : { blockedDomains }) }, requestOptions(flags));
  }
  if (action === "prompt") {
    const promptAction = args[1];
    const promptKeyId = requiredText(args[2], "key ID");
    const promptRef = { ...(projectId ? { projectId } : {}), keyId: promptKeyId };
    const mode = requiredText(flagString(flags, "mode"), "mode") as "text" | "audio" | "image";
    const stage = requiredText(flagString(flags, "stage"), "stage") as any;
    if (promptAction === "reset") return client.keys.customization.resetPrompt({ ...promptRef, mode, stage }, requestOptions(flags));
    if (promptAction !== "save") throw usageError("Use keys customization prompt save|reset.");
    const instructionFile = flagString(flags, "instruction-file");
    const instruction = instructionFile ? (await readFile(instructionFile, "utf8")).trim() : requiredText(flagString(flags, "instruction"), "instruction or --instruction-file");
    return client.keys.customization.savePrompt({
      ...promptRef,
      mode,
      stage,
      instruction,
      inputBudgetTokens: flagNumber(flags, "input-budget") ?? 8000,
      promptMode: (flagString(flags, "prompt-mode") || "guided") as "guided" | "exact",
      enabled: true,
    }, requestOptions(flags));
  }
  if (action === "verdicts") {
    const verdictAction = args[1];
    const verdictKeyId = requiredText(args[2], "key ID");
    const verdictRef = { ...(projectId ? { projectId } : {}), keyId: verdictKeyId };
    if (verdictAction === "reset") {
      requireConfirmation(flags, "verdict customization reset");
      return client.keys.customization.resetVerdicts(verdictRef, requestOptions(flags));
    }
    if (verdictAction !== "save") throw usageError("Use keys customization verdicts save|reset.");
    const file = requiredText(flagString(flags, "file"), "--file");
    const config = await jsonFile(file);
    return client.keys.customization.saveVerdicts({ ...verdictRef, config: config as any }, requestOptions(flags));
  }
  throw usageError(`Unknown customization action "${action}".`);
}

function outputSuccess(command: string, result: any, context: CliContext) {
  if (context.json) { writeJson(context.writeOut, result); return; }
  if (command === "verify") {
    if (context.quiet) {
      const items = Array.isArray(result?.results) && result.results.length ? result.results : [result];
      context.writeOut(`${items.map((item: any) => item?.verdictId || "").filter(Boolean).join("\n")}\n`);
      return;
    }
    context.writeOut(humanVerify(result, context.color, context.timeUnit, context.verbose));
    return;
  }
  if (command === "doctor") {
    context.writeOut(`FactLens doctor\n${(result.checks || []).map((check: any) => `${check.ok ? "OK" : "WARN"}  ${check.name}${check.message ? ` — ${check.message}` : ""}`).join("\n")}\n`);
    return;
  }
  if (command === "projects" && result?.selectedProjectId) { context.writeOut(`Selected project: ${result.selectedProjectId}\n`); return; }
  if (command === "keys" && result?.api_key) { context.writeOut(`API key created. This secret is shown once.\n${result.api_key}\nStore it securely; FactLens cannot show it again.\n`); return; }
  context.writeOut(`${JSON.stringify(result, null, 2)}\n`);
}

function appendHumanVerifyResult(lines: string[], result: any, index?: number, color = false, verbose = false) {
  if (result?.claim) lines.push(index === undefined ? `Claim: ${result.claim}` : `Claim ${index + 1}: ${result.claim}`);
  if (result?.verdictId) {
    const id = String(result.verdictId);
    const colored = colorizeHex(id, result.verdictColor, color);
    const hex = String(result.verdictColor || "");
    lines.push(`Verdict: ${colored}${!color && /^#[0-9a-f]{6}$/i.test(hex) ? `  ${hex}` : ""}`);
  }
  if (result?.confidence) lines.push(`Confidence: ${result.confidence}`);
  if (result?.evidenceStrength) lines.push(`Evidence: ${result.evidenceStrength}`);
  if (result?.explanation) lines.push(`\n${result.explanation}`);
  if (Array.isArray(result?.sources) && result.sources.length) {
    lines.push("\nSources:");
    result.sources.forEach((source: any, sourceIndex: number) => {
      if (verbose) lines.push(`${sourceIndex + 1}. ${source.title ? `${source.title} — ` : ""}${source.url}`);
      else {
        let domain = source.url;
        try { domain = new URL(source.url).hostname.replace(/^www\./, ""); } catch {}
        lines.push(`${sourceIndex + 1}. ${source.title || domain}${source.title ? ` — ${domain}` : ""}`);
      }
    });
  }
}

function humanVerify(result: VerifyResponse, color = false, timeUnit: TimeUnit = "auto", verbose = false) {
  const claimCount = Number(result.claim_count || (Array.isArray(result.results) ? result.results.length : result.claim ? 1 : 0));
  const lines = [colorize(`FactLens verification complete${claimCount > 1 ? ` · ${claimCount} claims` : ""}`, 1, color)];
  const results = Array.isArray(result.results) && result.results.length ? result.results : null;
  if (results) results.forEach((item, index) => { if (index > 0) lines.push(""); appendHumanVerifyResult(lines, item, index, color, verbose); });
  else appendHumanVerifyResult(lines, result, undefined, color, verbose);
  if (Array.isArray(result.failed_claims) && result.failed_claims.length) {
    lines.push("\nFailed claims:");
    result.failed_claims.forEach((item: any, index: number) => lines.push(`${index + 1}. ${item.claim || "Unknown claim"} — ${item.error || item.message || "failed"}`));
  }
  if (!claimCount && result.message) lines.push(`\n${result.message}`);
  if (result.request_id) lines.push(`\nRequest ID: ${result.request_id}`);
  if (result.response_time_ms !== undefined) lines.push(`Response time: ${result.response_time_ms} ms`);
  const clientMs = Number((result as any).__clientElapsedMs);
  if (Number.isFinite(clientMs) || result.response_time_ms !== undefined) {
    const total = Number.isFinite(clientMs) ? formatDuration(clientMs, timeUnit) : "n/a";
    const server = result.response_time_ms === undefined ? "n/a" : formatDuration(result.response_time_ms, timeUnit);
    lines.push(`Timing: ${total} total · ${server} server`);
  }
  if (result.usage) lines.push(`Usage: ${JSON.stringify(result.usage)}`);
  return `${lines.join("\n")}\n`;
}

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
  ".heic": "image/heic",
  ".heif": "image/heif",
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
  const explicitMs = flagNumber(flags, "timeout");
  const timeoutSeconds = flagDecimal(flags, "timeout-seconds");
  if (explicitMs !== undefined && timeoutSeconds !== undefined) throw usageError("Use either --timeout (milliseconds) or --timeout-seconds, not both.");
  const maxRetries = flagNumber(flags, "retries");
  const requestId = flagString(flags, "request-id");
  return {
    ...(explicitMs !== undefined ? { timeout: explicitMs } : timeoutSeconds !== undefined ? { timeoutSeconds } : defaultTimeout === undefined ? {} : { timeout: defaultTimeout }),
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
  const booleanFlags = new Set(["json", "account", "yes", "help", "version", "no-trusted-domains", "no-blocked-domains", "quiet", "verbose"]);
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

function flagDecimal(flags: Flags, name: string) {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw usageError(`--${name} must be a positive number.`);
  return number;
}

function timeUnitFlag(flags: Flags): TimeUnit {
  const value = (flagString(flags, "time-unit") || "auto").toLowerCase();
  if (!["auto", "ms", "s"].includes(value)) throw usageError("--time-unit must be auto, ms, or s.");
  return value as TimeUnit;
}

async function verdictsFromFile(path: string | undefined) {
  if (!path) return undefined;
  const value = await jsonFile(path);
  if (!Array.isArray(value)) throw usageError("--verdicts-file must contain a JSON array of verdict definitions.");
  return value;
}

async function jsonFile(path: string) {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { throw usageError(`Could not read ${path}.`); }
  try { return JSON.parse(raw); } catch { throw usageError(`${path} must contain valid JSON.`); }
}

function monotonicNow() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function attachClientElapsed(result: VerifyResponse, startedAt: number) {
  Object.defineProperty(result, "__clientElapsedMs", { value: Math.max(0, monotonicNow() - startedAt), enumerable: false, configurable: true });
  return result;
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
  return `FactLens CLI ${SDK_VERSION}\n\nUsage:\n  factlens configure [--api-key KEY] [--developer-token TOKEN]\n  factlens config show|clear\n  factlens doctor\n  factlens verify <claim> [--trusted-domains a.com,b.com] [--blocked-domains c.com] [--json]\n  factlens verify --file claim.txt\n  factlens verify --image image.png [--claim "Optional claim"]\n  factlens verify --audio recording.mp3 [--claim "Optional claim"] [--speaker "Name"]\n  factlens verify --audio-url https://example.com/audio.mp3\n  factlens verify --transcript "Transcript text"\n  factlens verify --transcript-file transcript.txt\n  factlens list\n  factlens kill <job-id|all>\n  factlens usage [--account] [--project ID]\n  factlens account\n  factlens projects list\n  factlens projects create <name>\n  factlens projects update <project-id> <name>\n  factlens projects delete <project-id> --yes\n  factlens projects select <project-id>\n  factlens keys list [--project ID]\n  factlens keys create <label> [--project ID]\n  factlens keys revoke <key-id> [--project ID] --yes\n  factlens keys customization get <key-id> [--project ID]\n  factlens keys customization preferences <key-id> [--trusted-domains LIST] [--blocked-domains LIST]\n  factlens keys customization prompt save <key-id> --mode MODE --stage STAGE --instruction-file FILE [--input-budget 8000]\n  factlens keys customization prompt reset <key-id> --mode MODE --stage STAGE\n  factlens keys customization verdicts save <key-id> --file verdicts.json\n  factlens keys customization verdicts reset <key-id> --yes\n  factlens logs [--project ID] [--limit N] [--endpoint verify] [--status success|failed]\n  factlens request <request-id>\n\nSource preferences:\n  --trusted-domains LIST  Prioritize matching domains for this verification\n  --blocked-domains LIST  Exclude matching domains for this verification\n  --speaker NAME          Preserve speaker attribution for audio or transcript claims\n  --instructions TEXT       Request-scoped verification instruction\n  --search-query TEXT       Override the evidence search query\n  --results-per-search N    Search result count (1-50)\n  --verdicts-file FILE      Request-scoped verdict array, including optional colors\n  --no-trusted-domains      Override saved trusted domains with an empty list\n  --no-blocked-domains      Override saved blocked domains with an empty list\n\nLocal jobs:\n  factlens list           Show active local verification jobs and concurrency\n  factlens kill ID        Stop one local job by request ID prefix\n  factlens kill all       Stop every active local FactLens job\n\nRequest options:\n  --timeout MS          Total client timeout in milliseconds\n  --timeout-seconds SEC  Total client timeout in seconds\n  --time-unit auto|ms|s Display timing units\n  --retries N           Automatic retries (0-5)\n  --quiet               Print only verdict IDs\n  --verbose             Show full source URLs and diagnostics\n  --request-id UUID  Explicit idempotency/request ID\n  --json             Machine-readable output\n\nCredentials:\n  FACTLENS_API_KEY             Project key for Verify and runtime Usage\n  FACTLENS_DEVELOPER_TOKEN     Developer token for account management\n\nGet credentials: ${DASHBOARD}\n`;
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
