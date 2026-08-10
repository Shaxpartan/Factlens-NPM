# Runtime API

Runtime methods require a project API key. Each chargeable request receives one UUID `X-Request-ID`; automatic retries reuse it.

## Verify

```ts
await factlens.verify({
  mode: "text",
  claim: "Example claim",
  results_per_search: 10,
});
```

Audio/video and image/post checks use the same method:

```ts
await factlens.verify({
  mode: "audio_video",
  transcript: "Existing transcript",
});

await factlens.verify({
  mode: "image_post",
  claim: "The image shows the stated event.",
  image_base64: imageBase64,
});
```

## Search

```ts
const result = await factlens.search({ query: "primary sources", count: 10 });
```

## AI

```ts
const result = await factlens.ai<{ summary: string }>({
  prompt: "Return JSON with a concise summary.",
  response_format: "json",
});

console.log(result.output?.summary);
```

## Transcribe

```ts
import { readFile } from "node:fs/promises";

const audio = await readFile("clip.webm");
const result = await factlens.transcribe({
  audio,
  contentType: "audio/webm",
  language: "auto",
});
```

## Runtime usage

```ts
const usage = await factlens.usage.get();
```
