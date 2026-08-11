# Runtime API

Runtime methods require a project API key. FactLens intentionally exposes a narrow runtime surface: Verify plus runtime Usage.

Transcription, current-web evidence retrieval, required safety checks, and AI analysis are internal stages of Verify. They are not standalone SDK methods or CLI commands.

## Verify

Text:

```ts
await factlens.verify({
  mode: "text",
  claim: "Example claim",
  results_per_search: 10,
});
```

Image/post:

```ts
await factlens.verify({
  mode: "image_post",
  claim: "The image shows the stated event.",
  image_base64: imageBase64,
  content_type: "image/jpeg",
});
```

Audio/video:

```ts
await factlens.verify({
  mode: "audio_video",
  audio_base64: audioBase64,
  content_type: "audio/mpeg",
});
```

If you already have a transcript:

```ts
await factlens.verify({
  mode: "audio_video",
  transcript: existingTranscript,
  claim: "Optional focused claim",
});
```

Every Verify request receives one UUID `X-Request-ID` unless you provide one. Automatic retries within a single SDK call reuse that ID for idempotency.

CLI equivalents:

```bash
factlens verify "Example claim"
factlens verify --image proof.png --claim "The image shows the stated event."
factlens verify --audio clip.mp3
```

## Runtime usage

```ts
const usage = await factlens.usage.get();
```

CLI:

```bash
factlens usage
```

REST uses `POST /v1/verify` and `GET /v1/usage`.
