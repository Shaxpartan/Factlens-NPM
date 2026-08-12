# Changelog

All notable changes to this package are documented here.

## 1.0.7 - 2026-08-12

- Render every successful multi-claim result in human-readable CLI output while printing request metadata once.
- Keep one `X-Request-ID` across long verification reconnects and continue polling `REQUEST_IN_PROGRESS` without consuming the normal retry budget.
- Use a 180-second overall verification deadline for text, file, image, and audio verification unless explicitly overridden.
- Synchronize SDK request metadata with package version 1.0.7.

## 1.0.0

- Add the FactLens verification SDK and CLI with runtime usage and developer account/project/key management.
- Add stable request IDs, conservative retries, timeout and cancellation support, and structured errors.
- Add ESM, CommonJS, and TypeScript declaration builds with zero runtime dependencies.
