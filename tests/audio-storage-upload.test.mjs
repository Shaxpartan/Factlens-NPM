import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const audio = await readFile(new URL('../src/cli/audio.ts', import.meta.url), 'utf8');

test('CLI prepares audio through the dedicated temporary upload broker', () => {
  assert.match(audio, /factlens-audio-upload/);
  assert.match(audio, /action:\s*["']prepare["']/);
  assert.match(audio, /action:\s*["']resolve["']/);
  assert.match(audio, /action:\s*["']release["']/);
  assert.match(audio, /action:\s*["']cleanup["']/);
});

test('CLI uses Supabase TUS with the required 6 MiB chunk size', () => {
  assert.match(audio, /6 \* 1024 \* 1024/);
  assert.match(audio, /Tus-Resumable/);
  assert.match(audio, /Upload-Metadata/);
  assert.match(audio, /Upload-Offset/);
  assert.match(audio, /application\/offset\+octet-stream/);
  assert.match(audio, /x-signature/);
  assert.match(audio, /tusOffset/);
  assert.match(audio, /recovered > requestedOffset/);
});

test('CLI starts normal verification with a temporary signed URL instead of raw media', () => {
  assert.match(audio, /audio_url/);
  assert.match(audio, /REQUEST_IN_PROGRESS/);
  assert.doesNotMatch(audio, /createReadStream/);
  assert.doesNotMatch(audio, /duplex:\s*["']half["']/);
});
