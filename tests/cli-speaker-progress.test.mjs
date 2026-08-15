import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../dist/esm/cli/index.js';

function harness(fetch, extra = {}) {
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
      ...extra,
    },
  };
}

test('audio CLI forwards --speaker and request scoped source preferences on the verification poll', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-speaker-'));
  try {
    const audio = join(root, 'clip.mp3');
    await writeFile(audio, Buffer.from([1, 2, 3, 4]));
    let pollBody;
    let uploadRequestId;
    let pollRequestId;
    const h = harness(async (url, init) => {
      const headers = new Headers(init.headers);
      if (String(url).includes('supabase.co/functions/v1/factlens-api')) {
        uploadRequestId = headers.get('x-request-id');
        return Response.json(
          { error: 'REQUEST_IN_PROGRESS', message: 'Audio accepted.', stage: 'transcription', request_id: uploadRequestId },
          { status: 409, headers: { 'Retry-After': '0' } },
        );
      }
      pollRequestId = headers.get('x-request-id');
      pollBody = JSON.parse(init.body);
      return Response.json({ request_id: pollRequestId, verdictId: 'TRUE', results: [], sources: [] });
    }, { configFile: join(root, 'config.json') });

    assert.equal(await runCli([
      'verify', '--audio', audio,
      '--speaker', 'Jane Doe',
      '--trusted-domains', 'reuters.com,apnews.com',
      '--blocked-domains', 'reddit.com',
      '--json',
    ], h.deps), 0);

    assert.equal(uploadRequestId, pollRequestId);
    assert.equal(pollBody.mode, 'audio_video');
    assert.equal(pollBody.audio_job, true);
    assert.equal(pollBody.speaker, 'Jane Doe');
    assert.deepEqual(pollBody.trusted_domains, ['reuters.com', 'apnews.com']);
    assert.deepEqual(pollBody.blocked_domains, ['reddit.com']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('human verify uses terminal color and emits an indeterminate progress bar without polluting JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-progress-'));
  try {
    const h = harness(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return Response.json({ verdictId: 'TRUE', explanation: 'Supported.', confidence: 'HIGH', evidenceStrength: 'STRONG', sources: [] });
    }, { configFile: join(root, 'config.json'), color: true, progressIntervalMs: 5 });

    assert.equal(await runCli(['verify', 'Earth orbits the Sun.'], h.deps), 0);
    assert.match(h.err.join(''), /Verifying/i);
    assert.match(h.err.join(''), /[●━·]/);
    assert.match(h.err.join(''), /\x1b\[/);
    assert.match(h.out.join(''), /\x1b\[/);

    const json = harness(async () => Response.json({ verdictId: 'TRUE', sources: [] }), {
      configFile: join(root, 'config.json'),
      color: true,
      progressIntervalMs: 5,
    });
    assert.equal(await runCli(['verify', 'Earth orbits the Sun.', '--json'], json.deps), 0);
    assert.doesNotMatch(json.out.join(''), /\x1b\[/);
    assert.equal(json.err.join(''), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
