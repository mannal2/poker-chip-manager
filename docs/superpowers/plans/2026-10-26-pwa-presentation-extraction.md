# PWA Presentation Extraction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single responsibility; verify and commit locally on refactoring.

**Goal:** Centralize installation/update presentation policy outside LocalApp's JSX.

**Architecture:** app/usePwaPresentation.ts calls the existing useInstallPrompt and coordinates update visibility, automatic/manual mode, opening/closing/checking/applying and live save guards. LocalApp keeps useLocalPWA mounted at its current position, shared dialog state and JSX. LocalWorkspace keeps updateDeferred above the recovery remount boundary.

**Tech Stack:** Existing React, TypeScript, Vitest and Playwright; no new dependencies or folder changes.

**Spec:** User requests PWA guidance-policy separation while preserving behavior.

## Constraints and review focus

- Preserve useLocalPWA and useInstallPrompt unconditional component lifetimes and hook order.
- Installation guidance suppresses automatic update guidance; startupUpdate pins the update dialog during apply.
- Preserve manual checks, deferred automatic guidance, cancelCheck on close and update-deferred persistence through recovery remount.
- Preserve render-time apply availability and event-time live lock/pending checks in their original order.
- Read saved state before applying; preserve failed-read/retry/game preservation and callback invocation timing.
- Do not move shared game dialog state, alter SW/install internals, or change UI DOM/text.

## Task 1: Extract PWA presentation policy

**Files:** frontend/src/app/LocalApp.tsx; new frontend/src/app/usePwaPresentation.ts; frontend/e2e/startup-update.spec.ts.

**Interface:** usePwaPresentation accepts the existing pwa result, home/busy/dialog/updateDeferred, setDialog/onDeferUpdate, live isLocked/hasPending, readSavedState and notify. It returns install and an update presentation object (visible, automatic, canApply, open, close, check, apply).

- [x] Add characterization of install guidance taking precedence over a ready automatic update; run against existing code.
- [x] Move existing policy expressions and handlers without changing lifecycle or guards.
- [x] Run all unit/type/lint/build checks and serial Chromium/WebKit PWA/startup/install and relevant session E2E.
- [x] Independently review and record results for the task-only local commit.

## Verification

- Baseline new install/update-priority E2E: 2 passed on Chromium/WebKit before extraction, exit 0.
- All unit tests: 18 files / 168 passed (`npm test -- --run --no-cache`).
- Typecheck and scoped lint (`eslint src tests e2e eslint.config.js vite.config.ts playwright.config.ts`): passed.
- Full `npm run lint`: 3,317 existing errors in .cache artifacts/scripts; no lint settings or unrelated files changed.
- Independent read-only review: no actionable regressions; install lifetime/priority, startup pin, guard order and saved-state callback timing preserved. Render-time guard reads are now evaluated even without a visible update dialog; existing guard functions only read refs, so this has no side effects.
- Targeted E2E: 62 passed on Chromium/WebKit, exit 0 (`pwa.spec.ts startup-update.spec.ts install.spec.ts app-flow.spec.ts tablet-restart.spec.ts`). Includes real SW update/application, offline startup, manual retry, install/update priority and recovery/game preservation. PWA tests ran serially because they temporarily modify dist.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation after browser verification.
- As in previous tasks, each run required stopping its own preview process after all cases completed to finish Playwright teardown; both then exited 0.
- `git diff --check`: passed. Full browser suite and physical mobile devices were not tested in this task.

## Outcome

PWA presentation decisions and actions are now read together in usePwaPresentation; LocalApp wires the returned install/update models to the existing UI. This boundary centralizes install-first priority, automatic deferral, apply pinning and live storage guards. It intentionally adds no own state/effects or generic dialog abstraction. Existing PWA/install implementations, dialog ownership, UI content and updateDeferred recovery lifetime remain unchanged.
