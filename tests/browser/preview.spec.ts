import { test, expect } from "@playwright/test";
test("preview UI uses mocked API only and never generates on mount or opening", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/voice-preview", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          model: "canopylabs/orpheus-v1-english",
          voice: "hannah",
          problems: [],
          enabled: true,
        },
      });
    posts++;
    return route.fulfill({
      json: {
        status: posts === 1 ? "newly-generated" : "cache-hit",
        audio: "/audio/linear-equation.mp3",
        captions: [{ id: "p", text: "Mock sentence.", start: 0, end: 10 }],
        metadata: {},
      },
    });
  });
  await page.goto("/dev/voice");
  await page
    .getByText("Development voice preview · Groq · hannah", { exact: true })
    .click();
  const text = page.getByLabel("Exact narration to send");
  await expect(text).toBeVisible();
  await expect(
    page.getByText("Model: canopylabs/orpheus-v1-english", { exact: false }),
  ).toBeVisible();
  expect(posts).toBe(0);
  await text.fill("Mock sentence.");
  await expect(page.getByText(/14 \/ 179 characters/)).toBeVisible();
  // This button is intercepted above: no real provider endpoint can be reached.
  await page
    .getByRole("button", { name: "Generate Preview", exact: true })
    .click();
  await expect(
    page.getByText("Newly generated preview", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await page
    .getByRole("button", { name: "Generate Preview", exact: true })
    .click();
  await expect(
    page.getByText("Cache hit — no provider request", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Math Tutor" })).toBeVisible();
  await page.screenshot({
    path: `test-results/voice-preview-${test.info().project.name}.png`,
    fullPage: true,
  });
});
