# Deploy manually: existing Vercel Hobby, Neon Free, Groq Free

No infrastructure, account, billing change, deployment or submission is performed automatically.

## Required setup

1. Use **Node 24 LTS** (`.nvmrc`, `engines.node=24.x`) and run `npm ci`. Vercel [supports Node 24](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
2. In the existing Neon **Free** project, select the intended database and copy its **pooled** connection URL to server-only `DATABASE_URL`. Preserve TLS (`sslmode=verify-full`). The app uses `pg`, at most two connections per function instance, short transactions and idle connection cleanup; no connection is checked out during a provider call. See [Neon pooling](https://neon.com/docs/connect/connection-pooling).
3. Set these six server-only variables in `.env.local` and later in Vercel's intended environment:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DATABASE?sslmode=verify-full
DEMO_SESSION_SECRET=at_least_32_random_characters
GROQ_API_KEY=your_existing_free_plan_key
GROQ_LESSON_MODEL=openai/gpt-oss-20b
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
GROQ_TTS_VOICE=hannah
```

Generate the session secret privately with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never prefix these variables with `NEXT_PUBLIC_`, commit real values, or expose them in screenshots/logs. Restart after configuration changes.

4. Review `migrations/001_demo_storage.sql`, then explicitly run `npm run db:migrate` against the intended database. It records a checksum; reruns are idempotent and changed applied migrations are rejected. Existing unrelated tables are preserved. Routes/builds never create or alter schemas. Database errors are sanitized; inspect permissions/schema using the console if migration fails rather than deleting tables blindly.
5. Run `npm run typecheck`, `npm run test`, `npm run build`, then `npm start`. Open `/api/health`: configured storage should return `ready: true`, `storage: postgresql`. This checks schema/configuration presence, not Groq account access or balance. Saved playback needs no database/key. Production `/dev/voice` is unavailable and preview generation returns 403.
6. Optionally run `npm run test:production` after building. It uses a temporary embedded PostgreSQL server over TCP, the real `pg` driver, placeholder keys and an outbound-fetch blocker. It never contacts Neon/Groq. It checks migration, production requests, sessions/quotas, clip delivery and state across application restarts. This cannot certify Neon TLS/network access or multi-backend PostgreSQL concurrency.

## Vercel steps (owner performs)

1. Publish the reviewed source to your own GitHub repository with committed `package-lock.json`. This workspace's `.git` may not be a usable checkout; initialize/connect your source repository if needed. Never publish `.env.local`, other secret files, dependencies, builds or runtime caches.
2. Import that repository in the existing **Hobby** account as a Next.js project. Set Node **24.x**, install `npm ci`, build `npm run build`, default Next.js output. Do not enable paid add-ons, billing or upgrades.
3. Add the six variables above to Production. Apply the reviewed migration to that exact database **before** deploying. Migrations are not a build step. Preview deployments need explicit separate settings; avoid giving untrusted previews production credentials.
4. Deploy through the normal Vercel dashboard. Check `/api/health`, the saved example, and public access without a reviewer account. Check deployment-protection settings if reviewers cannot open the URL.
5. Inspect Groq usage yourself, then explicitly generate **one** supported equation. Pause during an operation, ask why it works, resume from the saved position, seek backward, finish and try practice. Reload during preparation and explicitly resume; completed clips must not regenerate.
6. Monitor Neon/Vercel/Groq usage and prune expired data. Keep the saved example available when free limits are reached. Review public/source links before submitting; no submission is automatic.

## Source packaging

`.gitignore`, `.vercelignore`, and `.gitattributes` exclude secret environment files, `node_modules`, `.next`, runtime caches and reports. To create an independent allowlisted source directory:

```sh
npm run package:source -- /absolute/path/to/an/empty/source-directory
```

The copy includes placeholder `.env.example`, source, migrations, docs, scripts and test fixtures. Inspect it before publishing. No GitHub push occurs automatically.

## Storage and retention

- Audio bytes are stored once as content-hashed PostgreSQL `bytea`. Lesson/status and speech-cache JSON contain clip references, measured durations and metadata, never repeated base64 or an assembled lesson WAV. Completed follow-up responses are persisted as bounded operation results; bounded browser conversation history remains untrusted input.
- Logical audio cap **100 MiB**, lesson/speech JSON cap **20 MiB**, **100 lessons** maximum, **4,000,000 bytes** per clip. Caps stop generation instead of silently evicting active lessons. Indexes, TOAST, operations, usage, metadata and other applications consume additional space; monitor actual disk usage. Current [Neon Free pricing](https://neon.com/pricing) lists storage/compute allowances; your account's actual limits govern.
- Lessons/speech cache expire after **7 days**; reads do not extend expiry. Successful preparation writes extend the lesson expiry. Run `npm run db:prune` explicitly to remove expired rows, old operations/usage/access, and audio with no lesson/cache reference. No cron or worker is provisioned. Expiry immediately stops serving content; physical retention depends on owner pruning. If storage fills, prune expired records; do not regenerate speech blindly.

## Anonymous access, quotas and leases

The signed HttpOnly, SameSite=Lax cookie expires after 24 hours and is Secure in production. It is a small-demo mechanism, **not strong identity**; clearing cookies can obtain another session. Shared limits remain authoritative.

UTC daily admission: **2 new topics/session**, **6 shared**; **8 follow-ups/session**, **30 shared**; **64 preparation/question claims/session**, **160 shared**. Failed or ambiguous claims count; completed operation cache hits do not. A session/topic/settings admission is unique during retention. These are conservative application caps, not promises about available Groq credits.

All claim/quota/capacity updates serialize on one database control row. One active provider-stage lease is allowed globally, for **90 seconds**. Storage writes verify lease ownership/expiry, preventing stale owners overwriting newer work. Completed stages/clips survive requests and restarts. Expired/failed calls require an explicit retry. A provider timeout, lost response or database failure can still consume quota: exactly-once external API execution cannot be guaranteed.

Shared spacing is at least **7 seconds**; account rate-limit headers extend waiting across instances. The next eligible time is persisted and returned to the browser. Account limits vary and other applications can consume quota. Quota/wait errors stop orchestration; no automatic retry loop exists. The owner can inspect actual usage in Groq's dashboard without extra API permissions.

## Vercel request bounds and audio

Groq requests timeout after 20–25 seconds; provider-stage routes allow **60 seconds**, clip/health routes **30 seconds**. Current [Vercel limits](https://vercel.com/docs/functions/limitations) list a 300-second Hobby Fluid Compute maximum and a **4.5 MB** non-streamed request/response cap. Check the project's actual compute settings. Each stage persists before responding; no detached background work is assumed.

New manifests reference individual clips below 4 MB. Clip routes support byte ranges. No production endpoint returns a complete lesson WAV or audio in lesson JSON. Actual clip position plus the measured clip start drives the global board time. Metadata/transition buffering freezes the board; pause during buffering prevents auto-resume. Within-beat choreography remains estimated, not word alignment. Saved audio remains separate; no Flite fallback is used after provider failure.

## Migration troubleshooting

Run `npm run db:check` for a read-only connection/schema check; it makes no schema changes. Connection attempts allow 15 seconds for a sleeping Neon compute or network setup. `db:migrate` distinguishes connection failures from SQL/migration failures and prints only allowlisted error categories/codes and fixed guidance, never raw connection strings, driver messages or SQL details. DNS/network, timeout, certificate, authentication, privileges and checksum failures have separate instructions.

Use explicit `sslmode=verify-full`. The shared configuration preserves pg 8's existing strict certificate/hostname verification when normalizing deprecated `require`/`prefer`/`verify-ca` aliases (unless libpq compatibility was explicitly requested). This avoids the driver's future-semantics warning without disabling TLS checks; see [pg SSL configuration](https://node-postgres.com/features/ssl) and [PostgreSQL verification modes](https://www.postgresql.org/docs/current/libpq-ssl.html). That warning alone does not identify the migration failure. Do not use `rejectUnauthorized: false` as a workaround. If `db:check` succeeds, explicitly rerun `npm run db:migrate`; if it fails, follow its sanitized diagnostic before retrying.
