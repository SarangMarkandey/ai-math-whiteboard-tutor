import { defineConfig } from "@playwright/test";
const production = process.env.PLAYWRIGHT_PRODUCTION === '1';
const port = production ? 3210 : 3000;
export default defineConfig({
  testDir: "tests/browser",
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: production ? `npm run start -- --hostname 127.0.0.1 --port ${port}` : 'npm run dev -- --hostname 127.0.0.1',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: {
      GROQ_API_KEY: 'mock-only-no-provider-access', DATABASE_URL: '',
      DEMO_SESSION_SECRET: 'test-only-not-a-real-production-session-secret',
      NODE_OPTIONS: '--import=' + new URL('./tests/support/no-external.mjs', import.meta.url).href,
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1366, height: 768 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
});
