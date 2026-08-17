import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/cli/index.ts';
let source = await readFile(path, 'utf8');
const replace = (from, to, label) => {
  if (!source.includes(from)) throw new Error(`Missing CLI patch marker: ${label}`);
  source = source.replace(from, to);
};

replace(
  'import { colorize, createProgress, formatElapsed } from "./terminal.js";',
  'import { colorize, colorizeHex, createProgress, formatDuration, formatElapsed, type TimeUnit } from "./terminal.js";',
  'terminal import',
);

replace(
`  json: boolean;\n  jobsDir: string;`,
`  json: boolean;\n  quiet: boolean;\n  verbose: boolean;\n  timeUnit: TimeUnit;\n  jobsDir: string;`,
  'context fields',
);
replace(
`    json: flagBoolean(parsed.flags, "json"),\n    jobsDir: dependencies.jobsDir ?? join(dirname(configFile), "jobs"),`,
`    json: flagBoolean(parsed.flags, "json"),\n    quiet: flagBoolean(parsed.flags, "quiet"),\n    verbose: flagBoolean(parsed.flags, "verbose"),\n    timeUnit: timeUnitFlag(parsed.flags),\n    jobsDir: dependencies.jobsDir ?? join(dirname(configFile), "jobs"),`,
  'context values',
);

source = source.replace(
  /async function verifyCommand\([\s\S]*?\n}\n\nfunction progressJobState/,
`async function verifyCommand(client: FactLens, positionals: string[], flags: Flags, context: CliContext, resolvedConfig: ReturnType<typeof resolveCredentials>): Promise<VerifyResponse> {
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
    if (text.length > MAX_TEXT_CHARS) throw usageError(\`Text input exceeds \${MAX_TEXT_CHARS.toLocaleString()} characters.\`);
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
    if (!resolvedConfig.apiKey) throw new FactLensConfigurationError(\`A FactLens project API key is required. Get one from \${DASHBOARD}.\`);
    mode = "audio_video";
    await registerJob(context.jobsDir, { id: requestId, requestId, pid: context.pid, mode, state: "uploading", startedAt: Date.now(), ...(speaker ? { speaker } : {}) });
    const interactive = !context.json && Boolean(context.stdout.isTTY);
    const progress = createProgress(context.writeErr, interactive, context.color, context.progressIntervalMs, "audio");
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
      const result = await client.verify(pollInput, { ...requestOptions(flags, 1_800_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); void updateJob(context.jobsDir, requestId, { state: mapped }); progress.update(progressLabel(event.state)); } });
      return attachClientElapsed(result, startedAt);
    } finally {
      progress.stop();
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
    if (claim.length > MAX_TEXT_CHARS) throw usageError(\`Claim exceeds \${MAX_TEXT_CHARS.toLocaleString()} characters.\`);
    mode = "text";
    input = { mode, claim, ...common };
  }

  await registerJob(context.jobsDir, { id: requestId, requestId, pid: context.pid, mode, state: "verifying", startedAt: Date.now(), ...(speaker ? { speaker } : {}) });
  const progressMode = mode === "image_post" ? "image" : mode === "audio_video" ? "audio" : "text";
  const interactive = !context.json && Boolean(context.stdout.isTTY);
  const progress = createProgress(context.writeErr, interactive, context.color, context.progressIntervalMs, progressMode);
  progress.start(mode === "image_post" ? "Verifying image" : "Verifying");
  try {
    const result = await client.verify(input, { ...requestOptions(flags, mode === "audio_video" ? 1_800_000 : 180_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); void updateJob(context.jobsDir, requestId, { state: mapped }); progress.update(progressLabel(event.state)); } });
    return attachClientElapsed(result, startedAt);
  } finally {
    progress.stop();
    await removeJob(context.jobsDir, requestId);
  }
}

function progressJobState`,
);

source = source.replace(
  /async function keysCommand\([\s\S]*?\n}\n\nfunction outputSuccess/,
`async function keysCommand(client: FactLens, args: string[], flags: Flags) {
  const action = args[0] || "list";
  const project = projectInput(flags);
  if (action === "list") return client.keys.list(project, requestOptions(flags));
  if (action === "create") return client.keys.create({ ...project, label: requiredText(args.slice(1).join(" "), "key label") }, requestOptions(flags));
  if (action === "revoke") {
    requireConfirmation(flags, "API key revocation");
    return client.keys.revoke({ ...project, keyId: requiredText(args[1], "key ID") }, requestOptions(flags));
  }
  if (action === "customization") return keysCustomizationCommand(client, args.slice(1), flags);
  throw usageError(\`Unknown keys action "\${action}".\`);
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
  throw usageError(\`Unknown customization action "\${action}".\`);
}

function outputSuccess`,
);

