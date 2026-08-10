# Getting started

## Requirements

- Node.js 18 or newer
- A FactLens developer account
- A project API key for runtime requests
- A developer token only when your server needs account-management methods

The intended release installs as:

```bash
npm install factlens
```

The package is currently prepared in GitHub and is not yet published to npm.

## Get a project API key

1. Sign in to the [FactLens developer dashboard](https://api.factlens.pro/dashboard).
2. Create or select a project.
3. Open **API keys** and create a key.
4. Copy the key immediately. The plaintext value is shown once.
5. Store it in your server's secret manager as `FACTLENS_API_KEY`.

```ts
import FactLens from "factlens";

const factlens = new FactLens();
const result = await factlens.verify({
  mode: "text",
  claim: "The Eiffel Tower is in Paris.",
});
```

## Get a developer token

Developer tokens are for trusted server-side account management. In the dashboard, open **Account -> Developer tokens**, create a token, copy it once, and store it as `FACTLENS_DEVELOPER_TOKEN`.

You do not need a developer token to call Verify, Search, AI, Transcribe, or runtime usage.
