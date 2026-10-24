# Local Session Extraction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single responsibility; review and commit locally on refactoring.

**Goal:** Separate local session lifecycle and persistence orchestration from LocalApp's UI.

**Architecture:** app/useLocalSession.ts owns the reducer, stable repository/controller/channel runtime, restore cancellation, synchronous admission lock, pending requests, retry, entry/control takeover and tournament replacement. LocalApp retains UI drafts, toast/dialog state, screen sizing and chip animation implementation. A prepareCommand callback returns a confirmation callback; the session retains it for UNKNOWN requests and invokes it only for matching confirmed versions, preserving animation ordering without importing UI modules.

**Tech Stack:** Existing React, TypeScript, Vitest, Playwright. No new dependencies or folder restructuring.

**Spec:** Continue the user-approved responsibility-based separation of logic and UI while preserving behavior.

## Constraints and review focus

- Preserve request IDs, sequence/generation, UNKNOWN retries and late-response rejection.
- Keep runtime/effect identities stable; UI callbacks must not restart restoration or dispose connections on re-render.
- Preserve lock/ref semantics, deferred resume, restoreVersion and recovery remount context.
- Keep before-command feedback for RESUME_FLOW/NEW_TOURNAMENT as well as gameplay commands; retry feedback must match request and result versions.
- Preserve successful retried UNDO cleanup before UI status update, dialog-close timing and confirmation prompts.
- Do not change controller/repository/domain/PWA internals, draft scopes or DOM/CSS.

## Task 1: Extract session orchestration

**Files:** frontend/src/app/LocalApp.tsx; new frontend/src/app/useLocalSession.ts; frontend/e2e/tablet-recovery.spec.ts. Existing appReducer stays beside both files.

**Interface:** useLocalSession accepts restartOnMount, recoveryContext, onRecover, notify and prepareCommand. It returns app state, generation, repository, command/run/restore/retry/entry/new-game/home actions and live isLocked/hasPending/getSettings reads. Mutable runtime objects are not exposed to the UI.

- [x] Verify existing targeted session tests as the baseline.
- [x] Mechanically extract existing orchestration, retaining UI feedback callbacks at their original execution points.
- [x] Run unit/type/lint/build checks and targeted Chromium/WebKit storage/recovery/control/UNDO/chip/PWA E2E serially.
- [x] Independently review and record results for this responsibility's local commit.

## Verification

- Baseline tablet-recovery/tablet-restart E2E: 10 passed on Chromium/WebKit, exit 0.
- Added tablet-recovery characterization: draft changes and opening/closing history must not reopen IndexedDB; a subsequent CALL must still succeed under the existing control lease.
- Unit tests: 17 files / 157 passed (`npm test -- --run --no-cache`).
- Typecheck and scoped ESLint (`src tests e2e eslint.config.js vite.config.ts playwright.config.ts`): passed.
- Full `npm run lint`: 3,317 existing errors in .cache artifacts/scripts. No lint configuration or unrelated files changed.
- Independent read-only review: no actionable regressions; callback timing, effect identity, lock/restore/retry/control/home behavior checked against baseline.
- Session E2E: 66 passed across Chromium/WebKit, exit 0 (tablet-recovery, tablet-restart, stalled-save, app-flow, single-undo, chip-motion, name-scope and manager).
- PWA/update E2E: 24 passed across Chromium/WebKit, exit 0 (pwa and startup-update), run after the session suite because these tests temporarily mutate dist. Total post-extraction targeted browser checks: 90 passed.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation after the browser suites.
- Each browser run completed all cases but required stopping its own preview process to finish teardown, as in prior tasks. All three runs then exited 0.
- `git diff --check`: passed. Full browser suite and physical mobile devices were not tested in this task.

## Outcome and boundary

LocalApp decreased from 857 to 581 physical lines. The new 344-line hook contains no JSX or UI module imports; it keeps the existing session state machine together rather than splitting lock, request and restore state across hooks. UI rendering, toast cleanup, dialogs, animations and input drafts remain in LocalApp and their existing hooks.

The callback that prepares command feedback is deferred until a command is issued; it is never invoked during hook render or used as a lifecycle-effect dependency. Its returned callback retains the prepared visual state through UNKNOWN retries. Live lock/pending/settings reads preserve synchronous admission and current controller data without exposing mutable controller internals. Existing confirmation text, UI cleanup order and storage behavior remain unchanged.

The next independent responsibility is setup/name/seat editing. It is intentionally not included in this commit.
