# TypeScript

The package includes declarations and exports its public request, response, resource, and error types.

```ts
import FactLens, {
  type RequestOptions,
  type VerifyInput,
  type VerifyResponse,
} from "factlens";

const input: VerifyInput = {
  mode: "text",
  claim: "Example claim",
};

const options: RequestOptions = { timeout: 30_000 };
const client = new FactLens({ apiKey: process.env.FACTLENS_API_KEY });
const result: VerifyResponse = await client.verify(input, options);
```

`factlens.ai<T>()` types the `output` field without changing the server response.

The package supports native ESM imports and CommonJS `require()` on Node.js 18 or newer.
