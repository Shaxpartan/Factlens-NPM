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

const helpFirst = [
  '    const command = parsed.positionals[0];',
  '    if (!command || command === "help" || flagBoolean(parsed.flags, "help")) {',
  '      context.writeOut(helpText());',
  '      return 0;',
  '    }',
  '    if (command === "--version" || command === "version" || flagBoolean(parsed.flags, "version")) {',
  '      context.writeOut(`${SDK_VERSION}\\n`);',
  '      return 0;',
  '    }',
].join("\n");

const versionFirst = [
  '    const command = parsed.positionals[0];',
  '    if (command === "--version" || command === "version" || flagBoolean(parsed.flags, "version")) {',
  '      context.writeOut(`${SDK_VERSION}\\n`);',
  '      return 0;',
  '    }',
  '    if (!command || command === "help" || flagBoolean(parsed.flags, "help")) {',
  '      context.writeOut(helpText());',
  '      return 0;',
  '    }',
].join("\n");

for (const target of ["../dist/esm/cli/index.js", "../dist/cjs/cli/index.js"]) {
  const cli = new URL(target, import.meta.url);
  const source = await readFile(cli, "utf8");
  let finalized = source;
  if (source.includes(helpFirst)) finalized = source.replace(helpFirst, versionFirst);
  else if (!source.includes(versionFirst)) throw new Error(`FactLens CLI build has an unexpected command-dispatch shape: ${target}`);
  if (finalized !== source) await writeFile(cli, finalized, "utf8");
}

const cli = new URL("../dist/esm/cli/index.js", import.meta.url);
const source = await readFile(cli, "utf8");
if (!source.startsWith("#!/usr/bin/env node\n")) {
  throw new Error("FactLens CLI build is missing the Node.js shebang.");
}
await chmod(cli, 0o755);
