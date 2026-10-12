/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import { swPlugin } from './scripts/precache.ts';
// Wall-clock budgets (tests/perf.test.ts) are unreliable on shared CI runners: `npm test` leaves them out and
// `npm run perf` (PERF=1) runs only them, budgets unchanged.
const PERF = !!process.env.PERF;
const PERF_TEST = 'tests/perf.test.ts';
// Relative base so the build works from any GitHub Pages sub-path. swPlugin writes the build's id and file list into
// dist/sw.js, the offline worker (scripts/precache.ts).
export default defineConfig({
  base: './',
  plugins: [swPlugin()],
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: {
    testTimeout: 60_000,
    include: PERF ? [PERF_TEST] : configDefaults.include,
    exclude: PERF ? configDefaults.exclude : [...configDefaults.exclude, PERF_TEST],
  },
});
