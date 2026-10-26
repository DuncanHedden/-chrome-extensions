import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: 'extensions/*/e2e/**/*.spec.ts',
  // Extensions need a persistent context per test file; keep it serial and simple.
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? 'github' : 'list',
});
