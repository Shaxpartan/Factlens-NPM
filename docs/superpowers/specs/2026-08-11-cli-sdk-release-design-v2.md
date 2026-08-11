# FactLens CLI + SDK Release Design v2

## Goal

Ship one public `factlens` npm package that works as both the official Node.js/TypeScript SDK and a production-grade CLI, while enforcing the intended product boundary: FactLens exposes verification, not standalone managed AI, search, or transcription services.

## Product boundary

Public runtime capabilities are:

- Verify text claims.
- Verify image/post claims.
- Verify audio/video by letting the verification pipeline transcribe internally when required.
- Read runtime usage.

Standalone managed Search, AI, and Transcribe are not public customer capabilities. They remain internal stages of the verification backend and must not appear as CLI commands or SDK methods.

The public SDK must not expose `search()`, `ai()`, or `transcribe()`. The public CLI must not expose `factlens search`, `factlens ai`, or `factlens transcribe`.

## User credential flow

### Runtime

1. User opens `https://api.factlens.pro/dashboard` and signs in.
2. User creates or selects a project.
3. User creates a project API key (`fl_live_...`). The secret is shown once.
4. User supplies it through either `FACTLENS_API_KEY` or `factlens configure`.
5. SDK/CLI uses it for Verify and runtime Usage only.

### Management

1. User creates a developer token (`fldev_live_...`) in the dashboard.
2. User supplies it through `FACTLENS_DEVELOPER_TOKEN` or `factlens configure`.
3. SDK/CLI uses it for Account, Projects, Keys, account Usage, Logs, and Request inspection.

Environment variables always override saved CLI configuration.

## CLI command surface

### Startup/configuration

- `factlens --help`
- `factlens --version`
- `factlens configure`
- `factlens config show`
- `factlens config clear`
- `factlens doctor`

Saved configuration is placed in the OS user configuration directory, never the working repository. Secrets are masked when displayed.

### Runtime

- `factlens verify <claim>`
- `factlens verify --file <text-file>`
- `factlens verify --image <image-file> --claim <claim>`
- `factlens verify --audio <audio-file> [--claim <claim>]`
- `factlens usage`

Request controls where relevant:

- `--timeout <ms>`
- `--request-id <uuid>`
- `--retries <0-5>`
- `--json`

### Management

- `factlens account`
- `factlens projects list`
- `factlens projects create <name>`
- `factlens projects update <project-id> <name>`
- `factlens projects delete <project-id>`
- `factlens projects select <project-id>`
- `factlens keys list [--project <id>]`
- `factlens keys create <label> [--project <id>]`
- `factlens keys revoke <key-id> [--project <id>]`
- `factlens usage --account [--project <id>]`
- `factlens logs [--project <id>] [--limit <n>] [--endpoint verify] [--status success|failed]`
- `factlens request <request-id>`

Selected project affects management commands only; runtime project identity remains bound to the project API key.

## Error contract

The SDK remains the source of truth for transport/API errors; the CLI formats them.

Every public error exposes when known:

- stable `code`;
- human `message`;
- HTTP `status`;
- `requestId`;
- `retryable`;
- structured `details`;
- `stage` for verification-stage failures;
- actionable `helpUrl` where relevant.

Credential errors must explicitly direct developers to `https://api.factlens.pro/dashboard`.

Verification failures must identify the failing internal stage without exposing managed provider credentials or implementation secrets. Required normalized stages are:

- `transcription`
- `search`
- `analysis`
- `moderation`
- `verification`

Examples:

- transcription failure: “FactLens could not transcribe the supplied audio. Retry the verification request with a new request ID.”
- search failure: “FactLens could not retrieve evidence for this verification request.”
- analysis failure: “FactLens could not complete the evidence analysis for this verification request.”
- moderation unavailable: “FactLens could not complete the required safety check for this verification request.”

The backend code remains the source of the stage; the CLI/SDK must not guess a stage from free-form prose.

`--json` emits machine-readable errors to stderr/stdout consistently with stable fields and no decorative copy.

## CLI output

Human output is concise: result/verdict, explanation, evidence strength/confidence, sources, request ID, response time, and usage when present. JSON output is stable and automation-friendly. Successful command data goes to stdout; diagnostics/errors go to stderr.

## SDK compatibility

Preserve existing `FactLens` default/named exports, CJS/ESM/TypeScript support, management resources, request IDs, retries, cancellation, and timeout controls.

Remove the unpublished direct `search()`, `ai()`, and `transcribe()` SDK methods and their public types/docs before the first npm release.

Add only backward-compatible support needed for CLI quality:

- actionable credential configuration errors;
- help URL metadata;
- stage-aware errors from backend responses;
- separate runtime/management base URL overrides for direct live Supabase verification while production defaults remain `https://api.factlens.pro`.

## Backend verification target

While `api.factlens.pro` is unavailable, tests point directly to the live Supabase functions:

- runtime Verify/Usage: `factlens-api`
- management: `factlens-api-platform`

No standalone Search/AI/Transcribe test is treated as a supported success path. Direct attempts must be rejected by the backend after the backend release.

## Repository/public-package cleanup

Before public release:

- package metadata/docs/examples/changelog/security/license are coherent;
- no tracked secrets, tarballs, local CLI config, editor junk, or accidental build artifacts;
- npm `files` remains a strict allowlist;
- `npm pack --dry-run` contains only intended runtime artifacts;
- no stale claims that standalone AI/search/transcription are public capabilities;
- no development-process commentary in public docs.

## Testing

Use TDD. Add focused tests for:

- CLI argument parsing/help/version;
- config storage, precedence, masking and clear;
- runtime verify text/image/audio mapping;
- management commands;
- human/JSON success output;
- exit codes;
- credential and stage-aware errors;
- file/media validation;
- CJS/ESM imports;
- package `bin` output;
- exact npm pack contents;
- absence of public Search/AI/Transcribe methods/commands/docs.

Run the full `npm run check` and all new tests before release.

## Release discipline

- Isolated branch.
- Surgical edits only.
- No Extension changes.
- Merge to `main` once after final verification.
- Fast-forward `V50.0.0` once to the final `main` commit without force.
- Verify `main` and `V50.0.0` are identical.
