#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import FactLens from "../client.js";
import { FactLensConfigurationError } from "../errors.js";
import { SDK_VERSION } from "../http.js";
import type { RequestOptions, VerifyInput, VerifyResponse } from "../types/index.js";
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
};

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const parsed = parseArgs(argv);
  const context: CliContext = {
    env: dependencies.env ?? process.env,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    configFile: dependencies.configFile ?? configPath({ env: dependencies.env ?? process.env }),
    writeOut: dependencies.writeOut ?? ((value) => process.stdout.write(value)),
    writeErr: dependencies.writeErr ?? ((value) => process.stderr.write(value)),
    stdin: dependencies.stdin ?? process.stdin,
    stdout: dependencies.stdout ?? process.stdout,
    json: flagBoolean(parsed.flags, "json"),
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
        result = await verifyCommand(client, parsed.positionals.slice(1), parsed.flags);
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
      case "logs":
        result = await client.logs.list({
          ...projectInput(parsed.flags),
          ...(flagNumber(parsed.flags, "limit") === undefined ? {} : { limit: flagNumber(parsed.flags, "limit") }),
          ...(flagString(parsed.flags, "before") ? { before: flagString(parsed.flags, "before") } : {}),
          ...(flagString(parsed.flags, "endpoint") ? { endpoint: flagString(parsed.flags, "endpoint") } : {}),
          ...(logStatus(parsed.flags) ? { status: logStatus(parsed.flags) } : {}),
        }, requestOptions(parsed.flags));
        break;
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
    else context.writeErr(humanError(error));
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

async function verifyCommand(client: FactLens, positionals: string[], flags: Flags): Promise<VerifyResponse> {
  const file = flagString(flags, "file");
  const image = flagString(flags, "image");
  const audio = flagString(flags, "audio");
  const explicitInputs = [file, image, audio].filter(Boolean);
  if (explicitInputs.length > 1) throw usageError("Use only one of --file, --image, or --audio for a verification request.");

  let input: VerifyInput;
  if (file) {
    const text = (await readFile(file, "utf8")).trim();
    if (!text) throw usageError("The text file is empty.");
    if (text.length > MAX_TEXT_CHARS) throw usageError(`Text input exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    input = { mode: "text", claim: text };
  } else if (image) {
    const claim = requiredText(flagString(flags, "claim") || positionals.join(" "), "claim");
    const media = await mediaFile(image, "image");
    input = { mode: "image_post", claim, image_base64: media.base64, content_type: media.contentType };
  } else if (audio) {
    const media = await mediaFile(audio, "audio");
    const claim = clean(flagString(flags, "claim") || positionals.join(" "));
    input = { mode: "audio_video", audio_base64: media.base64, content_type: media.contentType, ...(claim ? { claim } : {}) };
  } else {
    const claim = requiredText(flagString(flags, "claim") || positionals.join(" "), "claim");
    if (claim.length > MAX_TEXT_CHARS) throw usageError(`Claim exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters.`);
    input = { mode: "text", claim };
  }
  return client.verify(input, requestOptions(flags, audio ? 180_000 : 60_000));
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
    context.writeOut(humanVerify(result));
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

function humanVerify(result: VerifyResponse) {
  const lines = ["FactLens verification complete"];
  if (result.claim) lines.push(`Claim: ${result.claim}`);
  if (result.verdictId) lines.push(`Verdict: ${result.verdictId}`);
  if (result.confidence) lines.push(`Confidence: ${result.confidence}`);
  if (result.evidenceStrength) lines.push(`Evidence: ${result.evidenceStrength}`);
  if (result.explanation) lines.push(`\n${result.explanation}`);
  if (Array.isArray(result.sources) && result.sources.length) {
    lines.push("\nSources:");
    result.sources.forEach((source, index) => lines.push(`${index + 1}. ${source.title ? `${source.title} — ` : ""}${source.url}`));
  }
  if (result.request_id) lines.push(`\nRequest ID: ${result.request_id}`);
  if (result.response_time_ms !== undefined) lines.push(`Response time: ${result.response_time_ms} ms`);
  if (result.usage) lines.push(`Usage: ${JSON.stringify(result.usage)}`);
  return `${lines.join("\n")}\n`;
}

async function mediaFile(path: string, kind: "image" | "audio") {
  const extension = extname(path).toLowerCase();
  const contentType = kind === "image" ? imageTypes[extension] : audioTypes[extension];
  if (!contentType) throw usageError(`Unsupported ${kind} file type "${extension || "unknown"}".`);
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
  return `FactLens CLI ${SDK_VERSION}\n\nUsage:\n  factlens configure [--api-key KEY] [--developer-token TOKEN]\n  factlens config show|clear\n  factlens doctor\n  factlens verify <claim> [--json]\n  factlens verify --file claim.txt\n  factlens verify --image image.png --claim "Claim about the image"\n  factlens verify --audio recording.mp3 [--claim "Optional claim"]\n  factlens usage [--account] [--project ID]\n  factlens account\n  factlens projects list\n  factlens projects create <name>\n  factlens projects update <project-id> <name>\n  factlens projects delete <project-id> --yes\n  factlens projects select <project-id>\n  factlens keys list [--project ID]\n  factlens keys create <label> [--project ID]\n  factlens keys revoke <key-id> [--project ID] --yes\n  factlens logs [--project ID] [--limit N] [--endpoint verify] [--status success|failed]\n  factlens request <request-id>\n\nRequest options:\n  --timeout MS       Total client timeout\n  --retries N        Automatic retries (0-5)\n  --request-id UUID  Explicit idempotency/request ID\n  --json             Machine-readable output\n\nCredentials:\n  FACTLENS_API_KEY             Project key for Verify and runtime Usage\n  FACTLENS_DEVELOPER_TOKEN     Developer token for account management\n\nGet credentials: ${DASHBOARD}\n`;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(humanError(error));
    process.exitCode = exitCodeFor(error);
  });
}
