import test from 'node:test';
import assert from 'node:assert/strict';

import FactLens, { FactLensConfigurationError, FactLensError } from '../dist/esm/index.js';

const DASHBOARD = 'https://api.factlens.pro/dashboard';

test('missing runtime API key is actionable', async () => {
  const client = new FactLens({ fetch: async () => Response.json({}) });
  await assert.rejects(client.verify({ mode: 'text', claim: 'example' }), (error) => {
    assert.ok(error instanceof FactLensConfigurationError);
    assert.match(error.message, /project API key/i);
    assert.match(error.message, /FACTLENS_API_KEY/);
    assert.match(error.message, /api\.factlens\.pro\/dashboard/);
    assert.equal(error.helpUrl, DASHBOARD);
    return true;
  });
});

test('missing developer token is actionable', async () => {
  const client = new FactLens({ fetch: async () => Response.json({}) });
  await assert.rejects(client.projects.list(), (error) => {
    assert.ok(error instanceof FactLensConfigurationError);
    assert.match(error.message, /developer token/i);
    assert.match(error.message, /FACTLENS_DEVELOPER_TOKEN/);
    assert.match(error.message, /api\.factlens\.pro\/dashboard/);
    assert.equal(error.helpUrl, DASHBOARD);
    return true;
  });
});

test('invalid project key keeps the backend code and adds dashboard guidance', async () => {
  const client = new FactLens({
    apiKey: 'fl_live_bad',
    fetch: async () => Response.json({
      error: 'API_KEY_INVALID',
      message: 'The API key is invalid, revoked, expired, or belongs to an inactive project.',
    }, { status: 401 }),
  });
  await assert.rejects(client.verify({ mode: 'text', claim: 'example' }), (error) => {
    assert.ok(error instanceof FactLensError);
    assert.equal(error.code, 'API_KEY_INVALID');
    assert.equal(error.status, 401);
    assert.match(error.message, /api\.factlens\.pro\/dashboard/);
    assert.equal(error.helpUrl, DASHBOARD);
    return true;
  });
});

test('verification-stage failures preserve stable stage, details, and request ID', async () => {
  const client = new FactLens({
    apiKey: 'fl_live_project',
    fetch: async () => Response.json({
      error: 'VERIFICATION_SEARCH_FAILED',
      message: 'FactLens could not retrieve evidence for this verification request.',
      stage: 'search',
      request_id: '4cb041a6-5dc9-4ae6-bf6e-327c82f41fde',
      details: { reason: 'provider_unavailable' },
    }, { status: 503 }),
  });
  await assert.rejects(client.verify({ mode: 'text', claim: 'example' }, { maxRetries: 0 }), (error) => {
    assert.ok(error instanceof FactLensError);
    assert.equal(error.code, 'VERIFICATION_SEARCH_FAILED');
    assert.equal(error.stage, 'search');
    assert.equal(error.requestId, '4cb041a6-5dc9-4ae6-bf6e-327c82f41fde');
    assert.deepEqual(error.details, { reason: 'provider_unavailable' });
    assert.equal(error.retryable, true);
    return true;
  });
});
