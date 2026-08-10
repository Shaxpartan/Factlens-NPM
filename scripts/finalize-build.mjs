import { writeFile } from "node:fs/promises";

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
