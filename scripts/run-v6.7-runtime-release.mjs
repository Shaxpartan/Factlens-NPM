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
