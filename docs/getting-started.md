# Getting started

## Requirements

- Node.js 18 or newer
- A FactLens developer account
- A project API key for verification/runtime usage
- A developer token only when you need account-management operations

## Install

```bash
npm install factlens
```

A local install provides the SDK and an `npx`-accessible CLI:

```bash
npx factlens --help
```

For a bare `factlens` command from any directory:

```bash
npm install -g factlens
```

## Get a project API key

1. Sign in at `https://api.factlens.pro/dashboard`.
2. Create or select a project.
3. Create an API key.
4. Copy the key immediately; the plaintext secret is shown once.
5. Store it in your server secret manager as `FACTLENS_API_KEY`, or save it with `factlens configure` for local CLI use.

```bash
factlens configure
factlens doctor
factlens verify "The Eiffel Tower is in Paris."
```

SDK:

```ts
import FactLens from "factlens";

const factlens = new FactLens();
const result = await factlens.verify({
  mode: "text",
  claim: "The Eiffel Tower is in Paris.",
});
```

## Get a developer token

Developer tokens are for trusted server-side account management. In the dashboard, create a developer token, copy it once, and store it as `FACTLENS_DEVELOPER_TOKEN` or save it with `factlens configure`.

You do **not** need a developer token to call Verify or runtime Usage. Search, AI analysis, and transcription are internal verification stages rather than standalone public runtime operations.

## Environment variables

Environment variables override saved CLI configuration:

```dotenv
FACTLENS_API_KEY=fl_live_...
FACTLENS_DEVELOPER_TOKEN=fldev_live_...
```

For controlled direct-backend testing only, runtime and management base URLs can be overridden separately:

```dotenv
FACTLENS_RUNTIME_BASE_URL=https://example.test/functions/v1/factlens-api
FACTLENS_MANAGEMENT_BASE_URL=https://example.test/functions/v1/factlens-api-platform
```
