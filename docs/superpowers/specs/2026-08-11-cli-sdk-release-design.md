# FactLens CLI + SDK Release Design

## Goal

Ship one public `factlens` npm package that works as both:

- a production-grade Node.js/TypeScript SDK; and
- a production-grade `factlens` command-line interface.

The CLI must reuse the SDK transport/resources rather than implementing a second HTTP client. Runtime and management behavior must remain aligned with the live Supabase backend. The public API documentation at `api.factlens.pro/docs` must document both interfaces at the same quality level.

## Scope

### Factlens-NPM

Add the CLI, configuration storage, advanced command parsing, polished human output, structured JSON output, actionable errors, startup guide, tests, package metadata, and documentation. Clean public-package metadata and source docs so the repository is appropriate to make public.

### Factlens-API

Update developer documentation to include CLI installation, setup, runtime commands, management commands, authentication/error guidance, SDK examples, and direct REST parity. Change backend code only if direct live verification proves an actual CLI/SDK contract mismatch.

### Live Supabase

Verify the current runtime and management Edge Functions directly. Do not deploy an Edge Function unless a real compatibility defect is demonstrated and fixed. If deployment is required, deploy each affected function once after all verification is complete.

### Explicitly out of scope

- FactLens browser extension.
- Unrelated website/admin changes.
- Billing model changes.
- Provider routing changes.
- New Netlify functions.

## User credential flow

### Runtime API calls

1. User opens `https://api.factlens.pro/dashboard` and signs in.
2. User creates or selects a project.
3. User creates a project API key (`fl_live_...`). The secret is shown once.
4. User supplies it through either:
   - `FACTLENS_API_KEY`; or
   - `factlens configure` local configuration.
5. The CLI/SDK uses the project key for Verify, Search, AI, Transcribe, and runtime Usage.

Environment variables always override saved CLI configuration so CI/CD and server deployments remain predictable.

### Account-management calls

1. User opens the dashboard and creates a developer token (`fldev_live_...`).
2. User supplies it through either:
   - `FACTLENS_DEVELOPER_TOKEN`; or
   - `factlens configure` local configuration.
3. The CLI/SDK uses the developer token for account, project, key, usage, logs, and request-inspection operations.

The two credential classes remain intentionally separate. A project key used on a management command must produce a clear credential-type error.

## CLI command surface

The package exposes a `factlens` binary and therefore supports local install, global install, and `npx factlens ...`.

### Startup and configuration

- `factlens --help`
- `factlens --version`
- `factlens configure`
- `factlens config show`
- `factlens config clear`
- `factlens doctor`

`configure` accepts interactive prompts when attached to a terminal and non-interactive flags for automation. Secrets are never echoed back after entry. `config show` displays only masked credentials and their source (`environment` or saved config).

Saved configuration is stored in an OS-appropriate user configuration directory and written with owner-only permissions where the platform supports them:

- Windows: `%APPDATA%/FactLens/config.json`
- macOS: `~/Library/Application Support/FactLens/config.json`
- Linux/other Unix: `$XDG_CONFIG_HOME/factlens/config.json` or `~/.config/factlens/config.json`

No credentials are written to the repository or current working directory.

### Runtime commands

- `factlens verify <claim>`
- `factlens verify --file <text-file>`
- `factlens verify --image <image-file> --claim <claim>`
- `factlens verify --audio <audio-file> [--claim <claim>]`
- `factlens search <query> [--count <n>]`
- `factlens ai <prompt>`
- `factlens ai --file <prompt-file>`
- `factlens ai <prompt> --image <image-file>`
- `factlens transcribe <audio-file> [--language <code>]`
- `factlens usage`

Runtime commands accept request-control flags where relevant:

- `--timeout <ms>`
- `--request-id <uuid>`
- `--retries <0-5>`
- `--json`

### Management commands

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
- `factlens logs [--project <id>] [--limit <n>] [--endpoint <name>] [--status success|failed]`
- `factlens request <request-id>`

A selected project may be persisted in CLI config for management convenience only. Runtime project identity remains bound to the project API key and cannot be changed by `projects select`.

## Output contract

### Human output

Default output is concise and readable:

- success headline;
- key result fields;
- request ID when present;
- usage summary when present;
- next-step guidance only when useful.

Secrets returned once by key-creation commands are clearly marked as one-time values and never repeated by later commands.

### JSON output

`--json` writes machine-readable JSON to stdout and avoids decorative text. Errors also use JSON with stable fields:

```json
{
  "ok": false,
  "error": {
    "code": "API_KEY_INVALID",
    "message": "...",
    "status": 401,
    "requestId": "...",
    "retryable": false,
    "helpUrl": "https://api.factlens.pro/dashboard"
  }
}
```

Human diagnostics go to stderr. Successful command data goes to stdout.

## Error model

The SDK remains the source of truth for transport and API errors. The CLI formats those errors; it does not invent unrelated error semantics.

