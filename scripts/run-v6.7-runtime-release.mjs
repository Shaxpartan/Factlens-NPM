import { readFile, writeFile } from 'node:fs/promises';

const canonicalizer = 'scripts/apply-v6.7-runtime-release.mjs';
let source = await readFile(canonicalizer, 'utf8');
source = source.replace(
  "if (!source.includes('--trace              Full safe transport/runtime trace'))",
  "if (!source.includes('--trace'))",
);
await writeFile(canonicalizer, source);
await import(`./apply-v6.7-runtime-release.mjs?run=${Date.now()}`);
