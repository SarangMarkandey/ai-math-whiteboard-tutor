import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const timing = JSON.parse(readFileSync("src/content/timings.json", "utf8"));
test("contextual explanation, error recovery and original playback restoration", async ({
  page,
}, info) => {
  let calls = 0;
  let captured: any;
  await page.route("**/api/follow-up", async (route) => {
    calls++;
    captured = route.request().postDataJSON();
    if (calls === 1)
      return route.fulfill({
        status: 429,
        json: { error: "Mocked free quota reached. Retry explicitly." },
      });
    return route.fulfill({
      json: {
        lessonId: captured.lessonId,
        stepId: captured.stepId,
        position: captured.position,
        contextId: captured.contextId,
        kind: "ai",
        text: "Mocked tutor answer: matching changes preserve equality. Subtract 3 from both sides.",
        visual: {
          kind: "highlight",
          targets: ["subtract-left", "subtract-right"],
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Try saved example/ }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  const slider = page.getByRole("slider", { name: "Lesson position" }),
    position = timing.segments[6].start + 0.65;
  await slider.fill(String(position));
  await page
    .getByRole("button", { name: "Ask about this step", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Ask about this step", exact: true })
    .fill("Why subtract from both sides?");
  await page.getByRole("button", { name: "Ask tutor", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Mocked free quota" }),
  ).toContainText("Mocked free quota");
  await expect(
    page.getByRole("textbox", { name: "Ask about this step", exact: true }),
  ).toHaveValue("Why subtract from both sides?");
  await page
    .getByRole("button", { name: "Retry question", exact: true })
    .click();
  await expect(page.getByText(/Mocked tutor answer/)).toBeVisible();
  expect(captured.lessonId).toBe("linear-2x-3-11");
  expect(captured.stepId).toBe("beat-6");
  expect(captured.position).toBeCloseTo(position, 2);
  expect(captured).not.toHaveProperty("verifiedAnswer");
  const frozen = await page
    .locator("audio")
    .evaluate((a: HTMLAudioElement) => a.currentTime);
  await page.waitForTimeout(250);
  expect(
    await page
      .locator("audio")
      .evaluate((a: HTMLAudioElement) => a.currentTime),
  ).toBeCloseTo(frozen, 2);
  await page.screenshot({
    path: `test-results/followup-mocked-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Resume lesson", exact: false })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(frozen);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await slider.fill("0");
  await expect(page.locator('[data-element="subtract-left"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("discard an answer after the learner changes step context", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/follow-up", async (route) => {
    requests++;
    const q = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 400));
    await route
      .fulfill({
        json: {
          ...q,
          kind: "ai",
          text: "Stale mocked answer that must never appear.",
          visual: { kind: "none", targets: [] },
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Try saved example/ }).click();
  const slider = page.getByRole("slider", { name: "Lesson position" });
  await expect(slider).toBeEnabled();
  await slider.fill("4");
  await page
    .getByRole("button", { name: "Ask about this step", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Ask about this step", exact: true })
    .fill("Why is equality useful?");
  await page.getByRole("button", { name: "Ask tutor" }).click();
  await expect.poll(() => requests).toBe(1);
  await slider.fill("0");
  await page.waitForTimeout(600);
  await expect(
    page.getByText("Stale mocked answer that must never appear."),
  ).toHaveCount(0);
});
