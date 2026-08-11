# Authentication

FactLens keeps runtime and account-management credentials separate.

Create and manage credentials at `https://api.factlens.pro/dashboard`.

## Project API keys

Project API keys begin with `fl_live_` or `fl_test_`. The server binds each key to one project. A project key authorizes:

- `factlens.verify()`
- `factlens.usage.get()`
- the equivalent Verify/runtime Usage CLI and REST operations

It does not authorize generic managed search, AI, or transcription services. Those are internal verification stages.

A project key cannot select another project, create projects or keys, or inspect account-management resources.

## Developer tokens

Developer tokens begin with `fldev_live_` or `fldev_test_`. They authorize account, project, key, account-usage, log, and request-inspection operations from a trusted server.

```ts
const account = await factlens.account.get();
const projects = await factlens.projects.list();
const logs = await factlens.logs.list({ limit: 50 });
```

The CLI uses the same credential class for management commands such as `factlens projects list`, `factlens keys list`, and `factlens logs`.

## Environment variables

```dotenv
FACTLENS_API_KEY=fl_live_...
FACTLENS_DEVELOPER_TOKEN=fldev_live_...
```

Environment variables override credentials saved by `factlens configure`.

Never expose either credential in browser JavaScript, a mobile application, a public repository, logs, analytics, or support messages. The SDK rejects browser-like secret use by default.
