import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const timing = JSON.parse(readFileSync("src/content/timings.json", "utf8"));
const example = { scenes: timing.segments as { start: number }[] };
test("continuous teaching, paused intermediate motion, seeking and practice", async ({
  page,
}, info) => {
  await page.route("**/api/follow-up", async (route) => {
    const context = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ...context,
        kind: "ai",
        text: "Mocked AI explanation: equality is preserved by matching operations.",
        visual: { kind: "none", targets: [] },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Try saved example/ }).click();
  const slider = page.getByRole("slider", { name: "Lesson position" });
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  const seek = async (t: number) => {
    await slider.fill(String(t));
  };
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await seek(example.scenes[10].start + 0.9);
  const block = page.locator('[data-element="left-0"]');
  await expect(block).toHaveAttribute("opacity", /.5/);
  const transform = await block.getAttribute("transform");
  await page.waitForTimeout(300);
  expect(await block.getAttribute("transform")).toBe(transform);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => block.getAttribute("transform")).not.toBe(transform);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await seek(example.scenes[9].start);
  await expect(block).toHaveAttribute("opacity", "1");
  for (const beat of [6, 8, 10, 12, 14, 15, 16, 18]) {
    await seek(example.scenes[beat].start + 0.5);
    await page.screenshot({
      path: `test-results/${info.project.name}-beat-${beat}.png`,
    });
  }
  if (info.project.name === "desktop") {
    expect(
      await page
        .locator(".playback")
        .evaluate((e) => e.getBoundingClientRect().bottom),
    ).toBeLessThan(768);
  }
  await slider.fill((await slider.getAttribute("max")) ?? "0");
  await page.getByRole("textbox", { name: "x =" }).fill("4");
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Correct" }),
  ).toContainText("Correct");
  await page.getByRole("button", { name: "Ask about this step" }).click();
  await page
    .getByRole("textbox", { name: "Ask about this step" })
    .fill("Why both sides?");
  await page.getByRole("button", { name: "Ask tutor" }).click();
  await expect(page.getByText(/Mocked AI explanation/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
