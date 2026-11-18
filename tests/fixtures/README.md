`streaming-tone.wav` is a 0.1-second, 440 Hz synthetic test tone, generated locally with FFmpeg. It is not speech and makes no API calls. It deliberately retains the unknown RIFF/data length markers from non-seekable WAV output, including FFmpeg metadata chunks.

Reproduce:

```sh
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=0.1' -ar 24000 -ac 1 -f wav pipe:1 > tests/fixtures/streaming-tone.wav
```
