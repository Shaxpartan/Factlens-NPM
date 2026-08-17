import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../dist/esm/cli/index.js';

function harness(fetch, overrides = {}) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: {
      env: { FACTLENS_API_KEY: 'fl_live_project_key_abcdefghijklmnopqrstuvwxyz' },
      fetch,
      writeOut: (value) => out.push(String(value)),
      writeErr: (value) => err.push(String(value)),
      ...overrides,
    },
  };
}

test('CLI verifies a text claim through /v1/verify and prints stable JSON', async () => {
  let request;
  const h = harness(async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) };
    return Response.json({ request_id: request.headers.get('x-request-id'), verdictId: 'TRUE', explanation: 'Supported.', confidence: 'HIGH', evidenceStrength: 'STRONG', sources: [] });
  });
  assert.equal(await runCli(['verify', 'Earth orbits the Sun.', '--json', '--retries', '0'], h.deps), 0);
  assert.equal(request.url, 'https://api.factlens.pro/v1/verify');
  assert.deepEqual(request.body, { mode: 'text', claim: 'Earth orbits the Sun.' });
  assert.equal(JSON.parse(h.out.join('')).verdictId, 'TRUE');
  assert.equal(h.err.length, 0);
});

test('CLI image stays inline while audio uses resumable storage then polls the same request ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-cli-media-'));
  try {
    const image = join(root, 'proof.jpg');
    const audio = join(root, 'clip.mp3');
    await writeFile(image, Buffer.from([1, 2, 3, 4]));
    await writeFile(audio, Buffer.from([5, 6, 7, 8]));

    let imageBody;
    const imageHarness = harness(async (_url, init) => {
      imageBody = JSON.parse(init.body);
      return Response.json({ verdictId: 'UNVERIFIED', sources: [] });
    }, { configFile: join(root, 'image-config.json') });
    assert.equal(await runCli(['verify', '--image', image, '--claim', 'This is authentic.', '--json'], imageHarness.deps), 0);
    assert.deepEqual(imageBody, {
      mode: 'image_post',
      claim: 'This is authentic.',
      image_base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      content_type: 'image/jpeg',
    });

    const calls = [];
    const audioHarness = harness(async (url, init = {}) => {
      const href = String(url);
      const headers = new Headers(init.headers);
      const method = init.method || 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: href, headers, method, body });

      if (href.includes('/functions/v1/factlens-audio-upload')) {
        if (body?.action === 'prepare') return Response.json({ request_id: body.request_id, upload: { endpoint: 'https://test.storage.supabase.co/storage/v1/upload/resumable', token: 'signed-upload-token', bucket: 'factlens-api-audio-temp', object_path: `key/${body.request_id}-object`, chunk_size: 6 * 1024 * 1024 } });
        if (body?.action === 'resolve') return Response.json({ request_id: body.request_id, audio_url: 'https://test.supabase.co/storage/v1/object/sign/factlens-api-audio-temp/object?token=read' });
        if (body?.action === 'release' || body?.action === 'cleanup') return Response.json({ ok: true, request_id: body.request_id });
      }
      if (href === 'https://test.storage.supabase.co/storage/v1/upload/resumable' && method === 'POST') {
        return new Response(null, { status: 201, headers: { Location: '/storage/v1/upload/resumable/session' } });
      }
      if (href.endsWith('/storage/v1/upload/resumable/session') && method === 'PATCH') {
        return new Response(null, { status: 204, headers: { 'Upload-Offset': '4' } });
      }
      if (href === 'https://api.factlens.pro/v1/verify' && body?.audio_url) {
        return Response.json({ error: 'REQUEST_IN_PROGRESS', message: 'Audio accepted.', stage: 'transcription', request_id: headers.get('x-request-id') }, { status: 409, headers: { 'Retry-After': '0' } });
      }
      if (href === 'https://api.factlens.pro/v1/verify' && body?.audio_job === true) {
        return Response.json({ request_id: headers.get('x-request-id'), verdictId: 'TRUE', results: [], sources: [], echo: body });
      }
      return Response.json({ error: 'UNEXPECTED_TEST_REQUEST' }, { status: 500 });
    }, { configFile: join(root, 'audio-config.json') });

    assert.equal(await runCli(['verify', '--audio', audio, '--claim', 'The speaker makes this claim.', '--json'], audioHarness.deps), 0);
    const prepare = calls.find((call) => call.body?.action === 'prepare');
    const tusCreate = calls.find((call) => call.url === 'https://test.storage.supabase.co/storage/v1/upload/resumable' && call.method === 'POST');
    const tusPatch = calls.find((call) => call.method === 'PATCH');
    const verifyStart = calls.find((call) => call.body?.audio_url);
    const release = calls.find((call) => call.body?.action === 'release');
    const poll = calls.find((call) => call.body?.audio_job === true);
    assert.ok(prepare && tusCreate && tusPatch && verifyStart && release && poll);
    assert.equal(tusPatch.headers.get('content-type'), 'application/offset+octet-stream');
    assert.equal(prepare.headers.get('x-request-id'), poll.headers.get('x-request-id'));
    assert.equal(verifyStart.headers.get('x-request-id'), poll.headers.get('x-request-id'));
    assert.deepEqual(poll.body, {
      mode: 'audio_video',
      audio_job: true,
      claim: 'The speaker makes this claim.',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI rejects conflicting media input locally before any request', async () => {
  let calls = 0;
  const h = harness(async () => { calls += 1; return Response.json({}); });
  const code = await runCli(['verify', '--image', 'x.png', '--audio', 'x.mp3', '--claim', 'claim'], h.deps);
  assert.equal(code, 2);
  assert.equal(calls, 0);
  assert.match(h.err.join(''), /only one explicit input source.*--file.*--image.*--audio.*--transcript.*--audio-url/i);
});

