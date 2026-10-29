# Settlement Selection Extraction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single responsibility. Verify and commit locally on refactoring.

**Goal:** Make LocalApp easier to follow by extracting settlement selection and payout-preview presentation.

**Architecture:** app/useSettlementSelection.ts owns the winner draft, derived pots/winners/preview, selection guards, navigation and explicit reset. ui/PayoutPreview.tsx renders existing preview content. LocalApp retains the dialog, command admission, SETTLE_HAND dispatch, UNDO/retry and toast handling.

**Tech Stack:** Existing React, TypeScript, Vitest and Playwright; no dependencies added.

**Spec:** Continue the user-approved one-responsibility-at-a-time LocalApp refactoring approach; preserve behavior and folder structure.

## Constraints and review focus

- Preserve tournament/hand/generation scope; do not add state version or reset effects.
- Keep winner selection after unrelated version changes such as blind scheduling.
- Reset selections after successful UNDO, including successful retry, at the existing call sites.
- Preserve single-eligible automatic winners, ineligible-player guards and pot navigation wraparound.
- Preserve payout text, DOM structure, formatting and existing domain calculations.
- Do not alter repository/controller/PWA, game rules or unrelated LocalApp handlers.

## Task 1: Extract settlement responsibility

**Files:** frontend/src/app/LocalApp.tsx; new frontend/src/app/useSettlementSelection.ts; new frontend/src/ui/PayoutPreview.tsx; frontend/e2e/single-undo.spec.ts.

**Interfaces:** useSettlementSelection(state, generation, busy, notify) returns pots, winners, potIndex, currentPot, preview, navigation, selectWinner and resetWinners. PayoutPreview accepts state, pots, winners and preview; no saving or dialog state.

- [x] Add characterization of version-preserving selection versus explicit UNDO reset and run against the existing implementation.
- [x] Move state/selection/navigation and preview JSX without changing behavior.
- [x] Run all unit tests, typecheck, scoped lint, production build and targeted Chromium/WebKit settlement/UNDO/side-pot/motion/layout E2E.
- [x] Review and record verification for this responsibility's local commit.

## Verification

- Baseline selection/UNDO characterization: 2 passed on Chromium/WebKit before extraction.
- Post-extraction targeted E2E: 20 passed, exit 0. Files: single-undo, chip-motion, centered-pot and game; grep: 무르기|블라인드 예약은|WIN|정산|side pot|공동. Includes payout-preview amount display without applying payments, blind-scheduling selection retention, explicit UNDO/retry resets, side-pot conflicts and shared winners.
- All unit tests: 17 files / 157 passed (`npm test -- --run --no-cache`).
- Typecheck and scoped lint (`eslint src tests e2e eslint.config.js vite.config.ts playwright.config.ts`): passed.
- Full `npm run lint`: 3,317 pre-existing errors from .cache artifacts/scripts. No unrelated files or lint configuration changed.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation.
- As in the preceding task, each Playwright run required stopping its own preview process after all cases completed to allow server teardown to finish; both runs then exited 0.
- Independent read-only code review: no actionable regressions; state scope, guards, navigation, preview text/DOM and both UNDO reset paths preserved.
- `git diff --check`: passed. Full E2E/PWA update suites and physical devices were not rerun.

## Outcome

LocalApp decreased from 950 to 857 physical lines, but the useful boundary is responsibility: useSettlementSelection owns selection state and rules, PayoutPreview owns rendering, and LocalApp still owns commands and dialog orchestration. No generalized draft abstraction or new lifecycle effects were introduced. Remaining session/recovery and setup editing are separate future responsibilities.
