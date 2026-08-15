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

Audio verification is limited to 3 hours and costs one API credit per 10 minutes or part thereof. The CLI streams long local audio while the SDK can use `audio_url` for long form input. Raw audio is not stored in the FactLens database.

If you already have a transcript:

```ts
await factlens.verify({
  mode: "audio_video",
  transcript: existingTranscript,
  claim: "Optional focused claim",
});
```

The first 100,000 transcript characters use the normal one credit charge. Each additional 30,000 characters or part thereof adds one credit.

## Source preferences

Source preferences can be saved as defaults for an API key in the developer dashboard. If a request omits a list, the API uses that key’s saved default. Supplying `trusted_domains` or `blocked_domains` overrides the matching saved list for that request only, including an explicit empty array. Trusted domains prioritize matching evidence; blocked domains exclude matching evidence and take precedence.

```ts
await factlens.verify({
  mode: "text",
  claim: "Example claim",
  trusted_domains: ["reuters.com", "apnews.com"],
  blocked_domains: ["example.com"],
});
```

CLI:

```bash
factlens verify "Example claim" --trusted-domains reuters.com,apnews.com --blocked-domains example.com
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
