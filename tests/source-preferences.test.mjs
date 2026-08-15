import test from 'node:test';
import assert from 'node:assert/strict';

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

test('CLI verify forwards trusted and blocked domains for only the current request', async () => {
  const bodies = [];
  const h = harness(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ verdictId: 'TRUE', sources: [] });
  });

  assert.equal(await runCli([
    'verify',
    'A claim',
    '--trusted-domains',
    'reuters.com, apnews.com,reuters.com',
    '--blocked-domains',
    'example.com,bad.test',
    '--json',
  ], h.deps), 0);
  assert.equal(await runCli(['verify', 'Another claim', '--json'], h.deps), 0);

  assert.deepEqual(bodies[0], {
    mode: 'text',
    claim: 'A claim',
    trusted_domains: ['reuters.com', 'apnews.com'],
    blocked_domains: ['example.com', 'bad.test'],
  });
  assert.deepEqual(bodies[1], { mode: 'text', claim: 'Another claim' });
  assert.equal(h.err.length, 0);
});

test('CLI help documents source preference flags', async () => {
  const h = harness(async () => Response.json({}));
  assert.equal(await runCli(['help'], h.deps), 0);
  const output = h.out.join('');
  assert.match(output, /--trusted-domains/);
  assert.match(output, /--blocked-domains/);
});
