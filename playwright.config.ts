import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Read dev port from tauri.conf.json to keep Vite, Tauri, and Playwright in sync
function devUrl(): string {
  try {
    const conf = JSON.parse(
      readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf-8'),
    )
    return conf?.build?.devUrl ?? 'http://localhost:5173'
  } catch {
    return 'http://localhost:5173'
  }
}

const baseURL = devUrl()

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    // The editor's full desktop toolbar and viewport require a desktop-sized canvas.
    viewport: { width: 1600, height: 1000 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'cd ep-work && npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})