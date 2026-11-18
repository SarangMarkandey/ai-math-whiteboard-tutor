# Math Tutor

An interactive mathematics whiteboard tutor for beginners who want to understand **why** algebraic steps work. Learners enter a topic or equation, watch a narrated visual explanation, ask questions about a paused step, and try a related practice problem.

The initial scope is linear equations of the form **ax + b = c**. Live lessons and contextual explanations use Groq; exact arithmetic, mathematical verification, visual layout and playback are controlled by application code.

## Features

- Chat-first topic entry, example prompts and a separately labelled saved lesson.
- Live explanations for new supported equations, including negative coefficients and fractional answers.
- Progressive working: term reveals, matching operations on both sides, cancellation, division, substitution and verification. Earlier working remains visible.
- Groq narration in short teaching beats, with measured clip durations and active captions.
- Play, pause, resume, seek, restart, scene selection, mute and transcript access.
- Contextual text answers grounded in the current verified equation and selected step, with optional temporary highlights. Returning restores the original lesson position.
- Related practice with exact answer checking, a hint and retries.
- Responsive board framing, collapsible mobile conversation, keyboard controls and reduced-motion support.
- PostgreSQL persistence, resumable preparation, audio caching, database-backed leases and anonymous demo quotas for production.

## Live versus saved content

| Capability | Behaviour |
| --- | --- |
| Live lessons | Groq interprets a supported request and writes qualitative explanations. Code verifies the equation and builds the visual timeline. Groq Orpheus generates each narration clip. |
| Saved example | `2x + 3 = 11`, with bundled offline Flite narration and balance/block illustrations. Works without API keys or a database. |
| Follow-up answers | Explicitly requested text answers from the configured Groq lesson model. No automatic speech generation; optional highlights are static references, not operation demonstrations. |
| Voice preview | Development-only at `/dev/voice`, limited to 179 characters. Disabled in production. |

A failed live request never silently substitutes the saved example or its voice. Generation starts only after an explicit user action, never on page load, build, hot reload or test execution. No microphone or speech recognition is required.

## Quick start

Use **Node.js 24 LTS**, pinned in [.nvmrc](.nvmrc), and npm. Dependencies are pinned in `package.json` and `package-lock.json`.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). To review without using any service quota, choose **Try saved example**. Its bundled narration requires no configuration.

For live generation, replace the Groq placeholder in `.env.local` with your existing Free Plan key. Choose one storage mode:

- **Local development:** remove/comment out `DATABASE_URL` and `DEMO_SESSION_SECRET` from `.env.local`. Plans and audio use ignored `.cache/` directories.
- **PostgreSQL:** set a valid existing Neon connection URL and session secret, then review and explicitly apply the migration below. Production requires this mode.

Restart the application after environment changes. Do not commit `.env.local` or use `NEXT_PUBLIC_` for server credentials.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Server-only key for the existing Groq Free Plan; required for live lessons and follow-ups. |
| `GROQ_LESSON_MODEL` | Lesson/follow-up model. Defaults to `openai/gpt-oss-20b`. |
| `GROQ_TTS_MODEL` | Speech model. Defaults to `canopylabs/orpheus-v1-english`. |
| `GROQ_TTS_VOICE` | Speech voice. Defaults to `hannah`. |
| `DATABASE_URL` | PostgreSQL URL; required in production, optional for local filesystem development. Use the intended Neon database's pooled URL with `sslmode=verify-full`. |
| `DEMO_SESSION_SECRET` | At least 32 random characters, required when PostgreSQL is enabled. Signs anonymous demo session cookies. |

Generate a session secret privately:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Only placeholders belong in [.env.example](.env.example). Model access and Orpheus terms must be enabled on the existing Groq account; the application never switches models/voices, changes plans or enables billing automatically.

## Database and production setup

Review [migrations/001_demo_storage.sql](migrations/001_demo_storage.sql), confirm `DATABASE_URL` points to the intended database, then run:

```sh
npm run db:check
npm run db:migrate
npm run build
npm start
```

`db:check` is read-only. `db:migrate` explicitly applies the versioned SQL and records its checksum; repeated runs are idempotent, and changing an applied migration is rejected. Startup and builds never alter schemas. Connection attempts allow 15 seconds and preserve certificate verification; CLI diagnostics omit credentials and raw driver messages.

Open `/api/health` after starting: configured production storage should report `ready: true` and `storage: postgresql`. This checks configuration/schema availability, not Groq account permissions or balance. The saved example remains available when live configuration is missing.

