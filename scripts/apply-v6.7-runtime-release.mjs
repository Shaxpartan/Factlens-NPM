import { readFile, writeFile } from 'node:fs/promises';

async function update(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`v6.7 canonicalizer: missing ${label}`);
  return source.replace(needle, replacement);
}

function replaceSection(source, start, end, replacement, label) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  if (startAt < 0 || endAt < 0) throw new Error(`v6.7 canonicalizer: missing ${label}`);
  return source.slice(0, startAt) + replacement + source.slice(endAt);
}

await update('src/http.ts', (source) => {
  if (!source.includes('retryCount: attempt,')) {
    source = replaceRequired(
      source,
      `        const meta = buildResponseMeta({\n          headers: response.headers,\n          clientTotalMs: Math.max(0, monotonicNow() - startedAt),\n          status: response.status,\n        });`,
      `        const meta = buildResponseMeta({\n          headers: response.headers,\n          clientTotalMs: Math.max(0, monotonicNow() - startedAt),\n          status: response.status,\n          retryCount: attempt,\n        });`,
      'success response metadata',
    );
  }

  if (!source.includes('const responseMeta = buildResponseMeta')) {
    source = replaceRequired(
      source,
      `      const stage = verificationStage(errorBody.stage);\n\n      throw new FactLensError(message, {`,
      `      const stage = verificationStage(errorBody.stage);\n      const responseMeta = buildResponseMeta({\n        headers: response.headers,\n        clientTotalMs: Math.max(0, monotonicNow() - startedAt),\n        status: response.status,\n        retryCount: attempt,\n      });\n\n      throw new FactLensError(message, {`,
      'HTTP error metadata builder',
    );
    source = replaceRequired(
      source,
      `        retryable: retryableStatus && (readOnly || runtimeVerify),\n        headers: new Headers(response.headers),`,
      `        retryable: retryableStatus && (readOnly || runtimeVerify),\n        retryAfterMs: responseMeta.retryAfterMs,\n        meta: responseMeta,\n        headers: new Headers(response.headers),`,
      'HTTP error metadata fields',
    );
  }

  if (!source.includes('phaseElapsedMs')) {
    source = replaceRequired(
      source,
      `    let attempt = 0;\n    const progress = (state: "sending" | "waiting" | "transcribing" | "retrying" | "complete") => {\n      try {\n        const elapsedMs = Math.max(0, monotonicNow() - startedAt);\n        options.onProgress?.({ state, elapsedMs, elapsedSeconds: elapsedMs / 1000, ...(requestId ? { requestId } : {}), attempt });\n      } catch {}\n    };`,
      `    let attempt = 0;\n    let pollCount = 0;\n    let progressState: string | undefined;\n    let phaseStartedAt = startedAt;\n    const progress = (state: "sending" | "waiting" | "transcribing" | "retrying" | "complete", extras: Record<string, unknown> = {}) => {\n      try {\n        const now = monotonicNow();\n        if (progressState !== state) { progressState = state; phaseStartedAt = now; }\n        const elapsedMs = Math.max(0, now - startedAt);\n        const phase = state === "transcribing" ? "transcription" : state === "sending" || state === "retrying" ? "verifying" : state;\n        options.onProgress?.({ state, phase, elapsedMs, elapsedSeconds: elapsedMs / 1000, phaseElapsedMs: Math.max(0, now - phaseStartedAt), pollCount, ...(requestId ? { requestId } : {}), attempt, ...extras });\n      } catch {}\n    };`,
      'progress metadata',
    );
    source = replaceRequired(
      source,
      `      if (response.status === 409 && code === "REQUEST_IN_PROGRESS" && requestId) {\n        progress(textValue(errorBody.stage) === "transcription" ? "transcribing" : "waiting");\n        const wait = retryDelay(response.headers.get("retry-after"), 0);`,
      `      if (response.status === 409 && code === "REQUEST_IN_PROGRESS" && requestId) {\n        const wait = retryDelay(response.headers.get("retry-after"), 0);\n        pollCount += 1;\n        progress(textValue(errorBody.stage) === "transcription" ? "transcribing" : "waiting", { nextPollInMs: wait });`,
      'poll progress metadata',
    );
  }
  return source;
});

