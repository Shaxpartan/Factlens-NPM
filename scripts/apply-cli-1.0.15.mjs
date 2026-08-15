import { readFile, writeFile, rename } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}
function once(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`Ambiguous ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

await edit('package.json', (s) => once(s, '"version": "1.0.11"', '"version": "1.0.15"', 'package version'));
await edit('package-lock.json', (s) => {
  let out = s;
  out = once(out, '"version": "1.0.11"', '"version": "1.0.15"', 'lock root version');
  out = once(out, '"version": "1.0.11"', '"version": "1.0.15"', 'lock package version');
  return out;
});

await edit('src/types/index.ts', (s) => {
  let out = s;
  out = once(out,
    'export type RequestOptions = {\n  signal?: AbortSignal;\n  timeout?: number;\n  requestId?: string;\n  maxRetries?: number;\n};',
    'export type VerifyProgressState = "sending" | "waiting" | "transcribing" | "retrying" | "complete";\n\nexport type VerifyProgress = {\n  state: VerifyProgressState;\n  elapsedMs: number;\n  requestId?: string;\n  attempt: number;\n};\n\nexport type RequestOptions = {\n  signal?: AbortSignal;\n  timeout?: number;\n  requestId?: string;\n  maxRetries?: number;\n  onProgress?: (progress: VerifyProgress) => void;\n};',
    'request progress types');
  out = once(out,
    '  transcript?: string;\n  audio_base64?: string;',
    '  transcript?: string;\n  speaker?: string;\n  audio_base64?: string;\n  audio_url?: string;',
    'speaker audio url types');
  return out;
});

await edit('src/http.ts', (s) => {
  let out = once(s, 'export const SDK_VERSION = "1.0.11";', 'export const SDK_VERSION = "1.0.15";', 'SDK version');
  out = once(out,
    '    const deadline = Date.now() + timeout;\n    const requestId = resolveRequestId(options.requestId, Boolean(request.automaticRequestId));',
    '    const startedAt = Date.now();\n    const deadline = startedAt + timeout;\n    const requestId = resolveRequestId(options.requestId, Boolean(request.automaticRequestId));\n    const progress = (state: "sending" | "waiting" | "transcribing" | "retrying" | "complete") => { try { options.onProgress?.({ state, elapsedMs: Math.max(0, Date.now() - startedAt), ...(requestId ? { requestId } : {}), attempt }); } catch {} };',
    'progress setup');
  out = once(out,
    '      let response: Response;\n      try {\n        response = await this.fetch',
    '      let response: Response;\n      progress(attempt > 0 ? "retrying" : "sending");\n      try {\n        response = await this.fetch',
    'progress before fetch');
  out = once(out,
    '          if (reconnectOnWindowExpiry && Date.now() < deadline) continue;',
    '          if (reconnectOnWindowExpiry && Date.now() < deadline) { progress("waiting"); continue; }',
    'reconnect progress');
  out = once(out,
    '      const body = await responseBody(response);\n      if (response.ok) return body as T;',
    '      const body = await responseBody(response);\n      if (response.ok) { progress("complete"); return body as T; }',
    'complete progress');
  out = once(out,
    '      if (response.status === 409 && code === "REQUEST_IN_PROGRESS" && requestId) {\n        const wait = retryDelay(response.headers.get("retry-after"), 0);',
    '      if (response.status === 409 && code === "REQUEST_IN_PROGRESS" && requestId) {\n        progress(textValue(errorBody.stage) === "transcription" ? "transcribing" : "waiting");\n        const wait = retryDelay(response.headers.get("retry-after"), 0);',
    '409 progress');
  out = once(out,
    '      if (retryable && attempt < maxRetries) {\n        await delay',
    '      if (retryable && attempt < maxRetries) {\n        progress("retrying");\n        await delay',
    'retry progress');
  out = once(out,
    '  return Math.min(maximum, Math.max(minimum, Math.floor(number)));',
    '  return Math.min(maximum, Math.max(minimum, Math.floor(number)));',
    'bounded integer guard');
  out = once(out,
    '    const timeout = boundedInteger(options.timeout, request.timeout, 1, 600_000);',
    '    const timeout = boundedInteger(options.timeout, request.timeout, 1, 1_800_000);',
    'transport max timeout');
  return out;
});

await edit('src/client.ts', (s) => once(s, '      timeout: 180_000,', '      timeout: 1_800_000,', 'verify timeout'));

await edit('src/cli/jobs.ts', (s) => {
  let out = once(s,
    'export type CliJobState = "preparing" | "verifying" | "waiting" | "retrying";',
    'export type CliJobState = "preparing" | "uploading" | "transcribing" | "verifying" | "waiting" | "retrying";',
    'job state union');
  out = once(out,
    '    if (!["preparing", "verifying", "waiting", "retrying"].includes(value.state)) return null;',
    '    if (!["preparing", "uploading", "transcribing", "verifying", "waiting", "retrying"].includes(value.state)) return null;',
    'job state validation');
  return out;
});

await edit('src/cli/index.ts', (input) => {
  let s = input;
  s = once(s,
    'import { readFile } from "node:fs/promises";\nimport { basename, extname } from "node:path";',
    'import { randomUUID } from "node:crypto";\nimport { readFile } from "node:fs/promises";\nimport { basename, dirname, extname, join } from "node:path";',
    'CLI node imports');
  s = once(s,
    'import { FactLensConfigurationError } from "../errors.js";',
    'import { FactLensConfigurationError } from "../errors.js";\nimport { startAudioUpload } from "./audio.js";\nimport { killJobs, listJobs, registerJob, removeJob, updateJob, type CliJobState } from "./jobs.js";\nimport { colorize, createProgress, formatElapsed } from "./terminal.js";',
    'CLI feature imports');
  s = once(s,
    '  stdout?: NodeJS.WriteStream;\n};',
    '  stdout?: NodeJS.WriteStream;\n  jobsDir?: string;\n  color?: boolean;\n  progressIntervalMs?: number;\n  pid?: number;\n  audioUploadUrl?: string;\n};',
    'CLI dependency fields');
  s = once(s,
    '  stdout: NodeJS.WriteStream;\n  json: boolean;\n};',
    '  stdout: NodeJS.WriteStream;\n  json: boolean;\n  jobsDir: string;\n  color: boolean;\n  progressIntervalMs: number;\n  pid: number;\n  audioUploadUrl?: string;\n};',
    'CLI context fields');
  const oldContext = `  const parsed = parseArgs(argv);\n  const context: CliContext = {\n    env: dependencies.env ?? process.env,\n    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),\n    configFile: dependencies.configFile ?? configPath({ env: dependencies.env ?? process.env }),\n    writeOut: dependencies.writeOut ?? ((value) => process.stdout.write(value)),\n    writeErr: dependencies.writeErr ?? ((value) => process.stderr.write(value)),\n    stdin: dependencies.stdin ?? process.stdin,\n    stdout: dependencies.stdout ?? process.stdout,\n    json: flagBoolean(parsed.flags, "json"),\n  };`;
  const newContext = `  const parsed = parseArgs(argv);\n  const env = dependencies.env ?? process.env;\n  const configFile = dependencies.configFile ?? configPath({ env });\n  const stdout = dependencies.stdout ?? process.stdout;\n  const context: CliContext = {\n    env,\n    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),\n    configFile,\n    writeOut: dependencies.writeOut ?? ((value) => process.stdout.write(value)),\n    writeErr: dependencies.writeErr ?? ((value) => process.stderr.write(value)),\n    stdin: dependencies.stdin ?? process.stdin,\n    stdout,\n    json: flagBoolean(parsed.flags, "json"),\n    jobsDir: dependencies.jobsDir ?? join(dirname(configFile), "jobs"),\n    color: dependencies.color ?? Boolean(stdout.isTTY && !("NO_COLOR" in env)),\n    progressIntervalMs: dependencies.progressIntervalMs ?? 120,\n    pid: dependencies.pid ?? process.pid,\n    ...(dependencies.audioUploadUrl ? { audioUploadUrl: dependencies.audioUploadUrl } : {}),\n  };`;
  s = once(s, oldContext, newContext, 'CLI context construction');
  s = once(s,
    '    if (command === "configure") return configureCommand(parsed.flags, context);\n    if (command === "config") return configCommand(parsed.positionals.slice(1), context);',
    '    if (command === "configure") return configureCommand(parsed.flags, context);\n    if (command === "config") return configCommand(parsed.positionals.slice(1), context);\n    if (command === "list") return listCommand(context);\n    if (command === "kill") return killCommand(parsed.positionals.slice(1), context);',
    'local job commands');
  s = once(s,
    '        result = await verifyCommand(client, parsed.positionals.slice(1), parsed.flags);',
    '        result = await verifyCommand(client, parsed.positionals.slice(1), parsed.flags, context, resolvedConfig);',
    'verify call');
  s = once(s,
    '    else context.writeErr(humanError(error));',
    '    else context.writeErr(colorize(humanError(error), 31, context.color));',
    'colored errors');

  const verifyStart = s.indexOf('async function verifyCommand(');
  const verifyEnd = s.indexOf('\nasync function projectsCommand', verifyStart);
  if (verifyStart < 0 || verifyEnd < 0) throw new Error('Missing verifyCommand block');
  const verifyBlock = `async function verifyCommand(client: FactLens, positionals: string[], flags: Flags, context: CliContext, resolvedConfig: ReturnType<typeof resolveCredentials>): Promise<VerifyResponse> {\n  const file = flagString(flags, "file");\n  const image = flagString(flags, "image");\n  const audio = flagString(flags, "audio");\n  const explicitInputs = [file, image, audio].filter(Boolean);\n  if (explicitInputs.length > 1) throw usageError("Use only one of --file, --image, or --audio for a verification request.");\n\n  const trustedDomains = domainListFlag(flags, "trusted-domains");\n  const blockedDomains = domainListFlag(flags, "blocked-domains");\n  const speaker = clean(flagString(flags, "speaker"));\n  const requestId = flagString(flags, "request-id") || randomUUID();\n  const common = { ...(trustedDomains.length ? { trusted_domains: trustedDomains } : {}), ...(blockedDomains.length ? { blocked_domains: blockedDomains } : {}) };\n\n  let input: VerifyInput;\n  let mode: VerifyInput["mode"];\n  if (file) {\n    const text = (await readFile(file, "utf8")).trim();\n    if (!text) throw usageError("The text file is empty.");\n    if (text.length > MAX_TEXT_CHARS) throw usageError(\`Text input exceeds \${MAX_TEXT_CHARS.toLocaleString()} characters.\`);\n    mode = "text";\n    input = { mode, claim: text, ...common };\n  } else if (image) {\n    const claim = requiredText(flagString(flags, "claim") || positionals.join(" "), "claim");\n    const media = await mediaFile(image, "image");\n    mode = "image_post";\n    input = { mode, claim, image_base64: media.base64, content_type: media.contentType, ...common };\n  } else if (audio) {\n    const contentType = audioContentType(audio);\n    const claim = clean(flagString(flags, "claim") || positionals.join(" "));\n    if (!resolvedConfig.apiKey) throw new FactLensConfigurationError(\`A FactLens project API key is required. Get one from \${DASHBOARD}.\`);\n    mode = "audio_video";\n    await registerJob(context.jobsDir, { id: requestId, requestId, pid: context.pid, mode, state: "uploading", startedAt: Date.now(), ...(speaker ? { speaker } : {}) });\n    const progress = createProgress(context.writeErr, !context.json, context.color, context.progressIntervalMs);\n    progress.start("Uploading audio");\n    try {\n      await startAudioUpload({ path: audio, contentType, apiKey: resolvedConfig.apiKey, requestId, language: flagString(flags, "language") || "auto", runtimeBaseUrl: resolvedConfig.runtimeBaseUrl, audioUploadUrl: context.audioUploadUrl || context.env.FACTLENS_AUDIO_UPLOAD_URL, fetch: context.fetch });\n      await updateJob(context.jobsDir, requestId, { state: "transcribing" });\n      progress.update("Transcribing audio");\n      const pollInput = { mode, audio_job: true, ...(claim ? { claim } : {}), ...(speaker ? { speaker } : {}), ...common } as VerifyInput & { audio_job: true };\n      return await client.verify(pollInput, { ...requestOptions(flags, 1_800_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); void updateJob(context.jobsDir, requestId, { state: mapped }); progress.update(progressLabel(event.state)); } });\n    } finally {\n      progress.stop();\n      await removeJob(context.jobsDir, requestId);\n    }\n  } else {\n    const claim = requiredText(flagString(flags, "claim") || positionals.join(" "), "claim");\n    if (claim.length > MAX_TEXT_CHARS) throw usageError(\`Claim exceeds \${MAX_TEXT_CHARS.toLocaleString()} characters.\`);\n    mode = "text";\n    input = { mode, claim, ...common };\n  }\n\n  await registerJob(context.jobsDir, { id: requestId, requestId, pid: context.pid, mode, state: "verifying", startedAt: Date.now(), ...(speaker ? { speaker } : {}) });\n  const progress = createProgress(context.writeErr, !context.json, context.color, context.progressIntervalMs);\n  progress.start("Verifying");\n  try {\n    return await client.verify(input, { ...requestOptions(flags, 180_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); void updateJob(context.jobsDir, requestId, { state: mapped }); progress.update(progressLabel(event.state)); } });\n  } finally {\n    progress.stop();\n    await removeJob(context.jobsDir, requestId);\n  }\n}\n\nfunction progressJobState(state: string): CliJobState {\n  if (state === "transcribing") return "transcribing";\n  if (state === "waiting") return "waiting";\n  if (state === "retrying") return "retrying";\n  return "verifying";\n}\n\nfunction progressLabel(state: string) {\n  if (state === "transcribing") return "Transcribing audio";\n  if (state === "waiting") return "Waiting for FactLens";\n  if (state === "retrying") return "Reconnecting";\n  if (state === "complete") return "Complete";\n  return "Verifying";\n}\n\nasync function listCommand(context: CliContext) {\n  const jobs = await listJobs(context.jobsDir);\n  const now = Date.now();\n  const view = jobs.map((job) => ({ ...job, elapsed_ms: Math.max(0, now - job.startedAt) }));\n  if (context.json) { writeJson(context.writeOut, { concurrency: jobs.length, jobs: view }); return 0; }\n  if (!jobs.length) { context.writeOut(\`\${colorize("FactLens", 36, context.color)} has no active local jobs.\\n\`); return 0; }\n  const lines = [\`\${colorize("FactLens active jobs", 1, context.color)}  \${colorize(\`Concurrency \${jobs.length}\`, 36, context.color)}\`];\n  for (const job of jobs) {\n    const state = colorize(job.state.toUpperCase(), stateColor(job.state), context.color);\n    lines.push(\`\${job.id.slice(0, 8)}  PID \${job.pid}  \${job.mode}  \${state}  \${formatElapsed(now - job.startedAt)}\${job.speaker ? \`  speaker: \${job.speaker}\` : ""}\`);\n  }\n  context.writeOut(\`\${lines.join("\\n")}\\n\`);\n  return 0;\n}\n\nasync function killCommand(args: string[], context: CliContext) {\n  const target = requiredText(args[0], "job ID or all");\n  const killed = await killJobs(context.jobsDir, target);\n  if (!killed.length) throw usageError(\`No active FactLens job matches "\${target}".\`);\n  if (context.json) { writeJson(context.writeOut, { killed: killed.map((job) => ({ id: job.id, pid: job.pid })) }); return 0; }\n  context.writeOut(colorize(\`Stopped \${killed.length} FactLens job\${killed.length === 1 ? "" : "s"}.\\n\`, 33, context.color));\n  return 0;\n}\n\nfunction stateColor(state: CliJobState) {\n  if (state === "retrying") return 33;\n  if (state === "transcribing" || state === "uploading") return 36;\n  if (state === "waiting") return 35;\n  return 32;\n}\n\nfunction audioContentType(path: string) {\n  const extension = extname(path).toLowerCase();\n  const contentType = audioTypes[extension];\n  if (!contentType) throw usageError(\`Unsupported audio file type "\${extension || "unknown"}.\`);\n  return contentType;\n}\n`;
  s = s.slice(0, verifyStart) + verifyBlock + s.slice(verifyEnd);

  s = once(s,
    'function outputSuccess(command: string, result: any, context: CliContext) {',
    'function outputSuccess(command: string, result: any, context: CliContext) {',
    'output guard');
  s = once(s,
    '    context.writeOut(humanVerify(result));',
    '    context.writeOut(humanVerify(result, context.color));',
    'colored verify output');
  s = once(s,
    'function appendHumanVerifyResult(lines: string[], result: any, index?: number) {\n  if (result?.claim) lines.push(index === undefined ? `Claim: ${result.claim}` : `Claim ${index + 1}: ${result.claim}`);\n  if (result?.verdictId) lines.push(`Verdict: ${result.verdictId}`);',
    'function appendHumanVerifyResult(lines: string[], result: any, index?: number, color = false) {\n  if (result?.claim) lines.push(index === undefined ? `Claim: ${result.claim}` : `Claim ${index + 1}: ${result.claim}`);\n  if (result?.verdictId) lines.push(`Verdict: ${colorize(String(result.verdictId), verdictColor(String(result.verdictId)), color)}`);',
    'colored result function');
  s = once(s,
    'function humanVerify(result: VerifyResponse) {\n  const lines = ["FactLens verification complete"];',
    'function humanVerify(result: VerifyResponse, color = false) {\n  const lines = [colorize("FactLens verification complete", 1, color)];',
    'human verify signature');
  s = once(s,
    '      appendHumanVerifyResult(lines, item, index);',
    '      appendHumanVerifyResult(lines, item, index, color);',
    'multi result color');
  s = once(s,
    '    appendHumanVerifyResult(lines, result);',
    '    appendHumanVerifyResult(lines, result, undefined, color);',
    'single result color');
  s = once(s,
    'async function mediaFile(path: string, kind: "image" | "audio") {',
    'function verdictColor(verdict: string) { const value = verdict.toUpperCase(); if (value === "TRUE") return 32; if (value === "MOSTLY_TRUE") return 36; if (value === "MISLEADING") return 33; if (value === "FALSE") return 31; return 35; }\n\nasync function mediaFile(path: string, kind: "image" | "audio") {',
    'verdict color helper');
  s = once(s,
    '  factlens verify --audio recording.mp3 [--claim "Optional claim"]\\\n  factlens usage',
    '  factlens verify --audio recording.mp3 [--claim "Optional claim"] [--speaker "Name"]\\\n  factlens list\\\n  factlens kill <job-id|all>\\\n  factlens usage',
    'help local jobs');
  s = once(s,
    'Source preferences:\\\n  --trusted-domains LIST  Prioritize matching domains for this verification\\\n  --blocked-domains LIST  Exclude matching domains for this verification\\\n\\\nRequest options:',
    'Source preferences:\\\n  --trusted-domains LIST  Prioritize matching domains for this verification\\\n  --blocked-domains LIST  Exclude matching domains for this verification\\\n  --speaker NAME          Preserve speaker attribution for audio or transcript claims\\\n\\\nLocal jobs:\\\n  factlens list           Show active local verification jobs and concurrency\\\n  factlens kill ID        Stop one local job by request ID prefix\\\n  factlens kill all       Stop every active local FactLens job\\\n\\\nRequest options:',
    'help source speaker');
  return s;
});

await edit('README.md', (s) => {
  let out = once(s,
    'factlens verify --audio interview.mp3\nfactlens verify --audio clip.m4a --claim "The speaker says inflation is 3%."',
    'factlens verify --audio interview.mp3\nfactlens verify --audio clip.m4a --speaker "Jane Doe"\nfactlens list\nfactlens kill REQUEST_ID',
    'README CLI audio');
  out = once(out,
    'The CLI sends the media to **Verify**. FactLens transcribes it internally when required; there is no standalone transcription command.',
    'The CLI streams local audio into **Verify** and shows an animated progress bar while it runs. `factlens list` shows active local jobs and concurrency, and `factlens kill <request-id>` or `factlens kill all` stops them. FactLens transcribes media internally; there is no standalone transcription command. Audio is limited to 3 hours and costs one API credit per 10 minutes or part thereof.',
    'README audio behavior');
  out = once(out,
    '  audio_base64: audioBase64,\n  content_type: "audio/mpeg",',
    '  audio_url: "https://example.com/interview.mp3",\n  speaker: "Jane Doe",',
    'README SDK audio');
  out = once(out,
    'If you already have a transcript, send it through Verify instead of uploading audio:',
    'For long form SDK requests, use `audio_url`. Inline `audio_base64` remains available for smaller media. If you already have a transcript, send it through Verify instead of uploading audio. The first 100,000 transcript characters use the normal one credit charge; each additional 30,000 characters or part thereof adds one credit:',
    'README transcript billing');
  return out;
});

await edit('CHANGELOG.md', (s) => once(s,
  '## Unreleased\n\n## 1.0.11 - 2026-08-15',
  '## Unreleased\n\n## 1.0.15 - 2026-08-15\n\n- Add animated colorful CLI progress, local job concurrency with `factlens list`, and `factlens kill`.\n- Add request scoped speaker attribution to CLI and SDK verification.\n- Stream CLI audio uploads for long form verification and keep polling `REQUEST_IN_PROGRESS` until the original request completes.\n- Document the 3 hour audio limit, one credit per 10 minutes of audio, and large transcript credit rules.\n- Keep human CLI output complete for multi-claim results while JSON mode remains clean for automation.\n\n## 1.0.11 - 2026-08-15',
  '1.0.15 changelog'));

try { await rename('tests/version-1.0.11.test.mjs', 'tests/version-1.0.15.test.mjs'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }

console.log('NPM CLI 1.0.15 transformations applied');
