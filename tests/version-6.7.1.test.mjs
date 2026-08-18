import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const http = await readFile(new URL('../src/http.ts', import.meta.url), 'utf8');

test('FactLens package, lockfile, and SDK identify as 6.7.1', () => {
  assert.equal(pkg.version, '6.7.1');
  assert.equal(lock.version, '6.7.1');
  assert.equal(lock.packages[''].version, '6.7.1');
  assert.match(http, /SDK_VERSION\s*=\s*["']6\.7\.1["']/);
});