test('human Verify output contains result diagnostics without exposing transport noise', async () => {
  const h = harness(async () => Response.json({
    request_id: '01914f52-79f6-4d4f-b456-426614174000',
    claim: 'Claim',
    verdictId: 'FALSE',
    explanation: 'The evidence contradicts it.',
    confidence: 'HIGH',
    evidenceStrength: 'STRONG',
    sources: [{ title: 'Source', url: 'https://example.test/evidence' }],
    response_time_ms: 900,
    usage: { requests_charged: 1 },
  }));
  assert.equal(await runCli(['verify', 'Claim'], h.deps), 0);
  const text = h.out.join('');
  for (const expected of ['Verdict: FALSE', 'Confidence: HIGH', 'Evidence: STRONG', 'Source', 'Request ID:', 'Response time: 900 ms', 'Usage:']) assert.match(text, new RegExp(expected));
});

test('human Verify output renders every multi-claim result and request metadata once', async () => {
  const h = harness(async () => Response.json({
    request_id: '01914f52-79f6-4d4f-b456-426614174001',
    claim_count: 2,
    claim: 'First claim',
    verdictId: 'TRUE',
    explanation: 'First explanation.',
    confidence: 'HIGH',
    evidenceStrength: 'STRONG',
    sources: [{ title: 'First source', url: 'https://example.test/first' }],
    results: [
      { claim: 'First claim', verdictId: 'TRUE', explanation: 'First explanation.', confidence: 'HIGH', evidenceStrength: 'STRONG', sources: [{ title: 'First source', url: 'https://example.test/first' }] },
      { claim: 'Second claim', verdictId: 'FALSE', explanation: 'Second explanation.', confidence: 'MEDIUM', evidenceStrength: 'MODERATE', sources: [{ title: 'Second source', url: 'https://example.test/second' }] },
    ],
    response_time_ms: 1200,
    usage: { requests_charged: 1 },
  }));

  assert.equal(await runCli(['verify', 'Two claims'], h.deps), 0);
  const text = h.out.join('');
  for (const expected of ['Claim 1: First claim', 'Claim 2: Second claim', 'Verdict: TRUE', 'Verdict: FALSE', 'First source', 'Second source']) assert.match(text, new RegExp(expected));
  assert.equal((text.match(/Request ID:/g) || []).length, 1);
  assert.equal((text.match(/Response time:/g) || []).length, 1);
  assert.equal((text.match(/Usage:/g) || []).length, 1);
});

test('human timing calls the existing core metric Server without changing the wire metric', async () => {
  const h = harness(async () => Response.json({
    request_id: '01914f52-79f6-4d4f-b456-426614174002',
    claim: 'Claim',
    verdictId: 'TRUE',
    explanation: 'Supported.',
    confidence: 'HIGH',
    evidenceStrength: 'STRONG',
    sources: [],
    response_time_ms: 900,
  }, { headers: { 'Server-Timing': 'core;dur=900, edge;dur=1200', 'X-FactLens-Edge-Time-Ms': '1200' } }));

  assert.equal(await runCli(['verify', 'Claim', '--verbose'], h.deps), 0);
  const text = h.out.join('');
  assert.match(text, /Timing: .* total · 0\.9s Server/);
  assert.match(text, /Runtime: .*Server 0\.9s/);
  assert.doesNotMatch(text, /\bCore\b|0\.9s core/);
});
