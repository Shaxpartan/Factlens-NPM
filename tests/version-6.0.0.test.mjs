import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const httpSource = await readFile(new URL('../src/http.ts', import.meta.url), 'utf8');
const cliSource = await readFile(new URL('../src/cli/index.ts', import.meta.url), 'utf8');
const typesSource = await readFile(new URL('../src/types/index.ts', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const runtimeDocs = await readFile(new URL('../docs/runtime-api.md', import.meta.url), 'utf8');
const usageDocs = await readFile(new URL('../docs/usage-and-limits.md', import.meta.url), 'utf8');

test('6.7.0 release metadata and runtime SDK header stay synchronized', () => {
  assert.equal(packageJson.version, '6.7.0');
  assert.equal(packageLock.version, '6.7.0');
  assert.equal(packageLock.packages?.['']?.version, '6.7.0');
  assert.match(httpSource, /SDK_VERSION\s*=\s*["']6\.7\.0["']/);
});

test('6.7.0 keeps image claims optional in CLI and SDK', () => {
  assert.match(typesSource, /claim\?: string;/);
  assert.match(cliSource, /const claim = clean\(flagString\(flags, "claim"\) \|\| positionals\.join\(" "\)\);/);
  assert.match(cliSource, /\.\.\.\(claim \? \{ claim \} : \{\}\)/);
  assert.match(cliSource, /factlens verify --image image\.png \[--claim "Optional claim"\]/);
  assert.match(changelog, /## 6\.5\.0/);
});

test('6.7.0 keeps multi result rendering and request in progress recovery', () => {
  assert.match(cliSource, /Array\.isArray\(result\.results\)/);
  assert.match(cliSource, /appendHumanVerifyResult\(lines, item, index, color, verbose/);
  assert.match(httpSource, /REQUEST_IN_PROGRESS/);
  assert.match(httpSource, /onProgress/);
});

test('6.7.0 preserves existing media, progress, and source preference documentation', () => {
  for (const doc of [readme, runtimeDocs, usageDocs]) {
    assert.match(doc, /3 hours/i);
    assert.match(doc, /10 minutes/i);
    assert.match(doc, /100,000(?: transcript)? characters/i);
    assert.match(doc, /30,000(?: transcript)? characters/i);
  }
  assert.match(readme, /--speaker/);
  assert.match(readme, /factlens list/);
  assert.match(readme, /factlens kill/);
  assert.match(readme, /animated/i);
  assert.match(readme, /saved as defaults for each API key/i);
  assert.match(readme, /overrides the matching saved list for that request only/i);
  assert.match(readme, /explicit empty array/i);
  assert.match(runtimeDocs, /saved as defaults for an API key/i);
  assert.match(runtimeDocs, /overrides the matching saved list for that request only/i);
  assert.match(runtimeDocs, /explicit empty array/i);
});
