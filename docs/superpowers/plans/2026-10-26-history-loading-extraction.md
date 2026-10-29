# History Loading Extraction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single responsibility; verify and commit locally on refactoring.

**Goal:** Reuse the history UI without coupling it to local persistence.

**Architecture:** app/useLocalHistory owns the existing local event-loading effect. app/LocalHistoryPanel connects that hook to ui/HistoryPanel only while the dialog is mounted. HistoryPanel accepts events, players, loading and error, retaining row formatting, sort and display limit state.

**Spec:** User-approved step 1 of the mode-aware refactoring plan.

## Constraints and tradeoffs

- Keep the current folders, repository API, DOM, text and formatting unchanged.
- Read all events chronologically in batches of 100 before resolving UNDO; display 50 rows at a time as before.
- Preserve loading on dialog mount, effect cancellation on unmount and dependencies on repository/tournamentId.
- Keep sort/display-limit state in the UI; do not introduce a generic repository or future online API.
- The small LocalHistoryPanel adapter preserves dialog lifetime without moving local I/O into shared UI or loading eagerly in LocalApp.

## Task 1: Separate loading and presentation

- [x] Baseline: existing history unit and Chromium/WebKit integration tests.
- [x] Add and run a browser regression case for read failure and successful reopening.
- [x] Extract useLocalHistory and LocalHistoryPanel; pass data-only props to HistoryPanel.
- [x] Run all unit tests, full lint, typecheck/build and relevant Chromium/WebKit E2E.
- [x] Review the diff and record verification for the task-only local commit.

## Verification

- Unchanged implementation: history unit tests 5 passed; existing record dialog, chronology, reverse, more, 100-event UNDO and showdown browser cases 6 passed across Chromium/WebKit.
- Added failure/reopen characterization test: 2 passed across Chromium/WebKit before the extraction. It checks error visibility, no misleading empty/loading message after failure, successful reopening and no uncaught page errors.
- After extraction: all unit tests 18 files / 168 passed (`npm run test -- --run --no-cache`). Full lint and standalone typecheck passed.
- Related browser tests: 10 passed across Chromium/WebKit (`history-loading`, `interaction-revision`, `stage-history`, grep `기록|HAND|텍스트 선택`), exit 0. Includes the empty record display in the text-selection case.
- Production `npm run build`: passed, exit 0; includes TypeScript and local PWA generation.
- Formatting check of the four extracted/changed files and `git diff --check`: passed.
- Independent read-only review found no actionable regressions. Original effect dependencies, batching, unmount guard, dialog lifetime and UI state ownership are preserved.
- Browser runs required stopping only each run's preview node after the test cases completed to finish teardown, consistent with previous tasks; all three runs then exited 0.
- Full browser suite, physical devices and future online integration were not tested. Online transport and folder migration remain out of scope.

## Outcome

HistoryPanel depends on game data and React only; it retains display formatting, ordering and pagination state. LocalHistoryPanel preserves the existing mount boundary and connects local loading to that shared UI. The event-loading effect is moved without intentional logic changes; no generic data-access abstraction or dependency was introduced.
