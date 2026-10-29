# Setup Editing Extraction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single responsibility; verify and commit locally on refactoring.

**Goal:** Separate setup editing and command coordination from LocalApp's JSX.

**Architecture:** app/useSetupEditing.ts owns scoped editor registration, drag preparation/commit, settings saving, player count/dealer/view changes, rename validation and start sequencing. LocalApp wires these operations to Table and SetupPanel. InlineName and SetupPanel retain their local input/IME state; session and game rules remain unchanged.

**Tech Stack:** Existing React, TypeScript, Vitest and Playwright; no dependencies or folder changes.

**Spec:** Continue the user-approved responsibility-based separation of logic and UI while preserving behavior.

## Constraints and review focus

- Keep tournament/generation/player editor keys and exact-key cleanup guards.
- Preserve waiting for name save before drag, early release/cancel behavior, IME and duplicate-name validation.
- Keep latest-added removal semantics, player IDs, dealer identity and visual rotation behavior.
- Preserve live session lock/settings reads and SETUP_UPDATE before START_TOURNAMENT ordering.
- Keep SetupPanel key/reset conditions and existing UI DOM/props behavior.
- Do not replace generic useSeatDrag, move input drafts out of their components or modify session/domain logic.

## Task 1: Extract setup editing

**Files:** frontend/src/app/LocalApp.tsx; new frontend/src/app/useSetupEditing.ts; frontend/e2e/setup.spec.ts.

**Interface:** useSetupEditing accepts state, generation, busy, notify, isLocked, getSettings, run and dispatch. It returns scope, drag, saveSettings, changeCount, onNameEditing, rename, rotate, start and clearEditing. The hook returns undefined rename/rotate handlers outside setup, preserving the previous JSX gates. LocalApp retains the drag prop gate and unchanged SetupPanel key.

- [x] Add characterization for an unblurred numeric draft saved before starting; run with existing name-scope tests before extraction.
- [x] Move existing setup state and handlers without changing guards or sequencing.
- [x] Run unit/type/lint/build and targeted setup/name/drag/keyboard/touch E2E on Chromium/WebKit.
- [x] Independently review and record verification for the task-only local commit.

## Verification

- Baseline new unblurred-start test plus name-scope tests: 6 passed on Chromium/WebKit, exit 0, before extraction.
- All unit tests: 17 files / 157 passed (`npm test -- --run --no-cache`).
- Typecheck and scoped lint (`eslint src tests e2e eslint.config.js vite.config.ts playwright.config.ts`): passed.
- Full `npm run lint`: 3,317 pre-existing errors in .cache artifacts/scripts; no lint settings or unrelated files changed.
- Independent read-only review: no actionable code regressions; plan wording updated to accurately locate the setup-only rename/rotate gates.
- Targeted E2E: 86 passed / 2 skipped, exit 0. Files: setup, interaction-revision, name-scope, keyboard-layout, tablet-touch and game; grep: 준비|이름|한글|드래그|딜러|키보드|원형|삽입|터치. The two skips are existing Chrome/CDP-only touch cases under WebKit; both pass under Chromium.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation.
- As in prior tasks, each browser run required stopping only its preview process after all cases completed to allow teardown to finish; both then exited 0.
- `git diff --check`: passed. Full E2E/PWA-update suites and physical mobile devices were not rerun.

## Outcome

LocalApp decreased from 581 to 461 physical lines. Setup state and command sequencing are now read together in useSetupEditing, while JSX connects handlers and keeps input components' keys unchanged. The hook has no new effects, session ownership or generic form abstractions. clearEditing preserves the previous home-navigation behavior (clear the editing marker); InlineName's exact-key unmount cleanup still clears the registered finish callback.
