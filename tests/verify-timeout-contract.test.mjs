import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const clientSource = await readFile(new URL("../src/client.ts", import.meta.url), "utf8");
const cliSource = await readFile(new URL("../src/cli/index.ts", import.meta.url), "utf8");

test("SDK keeps a 180 second default and extends only long audio URL verification", () => {
  assert.match(clientSource, /longFormAudio\s*=\s*input\.mode === "audio_video" && Boolean\(input\.audio_url\)/);
  assert.match(clientSource, /timeout:\s*longFormAudio \? 1_800_000 : 180_000/);
});

test("CLI keeps ordinary verification at 180 seconds and streamed audio at 30 minutes", () => {
  assert.match(cliSource, /requestOptions\(flags, mode === "audio_video" \? 1_800_000 : 180_000\)/);
  assert.match(cliSource, /requestOptions\(flags, 1_800_000\)/);
});
