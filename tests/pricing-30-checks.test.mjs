import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('SDK documentation reflects the current API quota and pricing', async () => {
  const [readme, limits, changelog] = await Promise.all([
    read('README.md'),
    read('docs/usage-and-limits.md'),
    read('CHANGELOG.md'),
  ]);

  assert.match(readme, /Daily free requests \| 30 shared \| 0/);
  assert.match(readme, /\$1 funds 30 API checks/i);
  assert.match(limits, /Daily free requests \| 30 shared\/account\/day \| 0/);
  assert.match(limits, /\$1 funds 30 API checks/i);
  assert.match(changelog, /30 checks per \$1/i);

  for (const source of [readme, limits]) {
    assert.doesNotMatch(source, /Daily free requests \| 100 shared/i);
    assert.doesNotMatch(source, /100 shared\/account\/day/i);
  }
});
