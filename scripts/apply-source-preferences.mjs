import { readFile, writeFile, rm } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no change produced`);
  await writeFile(path, after);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: target not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: target is not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

await edit('src/types/index.ts', (source) => replaceOnce(
  source,
  '  results_per_search?: number;\n  verdicts?: VerdictInput[];\n',
  '  results_per_search?: number;\n  trusted_domains?: string[];\n  blocked_domains?: string[];\n  verdicts?: VerdictInput[];\n',
  'VerifyInput source preferences',
));

await edit('src/cli/index.ts', (source) => {
  source = replaceOnce(
    source,
    '  return client.verify(input, requestOptions(flags, 180_000));\n',
    '  const trustedDomains = domainListFlag(flags, "trusted-domains"), blockedDomains = domainListFlag(flags, "blocked-domains");\n  input = { ...input, ...(trustedDomains.length ? { trusted_domains: trustedDomains } : {}), ...(blockedDomains.length ? { blocked_domains: blockedDomains } : {}) };\n  return client.verify(input, requestOptions(flags, 180_000));\n',
    'CLI verify source preferences',
  );
  source = replaceOnce(
    source,
    'function flagBoolean(flags: Flags, name: string) {\n',
    'function domainListFlag(flags: Flags, name: string) {\n  const value = flagString(flags, name);\n  if (!value) return [];\n  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];\n}\n\nfunction flagBoolean(flags: Flags, name: string) {\n',
    'CLI source preference flag parser',
  );
  source = replaceOnce(
    source,
    '  factlens verify <claim> [--json]\\n',
    '  factlens verify <claim> [--trusted-domains a.com,b.com] [--blocked-domains c.com] [--json]\\n',
    'CLI help source preference usage',
  );
  source = replaceOnce(
    source,
    'Request options:\\n  --timeout MS       Total client timeout\\n',
    'Source preferences:\\n  --trusted-domains LIST  Prioritize matching domains for this verification\\n  --blocked-domains LIST  Exclude matching domains for this verification\\n\\nRequest options:\\n  --timeout MS       Total client timeout\\n',
    'CLI help source preference explanation',
  );
  return source;
});

await edit('src/http.ts', (source) => replaceOnce(source, 'export const SDK_VERSION = "1.0.7";', 'export const SDK_VERSION = "1.0.11";', 'SDK version'));

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (packageJson.version !== '1.0.7') throw new Error(`package.json expected 1.0.7, found ${packageJson.version}`);
packageJson.version = '1.0.11';
await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

const packageLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (packageLock.version !== '1.0.7' || packageLock.packages?.['']?.version !== '1.0.7') throw new Error('package-lock root version is not 1.0.7');
packageLock.version = '1.0.11';
packageLock.packages[''].version = '1.0.11';
await writeFile('package-lock.json', `${JSON.stringify(packageLock, null, 2)}\n`);

await edit('README.md', (source) => {
  const marker = '### Runtime usage\n\n```ts\nconst usage = await factlens.usage.get();\n```\n';
  const addition = `### Source preferences\n\nSource preferences apply only to the current verification request. Trusted domains are prioritized when they appear in evidence results. Blocked domains are excluded. Neither list is saved to your account, project, or CLI configuration.\n\nSDK:\n\n\`\`\`ts\nawait factlens.verify({\n  mode: "text",\n  claim: "A claim to verify",\n  trusted_domains: ["reuters.com", "apnews.com"],\n  blocked_domains: ["example.com"],\n});\n\`\`\`\n\nCLI:\n\n\`\`\`bash\nfactlens verify "A claim to verify" --trusted-domains reuters.com,apnews.com --blocked-domains example.com\n\`\`\`\n\n${marker}`;
  return replaceOnce(source, marker, addition, 'README source preferences');
});

await edit('docs/runtime-api.md', (source) => {
  const marker = 'Every Verify request receives one UUID `X-Request-ID` unless you provide one. Automatic retries within a single SDK call reuse that ID for idempotency.\n';
  const addition = `## Source preferences\n\nSource preferences are request scoped and are never written to FactLens account, project, or CLI configuration. Use \`trusted_domains\` to prioritize matching evidence sources and \`blocked_domains\` to exclude matching domains. Blocked domains take precedence if the same domain appears in both arrays.\n\n\`\`\`ts\nawait factlens.verify({\n  mode: "text",\n  claim: "Example claim",\n  trusted_domains: ["reuters.com", "apnews.com"],\n  blocked_domains: ["example.com"],\n});\n\`\`\`\n\nCLI:\n\n\`\`\`bash\nfactlens verify "Example claim" --trusted-domains reuters.com,apnews.com --blocked-domains example.com\n\`\`\`\n\n${marker}`;
  return replaceOnce(source, marker, addition, 'runtime API source preferences');
});

await edit('CHANGELOG.md', (source) => replaceOnce(
  source,
  '## Unreleased\n\n- Align SDK and CLI documentation with the FactLens API rate of 30 checks per $1 and 30 free checks per UTC day for eligible free accounts.\n- Clarify that existing unused paid balances are migrated by the API backend and are not converted locally by the SDK.\n',
  '## Unreleased\n\n## 1.0.11 - 2026-08-15\n\n- Add request scoped trusted and blocked domain source preferences to the SDK and CLI.\n- Report FactLens CLI and SDK version 1.0.11 consistently in package metadata and request headers.\n- Align SDK and CLI documentation with the FactLens API rate of 30 checks per $1 and 30 free checks per UTC day for eligible free accounts.\n- Clarify that existing unused paid balances are migrated by the API backend and are not converted locally by the SDK.\n',
  '1.0.11 changelog',
));

await rm('tests/version-1.0.7.test.mjs');
console.log('Applied SDK and CLI source preference edits.');
