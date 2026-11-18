Server modules use Node.js route handlers and server-only configuration.

`lessons/` handles bounded structured interpretation/planning, exact-maths validation, one narration beat per request, persisted local progress and final WAV assembly. `speech/` is the shared Groq speech/cache adapter. All real requests are user-triggered; provider errors stop preparation until an explicit retry. No detached background work or model-generated code is executed.

Production endpoints remain disabled until durable repository implementations, distributed request guards and access controls are configured. Local jobs, clips and manifests persist in ignored `.cache` directories; process memory is not durable lesson state.

`followup/` loads a trusted saved/live lesson, validates the captured step and timestamp, recomputes exact facts, and makes a bounded Groq text-answer request. Browser history remains untrusted. Responses allow text and optional visible-term highlights only, with no speech generation. The production guard remains in place.
