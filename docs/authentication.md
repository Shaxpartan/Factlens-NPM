# Authentication

FactLens keeps runtime and account-management credentials separate.

## Project API keys

Project API keys begin with `fl_live_` or `fl_test_`. The server binds each key to one project. A project key can call:

- `factlens.verify()`
- `factlens.search()`
- `factlens.ai()`
- `factlens.transcribe()`
- `factlens.usage.get()`

It cannot select another project, create projects or keys, or inspect another project's requests.

## Developer tokens

Developer tokens begin with `fldev_live_` or `fldev_test_`. They authorize account, project, key, usage, and log management from a trusted server. Tokens are hashed at rest, shown once, revocable, and limited to five active tokens per account.

## Environment variables

```dotenv
FACTLENS_API_KEY=fl_live_...
FACTLENS_DEVELOPER_TOKEN=fldev_live_...
```

Never expose either credential in browser JavaScript, a mobile application, a public repository, logs, analytics, or support messages. The SDK rejects browser-like use by default.
