import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // the update test briefly edits dist/sw.js
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    serviceWorkers: 'allow',
  },
  projects: [{
    name: 'mobile-chrome',
    use: {
      ...devices['Pixel 7'],
      // Software WebGL so the MapLibre map can render in headless Chromium.
      launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    },
  }],
  webServer: {
    command: 'node scripts/serve.mjs dist 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
