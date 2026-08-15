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
  audio_url: "https://example.com/interview.mp3",
  speaker: "Jane Doe",
});
```

Audio verification is limited to 3 hours and costs one API credit per 10 minutes or part thereof. The CLI streams long local audio while the SDK can use `audio_url` for long form input. Inline `audio_base64` remains available for smaller media. Raw audio is not stored in the FactLens database.

If you already have a transcript:

```ts
await factlens.verify({
  mode: "audio_video",
  transcript: existingTranscript,
  claim: "Optional focused claim",
  speaker: "Jane Doe",
});
```

The first 100,000 transcript characters use the normal one credit charge. Each additional 30,000 characters or part thereof adds one credit.

## Source preferences

Trusted and blocked domains can be saved as defaults for an API key in the FactLens developer dashboard. When a Verify request omits a preference list, the API uses that key's saved list. Supplying `trusted_domains` or `blocked_domains` overrides the matching saved list for that request only. In the SDK, an explicit empty array overrides the saved list with no domains for that request. Trusted domains prioritize matching evidence. Blocked domains exclude matching evidence and take precedence if a domain appears in both lists.

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

The CLI flags are request overrides and do not rewrite the API key defaults saved in the dashboard.

Every Verify request receives one UUID `X-Request-ID` unless you provide one. Automatic retries and `REQUEST_IN_PROGRESS` polling within a single SDK call reuse that ID for idempotency.

CLI equivalents:

```bash
factlens verify "Example claim"
factlens verify --image proof.png --claim "The image shows the stated event."
factlens verify --audio clip.mp3 --speaker "Jane Doe"
factlens list
factlens kill REQUEST_ID
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
