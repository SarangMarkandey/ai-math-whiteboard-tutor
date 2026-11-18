import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockPlan } from "../fixtures/live-plan";
import { rational as r } from "../../src/domain/math";
import { normalizeWav, prepareBeatTimeline } from "../../src/domain/speech";
const tone = normalizeWav(readFileSync("tests/fixtures/streaming-tone.wav"));
function manifest(a: number, b: number, c: number, id: string) {
  const plan = mockPlan({ a: r(a), b: r(b), c: r(c) }, id);
  const clips = plan.scenes.map((s) => ({
    segmentId: s.narration[0].id,
    text: s.narration[0].text,
    speech: {
      audio_base64: Buffer.from(tone.bytes).toString("base64"),
      format: "wav" as const,
      durationSeconds: tone.durationSeconds,
    },
  }));
  const t = prepareBeatTimeline(plan, clips);
  return {
    plan: t.plan,
    scenes: t.scenes,
    audio: {
      src: "/mock-live.wav",
      duration: t.duration,
      provenance: "Mocked measured beat clips",
    },
  };
}
test("live lessons preserve new mathematics and ignore stale replacements", async ({
  page,
}) => {
  let calls = 0;
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route("**/api/lessons", async (route) => {
    calls++;
    const n = calls;
    if (n === 1) await firstGate;
    else setTimeout(releaseFirst, 300);
    await route
      .fulfill({
        json: {
          id: `mock-${n}`,
          stage: "ready",
          completed: 16,
          total: 16,
          manifest:
            n === 1 ? manifest(5, 7, 37, "old") : manifest(3, -4, 11, "new"),
        },
      })
      .catch(() => {});
  });
  const body = Buffer.alloc(44 + 51200);
  body.write("RIFF");
  body.writeUInt32LE(body.length - 8, 4);
  body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(16000, 24);
  body.writeUInt32LE(32000, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);
  body.write("data", 36);
  body.writeUInt32LE(51200, 40);
  await page.route("**/mock-live.wav", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body,
      headers: { "accept-ranges": "bytes" },
    }),
  );
  await page.goto("/");
  const composer = page.getByRole("textbox", {
    name: "Your mathematics question",
  });
  await composer.fill("5x + 7 = 37");
  await page
    .getByRole("button", { name: "Generate lesson", exact: true })
    .click();
  await composer.fill("3x - 4 = 11");
  await page
    .getByRole("button", { name: "Generate lesson", exact: true })
    .click();
  await expect(
    page.getByText("LIVE-GENERATED · GROQ NARRATION", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(600);
  const slider = page.getByRole("slider", { name: "Lesson position" });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await slider.fill("1.5");
  await expect(page.locator('[data-element="answer"]')).toContainText("5");
  await page.screenshot({
    path: `test-results/live-working-${test.info().project.name}.png`,
    fullPage: true,
  });
  await slider.fill(".5");
  await expect(page.locator('[data-element="answer"]')).toHaveCount(0);
  await page.getByRole("button", { name: /New topic/ }).click();
  await expect(page.getByLabel("Your mathematics question")).toHaveValue("");
});
test("failed live generation keeps input and current lesson", async ({
  page,
}) => {
  await page.route("**/api/lessons", (route) =>
    route.fulfill({
      json: {
        id: "failed",
        stage: "interpret",
        message: "Free quota reached",
        completed: 0,
        total: 16,
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Try saved example/ }).click();
  await page.getByRole("button", { name: /New topic/ }).click();
  await page
    .getByRole("textbox", { name: "Your mathematics question" })
    .fill("5x + 7 = 32");
  await page
    .getByRole("button", { name: "Generate lesson", exact: true })
    .click();
  await expect(
    page.getByText(/Generation failed: Free quota reached/),
  ).toBeVisible();
  await expect(
    page.getByText("SAVED EXAMPLE · LOCAL NARRATION", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Your mathematics question" }),
  ).toHaveValue("5x + 7 = 32");
});
