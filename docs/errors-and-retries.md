# Errors and retries

HTTP, API, configuration, timeout, and transport failures use structured FactLens errors.

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
    console.error(error.stage);
    console.error(error.details);
    console.error(error.helpUrl);
  }
}
```

Credential errors include a help URL pointing to `https://api.factlens.pro/dashboard` when the developer needs to create or copy a valid project API key or developer token.

## Verification stages

When the Verify pipeline cannot complete, the backend returns a stable public error code plus a normalized stage:

| Code | Stage | Meaning |
|---|---|---|
| `VERIFICATION_TRANSCRIPTION_FAILED` | `transcription` | Supplied audio could not be transcribed for verification. |
| `VERIFICATION_SEARCH_FAILED` | `search` | FactLens could not retrieve evidence. |
| `VERIFICATION_ANALYSIS_FAILED` | `analysis` | Evidence analysis or structured verdict generation failed. |
| `VERIFICATION_MODERATION_FAILED` | `moderation` | A required safety check blocked the request or could not complete safely. |
| `VERIFICATION_FAILED` | `verification` | An uncategorized verification-stage failure occurred. |

The SDK preserves `stage`, `details`, the HTTP status, and the server request ID. It does not expose managed provider credentials.

## Retry behavior

The SDK retries only network failures, `408`, `429`, retryable `5xx`, and `409 REQUEST_IN_PROGRESS`. It does not retry ordinary authentication, validation, quota, billing, ownership, or request-ID conflict errors.

`Retry-After` is honored. Otherwise the SDK uses bounded exponential backoff with jitter. Retries within one operation reuse the same UUID request ID, preventing duplicate execution.

If a final internal verification-stage failure is returned and the request is refunded, begin a fresh verification attempt with a new request ID.

```ts
await factlens.verify(input, {
  timeout: 90_000,
  maxRetries: 2,
  requestId: crypto.randomUUID(),
  signal: controller.signal,
});
```

## CLI errors

Human mode prints an actionable error with code, HTTP status, stage, request ID, and help URL where available.

For automation:

```bash
factlens verify "Example" --json
```

Structured CLI errors contain stable fields such as `code`, `message`, `status`, `requestId`, `retryable`, `stage`, `details`, and `helpUrl`.
