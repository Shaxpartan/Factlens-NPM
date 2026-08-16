import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../dist/esm/cli/index.js';

function harness(fetch, configFile) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: {
      env: { FACTLENS_API_KEY: 'fl_live_project_key_abcdefghijklmnopqrstuvwxyz' },
      fetch,
      configFile,
      writeOut: (value) => out.push(String(value)),
      writeErr: (value) => err.push(String(value)),
    },
  };
}

test('CLI sends an image without a claim when --claim is omitted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-cli-claimless-image-'));
  try {
    const image = join(root, 'proof.jpg');
    await writeFile(image, Buffer.from([1, 2, 3, 4]));
    let body;
    const h = harness(async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ verdictId: 'UNVERIFIED', sources: [] });
    }, join(root, 'config.json'));

    assert.equal(await runCli(['verify', '--image', image, '--json'], h.deps), 0);
    assert.deepEqual(body, {
      mode: 'image_post',
      image_base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      content_type: 'image/jpeg',
    });
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'claim'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
