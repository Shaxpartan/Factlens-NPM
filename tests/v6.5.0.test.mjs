import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import FactLens, { FactLensConfigurationError } from '../dist/esm/index.js';
import { runCli } from '../dist/esm/cli/index.js';
import { createProgress } from '../dist/esm/cli/terminal.js';

function runtimeHarness(fetch, overrides = {}) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: {
      env: {
        FACTLENS_API_KEY: 'fl_live_project_key_abcdefghijklmnopqrstuvwxyz',
        FACTLENS_DEVELOPER_TOKEN: 'fldev_live_developer_abcdefghijklmnopqrstuvwxyz',
      },
      fetch,
      writeOut: (value) => out.push(String(value)),
      writeErr: (value) => err.push(String(value)),
      color: false,
      ...overrides,
    },
  };
}

test('SDK exposes developer-token API-key customization routes', async () => {
  const calls = [];
  const client = new FactLens({
    developerToken: 'fldev_live_developer_abcdefghijklmnopqrstuvwxyz',
    baseUrl: 'https://example.test',
    fetch: async (url, init) => {
      calls.push({ url: new URL(url).pathname, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: new Headers(init.headers) });
      return Response.json({ ok: true, key: { id: 'key-id' }, prompts: [], verdict_config: null });
    },
  });
  client.projects.select('11111111-1111-4111-8111-111111111111');
  const keyId = '22222222-2222-4222-8222-222222222222';

  await client.keys.customization.get({ keyId });
  await client.keys.customization.updatePreferences({ keyId, trustedDomains: ['reuters.com'], blockedDomains: ['example.com'] });
  await client.keys.customization.savePrompt({ keyId, mode: 'text', stage: 'claim_extraction', instruction: 'Extract only explicit factual claims.', inputBudgetTokens: 8000, enabled: true, promptMode: 'guided' });
  await client.keys.customization.resetPrompt({ keyId, mode: 'text', stage: 'claim_extraction' });
  await client.keys.customization.saveVerdicts({ keyId, config: { version: 3, modes: {} } });
  await client.keys.customization.resetVerdicts({ keyId });

  assert.deepEqual(calls.map(({ url, method }) => [method, url]), [
    ['GET', `/v1/projects/11111111-1111-4111-8111-111111111111/keys/${keyId}/customization`],
    ['PATCH', `/v1/projects/11111111-1111-4111-8111-111111111111/keys/${keyId}/customization/preferences`],
    ['PUT', `/v1/projects/11111111-1111-4111-8111-111111111111/keys/${keyId}/customization/prompts/text/claim_extraction`],
    ['DELETE', `/v1/projects/11111111-1111-4111-8111-111111111111/keys/${keyId}/customization/prompts/text/claim_extraction`],
    ['PUT', `/v1/projects/11111111-1111-4111-8111-111111111111/keys/${keyId}/customization/verdicts`],
    ['DELETE', `/v1/projects/11111111-1111-4111-8111-111111111111/keys/${keyId}/customization/verdicts`],
  ]);
  assert.equal(calls[1].body.trusted_domains[0], 'reuters.com');
  assert.equal(calls[2].body.input_budget_tokens, 8000);
  assert.equal(calls.every((call) => call.headers.get('authorization')?.startsWith('Bearer fldev_live_')), true);
});

test('timeoutSeconds is supported, conflicts with timeout, and progress exposes seconds', async () => {
  const client = new FactLens({
    apiKey: 'fl_live_project',
    fetch: async () => Response.json({ verdictId: 'TRUE', verdictColor: '#22c55e', sources: [] }),
  });
  const progress = [];
  await client.verify({ mode: 'text', claim: 'A claim' }, { timeoutSeconds: 2, onProgress: (event) => progress.push(event) });
  assert.ok(progress.length >= 2);
  assert.equal(typeof progress[0].elapsedMs, 'number');
  assert.equal(typeof progress[0].elapsedSeconds, 'number');
  assert.equal(progress[0].elapsedSeconds, progress[0].elapsedMs / 1000);
  await assert.rejects(
    client.verify({ mode: 'text', claim: 'A claim' }, { timeout: 1000, timeoutSeconds: 1 }),
    (error) => error instanceof FactLensConfigurationError && /timeout.*timeoutSeconds/i.test(error.message),
  );
});

test('progress design is a forward phase rail and retains ANSI color support', async () => {
  const frames = [];
  const progress = createProgress((value) => frames.push(String(value)), true, true, 1000, 'text');
  progress.start('Sending');
  progress.update('Verifying');
  progress.update('Complete');
  progress.stop();
  const joined = frames.join('');
  assert.match(joined, /Sent/);
  assert.match(joined, /Verifying/);
  assert.match(joined, /Result|Complete/);
  assert.match(joined, /\x1b\[/);
  assert.doesNotMatch(joined, /●.*━.*●/);
});

test('CLI uses API verdictColor truecolor and presents client/server timing separately', async () => {
  const h = runtimeHarness(async () => Response.json({
    request_id: '01914f52-79f6-4d4f-b456-426614174010',
    claim: 'Claim',
    verdictId: 'custom:33333333-3333-4333-8333-333333333333',
    verdictColor: '#123abc',
    explanation: 'Supported.',
    confidence: 'HIGH',
    evidenceStrength: 'STRONG',
    sources: [],
    response_time_ms: 900,
    usage: { requests_charged: 1, paid_balance_requests: 264 },
  }), { color: true });
  assert.equal(await runCli(['verify', 'Claim', '--time-unit', 's'], h.deps), 0);
  const text = h.out.join('');
  assert.match(text, /\x1b\[38;2;18;58;188m/);
  assert.match(text, /Timing/i);
  assert.match(text, /server/i);
  assert.match(text, /0\.900s/);
});

test('CLI forwards advanced Verify inputs and supports request verdict colors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-v650-'));
  try {
    const verdicts = join(root, 'verdicts.json');
    await writeFile(verdicts, JSON.stringify([{ id: 'custom:55555555-5555-4555-8555-555555555555', name: 'Custom', color: '#abcdef', rule: 'Choose for the test.' }]));
    let body;
    const h = runtimeHarness(async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ verdictId: body.verdicts[0].id, verdictColor: body.verdicts[0].color, sources: [] });
    });
    assert.equal(await runCli([
      'verify', 'Claim', '--instructions', 'Be precise.', '--search-query', 'custom query', '--results-per-search', '7',
      '--trusted-domains', 'reuters.com', '--no-blocked-domains', '--verdicts-file', verdicts, '--json',
    ], h.deps), 0);
    assert.equal(body.instructions, 'Be precise.');
    assert.equal(body.search_query, 'custom query');
    assert.equal(body.results_per_search, 7);
    assert.deepEqual(body.trusted_domains, ['reuters.com']);
    assert.deepEqual(body.blocked_domains, []);
    assert.equal(body.verdicts[0].color, '#abcdef');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI customization commands use the public SDK management routes', async () => {
  const calls = [];
  const h = runtimeHarness(async (url, init) => {
    calls.push({ path: new URL(url).pathname, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return Response.json({ key: { id: '22222222-2222-4222-8222-222222222222' }, prompts: [], verdict_config: null });
  });
  const project = '11111111-1111-4111-8111-111111111111';
  const key = '22222222-2222-4222-8222-222222222222';
  assert.equal(await runCli(['keys', 'customization', 'get', key, '--project', project, '--json'], h.deps), 0);
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [['GET', `/v1/projects/${project}/keys/${key}/customization`]]);
});
