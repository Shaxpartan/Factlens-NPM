# Errors and retries

HTTP and transport failures throw `FactLensError`.

```ts
import { FactLensError } from "factlens";

try {
  await factlens.verify({ mode: "text", claim: "Example" });
} catch (error) {
  if (error instanceof FactLensError) {
    console.error(error.status);
    console.error(error.code);
    console.error(error.requestId);
    console.error(error.retryable);
    console.error(error.details);
  }
}
```

The SDK retries only network failures, `408`, `429`, `5xx`, and `409 REQUEST_IN_PROGRESS`. It does not retry ordinary authentication, validation, quota, billing, ownership, or request-ID conflict errors.

`Retry-After` is honored. Otherwise the SDK uses bounded exponential backoff with jitter. Runtime and management mutation retries reuse the same UUID request ID, preventing duplicate execution.

If the API returns a final provider-side `5xx` and refunds the request, begin a new operation with a new request ID. Do not reuse a completed or refunded request ID for fresh work.

```ts
await factlens.verify(input, {
  timeout: 45_000,
  maxRetries: 2,
  requestId: crypto.randomUUID(),
  signal: controller.signal,
});
```
