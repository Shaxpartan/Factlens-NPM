import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const httpSource = await readFile(new URL('../src/http.ts', import.meta.url), 'utf8');
const cliSource = await readFile(new URL('../src/cli/index.ts', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('1.0.15 release metadata and runtime SDK header stay synchronized', () => {
  assert.equal(packageJson.version, '1.0.15');
  assert.equal(packageLock.version, '1.0.15');
  assert.equal(packageLock.packages?.['']?.version, '1.0.15');
  assert.match(httpSource, /SDK_VERSION\s*=\s*["']1\.0\.15["']/);
});

test('1.0.15 keeps multi result rendering and request in progress recovery', () => {
  assert.match(cliSource, /Array\.isArray\(result\.results\)/);
  assert.match(cliSource, /appendHumanVerifyResult\(lines, item, index, color\)/);
  assert.match(httpSource, /REQUEST_IN_PROGRESS/);
  assert.match(httpSource, /onProgress/);
});

test('1.0.15 documents long media billing, speaker, progress, list and kill', () => {
  assert.match(readme, /3 hours/i);
  assert.match(readme, /10 minutes/i);
  assert.match(readme, /100,000 characters/i);
  assert.match(readme, /30,000 characters/i);
  assert.match(readme, /--speaker/);
  assert.match(readme, /factlens list/);
  assert.match(readme, /factlens kill/);
  assert.match(readme, /animated/i);
  assert.match(changelog, /## 1\.0\.15/);
});
