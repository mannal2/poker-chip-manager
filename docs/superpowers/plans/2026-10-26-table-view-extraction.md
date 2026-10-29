# Table View Extraction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single responsibility; verify and commit locally on refactoring.

**Goal:** Separate pure table-display calculations from LocalApp's JSX.

**Architecture:** app/tableView.ts exports buildTableView(state, { draftAmount, pots, potIndex, winners }). It derives Table's player cards, pot/label/notice, phase/street, handKey and viewSeat. LocalApp spreads this data into Table and retains event handlers and hook ownership. No React or storage runtime imports, dependencies, folder changes or game-rule changes.

**Tech Stack:** Existing TypeScript, Vitest and Playwright.

**Spec:** User requests the previously proposed table display-data extraction while preserving all behavior.

## Constraints and review focus

- Preserve setup dealer absence and heads-up D/SB roles; use stored hand positions when a hand exists.
- Preserve role ordering/precedence and empty/eliminated SB notice.
- Add draft contributions only to the actor, without changing stored stack or ledger.
- Preserve current-pot winner/eligibility flags, labels, stage/street and view identity.
- Keep undefined optional display values, original player fields and input immutability.
- Keep events, draft invalidation, navigation, animation selectors and Table DOM unchanged.

## Task 1: Extract table view

**Files:** new frontend/src/app/tableView.ts; frontend/src/app/LocalApp.tsx; new frontend/tests/ui/tableView.test.ts.

- [x] Write literal-expectation tests for setup positions, hand precedence, draft projection, status roles, dead SB, pot selection and street labels; run before implementation.
- [x] Move the existing calculations into buildTableView and replace JSX calculations with one call.
- [x] Run unit/type/lint/build checks and targeted Chromium/WebKit table/betting/settlement/setup E2E.
- [x] Independently review and record results for the task-only local commit.

## Verification

- Pre-implementation targeted run: expected failure because the new tableView module did not yet exist. After implementation, all 11 new literal-expectation cases passed.
- All unit tests: 18 files / 168 passed (`npm test -- --run --no-cache`).
- Typecheck and scoped lint (`eslint src tests e2e eslint.config.js vite.config.ts playwright.config.ts`): passed.
- Full `npm run lint`: 3,317 existing errors from .cache artifacts/scripts; no lint settings or unrelated files changed.
- Independent read-only review: no actionable regressions or material coverage gaps; existing expressions/optional values preserved.
- Initial targeted E2E: 33 passed / 1 failed, exit 1. Files: game, board, centered-pot, setup and chip-motion; grep: A06 칩|올인·폴드|빈 SB|side pot|보드|WIN|정산|2인·인원|10명:|겹침.
- Failure: WebKit board 800x1280 exceeded the existing 30-second test budget while performing 30 CALL/CHECK clicks, before layout assertions. Snapshot showed a normal TURN board, pot 100 and enabled CHECK; no display assertion failed.
- Investigation followed systematic-debugging. With source and timeout unchanged, the same WebKit case passed two isolated repeat runs (24.5s and 25.1s), exit 0: `npm run test:e2e -- board.spec.ts --project=webkit --grep 800x1280 --repeat-each=2`. This verifies the missing scenario but does not erase the initial failure or establish a fix for timing variation. No test timeout/configuration changes were made.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation.
- As in prior tasks, preview processes were stopped only after every case finished so Playwright teardown could exit. Initial E2E exited 1; repeated case exited 0.
- `git diff --check`: passed. Full E2E/PWA-update suites and physical devices were not run.

## Outcome

LocalApp decreased from 461 to 411 physical lines. Table display rules now have one pure, independently tested entry point; the builder imports no React or storage runtime. It runs only for a rendered Table with a game state, while event callbacks, animation, navigation and draft lifetimes stay at their existing boundaries. Formulas and returned optional values were moved without intended behavior changes.