source = source.replace(
  /function outputSuccess\([\s\S]*?\n}\n\nasync function mediaFile/,
`function outputSuccess(command: string, result: any, context: CliContext) {
  if (context.json) { writeJson(context.writeOut, result); return; }
  if (command === "verify") {
    if (context.quiet) {
      const items = Array.isArray(result?.results) && result.results.length ? result.results : [result];
      context.writeOut(\`${items.map((item: any) => item?.verdictId || "").filter(Boolean).join("\\n")}\\n\`);
      return;
    }
    context.writeOut(humanVerify(result, context.color, context.timeUnit, context.verbose));
    return;
  }
  if (command === "doctor") {
    context.writeOut(\`FactLens doctor\\n\${(result.checks || []).map((check: any) => \`\${check.ok ? "OK" : "WARN"}  \${check.name}\${check.message ? \` — \${check.message}\` : ""}\`).join("\\n")}\\n\`);
    return;
  }
  if (command === "projects" && result?.selectedProjectId) { context.writeOut(\`Selected project: \${result.selectedProjectId}\\n\`); return; }
  if (command === "keys" && result?.api_key) { context.writeOut(\`API key created. This secret is shown once.\\n\${result.api_key}\\nStore it securely; FactLens cannot show it again.\\n\`); return; }
  context.writeOut(\`${JSON.stringify(result, null, 2)}\\n\`);
}

function appendHumanVerifyResult(lines: string[], result: any, index?: number, color = false, verbose = false) {
  if (result?.claim) lines.push(index === undefined ? \`Claim: \${result.claim}\` : \`Claim \${index + 1}: \${result.claim}\`);
  if (result?.verdictId) {
    const id = String(result.verdictId);
    const colored = colorizeHex(id, result.verdictColor, color);
    const fallbackColor = !color && /^#[0-9a-f]{6}$/i.test(String(result.verdictColor || "")) ? \`  \${result.verdictColor}\` : "";
    lines.push(\`Verdict: \${colored}\${fallbackColor}\`);
  }
  if (result?.confidence) lines.push(\`Confidence: \${result.confidence}\`);
  if (result?.evidenceStrength) lines.push(\`Evidence: \${result.evidenceStrength}\`);
  if (result?.explanation) lines.push(\`\\n\${result.explanation}\`);
  if (Array.isArray(result?.sources) && result.sources.length) {
    lines.push("\\nSources:");
    result.sources.forEach((source: any, sourceIndex: number) => {
      if (verbose) lines.push(\`\${sourceIndex + 1}. \${source.title ? \`\${source.title} — \` : ""}\${source.url}\`);
      else {
        let domain = source.url;
        try { domain = new URL(source.url).hostname.replace(/^www\\./, ""); } catch {}
        lines.push(\`\${sourceIndex + 1}. \${source.title || domain}\${source.title ? \` — \${domain}\` : ""}\`);
      }
    });
  }
}

function humanVerify(result: VerifyResponse, color = false, timeUnit: TimeUnit = "auto", verbose = false) {
  const claimCount = Number(result.claim_count || (Array.isArray(result.results) ? result.results.length : result.claim ? 1 : 0));
  const lines = [colorize(\`FactLens verification complete\${claimCount > 1 ? \` · \${claimCount} claims\` : ""}\`, 1, color)];
  const results = Array.isArray(result.results) && result.results.length ? result.results : null;
  if (results) results.forEach((item, index) => { if (index > 0) lines.push(""); appendHumanVerifyResult(lines, item, index, color, verbose); });
  else appendHumanVerifyResult(lines, result, undefined, color, verbose);
  if (Array.isArray(result.failed_claims) && result.failed_claims.length) {
    lines.push("\\nFailed claims:");
    result.failed_claims.forEach((item: any, index: number) => lines.push(\`\${index + 1}. \${item.claim || "Unknown claim"} — \${item.error || item.message || "failed"}\`));
  }
  if (!claimCount && result.message) lines.push(\`\\n\${result.message}\`);
  if (result.request_id) lines.push(\`\\nRequest ID: \${result.request_id}\`);
  if (result.response_time_ms !== undefined) lines.push(\`Response time: \${result.response_time_ms} ms\`);
  const clientMs = Number((result as any).__clientElapsedMs);
  if (Number.isFinite(clientMs) || result.response_time_ms !== undefined) {
    const total = Number.isFinite(clientMs) ? formatDuration(clientMs, timeUnit) : "n/a";
    const server = result.response_time_ms === undefined ? "n/a" : formatDuration(result.response_time_ms, timeUnit);
    lines.push(\`Timing: \${total} total · \${server} server\`);
  }
  if (result.usage) lines.push(\`Usage: \${JSON.stringify(result.usage)}\`);
  return \`\${lines.join("\\n")}\\n\`;
}

async function mediaFile`,
);

replace(
`const imageTypes: Record<string, string> = {\n  ".png": "image/png",\n  ".jpg": "image/jpeg",\n  ".jpeg": "image/jpeg",\n  ".webp": "image/webp",\n  ".gif": "image/gif",\n};`,
`const imageTypes: Record<string, string> = {\n  ".png": "image/png",\n  ".jpg": "image/jpeg",\n  ".jpeg": "image/jpeg",\n  ".webp": "image/webp",\n  ".heic": "image/heic",\n  ".heif": "image/heif",\n};`,
  'image formats',
);

