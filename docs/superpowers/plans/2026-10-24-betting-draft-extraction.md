# Betting Draft Extraction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single task. Preserve behavior and commit locally after verification.

**Goal:** Extract betting draft ownership and input-to-command conversion from LocalApp without changing gameplay.

**Architecture:** Add app/useBettingDraft.ts beside LocalApp. The hook owns the draft, legal-action derivation, submission availability and input validation. LocalApp retains immediate busy/lock guards, UNDO, saving, dispatch, recovery and notifications.

**Tech Stack:** Existing React, TypeScript, Vitest and Playwright; no new dependencies.

**Spec:** User-approved scope in this chat: extract betting drafts only, preserve behavior, verify and commit on refactoring.

## Global Constraints

- Keep the current refactoring branch and folder structure.
- Preserve tournament/generation/version scoping, messages and command selection order.
- Do not change persistence, recovery, settlement drafts or game rules.
- Existing full lint includes unrelated .cache files; report that failure separately from scoped source lint.

## Review Focus

- Draft amounts disappear after confirmed version changes and control generation changes.
- CALL/CHECK ignore the draft; ALL_IN remains a draft until submission.
- Minimum raises and stack limits retain their existing guards and messages.
- Busy/lock admission checks and UNDO cleanup remain in LocalApp.
- Saving errors retain the original request and retry behavior.

## Task 1: Extract betting drafts

**Files:** Modify frontend/src/app/LocalApp.tsx and frontend/e2e/game.spec.ts; create frontend/src/app/useBettingDraft.ts.

**Interface:** useBettingDraft(state: GameState | null, generation: number | undefined, notify: (message: string) => void) returns legal, draftAmount, submitAllowed and prepareAction(action: string, amount?: number): GameCommand | undefined. It neither saves nor dispatches commands.

- [x] Run existing game/fold E2E as the unchanged baseline.
- [x] Add a characterization test for a below-minimum draft followed by an exact-minimum raise; run against existing code.
- [x] Extract existing logic without changing validation order or introducing reset effects.
- [x] Run unit tests, typecheck, scoped/full lint, production build and relevant E2E for betting, control loss, retry, UNDO and animation.
- [x] Review the diff and record results and reusable criteria for the task-only local commit.

## Reusable criteria

- Extract state together with the operations and derived values that describe that state.
- Keep persistence and operation admission at the existing command boundary.
- Pass only the inputs a responsibility needs; do not pass the controller or whole app state to an input hook.
- Preserve identity/version scopes and lifecycle before considering deduplication.
- Keep pure movement separate from behavior changes; leave unrelated code and folders alone.

## Verification

- Baseline: game.spec.ts + fold-guard.spec.ts, including the new minimum-raise characterization, 36 passed across Chromium/WebKit. Preview-server shutdown stalled after all cases; stopping only this run's preview processes allowed Playwright to exit 0.
- Unit tests: 17 files / 157 passed (`npm test -- --run --no-cache`).
- Typecheck and scoped ESLint (`src tests e2e eslint.config.js vite.config.ts playwright.config.ts`): passed.
- Full `npm run lint`: 3,317 existing errors from .cache artifacts/scripts; no lint configuration or unrelated artifacts changed.
- Optional Prettier check: new hook follows single-quote formatting; game.spec.ts already differs from Prettier defaults at HEAD, so unrelated formatting was preserved.
- Independent read-only review: no actionable regressions; extraction scope judged appropriate.
- Post-extraction E2E: game.spec.ts, fold-guard.spec.ts, single-undo.spec.ts, chip-motion.spec.ts and saving-appearance.spec.ts, 58 passed across Chromium/WebKit (exit 0). After every case completed, the preview server again required explicit shutdown to finish teardown.
- Production `npm run build`: passed (exit 0), including TypeScript and PWA generation.
- `git diff --check`: passed. Only LocalApp, its new hook, the characterization test and this record are included in the task commit.
- Full browser suite, PWA update tests and physical devices were not rerun for this bounded extraction.

## Outcome

LocalApp owns command admission and execution; useBettingDraft owns the draft and its input rules. Existing validation order, messages, command types and scope/version behavior are preserved. No reset effect, persistence change or shared abstraction was added. Future work should apply the criteria above to one responsibility at a time rather than splitting every long file.
