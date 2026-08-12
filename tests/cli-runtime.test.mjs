import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../dist/esm/cli/index.js';

function harness(fetch) {
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

test('CLI image and audio modes preserve media MIME and base64 content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-cli-media-'));
  try {
    const image = join(root, 'proof.jpg');
    const audio = join(root, 'clip.mp3');
    await writeFile(image, Buffer.from([1, 2, 3, 4]));
    await writeFile(audio, Buffer.from([5, 6, 7, 8]));
    const bodies = [];
    const h = harness(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return Response.json({ verdictId: 'UNVERIFIED', sources: [] });
    });

    assert.equal(await runCli(['verify', '--image', image, '--claim', 'This is authentic.', '--json'], h.deps), 0);
    assert.equal(await runCli(['verify', '--audio', audio, '--claim', 'The speaker makes this claim.', '--json'], h.deps), 0);

    assert.deepEqual(bodies[0], {
      mode: 'image_post',
      claim: 'This is authentic.',
      image_base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      content_type: 'image/jpeg',
    });
    assert.deepEqual(bodies[1], {
      mode: 'audio_video',
      audio_base64: Buffer.from([5, 6, 7, 8]).toString('base64'),
      content_type: 'audio/mpeg',
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
  assert.match(h.err.join(''), /only one of --file, --image, or --audio/i);
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
      {
        claim: 'First claim',
        verdictId: 'TRUE',
        explanation: 'First explanation.',
        confidence: 'HIGH',
        evidenceStrength: 'STRONG',
        sources: [{ title: 'First source', url: 'https://example.test/first' }],
      },
      {
        claim: 'Second claim',
        verdictId: 'FALSE',
        explanation: 'Second explanation.',
        confidence: 'MEDIUM',
        evidenceStrength: 'MODERATE',
        sources: [{ title: 'Second source', url: 'https://example.test/second' }],
      },
    ],
    response_time_ms: 1200,
    usage: { requests_charged: 1 },
  }));

  assert.equal(await runCli(['verify', 'Two claims'], h.deps), 0);
  const text = h.out.join('');
  for (const expected of ['Claim 1: First claim', 'Claim 2: Second claim', 'Verdict: TRUE', 'Verdict: FALSE', 'First source', 'Second source']) {
    assert.match(text, new RegExp(expected));
  }
  assert.equal((text.match(/Request ID:/g) || []).length, 1);
  assert.equal((text.match(/Response time:/g) || []).length, 1);
  assert.equal((text.match(/Usage:/g) || []).length, 1);
});
