import test from "node:test";
import assert from "node:assert/strict";

import FactLens, { FactLensError } from "../dist/esm/index.js";

test("verify sends the project key, SDK metadata, JSON body, and one UUID request ID", async () => {
  let request;
  const client = new FactLens({
    apiKey: "fl_live_project",
    baseUrl: "https://example.test/",
    fetch: async (url, init) => {
      request = { url: String(url), init };
      return Response.json({ request_id: "server-id", verdictId: "TRUE" });
    },
  });

  const result = await client.verify({ mode: "text", claim: "The sky is blue." });
  const headers = new Headers(request.init.headers);

  assert.equal(request.url, "https://example.test/v1/verify");
  assert.equal(request.init.method, "POST");
  assert.equal(headers.get("authorization"), "Bearer fl_live_project");
  assert.equal(headers.get("x-factlens-sdk"), "node");
  assert.equal(headers.get("x-factlens-sdk-version"), "6.1.0");
  assert.match(headers.get("x-request-id"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(JSON.parse(request.init.body), { mode: "text", claim: "The sky is blue." });
  assert.equal(result.verdictId, "TRUE");
});

test("verify forwards request scoped trusted and blocked domains unchanged", async () => {
  let body;
  const client = new FactLens({
    apiKey: "fl_live_project",
    baseUrl: "https://example.test/",
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ verdictId: "TRUE", sources: [] });
    },
  });

  await client.verify({
    mode: "text",
    claim: "A claim",
    trusted_domains: ["reuters.com", "https://apnews.com/world"],
    blocked_domains: ["example.com", "bad.test"],
  });

  assert.deepEqual(body, {
    mode: "text",
    claim: "A claim",
    trusted_domains: ["reuters.com", "https://apnews.com/world"],
    blocked_domains: ["example.com", "bad.test"],
  });
});

test("verify forwards speaker and long audio URL fields", async () => {
  let body;
  const client = new FactLens({
    apiKey: "fl_live_project",
    baseUrl: "https://example.test/",
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ verdictId: "TRUE", sources: [] });
    },
  });
  await client.verify({ mode: "audio_video", audio_url: "https://example.com/interview.mp3", speaker: "Jane Doe" });
  assert.equal(body.audio_url, "https://example.com/interview.mp3");
  assert.equal(body.speaker, "Jane Doe");
});

test("verify retries reuse the request ID and respect retryable response classes", async () => {
  const ids = [];
  let attempt = 0;
  const client = new FactLens({
    apiKey: "fl_live_project",
    fetch: async (_url, init) => {
      attempt += 1;
      ids.push(new Headers(init.headers).get("x-request-id"));
      if (attempt === 1) {
        return Response.json(
          { error: "FACTLENS_API_BUSY", message: "Try again", request_id: ids[0] },
          { status: 503, headers: { "Retry-After": "0" } },
        );
      }
      return Response.json({ request_id: ids[0], verdictId: "TRUE" });
    },
  });

  const result = await client.verify({ mode: "text", claim: "Return true" }, { maxRetries: 1 });
  assert.equal(result.verdictId, "TRUE");
  assert.equal(attempt, 2);
  assert.equal(ids[0], ids[1]);
});

test("ordinary validation errors are structured and are not retried", async () => {
  let attempts = 0;
  const client = new FactLens({
    apiKey: "fl_live_project",
    fetch: async () => {
      attempts += 1;
      return Response.json(
        { error: "CLAIM_REQUIRED", message: "A claim is required.", request_id: "server-request", details: { field: "claim" } },
        { status: 400, headers: { "X-FactLens-Request-ID": "server-request" } },
      );
    },
  });

  await assert.rejects(
    client.verify({ mode: "text", claim: "" }, { maxRetries: 3 }),
    (error) => {
      assert.ok(error instanceof FactLensError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "CLAIM_REQUIRED");
      assert.equal(error.requestId, "server-request");
      assert.equal(error.retryable, false);
      assert.deepEqual(error.details, { field: "claim" });
      assert.equal(error.headers.get("x-factlens-request-id"), "server-request");
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test("409 is retried only for REQUEST_IN_PROGRESS", async () => {
  let attempts = 0;
  const client = new FactLens({
    apiKey: "fl_live_project",
    fetch: async () => {
      attempts += 1;
      return Response.json(
        { error: "REQUEST_ID_CONFLICT", message: "Conflict" },
        { status: 409 },
      );
    },
  });

  await assert.rejects(client.verify({ mode: "text", claim: "example" }, { maxRetries: 3 }), FactLensError);
  assert.equal(attempts, 1);
});

test("REQUEST_IN_PROGRESS polling does not consume the normal retry budget and keeps one request ID", async () => {
  const ids = [];
  const progress = [];
  let attempts = 0;
  const client = new FactLens({
    apiKey: "fl_live_project",
    fetch: async (_url, init) => {
      attempts += 1;
      const id = new Headers(init.headers).get("x-request-id");
      ids.push(id);
      if (attempts <= 3) {
        return Response.json(
          { error: "REQUEST_IN_PROGRESS", message: "Still running", stage: "transcription", request_id: id },
          { status: 409, headers: { "Retry-After": "0", "X-FactLens-Request-ID": id } },
        );
      }
      return Response.json({ request_id: id, verdictId: "TRUE" });
    },
  });

  const result = await client.verify(
    { mode: "text", claim: "A long verification." },
    { maxRetries: 0, timeout: 5_000, onProgress: (event) => progress.push(event.state) },
  );

  assert.equal(result.verdictId, "TRUE");
  assert.equal(attempts, 4);
  assert.equal(new Set(ids).size, 1);
  assert.ok(progress.includes("transcribing"));
  assert.equal(progress.at(-1), "complete");
});

test("timeouts abort verify and preserve the abort as the cause", async () => {
  const client = new FactLens({
    apiKey: "fl_live_project",
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }),
  });

  await assert.rejects(
    client.verify({ mode: "text", claim: "slow" }, { timeout: 5, maxRetries: 0 }),
    (error) => error instanceof FactLensError && error.code === "REQUEST_TIMEOUT" && Boolean(error.cause),
  );
});

test("runtime usage uses the documented GET route", async () => {
  const routes = [];
  const client = new FactLens({
    apiKey: "fl_live_project",
    fetch: async (url, init) => {
      routes.push({ url: new URL(url).pathname, method: init.method });
      return Response.json({ requests_used_total: 1 });
    },
  });

  const usage = await client.usage.get();
  assert.equal(usage.requests_used_total, 1);
  assert.deepEqual(routes, [{ url: "/v1/usage", method: "GET" }]);
});