await update('src/types/index.ts', (source) => {
  if (!source.includes('VerifyProgressPhase')) {
    source = replaceRequired(
      source,
      `export type VerifyProgressState = "sending" | "waiting" | "transcribing" | "retrying" | "complete";\n\nexport type VerifyProgress = {\n  state: VerifyProgressState;\n  elapsedMs: number;\n  elapsedSeconds: number;\n  requestId?: string;\n  attempt: number;\n};`,
      `export type VerifyProgressState = "sending" | "waiting" | "transcribing" | "retrying" | "complete";\nexport type VerifyProgressPhase = "prepare" | "upload" | "transcription" | "waiting" | "verifying" | "complete";\n\nexport type VerifyProgress = {\n  state: VerifyProgressState;\n  phase?: VerifyProgressPhase;\n  elapsedMs: number;\n  elapsedSeconds: number;\n  phaseElapsedMs?: number;\n  pollCount?: number;\n  nextPollInMs?: number;\n  uploadedBytes?: number;\n  totalBytes?: number;\n  percent?: number;\n  requestId?: string;\n  attempt: number;\n};`,
      'VerifyProgress types',
    );
  }
  if (!source.includes('export type RequestDetailResult')) {
    source = replaceRequired(
      source,
      `export type RequestDetail = LogEntry & Record<string, unknown>;`,
      `export type RequestDetailResult = VerifyResult & {\n  verdictName?: string;\n  verdict_name?: string;\n  verdict_color?: string;\n};\n\nexport type RequestDetail = LogEntry & {\n  status?: string;\n  total_ms?: number;\n  core_ms?: number;\n  response_time_ms?: number;\n  usage?: UsageSnapshot | Record<string, unknown>;\n  results?: RequestDetailResult[];\n  failed_claims?: VerifyClaimFailure[];\n  failedClaims?: VerifyClaimFailure[];\n  error?: Record<string, unknown> | null;\n  [key: string]: unknown;\n};`,
      'RequestDetail type',
    );
  }
  return source;
});

