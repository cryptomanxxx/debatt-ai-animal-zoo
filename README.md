# Debatt-AI Animal Zoo — private experiment

Two characters, three-minute Gemini Live conversations, and an owner-only test environment.

For an owner-private trial, enter the Gemini API key into the password field on
the private Site. The key is sent over HTTPS to the Worker for a single ephemeral
token request. It stays in the password field for retries within the same open
page and is cleared when that page is unloaded or by pressing Clear. It is not
stored in localStorage, sessionStorage, cookies, the Worker or any database.
Google provider failures are classified by status and a fixed set of safe error
codes; do not forward or log raw provider error bodies, which could include keys.
The Google ErrorInfo reason is checked against a fixed allowlist to distinguish
an invalid key (`API_KEY_INVALID`) from an invalid token payload. On HTTP 400
without a known key or billing reason, the private lab retries once using the
documented minimal token request (one use, 45-second connection window,
three-minute expiry). This retry drops Live API config constraints, so it must
not be used as-is for a publicly accessible service.

The private lab offers three paths: browser speech-to-text -> Gemini Live text
input -> spoken animal response (first button); direct low-latency PCM voice ->
Gemini Live; and typed input. The speech-to-text path uses `SpeechRecognition`
or `webkitSpeechRecognition` when available, with interim transcripts visible
on the page, and sends the recognized final text through the existing Live
WebSocket. Speech recognition browser support and cloud processing vary by
device/browser; it is not guaranteed on every Samsung Internet release.

The direct voice test shows packet count, packets containing measurable audio,
peak captured mic level, and live/final Gemini input transcriptions. The
"finished speaking" control now **pauses the outgoing microphone packets**
before sending `audioStreamEnd`, and can resume if no response arrives. These
diagnostics do not store speech recordings or raw microphone data on the Site
server. The separate browser speech-to-text test distinguishes raw microphone
stream trouble from Gemini Live voice detection and response trouble. The text
input still isolates model response and speaker playback faults. None of this
can be fully validated without a real browser microphone and active Gemini key.
Never paste a real key into the repository, commit history, or chat.

Before any wider launch, configure `GEMINI_API_KEY` as a hosted runtime secret
and remove the owner-key form. The isolate-local throttle is not a production
rate limiter and this Site must remain owner-private while BYOK is enabled.

## Development

```sh
npm ci && npm run build && npm test   # same as CI; CI also runs the Python rig tests
npm run dev                            # local preview; /qa has viewport and speaking fixtures
```

Rufus is rendered with Three.js (`web/rufus/`). By default he is a procedural fox. With a rigged GLB from `npm run rig` he becomes the 3D model, with a jaw that opens on Gemini's played audio, blinks and moving ears and tail. See `docs/rufus-3d.md` and `docs/rigging-plan.md`.

