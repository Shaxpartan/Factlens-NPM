import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const clientSource = await readFile(new URL("../src/client.ts", import.meta.url), "utf8");
const cliSource = await readFile(new URL("../src/cli/index.ts", import.meta.url), "utf8");

test("SDK verify defaults to a 180 second overall deadline", () => {
  assert.match(clientSource, /timeout:\s*180_000/);
});

test("CLI verify uses the 180 second deadline for text, file, image, and audio", () => {
  assert.match(cliSource, /return client\.verify\(input, requestOptions\(flags, 180_000\)\);/);
});