await update('src/cli/index.ts', (source) => {
  if (!source.includes('trace: boolean;')) {
    source = replaceRequired(source, `  verbose: boolean;\n  timeUnit: TimeUnit;`, `  verbose: boolean;\n  trace: boolean;\n  timeUnit: TimeUnit;`, 'CLI context trace type');
    source = replaceRequired(source, `    verbose: flagBoolean(parsed.flags, "verbose"),\n    timeUnit: timeUnitFlag(parsed.flags),`, `    verbose: flagBoolean(parsed.flags, "verbose"),\n    trace: flagBoolean(parsed.flags, "trace"),\n    timeUnit: timeUnitFlag(parsed.flags),`, 'CLI context trace value');
    source = replaceRequired(source, `  const booleanFlags = new Set(["json", "account", "yes", "help", "version", "no-trusted-domains", "no-blocked-domains", "quiet", "verbose"]);`, `  const booleanFlags = new Set(["json", "account", "yes", "help", "version", "no-trusted-domains", "no-blocked-domains", "quiet", "verbose", "trace"]);`, 'trace flag parser');
  }

  if (!source.includes('runtimeTiming: detailed.meta')) {
    source = replaceSection(
      source,
      'async function doctor(',
      '\nasync function verifyCommand',
      `async function doctor(client: FactLens, config: ReturnType<typeof resolveCredentials>) {\n  const checks: Array<Record<string, unknown>> = [];\n  if (config.apiKey) {\n    try {\n      const detailed = await client.usage.getDetailed({ maxRetries: 0, timeout: 15_000 });\n      checks.push({ name: "runtime API key", ok: true, runtimeTiming: detailed.meta });\n    } catch (error) {\n      checks.push({ name: "runtime API key", ok: false, error: serializeError(error) });\n    }\n  } else checks.push({ name: "runtime API key", ok: false, message: \`Not configured. Get one from \${DASHBOARD}.\` });\n\n  if (config.developerToken) {\n    try {\n      await client.projects.list({ maxRetries: 0, timeout: 15_000 });\n      checks.push({ name: "developer token", ok: true });\n    } catch (error) {\n      checks.push({ name: "developer token", ok: false, error: serializeError(error) });\n    }\n  } else checks.push({ name: "developer token", ok: false, message: \`Not configured. Create one at \${DASHBOARD}.\` });\n\n  return { version: SDK_VERSION, ok: checks.some((check) => check.ok === true) && checks.every((check) => check.ok === true || check.message), checks };\n}\n`,
      'doctor function',
    );
  }

  if (!source.includes('attachRuntimeMeta')) {
    source = replaceRequired(
      source,
      `      const result = await client.verify(pollInput, { ...requestOptions(flags, 1_800_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); queueJobUpdate(mapped); progress.update(progressLabel(event.state)); } });\n      return attachClientElapsed(result, startedAt);`,
      `      const detailed = await client.verifyDetailed(pollInput, { ...requestOptions(flags, 1_800_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); queueJobUpdate(mapped); progress.update(progressLabel(event.state)); } });\n      return attachRuntimeMeta(detailed.data, detailed.meta, startedAt);`,
      'audio detailed verify',
    );
    source = replaceRequired(
      source,
      `    const result = await client.verify(input, { ...requestOptions(flags, mode === "audio_video" ? 1_800_000 : 180_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); queueJobUpdate(mapped); progress.update(progressLabel(event.state)); } });\n    return attachClientElapsed(result, startedAt);`,
      `    const detailed = await client.verifyDetailed(input, { ...requestOptions(flags, mode === "audio_video" ? 1_800_000 : 180_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); queueJobUpdate(mapped); progress.update(progressLabel(event.state)); } });\n    return attachRuntimeMeta(detailed.data, detailed.meta, startedAt);`,
      'normal detailed verify',
    );
    source = replaceSection(
      source,
      'function attachClientElapsed(',
      '\nfunction requiredText',
      `function attachRuntimeMeta(result: VerifyResponse, meta: any, startedAt: number) {\n  Object.defineProperty(result, "__clientElapsedMs", { value: Math.max(0, monotonicNow() - startedAt), enumerable: false, configurable: true });\n  Object.defineProperty(result, "__responseMeta", { value: meta, enumerable: false, configurable: true });\n  return result;\n}\n`,
      'attach runtime metadata',
    );
  }

  if (!source.includes('function humanRequestDetail(')) {
    source = replaceSection(
      source,
      'function outputSuccess(',
      '\nfunction appendHumanVerifyResult',
      `function outputSuccess(command: string, result: any, context: CliContext) {\n  if (context.json) {\n    if (command === "verify" && result?.__responseMeta) {\n      writeJson(context.writeOut, { ...result, timing: { ...result.__responseMeta, cliTotalMs: Number(result.__clientElapsedMs) || result.__responseMeta.clientTotalMs } });\n    } else writeJson(context.writeOut, result);\n    return;\n  }\n  if (command === "verify") {\n    if (context.quiet) {\n      const items = Array.isArray(result?.results) && result.results.length ? result.results : [result];\n      context.writeOut(\`\${items.map((item: any) => item?.verdictId || "").filter(Boolean).join("\\n")}\\n\`);\n      return;\n    }\n    context.writeOut(humanVerify(result, context.color, context.timeUnit, context.verbose, context.trace));\n    return;\n  }\n  if (command === "request") { context.writeOut(humanRequestDetail(result, context.color, context.timeUnit, context.verbose || context.trace)); return; }\n  if (command === "doctor") {\n    const lines = [\`FactLens doctor · v\${result.version || SDK_VERSION}\`];\n    for (const check of result.checks || []) {\n      lines.push(\`\${check.ok ? "OK" : "WARN"}  \${check.name}\${check.message ? \` — \${check.message}\` : ""}\`);\n      const timing = check.runtimeTiming;\n      if (timing) {\n        const core = timing.serverTiming?.coreMs;\n        const edge = timing.serverTiming?.edgeMs;\n        lines.push(\`    Total \${formatDuration(timing.clientTotalMs, context.timeUnit)}\${core === undefined ? "" : \` · Core \${formatDuration(core, context.timeUnit)}\`}\${edge === undefined ? "" : \` · Edge \${formatDuration(edge, context.timeUnit)}\`}\`);\n      }\n    }\n    context.writeOut(\`\${lines.join("\\n")}\\n\`);\n    return;\n  }\n  if (command === "projects" && result?.selectedProjectId) { context.writeOut(\`Selected project: \${result.selectedProjectId}\\n\`); return; }\n  if (command === "keys" && result?.api_key) { context.writeOut(\`API key created. This secret is shown once.\\n\${result.api_key}\\nStore it securely; FactLens cannot show it again.\\n\`); return; }\n  context.writeOut(\`\${JSON.stringify(result, null, 2)}\\n\`);\n}\n`,
      'outputSuccess function',
    );

    source = replaceSection(
      source,
      'function humanVerify(',
      '\nasync function mediaFile',
      `function humanRequestDetail(detail: any, color = false, timeUnit: TimeUnit = "auto", verbose = false) {\n  const requestId = detail?.request_id || detail?.requestId || "unknown";\n  const lines = [colorize(\`FactLens request \${requestId}\`, 1, color)];\n  if (detail?.status || detail?.http_status) lines.push(\`Status: \${detail.status || detail.http_status}\`);\n  if (detail?.mode) lines.push(\`Mode: \${detail.mode}\`);\n  const responseBody = detail?.response_body && typeof detail.response_body === "object" ? detail.response_body : undefined;\n  const results = Array.isArray(detail?.results) ? detail.results : Array.isArray(responseBody?.results) ? responseBody.results : [];\n  if (results.length) {\n    lines.push("");\n    results.forEach((item: any, index: number) => { if (index > 0) lines.push(""); appendHumanVerifyResult(lines, item, index, color, verbose); });\n  } else if (responseBody?.verdictId || detail?.verdictId) {\n    lines.push("");\n    appendHumanVerifyResult(lines, responseBody || detail, undefined, color, verbose);\n  }\n  const failed = Array.isArray(detail?.failed_claims) ? detail.failed_claims : Array.isArray(detail?.failedClaims) ? detail.failedClaims : Array.isArray(responseBody?.failed_claims) ? responseBody.failed_claims : [];\n  if (failed.length) {\n    lines.push("\\nFailed claims:");\n    failed.forEach((item: any, index: number) => lines.push(\`\${index + 1}. \${item.claim || "Unknown claim"} — \${item.error || item.message || "failed"}\`));\n  }\n  const totalMs = Number(detail?.total_ms ?? detail?.duration_ms);\n  const coreMs = Number(detail?.core_ms ?? detail?.response_time_ms ?? responseBody?.response_time_ms);\n  if (Number.isFinite(totalMs) || Number.isFinite(coreMs)) lines.push(\`\\nTiming: \${Number.isFinite(totalMs) ? formatDuration(totalMs, timeUnit) : "n/a"} total · \${Number.isFinite(coreMs) ? formatDuration(coreMs, timeUnit) : "n/a"} core\`);\n  if (detail?.error_code || detail?.error) lines.push(\`Error: \${detail.error_code || JSON.stringify(detail.error)}\`);\n  return \`\${lines.join("\\n")}\\n\`;\n}\n\nfunction humanVerify(result: VerifyResponse, color = false, timeUnit: TimeUnit = "auto", verbose = false, trace = false) {\n  const claimCount = Number(result.claim_count || (Array.isArray(result.results) ? result.results.length : result.claim ? 1 : 0));\n  const lines = [colorize(\`FactLens verification complete\${claimCount > 1 ? \` · \${claimCount} claims\` : ""}\`, 1, color)];\n  const results = Array.isArray(result.results) && result.results.length ? result.results : null;\n  if (results) results.forEach((item, index) => { if (index > 0) lines.push(""); appendHumanVerifyResult(lines, item, index, color, verbose || trace); });\n  else appendHumanVerifyResult(lines, result, undefined, color, verbose || trace);\n  if (Array.isArray(result.failed_claims) && result.failed_claims.length) {\n    lines.push("\\nFailed claims:");\n    result.failed_claims.forEach((item: any, index: number) => lines.push(\`\${index + 1}. \${item.claim || "Unknown claim"} — \${item.error || item.message || "failed"}\`));\n  }\n  if (!claimCount && result.message) lines.push(\`\\n\${result.message}\`);\n  if (result.request_id) lines.push(\`\\nRequest ID: \${result.request_id}\`);\n  if (result.response_time_ms !== undefined) lines.push(\`Response time: \${result.response_time_ms} ms\`);\n  const meta = (result as any).__responseMeta;\n  const cliTotalMs = Number((result as any).__clientElapsedMs);\n  const totalMs = Number.isFinite(cliTotalMs) ? cliTotalMs : Number(meta?.clientTotalMs);\n  const coreMs = Number(meta?.serverTiming?.coreMs ?? result.response_time_ms);\n  if (Number.isFinite(totalMs) || Number.isFinite(coreMs)) {\n    const total = Number.isFinite(totalMs) ? formatDuration(totalMs, timeUnit) : "n/a";\n    const core = Number.isFinite(coreMs) ? formatDuration(coreMs, timeUnit) : "n/a";\n    lines.push(\`Timing: \${total} total · \${core} core\`);\n  }\n  if (meta && (verbose || trace)) {\n    const t = meta.serverTiming || {};\n    const parts = [\n      t.authMs === undefined ? null : \`Auth \${formatDuration(t.authMs, timeUnit)}\`,\n      t.customizationMs === undefined ? null : \`Config \${formatDuration(t.customizationMs, timeUnit)}\`,\n      t.coreMs === undefined ? null : \`Core \${formatDuration(t.coreMs, timeUnit)}\`,\n      t.postprocessMs === undefined ? null : \`Post \${formatDuration(t.postprocessMs, timeUnit)}\`,\n      t.edgeMs === undefined ? null : \`Edge \${formatDuration(t.edgeMs, timeUnit)}\`,\n    ].filter(Boolean);\n    if (parts.length) lines.push(\`Runtime: \${parts.join(" · ")}\`);\n    if (meta.gatewayNetworkMs !== undefined) lines.push(\`Outside: ~\${formatDuration(meta.gatewayNetworkMs, timeUnit)}\`);\n    if (trace) lines.push(\`Trace: HTTP \${meta.httpStatus ?? meta.status} · retries \${meta.retryCount ?? 0}\`);\n  }\n  if (result.usage) lines.push(\`Usage: \${JSON.stringify(result.usage)}\`);\n  return \`\${lines.join("\\n")}\\n\`;\n}\n`,
      'human verify/request detail renderers',
    );
  }

  if (!source.includes('--trace              Full safe transport/runtime trace')) {
    source = replaceRequired(source, `  --verbose             Show full source URLs and diagnostics\\n`, `  --verbose             Show full source URLs and runtime breakdown\\n  --trace               Full safe transport/runtime trace\\n`, 'trace help');
  }
  return source;
});

