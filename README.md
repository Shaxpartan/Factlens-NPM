# FactLens SDK & CLI

[![npm version](https://img.shields.io/npm/v/factlens.svg)](https://www.npmjs.com/package/factlens)
[![CI](https://github.com/Shaxpartan/Factlens-NPM/actions/workflows/ci.yml/badge.svg)](https://github.com/Shaxpartan/Factlens-NPM/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-31f50a.svg)](LICENSE)

The official Node.js, TypeScript SDK, and command-line interface for the FactLens verification API.

FactLens exposes a focused runtime: **Verify**. Transcription, evidence retrieval, safety checks, and AI analysis remain internal verification stages rather than standalone provider commands.

**Current package:** `6.7.0`  
**Runtime:** Node.js 18+

## Install

```bash
npm install factlens
```

The same package contains the CLI:

```bash
npx factlens --help
npx factlens verify "Earth orbits the Sun."
```

For a global command:

```bash
npm install -g factlens
factlens --help
```

## Credentials

Open `https://api.factlens.pro/dashboard`.

| Credential | Used for |
|---|---|
| Project API key | Verify and runtime usage |
| Developer token | Account, projects, keys, key customization, logs, request inspection |

The SDK reads these environment variables automatically:

```bash
FACTLENS_API_KEY=fl_live_YOUR_KEY
FACTLENS_DEVELOPER_TOKEN=fldev_live_YOUR_TOKEN
```

The CLI can store them in the operating-system user configuration directory:

```bash
factlens configure
factlens config show
factlens doctor
```

`config show` masks secrets. Environment variables override saved CLI credentials.

## v6.7.0 runtime metadata

Ordinary SDK calls remain source-compatible:

```ts
const result = await factlens.verify({ mode: "text", claim: "Earth orbits the Sun." });
```

Use the additive detailed path when you need transport/runtime diagnostics:

```ts
const { data, meta } = await factlens.verifyDetailed({ mode: "text", claim: "Earth orbits the Sun." });
console.log(meta.serverTiming.coreMs, meta.serverTiming.edgeMs, meta.gatewayNetworkMs);
```

## v6.7.0 runtime metadata

Ordinary SDK calls remain source-compatible:

```ts
const result = await factlens.verify({ mode: "text", claim: "Earth orbits the Sun." });
```

Use the additive detailed path when you need transport/runtime diagnostics:

```ts
const { data, meta } = await factlens.verifyDetailed({ mode: "text", claim: "Earth orbits the Sun." });
console.log(meta.serverTiming.coreMs, meta.serverTiming.edgeMs, meta.gatewayNetworkMs);
```

## CLI

### Text verification

```bash
factlens verify "The Eiffel Tower is in Paris."
factlens verify --file claim.txt
```

A passage may contain multiple claims. Human output renders every successful claim separately and reports `failed_claims` independently when only part of a multi-claim request fails.

### Image/post verification

```bash
factlens verify --image screenshot.png
factlens verify --image screenshot.webp --claim "Optional focus or guidance"
```

Supported image files are PNG, JPEG, WebP, HEIC, and HEIF. The image claim is optional because FactLens can isolate the primary checkable claim from the image itself.

### Audio/video and transcripts

```bash
factlens verify --audio interview.mp3
factlens verify --audio clip.m4a --speaker "Jane Doe" --language auto
factlens verify --audio-url https://example.com/interview.mp3
factlens verify --transcript "Transcript text"
factlens verify --transcript-file transcript.txt
```

The CLI streams local audio through FactLens's resumable upload path. Audio is limited to **3 hours** and is billed at one API credit per **10 minutes** or part thereof. Direct transcript input includes the first **100,000 transcript characters** in the normal one-credit charge and then adds one credit for each additional **30,000 transcript characters** or part thereof.

### Forward-only progress

Interactive terminals use a forward-only animated phase rail. It never runs backward:

```text
FactLens  TEXT    1.842s   [✓] Sent  ━━━  [◐] Verifying  ━━━  [ ] Result
```

Completed phases stay green, the active spinner/rail stays cyan, waiting/retry states use warning colors, and the final verdict uses the exact API-provided `verdictColor`. Audio upload uses a real byte-derived percentage because the resumable uploader knows the acknowledged offset; text and image verification deliberately do not invent percentages.

When stdout is not a TTY, FactLens avoids animation frames. `--json` remains clean for automation. `NO_COLOR` disables ANSI color.

Local jobs:

```bash
factlens list
factlens kill REQUEST_ID
factlens kill all
```

### Source preferences and advanced Verify controls

Trusted and blocked domains can be saved as defaults for each API key. A request that omits a list uses the saved list. Supplying a list **overrides the matching saved list for that request only**. An **explicit empty array** in the SDK, or the matching CLI `--no-*` flag, temporarily clears that saved list without rewriting dashboard configuration. Blocked domains win if a domain is present in both lists.

```bash
factlens verify "A claim" \
  --trusted-domains reuters.com,apnews.com \
  --blocked-domains example.com \
  --instructions "Prefer direct primary evidence." \
  --search-query "custom research query" \
  --results-per-search 10
```

Explicitly ignore saved lists for one request:

```bash
factlens verify "A claim" --no-trusted-domains --no-blocked-domains
```

Request-scoped verdict definitions, including colors, can be supplied from JSON:

```json
[
  {
    "id": "custom:11111111-1111-4111-8111-111111111111",
    "name": "CONFIRMED",
    "color": "#16a34a",
    "rule": "Choose when the supplied evidence directly establishes the claim."
  }
]
```

```bash
factlens verify "A claim" --verdicts-file verdicts.json
```

### Timing

The old millisecond option remains backward compatible:

```bash
factlens verify "A claim" --timeout 90000
```

v6.7.0 continues to accept seconds:

```bash
factlens verify "A claim" --timeout-seconds 90
```

Do not pass both timeout forms together. Human output can choose its display unit:

```bash
factlens verify "A claim" --time-unit auto
factlens verify "A claim" --time-unit ms
factlens verify "A claim" --time-unit s
```

v6.7.0 consumes the API's additive `Server-Timing` contract. Default output shows **total client wall time** and **core verification time**. `--verbose` adds Auth/Config/Core/Post/Edge plus the approximate outside-network remainder; `--trace` adds safe HTTP/retry diagnostics. `response_time_ms` remains core verification time and is never relabeled as total server time.

### Output modes

```bash
factlens verify "A claim" --quiet
factlens verify "A claim" --verbose
factlens verify "A claim" --json
```

- `--quiet`: verdict IDs only.
- default: readable claim/verdict/evidence/source summary.
- `--verbose`: full source URLs and runtime breakdown.
- `--trace`: full safe transport/runtime diagnostics.
- `--json`: machine-readable API response with additive `timing` metadata for Verify.

If the API returns `verdictColor`, human output uses that exact `#RRGGBB` color. With ANSI disabled, the hex value remains visible.

### Management and API-key customization

Management commands require a developer token:

```bash
factlens account
factlens projects list
factlens projects create "Production"
factlens projects update PROJECT_ID "Production API"
factlens projects select PROJECT_ID
factlens projects delete PROJECT_ID --yes

factlens keys list
factlens keys create "Backend"
factlens keys revoke KEY_ID --yes

factlens usage --account
factlens logs --limit 50 --endpoint verify
factlens request REQUEST_ID
```

v6.7.0 preserves the API-key customization contract through the public developer-token management API:

```bash
factlens keys customization get KEY_ID --project PROJECT_ID

factlens keys customization preferences KEY_ID \
  --project PROJECT_ID \
  --trusted-domains reuters.com,apnews.com \
  --blocked-domains example.com

factlens keys customization prompt save KEY_ID \
  --project PROJECT_ID \
  --mode text \
  --stage claim_extraction \
  --instruction-file claim-prompt.txt \
  --input-budget 8000 \
  --prompt-mode guided

factlens keys customization prompt reset KEY_ID \
  --project PROJECT_ID \
  --mode text \
  --stage claim_extraction

factlens keys customization verdicts save KEY_ID \
  --project PROJECT_ID \
  --file verdict-config.json

factlens keys customization verdicts reset KEY_ID \
  --project PROJECT_ID \
  --yes
```

Customization modes are `text`, `audio`, and `image`. Saved prompt budgets are stage-specific: default **8,000**, minimum 2,000, maximum 20,000, in 100-token increments.

## SDK

```ts
import FactLens from "factlens";

const factlens = new FactLens();

const result = await factlens.verify({
  mode: "text",
  claim: "The Eiffel Tower is in Paris.",
});

console.log(result.verdictId);
console.log(result.verdictColor);
console.log(result.explanation);
console.log(result.sources);
```

Pass credentials explicitly if preferred:

```ts
const factlens = new FactLens({
  apiKey: process.env.FACTLENS_API_KEY,
  developerToken: process.env.FACTLENS_DEVELOPER_TOKEN,
});
```

### Verify inputs

Text:

```ts
const result = await factlens.verify({
  mode: "text",
  text: "A passage containing one or more factual claims.",
  trusted_domains: ["reuters.com"],
  blocked_domains: [],
  instructions: "Prefer primary sources.",
  search_query: "optional query override",
  results_per_search: 10,
});
```

Image/post:

```ts
const result = await factlens.verify({
  mode: "image_post",
  image_base64: imageBase64,
  content_type: "image/png",
});
```

Audio/video or an existing transcript:

```ts
const mediaResult = await factlens.verify({
  mode: "audio_video",
  audio_url: "https://example.com/interview.mp3",
  speaker: "Jane Doe",
  language: "auto",
});

const transcriptResult = await factlens.verify({
  mode: "audio_video",
  transcript: existingTranscript,
});
```

### Request-scoped verdict colors

```ts
const result = await factlens.verify({
  mode: "text",
  claim: "A claim",
  verdicts: [
    {
      id: "custom:11111111-1111-4111-8111-111111111111",
      name: "CONFIRMED",
      color: "#16a34a",
      rule: "Choose when the supplied evidence directly establishes the claim.",
    },
  ],
});

console.log(result.verdictId);
console.log(result.verdictColor);
```

For multi-claim responses, `result.results` contains independently verified results and each result can include its own `verdictColor`. `result.failed_claims` contains per-claim failures when other claims still succeed.

### Manage saved key customization

The SDK uses the developer token and the same per-key storage/contracts as the FactLens dashboard:

```ts
factlens.projects.select("PROJECT_ID");

const state = await factlens.keys.customization.get({
  keyId: "KEY_ID",
});

await factlens.keys.customization.updatePreferences({
  keyId: "KEY_ID",
  trustedDomains: ["reuters.com", "apnews.com"],
  blockedDomains: ["example.com"],
});

await factlens.keys.customization.savePrompt({
  keyId: "KEY_ID",
  mode: "text",
  stage: "claim_extraction",
  instruction: "Extract only explicit, complete claims.",
  inputBudgetTokens: 8000,
  promptMode: "guided",
  enabled: true,
});

await factlens.keys.customization.saveVerdicts({
  keyId: "KEY_ID",
  config: verdictConfigV3,
});
```

Reset methods delete only the selected key's saved customization:

```ts
await factlens.keys.customization.resetPrompt({
  keyId: "KEY_ID",
  mode: "text",
  stage: "claim_extraction",
});

await factlens.keys.customization.resetVerdicts({ keyId: "KEY_ID" });
```

### Request control and timing

```ts
await factlens.verify(
  { mode: "text", claim: "..." },
  {
    timeoutSeconds: 90,
    maxRetries: 2,
    onProgress(progress) {
      console.log(progress.state, progress.elapsedMs, progress.elapsedSeconds);
    },
  },
);
```

`timeout` remains milliseconds. `timeoutSeconds` is the seconds alternative. Supplying both is a configuration error. Progress timing uses a monotonic clock, so wall-clock adjustments cannot make elapsed time run backward.

Verify automatically receives an `X-Request-ID` when one is not supplied. Automatic retries and `REQUEST_IN_PROGRESS` polling reuse it so an idempotent request is not executed twice.

## SDK management

```ts
const account = await factlens.account.get();
const projects = await factlens.projects.list();
const project = await factlens.projects.create({ name: "Production" });

factlens.projects.select(project.id);

const createdKey = await factlens.keys.create({ label: "Backend" });
console.log(createdKey.api_key); // shown once

const accountUsage = await factlens.usage.getAccount();
const logs = await factlens.logs.list({ limit: 50 });
const request = await factlens.logs.get("REQUEST_ID");
```

`projects.select()` changes only the default project for management calls. Runtime project identity remains bound to the project API key.

## Errors

```ts
import FactLens, { FactLensError } from "factlens";

try {
  await factlens.verify({ mode: "text", claim: "..." });
} catch (error) {
  if (error instanceof FactLensError) {
    console.error(error.code);
    console.error(error.status);
    console.error(error.requestId);
    console.error(error.retryable);
    console.error(error.stage);
    console.error(error.details);
    console.error(error.helpUrl);
  }
}
```

`409 REQUEST_IN_PROGRESS` remains recoverable within the configured timeout. Ordinary validation/authentication/quota/billing/ownership/request-ID-conflict errors are not retried. Retryable network errors, `408`, `429`, and retryable `5xx` responses use the bounded retry budget.

See [Errors and retries](docs/errors-and-retries.md).

## Browser safety

Secret API keys and developer tokens belong on the server. The SDK refuses secret credentials in browser-like environments by default. `dangerouslyAllowBrowser: true` is an explicit escape hatch and should not be used with production secrets.

## Usage and limits

Eligible free accounts receive 30 shared requests per UTC day. Paid API credits use the current rate: **$1 funds 30 API checks**.

| | Free | Paid |
|---|---:|---:|
| Projects | 3 | 100 |
| Active keys per project | 1 | 10 |
| Daily free requests | 30 shared | 0 |
| Throughput | 20/min shared | 60/min shared |
| Purchased balance | — | Shared across all projects |

Keys, logs, requests, and metrics remain project-attributed. Existing unused paid balances are migrated by the API backend; the SDK reads the resulting request-credit balance and does not perform local money conversion.

See [Usage and limits](docs/usage-and-limits.md).

## Documentation

- [Getting started](docs/getting-started.md)
- [Authentication](docs/authentication.md)
- [Runtime API](docs/runtime-api.md)
- [Projects and keys](docs/projects-and-keys.md)
- [Usage and limits](docs/usage-and-limits.md)
- [Errors and retries](docs/errors-and-retries.md)
- [TypeScript](docs/typescript.md)
- [Publishing](docs/publishing.md)
- Full HTTP documentation: `https://api.factlens.pro/docs`

## Security

See [SECURITY.md](SECURITY.md). Never put live API keys, developer tokens, or sensitive request payloads in public issues.

## License

MIT

### 6.5.0 → 6.7.0

No change is required for ordinary `client.verify()` callers. v6.7.0 adds `verifyDetailed()`, runtime timing metadata, conservative one-retry behavior for read-only GETs, AbortSignal support, richer safe errors, CLI `--trace`, and non-billable `factlens doctor`. Billable Verify POSTs and mutations are not automatically retried.
