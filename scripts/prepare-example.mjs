// Offline fixture preparation only. No API, credentials, or network used.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
const texts = JSON.parse(
  readFileSync(new URL("./phrases.json", import.meta.url)),
);
mkdirSync("/tmp/braynix-audio", { recursive: true });
let cursor = 0;
const timings = [];
for (let i = 0; i < texts.length; i++) {
  const textPath = `/tmp/braynix-audio/${i}.txt`,
    wav = `/tmp/braynix-audio/${i}.wav`;
  writeFileSync(textPath, texts[i]);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `flite=textfile=${textPath}:voice=slt`,
      "-af",
      "atempo=0.95",
      wav,
    ],
    { stdio: "ignore" },
  );
  const duration = Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      wav,
    ])
      .toString()
      .trim(),
  );
  timings.push({ start: cursor, end: cursor + duration, text: texts[i] });
  cursor += duration;
}
writeFileSync(
  "/tmp/braynix-audio/list.txt",
  texts.map((_, i) => `file '/tmp/braynix-audio/${i}.wav'`).join("\n"),
);
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "/tmp/braynix-audio/list.txt",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "public/audio/linear-equation.mp3",
  ],
  { stdio: "ignore" },
);
writeFileSync(
  "src/content/timings.json",
  JSON.stringify({ duration: cursor, segments: timings }, null, 2),
);
console.log(
  `Prepared ${cursor.toFixed(1)} seconds of local synthetic narration.`,
);
