/**
 * Spec files that change state every test shares (files under dist/, the preview server).
 * playwright.config.ts runs them after the parallel phase, one at a time, and
 * tests/e2e/sharedStateSpecs.test.ts fails if a spec writes to dist/ without being listed here.
 *
 * pwa and startup-update rewrite dist/local/sw.js, which every /local/ page registers.
 */
export const sharedStateSpecs = ['pwa.spec.ts', 'startup-update.spec.ts'];
