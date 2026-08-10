import test from "node:test";
import assert from "node:assert/strict";

import FactLens, { FactLensConfigurationError } from "../dist/esm/index.js";

test("reads server credentials from the documented environment variables", async () => {
  const previousApiKey = process.env.FACTLENS_API_KEY;
  const previousDeveloperToken = process.env.FACTLENS_DEVELOPER_TOKEN;
  process.env.FACTLENS_API_KEY = "fl_live_from_env";
  process.env.FACTLENS_DEVELOPER_TOKEN = "fldev_live_from_env";
  const seen = [];

  try {
    const client = new FactLens({
      fetch: async (url, init) => {
        seen.push({ url: String(url), init });
        return Response.json({ request_id: "req_1", usage: {} });
      },
    });
    await client.usage.get();
    await client.account.get();
  } finally {
    if (previousApiKey === undefined) delete process.env.FACTLENS_API_KEY;
    else process.env.FACTLENS_API_KEY = previousApiKey;
    if (previousDeveloperToken === undefined) delete process.env.FACTLENS_DEVELOPER_TOKEN;
    else process.env.FACTLENS_DEVELOPER_TOKEN = previousDeveloperToken;
  }

  assert.equal(new Headers(seen[0].init.headers).get("authorization"), "Bearer fl_live_from_env");
  assert.equal(new Headers(seen[1].init.headers).get("authorization"), "Bearer fldev_live_from_env");
});

test("rejects secret credentials in browser-like environments unless explicitly allowed", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {};
  globalThis.document = {};

  try {
    assert.throws(
      () => new FactLens({ apiKey: "fl_live_browser" }),
      (error) => error instanceof FactLensConfigurationError && /browser/i.test(error.message),
    );
    assert.doesNotThrow(() => new FactLens({
      apiKey: "fl_live_browser",
      dangerouslyAllowBrowser: true,
    }));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("reports a configuration error only when a method needs a missing credential", async () => {
  const client = new FactLens({ fetch: async () => Response.json({}) });
  await assert.rejects(
    client.verify({ mode: "text", claim: "Example" }),
    (error) => error instanceof FactLensConfigurationError && /api key/i.test(error.message),
  );
  await assert.rejects(
    client.projects.list(),
    (error) => error instanceof FactLensConfigurationError && /developer token/i.test(error.message),
  );
});

test("withApiKey creates an isolated runtime client without changing management credentials", async () => {
  const authorization = [];
  const fetch = async (_url, init) => {
    authorization.push(new Headers(init.headers).get("authorization"));
    return Response.json({ projects: [] });
  };
  const root = new FactLens({
    apiKey: "fl_live_root",
    developerToken: "fldev_live_account",
    fetch,
  });
  const child = root.withApiKey("fl_live_child");

  await child.verify({ mode: "text", claim: "Example" });
  await child.projects.list();

  assert.deepEqual(authorization, ["Bearer fl_live_child", "Bearer fldev_live_account"]);
});