See [production setup and exact Vercel Hobby deployment steps](docs/production.md) for environment settings, migrations, retention, troubleshooting and reviewer access. No account creation, infrastructure provisioning, deployment or assignment submission is automatic.

## Reviewer walkthrough

1. Enter **Help me solve 5x + 7 = 32**, **Explain 3x - 4 = 11**, or **Show an equation with a fractional answer**.
2. Click **Generate lesson** and watch the actual preparation stages and narration clip count. Free-tier preparation can take time; there is no promised completion time or fabricated percentage.
3. When ready, press **Play**. Pause during a transformation or select a step under **Lesson options**.
4. Choose **Ask about this step**, ask why the operation is valid, and read the contextual answer. **Resume lesson** restores the captured board, captions and playback position.
5. Seek backward to see earlier working, finish the lesson, and attempt the practice problem.
6. Click **Math Tutor** to return to the startup homepage. Playback stops; **Continue learning** appears when a stored preparation is available.

**Resume preparation** retains completed stages/clips after a page or server restart. Errors preserve the learner's input and current lesson. Retry a failed or ambiguous provider call only explicitly after checking usage; a timeout may still consume allowance. Requests for a different equation offer **Start a new lesson** rather than replacing the current lesson silently.

## Architecture

A single Next.js App Router application, with TypeScript strict checking and Node.js route handlers. React/SVG render the board, KaTeX typesets mathematics, Tailwind supplies styling, and Zod validates application/provider/storage boundaries. PostgreSQL uses the server-only `pg` driver.

```text
src/app/                  App Router pages and bounded API requests
src/components/           Learner workspace, conversation, board and controls
src/domain/               Exact mathematics, lesson schemas and deterministic playback
src/server/lessons/       Interpretation, verified planning and staged preparation
src/server/speech/        Groq narration, WAV validation and clip caching
src/server/followup/      Contextual answers and trusted mathematical grounding
src/server/db/            PostgreSQL repositories, leases and quota enforcement
src/content/              Saved lesson and measured fixture timings
migrations/               Explicit versioned database schema
scripts/                  Database tools, production smoke check and source packaging
tests/                    Mocked unit, database and browser checks
```

### Mathematics and generation

The BigInt rational engine calculates transformations, exact solutions and substitution checks without floating-point equality or `eval`. It classifies zero-coefficient cases; live visual lessons currently require a unique solution. Supported live coefficients have numerators up to 99 and denominators up to 12 for readable layouts. Decimals, nonlinear equations, simultaneous equations and variables on both sides require clarification or an unsupported-scope response.

The server checks specific input coefficients against the interpreted equation. The planner returns bounded qualitative explanations for sixteen teaching beats and a related practice equation. Code owns exact numerical narration facts, solutions, practice hints, stable IDs, supported actions and geometry. Invalid outputs fail validation before speech. Plan validation has at most two explicit attempts; there is no unlimited repair loop or executable model output.

Follow-up requests include bounded conversation history, selected step and timestamp. The server loads trusted lesson data and recomputes the mathematics; it does not trust coefficients or answers supplied by the browser. Pending replies are discarded when the lesson/context changes. Conversation display is page-local; PostgreSQL retains bounded completed answers for duplicate protection.

### Audio synchronization

Groq speech returns audio without word/character alignment. Every teaching beat has its own WAV clip, measured from sample frames. The global board clock is **measured clip start + actual audio playback position**.

The renderer reconstructs board state from the timestamp, including partial movements/strokes. Backward seeks restore earlier objects and remove later working. Clip buffering holds the position; pausing during buffering prevents automatic resume. Media listeners and animation frames are cleaned up. Within-beat visual offsets are **estimated choreography**, not verified word-level alignment.

All clips are prepared before playback. New manifests contain individual clip URLs; production never returns a complete lesson WAV or base64 audio in lesson JSON. Clip endpoints support byte ranges and enforce a size cap below Vercel's response limit.

## Storage, quotas and free-service limits

With PostgreSQL configured, preparation status, validated plans, measured clip references, manifests, completed follow-up responses, leases and usage counters persist across requests/restarts. Audio is stored once as content-hashed `bytea`, separately from JSON. Database claims prevent concurrent duplicate stages, and writes check lease ownership/expiry.