await update('tests/runtime.test.mjs', (source) => {
  source = source.replace(`assert.equal(headers.get("x-factlens-sdk-version"), "6.5.0");`, `assert.equal(headers.get("x-factlens-sdk-version"), "6.7.0");`);
  if (source.includes('test("verify retries reuse the request ID and respect retryable response classes"')) {
    source = replaceSection(
      source,
      'test("verify retries reuse the request ID and respect retryable response classes"',
      '\ntest("ordinary validation errors',
      `test("billable verify POSTs are not automatically retried", async () => {\n  let attempts = 0;\n  const client = new FactLens({\n    apiKey: "fl_live_project",\n    fetch: async () => {\n      attempts += 1;\n      return Response.json({ error: "FACTLENS_API_BUSY", message: "Try again" }, { status: 503, headers: { "Retry-After": "0" } });\n    },\n  });\n\n  await assert.rejects(client.verify({ mode: "text", claim: "Return true" }, { maxRetries: 5 }), FactLensError);\n  assert.equal(attempts, 1);\n});\n`,
      'legacy verify retry test',
    );
  }
  return source;
});

await update('tests/v6.5.0.test.mjs', (source) => source.replace(/client\/server timing separately/g, 'client/core timing separately').replace(/assert\.match\(text, \/server\/i\);/g, 'assert.match(text, /core/i);'));

