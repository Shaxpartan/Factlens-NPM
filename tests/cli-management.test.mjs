import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../dist/esm/cli/index.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const KEY_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function context(fetch, configFile) {
  const out = [], err = [];
  return {
    out, err,
    deps: {
      env: { FACTLENS_DEVELOPER_TOKEN: 'fldev_live_account' },
      fetch,
      configFile,
      writeOut: (value) => out.push(String(value)),
      writeErr: (value) => err.push(String(value)),
    },
  };
}

test('CLI project selection persists and scopes project management commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-cli-mgmt-'));
  const configFile = join(root, 'config.json');
  const requests = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    requests.push([init.method, parsed.pathname, parsed.search]);
    if (parsed.pathname === '/v1/projects') return Response.json({ projects: [{ id: PROJECT_ID, name: 'Production' }] });
    if (parsed.pathname.endsWith('/keys')) return Response.json({ keys: [] });
    if (parsed.pathname.endsWith('/logs')) return Response.json({ logs: [], has_more: false, next_cursor: null });
    return Response.json({ ok: true });
  };
  try {
    const select = context(fetch, configFile);
    assert.equal(await runCli(['projects', 'select', PROJECT_ID], select.deps), 0);
    assert.match(select.out.join(''), new RegExp(PROJECT_ID));
    assert.equal(JSON.parse(await readFile(configFile, 'utf8')).selectedProjectId, PROJECT_ID);

    const keys = context(fetch, configFile);
    assert.equal(await runCli(['keys', 'list', '--json'], keys.deps), 0);
    const logs = context(fetch, configFile);
    assert.equal(await runCli(['logs', '--limit', '25', '--json'], logs.deps), 0);

    assert.ok(requests.some(([, path]) => path === `/v1/projects/${PROJECT_ID}/keys`));
    assert.ok(requests.some(([, path, search]) => path === `/v1/projects/${PROJECT_ID}/logs` && search.includes('limit=25')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI key create shows one-time secret and revoke requires explicit --yes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-cli-key-'));
  const configFile = join(root, 'config.json');
  try {
    const fetch = async (_url, init) => init.method === 'POST'
      ? Response.json({ api_key: 'fl_live_once_secret', key: { id: KEY_ID } }, { status: 201 })
      : Response.json({ ok: true });
    const create = context(fetch, configFile);
    assert.equal(await runCli(['keys', 'create', 'Backend', '--project', PROJECT_ID], create.deps), 0);
    assert.match(create.out.join(''), /fl_live_once_secret/);
    assert.match(create.out.join(''), /shown once/i);

    let calls = 0;
    const blocked = context(async () => { calls += 1; return Response.json({ ok: true }); }, configFile);
    assert.equal(await runCli(['keys', 'revoke', KEY_ID, '--project', PROJECT_ID], blocked.deps), 2);
    assert.equal(calls, 0);
    assert.match(blocked.err.join(''), /--yes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI request inspection and account usage use developer-token routes', async () => {
  const paths = [];
  const h1 = context(async (url) => {
    paths.push(new URL(url));
    return Response.json({ request: { request_id: REQUEST_ID } });
  });
  assert.equal(await runCli(['request', REQUEST_ID, '--json'], h1.deps), 0);
  assert.equal(paths[0].pathname, `/v1/requests/${REQUEST_ID}`);

  const h2 = context(async (url) => {
    paths.push(new URL(url));
    return Response.json({ account: {}, project: null, project_usage: null });
  });
  assert.equal(await runCli(['usage', '--account', '--json'], h2.deps), 0);
  assert.equal(paths[1].pathname, '/v1/account/usage');
});
