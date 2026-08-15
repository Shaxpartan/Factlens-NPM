# FactLens SDK & CLI

[![npm version](https://img.shields.io/npm/v/factlens.svg)](https://www.npmjs.com/package/factlens)
[![CI](https://github.com/Shaxpartan/Factlens-NPM/actions/workflows/ci.yml/badge.svg)](https://github.com/Shaxpartan/Factlens-NPM/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-31f50a.svg)](LICENSE)

The official Node.js, TypeScript SDK, and command-line interface for the FactLens verification API.

FactLens exposes a focused public runtime: **Verify**. Transcription, current-web evidence retrieval, safety checks, and AI analysis are internal stages of the verification pipeline rather than standalone customer services.

Node.js 18 or newer is required.

## Install

Install the SDK in a project:

```bash
npm install factlens
```

That local package also contains the CLI:

```bash
npx factlens --help
npx factlens verify "Earth orbits the Sun."
```

If you want the bare `factlens` command available from any directory:

```bash
npm install -g factlens
factlens --help
```

It is one package, not separate SDK and CLI packages.

## Get credentials

Open the FactLens developer dashboard:

`https://api.factlens.pro/dashboard`

For runtime verification:

1. Sign in.
2. Create or select a project.
3. Create a project API key.
4. Copy the secret immediately; it is shown once.
5. Store it as `FACTLENS_API_KEY` or save it with `factlens configure`.

For account-management operations, also create a developer token and store it as `FACTLENS_DEVELOPER_TOKEN` or save it with the CLI.

Project API keys and developer tokens are deliberately separate credentials:

| Credential | Used for |
|---|---|
| Project API key | Verify and runtime usage |
| Developer token | Account, projects, keys, account usage, logs, request inspection |

Environment variables override saved CLI configuration.

## CLI quick start

```bash
factlens configure
factlens doctor
factlens verify "The Eiffel Tower is in Paris."
```

Non-interactive configuration is also supported:

```bash
factlens configure \
  --api-key fl_live_YOUR_KEY \
  --developer-token fldev_live_YOUR_TOKEN
```

For CI and servers, prefer environment variables:

```bash
export FACTLENS_API_KEY=fl_live_YOUR_KEY
export FACTLENS_DEVELOPER_TOKEN=fldev_live_YOUR_TOKEN
```

On Windows CMD:

```cmd
set FACTLENS_API_KEY=fl_live_YOUR_KEY
set FACTLENS_DEVELOPER_TOKEN=fldev_live_YOUR_TOKEN
```

### Verify text

```bash
factlens verify "Earth orbits the Sun."
```

Or with a local package install:

```bash
npx factlens verify "Earth orbits the Sun."
```

### Verify an image or post

```bash
factlens verify --image screenshot.png --claim "This image was taken in London."
```

Supported image inputs are PNG, JPEG, WebP, and GIF.

### Verify audio or video content

```bash
factlens verify --audio interview.mp3
factlens verify --audio clip.m4a --speaker "Jane Doe"
factlens list
factlens kill REQUEST_ID
```

The CLI streams local audio into **Verify** and shows an animated progress bar while it runs. `factlens list` shows active local jobs and concurrency, and `factlens kill <request-id>` or `factlens kill all` stops them. FactLens transcribes media internally; there is no standalone transcription command. Audio is limited to 3 hours and costs one API credit per 10 minutes or part thereof.

### Verify a text file

```bash
factlens verify --file claim.txt
```

### JSON output

```bash
factlens verify "Earth orbits the Sun." --json
```

JSON mode is designed for scripts and CI. Successful data is written to stdout; structured errors are written to stderr.

### Request controls

```bash
factlens verify "A claim" \
  --timeout 90000 \
  --retries 2 \
  --request-id 01914f52-79f6-4d4f-b456-426614174000
```

### Runtime usage

```bash
factlens usage
```

### Configuration and diagnostics

```bash
factlens configure
factlens config show
factlens config clear
factlens doctor
```

`config show` masks secrets. Saved configuration lives in the operating-system user configuration directory, not in your project directory.

### Management commands

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

Use `--project PROJECT_ID` to override the selected management project for project-scoped commands. Destructive actions require `--yes`.

A newly created project API key is shown once. Store it immediately.

## SDK quick start

The SDK automatically reads `FACTLENS_API_KEY` and `FACTLENS_DEVELOPER_TOKEN` in Node.js.

```ts
import FactLens from "factlens";

const factlens = new FactLens();

const result = await factlens.verify({
  mode: "text",
  claim: "The Eiffel Tower is in Paris.",
});

console.log(result.verdictId);
console.log(result.explanation);
console.log(result.sources);
```

You can also pass credentials explicitly:

```ts
const factlens = new FactLens({
  apiKey: process.env.FACTLENS_API_KEY,
  developerToken: process.env.FACTLENS_DEVELOPER_TOKEN,
});
```

### Verify text

```ts
const result = await factlens.verify({
  mode: "text",
  claim: "Earth orbits the Sun.",
});
```

### Verify an image or post

```ts
const result = await factlens.verify({
  mode: "image_post",
  claim: "This screenshot is from the stated event.",
  image_base64: imageBase64,
  content_type: "image/png",
});
```

### Verify audio or video

```ts
const result = await factlens.verify({
  mode: "audio_video",
  audio_url: "https://example.com/interview.mp3",
  speaker: "Jane Doe",
});

console.log(result.transcript);
console.log(result.verdictId);
```

For long form SDK requests, use `audio_url`. Inline `audio_base64` remains available for smaller media. If you already have a transcript, send it through Verify instead of uploading audio. The first 100,000 transcript characters use the normal one credit charge; each additional 30,000 characters or part thereof adds one credit:

```ts
await factlens.verify({
  mode: "audio_video",
  transcript: existingTranscript,
  claim: "Optional specific claim to verify",
});
```

### Source preferences

Source preferences apply only to the current verification request. Trusted domains are prioritized when matching evidence is available. Blocked domains are excluded and take precedence if a domain appears in both lists. Neither list is saved to your account, project, API key, or CLI configuration.

SDK:

```ts
await factlens.verify({
  mode: "text",
  claim: "A claim to verify",
  trusted_domains: ["reuters.com", "apnews.com"],
  blocked_domains: ["example.com"],
});
```

CLI:

```bash
factlens verify "A claim to verify" --trusted-domains reuters.com,apnews.com --blocked-domains example.com
```

### Runtime usage

```ts
const usage = await factlens.usage.get();
```

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

`projects.select()` only changes the default project for management calls. Runtime project identity is bound to the project API key by the server.

To use another project's runtime key, create another client:

```ts
const staging = factlens.withApiKey(process.env.FACTLENS_STAGING_API_KEY!);
await staging.verify({ mode: "text", claim: "..." });
```

## Request control

SDK requests support timeout, cancellation, request IDs, bounded retries, and progress callbacks:

```ts
import { randomUUID } from "node:crypto";

const controller = new AbortController();

await factlens.verify(
  { mode: "text", claim: "..." },
  {
    signal: controller.signal,
    timeout: 90_000,
    requestId: randomUUID(),
    maxRetries: 2,
    onProgress(progress) {
      console.log(progress.state, progress.elapsedMs);
    },
  },
);
```

Verify automatically receives an `X-Request-ID` when you do not provide one. Automatic retries and `REQUEST_IN_PROGRESS` polling within one invocation reuse that request ID so an in-progress or completed idempotent request is not executed twice.

## Errors

FactLens errors are structured and actionable.

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

Credential errors direct developers to `https://api.factlens.pro/dashboard` to create or copy the correct credential.

`409 REQUEST_IN_PROGRESS` is not surfaced as a terminal error while the configured request timeout remains. The SDK keeps the same request ID, follows the server's `Retry-After` guidance, and continues polling. Ordinary validation, authentication, quota, billing, ownership, and request-ID conflict errors are not retried. Retryable network errors, `408`, `429`, and retryable `5xx` responses use the bounded retry budget.

See [Errors and retries](docs/errors-and-retries.md).

## Browser safety

FactLens credentials are secrets. The SDK refuses to initialize with secret credentials in a browser-like environment by default.

`dangerouslyAllowBrowser: true` exists only as an explicit escape hatch for environments where you fully control the credential exposure. It should not be used with production secrets.

## Limits

Current developer-account limits are account-wide. Eligible free accounts receive 30 shared requests per UTC day. Paid API credits use the current rate: **$1 funds 30 API checks**.

| | Free | Paid |
|---|---:|---:|
| Projects | 3 | 100 |
| Active keys per project | 1 | 10 |
| Daily free requests | 30 shared | 0 |
| Throughput | 20/min shared | 60/min shared |
| Purchased balance | — | Shared across all projects |

Media verification is metered by the request. Audio is limited to 3 hours and costs one API credit per 10 minutes or part thereof. Direct transcript input includes the first 100,000 characters in the normal one credit charge, then adds one credit for each additional 30,000 characters or part thereof.

Existing unused paid balances are migrated by the FactLens API backend to the current request-credit scale. The SDK reads the resulting account balance from the API and does not perform local conversion.

Keys, logs, requests, and metrics remain project-attributed.

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

See [SECURITY.md](SECURITY.md). Do not open public issues containing live API keys, developer tokens, or sensitive request payloads.

## License

MIT