await update('README.md', (source) => {
  source = source.replace('**Current package:** `6.5.0`', '**Current package:** `6.7.0`');
  source = source.replace('Interactive terminals use the v6.5.0 animated forward phase rail.', 'Interactive terminals use a forward-only animated phase rail.');
  source = source.replace('v6.5.0 also accepts seconds:', 'v6.7.0 continues to accept seconds:');
  source = source.replace("Final timing distinguishes **total client wall time** from the server's `response_time_ms`, so local file preparation/audio upload is no longer mistaken for server pipeline time.", "v6.7.0 consumes the API's additive `Server-Timing` contract. Default output shows **total client wall time** and **core verification time**. `--verbose` adds Auth/Config/Core/Post/Edge plus the approximate outside-network remainder; `--trace` adds safe HTTP/retry diagnostics. `response_time_ms` remains core verification time and is never relabeled as total server time.");
  source = source.replace('- `--verbose`: full source URLs and diagnostics.\n- `--json`: unmodified machine-readable API response.', '- `--verbose`: full source URLs and runtime breakdown.\n- `--trace`: full safe transport/runtime diagnostics.\n- `--json`: machine-readable API response with additive `timing` metadata for Verify.');
  source = source.replace('v6.5.0 also exposes the API-key customization contract', 'v6.7.0 preserves the API-key customization contract');
  if (!source.includes('### Detailed SDK runtime metadata')) {
    const anchor = '## CLI\n';
    const block = `## v6.7.0 runtime metadata\n\nOrdinary SDK calls remain source-compatible:\n\n\`\`\`ts\nconst result = await factlens.verify({ mode: "text", claim: "Earth orbits the Sun." });\n\`\`\`\n\nUse the additive detailed path when you need transport/runtime diagnostics:\n\n\`\`\`ts\nconst { data, meta } = await factlens.verifyDetailed({ mode: "text", claim: "Earth orbits the Sun." });\nconsole.log(meta.serverTiming.coreMs, meta.serverTiming.edgeMs, meta.gatewayNetworkMs);\n\`\`\`\n\n`;
    source = replaceRequired(source, anchor, `${block}${anchor}`, 'README CLI anchor');
  }
  if (!source.includes('factlens doctor')) {
    source = replaceRequired(source, 'factlens config show\n', 'factlens config show\nfactlens doctor\n', 'README doctor anchor');
  }
  if (!source.includes('### 6.5.0 → 6.7.0')) {
    source += `\n### 6.5.0 → 6.7.0\n\nNo change is required for ordinary \`client.verify()\` callers. v6.7.0 adds \`verifyDetailed()\`, runtime timing metadata, conservative one-retry behavior for read-only GETs, AbortSignal support, richer safe errors, CLI \`--trace\`, and non-billable \`factlens doctor\`. Billable Verify POSTs and mutations are not automatically retried.\n`;
  }
  return source;
});

await update('CHANGELOG.md', (source) => {
  if (source.includes('## 6.7.0 - 2026-08-17')) return source;
  return replaceRequired(
    source,
    '## Unreleased\n',
    `## Unreleased\n\n## 6.7.0 - 2026-08-17\n\n- Add \`verifyDetailed()\` and typed runtime response metadata parsed from \`Server-Timing\`, including Auth/Config/Core/Post/Edge, client total, outside-network estimate, retry count, and bounded \`Retry-After\`.\n- Preserve ordinary \`verify()\` return shapes and v6.5 caller compatibility.\n- Add AbortSignal composition and safe runtime metadata on SDK errors.\n- Retry transient read-only GET failures once by default while keeping billable Verify POSTs and mutations no-auto-retry.\n- Add CLI core-vs-total timing, \`--verbose\` runtime breakdown, \`--trace\`, and non-billable \`factlens doctor\`.\n- Render request-detail result/verdict cards without legacy Input/Pipeline presentation.\n- Preserve forward-only progress, exact API verdict colors, and \`NO_COLOR\` behavior.\n`,
    'CHANGELOG Unreleased anchor',
  );
});
