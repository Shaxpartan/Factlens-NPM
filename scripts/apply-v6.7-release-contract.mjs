import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

const lockPath = new URL('package-lock.json', root);
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
lock.version = '6.7.0';
if (lock.packages?.['']) lock.packages[''].version = '6.7.0';
await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

const cliPath = new URL('tests/cli-core.test.mjs', root);
let cli = await readFile(cliPath, 'utf8');
cli = cli.replace(/\/\^6\\\.5\\\.0\$\//g, '/^6\\.7\\.0$/');
if (!cli.includes('/^6\\.7\\.0$/')) throw new Error('CLI version expectation did not update');
await writeFile(cliPath, cli);

const runtimePath = new URL('tests/runtime.test.mjs', root);
let runtime = await readFile(runtimePath, 'utf8');
runtime = runtime.replace('assert.equal(headers.get("x-factlens-sdk-version"), "6.5.0");', 'assert.equal(headers.get("x-factlens-sdk-version"), "6.7.0");');
const retryStart = runtime.indexOf('test("verify retries reuse the request ID and respect retryable response classes"');
const retryEnd = runtime.indexOf('\ntest("ordinary validation errors are structured and are not retried"', retryStart);
if (retryStart < 0 || retryEnd <= retryStart) throw new Error('runtime retry test anchors drifted');
const replacement = `test("billable verify never auto-retries a retryable 5xx and exposes the same request ID for caller recovery", async () => {\n  const ids = [];\n  let attempt = 0;\n  const client = new FactLens({\n    apiKey: "fl_live_project",\n    fetch: async (_url, init) => {\n      attempt += 1;\n      ids.push(new Headers(init.headers).get("x-request-id"));\n      return Response.json(\n        { error: "FACTLENS_API_BUSY", message: "Try again", request_id: ids[0] },\n        { status: 503, headers: { "Retry-After": "0" } },\n      );\n    },\n  });\n\n  await assert.rejects(\n    client.verify({ mode: "text", claim: "Return true" }, { maxRetries: 5 }),\n    (error) => {\n      assert.ok(error instanceof FactLensError);\n      assert.equal(error.code, "FACTLENS_API_BUSY");\n      assert.equal(error.retryable, true);\n      assert.equal(error.requestId, ids[0]);\n      return true;\n    },\n  );\n  assert.equal(attempt, 1);\n  assert.equal(ids.length, 1);\n});\n`;
runtime = runtime.slice(0, retryStart) + replacement + runtime.slice(retryEnd);
if (!runtime.includes('"6.7.0"')) throw new Error('runtime SDK version expectation did not update');
if (!runtime.includes('billable verify never auto-retries')) throw new Error('runtime retry contract did not update');
await writeFile(runtimePath, runtime);

const versionPath = new URL('tests/version-6.0.0.test.mjs', root);
let version = await readFile(versionPath, 'utf8');
version = version.replaceAll('6.5.0', '6.7.0').replaceAll('6\\.5\\.0', '6\\.7\\.0');
if (!version.includes("assert.equal(packageJson.version, '6.7.0')")) throw new Error('release version contract did not update');
await writeFile(versionPath, version);
