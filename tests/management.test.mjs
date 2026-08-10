import test from "node:test";
import assert from "node:assert/strict";

import FactLens, { FactLensConfigurationError } from "../dist/esm/index.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

test("management calls use the developer token and documented account/project routes", async () => {
  const requests = [];
  const client = new FactLens({
    developerToken: "fldev_live_account",
    fetch: async (url, init) => {
      const request = { url: new URL(url), init };
      requests.push(request);
      if (request.url.pathname === "/v1/projects" && init.method === "GET") return Response.json({ projects: [{ id: PROJECT_ID }] });
      if (request.url.pathname === "/v1/projects" && init.method === "POST") return Response.json({ project: { id: PROJECT_ID, name: "Production" } }, { status: 201 });
      if (init.method === "PATCH") return Response.json({ project: { id: PROJECT_ID, name: "Renamed" } });
      return Response.json({ ok: true, account: { tier: "paid" } });
    },
  });

  const account = await client.account.get();
  const projects = await client.projects.list();
  const created = await client.projects.create({ name: "Production" });
  const updated = await client.projects.update(PROJECT_ID, { name: "Renamed" });
  await client.projects.delete(PROJECT_ID);

  assert.equal(account.tier, "paid");
  assert.equal(projects[0].id, PROJECT_ID);
  assert.equal(created.id, PROJECT_ID);
  assert.equal(updated.name, "Renamed");
  assert.deepEqual(requests.map((request) => [request.init.method, request.url.pathname]), [
    ["GET", "/v1/account"],
    ["GET", "/v1/projects"],
    ["POST", "/v1/projects"],
    ["PATCH", `/v1/projects/${PROJECT_ID}`],
    ["DELETE", `/v1/projects/${PROJECT_ID}`],
  ]);
  for (const request of requests) {
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer fldev_live_account");
  }
  assert.match(new Headers(requests[2].init.headers).get("x-request-id"), /^[0-9a-f-]{36}$/i);
});

test("selected management project scopes keys, logs, and account usage", async () => {
  const urls = [];
  const client = new FactLens({
    developerToken: "fldev_live_account",
    fetch: async (url) => {
      const parsed = new URL(url);
      urls.push(parsed);
      if (parsed.pathname.endsWith("/keys")) return Response.json({ keys: [] });
      if (parsed.pathname.endsWith("/logs")) return Response.json({ logs: [], has_more: false, next_cursor: null });
      return Response.json({ account: {}, project: { id: PROJECT_ID }, project_usage: {} });
    },
  });
  client.projects.select(PROJECT_ID);

  await client.keys.list();
  await client.logs.list({ limit: 500, before: "2026-08-10T00:00:00.000Z", endpoint: "verify", status: "success" });
  await client.usage.getAccount();

  assert.equal(urls[0].pathname, `/v1/projects/${PROJECT_ID}/keys`);
  assert.equal(urls[1].pathname, `/v1/projects/${PROJECT_ID}/logs`);
  assert.equal(urls[1].searchParams.get("limit"), "100");
  assert.equal(urls[1].searchParams.get("before"), "2026-08-10T00:00:00.000Z");
  assert.equal(urls[1].searchParams.get("endpoint"), "verify");
  assert.equal(urls[1].searchParams.get("status"), "success");
  assert.equal(urls[2].pathname, "/v1/account/usage");
  assert.equal(urls[2].searchParams.get("project_id"), PROJECT_ID);
});

test("project-scoped management calls fail locally when no project is selected", async () => {
  const client = new FactLens({ developerToken: "fldev_live_account", fetch: async () => Response.json({}) });
  await assert.rejects(
    client.keys.list(),
    (error) => error instanceof FactLensConfigurationError && /project/i.test(error.message),
  );
  await assert.rejects(
    client.logs.list(),
    (error) => error instanceof FactLensConfigurationError && /project/i.test(error.message),
  );
});

test("keys expose one-time creation material and support explicit project overrides", async () => {
  const requests = [];
  const client = new FactLens({
    developerToken: "fldev_live_account",
    fetch: async (url, init) => {
      requests.push({ url: new URL(url), init });
      if (init.method === "POST") return Response.json({ api_key: "fl_live_once", key: { id: KEY_ID } }, { status: 201 });
      return Response.json({ ok: true });
    },
  });

  const created = await client.keys.create({ projectId: PROJECT_ID, label: "Backend" });
  await client.keys.revoke({ projectId: PROJECT_ID, keyId: KEY_ID });

  assert.equal(created.api_key, "fl_live_once");
  assert.deepEqual(JSON.parse(requests[0].init.body), { label: "Backend" });
  assert.equal(requests[1].url.pathname, `/v1/projects/${PROJECT_ID}/keys/${KEY_ID}`);
});

test("request inspection is account-owned and does not accept a project API key", async () => {
  let path;
  const managed = new FactLens({
    developerToken: "fldev_live_account",
    fetch: async (url) => {
      path = new URL(url).pathname;
      return Response.json({ request: { request_id: REQUEST_ID } });
    },
  });
  const detail = await managed.logs.get(REQUEST_ID);
  assert.equal(path, `/v1/requests/${REQUEST_ID}`);
  assert.equal(detail.request_id, REQUEST_ID);

  const runtimeOnly = new FactLens({ apiKey: "fl_live_project", fetch: async () => Response.json({}) });
  await assert.rejects(runtimeOnly.logs.get(REQUEST_ID), FactLensConfigurationError);
});
