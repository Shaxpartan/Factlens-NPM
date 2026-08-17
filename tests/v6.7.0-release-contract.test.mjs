import test from 'node:test';
import assert from 'node:assert/strict';

import FactLens, { FactLensError } from '../dist/esm/index.js';
import { runCli } from '../dist/esm/cli/index.js';

const TIMING_HEADERS = {
  'Server-Timing': 'auth;dur=10, customization;dur=20, core;dur=300, postprocess;dur=5, edge;dur=350',
  'X-FactLens-Edge-Time-Ms': '350',
  'X-FactLens-Request-ID': '00000000-0000-4000-8000-000000000067',
};

function cliHarness(fetch, env = {}) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: {
      env: { FACTLENS_API_KEY: 'fl_live_project_key_abcdefghijklmnopqrstuvwxyz', ...env },
      fetch,
      writeOut: (value) => out.push(String(value)),
      writeErr: (value) => err.push(String(value)),
      color: false,
    },
  };
}

test('verifyDetailed is additive and carries the coordinated Server-Timing contract', async () => {
  let calls = 0;
  const client = new FactLens({
    apiKey: 'fl_live_project',
    fetch: async () => {
      calls += 1;
      return Response.json({ verdictId: 'TRUE', response_time_ms: 300 }, { headers: TIMING_HEADERS });
    },
  });
  const detailed = await client.verifyDetailed({ mode: 'text', claim: 'A claim' });
  assert.equal(calls, 1);
  assert.equal(detailed.data.verdictId, 'TRUE');
  assert.equal(detailed.meta.httpStatus, 200);
  assert.equal(detailed.meta.serverTiming.authMs, 10);
  assert.equal(detailed.meta.serverTiming.customizationMs, 20);
  assert.equal(detailed.meta.serverTiming.coreMs, 300);
  assert.equal(detailed.meta.serverTiming.postprocessMs, 5);
  assert.equal(detailed.meta.serverTiming.edgeMs, 350);
  assert.equal(detailed.meta.retryCount, 0);
  assert.equal(typeof detailed.meta.clientTotalSeconds, 'number');
});

test('transient read-only GETs retry once while Verify and mutations do not', async () => {
  let usageCalls = 0;
  const runtime = new FactLens({
    apiKey: 'fl_live_project',
    fetch: async () => {
      usageCalls += 1;
      if (usageCalls === 1) return Response.json({ error: 'TEMP' }, { status: 503, headers: { 'Retry-After': '0' } });
      return Response.json({ requests_used_total: 1 }, { headers: TIMING_HEADERS });
    },
  });
  assert.equal((await runtime.usage.get()).requests_used_total, 1);
  assert.equal(usageCalls, 2);

  let verifyCalls = 0;
  const verifyClient = new FactLens({
    apiKey: 'fl_live_project',
    fetch: async () => { verifyCalls += 1; return Response.json({ error: 'TEMP' }, { status: 503 }); },
  });
  await assert.rejects(verifyClient.verify({ mode: 'text', claim: 'A claim' }, { maxRetries: 5 }), FactLensError);
  assert.equal(verifyCalls, 1);

  let mutationCalls = 0;
  const management = new FactLens({
    developerToken: 'fldev_live_developer',
    fetch: async () => { mutationCalls += 1; return Response.json({ error: 'TEMP' }, { status: 503 }); },
  });
  await assert.rejects(management.projects.create({ name: 'Production' }, { maxRetries: 5 }), FactLensError);
  assert.equal(mutationCalls, 1);
});

test('user AbortSignal cancels the request and does not leak credentials into errors', async () => {
  const controller = new AbortController();
  const client = new FactLens({
    apiKey: 'fl_live_super_secret_key',
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      queueMicrotask(() => controller.abort(new Error('cancelled by test')));
    }),
  });
  await assert.rejects(
    client.verify({ mode: 'text', claim: 'A claim' }, { signal: controller.signal }),
    (error) => error instanceof FactLensError && error.code === 'REQUEST_ABORTED' && !JSON.stringify(error).includes('fl_live_super_secret_key'),
  );
});

test('HTTP failures expose safe parsed metadata and bounded Retry-After', async () => {
  const client = new FactLens({
    apiKey: 'fl_live_super_secret_key',
    fetch: async () => Response.json(
      { error: 'VERIFICATION_SEARCH_FAILED', message: 'Search unavailable.', stage: 'search', request_id: '00000000-0000-4000-8000-000000000067' },
      { status: 503, headers: { ...TIMING_HEADERS, 'Retry-After': '120' } },
    ),
  });
  await assert.rejects(client.verify({ mode: 'text', claim: 'A claim' }), (error) => {
    assert.ok(error instanceof FactLensError);
    assert.equal(error.retryAfterMs, 60_000);
    assert.equal(error.meta?.serverTiming.coreMs, 300);
    assert.equal(error.meta?.httpStatus, 503);
    assert.equal(JSON.stringify(error).includes('fl_live_super_secret_key'), false);
    return true;
  });
});

