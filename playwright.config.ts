import { defineConfig } from '@playwright/test'

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '')
const baseURL = externalBaseUrl ?? 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chrome',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : [
        {
          command: 'npm run backend:build && npm run backend:start',
          url: 'http://127.0.0.1:3001/api/health',
          reuseExistingServer: true,
          timeout: 30_000,
        },
        {
          command: 'npm run dev -- --host 127.0.0.1',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 30_000,
        },
      ],
})
