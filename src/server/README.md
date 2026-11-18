# Server modules

Next.js Node.js route handlers call server-only modules; browser code never receives provider or database credentials.

- **`lessons/`** coordinates interpretation, exact-maths checks, validated planning, one narration beat per request and playback manifest preparation. Successful stages persist before the response; no detached worker is assumed. Numerical facts and visual geometry come from code, not executable model output.
- **`speech/`** uses the configured Groq model/voice, validates WAV samples and measured durations, and caches clips by exact text and speech configuration. Failures require explicit retry; there is no Flite/provider fallback or automatic regeneration.
- **`db/`** supplies PostgreSQL repositories for production: validated lesson/status JSON, separate content-hashed audio blobs and completed response caching. Leases deduplicate operations and fence expired writers; request pacing respects provider rate-limit signals. There are no application daily/session usage quotas or global single-operation cap.
- **`demo.ts`** signs anonymous cookies used to scope follow-up caches. They are not account authentication or usage allowances. Production guards require database connectivity/schema, a session secret and provider configuration for generation; POST requests enforce same-origin checks.
- **`followup/`** loads a trusted ready lesson or the bundled example, validates the selected step/timestamp and bounded untrusted conversation, then recomputes exact facts before requesting a text answer. Replies may highlight visible supported terms; they do not synthesize speech or replace the lesson. A different equation offers an explicit new-lesson action.

With `DATABASE_URL` unset, development uses `.cache/lessons/` and `.cache/groq-voice-preview/`. These files are not Vercel persistence. New live manifests reference individual clip endpoints with byte-range delivery; complete assembled WAV delivery is only a legacy local-development path. Saved example audio remains bundled and separately labelled.

For configuration, schema setup, storage caps and operational commands, see [production documentation](../../docs/production.md). For supported input and playback semantics, see the [main README](../../README.md).
