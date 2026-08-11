import test from 'node:test';
import assert from 'node:assert/strict';

import FactLens from '../dist/esm/index.js';

test('runtime and management requests can target separate base URLs', async () => {
  const requests = [];
  const client = new FactLens({
    apiKey: 'fl_live_project',
    developerToken: 'fldev_live_account',
    runtimeBaseUrl: 'https://runtime.example/functions/v1/factlens-api',
    managementBaseUrl: 'https://management.example/functions/v1/factlens-api-platform',
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).includes('runtime.example')) return Response.json({ verdictId: 'TRUE' });
      return Response.json({ projects: [] });
    },
  });

  await client.verify({ mode: 'text', claim: 'example' });
  await client.projects.list();

  assert.equal(requests[0], 'https://runtime.example/functions/v1/factlens-api/v1/verify');
  assert.equal(requests[1], 'https://management.example/functions/v1/factlens-api-platform/v1/projects');
});

test('baseUrl remains a compatibility default for both credential classes', async () => {
  const requests = [];
  const client = new FactLens({
    apiKey: 'fl_live_project',
    developerToken: 'fldev_live_account',
    baseUrl: 'https://shared.example/',
    fetch: async (url) => {
      requests.push(String(url));
      return String(url).endsWith('/v1/projects') ? Response.json({ projects: [] }) : Response.json({ verdictId: 'TRUE' });
    },
  });
  await client.verify({ mode: 'text', claim: 'example' });
  await client.projects.list();
  assert.deepEqual(requests, ['https://shared.example/v1/verify', 'https://shared.example/v1/projects']);
});