test('progress includes phase, poll count, and server poll hint without fake percentages', async () => {
  let calls = 0;
  const events = [];
  const client = new FactLens({
    apiKey: 'fl_live_project',
    fetch: async (_url, init) => {
      calls += 1;
      const id = new Headers(init.headers).get('x-request-id');
      if (calls === 1) return Response.json({ error: 'REQUEST_IN_PROGRESS', stage: 'transcription', request_id: id }, { status: 409, headers: { 'Retry-After': '0' } });
      return Response.json({ request_id: id, verdictId: 'TRUE' }, { headers: TIMING_HEADERS });
    },
  });
  await client.verify({ mode: 'text', claim: 'A claim' }, { onProgress: (event) => events.push(event) });
  const poll = events.find((event) => event.pollCount === 1);
  assert.equal(poll?.phase, 'transcription');
  assert.equal(poll?.nextPollInMs, 0);
  assert.equal(typeof poll?.phaseElapsedMs, 'number');
  assert.equal('percent' in poll, false);
});

test('CLI trace reports total/Server/runtime phases and JSON keeps timing structured', async () => {
  const fetch = async (_url, init) => Response.json({
    request_id: new Headers(init.headers).get('x-request-id'),
    claim: 'A claim', verdictId: 'TRUE', verdictColor: '#16a34a', response_time_ms: 300, sources: [],
  }, { headers: TIMING_HEADERS });

  const human = cliHarness(fetch);
  assert.equal(await runCli(['verify', 'A claim', '--trace', '--time-unit', 'ms'], human.deps), 0);
  const text = human.out.join('');
  for (const expected of ['total', 'Server', 'Runtime:', 'Auth', 'Config', 'Post', 'Edge', 'Outside:', 'Trace: HTTP 200']) assert.match(text, new RegExp(expected));
  assert.doesNotMatch(text, /total server/i);

  const json = cliHarness(fetch);
  assert.equal(await runCli(['verify', 'A claim', '--json'], json.deps), 0);
  const parsed = JSON.parse(json.out.join(''));
  assert.equal(parsed.timing.serverTiming.coreMs, 300);
  assert.equal(parsed.timing.httpStatus, 200);
});

test('doctor uses the non-billable runtime Usage read and reports timings', async () => {
  const calls = [];
  const h = cliHarness(async (url) => {
    calls.push(new URL(url).pathname);
    return Response.json({ requests_used_total: 1 }, { headers: TIMING_HEADERS });
  });
  assert.equal(await runCli(['doctor', '--time-unit', 'ms'], h.deps), 0);
  assert.deepEqual(calls, ['/v1/usage']);
  const text = h.out.join('');
  assert.match(text, /FactLens doctor · v6\.7\.0/);
  assert.match(text, /Server 300ms/);
  assert.match(text, /Edge 350ms/);
  assert.equal(text.includes('fl_live_project_key_'), false);
});

test('request detail human output renders stored verdict results and omits legacy Input/Pipeline sections', async () => {
  const h = cliHarness(async () => Response.json({ request: {
    request_id: 'request-67', mode: 'text', status: 'completed', total_ms: 500, core_ms: 300,
    results: [
      { claim: 'First', verdictId: 'TRUE', verdictColor: '#16a34a', explanation: 'Supported.', confidence: 'HIGH', evidenceStrength: 'STRONG', sources: [{ title: 'Source', url: 'https://example.test/evidence' }] },
      { claim: 'Second', verdictId: 'FALSE', verdictColor: '#dc2626', explanation: 'Contradicted.', confidence: 'HIGH', evidenceStrength: 'STRONG', sources: [] },
    ],
  } }), { FACTLENS_API_KEY: '', FACTLENS_DEVELOPER_TOKEN: 'fldev_live_developer' });
  assert.equal(await runCli(['request', 'request-67'], h.deps), 0);
  const text = h.out.join('');
  for (const expected of ['First', 'Second', 'Verdict: TRUE', 'Verdict: FALSE', '0.5s total', '0.3s Server']) assert.match(text, new RegExp(expected.replace('.', '\\.')));
  assert.doesNotMatch(text, /\bInput\b/);
  assert.doesNotMatch(text, /\bPipeline\b/);
});
