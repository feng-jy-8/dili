import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'pwa.spec.ts',
  outputDir: 'artifacts/pwa',
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
});
