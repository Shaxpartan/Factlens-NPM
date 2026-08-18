import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const http = await readFile(new URL('../src/http.ts', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/client.ts', import.meta.url), 'utf8');

test('package and SDK identify as 6.7.1', () => {
  assert.equal(pkg.version, '6.7.1');
  assert.match(http, /SDK_VERSION\s*=\s*["']6\.7\.1["']/);
});

test('Server-Timing parser maps known phases safely and ignores malformed metrics', async () => {
  const { parseServerTiming, buildResponseMeta } = await import('../dist/esm/runtime/response-meta.js');
  assert.deepEqual(parseServerTiming('auth;dur=12.4, customization;dur=25, core;dur=4012.1, postprocess;dur=8, edge;dur=5030, nonsense'), {
    authMs: 12.4,
    customizationMs: 25,
    coreMs: 4012.1,
    postprocessMs: 8,
    edgeMs: 5030,
  });
  assert.deepEqual(parseServerTiming(null), {});
  const meta = buildResponseMeta({
    headers: new Headers({ 'server-timing': 'core;dur=4000, edge;dur=5000', 'x-factlens-request-id': 'abc' }),
    clientTotalMs: 6200,
    status: 200,
  });
  assert.equal(meta.serverTiming.coreMs, 4000);
  assert.equal(meta.serverTiming.edgeMs, 5000);
  assert.equal(meta.gatewayNetworkMs, 1200);
  assert.equal(meta.requestId, 'abc');
});

test('verifyDetailed returns the same Verify payload plus transport/runtime metadata without another request', () => {
  assert.match(client, /verifyDetailed\(/);
  assert.match(client, /requestDetailed<VerifyResponse>/);
  assert.match(client, /verify\([\s\S]*verifyDetailed[\s\S]*\.data/);
});