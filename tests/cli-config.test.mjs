import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configPath, loadConfig, maskSecret, resolveCredentials, saveConfig, clearConfig } from '../dist/esm/cli/config.js';

test('CLI config saves with restrictive permissions, loads, masks, and clears', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-cli-'));
  try {
    const path = configPath({ platform: 'linux', home: root, env: {} });
    assert.equal(path, join(root, '.config', 'factlens', 'config.json'));
    await saveConfig({ apiKey: 'fl_live_abcdefghijklmnopqrstuvwxyz', developerToken: 'fldev_live_abcdefghijklmnopqrstuvwxyz', selectedProjectId: 'project-1' }, path);
    assert.deepEqual(await loadConfig(path), { apiKey: 'fl_live_abcdefghijklmnopqrstuvwxyz', developerToken: 'fldev_live_abcdefghijklmnopqrstuvwxyz', selectedProjectId: 'project-1' });
    assert.match(maskSecret('fl_live_abcdefghijklmnopqrstuvwxyz'), /^fl_live_.*wxyz$/);
    const raw = await readFile(path, 'utf8');
    assert.doesNotMatch(raw, /undefined/);
    await clearConfig(path);
    assert.deepEqual(await loadConfig(path), {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('environment variables override saved CLI credentials and base URLs', () => {
  const result = resolveCredentials(
    { apiKey: 'saved-api', developerToken: 'saved-dev', selectedProjectId: 'saved-project' },
    {
      FACTLENS_API_KEY: 'env-api',
      FACTLENS_DEVELOPER_TOKEN: 'env-dev',
      FACTLENS_RUNTIME_BASE_URL: 'https://runtime.example',
      FACTLENS_MANAGEMENT_BASE_URL: 'https://management.example',
    },
  );
  assert.deepEqual(result, {
    apiKey: 'env-api',
    developerToken: 'env-dev',
    selectedProjectId: 'saved-project',
    runtimeBaseUrl: 'https://runtime.example',
    managementBaseUrl: 'https://management.example',
  });
});
