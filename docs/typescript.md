# TypeScript

The package includes declarations and exports its public request, response, resource, verification-stage, and error types.

```ts
import FactLens, {
  type RequestOptions,
  type VerificationStage,
  type VerifyInput,
  type VerifyResponse,
} from "factlens";

const input: VerifyInput = {
  mode: "text",
  claim: "Example claim",
};

const options: RequestOptions = { timeout: 90_000 };
const client = new FactLens({ apiKey: process.env.FACTLENS_API_KEY });
const result: VerifyResponse = await client.verify(input, options);
```

Verification-stage failures expose `error.stage` as one of:

```ts
type VerificationStage =
  | "transcription"
  | "search"
  | "analysis"
  | "moderation"
  | "verification";
```

Search, AI, and transcription are internal verification stages and are intentionally not exported as standalone runtime SDK methods or request/response types.

The package supports native ESM imports and CommonJS `require()` on Node.js 18 or newer.
