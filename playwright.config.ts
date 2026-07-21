import { defineConfig, devices } from '@playwright/test';

const previewPort = process.env.DUSORI_PREVIEW_PORT ?? '4173';
const previewOrigin = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `${previewOrigin}/Dusori`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm preview',
    url: `${previewOrigin}/Dusori/`,
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
