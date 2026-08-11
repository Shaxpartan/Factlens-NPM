# FactLens CLI + SDK Verify-Only Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `factlens@1.0.0` as a production-grade Node/TypeScript SDK plus CLI that exposes verification and management only, with secure configuration and actionable errors.

**Architecture:** One npm package exports the existing SDK and a `factlens` executable through `bin`. The CLI calls the SDK rather than duplicating HTTP logic. Runtime Verify uses the project API key; management resources use the developer token. Environment variables override OS user configuration. Standalone managed Search/AI/Transcribe are removed from the unpublished SDK and never become CLI commands.

**Tech Stack:** TypeScript, Node >=18, CommonJS + ESM + declarations, `node:test`, npm package `bin`.

## Global Constraints

- No public `search()`, `ai()`, or `transcribe()` SDK methods.
- No `factlens search`, `factlens ai`, or `factlens transcribe` CLI commands.
- Verify supports text, image/post, and audio/video input.
- `factlens configure` and env vars are both supported; env vars win.
- Saved secrets are masked in output and stored only in the OS user config directory.
- Human output by default; stable `--json` for automation.
- Errors preserve stable backend code/status/request ID/stage while adding actionable dashboard guidance.
- Package remains one SDK+CLI artifact named `factlens`.
- Clean public repository/package contents; no tarballs or local config committed.
- Surgical edits only.
- Final release merges `main` once and fast-forwards `V50.0.0` once.

---

### Task 1: RED public-surface cleanup

**Files:**
- Create: `tests/verify-only-surface.test.mjs`
- Modify later: `src/client.ts`, `src/types/index.ts`, `README.md`, examples/docs if present.

- [ ] Add failing tests proving built SDK has `verify` but no `search`, `ai`, or `transcribe`; source types/docs do not advertise those standalone products.
- [ ] Verify RED.
- [ ] Remove only the unpublished standalone methods/types/examples.
- [ ] Verify GREEN.

### Task 2: RED actionable SDK error contract

**Files:**
- Modify: `src/errors.ts`
- Modify: `src/http.ts`
- Modify: `src/types/index.ts`
- Create/modify: `tests/errors.test.mjs`

**Interfaces:**
- `FactLensError` adds `stage?: VerificationStage` and `helpUrl?: string`.
- Runtime/management missing-credential messages point to `https://api.factlens.pro/dashboard`.
- HTTP parser preserves `stage`, `details`, code, status, request ID, retryability.

- [ ] Add RED tests for missing runtime key, missing developer token, invalid key, stage-aware error parsing, timeout, network failure, abort, rate limit, and request-in-progress.
- [ ] Verify RED.
- [ ] Implement minimal error metadata/message changes.
- [ ] Verify GREEN.

### Task 3: Runtime/management base URL split for direct Supabase verification

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/client.ts`
- Modify: `src/http.ts`
- Tests: transport/client tests.

- [ ] Add RED tests for `runtimeBaseUrl` and `managementBaseUrl` overrides while retaining `baseUrl` compatibility/default `https://api.factlens.pro`.
- [ ] Implement auth-kind-aware base URL selection.
- [ ] Verify GREEN.

### Task 4: CLI configuration

**Files:**
- Create: `src/cli/config.ts`
- Create: `src/cli/output.ts`
- Create: `src/cli/index.ts`
- Create: `tests/cli-config.test.mjs`

**Interfaces:**
- `factlens configure`
- `factlens config show`
- `factlens config clear`
- env vars override saved config.
- Save path uses platform user config directory and file mode 0600 where supported.

- [ ] Add RED tests for path selection, read/write/clear, precedence, masking, malformed config recovery.
- [ ] Implement minimal config helpers.
- [ ] Verify GREEN.

### Task 5: CLI parser/startup/doctor

**Files:**
- Modify: `src/cli/index.ts`
- Create: `tests/cli-core.test.mjs`
- Modify: `package.json`
- Modify: build/finalization script only as needed to preserve executable shebang/permissions.

- [ ] Add RED tests for `--help`, `--version`, unknown command, `configure`, `config`, `doctor`, `--json`, exit codes, stdout/stderr discipline.
- [ ] Add `bin: { "factlens": "./dist/esm/cli/index.js" }` or equivalent executable build path.
- [ ] Ensure CLI output has a Node shebang and remains executable after build/pack.
- [ ] Verify GREEN.

### Task 6: CLI Verify + Usage

**Files:**
- Modify: `src/cli/index.ts`
- Create helper if necessary: `src/cli/verify-input.ts`
- Create: `tests/cli-runtime.test.mjs`

- [ ] RED tests for `factlens verify <claim>`, `--file`, `--image --claim`, `--audio [--claim]`, `--timeout`, `--retries`, `--request-id`, and `factlens usage`.
- [ ] Validate readable files, supported image/audio MIME extensions, non-empty claims, mutually exclusive input modes, and maximum file sizes before network calls.
- [ ] Encode image/audio to base64 and call `FactLens.verify()` only.
- [ ] Human success output includes verdict, explanation, confidence/evidence strength, sources, request ID, timing and usage when present.
- [ ] JSON mode outputs the raw success envelope.
- [ ] Verify GREEN.

### Task 7: CLI management commands

**Files:**
- Modify: `src/cli/index.ts`
- Tests: `tests/cli-management.test.mjs`

- [ ] RED tests for account, projects list/create/update/delete/select, keys list/create/revoke, account usage, logs, request detail.
- [ ] Persist selected project for management convenience only.
- [ ] Mask one-time created API key everywhere except the explicit successful creation output; JSON returns the exact server response once.
- [ ] Verify GREEN.

### Task 8: Documentation/public repository cleanup

**Files:**
- Rewrite/update: `README.md`, `CHANGELOG.md`, `SECURITY.md` only where needed.
- Remove superseded spec that advertises standalone Search/AI/Transcribe.
- Keep release workflow aligned with public-repo provenance once repository is public.

- [ ] README begins with install + first Verify using SDK and CLI.
- [ ] Explain project API keys vs developer tokens and dashboard flow.
- [ ] Document `factlens configure`, env vars, CLI commands, SDK Verify, management, errors, JSON mode, CI usage, security.
- [ ] No standalone Search/AI/Transcribe examples or claims.
- [ ] No generated tarball or local config in Git/package.

### Task 9: Full package verification

- [ ] Run all CLI/SDK tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test`.
- [ ] Run example typecheck.
- [ ] Run `npm run check`.
- [ ] Inspect `npm pack --dry-run` and require only intended published files, including CLI executable output.
- [ ] Test CJS import, ESM import, `node dist/... --help`, and packed package installation in a temporary directory.

### Task 10: Direct live Supabase contract verification

- [ ] Point runtime transport to the live `factlens-api` Supabase function and management transport to `factlens-api-platform` without changing production defaults.
- [ ] Verify missing/invalid credentials locally/directly.
- [ ] If a safe existing test credential is available through secure project tooling, run Verify/Usage/management E2E; otherwise do not expose or invent secrets and report the limitation.

### Task 11: Release verification and promotion

- [ ] Use `superpowers:verification-before-completion`.
- [ ] Open PR and inspect exact changed paths/checks.
- [ ] Squash merge to `main` once after all checks pass.
- [ ] Fast-forward `V50.0.0` non-force.
- [ ] Verify `main` and `V50.0.0` are identical.
