import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../dist/esm/cli/index.js';

function harness(overrides = {}) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: {
      env: {},
      writeOut: (value) => out.push(String(value)),
      writeErr: (value) => err.push(String(value)),
      ...overrides,
    },
  };
}

test('CLI help and version are available without credentials', async () => {
  const h1 = harness();
  assert.equal(await runCli(['--help'], h1.deps), 0);
  assert.match(h1.out.join(''), /factlens verify/i);
  assert.match(h1.out.join(''), /factlens list/i);
  assert.match(h1.out.join(''), /factlens kill/i);
  assert.doesNotMatch(h1.out.join(''), /factlens (?:search|ai|transcribe)\b/i);

  const h2 = harness();
  assert.equal(await runCli(['--version'], h2.deps), 0);
  assert.match(h2.out.join('').trim(), /^6\.7\.1$/);
});

test('unknown commands return a usage exit code and useful error', async () => {
  const h = harness();
  assert.equal(await runCli(['wat'], h.deps), 2);
  assert.match(h.err.join(''), /Unknown command/i);
  assert.match(h.err.join(''), /factlens --help/i);
});

test('configure flags save credentials and config show masks them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-cli-core-'));
  const path = join(root, 'config.json');
  try {
    const setup = harness({ configFile: path });
    assert.equal(await runCli(['configure', '--api-key', 'fl_live_abcdefghijklmnopqrstuvwxyz', '--developer-token', 'fldev_live_abcdefghijklmnopqrstuvwxyz'], setup.deps), 0);
    assert.match(setup.out.join(''), /Configuration saved/i);

    const show = harness({ configFile: path });
    assert.equal(await runCli(['config', 'show'], show.deps), 0);
    assert.doesNotMatch(show.out.join(''), /abcdefghijklmnopqrstuvwxyz/);
    assert.match(show.out.join(''), /fl_live_/);

    const clear = harness({ configFile: path });
    assert.equal(await runCli(['config', 'clear'], clear.deps), 0);
    assert.match(clear.out.join(''), /cleared/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('JSON errors are structured and emitted without decorative output', async () => {
  const h = harness({
    env: { FACTLENS_API_KEY: 'fl_live_bad' },
    fetch: async () => Response.json({ error: 'API_KEY_INVALID', message: 'Invalid key' }, { status: 401 }),
  });
  assert.equal(await runCli(['verify', 'example', '--json', '--retries', '0'], h.deps), 3);
  assert.equal(h.out.length, 0);
  const body = JSON.parse(h.err.join(''));
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'API_KEY_INVALID');
  assert.equal(body.error.status, 401);
  assert.match(body.error.helpUrl, /dashboard/);
});
