# Production setup and operations

The deployment target is Vercel Hobby with Neon Free PostgreSQL and Groq Free Plan. The [main README](../README.md) covers the learner flow and supported mathematics.

## Environment configuration

Use Node **24.x**, matching `package.json`; [.nvmrc](../.nvmrc) pins the local version. Install with `npm ci`. Configure the following in `.env.local` for local PostgreSQL use and in the Vercel Production environment for deployment:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DATABASE?sslmode=verify-full
DEMO_SESSION_SECRET=replace_with_a_random_secret_of_at_least_32_characters
GROQ_API_KEY=your_groq_api_key
GROQ_LESSON_MODEL=openai/gpt-oss-20b
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
GROQ_TTS_VOICE=hannah
```

All six are server-only; never use `NEXT_PUBLIC_` for them. Generate the session secret privately with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Restart local servers after changes; deployed environment changes require a new deployment.

Use the intended Neon database's pooled connection URL with certificate verification. The `pg` pool has at most two connections per application instance; transactions release clients before provider calls. See [Neon pooling](https://neon.com/docs/connect/connection-pooling). Leave `DATABASE_URL` unset only for filesystem-based development; those local caches are not imported into PostgreSQL automatically.

## Database checks and migrations

Review [the SQL migration](../migrations/001_demo_storage.sql), confirm the target database, then run:

```sh
npm run db:check
npm run db:migrate
```

`db:check` performs a read-only connection/schema check. `db:migrate` explicitly applies the migration in a transaction and records a checksum. Reruns are idempotent; modified applied migrations are rejected. Migrations do **not** run during application startup or build. Existing unrelated tables are preserved.

The original migration includes `tutor_usage` and `tutor_access`; request handlers no longer use them for quotas or admission. Keep applied migration files unchanged. No counter reset is required to generate lessons.

## Vercel deployment

1. Connect [the source repository](https://github.com/SarangMarkandey/ai-math-whiteboard-tutor) to a Vercel Hobby project using the Next.js preset.
2. Select Node **24.x**, install command `npm ci`, build command `npm run build`, and the default Next.js output settings. Node support is documented in [Vercel's runtime reference](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
3. Set the server environment variables above for Production. Apply the reviewed migration to that exact database before serving live requests. Configure Preview environments separately if live generation should work there.
4. Deploy and open `/api/health`, then the homepage. Check Vercel deployment-protection settings so reviewers can open the public demo without a Vercel account.
5. Review Groq usage and explicitly generate a supported equation. Check preparation, narration, a paused contextual question, resume, backward seeking and practice. Reload during preparation to check persisted resume behaviour.

The submitted demo URL is [ai-math-whiteboard-tutor.vercel.app](https://ai-math-whiteboard-tutor.vercel.app/). Public access, deployed-version parity, current provider permissions and end-to-end hosted behaviour require a manual release check.

## Health checks and verification

`GET /api/health` reports `ready: true` and `storage: postgresql` when the production configuration/schema checks succeed. It checks provider-key presence, not whether Groq accepts that key, model, voice or remaining allowance. Saved playback does not depend on this endpoint succeeding. Production voice-preview generation is disabled; `/dev/voice` is unavailable.

Local production verification:

```sh
npm run build
npm run typecheck
npm run test
npm start
```

Open [localhost:3000](http://localhost:3000) and `/api/health`. A separate, no-provider smoke check is available after building:

```sh
npm run test:production
```

It uses temporary embedded PostgreSQL over TCP, the real `pg` driver, fixture audio, fake credentials and an outbound-provider blocker. It tests migrations, persistence across application restart, clip delivery and production guards. It does not verify Neon TLS/network access or multi-backend PostgreSQL behaviour.

For production browser checks, install Chromium once with `npx playwright install chromium`, ensure port 3210 is free, and run:

```sh
PLAYWRIGHT_PRODUCTION=1 npm run test:e2e -- tests/browser/entry.spec.ts tests/browser/journey.spec.ts tests/browser/followup.spec.ts tests/browser/live.spec.ts tests/browser/clips.spec.ts tests/browser/preparation-scroll.spec.ts tests/browser/rational.spec.ts
```

These browser tests use mocked AI responses and local audio. The development-only preview test is excluded from this production command.

## Request pacing, leases and quotas

There are **no application-imposed daily or per-session generation quotas**, lesson-admission checks or global one-operation cap. Provider account/model limits still apply; see [Groq rate-limit documentation](https://console.groq.com/docs/rate-limits). A provider 429 or exhausted-allowance response is not an app daily allowance.

- PostgreSQL claims use a **90-second lease per operation**. Duplicate active requests are rejected; completed claims can reuse saved results. Expired writers cannot overwrite newer work.
- Claim/capacity updates use short serialized database transactions. Distinct operations may coexist after rate pacing permits them; there is no worker queue.
- Shared pacing is at least **7 seconds**; provider rate-limit headers can extend waiting across instances. Provider calls have bounded 20–25-second timeouts, and route limits are 60 seconds for provider stages and 30 seconds for clips/health. Check the actual project's compute settings against [Vercel's current function limits](https://vercel.com/docs/functions/limitations).
- A failed stage preserves successful work. Retrying is explicit; ambiguous failures may already have consumed provider allowance. External API execution and database commits cannot provide an exactly-once guarantee.
- Signed anonymous cookies scope follow-up response caches. They expire after 24 hours, use HttpOnly and SameSite=Lax, and are Secure in production. They are not strong identity verification.

Free-service allowances and platform policies may change. Monitor the Vercel, Neon and Groq dashboards rather than assuming availability from application settings.

## Audio storage and retention

Audio is stored once as content-hashed PostgreSQL `bytea`. Lesson/status and speech-cache JSON contain references and measured durations instead of repeated base64 or an assembled lesson file. Production delivers individual WAV clips with byte-range support; public lesson JSON omits audio bytes.

| Application storage safeguard | Value |
| --- | --- |
| Logical audio bytes | 100 MiB |
| Lesson and speech-cache JSON | 20 MiB |
| Stored lesson records | 100 |
| Individual clip | 4,000,000 bytes |
| Individual lesson JSON record | 1,000,000 bytes |
| Lesson and speech-cache expiry | 7 days |

The clip cap is below the non-streamed response limit documented by [Vercel](https://vercel.com/docs/functions/limitations). Check current platform limits before changing it. Indexes, TOAST, operation records and other database contents consume additional space beyond these logical caps. Generation stops at a cap rather than silently evicting active lessons.

Reads do not extend expiry; successful preparation writes extend the lesson expiry. Expired entries stop being served, but physical removal requires:

```sh
npm run db:prune
```

Pruning removes expired lessons/cache entries, old operations and legacy usage/access rows, and audio no longer referenced by a lesson or speech cache. No scheduled pruner is configured. Monitor database size and run pruning as needed. Clearing development `.cache/lessons/` or `.cache/groq-voice-preview/` can make a later explicit request generate audio again.

## Troubleshooting

| Symptom | Check/action |
| --- | --- |
| Live routes unavailable | Check all required server settings, restart/redeploy after changes, run `db:check`, and apply the reviewed migration if missing. |
| Database timeout, DNS or TLS failure | Use `db:check` diagnostics; inspect network/database availability. Connections allow 15 seconds. Keep `sslmode=verify-full`; do not disable certificate verification to bypass errors. |
| Changed migration checksum or existing-table conflict | Review migration history/schema. Restore the applied migration and add a new migration for intended changes; do not drop existing tables blindly. |
| Groq denies model/voice access | Confirm the configured key's project/organization permissions and any required Orpheus terms in the Groq console. The app does not switch models or voices on failure. |
| Provider rate limit or exhausted allowance | Inspect actual dashboard usage, wait as instructed, then explicitly resume the failed stage. Saved playback remains available. |
| Planning validation error | Use the field/rule feedback on explicit retry. The verified equation remains; no speech is generated for a rejected plan. |
| Storage cap or expired lesson | Run `db:prune` for expired data. For an expired lesson, submit its topic again; regeneration may use provider allowance. |
| Local build works, hosted behaviour differs | Confirm deployed source/version, environment scope, Node version, database schema and public access; local mocked tests cannot verify these. |

The shared driver configuration preserves pg 8's strict verification when normalizing deprecated SSL aliases unless libpq compatibility is explicitly selected. See [pg SSL configuration](https://node-postgres.com/features/ssl) and [PostgreSQL verification modes](https://www.postgresql.org/docs/current/libpq-ssl.html). CLI error messages use fixed guidance and safe categories rather than printing credentials or raw driver responses.

## Source review and optional packaging

Keep `package-lock.json`, migrations, tests and intentional fixtures, the saved lesson/audio/timings, audio license/provenance, `.env.example`, and fixture-generation scripts with their input text.

The repository's exclusion files have different purposes:

| File | Effect |
| --- | --- |
| `.gitignore` | Prevents matching **untracked** files from normal Git staging. It does not untrack files already committed or erase history. |
| `.vercelignore` | Filters Vercel CLI deployment uploads; it is not a Git tracking rule. Review [Vercel's ignore documentation](https://vercel.com/docs/deployments/vercel-ignore) for the deployment method used. |
| `.gitattributes` | Its `export-ignore` rules exclude matching paths from `git archive`; they do not affect commits or replace either ignore file. |

Review `git ls-files`, `git status --short` and the staged diff before publishing. Exclude real environment files, credentials, dependencies, builds, runtime caches, database dumps and test reports. If a credential was committed, removing its file does not remove it from history; handle exposure separately.

An optional source copy outside the repository can be created with:

```sh
npm run package:source -- /absolute/path/to/an/empty/source-directory
```

The script copies an explicit allowlist, including current source, tests, fixtures, documentation and placeholder `.env.example`. Within copied directories it skips `.env*` files except `.env.example`, dependency/build/cache directories and symlinks. It does not apply all Git ignore rules and may include untracked source and an existing generated `next-env.d.ts`; this is not equivalent to a committed Git snapshot. Inspect the output before sharing it.
