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

const cli = new URL("../dist/esm/cli/index.js", import.meta.url);
const source = await readFile(cli, "utf8");
if (!source.startsWith("#!/usr/bin/env node\n")) {
  throw new Error("FactLens CLI build is missing the Node.js shebang.");
}
await chmod(cli, 0o755);
