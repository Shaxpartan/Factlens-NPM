import { chmod, readFile, writeFile } from "node:fs/promises";

await writeFile(
  new URL("../dist/cjs/package.json", import.meta.url),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);

await writeFile(
  new URL("../dist/esm/package.json", import.meta.url),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  "utf8",
);

const helpCondition =
  'if (!command || command === "help" || flagBoolean(parsed.flags, "help")) {';
const versionSafeHelpCondition =
  'if ((!command && !flagBoolean(parsed.flags, "version")) || command === "help" || flagBoolean(parsed.flags, "help")) {';

for (const target of ["../dist/esm/cli/index.js", "../dist/cjs/cli/index.js"]) {
  const cli = new URL(target, import.meta.url);
  const source = await readFile(cli, "utf8");
  let finalized = source;
  if (source.includes(helpCondition)) finalized = source.replace(helpCondition, versionSafeHelpCondition);
  else if (!source.includes(versionSafeHelpCondition)) throw new Error(`FactLens CLI build has an unexpected command-dispatch shape: ${target}`);
  if (finalized !== source) await writeFile(cli, finalized, "utf8");
}

const cli = new URL("../dist/esm/cli/index.js", import.meta.url);
const source = await readFile(cli, "utf8");
if (!source.startsWith("#!/usr/bin/env node\n")) {
  throw new Error("FactLens CLI build is missing the Node.js shebang.");
}
await chmod(cli, 0o755);
