import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public SDK exposes verify but never standalone managed search, AI, or transcription', async () => {
  const source = await read('src/client.ts');
  const types = await read('src/types/index.ts');

  assert.match(source, /\bverify\s*\(/);
  assert.doesNotMatch(source, /\bsearch\s*\(/);
  assert.doesNotMatch(source, /\bai\s*</);
  assert.doesNotMatch(source, /\btranscribe\s*\(/);

  for (const name of ['SearchInput', 'SearchResponse', 'AiInput', 'AiResponse', 'TranscribeInput', 'TranscribeResponse']) {
    assert.doesNotMatch(types, new RegExp(`export type ${name}\\b`));
  }
});

test('package describes one SDK plus CLI and does not publish standalone provider commands', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(packageJson.bin?.factlens, './dist/esm/cli/index.js');
  assert.ok(Array.isArray(packageJson.files));
  assert.ok(packageJson.files.includes('dist'));
});
