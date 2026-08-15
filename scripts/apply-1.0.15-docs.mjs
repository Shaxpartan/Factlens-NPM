import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (before === after) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}
function once(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`Missing ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

await edit('README.md', (input) => once(input,
  'Source preferences apply only to the current verification request. Trusted domains are prioritized when they appear in evidence results. Blocked domains are excluded. Neither list is saved to your account, project, or CLI configuration.',
  'Trusted and blocked domains can be saved as defaults for an API key in the FactLens developer dashboard. If a verification request omits a list, the API uses that key’s saved default. Supplying `trusted_domains` or `blocked_domains` in the SDK or CLI overrides the matching saved list for that request only, including an explicit empty array. Trusted domains are prioritized when matching evidence is available. Blocked domains are excluded and take precedence.',
  'README source preferences'));

await edit('docs/runtime-api.md', (input) => {
  let s = once(input,
    'Source preferences are request scoped and are never written to FactLens account, project, or CLI configuration. Use `trusted_domains` to prioritize matching evidence sources and `blocked_domains` to exclude matching domains. Blocked domains take precedence if the same domain appears in both arrays.',
    'Source preferences can be saved as defaults for an API key in the developer dashboard. If a request omits a list, the API uses that key’s saved default. Supplying `trusted_domains` or `blocked_domains` overrides the matching saved list for that request only, including an explicit empty array. Trusted domains prioritize matching evidence; blocked domains exclude matching evidence and take precedence.',
    'runtime source preferences');
  s = once(s,
    'If you already have a transcript:',
    'Audio verification is limited to 3 hours and costs one API credit per 10 minutes or part thereof. The CLI streams long local audio while the SDK can use `audio_url` for long form input. Raw audio is not stored in the FactLens database.\n\nIf you already have a transcript:',
    'runtime audio billing');
  s = once(s,
    '```\n\n## Source preferences',
    '```\n\nThe first 100,000 transcript characters use the normal one credit charge. Each additional 30,000 characters or part thereof adds one credit.\n\n## Source preferences',
    'runtime transcript billing');
  return s;
});

await edit('docs/usage-and-limits.md', (input) => `${input.trimEnd()}\n\n## Media request metering\n\nUploaded or URL based audio is limited to 3 hours and costs one API credit per 10 minutes or part thereof. A direct transcript uses the normal one credit charge for its first 100,000 characters, then adds one credit for every additional 30,000 characters or part thereof. The final media cost is recorded on the same idempotent request, so retries with the same request ID do not charge the request again. Raw audio is not stored in the FactLens database.\n`);
