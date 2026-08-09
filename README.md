# FactLens Node.js & TypeScript SDK

[![npm version](https://img.shields.io/npm/v/factlens.svg)](https://www.npmjs.com/package/factlens)
[![CI](https://github.com/Shaxpartan/Factlens-NPM/actions/workflows/ci.yml/badge.svg)](https://github.com/Shaxpartan/Factlens-NPM/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-31f50a.svg)](LICENSE)

The official server-side Node.js and TypeScript SDK for the FactLens API.

FactLens separates two security boundaries:

- **Project API keys** call Verify, Search, AI, Transcribe, and runtime usage. Each key is bound to one project by the server.
- **Developer tokens** manage your developer account: projects, API keys, account usage, project logs, and request inspection.

Balance and throughput are account-wide. Keys, logs, requests, and metrics remain project-attributed.

> This repository is prepared for npm publication, but `factlens` is not published from this repository until a FactLens maintainer runs the release workflow.

## Install

```bash
npm install factlens
```

Node.js 18 or newer is required.

## Quick start

Create a project API key in the [FactLens developer dashboard](https://api.factlens.pro/dashboard), store it in server-side secret storage, and initialize the client:

```ts
import FactLens from "factlens";

const factlens = new FactLens({
  apiKey: process.env.FACTLENS_API_KEY!,
});

const result = await factlens.verify({
  claim: "The Eiffel Tower is in Paris.",
});

console.log(result.verdictId);
console.log(result.explanation);
console.log(result.usage);
```

The SDK also reads `FACTLENS_API_KEY` automatically in Node.js:

```ts
const factlens = new FactLens();
const result = await factlens.verify({ claim: "Example claim" });
```

## Runtime API

### Verify

```ts
const result = await factlens.verify({
  claim: "Example claim",
  mode: "text",
});
```

Image and audio/video verification use the same method:

```ts
await factlens.verify({
  mode: "image_post",
  claim: "The image shows the stated event.",
  image_base64: imageBase64,
});

await factlens.verify({
  mode: "audio_video",
  audio_base64: audioBase64,
  content_type: "audio/webm",
});
```

### Search

```ts
const result = await factlens.search({
  query: "primary sources about the claim",
  count: 10,
});
```

### AI

```ts
const result = await factlens.ai<{ summary: string }>({
  prompt: "Return JSON with a concise summary.",
  response_format: "json",
});
```

### Transcribe

```ts
import { readFile } from "node:fs/promises";

const audio = await readFile("clip.webm");
const result = await factlens.transcribe({
  audio,
  contentType: "audio/webm",
});
```

`Buffer` works directly because it is a `Uint8Array` in Node.js.

### Runtime usage

```ts
const usage = await factlens.usage.get();
```

## Account management

Account management uses a separate developer token. Create one under **Dashboard → Account → Developer tokens**, then store it as `FACTLENS_DEVELOPER_TOKEN`.

```ts
const factlens = new FactLens({
  apiKey: process.env.FACTLENS_API_KEY,
  developerToken: process.env.FACTLENS_DEVELOPER_TOKEN,
});

const projects = await factlens.projects.list();
const project = await factlens.projects.create({ name: "Production" });

factlens.projects.select(project.id);

const createdKey = await factlens.keys.create({ label: "Backend" });
console.log(createdKey.api_key); // shown once

const account = await factlens.account.get();
const usage = await factlens.usage.getAccount();
const logs = await factlens.logs.list({ limit: 50 });
```

### Project selection

`projects.select()` changes the default project for **management calls only**:

```ts
factlens.projects.select(projectId);
await factlens.keys.list();
await factlens.logs.list();
```

It cannot change the project used by a runtime API key. Runtime project identity is bound to the key by the FactLens API.

To use another project's runtime key, create a child client:

```ts
const staging = factlens.withApiKey(process.env.FACTLENS_STAGING_API_KEY!);
await staging.verify({ claim: "..." });
```

## Request control

Every request method supports timeout, cancellation, request IDs, and retry control:

```ts
const controller = new AbortController();

await factlens.verify(
  { claim: "..." },
  {
    signal: controller.signal,
    timeout: 45_000,
    requestId: crypto.randomUUID(),
    maxRetries: 2,
  },
);
```

Chargeable requests automatically receive an `X-Request-ID`. Retries reuse the same request ID so the FactLens API can return the existing result instead of charging or executing the request twice.

## Errors

```ts
import FactLens, { FactLensError } from "factlens";

try {
  await factlens.verify({ claim: "..." });
} catch (error) {
  if (error instanceof FactLensError) {
    console.error(error.status);
    console.error(error.code);
    console.error(error.requestId);
    console.error(error.retryable);
  }
}
```

See [Errors and retries](docs/errors-and-retries.md).

## Browser safety

FactLens credentials are server secrets. The SDK refuses to initialize with a secret credential in a browser-like environment by default.

If you deliberately understand and accept that risk, `dangerouslyAllowBrowser: true` exists as an explicit escape hatch. It should not be used for production secret keys.

## Limits

Current platform limits are account-wide:

| | Free | Paid |
|---|---:|---:|
| Projects | 3 | 100 |
| Active keys per project | 1 | 10 |
| Daily free requests | 100 shared | 0 |
| Throughput | 20/min shared | 60/min shared |
| Purchased balance | — | Shared across all projects |

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
- [Full HTTP API documentation](https://api.factlens.pro/docs)

## Security

See [SECURITY.md](SECURITY.md). Do not open public issues containing live API keys, developer tokens, or sensitive request payloads.

## License

MIT