Every public error should expose, when known:

- stable `code`;
- human `message`;
- HTTP `status`;
- `requestId`;
- `retryable`;
- structured `details`;
- actionable help URL when applicable.

### Required credential errors

Missing runtime key:

> FactLens project API key is missing. Create or copy a project API key from https://api.factlens.pro/dashboard, then set `FACTLENS_API_KEY` or run `factlens configure`.

Invalid/revoked/expired runtime key:

> FactLens rejected this project API key. It may be invalid, revoked, expired, or attached to an inactive project. Create or copy a valid key from https://api.factlens.pro/dashboard.

Missing developer token:

> FactLens developer token is missing. Create one from https://api.factlens.pro/dashboard, then set `FACTLENS_DEVELOPER_TOKEN` or run `factlens configure`.

Wrong credential class:

> This operation requires a FactLens developer token. Project API keys are only for runtime API requests.

### Other required error categories

Provide clear handling for invalid arguments, invalid media/file paths, malformed request IDs, rate limiting, credits exhausted, billing hold, project/account disabled, request-in-progress, request-ID conflict, provider/API unavailability, timeout, aborted request, moderation unavailable/blocked, network/DNS failures, and unknown HTTP failures.

The CLI exits `0` on success and non-zero on failure. Usage/argument errors are distinct from authentication/API/network failures where practical.

## SDK changes

Preserve existing imports and method names. Add only backward-compatible capabilities needed by CLI quality:

- actionable credential configuration errors;
- stable help URL metadata where appropriate;
- a supported way for the CLI to resolve runtime and management endpoint overrides during direct-backend testing without changing the production default `https://api.factlens.pro`;
- any missing public error fields needed for consistent CLI formatting.

Do not duplicate API operations in CLI-only code.

## Direct Supabase verification

Because `api.factlens.pro` is currently unavailable, verification targets the live Supabase Edge Functions directly:

- runtime: `factlens-api`;
- management: `factlens-api-platform`.

Verification covers:

1. Missing/invalid credential responses.
2. Runtime payload compatibility for Verify, Search, AI, Transcribe, and Usage.
3. Management payload/path compatibility for Account, Projects, Keys, account Usage, Logs, and Request inspection.
4. SDK request headers, request IDs, retries, timeouts, and error mapping.
5. CLI command-to-SDK mapping.

A temporary credential may be created only if it can be isolated and removed safely. Verification must not leave test projects, keys, requests, or secrets behind. If a successful provider-backed live call cannot be performed safely, report that limitation rather than mutating unrelated user data.

## Backend compatibility rule

Do not change the live backend merely to accommodate a CLI parsing preference. CLI request shapes must follow the canonical backend contract. Backend edits are allowed only for a demonstrated contract defect that would affect legitimate SDK/REST usage too.

## Package/repository cleanup

Before the repository is made public:

- ensure package metadata, README, docs, examples, changelog, security policy, license, CI, and publishing guidance are coherent;
- ensure no secret, private credential, generated tarball, local config, build artifact outside intended `dist`, editor junk, or temporary test file is tracked;
- ensure npm `files` continues to whitelist only intended publish artifacts;
- ensure `npm pack --dry-run` contains only production package files;
- remove stale or contradictory publication notes;
- do not include informal development-process commentary in public documentation.

## API documentation changes

`api.factlens.pro/docs` gains a first-class CLI section beside the SDK section, including:

- install options (`npm install factlens`, `npm install -g factlens`, `npx factlens`);
- first-run configuration;
- environment-variable setup;
- first Verify command;
- Search, AI, Transcribe, and Usage examples;
- account/project/key/log/request management examples;
- `--json` automation examples;
- credential separation and security guidance;
- error examples and troubleshooting.

The SDK section is expanded to equivalent depth so neither interface appears secondary.

## Testing

### Factlens-NPM

Use TDD for implementation. Add focused tests for:

- argument parsing and help/version;
- configuration path, precedence, masking, persistence, and clearing;
- CLI runtime command mapping;
- CLI management command mapping;
- file/media handling;
- human output;
- JSON output;
- exit codes;
- credential and API error formatting;
- SDK auth/error behavior;
- CJS + ESM imports;
- package `bin` output;
- pack contents.

Run the full existing `npm run check` plus the new CLI test suite.

### Factlens-API

Add documentation source-contract tests for required CLI/SDK sections and examples. Run the full existing API test suite and build.

### Live backend

Run direct Supabase probes only after local/source verification is green. Avoid unnecessary provider calls and do not deploy Edge Functions unless a backend defect is actually fixed.

## Release discipline

- Work on isolated branches.
- Surgical edits only.
- No Extension changes.
- No Netlify function additions.
- If an Edge Function must change, deploy it once after all tests are complete.
- Merge each touched repository to `main` once after verification.
- Fast-forward `V50.0.0` once to the final `main` commit without force.
- Verify `main` and `V50.0.0` are identical.
