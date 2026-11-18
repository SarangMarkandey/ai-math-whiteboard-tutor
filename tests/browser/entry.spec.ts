import { test, expect } from "@playwright/test";
test("focused entry, one generation action, and readable mobile framing", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What would you like to understand?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate lesson", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".board-canvas")).toHaveCount(0);
  await expect(page.getByText(/Development voice preview/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Explain linear equations/ }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/entry-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /Try saved example/ }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  if (info.project.name === "mobile") {
    await expect
      .poll(() =>
        page
          .locator(".board-canvas svg")
          .evaluate((e) => e.getBoundingClientRect().width),
      )
      .toBeGreaterThan(500);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } else {
    expect(
      await page
        .locator(".lesson-actions")
        .evaluate((e) => e.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(768);
  }
});

test("navbar home clears the lesson and stops its audio", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("math-tutor-job", "mock-saved-job"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Continue learning" })).toBeVisible();
  await page.getByRole("button", { name: /Try saved example/ }).click();
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeEnabled();
  const audio = await page.locator("audio").elementHandle();
  await play.click();
  await expect.poll(() => audio!.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Math Tutor — home" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to understand?" })).toBeVisible();
  await expect(page.locator(".board-canvas")).toHaveCount(0);
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Return to current lesson" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your mathematics question" })).toBeEmpty();
  await expect(page.getByRole("heading", { name: "Continue learning" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume preparation" })).toBeVisible();
  expect(await audio!.evaluate((a: HTMLAudioElement) => ({ paused: a.paused, src: a.getAttribute("src") })))
    .toEqual({ paused: true, src: null });

  await page.getByRole("button", { name: /Try saved example/ }).click();
  await expect(play).toBeEnabled();
  expect(await page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBe(0);
});
