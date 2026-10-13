import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:5173/command-center/', browserName: 'chromium' },
  webServer: { reuseExistingServer: !process.env.CI, command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173/command-center/' },
})
