import { readFile, writeFile } from 'node:fs/promises';

const canonicalizer = 'scripts/apply-v6.7-runtime-release.mjs';
let source = await readFile(canonicalizer, 'utf8');
source = source.replace(
  "if (!source.includes('--trace              Full safe transport/runtime trace'))",
  "if (!source.includes('--trace'))",
);
source = source.replace(
  "if (!source.includes('### Detailed SDK runtime metadata'))",
  "if (!source.includes('## v6.7.0 runtime metadata'))",
);
await writeFile(canonicalizer, source);
await import(`./apply-v6.7-runtime-release.mjs?run=${Date.now()}`);

const readmePath = 'README.md';
let readme = await readFile(readmePath, 'utf8');
const runtimeHeading = '## v6.7.0 runtime metadata\n\n';
const firstRuntimeSection = readme.indexOf(runtimeHeading);
const duplicateRuntimeSection = firstRuntimeSection < 0 ? -1 : readme.indexOf(runtimeHeading, firstRuntimeSection + runtimeHeading.length);
if (duplicateRuntimeSection >= 0) {
  const cliSection = readme.indexOf('## CLI\n', duplicateRuntimeSection);
  if (cliSection < 0) throw new Error('v6.7 release runner: duplicate runtime metadata has no CLI boundary');
  readme = readme.slice(0, duplicateRuntimeSection) + readme.slice(cliSection);
  await writeFile(readmePath, readme);
}
