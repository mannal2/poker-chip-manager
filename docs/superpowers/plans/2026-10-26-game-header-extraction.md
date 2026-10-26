# Game Header Extraction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single UI responsibility; verify and commit locally on refactoring.

**Goal:** Make LocalApp's screen composition easier to read by extracting the game header.

**Architecture:** ui/GameHeader.tsx renders HAND, current/pending blinds and the manager button. It accepts display values, canEditBlinds and onHistory/onBlinds/onMenu callbacks. LocalApp retains modal ownership, state selection and commands. No new state, effects, dependencies or folder structure.

**Spec:** User-approved presentation-only GameHeader extraction.

## Constraints

- Preserve DOM nesting, CSS classes, IDs, labels, formatting and click behavior.
- Preserve HAND fallback to 01, hand-over-settings blind values and pending-blind display only while playing.
- Keep blind editing disabled outside playing and while busy.
- Existing app-flow/manager/saving-appearance E2E exercise the public behavior; no implementation-mirroring component tests are added.

## Task 1: Extract header

**Files:** frontend/src/app/LocalApp.tsx; new frontend/src/ui/GameHeader.tsx.

- [x] Run existing header/manager cases on the unchanged implementation.
- [x] Copy the existing header JSX into GameHeader and wire display props/callbacks.
- [x] Run all unit tests, full lint, typecheck/build and related Chromium/WebKit E2E.
- [x] Review and record results for the task-only local commit.

## Verification

- Baseline app-flow/manager header cases: 6 passed across Chromium/WebKit, exit 0; grep: 앱 홈은|상단 클릭|A08.
- Post-extraction app-flow/manager/saving-appearance cases: 10 passed across Chromium/WebKit, exit 0; grep: 앱 홈은|상단 클릭|A08|저장 대기. Includes record/menu navigation, pending blinds and next-hand display, and saving-state UI behavior.
- All unit tests: 18 files / 168 passed (`npm test -- --run --no-cache`).
- Full `npm run lint`, typecheck and GameHeader formatting check: passed.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation.
- Independent read-only review: no actionable regressions; markup, formatting, fallbacks, visibility/disabled gates and callbacks preserved.
- Each browser run required stopping only its preview process after all cases completed to finish teardown, as in previous tasks; both then exited 0.
- `git diff --check`: passed. Full browser suite and physical mobile devices were not tested in this task.

## Outcome

LocalApp decreased from 407 to 385 physical lines. GameHeader has no state, effects or domain dependencies; it renders supplied values and forwards user intent through callbacks. LocalApp retains data selection and dialog ownership. No logic behavior or visual design changes were intended.
