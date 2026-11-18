# Development speech fixture

`linear-equation.mp3` is freshly generated offline synthetic Flite SLT speech from `scripts/phrases.json`, through `scripts/prepare-example.mjs`. No API credits were consumed. This is a development voice with limited prosody, not production-quality narration.

The generator measures each uncompressed phrase with FFprobe before concatenation. Phrase boundaries are measured; within-phrase visual offsets are authored, not verified word timestamps. MP3 introduces small end padding. Audio and timings must be regenerated together.

Flite is CMU's permissively licensed speech synthesizer: https://github.com/festvox/flite/blob/master/COPYING . License retained in FLITE-LICENSE.txt. No synthesizer binaries or voice models are distributed here. This project's original lesson text and generated audio may be used with the project.
