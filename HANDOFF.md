# FactLens npm SDK handoff

Updated: 2026-08-10

## Release identity

- Package: `factlens`
- Package version: `1.0.0`
- Repository: `Shaxpartan/Factlens-NPM`
- GitHub branches: `main` and `V50.0.0`
- npm publication: intentionally not performed by this task

## Supported surface

- Node.js 18 or newer, TypeScript-first, zero runtime dependencies.
- Dual ESM and CommonJS exports with generated declaration files and source maps.
- Runtime project-key methods: `verify`, `search`, `ai`, `transcribe`, and `usage.get`.
- Developer-token resources: `account`, `projects`, `keys`, `logs`, request inspection, and `usage.getAccount`.
- Server-only credential guard, configurable fetch/base URL, timeouts, abort signals, normalized errors, automatic request IDs, replay-safe retry behavior, and project selection helpers.

## Fresh verification

- `npm run check`: passed.
- TypeScript type-check: passed.
- Offline mocked tests: 16/16 passed; no FactLens API availability was required.
- Examples type-check: passed.
- `npm pack --dry-run`: passed; `factlens-1.0.0.tgz`, 67 files, 19.0 kB compressed, 112.6 kB unpacked.
- Fresh packed consumer install: CommonJS passed; ESM passed on Node.js 18.20.8.
- Production dependency audit: 0 vulnerabilities.
- `prepack` rebuilds the package so manually packed/published output cannot be stale.

## Publication procedure

1. Confirm GitHub `main` and `V50.0.0` reference the same verified commit.
2. Let GitHub CI run `npm run check` on Node 18, 20, and 22.
3. Publish only through the manual release workflow with npm trusted publishing/provenance configured.
4. Confirm the package version remains `1.0.0` for the first npm release.

Do not put project API keys or developer tokens in browser bundles. The SDK rejects browser-like secret use unless the caller explicitly accepts that risk.
