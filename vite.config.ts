/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: { testTimeout: 60_000 },
});
