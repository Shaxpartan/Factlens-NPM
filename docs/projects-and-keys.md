# Projects and keys

Management methods require a developer token.

```ts
const projects = await factlens.projects.list();
const project = await factlens.projects.create({ name: "Production" });
const renamed = await factlens.projects.update(project.id, { name: "Primary production" });
await factlens.projects.delete(renamed.id);
```

Project deletion is a server-side soft deletion that revokes active keys and preserves request and billing history.

## Select a management project

```ts
factlens.projects.select(project.id);
await factlens.keys.list();
await factlens.logs.list({ limit: 10 });
```

`projects.select()` affects management namespaces only. It cannot change the project bound to a runtime API key.

To call the runtime API with another project's key:

```ts
const staging = factlens.withApiKey(process.env.FACTLENS_STAGING_API_KEY!);
await staging.verify({ mode: "text", claim: "Example" });
```

## Create and revoke API keys

```ts
const created = await factlens.keys.create({ label: "Backend" });
console.log(created.api_key); // Plaintext is returned once.

await factlens.keys.revoke({ keyId: created.key.id });
```

You can pass `projectId` directly instead of selecting a default.
