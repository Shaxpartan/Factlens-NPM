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

test('audio CLI forwards --speaker and request scoped source preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-speaker-'));
  try {
    const audio = join(root, 'clip.mp3');
    await writeFile(audio, Buffer.from([1, 2, 3, 4]));
    let body;
    const h = harness(async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ verdictId: 'TRUE', results: [], sources: [] });
    }, { configFile: join(root, 'config.json') });

    assert.equal(await runCli([
      'verify', '--audio', audio,
      '--speaker', 'Jane Doe',
      '--trusted-domains', 'reuters.com,apnews.com',
      '--blocked-domains', 'reddit.com',
      '--json',
    ], h.deps), 0);

    assert.equal(body.mode, 'audio_video');
    assert.equal(body.speaker, 'Jane Doe');
    assert.deepEqual(body.trusted_domains, ['reuters.com', 'apnews.com']);
    assert.deepEqual(body.blocked_domains, ['reddit.com']);
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