| Demo limit | Cap |
| --- | --- |
| New lesson topic admissions | 2 per anonymous session/day; 6 shared/day |
| Follow-up requests | 8 per session/day; 30 shared/day |
| Preparation/question claims | 64 per session/day; 160 shared/day |
| Concurrent provider stages | 1 shared, with a 90-second lease |
| Stored audio / lesson-speech JSON | 100 MiB / 20 MiB |
| Lessons / individual audio clip | 100 / 4,000,000 bytes |
| Lesson and speech-cache expiry | 7 days |

Daily limits use UTC. Anonymous signed cookies are not strong identity verification; clearing cookies can create another session, while shared caps still apply. Failed claims count. Provider headers can extend the shared waiting period; these application caps do not guarantee available Groq allowance. Inspect actual usage in the provider dashboard. Use only existing Vercel Hobby, Neon Free and Groq Free services.

Run `npm run db:prune` explicitly to physically remove expired data and unreferenced audio. No cron or worker is provisioned. Storage caps stop preparation rather than silently evicting active lessons. Database indexes/metadata and other applications also consume space; monitor the actual Free project.

Without `DATABASE_URL`, development caches are `.cache/lessons/` and `.cache/groq-voice-preview/`. Stop the server before clearing them. Clearing caches can make a later explicit generation consume quota again. Local files are not production persistence, and existing local caches are not automatically imported into PostgreSQL.

## Checks

```sh
npm run build
npm run typecheck
npm run test
npm run test:production
```

A build generates Next.js type files needed by a fresh checkout. `test:production` starts isolated local ports and needs permission to bind them. It uses temporary embedded PostgreSQL over TCP, the real `pg` driver, fixture audio, fake credentials and an external-provider request blocker.

For browser checks, install Chromium once, then run:

```sh
npx playwright install chromium
npm run test:e2e
```

The full default suite uses the development server, including the development voice preview. To verify the learner flow against a production build:

```sh
PLAYWRIGHT_PRODUCTION=1 npm run test:e2e -- tests/browser/entry.spec.ts tests/browser/journey.spec.ts tests/browser/followup.spec.ts tests/browser/live.spec.ts tests/browser/clips.spec.ts
```

Most recent verification: typecheck and production build passed; **102 unit/integration tests** passed; **16 desktop/mobile production browser journeys** passed; isolated production smoke checks passed. Browser data/audio are mocked fixtures. Checks exercised real local audio advancement, buffering, pause/resume, backward reconstruction, contextual reply restoration, stale responses and practice. A subsequent owner-requested Neon migration succeeded; real hosted concurrency and deployed end-to-end behaviour still require review. Automated tests do not spend provider quota.

## Limitations and audio provenance

- Scope remains bounded linear equations, with all narration prepared before playback.
- Qualitative AI prose is constrained and grounded in verified facts, but is not a formal proof of natural-language correctness.
- Follow-up answers are text-first; no Listen action or animated answer-operation demonstration is implemented.
- Cookie-based demo limits are not an authentication system. External API calls and database commits cannot guarantee exactly-once execution after ambiguous failures.
- Free quotas, cold starts and provider availability can interrupt preparation. A final live Vercel/Neon/Groq acceptance run is required after deployment.
- The saved voice is an offline **Flite SLT development fixture**, not Groq narration or a production-quality voice. Its measured phrase boundaries and authored visual offsets are disclosed in [audio provenance](public/audio/PROVENANCE.md); the [Flite license](public/audio/FLITE-LICENSE.txt) is retained. No synthesizer binaries or voice models are distributed.
- The latest recorded runtime dependency audit reported no vulnerabilities. Five existing development-tool advisories were recorded; review compatible tooling fixes before publication. No forced dependency downgrade is applied.

## Publishing source

Commit source, migrations, documentation, tests, the saved audio/license, `.env.example` and `package-lock.json`. `.gitignore` excludes real environment files, local credentials/tool configuration, dependencies, build artifacts, generated type files, database/audio caches and test reports.

Before committing, inspect `git status --short` and `git diff --cached --stat`. Ignore rules do not remove files already tracked by Git; untrack any previously committed secret/artifact and rotate exposed credentials where necessary. Do not publish database dumps or real generated cache content.

For an independent source-only copy outside this repository:

```sh
npm run package:source -- /absolute/path/to/an/empty/source-directory
```

The packaging script uses an allowlist and excludes dependencies, builds, runtime caches and secret environment files. Review the copy before publishing. Public deployment and assignment submission remain explicit owner actions.
