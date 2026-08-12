import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const http = await readFile(new URL('../src/http.ts', import.meta.url), 'utf8');

test('package and runtime identify the 1.0.7 release consistently', () => {
  assert.equal(pkg.version, '1.0.7');
  assert.equal(lock.version, '1.0.7');
  assert.equal(lock.packages?.['']?.version, '1.0.7');
  assert.match(http, /SDK_VERSION\s*=\s*["']1\.0\.7["']/);
});
