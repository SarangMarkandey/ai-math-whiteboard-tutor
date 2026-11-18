# Math Tutor

An AI-powered mathematics whiteboard tutor for beginners who want to understand why algebraic steps work. Enter a topic or equation, prepare a narrated lesson, watch progressive working, ask about a paused step, and practise a related problem.

## Live demo

**[Open the live application](https://ai-math-whiteboard-tutor.vercel.app/)** ·

Use **Try saved example** to explore the player without generating content. Live lessons and follow-up answers depend on provider availability and free-tier allowance.

## Features and supported mathematics

- Progressive whiteboard working: term reveals, matching operations on both sides, cancellation, division, substitution and verification.
- Narrated teaching beats, captions, transcript, play/pause/resume, seeking, restart, scene navigation and mute.
- Contextual text answers with optional temporary highlights, followed by a return to the original lesson position.
- Related practice with exact answer checking, a hint and retry.
- Responsive board framing, mobile conversation disclosure, keyboard controls and reduced-motion support.
- Cached audio and resumable lesson preparation, with PostgreSQL storage in production.

The live tutor handles **ax + b = c** generically, where `a`, `b` and `c` are signed integers or rational numbers and `a` is nonzero. Omitting a zero constant is supported (`2x = 8`). Examples include:

| Request | Exact solution |
| --- | --- |
| `Help me solve -20x + 10 = 30.` | `x = -1` |
| `1/2x + 3 = 7` | `x = 8` |
| `3/4x - 1/2 = 1` | `x = 2` |
| `-2/3x + 1/2 = 5/6` | `x = -1/2` |

Fractional coefficients accept `1/2x`, `1/2*x`, `(1/2)x` and `x/2`. Signs, signed denominators, reasonable whitespace and the Unicode minus sign are normalized. Common request prefixes such as **Help me solve**, **Explain** and **Solve** are recognized; a general topic request can ask the AI to choose an example.

After reduction, coefficient numerator magnitude is limited to **99** and positive denominators to **12**. Input is limited to **400 characters**, with at most **30 digits** per integer token. Derived answers may have larger numerators or denominators.

Decimals, variable denominators (`1/x`), powers, variables on both sides, multiple equations and general expressions such as `2(x + 3) = 8` are outside scope. Invalid or ambiguous input receives clarification or a scope message; explicit equations must parse completely. Zero-coefficient equations are classified as no solution or infinitely many solutions, but are not taught as narrated lessons. Failed generation never substitutes the saved example silently.

## Reviewer walkthrough

1. Enter a supported equation or choose an example prompt, then click **Generate lesson**. The preparation panel shows the actual stage and narration clip count.
2. Once preparation finishes, press **Play** to follow the visual working and captions.
3. Pause during an operation, or select a step under **Lesson options**, then choose **Ask about this step**.
4. Ask why the operation is valid. Read the contextual answer and choose **Resume lesson** to restore the captured position and clear temporary highlights.
5. Seek backward to review earlier working, finish the lesson, and attempt the practice problem.

**Resume preparation** continues saved stages after interruption. **Math Tutor** returns to the homepage and stops playback. The separately labelled saved example teaches `2x + 3 = 11` with bundled narration; it is not a live AI response. No microphone is required.

## Local setup

Use **Node.js 24 LTS** (the exact version is in [.nvmrc](.nvmrc)) and npm.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and select **Try saved example**. No environment file is needed for saved playback; contextual AI answers still require live configuration.

For live generation, copy [.env.example](.env.example) to `.env.local` and replace the required placeholders:

```sh
cp .env.example .env.local
```

Choose a storage mode before starting:

- **Local development:** leave `DATABASE_URL` unset to use ignored `.cache/` files. A Groq key is required for generation and follow-ups.
- **PostgreSQL:** configure `DATABASE_URL` and `DEMO_SESSION_SECRET`, review [the migration](migrations/001_demo_storage.sql), then run `npm run db:check` and `npm run db:migrate`. Production live routes require this mode.

Restart after changing environment variables. To serve a production build locally, run `npm run build` followed by `npm start`.

## Environment variables

All variables below are **server-only**. Keep real values out of Git and do not prefix them with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Required for live lesson interpretation, explanations, speech and follow-up answers. |
| `GROQ_LESSON_MODEL` | Lesson/follow-up model; defaults to `openai/gpt-oss-20b`. |
| `GROQ_TTS_MODEL` | Speech model; defaults to `canopylabs/orpheus-v1-english`. |
| `GROQ_TTS_VOICE` | Speech voice; defaults to `hannah`. |
| `DATABASE_URL` | PostgreSQL connection URL; optional in development, required for production live routes. |
| `DEMO_SESSION_SECRET` | At least 32 random characters; required with PostgreSQL and used to sign anonymous follow-up cache sessions. |

Generate the session secret privately with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Model/voice access must be available on the configured Groq account; there is no automatic provider or voice fallback.

## Architecture and AI responsibilities

One Next.js App Router application uses strict TypeScript, Node.js route handlers, React/SVG, Tailwind CSS, KaTeX and Zod.

| Responsibility | Implementation |
| --- | --- |
| Request interpretation and explanations | Groq interprets requests, selects an example when needed, and writes bounded qualitative explanations and a related practice equation. |
| Mathematics | Application code normalizes BigInt rationals, derives valid operations, computes exact solutions and verifies substitution. A changed AI interpretation or incorrect structured answer is rejected. |
| Whiteboard | Code compiles verified mathematics into trusted visual primitives and stable element IDs. The model does not supply executable HTML, JavaScript or SVG. |
| Narration | Groq generates WAV speech for short teaching beats. Code supplies numerical spoken facts and validates audio and duration. |
| Follow-ups | The server loads the selected lesson, recomputes trusted facts and validates bounded question/history context. AI replies are text-first, with optional static highlights. |
| Persistence | PostgreSQL stores preparation status, plans, manifests, deduplicated audio and completed follow-up responses. File repositories support local development. |

Domain logic lives in `src/domain/`; providers and persistence in `src/server/`; the learner interface in `src/components/`. Preparation advances through bounded requests and persists completed work between stages. Plans and responses are runtime-validated. Planning has at most two explicit validation attempts; safe retry feedback identifies the field and rule without exposing full provider output.

## Voice and whiteboard synchronization

Each live teaching beat has a separate narration clip. WAV sample frames determine its measured duration. Global playback time is the current clip's measured start plus the audio element's actual playback position; the renderer reconstructs board state from that timestamp.

Pause freezes visual progress. Seeking backward removes later working and restores earlier or partially completed actions. Clip buffering preserves position, and playback begins only after a user gesture. Captions follow the active beat.

Within-clip reveal and stroke offsets are **estimated choreography**, not verified word- or character-level alignment: Groq does not return that alignment object. All clips are prepared before playback, and lesson duration varies with their actual audio. There is no enforced two-minute duration.

## Testing

These checks use mocked providers and local audio/database fixtures, without spending provider credits:

```sh
npm run build
npm run typecheck
npm run test
npm run test:production
```

Build first on a fresh checkout to generate Next.js type files. `test:production` runs an isolated `npm start` instance and temporary PostgreSQL-compatible server on local ports; it does not test the hosted Neon connection.

For browser tests, install Chromium once and ensure the development port is free:

```sh
npx playwright install chromium
npm run test:e2e
```

Unit/integration tests cover exact arithmetic, fraction notation, validation, retries, persistence, caching and deterministic state reconstruction. Browser tests use mocked lesson/answer responses and fixture audio to exercise playback, buffering, seeking, follow-ups, practice and desktop/mobile layouts. See [production-mode checks](docs/production.md#health-checks-and-verification) for the production browser command. Local tests do not establish that the hosted release or provider account is working.

## Limitations and audio attribution

- Teaching is limited to the supported unique-solution linear equations; qualitative AI prose is constrained but not formally proved correct.
- Follow-ups have no Listen action or animated operation demonstrations. Visible conversation history is page-local; refresh clears it.
- Free-service quotas, cold starts and network failures can delay preparation. There are no app-imposed daily/session generation quotas, but provider rate limits, request pacing and storage safeguards remain.
- Anonymous sessions are not an authentication system. Ambiguous external API failures cannot guarantee exactly-once generation; retry explicitly after checking usage.
- The saved narration is an offline **Flite SLT development fixture**, with limited prosody, separate from live Groq speech. See [audio provenance](public/audio/PROVENANCE.md) and the retained [Flite license](public/audio/FLITE-LICENSE.txt). Its generation inputs and script are preserved for reproducibility.

## Deployment documentation

See [docs/production.md](docs/production.md) for Vercel Hobby setup, Neon migrations, health checks, provider limits, retention/pruning, troubleshooting and optional source packaging.
