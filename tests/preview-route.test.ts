import { it, expect, vi, afterEach } from "vitest";
import { GET, POST } from "../src/app/api/voice-preview/route";
afterEach(() => vi.unstubAllEnvs());
it("returns only masked configuration, never credentials", async () => {
  vi.stubEnv("GROQ_API_KEY", "private-sentinel-value");

  const body = await (await GET()).text();
  expect(body).not.toContain("private-sentinel-value");
  expect(body).not.toContain("voice123456789");
  expect(body).toContain("hannah");
});
it("rejects cross-origin generation before touching the provider", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const r = await POST(
    new Request("http://localhost/api/voice-preview", {
      method: "POST",
      headers: { origin: "http://different-host" },
      body: JSON.stringify({ text: "hello" }),
    }),
  );
  expect(r.status).toBe(403);
});
it("disables unauthenticated production generation", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(
    (
      await POST(
        new Request("http://localhost/api/voice-preview", { method: "POST" }),
      )
    ).status,
  ).toBe(403);
});
it("enforces preview limit at the route", async () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(
    (
      await POST(
        new Request("http://localhost/api/voice-preview", {
          method: "POST",
          headers: { origin: "http://localhost" },
          body: JSON.stringify({ text: "x".repeat(180) }),
        }),
      )
    ).status,
  ).toBe(400);
});