source = source.replace(
  /function requestOptions\([\s\S]*?\n}\n\nfunction projectInput/,
`function requestOptions(flags: Flags, defaultTimeout?: number): RequestOptions {
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

function projectInput`,
);

replace(
  '  const booleanFlags = new Set(["json", "account", "yes", "help", "version"]);',
  '  const booleanFlags = new Set(["json", "account", "yes", "help", "version", "no-trusted-domains", "no-blocked-domains", "quiet", "verbose"]);',
  'boolean flags',
);

replace(
`function flagNumber(flags: Flags, name: string) {\n  const value = flagString(flags, name);\n  if (value === undefined) return undefined;\n  const number = Number(value);\n  if (!Number.isFinite(number) || number < 0) throw usageError(\`--\${name} must be a non-negative number.\`);\n  return Math.floor(number);\n}`,
`function flagNumber(flags: Flags, name: string) {\n  const value = flagString(flags, name);\n  if (value === undefined) return undefined;\n  const number = Number(value);\n  if (!Number.isFinite(number) || number < 0) throw usageError(\`--\${name} must be a non-negative number.\`);\n  return Math.floor(number);\n}\n\nfunction flagDecimal(flags: Flags, name: string) {\n  const value = flagString(flags, name);\n  if (value === undefined) return undefined;\n  const number = Number(value);\n  if (!Number.isFinite(number) || number <= 0) throw usageError(\`--\${name} must be a positive number.\`);\n  return number;\n}\n\nfunction timeUnitFlag(flags: Flags): TimeUnit {\n  const value = (flagString(flags, "time-unit") || "auto").toLowerCase();\n  if (!["auto", "ms", "s"].includes(value)) throw usageError("--time-unit must be auto, ms, or s.");\n  return value as TimeUnit;\n}\n\nasync function verdictsFromFile(path: string | undefined) {\n  if (!path) return undefined;\n  const value = await jsonFile(path);\n  if (!Array.isArray(value)) throw usageError("--verdicts-file must contain a JSON array of verdict definitions.");\n  return value;\n}\n\nasync function jsonFile(path: string) {\n  let raw: string;\n  try { raw = await readFile(path, "utf8"); } catch { throw usageError(\`Could not read \${path}.\`); }\n  try { return JSON.parse(raw); } catch { throw usageError(\`\${path} must contain valid JSON.\`); }\n}\n\nfunction monotonicNow() {\n  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();\n}\n\nfunction attachClientElapsed(result: VerifyResponse, startedAt: number) {\n  Object.defineProperty(result, "__clientElapsedMs", { value: Math.max(0, monotonicNow() - startedAt), enumerable: false, configurable: true });\n  return result;\n}`,
  'numeric helpers',
);

replace(
  '  factlens verify --audio recording.mp3 [--claim "Optional claim"] [--speaker "Name"]\\n',
  '  factlens verify --audio recording.mp3 [--claim "Optional claim"] [--speaker "Name"]\\n  factlens verify --audio-url https://example.com/audio.mp3\\n  factlens verify --transcript "Transcript text"\\n  factlens verify --transcript-file transcript.txt\\n',
  'verify help inputs',
);
replace(
  '  factlens keys revoke <key-id> [--project ID] --yes\\n',
  '  factlens keys revoke <key-id> [--project ID] --yes\\n  factlens keys customization get <key-id> [--project ID]\\n  factlens keys customization preferences <key-id> [--trusted-domains LIST] [--blocked-domains LIST]\\n  factlens keys customization prompt save <key-id> --mode MODE --stage STAGE --instruction-file FILE [--input-budget 8000]\\n  factlens keys customization prompt reset <key-id> --mode MODE --stage STAGE\\n  factlens keys customization verdicts save <key-id> --file verdicts.json\\n  factlens keys customization verdicts reset <key-id> --yes\\n',
  'customization help',
);
replace(
  '  --speaker NAME          Preserve speaker attribution for audio or transcript claims\\n',
  '  --speaker NAME          Preserve speaker attribution for audio or transcript claims\\n  --instructions TEXT       Request-scoped verification instruction\\n  --search-query TEXT       Override the evidence search query\\n  --results-per-search N    Search result count (1-50)\\n  --verdicts-file FILE      Request-scoped verdict array, including optional colors\\n  --no-trusted-domains      Override saved trusted domains with an empty list\\n  --no-blocked-domains      Override saved blocked domains with an empty list\\n',
  'source help',
);
replace(
  '  --timeout MS       Total client timeout\\n  --retries N        Automatic retries (0-5)\\n',
  '  --timeout MS          Total client timeout in milliseconds\\n  --timeout-seconds SEC  Total client timeout in seconds\\n  --time-unit auto|ms|s Display timing units\\n  --retries N           Automatic retries (0-5)\\n  --quiet               Print only verdict IDs\\n  --verbose             Show full source URLs and diagnostics\\n',
  'request help',
);

await writeFile(path, source, 'utf8');
console.log('Applied FactLens CLI v6.5.0 source transformation.');
